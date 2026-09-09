# Transcode delivery evidence — 2026-09-05

This note records the boundary between Jellyfin's requested playback route and
the effective per-track delivery observed in FFmpeg. It is historical evidence
for the Astra 1.3 playback investigation; it does not change server or client
tuning.

## Verified limitation

Jellyfin 10.11.11 `PlaybackInfo.MediaSources[]` exposes source metadata and
`TranscodingUrl`, a request for subsequent streaming. It has no effective
per-track copy/encoder result. Matching codecs, stream-copy permission, and
transcode reasons cannot establish the actual FFmpeg operation.

The `playback.decision` emitter now reports `videoDeliveryMethod: "Unknown"`
and `audioDeliveryMethod: "Unknown"`, with separate evidence strings explaining
that API limitation. Both contrasting files should report Unknown at this
stage: this measures the API's lack of information, not an always-true codec
classifier. Existing URL estimates remain available for recovery and UI;
output codec fields also remain URL-derived estimates. No playback behavior,
profile, HLS configuration, native parsing, or subtitle policy changed.

Actual runtime evidence is available in `GET /Sessions` under nullable
`TranscodingInfo.IsVideoDirect` and `IsAudioDirect`. Jellyfin sets these from
whether the effective output codec is `copy` when FFmpeg starts. A future
runtime probe would need to correlate the active device/item/session, handle
missing or stopped sessions as Unknown, and collect after FFmpeg starts.
No sessions polling was added in this observational PlaybackInfo task.
Server FFmpeg command logs can independently resolve the question now.

Verified upstream sources (tag `v10.11.11`, inspected 2026-09-05):

- [MediaSourceInfo](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.Model/Dto/MediaSourceInfo.cs)
- [TranscodeManager runtime assignments](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.MediaEncoding/Transcoding/TranscodeManager.cs)
- [TranscodingInfo runtime fields](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.Model/Session/TranscodingInfo.cs)

## Build and device status

Astra 1.3.0 build `20260905.9` / package `2026090509` (x86_64) built,
passed manifest/ABI validation, installed in place, and launched. Telemetry
configuration was verified nonempty without printing credentials; generated
configuration remains ignored by Git. The collector received `app.start`
with build `20260905.9` at timestamp `1788654186547`.

TypeScript and touched-file ESLint passed; 55 Jest suites, 454 tests and one
snapshot passed. The new tests cover the contrasting source/reason cases,
copy-permission ambiguity, explanatory evidence, and URL scrubber forwarding.

**Fresh two-title playback acceptance remains pending.** The operator directed
that the agent must not drive the device after installation. Navigation stopped;
no new playback run was initiated. The operator can play Graceland and Central
Intelligence, then inspect the new `playback.decision` events in the local
collector. The findings below are historical server evidence, not fresh build
playback verification.

## Historical server verdict

The prior Astra telemetry sessions establish the requested routes. The server
FFmpeg logs below independently show the actual copy/encode operations. Log
filenames are retained so a future operator can reproduce the lookup without
recording credentials or private host details.

### 3000 Miles to Graceland

Item ID `b1cc5cbb7e0201496197ddf3e0e7c3ad`; historical Astra PlaySessionId
`5011953ce6f944ee906012b46567299a`.

Representative logs:

- `FFmpeg.Remux-2026-09-05_21-25-42_b1cc5cbb7e0201496197ddf3e0e7c3ad_618c683a.log`
- `FFmpeg.Remux-2026-09-05_22-04-01_b1cc5cbb7e0201496197ddf3e0e7c3ad_a94ce66e.log`
- `FFmpeg.Remux-2026-09-05_22-11-46_b1cc5cbb7e0201496197ddf3e0e7c3ad_367146e5.log`

The route was HLS fMP4 remux. FFmpeg used `-codec:v:0 copy` (with
`h264_mp4toannexb`) and `-codec:a:0 copy`; no subtitle or video filter was
present. Resume instances used `-ss` and nonzero HLS segment numbers.

### Central Intelligence

Item ID `c89d4ae1d40d906a22bfe285c9b1544a`; historical Astra PlaySessionId
`0b894a7a7fa146c780c168782d40622b`.

Representative logs:

- `FFmpeg.Transcode-2026-09-02_01-31-37_c89d4ae1d40d906a22bfe285c9b1544a_c0141fda.log`
- `FFmpeg.Transcode-2026-09-02_01-36-54_c89d4ae1d40d906a22bfe285c9b1544a_4744b5ce.log`
- `FFmpeg.Transcode-2026-09-05_23-04-51_c89d4ae1d40d906a22bfe285c9b1544a_b8172005.log`

The route was HLS MPEG-TS transcode. Video used CUDA decode and
`hevc_nvenc`, with HDR-to-BT.709 tonemapping. Audio used AC-3 encoding
(`-codec:a:0 ac3`). Subtitle-on instances added a subtitle overlay filter and
CUDA composition, confirming burn-in. These logs are evidence of the server's
actual FFmpeg command for those sessions, not a claim about a future run.

## Verdict

The inspected SDR Graceland runs remuxed both H.264 video and AAC audio. Its
old AAC-to-AAC `Transcode` label was an inaccurate URL-derived estimate; it
was not evidence of an audio re-encode. The inspected HDR Central Intelligence
run encoded HEVC video with tone mapping and DTS audio to AC3, with subtitle
burn-in. There is no evidence in these cases of re-encoding video that the
current playback requirements could simply remux. This does not establish
behavior across the entire library. Tuning remains separate work.
