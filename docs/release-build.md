# Astra 1.0.2 Release Build

Build date: 2026-07-18
App version: `1.0.2`
Package ID: `com.astra.tv`

## Command

```bash
KEPLER_SDK_PATH=/home/levi/vega/sdk/0.23.8358 \
PATH=/home/levi/vega/bin:/home/levi/vega/sdk/0.23.8358/bin:$PATH \
npx react-native build-vega --build-type Release --target x86_64 \
  --build-number 2026071811 --build-version 1.0.2
```

## Output Artifacts

- `dist/amazon-submission-1.0.2-20260718/astra-1.0.2-x86_64-release.vpkg`
- SHA-256: `3f1d7eba7a0e6696dcf30ff27c1dcc0a59197a487c6d21afdd15592b59704b84`

Amazon currently maps the `x86_64` package to supported Fire TV Vega devices.
The `aarch64` and `armv7` builds are not needed for this Amazon update because
they mapped to zero supported devices during the 1.0.0 submission.

## Build Numbers

Amazon requires update packages to use a greater build number than the package
already live in the Appstore. The 1.0.2 x86_64 package uses:

- `x86_64`: `2026071811`

## Verification

- Manifest validation passed with 0 errors.
- `npx react-native build-vega --build-type Release --target x86_64 --build-number 2026071811 --build-version 1.0.2` passed.
- `npm run lint` passed.
- `npm test -- --watchAll=false` passed.
- 7 test suites, 35 tests, and 1 snapshot passed.

See [release-1.0.2.md](release-1.0.2.md) for functional changes and physical-device verification.
