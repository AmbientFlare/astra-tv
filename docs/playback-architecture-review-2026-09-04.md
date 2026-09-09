# Playback architecture review — 2026-09-04

Scope: video playback negotiation, Jellyfin identity and reports, HLS/Shaka
integration, native buffer operations, timelines, lifecycle, subtitles, and
existing validation. Reviewed commit `b9125b8` (1.2.1), with v1.2.0 comparison
for issue #17. This is a diagnosis and implementation direction, not a fix or
an exhaustive security/UI/music audit. No runtime code changed.

## Assessment

The recurring defects have a shared architectural cause: there is no single
owner of playback session lifetime, timeline, negotiated delivery, and recovery.
These responsibilities are distributed between PlayerScreen refs/callbacks,
Jellyfin request construction, a response-filter playlist transform, and
process-global native buffer hooks. Some platform workarounds are justified by
hardware results; some app-side adaptations break contracts that Shaka relies on.
Changing another codec preference cannot correct those lifecycle/error defects.

Vega's W3C/MSE playback approach is supported by Amazon; using Shaka and HLS is
not itself evidence of a wrong architecture. The adapter around them needs to
preserve their contracts and make Jellyfin's timeline explicit.

## Confirmed findings

### High: native synchronous buffer failures are hidden from Shaka

`src/w3cmedia/bufferOperationTracker.ts:35` logs and consumes a rejected
operation. `:89` catches exceptions from the native action and converts them
into that rejection. `ShakaPlayer.ts:100` wraps `appendBuffer` with this void
method, so a synchronous native exception no longer reaches the caller.

Shaka 4.8.5 catches exceptions from starting a buffer operation, recognizes
`QuotaExceededError`, rejects the queued operation, and advances its queue.
That handling is present in Astra's actual compiled Shaka bundle. Suppressing
the exception bypasses this mechanism. If no append began, no `updateend` need
arrive, leaving Shaka waiting even though Astra's tracker considers the failed
operation finished. The assumption in the comment that an error event also
arrives does not cover synchronous exceptions.

A local probe against the actual TypeScript helper confirmed that a synthetic
`QuotaExceededError` returns normally to the caller and tracker completion
resolves. This is a concrete route to an unexplained permanent buffer stall;
whether the reporter's device encountered that exception remains unknown.

### High: asynchronous Shaka errors are not connected to Astra recovery

`ShakaPlayer.ts:422` creates the Shaka instance but does not register a player
`error` listener or custom streaming failure callback. PlayerScreen catches
load rejection and listens to the native video `error` event (`:1301`). These
are different error channels. A segment/network/parser error after a successful
load can therefore fail at the Shaka layer without increasing Astra's native
error counter or invoking its recovery. Shaka's configured request retries
still run; the missing part is app handling after those mechanisms fail.

Combine this with `waiting`/`stalled` handlers that only update UI (`:1270`),
and the issue's zero-errors display cannot rule out a stream-engine failure.

### High: session cancellation and cleanup are incomplete

Startup awaits `loadStream` (`PlayerScreen:2116`) and then loads/plays a
captured video without checking whether the screen/session still exists.
Back during PlaybackInfo can clear and deinitialize that video; when the
request finishes, `loadStream` republishes stream refs (`:1439`) and startup
continues against the released element. Event-generation checks do not cancel
asynchronous continuations.

Recovery (`:1724`) has no shared operation guard with track/jump reloads and
reuses the existing native video/generation. Track/jump reloads deliberately
create fresh native players. Late events and overlapping requests can therefore
refer to different sources while appearing to belong to the current session.

The helper `src/w3cmedia/playerLifecycle.ts:57` prevents duplicate unload calls
on a ref but does not serialize callers: it clears the ref before awaiting
cleanup, so a second caller returns while cleanup is still pending. A local
probe reproduced this. Its comment promises stronger ordering than it provides.

### High: all installations share a Jellyfin device identity

