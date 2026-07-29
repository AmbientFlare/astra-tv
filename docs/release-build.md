# Astra 1.1.0 Release Build

Build date: 2026-07-29

App version: `1.1.0`

Build number: `2026072904`

Package ID: `com.astra.tv`
Main component: `com.astra.tv.main`

## Build command

```bash
npx react-native build-vega --build-type Release --target x86_64 \
  --build-number 2026072904 --build-version 1.1.0
```

## Amazon upload artifact

- `dist/amazon-submission-1.1.0-20260729/astra-1.1.0-x86_64-release.vpkg`
- Checksum: `dist/amazon-submission-1.1.0-20260729/SHA256SUMS.txt`
- SHA-256:
  `385cb8516a35f7313594310642b17f1ec74f884147ab2db9f51588af3d6944ab`

Amazon currently maps the x86_64 package to supported Fire TV Vega devices.
Earlier submissions mapped aarch64 and armv7 packages to zero supported
devices, so this update intentionally contains one x86_64 VPKG.

## Verification

- ESLint passed.
- TypeScript `tsc --noEmit` passed.
- All 158 Jest tests across 19 suites passed.
- Vega manifest validation passed with zero errors.
- Vega ABI validation passed.
- The exact release package was installed, launched, and confirmed running on
  physical device `GT533M0752050H4U`.
- Device testing confirmed plain-HTTP HLS music playback, seeking, background
  playback, remote Play/Pause, sequential tracks, music-to-video handoff, and
  the simplified music interface.

See [release-1.1.0.md](release-1.1.0.md) for functional changes and
[amazon-submission-v1.1.md](amazon-submission-v1.1.md) for upload notes.
