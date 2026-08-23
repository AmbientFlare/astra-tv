# Astra 1.0.2 Release Notes

Release date: 2026-07-18

Package ID: `com.astra.tv`

Version: `1.0.2`

Build number: `2026071814`

## Playback and track switching

Audio and subtitle changes now behave as explicit playback changes. Moving
through the menu only changes the highlighted choice. A completed Select press
captures the current timestamp, stops the existing player and Jellyfin session,
requests a fresh stream with the chosen tracks, and resumes near the captured
position. This fixes the previous audio-switch buffering hang and gives subtitle
changes the same reliable lifecycle.

Physical-device testing confirmed audio switching and both subtitle delivery
paths. Each operation briefly pauses, then resumes with the requested track.

## Subtitle compatibility

SubRip/SRT subtitles are delivered by Jellyfin as authenticated WebVTT. Astra
now fetches and parses those cues itself and draws synchronized white text over
the video. This avoids Vega's native caption surface, which remains disabled
when the device-wide Fire TV closed-caption service is off and cannot be enabled
by an installed application.

PGS/PGSSUB subtitles contain bitmap images rather than text. Vega cannot compose
those images over direct-play video, so Astra now explicitly asks Jellyfin to
burn them into the video. ASS/SSA and other bitmap subtitle formats use the same
safe encode policy rather than being advertised as external text tracks.

The separate paths were verified on physical Fire TV hardware with both SubRip
and PGS subtitle sources.

## Stream policy and audio compatibility

Astra now probes the Vega playback path for AC3, EAC3, MP3, and Opus support and
advertises compatible codecs to Jellyfin so they can be repackaged without
re-encoding when possible. AAC remains the safe fallback.

DTS and DTS-HD were tested separately. Vega recognized the DTS codec tag but
rejected DTS delivery through Astra's HLS/fMP4 path. DTS-to-AAC playback also
accumulated roughly 2.5 to 3 seconds of audio delay over about 16 minutes, even
when the AAC bitrate was reduced. DTS-HD-to-AC3 remained synchronized during the
same test. The production policy therefore converts DTS/DTS-HD audio to AC3 on
capable devices while leaving compatible 4K HEVC video stream-copied.

The hidden 8 Mbps recovery limit was removed because it could make Jellyfin
unnecessarily transcode 4K video to 1080p after an audio-path failure.

## Playback diagnostics

Stats for Nerds is available from Settings > Playback and from the in-player
Playback Options menu. It reports:

- source codec and delivered codec for audio and video;
- stream copy versus transcode for audio and video independently;
- source and active video resolution;
- source and output containers;
- source and output audio bitrate and sample rate;
- stream bitrate, estimated bandwidth, buffered duration, and buffering time;
- native decoded and dropped frame counters; and
- Jellyfin transcode reasons.

The active resolution comes from the selected Shaka/Vega stream, with Jellyfin
item metadata used for the source-resolution fallback.

## Setup and authentication

The setup flow now guides users through backend choice, server discovery or
manual address entry, and authentication. Jellyfin users can choose:

- Quick Connect using a six-digit code approved from another signed-in Jellyfin
  client; or
- the existing username and password flow.

Quick Connect uses Jellyfin's enabled check, initiate, polling, and token
exchange endpoints. Polling is non-overlapping, tolerates transient failures,
and returns to authentication selection with an error if the request expires.
The flow was verified against a live Jellyfin server and on the physical Fire
TV device.

Emby remains planned but is disabled in the backend selector and labeled Coming
soon so users cannot enter a nonfunctional setup path.

## Other behavior

- The periodic support/donation startup popup was removed completely from the
  launch routing path.
- Existing credentials survive in-place package updates.
- The About page displays version 1.0.2, build 20260718.14, and the 2026-07-18
  build date.
- The About page includes a What's New section summarizing the setup, playback,
  subtitle, diagnostics, 4K, and audio improvements in this release.

## Verification

Automated tests, linting, manifest validation, the Vega x86_64 release build,
and physical-device acceptance passed for this release.
