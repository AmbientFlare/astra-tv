# Implementation Status

Last updated: 2026-08-29

## Issue #15: subtitle selection and timeline repair — implementation complete

- [x] PlaybackInfo now resolves subtitle policy from Jellyfin's server default,
      Astra's preferred subtitle language, forced-track metadata, and explicit
      manual selections. An explicit overlay Off survives subsequent audio and
      quality reloads.
- [x] The final source-pinned PlaybackInfo request carries the resolved subtitle
      index and requests burn-in only for unsupported bitmap/styled selections.
      Text tracks remain Astra-rendered; PGS/ASS/SSA retain the existing rebuild,
      resume, and server burn-in path.
- [x] Stream metadata and PlayerScreen state use the same resolved subtitle
      index before playback reporting and external VTT loading begin.
- [x] Text tracks use Jellyfin's canonical `Stream.vtt` endpoint with
      `startPositionTicks=0`, keeping cue timestamps on the title's absolute
      timeline across a nonzero resume.
- [x] Added pure selection coverage for every user mode, preference fallback,
      server defaults, forced tracks, no tracks, and explicit Off. PlaybackInfo
      tests cover source-pinned selection, PGS burn-in, Off persistence, and VTT
      delivery after a nine-minute reload.
- [x] ESLint, TypeScript, and the full Jest suite pass: 291 tests across 34
      suites.
- [x] Built the non-release Astra `1.1.2` / `20260829.1` x86_64 package with
      Vega package build number `2026082901`; manifest and ABI validation passed.
- [x] Installed the VPKG in place on the connected Fire TV Stick,
      preserving application data; `com.astra.tv.main` is
      installed and running after launch.
- [ ] Scene-specific physical checks (Default/Always On SRT overlay, the
      nine-minute cue and resume, manual Off after an audio/quality reload, PGS
      burn-in, and ordinary audio switching) require interactive playback against
      the signed-in Jellyfin library. The available Vega CLI has no UI/input or
      screen-capture command. A read-only process inspection attempt failed with
      `vega device ... run-cmd --command 'ps -ef | grep com.astra.tv | grep -v grep'`
      reporting `Vega operation FAILED ... Incomplete`; no retry variation was
      attempted. PR #14 remains unmerged.
- [ ] On 2026-08-29, physical playback of _Central Intelligence_ was blocked
      before subtitle rendering: Jellyfin returned no HLS segment because its
      FFmpeg process exited with code 187 at CUDA initialisation
      (`CUDA_ERROR_NO_DEVICE`). The GPU host still sees the RTX 2060 SUPER, while
      `docker exec jellyfin nvidia-smi -L` returns `Failed to initialize NVML:
Unknown Error`; the container retains a GPU DeviceRequest. No server
      configuration change was made during this subtitle-repair validation.
- [x] The GPU VM was rebooted by the operator. After the reboot, both the host
      and the running Jellyfin container again report the RTX 2060 SUPER through
      `nvidia-smi -L`; retry the title from a fresh Astra playback session.
- [x] Device tombstones from 2026-08-29 show Astra exiting to Fire TV Home with
      `SIGQUIT` in the Shaka player path while changing subtitles. Text SRT/VTT
      changes now update Astra's overlay and playback report in place; no native
      player teardown occurs. The established reload/resume path is retained only
      when a bitmap/styled burn-in track is entered or removed.
- [x] Validated the crash fix with scoped ESLint, TypeScript, and the full Jest
      suite (292 tests across 34 suites). Rebuilt and installed the x86_64 test
      package in place on the test stick; its SHA-256 is
      `89c5c6a1b63ad1c73a4fdca3032e384cd3137b8a48e1efecdb7c0b689c5a65d9`.
      Astra was launched successfully as `com.astra.tv.main`.
- [ ] Follow-up PGS transition diagnosis: both the surface rebuild and
      same-player replacement reproduced the failure. The device ACR identifies
      it as `AppNotResponding` on `JSReactThread`, not a native crash. Jellyfin's
      PGS transcode selected 4K HEVC MPEG-TS HLS; Shaka's synchronous JS path is
      blocked while parsing/transmuxing it, so the Fire TV watchdog terminates
      Astra. The targeted repair keeps the proven full reload lifecycle but asks
      Jellyfin for H.264 fMP4 HLS only for burned-in subtitle sessions.
- [x] Built and installed the ANR-targeted x86_64 package in place on the
      test stick, then launched Astra successfully. SHA-256:
      `3e12a9242e59d7206ed97f01f0a03ad4a51b8dc69f22aba58558c9e59ab0e2a3`.
