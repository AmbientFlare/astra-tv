# Implementation Status

Last updated: 2026-07-27

## Audio edition

- Music browsing, queueing, remote controls, and progressive HTTPS playback are
  implemented.
- Cleartext HTTP audio now selects an AAC/TS HLS URL and loads it through
  ShakaPlayer. HTTPS servers retain progressive direct play.
- URL regression coverage verifies that the HLS request excludes source
  containers such as MP3, because advertising them makes Jellyfin silently
  direct-play the source instead of returning an HLS manifest.
- Full now-playing and queue UI is implemented with play-now and remove actions.
- A three-minute drifting-art idle visual provides burn-in protection while
  Vega suppresses its system screensaver.
- Temporary audio diagnostics are disabled in the release UI.

## TV library polish

- Series posters display the Jellyfin `UnplayedItemCount` in a red top-left
  square. Counts above 99 display as `99+`; zero displays no badge.

## Idle and burn-in protection

- Audio playback and paused video use Astra's three-minute drifting-art idle
  visuals.
- A native Vega IDL Turbo Module now reports video user engagement for the
  entire time a movie or episode is paused. This keeps Vega's system idle
  experience from preempting Astra before its own paused-video visual appears.
- The engagement hint is released on resume and player unmount. It is not held
  while merely browsing Astra, so normal device sleep behavior remains intact.
- Vega documents engagement as a system-reviewed hint rather than an absolute
  guarantee; physical-device confirmation is still required.

## Validation

- Automated tests: 157 passing across 18 suites.
- Lint: passing.
- TypeScript (`tsc --noEmit`): passing. `reference/` is excluded because those
  separately cloned sample projects are not part of Astra's compilation.
- Vega x86_64 release build 1.0.4 (2026072703): passing.
- Build 2026072703 installed and launched successfully on device
  `GT533M0752050H4U`.
- Device confirmed cleartext HTTP HLS playback and FF/RW seeking.
- Build 2026072703 restores D-pad Left/Right track changes, makes the
  now-playing bar focusable for Select-to-pause/play, routes the dedicated
  Play/Pause event through status-backed state, and clears music when video
  playback starts. These control changes await device confirmation.
- Device confirmed D-pad track changes and the audio-to-video handoff. The
  dedicated Play/Pause button was then observed arriving over both KMC and
  D-pad: resume played and immediately paused again. Play/Pause is now
  exclusively KMC-owned in build 2026072704.
- Vega x86_64 release build 1.0.4 (2026072704) passed validation and was
  installed and launched on device `GT533M0752050H4U`.
- Vega x86_64 music-preview build 1.1.0 (2026072705) passed package validation,
  installed successfully, and launched on device `GT533M0752050H4U`.
- Vega x86_64 build 1.1.0 (2026072706), including the native User Engagement
  bridge, passed manifest and ABI validation, then installed and launched
  successfully on device `GT533M0752050H4U`.

## Remaining verification

- Device-test the full now-playing screen, queue actions, idle visual, and
  series badges when convenient.
- Confirm the idle visual dismisses on every physical remote input and does not
  interrupt audio.
- Confirm that Vega's system screensaver does not replace Astra while video is
  paused, including before and after Astra's three-minute visual appears.
- Playlist entries without server artwork still use a letter placeholder;
  composite artwork remains optional polish.
- Astra reappeared in Apps & Channels after a later full package install, so
  the launcher-visibility issue is currently considered resolved.
