# Astra 1.1.0 Music Preview

## Purpose

Version 1.1.0 expands Astra from movie and television playback into a
couch-first Jellyfin music client while preserving compatibility with common
LAN installations that expose Jellyfin over plain HTTP.

## User-visible changes

- Browse music by artists, albums, genres, and playlists.
- Switch between poster and list layouts, remembered independently per section.
- Jump through large collections with an A-Z rail and infinite pagination.
- Open artist, album, genre, and playlist detail views.
- Play immediately, shuffle, play next, or append to a persistent queue.
- Keep listening while navigating throughout Astra or while the app is
  backgrounded.
- Use D-pad Left/Right for previous/next track and FF/RW for seeking.
- Open the docked player for a full now-playing queue view.
- Play a selected queue entry or remove it through per-track queue actions.
- Use shuffle and repeat modes from the now-playing screen.
- See unwatched episode counts in a red square on TV-series posters, capped at
  `99+`.
- After three minutes without input, show moving album artwork to reduce burn-in
  risk; any remote input dismisses it.
- Use the same in-app burn-in protection when a movie or episode remains
  paused, keeping the experience inside Astra instead of handing off to the
  Fire TV system screensaver.

## HTTP compatibility architecture

Vega treats network requests differently depending on which runtime performs
them. JavaScript `fetch` works over HTTP, including browsing and artwork.
ShakaPlayer also works because it fetches manifests and segments in JavaScript.
The native `AudioPlayer.src` fetch path rejects cleartext media and remains at
`HAVE_NOTHING`.

Astra therefore chooses delivery per saved server origin:

| Server | Audio path | Reason |
|---|---|---|
| HTTPS | Progressive direct play | Avoids transcoding and retains proven seeking |
| HTTP | AAC audio in MPEG-TS HLS through Shaka | Keeps LAN installs working without TLS setup |

The Jellyfin HLS request must exclude source containers such as MP3. If MP3 is
advertised in `Container`, Jellyfin silently chooses direct play and ignores the
HLS parameters. Astra sends `Container=aac`, `TranscodingContainer=ts`,
`TranscodingProtocol=hls`, and `AudioCodec=aac`.

## Vega remote-control findings

- A physical key commonly produces both down and up events.
- Some actions also produce a separate `<key>_up` event type.
- Async handlers must hold their dedupe window until completion.
- Skip and Play/Pause buttons can arrive through D-pad and Kepler Media
  Controls simultaneously.
- Each transport action therefore has one owning channel. Dedicated
  Play/Pause is exclusively KMC-owned.
- D-pad Left/Right always changes tracks. KMC Previous retains the conventional
  restart-current-after-three-seconds behavior.
- Starting video explicitly stops and unloads music before video claims media
  focus, preventing stale audio metadata below the movie.

## Device evidence

Test device: `GT533M0752050H4U`, x86_64 Fire TV running Vega OS.

Confirmed on a local `http://192.168.x.x:8096` Jellyfin address without a
reverse proxy:

- AAC/TS HLS playback starts and decodes.
- FF/RW seeking works.
- D-pad track changes work.
- Dedicated Play/Pause works after dual-channel ownership was corrected.
- Background audio advances in real time.
- Starting a movie stops music and removes the docked track bar.

## Validation

- Jest, ESLint, and TypeScript are required before packaging.
- Release builds target x86_64 because submission device mapping reported no
  supported aarch64 or armv7 targets.
- The source package remains diagnostic-safe: query strings containing access
  tokens are never rendered on screen.

## Still to verify

- Full now-playing screen navigation and per-track queue actions on hardware.
- Three-minute idle visual timing, drift, artwork rotation, and instant input
  dismissal.
- Paused-video idle visual activation, dismissal, and resume behavior.
- Unwatched badges against series with counts of 1, 99, and more than 99.
- End-to-end regression over an HTTPS reverse-proxy server.

## Future screensaver system

The idle visuals are intentionally internal components that can grow into a
pluggable Astra screensaver surface. Candidate sources and modes:

- Current album, artist, movie, and series artwork.
- A user-selected family-photo collection.
- Server-hosted photo libraries from Jellyfin.
- Bundled ambient themes and optional downloadable artwork packs.
- Clock, weather, or minimal black-screen modes.
- Per-profile timing, source, shuffle, and motion settings.

Before supporting downloadable packs or family photos, define storage limits,
offline/cache behavior, source permissions, privacy expectations, image
rotation intervals, and safe failure behavior. Vega has no general filesystem
API available to this React Native app today, so a first photo implementation
should favor server-hosted URLs or compact AsyncStorage configuration rather
than promising arbitrary local folders.
