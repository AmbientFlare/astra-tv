# Implementation Status

Last updated: 2026-07-29

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
  guarantee; physical-device confirmation is still required.

## Validation

- Build `2026072904` passed lint, TypeScript checking, all 158 tests across 19
  suites, Vega manifest validation, and ABI validation. It was installed and
  launched on device `GT533M0752050H4U`.
- Build `2026072903` passed lint, TypeScript checking, all 158 tests across 19
  suites, Vega manifest validation, and ABI validation. It was installed and
  launched on device `GT533M0752050H4U`.
- Build `2026072902` passed lint, TypeScript checking, all 164 tests across 21
  suites, Vega manifest validation, and ABI validation, then was installed and
  launched on device `GT533M0752050H4U`.
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

- Device-test the simplified now-playing controls, idle visual, and series
  badges when convenient.
- Confirm every physical remote input dismisses the audio idle visual without
  also performing its normal action; the second press should act normally.
- Confirm Left/Right changes tracks on Now Playing but remains normal focus
  navigation on album, artist, playlist, and general browsing screens.
- Confirm triple Up/Down jumps and expanded album artwork on a long artist
  discography.
- Confirm that Vega's system screensaver does not replace Astra while video is
  paused, including before and after Astra's three-minute visual appears.
- Playlist entries without server artwork still use a letter placeholder;
  composite artwork remains optional polish.
- Astra reappeared in Apps & Channels after a later full package install, so
  the launcher-visibility issue is currently considered resolved.
