# 4K playback failure (#21) — server-side falsification, 2026-09-07

Appendix to the burn-in (#20) / 4K (#21) investigation. The investigation doc
itself was never committed; this file carries the findings that came out of
the server-side capture so they survive the session that produced them.

**Method.** No app changes and no build. The exact device profile the app
ships was dumped from `buildDeviceProfile()` at runtime, and
`POST /Items/{id}/PlaybackInfo` was replayed against a stock Jellyfin 10.11.11
server with the app's exact request body — same profile, same
`EnableDirectPlay:false` / `EnableDirectStream:false`, same
`AutoOpenLiveStream`. The returned `TranscodingUrl` was then fetched, and the
child media playlist after it. Sessions were stopped afterwards.

## Hypothesis 1 — "the server refuses to negotiate 4K" — STRUCK

Every 4K title negotiated cleanly: no `ErrorCode`, a `PlaySessionId` present,
`SupportsDirectPlay`/`SupportsDirectStream` false, `SupportsTranscoding` true,
and a usable HLS/MPEG-TS `TranscodingUrl`.

| Title (source) | TranscodeReasons |
| --- | --- |
| 3840x2160 HEVC Main10 SDR | `DirectPlayError` |
| 3840x1600 HEVC Main10 SDR | `DirectPlayError` |
| 3840x1600 HEVC Main10 DOVIWithHDR10 | `AudioCodecNotSupported,VideoRangeTypeNotSupported` |

Both `master.m3u8` and the child `main.m3u8` returned HTTP 200 with full
segment lists. The server side of #21 is healthy end to end, so the failure is
client-side.

## Hypothesis 4 — "the client rejects the variant before requesting a segment"
— ALSO STRUCK (on-device, 2026-09-07)

Both 4K titles were played for ~70 s on the lab stick, build 20260905.17, and
the telemetry collector caught both sessions in full:

| Title | Delivered | Result |
| --- | --- | --- |
| 4K SDR Main10 **L150**, mp2t | 3840x2160 | 66 s, 0 dropped of 114 070 decoded, 0 errors, load 2394 ms |
| 4K DV P8.1 Main10 **L153**, mp2t | 3840x1600 | 73 s, 0 dropped of 127 110 decoded, 0 errors, load 3322 ms |

Every heartbeat reported the full source resolution — no downscale, no ABR
drop, `starve: none` throughout. So Vega decodes HEVC Main10 over `video/mp2t`
at 4K at both L150 and L153, and Shaka accepts a variant labelled
`VIDEO-RANGE=PQ` with `SUPPLEMENTAL-CODECS="dvh1.08.10/db1p"`. The container,
the level, the resolution and the DV labelling are all cleared. There is no
4032 in this failure at all.

The same session's capability probes agree: `media.hdr` returned
`verdict: hdr10-supported` with `hdrFieldsIgnored: false`, and
`media.containers` returned true for every real mp2t and mp4 type.

## The actual cause: an unsatisfiable negotiation on a server that cannot
## transcode video

Server-side logs for those two sessions show what separates them:

```
Sinners (4K SDR, VideoRangeType=SDR, L150)
  FFmpeg.DirectStream -> -codec:v:0 copy -bsf:v hevc_mp4toannexb -codec:a:0 ac3
                         -f hls -hls_segment_type mpegts

Central Intelligence (4K DV Profile 8.1, VideoRangeType=DOVIWithHDR10, L153)
  FFmpeg.Transcode    -> -hwaccel cuda -c:v hevc_cuvid ... -codec:v:0 hevc_nvenc
                         -vf tonemap_cuda=...:tonemap=bt2390 -codec:a:0 ac3
```

The SDR 4K title is a **remux**: the video is copied. The Dolby Vision title is
a **full NVENC re-encode with CUDA tone-mapping**, because Astra's device
profile carries exactly one HEVC condition —
`VideoRangeType EqualsAny SDR|HDR10|HLG, IsRequired: true` — and
`DOVIWithHDR10` is not in that list. It played on the lab stick only because
that server has an RTX 2060 SUPER.

Issue #21's reporter has video transcoding disabled and no hardware
acceleration. On his server the same negotiation produces a request the server
will not fulfil: Jellyfin hands back a `TranscodingUrl` (which is why Astra's
Stats-for-Nerds shows `Reason VideoRangeTypeNotSupported` — that string is
parsed from the URL's `TranscodeReasons` parameter at `jellyfin/index.ts:1574`,
it is not a Shaka error), no FFmpeg process is ever started, and playback stops
at 0 ms. His working 1080p file is SDR, so it takes the `-codec:v:0 copy` path
instead.

**It is not a 4K bug.** It correlates with 4K because DV and HDR10+ sources are
almost always 4K. The predicate is the video range, not the resolution:

> Any source whose `VideoRangeType` falls outside `SDR|HDR10|HLG` — that is,
> `DOVIWithHDR10`, `DOVI`, `HDR10Plus` — requires a video re-encode, and Astra
> has no fallback when the server cannot supply one.

Note that the reporter's own `ffprobe` output shows only `smpte2084` / bt2020
and reads as plain HDR10, which passes the condition. Dolby Vision appears only
in the stream's DV side data (`DvProfile`, `RpuPresentFlag`,
`DvBlSignalCompatibilityId`) — the same fields that mark Central Intelligence.
The reason string Jellyfin returned is the evidence that his files carry it.

