# Astra 1.1.0 Amazon Appstore Update

Date: 2026-07-29  
Version: `1.1.0`  
Build: `2026072904`  
Package ID: `com.astra.tv`

## Upload file

Upload this single package:

`dist/amazon-submission-1.1.0-20260729/astra-1.1.0-x86_64-release.vpkg`

Verify it against:

`dist/amazon-submission-1.1.0-20260729/SHA256SUMS.txt`

Expected SHA-256:

`385cb8516a35f7313594310642b17f1ec74f884147ab2db9f51588af3d6944ab`

Only x86_64 is included because Amazon's prior device mapping assigned the
aarch64 and armv7 packages to zero supported devices.

## Release notes

```text
Astra 1.1.0 adds Jellyfin music browsing and playback for Fire TV. Browse
artists, albums, genres, and playlists; play songs and albums; seek and control
playback with the remote; and keep listening while browsing or in the
background.

Local HTTP Jellyfin servers work without TLS setup through automatic HLS audio
delivery. The update also adds moving burn-in protection for music and paused
video, unwatched episode badges, and large Movies, TV Shows, and Music cards
using artwork from the connected server.
```

## Reviewer notes

```text
Astra requires a user-supplied Jellyfin server and account. It contains no
hosted catalog or bundled media.

To test music, connect to a Jellyfin server with a music library, choose Music
from Home, and select an artist, album, or playlist. Plain-HTTP LAN servers are
supported. Audio can continue while browsing and while the app is backgrounded.
Starting a movie or episode stops music and transfers media control to video.
```

## Validation

- 158 Jest tests across 19 suites passed.
- ESLint and TypeScript passed.
- Vega manifest and ABI validation passed.
- The exact VPKG was installed and launched on physical x86_64 Vega hardware.

Store copy is maintained in [store-listing.md](store-listing.md). Detailed
changes are in [release-1.1.0.md](release-1.1.0.md).
