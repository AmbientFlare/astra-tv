# Astra 0.1.0 Release Build

Build date: 2026-06-28

## Command

```bash
~/vega/bin/vega exec npm run build:release
```

This runs:

```bash
react-native build-vega --build-type Release
```

## Output Artifacts

- `build/private/kepler/@amazon-devices/astra/undefined/vega/aarch64/Release/@amazon-devices/astra_aarch64.vpkg`
- `build/private/kepler/@amazon-devices/astra/undefined/vega/armv7/Release/@amazon-devices/astra_armv7.vpkg`
- `build/private/kepler/@amazon-devices/astra/undefined/vega/x86_64/Release/@amazon-devices/astra_x86_64.vpkg`

All three release packages were generated cleanly with manifest validation passing.
