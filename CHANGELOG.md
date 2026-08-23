# Changelog

## 1.1.2 - 2026-08-22

### Added

- Stats for Nerds now reports the HLS segment target, minimum segment count,
  exact app/build identity, and cumulative waiting, stalled, and error events.
- Stats for Nerds now distinguishes the current contiguous buffer from all
  buffered ranges and reports the next gap, so boundary gaps are not mistaken
  for late segment downloads.
- Playback health events emit privacy-safe structured container and delivery
  metadata without URLs, credentials, item IDs, or media titles.

### Fixed

- Playback settings now offer opt-in four-, three-, and two-second Jellyfin HLS
  segment targets on both fMP4 and MPEG-TS paths. Auto remains the default, so
  existing playback behavior is unchanged unless compatibility mode is chosen.
- HEVC video on Vega now uses Jellyfin HLS/MPEG-TS delivery, avoiding the
  duplicate open-GOP timestamps that caused visible MP4/MOV micro-stutter.
- Resuming an HLS/MPEG-TS title starts at the numbered Jellyfin segment that
  contains the saved position instead of processing every preceding segment.

### Changed

- The Vega W3C Media dependency moves from 2.1.99 / `IW3cmedia_1` to 2.2.21 /
  `IW3cmedia_2` for the next isolated long-playback stability and A/V-sync
  candidate.
- HLS/MPEG-TS returns to the previously accepted segments mode after a
  one-hour physical sequence-mode test still accumulated a roughly
  0.75–1.5-second audio lead. HLS/fMP4 remains in segments mode.
- HEVC/MPEG-TS requests AC3 audio when the device reports AC3 support. Two
  long AAC/TS hardware runs drifted while the generated transport-stream A/V
  timestamps remained stable; H.264/fMP4 retains the normal audio policy.

## 1.1.1 - 2026-08-04

### Fixed

- Text inputs now blur and dismiss the Vega keyboard before Search or Setup
  navigates away or unmounts.
- Shaka SourceBuffer appends, removes, and aborts are serialized before seeks
  and player teardown.
- Player and Library timers snapshot references and are cleared before those
  references are released.

## 1.1.0 - 2026-07-29

### Added

- Music library navigation for artists, albums, genres, and playlists, with
  paginated browsing, remembered poster/list layouts, and an A-Z jump rail.
- Artist, album, genre, and playlist detail screens with sequential playback
  and album shuffle.
- Persistent music playback with seeking, remote media controls, background
  playback, a docked player, and a simplified Now Playing screen.
- Three-minute audio idle visual with slowly drifting album art, because Vega
  suppresses its system screensaver while audio is active.
- Red unwatched-episode count badges on TV series posters, capped at `99+`.
- Multi-server URL normalization and HTTP/HTTPS connection recovery.
- Large Movies, TV Shows, and Music home cards backed by poster and album-cover
  collages from the connected Jellyfin server.
- Three-minute paused-video idle visual and Vega user-engagement integration to
  keep burn-in protection inside Astra.

### Fixed

- Cleartext LAN audio now uses AAC/TS HLS through ShakaPlayer. Vega rejects
  native-player HTTP media fetches even though JavaScript HTTP requests work.
- Source audio containers are excluded from HLS negotiation so Jellyfin cannot
  silently choose progressive direct play instead of returning a manifest.
- Remote key down/up duplication, slow-handler duplication, and dual
  D-pad/KMC command delivery no longer double-advance or immediately re-pause.
- Starting video stops music, unloads its adaptive stream, and removes stale
  track metadata from the bottom of the screen.
- Auto-capitalized server schemes and host casing no longer invalidate URLs.
- Video Next/Previous command declarations were restored in the Vega manifest.

### Changed

- HTTPS Jellyfin servers retain efficient progressive audio direct play; only
  HTTP servers use the compatibility HLS transcode path.
- Temporary on-screen audio URL and ready-state diagnostics are disabled for
  the release UI.
- Queue construction, per-track action popups, playlist creation, and
  music-specific long-press controls were removed after hardware testing showed
  they conflicted with reliable Vega focus navigation.
- D-pad Left/Right skips tracks only on Now Playing; it remains ordinary focus
  navigation everywhere else.

## 1.0.3 - 2026-07-21

### Added

- Quick user switching: the Home screen profile button opens a "Who's
  watching?" overlay for swapping between saved users or adding a new one —
  no sign-out required.
- Multiple users per server: signing in as another user keeps existing
  profiles instead of replacing them.
- The Home screen profile button now shows the signed-in username instead of
  a single initial.
- Settings > Manage servers groups accounts under their server (one entry per
  server with a user count) and supports per-account sign-out/removal.

### Fixed

- Libraries failed to load with "Jellyfin request failed 403" for non-admin
  users on Jellyfin 10.11+: the home screen used the admin-only
  `/Library/MediaFolders` endpoint. It now uses `/UserViews`, which also
  means each user sees exactly the libraries they have access to. (#6)
- Requests now send the standard `Authorization: MediaBrowser` header
  alongside the legacy `X-Emby-*` headers, keeping Astra compatible with
  Jellyfin 10.12/10.13 where legacy authorization is disabled/removed.

### Changed

- Updated release metadata and the About page to version 1.0.3, build
  20260721.1.

## 1.0.2 - 2026-07-18

### Added

- Jellyfin Quick Connect sign-in with a server-issued six-digit code.
- A guided setup flow with local server discovery and password-login fallback.
- Stats for Nerds playback diagnostics for codecs, stream-copy/transcode state,
  source and active resolution, container, bitrate, buffer, and frame health.
- Runtime audio capability probing for AC3, EAC3, MP3, and Opus delivery.

### Fixed

- Audio-track changes now reload a fresh Jellyfin stream and resume at the
  captured position instead of hanging indefinitely while buffering.
- Subtitle changes use the same clean reload-and-resume lifecycle.
- SubRip/SRT subtitles now render in Astra's own synchronized WebVTT overlay,
  independent of Fire TV's disabled system closed-caption renderer.
- PGS/PGSSUB and styled ASS/SSA subtitles are negotiated as video burn-in
  instead of unsupported external text tracks.
- Jellyfin WebVTT subtitle URLs with authentication query parameters are now
  identified with the correct `text/vtt` MIME type.
- Track navigation no longer changes streams until Select is released and the
  completed press is dispatched.
- DTS-HD audio uses stable AC3 conversion when Vega cannot accept DTS in the
  HLS/fMP4 playback path, while compatible HEVC video remains stream-copied.
- Removed the recovery bitrate cap that could unnecessarily reduce 4K video to
  1080p.
- Corrected playback diagnostics to report source and active video resolution
  and native frame-quality counters.

### Changed

- Emby is visible but disabled and marked Coming soon.
- Removed the periodic support/donation popup from application startup.
- Updated release metadata and the About page to version 1.0.2, build
  20260718.14.
- Added an in-app What's New section summarizing each release's user-visible
  improvements.

## 1.0.1 - 2026-07-07

### Added

- Astra Source-Available License and third-party notices.
- Public source and website links on the About page.

### Fixed

- Corrected About-page release information and support links.
- Replaced the placeholder support QR code with the final asset.

### Changed

- Finalized the first Amazon update package metadata.

## 1.0.0 - 2026-07-05

### Added

- Jellyfin server setup, authentication, and saved server profiles.
- Movie and television library browsing, search, detail pages, cast pages,
  seasons, and episodes.
- Resume playback, watch-progress reporting, and chapter navigation.
- Vega media playback with Jellyfin direct-play, stream-copy, and transcode
  fallback.
- Remote-first Fire TV navigation, settings, and Amazon submission assets.
