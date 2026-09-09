# Handoff — Issue #21 (4K files refuse to play) + `jellyfin/index.ts` decomposition

Written 2026-09-07 at the end of a diagnosis session. Everything below is
reproduced and verified on hardware; nothing here is theory. Read this before
reading `docs/investigation-4k-playback-2026-09-07.md`, which has the full
experimental record including three struck hypotheses.

There are **two jobs**: a small behavioural fix (part 2) and a structural
refactor (part 3). Do the refactor first or second, your call, but keep them in
separate commits so the fix stays reviewable.

---

## 1. What the bug actually is

**Not a 4K bug. Not an HDR bug. Not a Dolby Vision bug.** All three were
hypothesised and all three were falsified on-device. Do not re-litigate them.

Astra sends `EnableDirectPlay: false` and `EnableDirectStream: false` on every
`POST /Items/{id}/PlaybackInfo`. Both flags are deliberate — direct/raw-file
playback seeks unreliably on Vega.

Consequence: every negotiation resolves to `playMethod: Transcode`.

When the Jellyfin **user policy** has `EnableVideoPlaybackTranscoding: false`
(the reporter's state; `EnablePlaybackRemuxing` is still `true`), Jellyfin
*still returns a `TranscodingUrl`* — but it degrades to the static source
endpoint:

```
transcoding permitted : /videos/{id}/master.m3u8?VideoCodec=hevc&AudioCodec=ac3&SegmentContainer=ts
transcoding denied    : /videos/{id}/stream?TranscodeReasons=DirectPlayError
```

`/videos/{id}/stream` serves the source file byte-for-byte — a raw MKV. Vega's
native player cannot demux MKV, so it raises `MEDIA_ERR_SRC_NOT_SUPPORTED`
(telemetry: `source=native code=4`) right after `loadedmetadata`/`canplay`, and
playback stops at 0 ms. **No FFmpeg process is ever spawned, because nothing is
being transcoded** — this is exactly the reporter's "Jellyfin does not start an
FFmpeg process".

Astra plays that URL faithfully. `shouldUseTranscode` is
`Boolean(mediaSource?.TranscodingUrl)` (`src/services/jellyfin/index.ts:1437`),
a URL is present, so the transcode branch at `:1460` is taken and used as-is.

> **The client's URL selection is not the defect. The request it made is.**

### The decisive probe

Run directly over HTTP against the failing server, posting the real
`buildDeviceProfile()` output, both item ids, varying only one flag:

| `EnableDirectStream` | TranscodingUrl returned |
|---|---|
| `false` (Astra today) | `/videos/{id}/stream` — raw mkv |
| `true` | `/videos/{id}/master.m3u8` — hevc / ac3 / ts |

Asking for *less* produces the unplayable answer. `TranscodeReasons` is
**identical** in both rows (`DirectPlayError` for the SDR title;
`AudioCodecNotSupported,VideoRangeTypeNotSupported` for the DV title), which is
the third and final piece of evidence that video range is not the discriminator.

Also tested and **null results — do not pursue**:
- Removing `mkv` from `DirectPlayProfiles.Container`: changed nothing in all
  four cases.
- Server-side `EnableTonemapping` true vs false: changed nothing (with
  `HardwareAccelerationType: none` there is no tonemap filter to select).
- Relaxing the `VideoRangeType` CodecProfile condition: would not have helped;
  the SDR control title fails identically with no range problem at all.

### Why it read as an HDR bug to everyone

`VideoRangeTypeNotSupported` shows up in `TranscodeReasons` for DV content on
every server, healthy or not, and the Stats-for-Nerds overlay
(`src/screens/PlayerScreen/index.tsx:2875`) echoes `TranscodeReasons` as a
`Reason` line as though it were an error. It is not. It is an advisory that
appears on sessions that play perfectly.

---

## 2. The fix

Scope: **`src/services/jellyfin/index.ts` only.** PlayerScreen is not involved.
~30 lines around `getStreamUrl` plus tests.

Three steps, in `getStreamUrl` after the `PlaybackInfo` response is parsed:

1. **Detect the degraded URL.** A `TranscodingUrl` whose path ends in `/stream`,
   with no `SegmentContainer` and no `VideoCodec` query parameter, is a static
   source serve, not a transcode. Combined with a source `Container` that Vega
   cannot demux (mkv, avi, and friends — mp4/m4v/ts are fine), it is known-bad
   before a single byte is fetched. Detect on *both* conditions; a `/stream`
   URL for an mp4 source is genuinely playable and must not be disturbed.

2. **Re-negotiate once** with `EnableDirectStream: true` (leave
   `EnableDirectPlay: false`). The probe proves this returns the working HLS URL
   on exactly the server state that fails today. Guard it so it can happen at
   most once per `getStreamUrl` call — no retry loops.

3. **Fail loud** if the retry is also unplayable: throw an error naming the
   server-side permission ("this server is not permitted to transcode video for
   your account") rather than handing an undemuxable container to the native
   player and letting it emit a bare `code 4`.

### Why not the alternatives

- *Gate the direct-play branch on container* — dead. `:1471`'s `else if
  (mediaSource?.SupportsDirectPlay …)` branch is never reached in this scenario,
  because a `TranscodingUrl` is always present.
- *Stop sending the blanket `EnableDirectStream: false`* — rejected. That flag
  exists because seek is unreliable on Vega. Flipping it globally trades a rare
  hard failure for a common subtle one. The design above keeps the blanket flag
  on the normal path and requests DirectStream **only on the retry that
  currently has no answer at all**, so seek behaviour is untouched.

This also satisfies the standing project constraint that behavioural changes
ship with current behaviour reachable as a fallback.

### Tests to add

Unit tests against a mocked `PlaybackInfo`, in `test/`:
- degraded `/stream` URL + mkv source → triggers exactly one re-negotiation with
  `EnableDirectStream: true`, and returns the `master.m3u8` URL from the second
  response.
- degraded `/stream` URL + **mp4** source → no re-negotiation, URL used as-is.
- normal `master.m3u8` first response → no re-negotiation (regression guard;
  this is the overwhelmingly common path and must not gain a round-trip).
- both responses degraded → throws, and the message names the server permission.

---

## 3. The decomposition ask

`src/services/jellyfin/index.ts` is 2115 lines and is the reason this bug was
hard to see. Break it into sub-modules under `src/services/jellyfin/`. Suggested
seams, which follow the file's existing internal grouping:

- `http.ts` — `normalizeServerUrl`, `buildUrl`, `getAuthHeaders`,
  `getPreAuthHeaders`, `sanitizeUrlForLog`.
  - ⚠ `normalizeServerUrl` contains a hardcoded http→https rewrite for one
    specific host. Preserve it verbatim; it is load-bearing.
- `auth.ts` — `connect`, `authenticate`, the QuickConnect quartet.
- `playback.ts` — `getStreamUrl` and its helpers (`buildTranscodingUrl`,
  `hasPlayableMediaSource` at ~`:401`, stream/track selection, `mapTrack`).
  **This is where the fix lands** and it is by far the highest-value extraction.
- `items.ts` — `getItems`, `getItemDetails`, `getSeasons`, `getEpisodes`,
  `getResumeItems`, `getNextUp`, `getLatestItems`, `getSimilarItems`,
  `getPerson`, `getItemsByPerson`, `searchItems`, `getLibraries`.
- `reporting.ts` — `reportPlayback*`, `setFavorite`, `setPlayed`.
- `discovery.ts` — `discoverServers`, `measureServerBandwidth`.
- `index.ts` — re-export barrel **preserving every current export name and
  signature**, so no call site outside this directory changes.

Constraint: the refactor commit should be a pure move. No behaviour changes, no
signature changes, no drive-by cleanups. If you spot something wrong while
moving it, note it and leave it — that keeps the diff reviewable.

`deviceProfile.ts` (171 lines) is already separate and healthy; leave it alone.

---

## 4. Verification gates (all must pass before commit)

```
npm test -- --watchAll=false --runInBand
npx eslint src test
npx tsc --noEmit 2>&1 | grep -v "^reference/"
```

`tsc` output **must** be filtered — the vendored `reference/` sample apps have
genuine parse errors and always will.

---

## 5. Project constraints — non-negotiable

- Commit identity **`AmbientFlare <admin@ambientflare.com>`**. No AI attribution
  footers of any kind.
- Levi batches release chores. **Do not** make incremental version-bump,
  changelog, or docs-tidy commits. Flag what's owed and hold it.
- **Build footgun:** `scripts/prepare-telemetry.cjs` is wired to
  prepare/prestart/pretest/prebuild and silently overwrites
  `src/services/telemetry/operator.generated.ts` with an empty endpoint/token.
  Regenerate it immediately before any build, and always pass
  `--target x86_64`.
- Levi drives the Fire Stick himself. Ask before requesting an on-device test;
  do not attempt to drive it from the host.
- Never put credentials, tokens, or private infrastructure detail into the repo,
  commit messages, or issue comments. `astra-tv` is public.

---

## 6. State of the working tree at handoff

Nothing is committed. Present:

- `docs/investigation-4k-playback-2026-09-07.md` — modified, full experimental
  record. Trustworthy as of this handoff; the "actual cause" section was
  corrected after the probe.
- `docs/handoff-issue-21.md` — this file.
- `src/services/mediaCapabilities/deliveryRoute.ts` (~380 lines) +
  `test/DeliveryRouteProbe.spec.ts` (13 tests, passing) — untracked. Built as a
  matrix probe for a hypothesis that was subsequently falsified. **No longer
  load-bearing.** Levi's call whether it stays; do not build the fix on it.
- Modified: `.gitignore`, `docs/IMPLEMENTATION_STATUS.md`, `src/App.tsx` (emits
  a `media.deliveryRoute` telemetry event, tied to the above).

## 7. Lab server state to restore

The reproduction server (the GPU-less lab server, GPU-less, Jellyfin 10.11.11) is still
in the **failing** configuration on purpose:

- User `levi2`: "Allow video playback that requires transcoding" is **unchecked**.
  Re-check it to restore normal playback.
- `/opt/jellyfin/config/encoding.xml`: `EnableTonemapping` was flipped
  `false`→`true`. Recommend leaving it `true` (it is Jellyfin's default and made
  no measurable difference). Backup at `encoding.xml.bak-20260907`.
- `/tmp/jf-probe.db` is a copy of the Jellyfin database made for the probe and
  **contains device access tokens**. Delete it.

## 8. Also open

**Issue #20** — forced subtitle burn-in. Unaddressed. Relevant context:
`deviceProfile.ts:153-169` marks ass/ssa/pgs/pgssub/dvbsub/dvdsub/idx as
`Method: 'Encode'`, which forces a full video re-encode purely to burn in
subtitles. On the GPU server that means a needless NVENC pass; on a GPU-less
server it means the title becomes unplayable. Same class of problem as #21 —
a profile declaration with a consequence nobody costed — but a separate fix.