`src/services/jellyfin/index.ts:313` hardcodes `DeviceId="astra-device-001"`.
Two Astra installations on the same server therefore claim the same device.
Jellyfin 10.11.11 keys active sessions by client name plus device ID; current
server source also includes user identity, which still collides for the same
user on two TVs. This can mix active playback/session state across devices.
It does not require a Vega playback defect. A persistent per-installation ID is
required; changing it on every launch would create a different problem.

### Medium/high: network reporting owns native resource lifetime

Unmount and surface destruction wait for the stopped report before unloading
Shaka/deinitializing video (`PlayerScreen:1898`, `:2166`). `getJson` defaults to
a 45-second timeout (`jellyfin/index.ts:815`). A server outage can thus keep
native resources alive during navigation. Next-episode handoff also awaits the
report before pausing/releasing (`PlayerScreen:873`).

Background handling (`:1935`) pauses and reports; it does not explicitly release
resources or return to details. Surface destruction might later release them,
but that is not an explicit background lifecycle guarantee. Amazon's current
VOD requirements call for releasing resources and preserving resume context.

`ShakaPlayer.unloadInternal` additionally waits for append completion before
detaching (`:764`); the tracker has no deadline when `updating` stays true and
terminal events never arrive. This is a conditional native-event failure risk,
not a reproduced missing-event defect in Vega.

### Medium: subtitle burn-in permanently latches forced video conversion

Selecting subtitles raises `selectedForceTranscode` (`PlayerScreen:1570`);
resolved subtitle streams also raise it (`:1474`). Selecting Off clears the
burn-in flag but leaves forced conversion true (`:1559`). The subtitle UI
never passes `forceTranscode:false`. Consequently, turning subtitles on and
then off continues to disallow video copy for that screen's subsequent reloads.

The same boolean represents both subtitle requirements and decoder-recovery
requirements. It should be derived from separate reasons, so removing a
subtitle does not erase a real decoder restriction or retain an obsolete one.
All-subtitle burn-in is itself an intentional compatibility tradeoff, with
server processing cost; it should not be confused with this unintended latch.

### Medium: timeline ownership remains inconsistent

The earlier issue review confirmed that logical item position is divided by
native shortened-stream duration for the progress bar (`PlayerScreen:2203`).
Chapter filtering uses that same native duration (`:755`); later real chapters
can be discarded after resume. Native `ended` is accepted without checking
logical position against item runtime (`:1309`). These behaviors affect progress,
navigation, and premature-next-episode handling, independently of the first stall.

Playlist trimming computes the actual discarded duration, but that value is
only logged. The player anchors its first `playing` event to the requested
resume position. Segment alignment and elapsed startup time can produce a
smaller position discrepancy. This is a precision concern; it does not by itself
explain half an episode disappearing.

### Medium: diagnostics can encourage incorrect conclusions

`describeDelivery` (`jellyfin/index.ts:250`) infers copy/transcode and codec
from source metadata and requested URL codec choices. These are predictions,
not inspection of decoded media. `audioTranscodePolicy` always reports profile
zero (`:1557`), even for the H.264 route whose policy differs. Native errors
exclude Shaka errors, as above. Source dimensions are used as a fallback where
actual decoded dimensions are unavailable. Diagnostic fields should distinguish
requested, server-reported, inferred, and observed values.

## Compatibility work to preserve and validate

| Route | Current treatment | Evidence and remaining limitation |
|---|---|---|
| HEVC HLS | MPEG-TS, segments mode; AC3 where supported | Repository records one-hour sync and seek/resume acceptance. Preserve this baseline. |
| H.264/fMP4 from zero | Segments mode | Existing route; a mid-file sequence-mode fix does not validate all long playback failures. |
| fMP4 resumed/reloaded above zero | Sequence mode | 1.2.1 fixes a reproduced timestamp/playhead mismatch. Long subtitled A/V sync is still listed as unverified in the implementation status. |
| Subtitles | Server burn-in | Device-tested compatibility choice, but can require video conversion and creates a new stream when changed. |