### What to fix

The gap is Astra's recovery ladder: when negotiation yields no deliverable
stream, it throws (`jellyfin/index.ts:1359` and the
`'No playable URL returned from the server.'` branch) rather than re-asking
with the video-range requirement relaxed. A GPU-less server can remux DV
Profile 8.1 as-is — the base layer is HDR10 — so accepting the source range and
letting the panel handle it is a real fallback, and it is strictly better than
0 ms of nothing.

The `media.hdr` probe now says this device reports HDR10 as supported. The
blanket tone-map requirement predates that measurement.

## Finding: Jellyfin advertises the SOURCE video range in the master playlist

Master-playlist attributes as served:

```
4K   HEVC Main10 SDR   CODECS="hvc1.2.4.L150.B0,ac-3"  VIDEO-RANGE=SDR  RESOLUTION=3840x2160
4K   HEVC Main10 DV    CODECS="hvc1.2.4.L153.B0,ac-3"  VIDEO-RANGE=PQ   SUPPLEMENTAL-CODECS="dvh1.08.10/db1p"
1080 HEVC Main8 SDR    CODECS="hvc1.1.4.L120.B0,ac-3"  VIDEO-RANGE=SDR  RESOLUTION=1920x1080
1080 HEVC Main10 DV    CODECS="hvc1.2.4.L150.B0,ac-3"  VIDEO-RANGE=PQ   SUPPLEMENTAL-CODECS="dvh1.08.03/db1p"
```

The DV title is flagged `VideoRangeTypeNotSupported`, so the server will
tone-map it — yet the variant is still labelled `VIDEO-RANGE=PQ` with Dolby
Vision supplemental codecs. A client that filters on those attributes rejects
a stream it could actually play. This is its own bug, independent of #21's
outcome, and it is on the server side of the line.

The 1080p Main10/L150/PQ/DV row is a useful natural experiment: it separates
resolution from codec string, since it carries the "hard" codec string at a
resolution known to play.

## Note for next time: every capability probe asks about the wrong container

Every configuration in `src/services/mediaCapabilities/hdr.ts` uses
`video/mp4`, and the container probes in `mediaCapabilities/index.ts` ask
about `video/mp2t` only at L93 with no resolution dimension. HEVC is delivered
over **`video/mp2t`**. So the passing 4K HDR probe result says nothing about
the route 4K HEVC actually takes, and the mp2t results say nothing about 4K.
`deliveryRoute.ts` exists to close that gap; it holds profile and colour fixed
and crosses container x resolution x level, with a positive control in the
exact configuration of a stream that plays today (if that control fails, the
platform is not describing mp2t at all and the whole column is unreadable).

## The fix tension that did not materialise

Had mp2t-at-4K been the culprit, the obvious fix — routing 4K HEVC to fMP4 —
would have walked straight back into the open-GOP timestamp collisions that
MPEG-TS was adopted to avoid, and the alternative of capping level or
resolution in the profile would have forced a real transcode on exactly the
hardware-less servers that cannot afford one. Neither is needed: 4K HEVC over
mp2t decodes cleanly at L150 and L153. Recorded because the reasoning stands
if a future report does implicate the container.

## Open

