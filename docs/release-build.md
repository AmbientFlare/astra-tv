# Astra 1.0.1 Release Build

Build date: 2026-07-07
App version: `1.0.1`
Package ID: `com.astra.tv`

## Command

```bash
KEPLER_SDK_PATH=/home/levi/vega/sdk/0.23.8358 \
PATH=/home/levi/vega/bin:/home/levi/vega/sdk/0.23.8358/bin:$PATH \
npx react-native build-vega --build-type Release --target x86_64 \
  --build-number 202607073 --build-version 1.0.1
```

## Output Artifacts

- `dist/amazon-submission-1.0.1-20260707/astra-1.0.1-x86_64-release.vpkg`

Amazon currently maps the `x86_64` package to supported Fire TV Vega devices.
The `aarch64` and `armv7` builds are not needed for this Amazon update because
they mapped to zero supported devices during the 1.0.0 submission.

## Build Numbers

Amazon requires update packages to use a greater build number than the package
already live in the Appstore. The 1.0.1 x86_64 package uses:

- `x86_64`: `202607073`

## Verification

- Manifest validation passed with 0 errors.
- `npx react-native build-vega --build-type Release --target x86_64 --build-number 202607073 --build-version 1.0.1` passed.
- `npm run lint` passed.
- `npm test -- --watchAll=false` passed.
