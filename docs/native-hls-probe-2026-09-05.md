# Native HLS parsing probe — 2026-09-05

The development Vega device reports native HLS manifest parsing support for
Shaka 4.8.5. Registration returned `true`, all three required parser hooks are
callable, and the bogus player/version was rejected. This is a credible
capability result and makes an enable-and-benchmark experiment worthwhile.
It does not establish a JS-thread time saving or playback correctness with
native parsing: neither parser execution nor a performance comparison was part
of this observational probe. Native parsing remains disabled; enabling it is
separate follow-up work.

## Device evidence

Source: the local collector's `events.ndjson`, event time `2026-09-06T00:00:51.946000+00:00`,
Astra 1.3.0 display build `20260905.8`, package build `2026090508` (x86_64).
Confidence: directly observed on the development device; not generalized to
other Vega firmware or Shaka versions. Installation identity omitted below.

```json
{
  "ts": 1788652851946,
  "app": "1.3.0",
  "build": "20260905.8",
  "ev": "media.nativeParsing",
  "d": {
    "registerFnPresent": true,
    "registerCalled": true,
    "registerReturned": true,
    "supportFnPresent": true,
    "hlsSupported": true,
    "negativeControlSupported": false,
    "parseHlsManifestPresent": true,
    "createSegmentsPresent": true,
    "setNativeFunctionsPresent": true,
    "shakaVersionAsked": "4.8.5",
    "playerNameAsked": "shaka",
    "probeSucceeded": true,
    "controlsFailed": false,
    "alwaysTrue": false,
    "registerReturnType": "boolean"
  }
}
```

`controlsFailed: false` means that the required callable entry points exist
and the bogus-player negative control rejects. It does not independently rule
out an always-false platform implementation; in this run the real Shaka request
also returned `true`, providing the positive result.

## Implementation and validation

- `src/services/mediaCapabilities/nativeParsing.ts` registers only if the
  support function is absent, then inspects the globals produced by registration.
  Startup uses a process-lifetime cached promise because HLS registration has
  no teardown API. Test dependencies are isolated from device globals.
- Missing support remains `null`, distinct from explicit `false`; thrown or
  nonboolean responses invalidate the probe. A positive negative-control result
  sets `alwaysTrue` and invalidates the controls.
- `src/App.tsx` emits `media.nativeParsing` after telemetry bootstrap, with a
  rejection handler protecting startup.
- `enableNativeParsing` remains `false`; the probe never invokes
  `setNativeFunctions`, `parseHlsManifest`, or `nativeShakaHlsCreateSegments`.
  Device profile, HLS configuration, and subtitle behavior are unchanged.
- TypeScript and touched-file ESLint passed. All 451 tests across 54 Jest
  suites passed, including 12 native-probe tests. The focused 12 tests also
  passed after removal of redundant assignments in final review.
- Release build, manifest validation, and ABI validation passed. The package
  was installed in place and launched successfully with telemetry armed.

Package SHA-256: `459ee2642431c03f58af13fa255ca02fb3bc2d30b96cd0d2632376e7b7737663`.
