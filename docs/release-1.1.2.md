# Astra 1.1.2 release candidate

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

## Acceptance

- Auto, four-, three-, and two-second segment targets were tested on the
  affected Jellyfin title. Shorter fMP4 targets alone did not eliminate the
  micro-stutter.
- HLS/MPEG-TS playback of Generations was reported approximately 99.9% free of
  micro-stutter, including smooth motion in an action scene. Nemesis reproduced
  the original issue and served as the same-encode control.
- Resume testing on the accepted build reached the correct saved scene within
  a few seconds. At position `45:38`, Stats for Nerds showed a 10.7-second
  buffer, 3,804 decoded frames, zero dropped frames, zero stalls, and zero
  playback errors.
- Mild A/V drift appeared after roughly another 45 minutes on build
  `20260813.11`, and a normal seek restored sync. The one-hour `20260822.1`
  sequence-mode test was worse: audio led video by approximately 0.75–1.5
  seconds, while pause/resume appeared to reduce the offset. Sequence mode was
  therefore rejected for this route.
- Build `20260822.2` restored segments mode and upgraded W3C Media, but obvious
  drift returned by position `42:39`. Stats showed one continuous ten-second
  range, ample bandwidth, and no drops, stalls, or errors. Probing the retained
  transport stream found a stable 40–82 ms source A/V offset, so neither late
  fetching nor accumulating server timestamps explain the visible drift.
- Build `20260822.3` changes only HEVC/MPEG-TS audio from copied AAC to AC3 when
  supported. It was installed with Vega's data-preserving `device install-app`
  command, retained the signed-in profile, and started Generations from the
  beginning. The server FFmpeg log confirms the intended HEVC-copy/AC3 route.
- ESLint, TypeScript, 175 Jest tests across 22 suites, manifest validation, and
  `IW3cmedia_2` ABI validation passed for `20260822.3`.
- The user reported perfect A/V sync at 38, 56, and 60 minutes of uninterrupted
  `.3` playback, passing beyond `.2`'s approximately 46-minute failure point.
- Forward/back/forward ten-second seeks all recovered to playback with zero
  drops, stalls, or errors, and exit-and-resume returned to the saved scene at
  `64:31`. Jellyfin independently logged the resumed input seek as
  `-ss 01:04:24.500` and segment 644.
- Build `.4` changes only the build identity and in-app release-note text from
  the hardware-accepted `.3` playback code. It passed all automated, manifest,
  and ABI checks; its in-place install retained the signed-in profile and
  loaded Home normally.

## Amazon upload artifact

`dist/amazon-submission-1.1.2-20260822/astra-1.1.2-x86_64-release.vpkg`

SHA-256: `5dbb766f89547aa4af0eb61c3c3612e7141da6a221df5ba376dbe09f8403f754`

The required physical one-hour A/V-sync, repeat-seek, and saved-position resume
acceptance gates passed. The release package is prepared but has not been
uploaded to Amazon.
