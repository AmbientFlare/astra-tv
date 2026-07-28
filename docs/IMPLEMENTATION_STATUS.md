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

## Validation

- Automated tests: 154 passing.
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

## Remaining audio work

- Verify HTTP HLS playback, track changes, seeking, end-of-track advance, and
  background playback on the Vega device.
- Build the full now-playing screen and per-track queue actions.
- Add the in-app idle visual required to prevent burn-in during audio playback.
- Triage launcher visibility, playlist artwork, and eventual removal of the
  on-screen playback diagnostics.
