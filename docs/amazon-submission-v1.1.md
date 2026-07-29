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

## Release notes — paste into Amazon

Amazon requires release notes for every language configured for an update.
These notes appear publicly in the Appstore's Latest updates section and in
Fire TV update notifications.

```text
New in Astra 1.1.0:

Browse and play music from your personal Jellyfin library by artist, album,
genre, or playlist. Music can continue while you browse Astra or use another
Fire TV screen, with remote Play/Pause and seeking controls.

This update also adds larger Movies, TV Shows, and Music cards, unwatched
episode badges, animated screen protection during music and paused video, and
improved support for Jellyfin servers on a home network.

We also fixed duplicate remote-button actions, music controls, server address
handling, and the transition from music to video playback.
```

This copy is intentionally customer-facing. It avoids implementation terms
such as Shaka, AAC/TS, native fetch paths, ABI validation, and queue internals.
Those details belong in reviewer notes or engineering documentation, not the
public Latest updates field.

Official Amazon guidance confirms that an update must include release notes
describing what changed:
https://developer.amazon.com/docs/app-submission/update-published-app.html

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
