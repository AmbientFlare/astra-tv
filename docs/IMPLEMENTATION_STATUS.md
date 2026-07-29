# Implementation Status

Last updated: 2026-07-28

## Audio edition

- Music browsing, queueing, remote controls, and progressive HTTPS playback are
  implemented.
- Cleartext HTTP audio now selects an AAC/TS HLS URL and loads it through
  ShakaPlayer. HTTPS servers retain progressive direct play.
- URL regression coverage verifies that the HLS request excludes source
  containers such as MP3, because advertising them makes Jellyfin silently
  direct-play the source instead of returning an HLS manifest.
- Full now-playing and queue UI is implemented with play-now and remove actions.
- Track rows are single-focus controls again. D-pad Left/Right is reserved for
  focus navigation and no longer changes tracks globally.
- Holding D-pad Left or Right for two seconds skips exactly one track backward
  or forward. Releasing sooner performs only normal focus navigation.
- Holding Select on a focused song for two seconds inserts it next and shows a
  temporary `QUEUED NEXT` confirmation; short Select still plays immediately.
- Menu on a focused album, artist, or playlist track opens an isolated action
  panel with Play now, Play next, Add to end of queue, and View current queue.
  The focused row has a green underline, and no queue action is executed merely
  by navigating.
- Expanded artist discographies show album artwork beside every album heading.
  Three Up or Down presses within 1.2 seconds jump to the top or bottom.
- The full queue can be cleared without interrupting the current song and can
  be saved as a named Jellyfin playlist from the TV keyboard.
- A three-minute drifting-art idle visual provides burn-in protection while
  Vega suppresses its system screensaver.
- Temporary audio diagnostics are disabled in the release UI.

## TV library polish

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
  guarantee; physical-device confirmation is still required.

## Validation

- Build `2026072902` passed lint, TypeScript checking, all 164 tests across 21 suites, Vega manifest validation, and ABI validation.
- Build `2026072902` was installed and launched on Vega device `GT533M0752050H4U`.
- Live-device confirmation is still needed for the two-second remote holds and saving a queue against the user's Jellyfin server.

- Automated tests: 164 passing across 21 suites.
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
- Vega x86_64 build 1.1.0 (2026072801), including whole-composition audio idle
  motion, wake-only first input, and visible per-track queue actions, passed
  lint, TypeScript, 158 tests, manifest validation, and ABI validation. It was
  installed and launched successfully on device `GT533M0752050H4U`.
- Vega x86_64 build 1.1.0 (2026072802) separates cover and metadata motion into
  independent minute-long continuous paths and removes artwork fading. It
  passed the same validation suite and was installed and launched successfully
  on device `GT533M0752050H4U`.
- Vega x86_64 build 1.1.0 (2026072901) contains the focused-track modal,
  navigation-safe queue controls, expanded-discography artwork, and accelerated
  jumps. It passed lint, TypeScript, 159 tests, manifest validation, and ABI
  validation, then installed and launched successfully on device
  `GT533M0752050H4U`.

## Remaining verification

- Device-test the full now-playing screen, queue actions, idle visual, and
  series badges when convenient.
- Confirm every physical remote input dismisses the audio idle visual without
  also performing its normal action; the second press should act normally.
- Confirm Menu opens the focused-track modal without changing playback, each
  modal queue action affects only that track, and View current queue navigates
  to the full queue.
- Confirm triple Up/Down jumps and expanded album artwork on a long artist
  discography.
- Confirm that Vega's system screensaver does not replace Astra while video is
  paused, including before and after Astra's three-minute visual appears.
- Playlist entries without server artwork still use a letter placeholder;
  composite artwork remains optional polish.
- Astra reappeared in Apps & Channels after a later full package install, so
  the launcher-visibility issue is currently considered resolved.
