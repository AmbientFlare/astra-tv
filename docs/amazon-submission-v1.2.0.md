# Astra 1.2.0 Amazon Appstore Update

Date: 2026-08-29

Version: `1.2.0`

Build: `2026082912`

Package ID: `com.astra.tv`

Minimum / target Vega OS: `1.2`

## Upload file

Upload this single package:

`dist/amazon-submission-1.2.0-20260829/astra-1.2.0-x86_64-release.vpkg`

Expected SHA-256:

`71932933562acbc9bb3eddc631d97d30b31b21db72cce6266e64ef36ed10730a`

Only x86_64 is included because Amazon currently maps Astra to supported
x86_64 Vega Fire TV devices; prior aarch64 and armv7 submissions mapped to zero
supported devices.

**New in this submission:** the manifest now declares `[os.version]` with a
minimum and target of `1.2`. Vega SDK 0.24 refuses to build without it. This
means the update will not install on devices still running an older Vega OS.

## Release notes — paste into Amazon

```text
New in Astra 1.2.0:

This update repairs playback on Fire TV devices that have received the Vega
OS 1.2 update.

Fixed:
- Resuming a title from a saved position no longer closes the app.
- Switching audio tracks during playback no longer closes the app.
- Turning on burned-in subtitles during playback no longer closes the app.
- Startup and seeking are considerably faster. A jump that previously took
  most of a minute now completes in seconds, and short skips are close to
  instant.

Also in this release:
- Updated for Vega OS 1.2 and the current Amazon device libraries.
- Added an optional "Stats for Nerds with logs" view showing playback timings,
  off by default.

Still being worked on for the next update: long chapter jumps take longer than
they should, and subtitles can drift out of sync after one.
```

## Reviewer notes — paste if requested

```text
Astra is a client for a user-supplied Jellyfin server and account. It contains
no hosted catalog, public channels, subscriptions, or bundled media.

This update repairs playback failures introduced on the device by the Vega
OS 1.2 update. The application code did not change to cause them: the
previously published 1.1.2 package reproduces the same failures on an updated
device. Two causes were confirmed and fixed — the native logging bridge
blocking the JavaScript thread until the thread monitor terminated the app,
and an expensive playlist re-encode during stream loading.

The package ID, user-data model, supported backend, and network model are
unchanged. Installing this VPKG as an update preserves saved Jellyfin
profiles. The manifest now declares Vega OS 1.2 as both minimum and target, as
required by Vega SDK 0.24.

On first launch after updating, the app shows a one-time message from the
developer acknowledging the disruption. It is dismissed with a single OK
button and does not reappear. It contains no links, no purchase prompts, and
no data collection.

Testing requires a reachable Jellyfin server containing video media. Play a
partially watched movie and choose Resume; playback should return to the saved
scene and continue. Changing the audio track or enabling subtitles during
playback should also continue without closing the app.
```

## Validation

- ESLint passed.
- TypeScript `tsc --noEmit` passed.
- All 208 Jest tests across 27 suites passed.
- Vega manifest validation and `vega project doctor` passed, including OS
  version compliance and a "Deprecated APIs: None" result.
- Built against Vega SDK `0.24.9914`.
- Resume, audio track switching and burned-in subtitle selection were each
  confirmed working on a physical Fire TV Stick running Vega OS 1.2
  (`OsBuildNumber 2101020054720`), all three having failed before this release.
- The previously published `20260822.4` package was installed unmodified on the
  same device and reproduced the resume failure, confirming the cause was the
  OS update rather than a change in this project.
- Roughly 45 minutes of uninterrupted playback showed no audio/video drift.
- Manifest re-encoding fell from 5,008 ms to 8 ms, and total stream load from
  7,960 ms to about 2,800 ms.
- The upload VPKG matches the checksum above.

## Console checklist

1. Open the existing `com.astra.tv` app in Amazon Developer Console.
2. Start an update with version `1.2.0` and build `2026082912`.
3. Upload the single x86_64 VPKG listed above.
4. Paste the release notes into every configured language field.
5. Retain the existing app description, privacy answers, support URL, website,
   device targeting, and availability unless Amazon explicitly requires them
   to be reconfirmed.
6. Use the reviewer notes above if a testing-instructions field is shown.
7. Confirm the OS 1.2 minimum is understood: devices on an older Vega OS will
   not receive this update.
8. Review Amazon validation results, then submit the update for review.

## Submission status

Not yet submitted.
