# Astra 1.1.2

Version 1.1.2 is a focused playback patch for Fire TV devices running Vega OS.

## Fixes

- Adds an HLS segment-length compatibility setting with Auto, four-, three-,
  and two-second choices. Auto preserves Jellyfin's existing behavior; shorter
  targets apply to the fMP4 primary path and MPEG-TS fallback for stream-copy
  and transcode sessions only when selected.
- Expands Stats for Nerds with the HLS segment target, minimum segment count,
  exact Astra version/build, cumulative waiting/stalled/error events, and the
  most recent playback state.
- Emits privacy-safe structured logs for playback health events. Logs include
  container and delivery metadata but exclude URLs, credentials, item IDs, and
  titles.
- Routes HEVC Jellyfin streams through HLS/MPEG-TS on Vega while retaining the
  existing HLS/fMP4 path for H.264. This avoids the duplicate timestamps that
  caused visible micro-stutter at open-GOP fragment boundaries.
- Starts resumed HLS sessions at the numbered Jellyfin segment containing the
  saved position and maps the shortened media clock back to movie time. This
  avoids processing the movie from segment zero before playback.
- Upgrades Amazon's W3C Media package from 2.1.99 / `IW3cmedia_1` to 2.2.21 /
  `IW3cmedia_2`, while retaining the accepted Shaka segments-mode policy.
- Shows every buffered range, total buffered-ahead time, and the next gap in
  Stats for Nerds. This distinguishes a late request from a segment that is
  already fetched but separated by a timestamp discontinuity.
- Requests AC3 audio only for HEVC/MPEG-TS when the Vega capability probe
  reports AC3 support. H.264/fMP4 and AC3-incapable devices retain the normal
  audio policy.

## Release metadata

- Version: `1.1.2`
- Build: `20260822.4`
- Build date: `2026-08-22`

## Validation

- The complete automated suite passed: ESLint, TypeScript, 175 Jest tests,
  manifest validation, and W3C Media ABI validation.
- Physical-device playback remained synchronized for a continuous one-hour
  test of the affected route.
- Repeated forward and backward seeks recovered cleanly, and reopening the
  title resumed at the saved position.
- An in-place upgrade retained the signed-in profile and loaded Home normally.

Version 1.1.2 was submitted to Amazon on 2026-08-22. Amazon review and
publication remain.
