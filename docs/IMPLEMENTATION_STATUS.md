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
  guarantee.

## Validation

- Build `2026072904` passed lint, TypeScript checking, all 158 tests across 19
  suites, Vega manifest validation, and ABI validation. It was installed and
  launched on device `GT533M0752050H4U`.
- Device acceptance confirmed the release is operating correctly, including
  plain-HTTP music playback, seeking, background playback, Play/Pause,
  sequential advancement, music-to-video handoff, and the simplified controls.
- The release artifact is
  `dist/amazon-submission-1.1.0-20260729/astra-1.1.0-x86_64-release.vpkg`.

## Release status

Astra `1.1.0` build `2026072904` is ready for Amazon Appstore submission.
Playlist artwork composition remains optional future polish; missing server
artwork currently uses a letter placeholder.
