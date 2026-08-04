# Astra 1.1.1 Amazon Appstore Update

Version: `1.1.1`

This patch release hardens lifecycle and playback behavior on Fire TV/Vega:

- Native text inputs blur and dismiss the keyboard before teardown.
- Shaka SourceBuffer operations are serialized with seeks and cleanup.
- Player and Library timers release their references during unmount.

Release notes: [release-1.1.1.md](release-1.1.1.md)

Build metadata:

- Build number: `2026080401`
- Build date: `2026-08-04`
- Target: x86_64 Vega
- Package: `dist/amazon-submission-1.1.1-20260804/astra-1.1.1-x86_64-release.vpkg`
- SHA-256: `dacefabe1d431718b004e370cf02e1665f401b3d03a71b649b9aac05dd0adb0e`
