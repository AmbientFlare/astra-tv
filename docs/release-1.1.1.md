# Astra 1.1.1

Version 1.1.1 is a stability patch for the Astra 1.1.0 Fire TV release.

## Fixes

- Search and Setup explicitly blur native text inputs and dismiss the Vega
  keyboard before changing screens or wizard steps.
- ShakaPlayer serializes SourceBuffer append, remove, and abort operations and
  waits for them before seeking or unloading.
- Player and Library timer callbacks snapshot references and cleanup clears
  timers and releases native references during teardown.

## Release metadata

- Version: `1.1.1`
- Build: `20260804.1`
- Build date: `2026-08-04`