- [x] Follow-up package adds explicit dynamic-HLS query overrides because the
      prior profile-only request was ignored by Jellyfin (server evidence still
      showed `hevc_nvenc` and MPEG-TS). It also holds the external-subtitle clock
      at a requested seek position until the media element reaches it. Full
      validation passes (293 tests across 34 suites); the package is installed and
      running on the stick with SHA-256
      `060468518ef62746e19507ff1c2e7bf478cb7b9b36a2506b761acb1b8e63eabe`.
- [x] A malformed-playback-URL startup failure in that package was traced to
      duplicate query parameter names that differed only by letter casing. The
      burn-in override now replaces any existing Jellyfin spelling case-insensitively
      before setting its H.264/fMP4 values; a regression test pins that invariant.
      The corrected `1.1.2` / `20260829.1` x86_64 package was rebuilt, installed,
      and launched on the stick. SHA-256:
      `efc5626f88d64ea01d62ae370041972e33253ad374f8576066abbac4a6654002`.
      The physical PGS playback test remains pending.
- [x] A second identical local URL-validation failure showed the previous
      defensive check was rejecting arbitrary duplicate Jellyfin query keys, not
      just the three burn-in overrides. Stream URLs now normalize every duplicate
      key case-insensitively (preserving Jellyfin's last value) before video load,
      and the startup-blocking diagnostic is removed. The corrective package was
      installed only after explicitly terminating the already-running process, and
      then launched successfully. SHA-256:
      `3208140d1c8de97a6b0211a736d784ae5840ee12b7b3d448db935932492b546a`.
- [x] The first playlist request from that package reached Jellyfin but was
      challenged with `Invalid token`, producing Shaka stream-engine error 1001
      before FFmpeg began. The URL normalizer retained a stale server-supplied
      `api_key`; the builder now forcibly replaces every casing of that parameter
      with Astra's active signed-in token. The corrected package was force-stopped,
      installed, and launched on the stick. SHA-256:
      `55f0ad91fb962e08a95e52d92215c9381b4a1ccb50b3615188dab48e8b85a4b7`.
- [x] At the operator's request, the Fire TV package was restored to the last
      known playable subtitle behavior: text subtitle changes stay in-place,
      bitmap/styled changes use the pre-existing reload path, and the later
      forced-delivery, URL-normalization, token-replacement, and seek-clock
  experiments are removed. See `docs/CLOSED_CAPTION_NOTES.md` for the full
  handoff and the known remaining bitmap-transition and seek-sync failures.
  The restored package was force-stopped, installed, and launched on the stick.
  SHA-256: `509be59a316928ef7a61305f7817c01aaf1ea92b23bfe2e43cd119194476d0e5`.

## Optional Nebula Bridge integration and Jellyfin Versions — complete

- [x] Preserved Astra's standard Jellyfin data path: seasons still come from
      `/Shows/{seriesId}/Seasons`, episodes from `/Shows/{seriesId}/Episodes`, and playback from
      `/Items/{itemId}/PlaybackInfo`.
- [x] Added a short, failure-isolated probe for Nebula Bridge capability API version 1 when a
      server profile becomes active. Missing endpoints, timeouts, unsupported revisions, and
      failures leave Astra behaving as an ordinary Jellyfin client.
- [x] Added non-blocking hierarchy prefetch on Series/Season TV focus, with ten-minute client
      deduplication. Detail screens use the optional hydration request as an open-time second
      chance and then retrieve children through the normal Jellyfin endpoints.
- [x] Kept provider knowledge out of Astra. The integration handles only Jellyfin item IDs,
      capability flags, hierarchy hydration, and standard PlaybackInfo MediaSources.
- [x] Implemented a Versions menu for movies and episodes whenever fresh PlaybackInfo contains
      more than one distinct source ID. Labels use standard source name, resolution, container,
      bitrate, and size fields.
- [x] Fixed playback to select the requested `MediaSourceId` instead of always consuming array
      index zero. Audio selection and subsequent playback requests stay pinned to the same source.
- [x] PlaybackInfo used to populate the Versions menu sets `AutoOpenLiveStream: false`; merely
      showing the menu does not open a provider stream.

### Nebula/Versions verification

- TypeScript typecheck and ESLint pass.
- Full Jest suite: 280 passing tests across 33 suites.
- Regression coverage includes absent/unsupported Nebula capability APIs, rapid-request
  deduplication, complete MediaSource discovery, and selecting a non-default source.

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
