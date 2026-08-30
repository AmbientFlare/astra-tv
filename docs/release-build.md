# Astra 1.2.0 Amazon submission build

Build date: 2026-08-29

App version: `1.2.0`

Build number: `20260829.12` (app display), `2026082912` (Vega package build)

Package ID: `com.astra.tv`
Main component: `com.astra.tv.main`

## Build command

```bash
npm run build:submission
```

That derives the version and build number from `src/config/app.ts` and fails if
the resulting package does not carry them. It replaces running `build-vega`
by hand:

```bash
PATH=/home/levi/vega/bin:$PATH npx react-native build-vega \
  --build-type Release --target x86_64 \
  --build-number 2026082912 --build-version 1.2.0
```

Do not use `npm run build:release` for a submission: it omits the build number,
and Amazon rejects the package with "build_number must be greater than 0".

## Amazon upload artifact

Upload this single file:

`dist/amazon-submission-1.2.0-20260829/astra-1.2.0-x86_64-release.vpkg`

SHA-256: `3540d41f526b2bb28e33d2b32136172801baaa290894ee638e219119b88f6d5b`

Vega builds are not byte-reproducible, so re-hash any package you rebuild.

The release is x86_64 because Amazon currently maps that package to the
supported Fire TV Vega devices.

## Verification

- ESLint passed.
- TypeScript `tsc --noEmit` passed.
- All 208 Jest tests across 27 suites passed.
- Vega manifest validation passed. The generated manifest requests
  `/com.amazon.kepler.w3cmedia_2@IW3cmedia_2`, and ABI validation passed.
- The versioned x86_64 VPKG was generated and its checksum recorded.
- Build `20260822.3` was updated and launched successfully on Vega device
  `GT533M0752050H4U` with `device install-app` and `device launch-app`; the
  signed-in Jellyfin profile was retained. Do not use `run-app` for upgrades,
  because the CLI uninstalls the existing package and deletes app data first.
- The preceding build `20260813.11` installed and launched successfully on
  Vega device `GT533M0752050H4U`; HEVC HLS/TS playback was approximately 99.9%
  free of the reported micro-stutter and resume reached the correct scene
  within a few seconds.
- The new candidate started *Star Trek: Generations* from `0:00` successfully.
  The Jellyfin FFmpeg log confirms HEVC stream copy plus AAC-to-AC3 conversion,
  isolating the audio codec while retaining W3C Media 2.2 and MPEG-TS segments
  mode.
- The user reported perfect A/V sync at 38, 56, and 60 minutes of uninterrupted
  playback. The preceding AAC build had obvious drift by approximately 46
  minutes.
- Forward/back/forward ten-second seeks returned to playback with one continuous
  12.8-second buffer, zero dropped frames, zero stalls, and zero errors.
- Exit-and-resume returned to the correct scene at `64:31`; Jellyfin started
  the resumed stream at `-ss 01:04:24.500` with numbered segment 644.
- Build `20260822.4` changes only the build identity and static in-app release
  notes from the accepted `.3` playback code. It passed the same 175 tests,
  manifest and ABI validation, installed through the data-preserving upgrade
  path, retained the signed-in profile, and loaded Home normally.
- The `.4` VPKG was copied byte-for-byte into the Amazon submission directory;
  both copies match the checksum above.
- The owner uploaded this VPKG to Amazon and entered the prepared release notes
  on 2026-08-22. Amazon review and publication remain.

The first build attempt produced the JS bundle but stopped before native
packaging because the Vega CLI directory was absent from `PATH`:

```bash
error Vega CLI was not found in ambient environment, nor could be found within
$KEPLER_SDK_PATH (value = '/home/levi/vega/sdk/0.23.8358').
```

Retrying the same build with `PATH=/home/levi/vega/bin:$PATH` succeeded.

See [release-1.1.2.md](release-1.1.2.md) for the acceptance checklist.
