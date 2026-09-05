# Astra 1.3.0 candidate — playback core

Based on the released 1.2.1 commit `b9125b8`. Candidate build `20260904.1`.
This document does not declare Appstore submission or physical acceptance.

## Changes

- Startup, track changes, chapter reloads and recovery share one cancellable
  session transaction. Cross-screen native transitions are serialized. Exiting
  invalidates pending requests before they can publish or play a late source.
- Native resource cleanup has one owner. It does not await Jellyfin reports;
  background VOD exits to the library after releasing resources. Failed native
  cleanup prevents another attachment within that screen.
- Native append/remove/abort remain synchronous, preserving the earlier Vega
  regression fix. Immediate exceptions now reach Shaka unchanged. Missing native
  operation events time out after 30 seconds and are reported as MSE failures.
- Shaka post-load errors are forwarded separately from native media errors.
  Diagnostics include sanitized source/code/category/severity, and codec
  predictions are explicitly labeled as inferred from the request.
- Lack of progress during active playback and premature EOF trigger bounded
  session recovery. Paused/loading sessions are excluded; network/watchdog
  failures retry the same delivery policy. Only classified media failures
  escalate audio/video conversion. There are at most two automatic recovery
  attempts before an explicit Retry screen.
- Full item runtime drives the progress bar, chapters and completion checks.
  The retained playlist start is returned to the screen for time mapping.
  Seeking backward outside the retained playlist reloads even for a short jump.
- Subtitle burn-in and decoder conversion restrictions are separate. Turning
  subtitles off removes the subtitle requirement without undoing a decoder
  restriction established by recovery.
- A persistent installation ID replaces the shared Jellyfin device ID. Saved
  server profiles/tokens are retained. Audio and video use the same installation
  identity; transient persistence failure can be retried without shared fallback.
- Jellyfin reports are ordered, intermediate progress is coalesced, and stopped
  sessions reject late progress. Reporting failures cannot fail successful
  playback. Failed sessions are marked as failed when reporting a stop.
- Music-to-video handoff invalidates late music work and releases the native
  audio player before video claims focus. Music subscribers remain attached.

## Compatibility baseline

The accepted HEVC/MPEG-TS/AC3 policy, H.264/fMP4 route, subtitle burn-in policy,
and mid-file fMP4 sequence-mode selection are preserved. No SDK, native ABI,
Shaka bundle, or dependency upgrade is included in this candidate.

## Validation

Automated tests cover native exceptions/missing events, actual Shaka-wrapper
error forwarding and cancellation, controller ordering, report failure/order,
installation identity persistence, and rendered PlayerScreen transitions.
The exact latest counts, package status and physical results are maintained in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

Required physical acceptance before publication:

1. One-hour A/V sync on both HEVC/MPEG-TS and subtitled fMP4 routes.
2. Start and resume H.264/fMP4 and HEVC/MPEG-TS titles; verify progress/chapter
   positions against Jellyfin runtime and the content actually shown.
3. Subtitle On/Off and audio switches, repeated short seeks, long jumps and
   backward jumps before the retained playlist boundary.
4. Server/network interruption, recovery at the right position and bounded
   failure messaging. Stats must show the relevant error source/code.
5. Exit during startup/recovery, Home/background/foreground, and music-to-video
   handoff without ghost audio, frozen UI, or a second native player.
6. Genuine episode ending, early EOF, credits skip, next-episode countdown and
   Back during countdown. Confirm saved resume and watched state server-side.
7. Two physical installations on one account must appear as separate devices.

Automated tests cannot establish native decoder sync, firmware behavior or
cross-device session isolation. Those checks remain release gates.
