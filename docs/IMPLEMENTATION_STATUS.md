# Implementation Status

Last updated: 2026-09-01

## Global subtitle preference and credits/next episode — device-accepted, unreleased

Plan recorded before editing. Both features already had persisted settings
(`subtitleMode`, `preferredSubtitleLanguage`, `nextEpisodeAutoplay`,
`nextEpisodeCountdownSeconds`, `skipIntroCredits`) with Settings pages that
nothing in the player read. Prior art reviewed: commit `c36aec7` on
`chore/regression-hardening` (subtitle policy resolved from PlaybackInfo, the
`-1` wire convention; its in-place text-track switching is superseded by
burn-in-everything and is not reused) and PR #14 (media-segment credits and
next-episode countdown; conflicting with `main`, episode-only credits, Next Up
based lookup, no advance cap; ideas reused, code not merged).

### Expected behaviour

Subtitles are resolved inside `getStreamUrl` after the first PlaybackInfo
response and before the stream URL is chosen, so the burned-in track and the
server decision always match:

| mode | decision | wire |
|---|---|---|
| Default (per video) | the server's `DefaultSubtitleStreamIndex`, which carries Jellyfin's per-user subtitle mode and its remembered per-item choice | that index with burn-in, or `-1` when none |
| All subtitles on | preferred subtitle language, then the server default, then the first subtitle; none when the item has no subtitles | index, `AlwaysBurnInSubtitleWhenTranscoding`, `AllowVideoStreamCopy=false` (the same request shape as the hardware-proven in-player switch) |
| All subtitles off | none | `SubtitleStreamIndex=-1`, no burn-in |
| Only forced | first `IsForced` track, else none | as above |

- A track or Off chosen in the player overlay pins that playback session:
  later reloads (audio switch, long jump, error recovery) send the explicit
  index and skip the policy. The player never writes the global setting.
- Movies and episodes, start-from-zero and resume all pass through the same
  `loadStream → getStreamUrl` path, so the policy applies to every new video.

Credits and next episode:

- The credits window comes from Jellyfin media segments of type `Outro`
  (server 10.10+; a 404 or failure means none), else from a chapter whose
  name contains "credits" (window = chapter start to the next chapter start or
  the runtime). No fixed timestamps are assumed.
- Inside the window, unless the setting is Ignore, a focused card offers Skip
  Credits; an episode with a resolved next episode also offers Next Episode.
  Auto-skip seeks to the window end once per window. Back dismisses the card.
