# Astra 1.1.1 Release Build

Build date: 2026-08-04

App version: `1.1.1`

Build number: `2026080401`

Package ID: `com.astra.tv`
Main component: `com.astra.tv.main`

## Build command

```bash
npx react-native build-vega --build-type Release --target x86_64 \
  --build-number 2026080401 --build-version 1.1.1
```

## Amazon upload artifact

Upload this generated package to the Amazon Appstore:

`dist/amazon-submission-1.1.1-20260804/astra-1.1.1-x86_64-release.vpkg`

SHA-256: `dacefabe1d431718b004e370cf02e1665f401b3d03a71b649b9aac05dd0adb0e`

Amazon currently maps the x86_64 package to supported Fire TV Vega devices.
Earlier submissions mapped aarch64 and armv7 packages to zero supported
devices, so this update intentionally contains one x86_64 VPKG.

## Verification

- ESLint passed.
- TypeScript `tsc --noEmit` passed.
- All 158 Jest tests across 19 suites passed.
- Vega manifest and ABI validation passed, and the VPKG was generated.
- Physical-device acceptance and Amazon Appstore upload are still pending.

See [release-1.1.1.md](release-1.1.1.md) for functional changes and
[amazon-submission-v1.1.1.md](amazon-submission-v1.1.1.md) for upload notes.