The HLS trimmer also assumes one successfully trimmed media playlist. Multiple
renditions, refreshed playlists, and discontinuity/key/map state are not covered
by its simple prefix-removal model. Current single-stream virtual VOD and disabled
ABR reduce exposure. Treat this as an explicit supported-input boundary to test,
not an established cause of ordinary Jellyfin playback failure.

The process-global SourceBuffer hook likewise assumes serialized player
ownership. Correct session serialization comes before attempting concurrent
audio/video players or prebuffering with this implementation.

## Recommended implementation sequence

1. Restore buffer exception semantics and connect Shaka errors to structured
   diagnostics/recovery. Reproduce a thrown append, failed segment, exhausted
   retry, and a missing terminal native event. A watchdog must distinguish
   starvation, timestamp gaps, pause, seek, and decoder failure.
2. Introduce one playback-session controller used by startup, track change,
   jump, recovery, exit, and background. It owns a cancellation token, one
   ordered transition queue, native resources, and a shared cleanup promise.
   Native release must not wait for Jellyfin telemetry. A new session cannot
   attach while the previous native lifetime is unresolved.
3. Give that session one explicit mapping between item time and media time.
   Item duration drives UI/chapters/completion; actual retained playlist start
   drives resume mapping. Classify early EOF before triggering autoplay.
4. Produce an immutable playback plan from user intent, capabilities, source
   selection, and distinct conversion reasons. Include source ID, tracks,
   container, expected codecs, timestamp mode, and reporting identity. Validate
   server output against it before declaring the session ready.
5. Assign stable installation identity and order/coalesce reports per session.
   A late progress request must not supersede a stopped session; a failed report
   must not turn successful playback into a startup failure.
6. Validate the existing accepted routes plus failure transitions on hardware:
   long play, resume, seek, subtitles on/off, background/foreground, exit during
   load, server interruption, early EOF, and two TVs on one account. Use a
   controlled source corpus and capture manifests, native ranges, actual server
   codec output, and matching session IDs.

This is a focused playback-core refactor. The evidence does not justify
replacing the whole application, forcing one expensive codec for all content,
or assuming another JS player would remove native Vega constraints. A different
player can be evaluated later with the same corpus and adapter contracts.

## Validation and evidence limits

- All 374 tests in 41 Jest suites and the existing snapshot passed.
- TypeScript and ESLint passed. The Shaka wrapper itself uses `@ts-nocheck`.
- Local fault probes reproduced swallowed synchronous buffer exceptions and
  the missing shared unload barrier. These are helper-level reproductions,
  not device playback reproductions or proof of issue #17's initiating event.
- No deployment, device/server mutation, GitHub comment, or runtime fix made.
- Context7 supplied Shaka error documentation, the Amazon video sample, and
  Jellyfin device-identity documentation. Source inspection checked the actual
  bundled Shaka catch behavior and Jellyfin 10.11.11/current session keys.

## External sources

- [Amazon W3C/MSE playback architecture](https://developer.amazon.com/docs/vega/0.22/media-player.html)
- [Amazon Vega 0.24 Shaka integration and sequence mode](https://developer.amazon.com/docs/vega/0.24/media-player-shaka-player.html)
- [Amazon Vega 0.24 background resource requirements](https://developer.amazon.com/docs/vega/0.24/media-player-requirements.html)
- [Shaka error handling](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/errors.md)
- [Shaka 4.8.5 buffer queue exception handling](https://github.com/shaka-project/shaka-player/blob/v4.8.5/lib/media/media_source_engine.js#L1623)
- [Jellyfin 10.11.11 session identity](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Emby.Server.Implementations/Session/SessionManager.cs#L486)
- [Current Jellyfin session implementation](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/Session/SessionManager.cs)
- [Jellyfin TypeScript device information](https://github.com/jellyfin/jellyfin-sdk-typescript/blob/master/_autodocs/06-types-models.md)
