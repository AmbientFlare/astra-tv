# Astra: Read This First

Use this file as the operational entry point for Astra development. Keep exact
commands and current release state here so a new session does not have to
rediscover the Vega setup.

## First steps

```bash
cd /home/levi/projects/astra
git status --short --branch
npm install
```

- Preserve unrelated dirty work; do not reset or discard it.
- Before touching remote infrastructure, also read `/home/levi/START_HERE.md`.
- Maintain progress and acceptance state in `docs/IMPLEMENTATION_STATUS.md`.
- `dist/` contains local test/submission artifacts and is intentionally ignored.

## Validate every candidate

```bash
npm run lint
npx tsc --noEmit
npm test -- --runInBand
git diff --check
```

The `20260822.4` release baseline is 175 passing Jest tests across 22 suites.

## Build a release VPKG

The project uses the local React Native CLI for builds. App display builds use
one dot, while the numeric Vega package build omits it.

```bash
PATH=/home/levi/vega/bin:$PATH npx react-native build-vega \
  --build-type Release --target x86_64 \
  --build-number 2026082204 --build-version 1.1.2
```

Before a new build, update `APP_VERSION`, `BUILD_NUMBER`, and `BUILD_DATE` in
`src/config/app.ts`. Use a monotonically increasing numeric package build.
Amazon currently maps Astra's package to x86_64 Vega Fire TV devices.

Store a test build as:

```text
dist/test-candidate-<version>-<display-build>/astra-<version>-x86_64-release.vpkg
```

Record its checksum with:

```bash
sha256sum dist/test-candidate-*/astra-*-x86_64-release.vpkg
```

Update `docs/release-build.md`, the matching release notes, `CHANGELOG.md`, and
`docs/IMPLEMENTATION_STATUS.md` after packaging. Do not call a test candidate
an Amazon upload package until hardware acceptance passes.

## Vega device commands

Do not use the obsolete `/home/levi/vega-sdk/bin` path. The working device CLI
is:

```bash
VEGA_CLI=/home/levi/vega/bin/vega
TEST_DEVICE=GT533M0752050H4U
```

Run commands with the exact path (the variables above are illustrative and do
not persist between shell calls):

```bash
/home/levi/vega/bin/vega device list
/home/levi/vega/bin/vega device install-app \
  --device GT533M0752050H4U --packagePath <package.vpkg>
/home/levi/vega/bin/vega device launch-app \
  --device GT533M0752050H4U --appName com.astra.tv.main
/home/levi/vega/bin/vega device start-log-stream \
  --device GT533M0752050H4U
/home/levi/vega/bin/vega device get-log-info \
  --device GT533M0752050H4U
```

Use `device install-app` followed by `device launch-app` for every ordinary
upgrade. This updates the installed VPKG and preserves Astra's signed-in
profile; it was verified on the physical stick with builds `20260822.3` and
`20260822.4`.

**Never use `vega run-app` for an upgrade.** That convenience command calls
uninstall before install and therefore deletes Astra's app data. Use it only
when a deliberate clean-data reinstall is required. Package ID is
`com.astra.tv`; main component is `com.astra.tv.main`.

For remote navigation and text entry in Developer Mode:

```bash
/home/levi/vega/bin/vega device run-cmd --device GT533M0752050H4U \
  --command 'inputd-cli button_press KEY_HOME short'
/home/levi/vega/bin/vega device run-cmd --device GT533M0752050H4U \
  --command 'inputd-cli button_press KEY_ENTER short'
/home/levi/vega/bin/vega device run-cmd --device GT533M0752050H4U \
  --command 'inputd-cli send_text "example" --interval 60'
```

Use `gwsi-tool-screenshooter`, not `screenshooter`, on this physical stick;
the latter creates an empty file. Pull a screenshot with VDA:

```bash
/home/levi/vega/bin/vega device run-cmd --device GT533M0752050H4U \
  --command 'gwsi-tool-screenshooter /tmp/astra-screen.png'
/home/levi/vega/bin/vega exec vda -s GT533M0752050H4U pull \
  /tmp/astra-screen.png /tmp/astra-screen.png
```

Never capture or retain a screen while a password is visible. Delete exact
temporary screenshot files from both host and device after diagnosis.

## Current playback investigation

Track GitHub issues with:

```bash
gh issue list --repo AmbientFlare/astra-tv --state all
gh issue view <number> --repo AmbientFlare/astra-tv --comments
```

- Issue #9: HLS boundary micro-stutter. HEVC now uses MPEG-TS because Jellyfin
  fMP4 remuxing duplicated open-GOP timestamps.
- Issue #11: resume skipping. The numbered-playlist trim in build
  `20260813.11` passed device acceptance.
- Issue #12: boundary stutter with the displayed buffer cycling from about 15
  seconds to one second. The 1.1.2 candidates add a full buffer map to determine
  whether media is actually late or already present after a timestamp gap.
- Issue #10 is live TV and is out of scope; Astra does not currently offer it.
- Auto-next is a separate feature request, not part of this playback patch.

The one-hour `20260822.1` test rejected MPEG-TS sequence mode: audio led video
by approximately 0.75–1.5 seconds, and pause/resume appeared to reduce the
offset. Build `20260822.2` restored segments mode and upgraded W3C Media to
2.2.21 / `IW3cmedia_2`, but hardware again showed obvious drift by position
`42:39`. Its buffer was one continuous ten-second range with no dropped frames,
stalls, or errors, and probing the retained transport stream showed a bounded
40–82 ms source A/V offset rather than accumulating drift.

Build `20260822.3` keeps that entire video/container/buffer/resume policy and
changes only HEVC/MPEG-TS audio: when Vega reports AC3 support, Jellyfin converts
AAC to AC3. H.264/fMP4 and devices without AC3 retain the previous policy.

Build `20260822.4` is the release-packaging build. Its playback code is
identical to accepted `.3`; only the build identity and static in-app release
notes changed. It passed all automated/build gates and an in-place hardware
upgrade retained the signed-in profile and loaded Home normally.

The current package is:

```text
dist/amazon-submission-1.1.2-20260822/astra-1.1.2-x86_64-release.vpkg
SHA-256 5dbb766f89547aa4af0eb61c3c3612e7141da6a221df5ba376dbe09f8403f754
```

The playback-identical `.3` build remained perfectly synchronized at 38, 56,
and 60 minutes, passed forward/back/forward ten-second seeks, and resumed at
the saved `64:31` scene within seconds. The `.4` release build is installed via
the data-preserving upgrade path; the signed-in profile remained available and
Home loaded normally. Physical and release-build acceptance are complete. The
owner uploaded 1.1.2 to Amazon with the prepared release notes on 2026-08-22;
Amazon review and publication remain external.

The `.2` buffer map already ruled out late fetching, so do not change buffer
goals for this symptom.

As of 2026-08-22, the hidden-network connection issue was resolved on the Fire
TV Stick by selecting WPA3 instead of WPA2 while entering the network. No router
encryption change is needed. If the profile must be recreated, use WPA3 with
the existing hidden SSID and credential. Local diagnostic screenshots were
deleted; any remaining `/tmp/firestick-*.png` files on the device are temporary
and can be removed during a later connected maintenance session.

## Deeper references

- `docs/IMPLEMENTATION_STATUS.md`: authoritative chronological findings and
  current gate.
- `docs/release-build.md`: exact artifact, checksum, and verification.
- `docs/crash-investigation-2026-08-13.md`: native parser/ANR analysis and the
  W3C Media upgrade path.
- `docs/deferred-work.md`: isolated follow-up experiments.
- `AUDIO-EDITION.md`: audio architecture and Vega handoff notes.
