# Changelog

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
