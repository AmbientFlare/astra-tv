# Astra 1.0.0 Release Build

Build date: 2026-07-05
App version: `1.0.0`
Package ID: `com.astra.tv`

## Command

```bash
KEPLER_SDK_PATH=/home/levi/vega/sdk/0.23.8358 \
PATH=/home/levi/vega/bin:/home/levi/vega/sdk/0.23.8358/bin:$PATH \
npm run build:release
```

This runs:

```bash
react-native build-vega --build-type Release
```

## Output Artifacts

- `dist/amazon-submission-1.0.0-20260705/astra-1.0.0-aarch64-release.vpkg`
- `dist/amazon-submission-1.0.0-20260705/astra-1.0.0-armv7-release.vpkg`
- `dist/amazon-submission-1.0.0-20260705/astra-1.0.0-x86_64-release.vpkg`

Amazon currently maps the `x86_64` package to supported Fire TV Vega devices.
The `aarch64` and `armv7` builds are retained in the local submission folder for
future hardware coverage, but may target zero devices in the current console.

## Build Numbers

Amazon requires uploaded app files in the same app version to have unique build
numbers. The 1.0.0 package set was rebuilt with architecture-specific build
numbers:

- `aarch64`: `202607051`
- `armv7`: `202607052`
- `x86_64`: `202607053`

## Verification

- Manifest validation passed with 0 errors.
- `npm run build:release` passed.
- `npm run lint` passed.
- `npm test -- --watchAll=false` passed.
