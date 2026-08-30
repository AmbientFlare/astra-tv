# Astra

Astra is a couch-first Jellyfin client for Amazon Fire TV devices running Vega
OS. It connects directly to a server supplied by the user and brings personal
movie, television, and music libraries into a remote-friendly TV interface.

Astra does not include a hosted catalog, subscription service, public channels,
or bundled media. It is an independent client and is not affiliated with
Jellyfin or Amazon.

Website and install instructions: <https://watchastra.com>

## Project status

The current release is Astra `1.2.0`, build `20260829.12`, for x86_64
Fire TV devices running Vega OS 1.2 or later.

- Website: <https://watchastra.com> (screenshots, setup, and the
  [full release history](https://watchastra.com/releases/))
- Package ID: `com.astra.tv`
- Main component: `com.astra.tv.main`
- Supported backend: Jellyfin
- Supported server connections: local HTTP and remote HTTPS
- Minimum Vega OS: `1.2`, as required by Vega SDK 0.24. Devices on an earlier
  Vega OS stay on 1.1.2.
- Release validation: 208 tests, ESLint, TypeScript, Vega manifest, and Vega
  ABI; resume, audio switching, burned-in subtitles, and a 45-minute A/V sync
  soak passed on the physical Fire TV Stick for 1.2.0
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

The detailed engineering changelog is in [CHANGELOG.md](CHANGELOG.md). Release
notes for the current version are in
[docs/release-1.2.0.md](docs/release-1.2.0.md).

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
  --build-number 2026082912 --build-version 1.2.0
```

Install a VPKG on a Vega device with:

```sh
vega device install-app \
  --device <deviceId> --packagePath <packageFile>
vega device launch-app \
  --device <deviceId> --appName com.astra.tv.main
```

Never use `vega run-app` for an upgrade: it uninstalls the existing package and
deletes app data before installing. Build 1.2.0 passed physical acceptance and
its Amazon upload package is prepared.

## Documentation

- [Changelog](CHANGELOG.md)
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

Reference repositories are kept outside this project under
`~/projects/reference`. They are for study only and are not incorporated into
this codebase.

## License

Astra is source-available under the Astra Source-Available License
(Reference-Only) v1.0. See [LICENSE.md](LICENSE.md) and
[NOTICES.md](NOTICES.md).