- Reproduce on the GPU-less lab Jellyfin with a
  read-only NFS mount of the same library. It is the reporter's environment
  class; playing Sinners (should remux and work) and Central Intelligence
  (should fail as #21 describes) there would confirm the mechanism end to end
  without needing the reporter. Its setup wizard has not been run yet.
- Ask the reporter for `DvProfile` / `RpuPresentFlag` on Dune and The Dark
  Knight — the one field that closes the last gap.
- `emitVariants()` / `VariantSummary` in `services/telemetry/playbackFacts.ts`
  exist but are never called. Wiring them would report exactly which variants
  Shaka saw and which it allowed — the direct observation this probe infers.

## Reproduction on a GPU-less server (2026-09-07, evening)

Three rounds on the lab GPU-less Jellyfin (10.11.11, `HardwareAccelerationType:
none`, no `/dev/dri`, read-only NFS mount of the same library, so byte-identical
source files). Same stick, same build 20260905.17. Provenance verified by item
GUID: Jellyfin item ids are per-database, and the ids in `playback.decision`
(`c3d1cce3…` Sinners, `8352d407…` Central Intelligence) match the GPU-less
server's ffmpeg log filenames, not the GPU server's (`c89d4ae1…`, `111d9df0…`).
The GPU server logged no playback at all during these rounds.

| Round | Server state | Sinners (SDR) | Central Intelligence (DV P8.1) |
|---|---|---|---|
| 1 | tone-mapping off, transcoding allowed | plays, `-codec:v:0 copy`, 111x, 0 dropped of 108,274 | plays, `-codec:v:0 copy`, 48.8x, 0 dropped of 142,227 |
| 2 | tone-mapping **on**, transcoding allowed | plays, still `copy` | plays, still `copy`, 46.2x |
| 3 | tone-mapping on, **video transcoding denied** | **fails at 0 ms** | **fails at 0 ms** |

### Hypotheses struck

**Hypothesis: the `VideoRangeType` condition forces a re-encode that a GPU-less
server cannot afford.** Struck. On the GPU-less server, negotiation *did* raise
`VideoRangeTypeNotSupported` for the DV title — but ffmpeg, building that job,
found no tonemap available and fell back to `-codec:v:0 copy` inside the
transcode job. Jellyfin requires the transcode and then quietly copies. The DV
title played for 80 s with zero dropped frames on a machine with no GPU.

**Hypothesis: server-side tone-mapping is the switch.** Struck by round 2.
Enabling `EnableTonemapping` changed nothing, because with
`HardwareAccelerationType: none` there is no tonemap filter to select.

**The video range is not the predicate at all.** Round 3 killed Sinners too, and
Sinners is plain SDR and passes the condition. Resolution is not the predicate
either.

### Actual cause

Astra sets `EnableDirectPlay: false` and `EnableDirectStream: false` on every
`PlaybackInfo` request, so every negotiation resolves to `playMethod: Transcode`
(Sinners' own `transcodeReasons` is literally `["DirectPlayError"]`).

When the server *is* permitted to transcode video, Jellyfin answers that request
with a real HLS transcode URL and everything works. When it is **not** permitted,
Jellyfin still returns a `TranscodingUrl` — but it degrades to the static
remux endpoint, with no `VideoCodec`, no `AudioCodec` and no segment container:

```
transcoding allowed : /videos/{id}/master.m3u8?VideoCodec=hevc&AudioCodec=ac3&SegmentContainer=ts
transcoding denied  : /videos/{id}/stream?TranscodeReasons=DirectPlayError
```

`/videos/{id}/stream` serves the source file byte-for-byte, i.e. the raw MKV.
Astra plays it faithfully: `shouldUseTranscode` is `Boolean(TranscodingUrl)`
(`src/services/jellyfin/index.ts:1437`), the URL is present, so the transcode
branch at `:1460` is taken and the handed-back URL is used as-is. **Astra's URL
selection is not at fault; the request it made is.**

Vega's native player cannot demux MKV, so it raises `MEDIA_ERR_SRC_NOT_SUPPORTED`
(`source=native code=4`) immediately after `loadedmetadata`/`canplay`, and
playback stops at 0 ms. No FFmpeg process is ever created because nothing is
being transcoded; it is a static file serve. This matches the reporter's
"Jellyfin does not start an FFmpeg process" exactly.

Telemetry confirms the container swap: `outputContainer` is `"ts"` in rounds 1-2
and `"mkv"` in round 3, for both titles.

### The negotiation probe (2026-09-07, decisive)

Run on the GPU-less lab server directly over HTTP while video transcoding was still denied,
posting the real `buildDeviceProfile()` output for both item ids and varying only
`EnableDirectStream`:

| Title | `EnableDirectStream` | TranscodingUrl returned |
|---|---|---|
| Sinners (SDR) | `false` (current Astra) | `/videos/{id}/stream` — raw mkv |
| Sinners (SDR) | `true` | `/videos/{id}/master.m3u8` — hevc / ac3 / ts |
| Central Intelligence (DV) | `false` (current Astra) | `/videos/{id}/stream` — raw mkv |
| Central Intelligence (DV) | `true` | `/videos/{id}/master.m3u8` — hevc / ac3 / ts |

The result inverts the intuition: asking for *less* (`EnableDirectStream: false`)
is what produces the unplayable answer. With DirectStream permitted, Jellyfin
builds exactly the HLS route that plays — the same route rounds 1-2 used — and
`TranscodeReasons` is unchanged (`DirectPlayError` for Sinners,
`AudioCodecNotSupported,VideoRangeTypeNotSupported` for Central Intelligence), so
the range condition is again not the discriminator.

Removing `mkv` from `DirectPlayProfiles.Container` changed nothing in any of the
four cases; the container advertisement is not the lever.

### Implication for the fix

Relaxing the video-range requirement would not have helped — Sinners fails with
no range problem at all. Nor would gating the direct-play branch: that branch is
never reached. The defect is that Astra asks for a route set that, on a server
without video-transcode permission, has exactly one member and it is a container
Vega cannot demux.

Astra must not play a `TranscodingUrl` that is really a static source serve. Two
things follow, and they compose:

1. **Detect it.** A `TranscodingUrl` whose path ends in `/stream` (no
   `SegmentContainer`, no `VideoCodec`) is a remux/static serve, not a transcode.
   If the source container is not Vega-demuxable, that URL is known-bad before a
   byte is fetched.
2. **Recover from it.** Re-negotiate once with `EnableDirectStream: true`. The
   probe shows this returns the working HLS URL on exactly the server state that
   fails today. If that also comes back unplayable, surface an error naming the
   server-side permission instead of a bare `code 4`.

Note this leaves the blanket `EnableDirectStream: false` in place for the normal
path, so the seek behaviour it protects is unchanged; DirectStream is requested
only on the retry that currently has no answer at all.
