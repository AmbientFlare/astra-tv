# Astra 1.2.0 release candidate

Version 1.2.0 restores playback on Fire TV devices that have taken the Vega
OS 1.2 update, and moves the project onto the Vega SDK 0.24 toolchain.

It takes a minor rather than a patch version because the failures it addresses
were not cosmetic: resume, audio track switching and burned-in subtitles all
exited to Home for any user whose device had updated.

## Cause

Vega OS 1.2 reached devices automatically during August 2026. Nothing in Astra
changed, and the previously accepted `20260822.4` release reproduces every
failure on an updated device, so the regression is environmental.

Two separate causes were confirmed on hardware:

1. **The native logging bridge blocks the JS thread.** A symbolicated ANR
   showed the thread parked inside `@react-native/js-polyfills/console.js`,
   reached from Amazon's `keplermediadescriptor` by way of
   `react-native-w3cmedia` during a Shaka segment append, with CPU pressure at
   zero — blocked rather than busy. The Fire TV thread monitor then killed the
   app. Resume, audio switching and burn-in are the highest log-volume paths.
2. **The HLS resume trim rebuilt the playlist character by character.**
   Jellyfin media playlists for a feature run 1.4–2.2 MB. The response filter
   re-encoded the trimmed playlist with
   `new Uint8Array(Array.from(playlist).map((c) => c.charCodeAt(0)))`,
   allocating two 1.3–1.8 M-element JS arrays per load. That measured 5,008 ms
   of synchronous work on device, inside a total `player.load()` of 7,960 ms.

## Fixes

- Replaces `console.log`, `console.info` and `console.warn` in Release builds
  with a bounded ring buffer, cutting the blocking path for every caller
  including Shaka and Amazon's own libraries. `console.error` stays connected.
  The shim installs from a side-effect module imported first in `index.js`,
  because import declarations are hoisted and a plain call would run after
  every other module had already been evaluated and logged.
- Rebuilds the trimmed HLS playlist by copying the untouched suffix with
  `Uint8Array.set` — a native copy — instead of rebuilding it character by
  character. `trimHlsMediaPlaylistForResume` now reports the rewritten header,
  the first retained line and whether the suffix is copyable; CRLF sources fall
  back to the previous path because the trim normalises their line endings.
- Declares `[os.version] min = "1.2"`, `target = "1.2"` and the matching OS
  module entry. Vega SDK 0.24 refuses to build without this, and the Appstore
  gates submission and installation on it.
- Updates the Amazon device libraries to the SDK 0.24 pins for the React
  Native 0.72 line: `react-native-w3cmedia` `~2.3.2`, `react-native-kepler`
  `~2.1.0+rn0.72.0`, `kepler-media-controls` `~1.0.25`,
  `keplerscript-netmgr-lib` `~2.0.20`. React and React Native are unchanged at
  18.2.0 and 0.72.0, so this carries no framework migration.
- Adds an optional "Stats for Nerds with logs" view showing playback timings
  for manifest handling and load duration, in Settings > Playback and in the
  in-player Diagnostics column. Off by default and independent of Stats for
  Nerds. Vega exposes no JS console output to any log artifact `vega device
  copy-logs` can retrieve, so this is the only on-device playback diagnostic.
- Shows a one-time developer notice acknowledging the disruption, dismissed
  with a single OK and recorded per user by notice id.

## Measured on device

| Path | Before | After |
|---|---|---|
| Manifest re-encode, initial load | 5008 ms | 8 ms |
| `player.load()`, initial load | 7960 ms | 2800 ms |
| `player.load()`, audio switch | 3725 ms | 2581 ms |
| `player.load()`, burn-in switch | 4237 ms | 2780 ms |
| Five-minute seek | about a minute | seconds |
| Ten-second D-pad seek | noticeably delayed | near-instant |

## Release metadata

- Version: `1.2.0`
- Build: `20260829.12`
- Build date: `2026-08-29`
- Built against Vega SDK `0.24.9914`

## Acceptance

- Resume from a saved position, audio track switching and burned-in subtitle
  selection were each confirmed working on a physical Fire TV Stick running
  OS 1.2 (`OsBuildNumber 2101020054720`), all three having failed before.
- The previously accepted `20260822.4` package was installed unmodified on the
  same device and reproduced the resume failure, isolating the cause to the OS
  update rather than to any change in this project.
- Roughly 45 minutes of uninterrupted playback showed no audio/video drift.
- Switching a text subtitle track on and off during playback reloads and
  resumes promptly.
- ESLint, TypeScript and 208 Jest tests across 27 suites passed, along with
  Vega manifest and ABI validation.

## Known limitations, carried forward

- A double-arrow chapter jump still takes roughly 38 seconds to resume
  playback. This predates the OS update: a ten-minute jump measured 36 seconds
  on `20260813.7`, where the device trace showed Astra applying the seek in
  1 ms and Vega emitting `seeked` about 35 seconds later. It is below the JS
  thread and unaffected by this release's fixes.
- Subtitles rendered by the app can drift out of sync after a long seek that
  requires buffering. The seek-clock correction that targeted this was removed
  during an earlier rollback and has not been reinstated.
- Server discovery scans port 8096 only, so a Jellyfin instance on another port
  must be added by URL.

Both playback limitations are named in the in-app notice and are the intended
subject of the next patch.

## Deferred from this release

The subtitle selection restore, Nebula Bridge integration and dynamic virtual
libraries remain on `chore/regression-hardening`. None of that work has ever
shipped, so excluding it removes nothing users currently have.

## Build

```bash
npm run build:submission
```

Derives the version and Vega build number from `src/config/app.ts`. The older
`npm run build:release` is for device testing only: it leaves `build_number` at
0, which sideloads but fails Amazon validation.

## Amazon upload artifact

`dist/amazon-submission-1.2.0-20260829/astra-1.2.0-x86_64-release.vpkg`