- A movie that ends shows "Finished" as before and never starts another item.
- An episode that ends with a valid next episode shows an "Up next" countdown
  (autoplay on, fewer than two consecutive automatic advances so far) or a
  "Continue watching?" card that needs an explicit press. The cap is two
  automatic advances, so the episode the viewer started plus two more play
  before Astra asks (operator's call on 2026-09-01; the brief said three).
  The consecutive count rides on the navigation entry: any play from a
  browse screen or a manual Next Episode resets it to zero; an automatic
  advance adds one.
- Next episode = same series, type Episode, the item after the current one
  from `/Shows/{seriesId}/Episodes?AdjacentTo=`; missing metadata means no
  card and no advance. Series boundaries are never crossed.
- Advancing awaits the player's own teardown before the navigator replaces
  the player entry; every credits/countdown timer is cancelled on Back,
  unmount, player replacement and handoff, and the `ended` handler runs once
  per player generation because Vega fires it twice.

Intro skipping is out of scope: the setting is still labelled "Skip
intro/credits" but only credits are handled.

### What changed (2026-09-01)

- `src/services/jellyfin/index.ts`: `selectSubtitleStreamIndex` resolves the
  global preference against the first PlaybackInfo response
  (`DefaultSubtitleStreamIndex`, `IsForced`, language aliases). The
  source-pinned re-request now carries the subtitle decision as well as the
  audio index, serialises Off as `-1`, and asks for burn-in with
  `AllowVideoStreamCopy=false` exactly as the in-player switch does. It is
  skipped when the first answer already plays the wanted track burned in, or
  none when none is wanted, so reload requests keep their one-request shape.
  `JellyfinStreamInfo` gains `subtitleStreamIndex` and `subtitleBurnIn`. New
  `getMediaSegments` (404 → none) and `getAdjacentEpisodes` (`AdjacentTo`).
  `getUrlParameter` accepts Jellyfin's server-relative `TranscodingUrl`.
- `src/services/storage/index.ts`: an unknown stored `subtitleMode` reads as
  `default`.
- `src/screens/SettingsScreen/index.tsx`: the subtitle page reads "Default
  (per video)", "All subtitles on", "All subtitles off", "Only forced".
- `src/services/episodePlayback/index.ts` (new, pure): credits window from
  Outro segments or a "credits" chapter (post/mid/after-credits names are
  excluded), next-episode resolution bounded to the series, the end-of-video
  decision (`finished` / `countdown` / `confirm`), the cap of three, the
  advance counter, and a cancellable one-second countdown.
- `src/screens/PlayerScreen/index.tsx`: mirrors the resolved subtitle into
  the refs the reload paths and reports read and pins the session; fetches
  segments and the adjacent episode once per item; shows the Credits card
  (Skip Credits, plus Next Episode for an episode with a successor), the
  "Up next" countdown and the "Continue watching?" card; `ended` runs the
  decision once per player generation; the countdown is cancelled on Back,
  unmount, surface loss and player replacement; advancing awaits
  `releaseForHandoff` (report stopped → Shaka unload → surface release →
  deinitialize) and bails if Back unmounted the screen meanwhile.
- `src/navigation/index.tsx`: `replace` swaps the top entry; the player is
  keyed by item id and receives `consecutiveAutoAdvances`; a manual Next
  Episode resets the count, an automatic one adds one.
- Build marker `20260901.1`.

### Physical device

Build `20260901.1` installed in place on the local Fire TV Stick; profile
intact. Operator result: the three subtitle modes pass across titles and the
existing playback paths (resume, audio switch, long jump) still pass. Skip
Credits and Next Episode did not show on the one episode tried (Star Trek:
Lower Decks S1E1), which ended on "Buffering" instead of a card. Whether
that title carries credits data or a resolvable neighbour is not known from
the device; build `20260901.2` adds trace lines to Stats for Nerds with logs
(`credits.segments`, `credits.window`, `nextEpisode.*`, `ended`,
`handoff.*`) and refuses a next episode that is another copy of the same
episode number. Movie credits, the three-episode cap and Back-during-
countdown remain unverified on hardware.

Server check (2026-09-01, Jellyfin 10.11.11): Lower Decks S1E1 has no
chapters and no media segments, so no Credits card was possible there, and
`AdjacentTo` returns `[S1E1, S1E2]`, so the neighbour lookup is sound. The
server runs no segment plugin, so credits detection there depends on chapter
names; six movies and three series carry one. Saved positions just before
the credits were written for the operator's user on Shaun of the Dead, Star
Trek (2009) and A Knight of the Seven Kingdoms S1E2–E5 for the next run.

Device results so far: the Credits card with Skip Credits and Next Episode,
the advance itself, and autoplay chaining all passed on the MPEG-TS
stream-copy route (Spartacus: House of Ashur S1, subtitles off). The cap was
changed to two automatic advances at the operator's request (`20260901.3`).
A resume on the fMP4 burn-in route stalls with zero frames decoded, on an
HDR movie and on an SDR episode alike; `20260901.4` switches such mid-file
fMP4 sessions to Shaka sequence mode (see `docs/DEVICE_TEST_NOTES.md`).

Build `20260901.4` passed the operator's full run: burn-in resume plays,
autoplay chains with subtitles on, the cap asks after two automatic
advances, Back on the card stays put. Handoff for the release write-up:
`docs/handoffs/fable-subtitles-credits-2026-09-01.md`.

Unresolved facts:

- Whether the fMP4 sequence-mode route holds A/V sync over a long subtitled
  watch (the earlier drift finding was MPEG-TS sequence mode, a different
  route). Owed before release.
- The Lower Decks S1E1 "Buffering" was almost certainly the same stall after
  a long jump on the burn-in route, not a missing `ended`.
- Whether Vega raises `pause` before `ended`; if it does, the paused-video
  idle visual can appear over a "Continue watching?" card left unattended
  for three minutes, as it already could over the old "Finished" state.

### Automated evidence

- ESLint and `tsc --noEmit` clean.
- Jest: 41 suites, 372 tests, all passing (`npm test -- --runInBand`).
  New: `test/SubtitleSelection.spec.ts` (policy table),
  `test/UserPreferencesStorage.spec.ts` (persistence and fallback),
  `test/EpisodePlayback.spec.ts` (segments, adjacency, credits window,
  next-episode bounds, movie-versus-episode decision, the cap of three, reset
  rules, countdown cancel/expiry with fake timers). Extended:
  `test/PlaybackInfoRequests.spec.ts` (Off sends `-1`; On picks the language
  and burns in; Default follows the server; a pinned manual choice goes out
  on the first request with no re-request; audio and subtitle share one
  pinned re-request) and `test/SettingsPlayback.spec.tsx` (subtitle radio
  persists through `updateUserPreferences`).

## Vega OS 1.2 playback repair — 1.2.0, complete

- [x] Established that the regression is environmental, not a code change. The
      previously accepted `20260822.4` package was installed unmodified on the
      device and reproduced the resume failure. Vega OS 1.2 reached the device
      automatically at an unobserved date during August 2026.
- [x] Pulled and symbolicated the device ANR rather than continuing to
      hypothesise. `vega device copy-logs --artifact SYSTEM_TOMBSTONE/acr`
      yields the crash reports; `<non_native_stack_trace>` symbolicates against
      `build/lib/rn-bundles/Release/<hash>.bundle.map` using `source-map`
      `originalPositionFor`.
- [x] First cause: the JS thread blocks inside
      `@react-native/js-polyfills/console.js`, reached from Amazon's
      `keplermediadescriptor` by way of `react-native-w3cmedia` during a Shaka
      segment append. CPU pressure was `full avg10=0.00` — blocked, not busy —
      and the Fire TV thread monitor killed the app. Release builds now replace
      `console.log/info/warn` with a bounded ring buffer, cutting the path for
      every caller including Amazon's own libraries. `console.error` is
      retained. Fixed resume and audio track switching.
- [x] Second cause: the HLS resume trim rebuilt a 1.4-2.2 MB playlist character
      by character, measured at 5,008 ms of synchronous work inside a 7,960 ms
      `player.load()`. The filter now copies the untouched suffix with
      `Uint8Array.set`. Fixed burned-in subtitle switching, and reduced
      re-encoding to 8 ms and stream load to about 2,800 ms.
- [x] `byteOffsetOfLine` locates the cut with native `indexOf` rather than a
      per-byte loop. UTF-8 continuation bytes are never `0x0A`, so counting
      newline bytes gives correct line boundaries whatever the encoding. CRLF
      sources fall back to the previous rebuild because the trim normalises
      their line endings.
- [x] Moved to Vega SDK `0.24.9914` and declared `[os.version]` 1.2. SDK 0.24
      refuses to build without the declaration. `vega project doctor` reports
      OS-version compliance and "Deprecated APIs: None".
- [x] Updated the Amazon device libraries to the v0.24-RN72 pins. React and
      React Native are unchanged at 18.2.0 and 0.72.0, so no framework
      migration was involved. `react-native-w3cmedia` 2.3.2 alone did not fix
      the regressions; it was taken to stop debugging against a stale stack.
- [x] Added an opt-in traces overlay. Vega exposes no JS console output to any
      artifact `vega device copy-logs` can retrieve — `main/var_log` carries
      system syslog only — so this is the only on-device playback diagnostic.
- [x] Added a one-time developer notice. It replaces the screen rather than
      overlaying it: covering the screen left focus behind it, so the first
      centre press navigated away instead of dismissing, leaving the notice
      unacknowledged.
- [x] ESLint, TypeScript, 208 Jest tests across 27 suites, manifest and ABI
      validation all passed for `20260829.12`.
- [x] Roughly 45 minutes of uninterrupted playback showed no A/V drift.
- [ ] A double-arrow chapter jump still takes about 38 seconds. This predates
      the OS update — a ten-minute jump measured 36 seconds on `20260813.7`,
      with Vega emitting `seeked` about 35 seconds after Astra applied it — and
      is below the JS thread, so none of this release's fixes affect it.
- [ ] Subtitles rendered by the app can drift out of sync after a long seek
      that requires buffering. The seek-clock correction targeting this was
      removed during an earlier rollback and has not been reinstated.
- [ ] Server discovery scans port 8096 only; instances on another port must be
      added by URL.

### Local tooling

- `vega sdk install` migrated the SDK layout from `~/vega/sdk/<version>/` to
  `~/vega/sdk/vega-sdk/<channel>/<version>/`, orphaning the hardcoded
  `KEPLER_SDK_PATH` in `~/.bashrc`. The failure is quiet: the JS bundle builds,
  Metro reports success and the command exits 0, then packaging fails and no
  VPKG is produced. Check the artifact timestamp, not the exit code. `.bashrc`
  now derives the path from `~/vega/config.json` and follows `vega sdk use`.


This document preserves reusable implementation findings, rejected hypotheses,
and physical-device validation results. Release operations and local
infrastructure details are intentionally excluded.

## Issue #9: HLS/fMP4 playback stutter

- Physical-device A/B testing on a Fire TV Stick 4K Select reproduced severe
  stutter on both Auto and two-second targets. Auto showed 8 `waiting` events
  by 1:04 despite a 12.5-second buffer and 84.2 Mbps estimated bandwidth for a
  5.2 Mbps stream; two seconds showed 17 waits by 0:56.
- The captured Vega trace identifies a fragment-timeline failure rather than
  buffer starvation: at six-second boundaries the HEVC DTS repeatedly moves
  backward by up to 214-215 ms, followed by repeated PTS, discarded ghost
  frames, and native frame drops. The MSE buffered ranges also contain small
  36-123 ms gaps that cause Shaka gap jumps.
- The early fMP4 hardware candidate enabled Shaka HLS sequence mode for video only.
  This places each fragment immediately after its predecessor instead of
  exposing overlapping source timestamps to Vega. Cleartext HLS music remains
  in its existing segments mode so the experiment has narrow scope.
- Sequence mode removed the large skips in a 4:46 hardware run: waits fell to
  2, backward DTS and explicit native frame drops fell to zero, and the buffer
  became one continuous range. Visible micro-stutter and slight A/V drift
  remained, while the trace showed occasional repeated PTS/ghost frames.
- The follow-up candidate returns video to segments mode but enables Shaka's
  `ignoreManifestTimestampsInSegmentsMode`. This preserves the muxed source A/V
  cadence while preventing the large duration-derived timestamp offset seen in
  the failing baseline (`-35.451375` seconds).
- A 4:28 run of that follow-up produced one startup wait, an 11.2-second
  buffer, no backward-DTS bursts, and no explicit native decoder drops. It did
  not eliminate visible micro-stutter. Repeated PTS/ghost-frame pairs recur at
  an approximately 10.427-second interval, equal to about 250 frames at the
  file's 23.976 fps.
- A read-only `ffprobe` inventory covered all 988 reference-library video
  files without probe failures (896 MKV, 91 MP4, and one M2TS). The affected
  source has monotonic DTS, unique PTS, and constant frame duration, so the
  source file is not timestamp-corrupt. Two comparison sources use the same
  x265 encode family, HEVC Main 10 `hev1`, 23.976 fps, a 1/24000 time base, AAC
  5.1, and nearly identical bitrate. Their only material metadata difference is
  1920x816 video versus the affected source at 1920x800.
- Jellyfin's retained FFmpeg command and generated playlist show that the
  requested six-second target actually begins with a 14.889875-second segment
  and then repeatedly emits 10.427083-second segments. Stream copy can cut only
  on the source's open-GOP keyframes. Requesting two seconds lowers the median
  segment duration but still produces 234 segments longer than ten seconds
  over the movie; it does not create fixed two-second fragments.
- The residual ghost frames are introduced by the HLS/fMP4 remux. During the
  first 5.5 minutes the original MP4 has zero duplicate video PTS, while both
  retained two- and six-second HLS/fMP4 renditions have 14. At the first
  affected boundary, the remux changes the keyframe PTS from `14.889875` to
  `14.723042`, colliding with a following B-frame while all surrounding packet
  timestamps remain unchanged. This is consistent with the source's x265
  `open-gop`, four-B-frame structure and Vega's repeated-PTS/ghost telemetry.
- Removing `frag_discont`, removing `hevc_mp4toannexb`, using normal timestamps,
  and adding HLS `independent_segments` did not prevent the collision. An
  otherwise equivalent HLS/MPEG-TS remux preserved every source PTS (zero
  duplicates), making MPEG-TS delivery the next narrow hardware experiment.
  The closest same-encode positive control produced 14 collisions in a
  synthetic 5.5-minute Jellyfin-style fMP4 remux; a second produced 10.
- Physical playback of the closest control reproduced the same micro-stutter once the
  low-detail opening star field gave way to detailed motion. This confirms the
  symptom across the closest same-encode control and rules out the affected source's
  1920x800 crop as the primary cause.
- Diagnostic build `20260813.5` routes HEVC alone through HLS/MPEG-TS while
  retaining HLS/fMP4 for h264. It is installed on the physical device for the
  next affected/control comparison; no buffering or codec policy changed.
- Playback on that candidate was approximately 99.9%
  free of micro-stutter, including a smooth action scene. A forward chapter
  jump then took roughly 20 seconds to resume. The trace rules out network or
  server remux latency: Jellyfin had completed the VOD remux minutes earlier,
  while Vega drained stale appends spanning roughly PTS 303-571 seconds.
- The delay exposed a contract violation in Astra's crash-safety MSE wrapper.
  It deferred the native `appendBuffer()` call, so `SourceBuffer.updating`
  remained false when control returned to Shaka; Shaka consequently fetched
  far past its ten-second goal and the post-seek buffered range reached about
  51 seconds. Build `20260813.6` invokes MSE operations synchronously and only
  tracks their native completion for lifecycle/seek safety. A regression test
  verifies both the synchronous call and completion wait.
- A repeat on build `20260813.6` still took about 28 seconds. The post-seek
  range was now the intended approximately 30 seconds behind and 10 seconds
  ahead, confirming the unbounded queue was fixed. The remaining delay was the
  UI awaiting the active SourceBuffer append before changing `currentTime`.
  Build `20260813.7` dispatches ordinary user seeks immediately so Shaka can
  abandon the old location, while unload and player replacement retain the
  native-completion barrier required for lifecycle safety.
- A ten-minute chapter jump on build `20260813.7` still took 36 seconds. The
  device trace recorded Astra applying the seek in 1 ms and Vega emitting
  `seeked` about 35.05 seconds later, ruling out the UI and JavaScript dispatch
  path as the remaining source of latency.
- The retained Jellyfin MPEG-TS session exposed a constant `10.083422`-second
  difference between the media timestamps inside every segment and the
  playlist timeline. Build `20260813.8` experimentally let Shaka reconcile
  that offset. Hardware testing rejected the experiment: playback buffered
  indefinitely, briefly played from an incorrect position, and returned to
  `waiting`. The device and source were rolled back to build `20260813.7`'s
  proven timestamp behavior. The long chapter-seek delay remains a documented
  limitation; normal smooth playback takes priority.
- A later resume from the saved `44:18.500` position took 171 seconds. The
  corresponding server command proves this was not encoding or slow remuxing:
  FFmpeg used `-ss 00:44:18.500`, copied both video and audio, and completed
  the remaining VOD HLS output in 4.79 seconds. Vega's first playable buffered
  range began at about `44:24.156`, leaving the requested playhead before the
  available TS media because of the mux timestamp offset.
- Build `20260813.9` adds a 20-second server-side preroll only for the
  HEVC/MPEG-TS route. Shaka still starts and reports at the exact saved
  position, while Jellyfin begins its stream-copy session slightly earlier so
  Vega receives a keyframe/timestamp range spanning that position. H.264/fMP4
  and playback from the beginning are unchanged.
- Hardware rejected the preroll hypothesis: resume still took 163 seconds.
  The complete device trace showed Shaka appending the shortened HLS timeline
  sequentially from about 33 seconds through 2670 seconds before playback.
  Jellyfin had already positioned the dynamic playlist near the saved movie
  time, while Astra passed that absolute movie time to Shaka a second time.
- Build `20260813.10` removes the ineffective preroll and starts a
  server-positioned adaptive playlist at its own leading edge. Once playback
  begins, Astra calibrates the relative media clock to the absolute movie
  clock used by the UI, subtitle renderer, progress reports, and subsequent
  seeks. This prevents processing the preceding 44 minutes while retaining
  the exact logical resume position.
- Hardware showed that build `20260813.10` started quickly but from the
  beginning of the movie, while its logical clock displayed the saved
  position. Direct API inspection then established Jellyfin's actual dynamic
  HLS contract: PlaybackInfo always returns a virtual playlist beginning at
  segment `0`; requesting numbered segment `N` is what makes Jellyfin launch
  FFmpeg with the corresponding input `-ss` seek.
- Build `20260813.11` trims the virtual media playlist at the segment
  containing the saved position and raises `EXT-X-MEDIA-SEQUENCE`
  accordingly. Shaka therefore sees that numbered segment as the playlist
  edge and requests it immediately. The logical/media timeline mapping from
  `.10` remains for UI, reporting, subtitles, and subsequent seeks.
- Physical-device acceptance passed for `.11`. Resume reached the correct
  saved scene within a few seconds instead of 163-171 seconds. The trace
  reached calibrated playback about 2.84 seconds after playlist trimming.
  The acceptance screenshot at logical position `45:38` showed a 10.7-second
  buffer, 3,804 decoded frames, zero dropped frames, zero stalls, and zero
  playback errors on the HEVC-to-HEVC HLS/TS route.
- Extended playback exposed mild A/V drift after roughly another 45 minutes.
  A normal ten-second D-pad seek immediately restored sync. This makes `.11`
  a major improvement but not final release acceptance. The recovery strongly
  points to accumulated Vega decoder/buffer clock drift rather than incorrect
  Jellyfin progress, a permanently shifted source track, or the resume
  playlist mapping; the latter would not be corrected by a relative seek.
- URL diagnostics now omit every query string and redact item-like IDs in URL
  paths. The device trace exposed that redacting only known token names was
  insufficient when Jellyfin duplicated query parameters with different
  casing.
- Added an opt-in `SegmentLength` preference with Auto, four-, three-, and
  two-second choices. Auto remains the default and omits the profile field, so
  existing Jellyfin behavior is unchanged for current users.
- The change directly implements the issue reporter's successful on-device
  workaround: the normal approximately six-second segments stuttered, while
  two-second segments played for more than 35 minutes with no visible skips or
  dropped frames.
- Stats for Nerds now shows the HLS segment target, minimum segment count, app
  version/build, and cumulative `waiting`, `stalled`, and `error` events with
  the most recent playback state and session-relative time.
- Playback health events emit structured metadata for the source/output
  container and delivery method. The diagnostic record excludes server URLs,
  credentials, item IDs, and media titles.
- Regression coverage asserts that Auto omits a segment override, every
  explicit choice reaches both video HLS profiles, the choice persists, and
  the new delivery/health context is rendered in player diagnostics.
- Segment-duration A/B testing did not remove micro-stutter. The subsequent
  HLS/MPEG-TS experiment on the affected and comparison sources did: physical testing
  reported approximately 99.9% of the micro-stutter gone, and the accepted
  resume test retained zero dropped frames, stalls, or playback errors.
- A separate follow-up experiment is recorded in `docs/deferred-work.md`: move
  the nominal 40-second Shaka window from 10 seconds ahead/30 behind to 20
  ahead/20 behind, with a four-second rebuffer threshold. It is intentionally
  excluded from this candidate so segment-duration results remain attributable.

## Issues #11 and #12: resume, segment boundaries, and long-run A/V drift

- Issue #11's saved-position skipping is addressed by build `20260813.11`'s
  numbered-playlist trim. Physical acceptance reached the correct scene in
  about 2.84 seconds instead of processing the preceding 44 minutes.
- Issue #12 reports a micro-freeze at roughly every HLS boundary on Astra
  1.1.0, with the displayed buffer counting down from about 15 seconds to one
  second before jumping back. The server reports stream-copy/remux, the stream
  bitrate is far below measured network capacity, and other clients play the
  same media smoothly. This joins issue #9 as a Vega HLS boundary problem, not
  evidence of an inherently slow server or source file.
- The old Stats for Nerds display reported only the buffered range containing
  the playhead. A future segment already present after one of the observed
  36-123 ms timestamp gaps therefore looked identical to a segment fetched at
  the last second. Build `20260822.1` reports the number of ranges, furthest
  buffered-ahead point, and next gap so the two cases can be distinguished.
- The accepted HEVC/MPEG-TS path in `.11` explicitly disabled HLS sequence
  mode, even though Amazon's Vega guidance recommends sequence mode for HLS
  MPEG-TS. The earlier sequence-mode experiment used fMP4, and build `.8`
  tested timestamp reconciliation in segments mode; MPEG-TS sequence mode had
  not been isolated on hardware.
- Build `20260822.1` enables sequence mode only when the output container is
  MPEG-TS. H.264/fMP4 remains in its accepted segments-mode configuration, and
  buffering goals, codec policy, resume mapping, and segment targets are
  unchanged. This makes the long-run A/V sync and boundary test attributable
  to one playback-policy change.
- Astra 1.0.2 had a superficially similar seek-cleared drift when Jellyfin
  converted DTS-HD to AAC. Selecting AC3 conversion fixed that case. The
  current affected HEVC title already carries AAC 5.1 and the new variable is
  MPEG-TS delivery, so blindly reapplying the old audio-codec fix is not
  justified.
- Build `20260822.1` resumed the affected title at a saved position within
  seconds. Initial telemetry showed one continuous 12-second buffered
  range, zero dropped frames, zero stalls, and zero errors. Three consecutive
  forward/back/forward ten-second seeks all returned to playback; afterward the
  buffer remained one range at 16.2 seconds with zero dropped, stalled, or
  error events. Waiting events rose from two to seven during those deliberate
  seeks, with 2.7 seconds cumulative buffering.
- The required continuous drift test restarted the title from `0:00` with Stats
  for Nerds enabled. At position `0:21`, the
  MPEG-TS sequence-mode candidate reported one 15.1-second range, zero dropped
  frames, zero stalls, zero errors, and one startup wait. This established the
  clean starting point for the completed one-hour observation below.
- The completed one-hour run rejected build `20260822.1`: audio led visible lip
  movement by approximately 0.75–1.5 seconds. Pause/resume appeared to reduce
  the offset, matching the earlier seek-cleared behavior closely enough to rule
  out perception noise and a permanently shifted source track. MPEG-TS sequence
  mode is therefore rolled back to the accepted segments-mode baseline.
- Build `20260822.2` isolates the next native variable by upgrading
  `@amazon-devices/react-native-w3cmedia` from 2.1.99 / `IW3cmedia_1` to 2.2.21
  / `IW3cmedia_2`. Codec policy, HLS/TS delivery, buffer goals, resume mapping,
  and segment targeting remain unchanged.
- The generated release manifest requests
  `/com.amazon.kepler.w3cmedia_2@IW3cmedia_2`, and Vega ABI validation passed.
  Build `.2` installed in place and launched on the physical stick with its
  saved profile intact. The affected title started successfully from `0:00`.
- Hardware rejected build `.2` after obvious A/V drift had returned by
  position `42:39`, approximately 46 minutes of wall-clock playback. Its
  captured diagnostics showed one continuous 10.0-second buffer, 68.1 Mbps
  estimated bandwidth for a 5.2 Mbps stream, zero dropped frames, zero stalls,
  zero errors, and only the startup wait. This rules out buffer starvation and
  the W3C Media ABI version as primary causes.
- Direct probing of the retained Jellyfin MPEG-TS rendition found no
  accumulating server-side A/V drift. Across segments at the beginning,
  10-minute, 20-minute, 42-minute, 80-minute, and final positions, audio PTS
  began only approximately 40-82 ms before video; the offset remained bounded
  rather than growing with playback time. The visible drift is therefore
  introduced in Vega's long-running demux/decode/render clock.
- Build `20260822.3` keeps W3C Media 2.2, segments mode, HEVC/MPEG-TS, buffer
  goals, resume mapping, and segment targeting unchanged. It forces only the
  HEVC/MPEG-TS audio output from copied AAC to AC3 when Vega reports AC3
  support. This directly isolates the codec variable that fixed Astra's older
  seek-cleared AAC drift; H.264/fMP4 retains the normal audio codec policy and
  devices without AC3 safely retain the existing fallback list.
- The exact `.3` server session confirmed the intended narrow route: FFmpeg
  copied HEVC video and converted AAC 5.1 to six-channel AC3 at 640 kbps in the
  MPEG-TS HLS output.
- Vega's `run-app` command calls uninstall before install, which deletes saved
  application data. The data-preserving upgrade workflow is `device
  install-app` followed by `device launch-app`; an in-place `.3` installation
  retained the saved profile.
- Build `.3` remained synchronized at 38, 56, and 60 minutes of uninterrupted
  playback, passing the approximately 46-minute failure point of `.2`. The
  HEVC/MPEG-TS AAC-to-AC3 change therefore passed the long-run A/V-sync gate.
- After the one-hour gate, forward/back/forward ten-second seeks all returned
  to playback. Stats at `63:12` showed one continuous 12.8-second range, 71.5
  Mbps estimated bandwidth for a 5.6 Mbps stream, zero dropped frames, zero
  stalls, zero errors, and four waits including the three deliberate seeks.
- Exit-and-resume then passed. Astra displayed the saved Resume action and
  returned to the correct scene. The server log independently confirmed the
  input seek, HEVC stream copy, six-channel 640 kbps AC3 conversion, and the
  expected numbered HLS segment. Build `.3` passed long-run A/V sync,
  repeat-seek, and saved-position resume acceptance on the physical stick.
- The auto-next request mentioned in issue #9 is a separate feature gap, not
  part of the playback regression candidate. Live TV issue #10 is out of scope
  because Astra does not currently provide live TV.
- GitHub issues #9, #11, and #12 received the physical-acceptance findings.
  Automatic next-episode playback remains separate issue #13; live TV issue
  #10 is outside Astra's current feature scope.

## Crash and ANR investigation

- Analyzed the supplied production ACR and ANR rows across Astra 1.1.0 and
  1.1.1. The repeatable signature is in Vega's native fragment parser during
  an MSE SourceBuffer append; it predates and survives the 1.1.1 append gate.
- Confirmed the release resolves `@amazon-devices/react-native-w3cmedia`
  2.1.99 and generates a dependency on `IW3cmedia_1`, while current Amazon
  guidance has moved to W3C Media 2.2.x and `IW3cmedia_2`.
- Identified lifecycle and ANR risk factors for the next stability patch:
  network-delayed media teardown, background resources not being released
  directly, uncoalesced concurrent seeks, and unbounded waits for native media
  events.
- The four one-frame Hermes ANR samples cannot be attributed to Astra source
  without the exact OS debug rootfs and a complete ANR thread dump.
- Full findings and the remediation/collection sequence are recorded in
  `docs/crash-investigation-2026-08-13.md`.

## Astra 1.1.1 stability patch

- TVTextInput teardown blurs the native input, dismisses the keyboard, and
  cancels delayed focus before unmount. Search and Setup also dismiss every
  accessible input before navigation or wizard-step changes.
- ShakaPlayer gates SourceBuffer `appendBuffer`, `remove`, and `abort` calls
  through a serialized queue. Seeks, loads, and unloads wait for the queue to
  settle before touching the media pipeline.
- Player and Library timer callbacks snapshot native references and cleanup
  clears timers before releasing refs, preventing stale callbacks from
  reaching replaced Vega objects.

## Audio edition

- Music browsing, sequential playback, remote controls, and progressive HTTPS playback are
  implemented.
- Cleartext HTTP audio now selects an AAC/TS HLS URL and loads it through
  ShakaPlayer. HTTPS servers retain progressive direct play.
- URL regression coverage verifies that the HLS request excludes source
  containers such as MP3, because advertising them makes Jellyfin silently
  direct-play the source instead of returning an HLS manifest.
- Queue construction, per-track action popups, long-press controls, and
  save-as-playlist were removed after proving unreliable on Vega hardware.
- Selecting a song plays it and continues through the source album or playlist.
  Album Play and Shuffle still replace the current playback sequence.
- Single-press D-pad Left/Right skips previous/next only on the dedicated Now
  Playing screen. On every browsing screen those keys remain ordinary focus
  navigation and cannot accidentally change the playing track.
- Expanded artist discographies show album artwork beside every album heading.
  Three Up or Down presses within 1.2 seconds jump to the top or bottom.
- A three-minute drifting-art idle visual provides burn-in protection while
  Vega suppresses its system screensaver.
- Temporary audio diagnostics are disabled in the release UI.

## TV library polish

- Home library destinations are large 340×210 cards again. Movies and TV Shows
  use six-poster collages from recent server items; Music uses a randomized
  sample of album covers. Labels sit on a dark scrim and focus retains the
  bright Vega-safe outline.
- Series posters display the Jellyfin `UnplayedItemCount` in a red top-left
  square. Counts above 99 display as `99+`; zero displays no badge.

## Idle and burn-in protection

- Audio playback and paused video use Astra's three-minute drifting-art idle
  visuals.
- Album art and metadata now follow separate, continuous four-point paths
  lasting about one minute each. Both cover broad areas of the screen, return
  smoothly to their starting coordinates, and never fade or teleport between
  loops.
- The first physical remote press only dismisses the audio idle visual. A
  shared 600 ms gate consumes Vega's duplicate key phases, focusable Select,
  and Kepler Media Controls commands, preventing the wake press from pausing,
  skipping, seeking, opening, or navigating.
- A native Vega IDL Turbo Module now reports video user engagement for the
  entire time a movie or episode is paused. This keeps Vega's system idle
  experience from preempting Astra before its own paused-video visual appears.
- The engagement hint is released on resume and player unmount. It is not held
  while merely browsing Astra, so normal device sleep behavior remains intact.
- Vega documents engagement as a system-reviewed hint rather than an absolute
  guarantee.

## Validation

- The issue #9/#11/#12 build `20260822.3` passes ESLint, TypeScript checking,
  all 175 Jest tests across 22 suites, Vega manifest validation, and
  `IW3cmedia_2` ABI validation. The exact x86_64 VPKG was generated, installed
  with the data-preserving device upgrade command, and launched with its saved
  Jellyfin profile intact. The one-hour A/V-sync run, three-direction repeat
  seek, and saved-position resume passed on that exact package.

- Astra 1.1.1 local validation passed ESLint, TypeScript checking, and all 158
  Jest tests across 19 suites.
- Release build generated the 1.1.1 JS/Hermes bundle, validated `manifest.toml`
  and ABI compatibility, and created the x86_64 VPKG. The build targets
  x86_64 because the existing `@astra/user-engagement` release artifact is
  x86_64 and prior Amazon submissions used that target. No native C++ code was
  changed.

- Astra 1.1.0 build `2026072904` passed lint, TypeScript checking, all 158 tests
  across 19 suites, Vega manifest validation, and ABI validation. It was
  installed and launched on physical x86_64 hardware.
- Device acceptance confirmed the release is operating correctly, including
  plain-HTTP music playback, seeking, background playback, Play/Pause,
  sequential advancement, music-to-video handoff, and the simplified controls.

## Release status

Astra `1.1.2` build `20260822.4` is the submitted release. ESLint, TypeScript,
all 175 Jest tests across 22 suites, manifest validation, and `IW3cmedia_2` ABI
validation passed. Build `.2` established that the long-run drift occurred
despite continuous future buffering and bounded server A/V timestamps. Build
`.3` retained that video, container, resume, and buffering policy while changing
only HEVC/MPEG-TS audio to AC3 on capable devices; it passed one-hour sync,
repeat-seek, and saved-position resume acceptance. Build `.4` changes only the
display build identity and static release text from the accepted `.3` playback
implementation.

Amazon submission packets, artifact paths and checksums, console checklists,
and deployment records are maintained locally rather than in public project
documentation. Playlist artwork composition remains optional future polish;
missing server artwork currently uses a letter placeholder.
