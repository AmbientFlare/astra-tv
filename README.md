# Astra

[![Latest release](https://img.shields.io/badge/release-1.4.0-c9a227?style=flat-square)](https://github.com/AmbientFlare/astra-tv/releases/latest)
[![Amazon Appstore](https://img.shields.io/badge/Amazon%20Appstore-download-232f3e?style=flat-square&logo=amazon)](https://www.amazon.com/gp/mas/dl/android?p=com.astra.tv)
[![Platform](https://img.shields.io/badge/platform-Fire%20TV%20%C2%B7%20Vega%20OS%201.2%2B-1f232d?style=flat-square)](https://developer.amazon.com/docs/vega/overview.html)
[![Backend](https://img.shields.io/badge/backend-Jellyfin-00a4dc?style=flat-square&logo=jellyfin&logoColor=white)](https://jellyfin.org)
[![Tests](https://img.shields.io/badge/tests-578%20in%2064%20suites-4c9a2a?style=flat-square)](#project-status)
[![License](https://img.shields.io/badge/license-source--available-8a8f9c?style=flat-square)](LICENSE.md)

Astra is a couch-first Jellyfin client for Amazon Fire TV devices running Vega
OS. It connects directly to a server supplied by the user and brings personal
movie, television, and music libraries into a remote-friendly TV interface.

Astra does not include a hosted catalog, subscription service, public channels,
or bundled media. It is an independent client and is not affiliated with
Jellyfin or Amazon.

Website and install instructions: <https://watchastra.com>

## Project status

The current release is Astra `1.4.0`, build `20260908.14`, for x86_64
Fire TV devices running Vega OS 1.2 or later. It is available from the Amazon
Appstore.

- Website: <https://watchastra.com> (screenshots, setup, and the
  [full release history](https://watchastra.com/releases/))
- Package ID: `com.astra.tv`
- Main component: `com.astra.tv.main`
- Supported backend: Jellyfin
- Supported server connections: local HTTP and remote HTTPS
- Minimum Vega OS: `1.2`, as required by Vega SDK 0.24. Devices on an earlier
  Vega OS stay on 1.1.2.
- Release validation: 578 tests in 64 suites, ESLint, TypeScript, Vega
  manifest, and Vega ABI. HDR picture quality, playback recovery, resume,
  track selection, library navigation and music browsing were accepted on the
  physical Fire TV Stick for 1.3.0. For 1.4.0, an uninterrupted 130-minute
  film was played start to finish on the same device to confirm the
  engagement fix.
- Future backends: Emby and Kodi are planned but are not supported today

## What Astra supports

### Movies and television

- Browse movie, series, season, and episode libraries.
- Continue watching and resume from saved playback positions.
- Search the connected Jellyfin server.
- View artwork, descriptions, ratings, genres, cast, chapters, and related
  metadata when supplied by Jellyfin.
- Select audio and subtitle tracks and inspect playback diagnostics.
- Render SRT/WebVTT subtitles in-app and request server burn-in for formats
  Vega cannot render reliably.
- Show unwatched episode badges on series posters, capped at `99+`.

### Music

- Browse artists, albums, genres, playlists, and large collections.
- Switch between remembered poster and list layouts and use an A–Z jump rail.
- Play songs, albums, shuffled albums, and existing Jellyfin playlists.
- Continue automatically through the album or playlist that supplied a song.
- Seek and use remote Play/Pause controls.
- Keep listening while browsing Astra or while Astra is backgrounded.
- Play from plain-HTTP Jellyfin LAN servers through automatic AAC/TS HLS
  delivery; HTTPS servers retain progressive direct play.

Music intentionally uses a simple, predictable playback model. Astra does not
currently expose an editable queue, per-track popup actions, or playlist
creation on Vega.

### TV interface and device behavior

- Large Movies, TV Shows, and Music cards use collages from server artwork.
- Multiple Jellyfin users and servers can be saved and switched from Home.
- Quick Connect, local server discovery, and password sign-in are supported.
- Moving in-app idle visuals protect against burn-in during music playback and
  paused video.
- Starting video cleanly stops music and transfers playback controls and
  metadata to the video player.

## Release history

Every release below is tagged in the repository as `vMAJOR.MINOR.PATCH` and
published with notes on the
[Releases page](https://github.com/AmbientFlare/astra-tv/releases). Customer
facing notes for the same releases are at
<https://watchastra.com/releases/>.

### 1.4.0 — Playback stability, subtitle rendering, and per-server capabilities — 2026-09-08

- Fixed a feature-length film being shut down partway through. The system
  lifecycle manager reclaimed Astra's media resources and took the foreground
  roughly an hour into an uninterrupted movie; one title died at 61 minutes,
  47% of the way in. The platform detects video playback on its own, but that
  detection is not durable over a two-hour runtime, so Astra now signals
  viewer engagement explicitly for as long as a video is open and unfinished.
  The hold covers pause as well, and is released once a video plays out so a
  finished end screen no longer keeps the device awake.
- Fixed subtitles forcing the server to re-encode the whole video. Astra asked
  for every subtitle to be burned into the picture, which also told the server
  it could not copy the video stream, so a file needing no conversion became a
  full transcode the moment captions were switched on. Astra draws text
  subtitles itself again; burn-in is reserved for picture-based and styled
  ASS/SSA tracks it cannot draw.
- Fixed subtitles in MP4 files (`mov_text`) always burning in, and made
  switching or disabling a subtitle track instant instead of reloading the
  video.
- Fixed streams the server returned in a form Astra could not play, seen with
  some MKV and AVI files, being asked for again properly instead of failing to
  start.
- Added per-server capability memory: Astra learns what each server can
  actually do and stops retrying what it has proved it cannot. First run asks
  two questions per server, with "I don't know" as a real answer, and playback
  corrects those answers on its own. Settings gains a page to see and override
  any of it.
- Added Instant / Reloads markers on every subtitle track, so on a release
  carrying twenty of them it is visible which ones switch without rebuilding
  the stream.
- Added a per-build "What's new" list shown once after an update.

### 1.3.0 — Playback core, HDR picture, and library speed — 2026-09-05

- Fixed HDR movies arriving as washed-out SDR. Astra used to ask the server
  for a tone-mapped SDR stream on every HDR source; it now asks for the HDR
  variant the device has been shown to accept, and the picture reaching the TV
  is the picture on the disc.
- Reworked playback around a single cancellable session, so videos that used
  to stall, stick on a spinner or quit partway through recover on their own.
  A video that ends early is treated as a failure, not as a finished video.
- Fixed resumed playback reporting the wrong position, and gave every
  installation its own Jellyfin device identity so two Fire TVs no longer
  collide in the server's session list.
- Library grids load roughly forty times faster, and backing out of a movie
  returns to the exact card you opened it from instead of the top of the grid.
- Added opt-in playback telemetry, off by default and inert unless an operator
  explicitly arms it at build time.

### 1.2.1 — Subtitle preference and Skip Credits / Next Episode — 2026-09-02

- Added a subtitle preference in Settings > Playback: leave each video's own
  default, turn subtitles all on, all off, or show only forced tracks.
  Applies before a video's stream is built, for movies and episodes alike.
- Added Skip Credits, sourced from Jellyfin media segments or a chapter
  named "Credits", with Ask / Auto-skip / Ignore in Settings > Playback.
- Added Next Episode with an optional autoplay countdown. Movies never
  auto-advance; unattended autoplay stops after three episodes in a row to
  confirm you're still watching.
- Fixed playback getting stuck on "Buffering" with nothing decoding when a
  video with burned-in subtitles resumed, jumped a long distance, or
  switched tracks partway through.

### 1.2.0 — Vega OS 1.2 playback repair — 2026-08-29

- Fixed resume from a saved position, audio track switching, and burned-in
  subtitle selection, all of which exited to Home on Vega OS 1.2. The cause was
  the platform, not the app: the previously published 1.1.2 package reproduces
  every failure on an updated device.
- Release builds no longer route logging through the native bridge, which was
  blocking the JS thread until the Fire TV thread monitor killed the app.
- The HLS resume trim copies the untouched playlist suffix instead of rebuilding
  it character by character, cutting 5 seconds of synchronous work per load.
  Stream load fell from about 8 seconds to 2.8, a five-minute seek from roughly
  a minute to seconds, and short D-pad skips are close to instant.
- Moved to Vega SDK 0.24, declared Vega OS 1.2 in the manifest, and updated the
  Amazon device libraries. React Native remains 0.72.
- Added an optional "Stats for Nerds with logs" view showing playback timings,
  off by default.

### 1.1.2 — HLS playback compatibility and diagnostics — 2026-08-22

- Playback settings offer optional four-, three-, and two-second Jellyfin HLS
  segments for intermittent MP4/MOV stutter. Auto remains the default.
- Stats for Nerds shows HLS segment settings, app/build identity, and playback
  waiting, stalled, and error counters, plus discontinuous buffered ranges.
- HEVC uses HLS/MPEG-TS segments to avoid fMP4 open-GOP timestamp collisions;
  when the device reports AC3 support, this route also requests AC3 audio to
  isolate Vega's accumulating AAC/TS drift. H.264/fMP4 retains its established
  container and audio policy.

### 1.1.1 — Playback stability hardening — 2026-08-04

- Fixed keyboard teardown races when leaving Search or Setup.
- Serialized Shaka MSE buffer operations with seeks and teardown.
- Added defensive timer snapshots and native-reference cleanup on Player and
  Library unmount.

### 1.1.0 — Music and living-room polish — 2026-07-29

- Added Jellyfin artist, album, genre, and playlist browsing.
- Added background music playback, seeking, remote controls, automatic track
  advancement, and a simplified Now Playing screen.
- Added plain-HTTP music compatibility using HLS without requiring users to
  configure TLS or a reverse proxy.
- Added moving burn-in protection for audio and paused video.
- Added unwatched series badges and large server-artwork collage cards.
- Fixed duplicate Vega remote events, Play/Pause double delivery, stale music
  metadata when starting video, and auto-capitalized server URL failures.

### 1.0.3 — User profiles and Jellyfin compatibility — 2026-07-21

- Added quick profile switching and multiple users per server.
- Grouped saved accounts by server in Settings.
- Fixed library loading for non-admin Jellyfin users by replacing the
  admin-only media-folders request with per-user views.
- Added current Jellyfin authorization headers for newer server releases.

### 1.0.2 — Setup, subtitles, and playback diagnostics — 2026-07-18

- Added Jellyfin Quick Connect, guided setup, and local server discovery.
- Added detailed playback diagnostics and runtime audio-capability probing.
- Added in-app SRT/WebVTT rendering and server burn-in negotiation for
  unsupported subtitle formats.
- Fixed audio/subtitle track switching, DTS-HD fallback, unnecessary 4K
  bitrate reduction, and several stream diagnostic errors.

### 1.0.1 — Release metadata and licensing — 2026-07-07

- Added the Astra Source-Available License and third-party notices.
- Corrected About-page release information, project links, and support links.
- Finalized the first Amazon update package metadata.

### 1.0.0 — Initial Amazon release — 2026-07-05

- Added Jellyfin server connection, saved profiles, movie and television
  browsing, search, detail pages, resume playback, watch-progress reporting,
  and Vega media playback with Jellyfin transcoding fallback.
- Established the remote-first Fire TV interface and Amazon submission assets.

The detailed engineering changelog is in [CHANGELOG.md](CHANGELOG.md), whose
topmost section always covers the current version. Every release above is
tagged in the repository as `vMAJOR.MINOR.PATCH`.

## Getting help

- **Setup, settings, and troubleshooting:** <https://watchastra.com/help/>
- **Report a problem or request a feature:**
  [open an issue](https://github.com/AmbientFlare/astra-tv/issues)

A playback report is far easier to act on with the following, and most reports
that get fixed quickly include them:

- The Astra version and build number, from Settings > About.
- The Jellyfin server version, and whether it transcodes on a graphics card.
- The container, video codec, audio codec, and resolution of the file.
- Whether the same file plays on another Jellyfin client, and on the same
  network or over the internet.
- Anything the Jellyfin server log says about the failed session.

Astra has no crash reporting that phones home, so a report is the only way a
problem on your hardware becomes visible.

## Development

Install the Vega SDK, then run:

```sh
npm install
npm run build:debug
```

Run the automated checks with:

```sh
npm run lint
npx tsc --noEmit
npm test -- --runInBand
```

Build the current release target with:

```sh
PATH=/path/to/vega/bin:$PATH npx react-native build-vega \
  --build-type Release --target x86_64 \
  --build-number 2026090201 --build-version 1.2.1
```

Install a VPKG on a Vega device with:

```sh
vega device install-app \
  --device <deviceId> --packagePath <packageFile>
vega device launch-app \
  --device <deviceId> --appName com.astra.tv.main
```

Never use `vega run-app` for an upgrade: it uninstalls the existing package and
deletes app data before installing. Build 1.2.1 passed physical acceptance and
its Amazon upload package is prepared.

## Documentation

- [Changelog](CHANGELOG.md)
- [Astra 1.2.1 release notes](docs/release-1.2.1.md)
- [Astra 1.2.0 release notes](docs/release-1.2.0.md)
- [Astra 1.1.2 release notes](docs/release-1.1.2.md)
- [Astra 1.1.1 release notes](docs/release-1.1.1.md)
- [Astra 1.1.0 release notes](docs/release-1.1.0.md)
- [Astra 1.0.2 release notes](docs/release-1.0.2.md)

Reusable engineering references:

- [Implementation status and playback findings](docs/IMPLEMENTATION_STATUS.md)
- [Vega audio and music playback](AUDIO-EDITION.md)
- [Music playback research](docs/music-support-notes.md)
- [Crash and ANR analysis](docs/crash-investigation-2026-08-13.md)
- [Emby compatibility analysis](docs/emby-support-notes.md)
- [Deferred engineering work](docs/deferred-work.md)
- [Jellyfin Android TV reference inventory](docs/reference-inventory.md)

Reference repositories are kept outside this project, on the development
machine only. They are for study and are not incorporated into this codebase.

## Acknowledgements

Astra is developed by AmbientFlare. Thanks to the people who have reported
problems, tested builds on their own hardware, and sent code.

- **[@brontodev](https://github.com/brontodev)** — Skip Credits and Next
  Episode ([#14](https://github.com/AmbientFlare/astra-tv/pull/14)). The
  Jellyfin media-segments client that Skip Credits runs on is his work, and
  the shape of the feature — a pure decision module separate from the player,
  credits sourced from the server's own `Outro` segments rather than guessed
  offsets — is the design his patch proposed.
- **[@eamcd](https://github.com/eamcd)**, **[@Jailbone](https://github.com/Jailbone)**
  and **[@stspivey421](https://github.com/stspivey421)** — detailed playback,
  subtitle and Live TV reports with server-side evidence, which is what made
  the 1.2.1 and 1.3.0 fixes possible.

## License

Astra is source-available under the Astra Source-Available License
(Reference-Only) v1.0. See [LICENSE.md](LICENSE.md) and
[NOTICES.md](NOTICES.md).
