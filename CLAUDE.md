# Astra — Project Context

Astra is an open-source Jellyfin/Emby media client for Amazon Fire TV devices
running **Vega OS** — Linux-based, with a *modified* React Native runtime.
It is **not** Android and **not** standard React Native. Repo:
`wangdangel/astra-tv`, GPL-3.0.

## Non-negotiable rules

- **Never use Android TV or standard React Native patterns.** Vega OS has its
 own APIs. When a coding challenge involves playback, input handling, media
 keys, or device profiles, consult Amazon's Vega OS documentation and the
 reference repos below before writing code. If unsure whether an API is
 Vega-native, say so and check rather than guessing from Android TV muscle
 memory.
- **Vega-native APIs only:** `@amazon-devices/react-native-w3cmedia`,
 `@amazon-devices/react-native-kepler`.
- **No APK, no ADB, no Android APIs. Ever.**
- **Diagnose before patching.** Do not attempt a fix without first pulling
 and reading the actual crash artifact. Vega crashes are ACRs, not Android
 tombstones — retrieve with `vega device copy-logs --artifact ACR`. State
 the hypothesis for *why* a bug occurs and what in the log supports it
 before touching code. Three prior fix attempts on the ANR crash failed
 because this step was skipped — do not repeat that.
- **No feature paywalling.** The Pro tier ($3.99 Amazon IAP) only removes a
 periodic nag screen. Never gate functionality behind it.

## Reference repos (pull these into a local `reference/` folder, do not vendor into build)

- `AmazonAppDev/vega-sports-app`
- `AmazonAppDev/vega-video-sample`
- Jellyfin Android TV client (GPL) — used as a porting reference only, not a
 pattern source for Vega-specific code.

## Build / deploy

```
export KEPLER_SDK_PATH=$HOME/vega/sdk/0.23.8358
npm run build
$KEPLER_SDK_PATH/bin/vega run-app
```

- Test device ID: `GT533M0752050H4U`
- Test Jellyfin server: `https://jelly2.ambientflare.art` (Jellyfin 10.11.11,
 behind Cloudflare Zero Trust)
- `vega device` uses `--device`, not `--deviceId`
- `vega exec` does **not** do shell interpretation by default — pipe
 expressions need `vega exec bash -c "..."`
- `inputd-cli` is device-side only: `vega exec vda -s GT533M0752050H4U shell inputd-cli start`

## Architecture notes

- Shaka Player (vendored, `src/w3cmedia/shakaplayer/ShakaPlayer.ts`, v4.8.5,
 not in package.json) is required for `.m3u8`/`.mpd`. Direct `video.src`
 only works for static MP4.
- Jellyfin `DeviceProfile` is mandatory in the PlaybackInfo POST — without
 it, Jellyfin returns raw MKV URLs the W3C VideoPlayer can't handle.
 Extracted to `src/services/jellyfin/deviceProfile.ts`,
 `buildDeviceProfile(prefs)`.
- Persistence is `AsyncStorage` (`upsertServerProfile()` /
 `getLastUsedServerProfile()`) — not SQLite. SQLite metadata caching was
 evaluated and rejected (Jellyfin responses are small, Cloudflare-proxied
 responses are fast enough).
- Vega OS image caching is OS-level — standard `Image` performs the same as
 `react-native-fast-image` per Amazon's docs. Don't add image caching.
- Menu-button contextual overlays use `TVEventHandler 'menu'`.
- `serverType` is stored at setup but `src/services/jellyfin/index.ts` has
 zero conditional branching on it — all calls are unconditionally
 Jellyfin-shaped. Emby shares MediaBrowser API heritage with Jellyfin, so
 this needs minimal conditional logic, not a rewrite.
- Plex (OAuth-based, incompatible with MediaBrowser heritage) and Kodi
 (needs a separate bridge addon) are intentionally hidden from the UI.

## Open issues, priority order

1. **4K HDR ANR crash (highest priority).** Dawn of the Planet of the Apes,
 4K HDR MKV, MediaSourceId `52f026b02b9523c888531fd4ca914718`. Crashes at
 "Preparing playback." Confirmed via ACR as a JS-thread ANR
 (`LCM_ANR_THREAD_NAME: JSReactThread`, `LCM_ANR_REASON: Thread Monitor`) —
 **not** a native decoder crash. Three prior attempts (commits `7634191`,
 `e92a1e3`, `08c8be4`) misdiagnosed the layer and are known-bad. Cold-start
 vs. resume distinction is still unresolved.
2. Emby conditional branching in `src/services/jellyfin/index.ts`.
3. Library info panel needs a skeleton loading state when `focusedItem` is
 null.
4. D-pad media-key focus leak: video surface retains media-key focus during
 UI browsing when a player screen is loaded, so D-pad is misread as
 transport commands.
5. `undefined` segment appearing in release artifact paths (pre-store-submission blocker).

## Working state

- Active branch: `main`. Last commits: `842bdee` → `decdd5f` (UI pass), then
 the three ANR attempts above (misdirected, informational only).

## Verification

- After any playback-path change: build, deploy to `GT533M0752050H4U`, and
 reproduce the specific MediaSourceId above before declaring a fix.
- Report any command that couldn't be run rather than assuming success.
