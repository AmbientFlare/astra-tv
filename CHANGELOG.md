# Changelog

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
  20260718.11.
