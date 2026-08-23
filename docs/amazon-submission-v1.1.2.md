# Astra 1.1.2 Amazon Appstore Update

Date: 2026-08-22

Version: `1.1.2`

Build: `2026082204`

Package ID: `com.astra.tv`

## Upload file

Upload this single package:

`dist/amazon-submission-1.1.2-20260822/astra-1.1.2-x86_64-release.vpkg`

Expected SHA-256:

`5dbb766f89547aa4af0eb61c3c3612e7141da6a221df5ba376dbe09f8403f754`

Only x86_64 is included because Amazon currently maps Astra to supported
x86_64 Vega Fire TV devices; prior aarch64 and armv7 submissions mapped to zero
supported devices.

## Release notes — paste into Amazon

```text
New in Astra 1.1.2:

This update improves video playback reliability on Fire TV devices running
Vega OS. It fixes intermittent stutter on affected MP4 and MOV videos, prevents
saved-position resume from skipping through earlier scenes, and improves
audio/video synchronization during long viewing sessions.

Stats for Nerds now provides clearer delivery, buffering, build, and playback
health information. Advanced playback settings also include optional HLS
segment-length compatibility choices for difficult media.
```

## Reviewer notes — paste if requested

```text
Astra is a client for a user-supplied Jellyfin server and account. It contains
no hosted catalog, public channels, subscriptions, or bundled media.

This update changes the Vega media delivery path for affected HEVC content,
improves saved-position HLS resume, and upgrades the Amazon W3C Media package.
The existing package ID, user-data model, supported backend, and network model
are unchanged. Installing this VPKG as an update preserves saved Jellyfin
profiles.

Testing requires a reachable Jellyfin server containing video media. Play a
partially watched movie to exercise Resume; the app should return to the saved
scene within a few seconds and continue smoothly.
```

## Validation

- ESLint passed.
- TypeScript `tsc --noEmit` passed.
- All 175 Jest tests across 22 suites passed.
- Vega manifest and `IW3cmedia_2` ABI validation passed.
- The playback-identical `.3` candidate remained perfectly synchronized at
  38, 56, and 60 minutes on a physical Fire TV Stick.
- Forward/back/forward ten-second seeks returned with zero dropped frames,
  stalls, or errors.
- Exit-and-resume returned to the saved `64:31` scene within seconds; Jellyfin
  logged `-ss 01:04:24.500` and numbered segment 644.
- Release build `.4` changes only build identity and static in-app release
  notes from `.3`. Its in-place device install retained the signed-in profile
  and loaded Home normally.
- The upload VPKG matches the checksum above.

## Console checklist

1. Open the existing `com.astra.tv` app in Amazon Developer Console.
2. Start an update with version `1.1.2` and build `2026082204`.
3. Upload the single x86_64 VPKG listed above.
4. Paste the release notes into every configured language field.
5. Retain the existing app description, privacy answers, support URL, website,
   device targeting, and availability unless Amazon explicitly requires them
   to be reconfirmed.
6. Use the reviewer notes above if a testing-instructions field is shown.
7. Review Amazon validation results, then submit the update for review.

The package was prepared locally and has not yet been uploaded or submitted.
