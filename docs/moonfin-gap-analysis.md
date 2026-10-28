# Moonfin Vega port: gap analysis (2026-10-27)

Moonfin (MPL-2.0) runs its web app inside a Vega WebView with a small React
Native shell around it. Astra is native React Native with W3C Media and Shaka.
This note records what we learned by reading Moonfin's Vega packages
(`packages/build-vega/shell`, `packages/platform-vega`, `perfTier.js`) and its
Vega commit log from 2026-10-02 to 2026-10-26, as of Moonfin commit `de7db03b`. No Moonfin code
is used in Astra; anything built from these notes is our own implementation.

Hardware facts come from Amazon's device specification page, not from Moonfin:
<https://developer.amazon.com/docs/device-specs/device-specifications-fire-tv-streaming-media-player.html>

## The three Vega sticks

| Stick | Model | OS | ABI | RAM | H.264 | HEVC | VP9 | AV1 |
|---|---|---|---|---|---|---|---|---|
| Fire TV Stick 4K Select (2025) | AFTCA002 | Vega OS 2.0 | 32-bit (armv7) | 1 GB | 4K60, 30 Mbps | 4K60, 35 Mbps | 4K60, 30 Mbps | 4K60, 100 Mbps |
| Fire TV Stick 4K, 3rd Gen (2026) | AFTCR001 | Vega OS 2.0 | 32-bit (armv7) | 1 GB | 4K30, 20 Mbps | 4K60, 35 Mbps | 4K60, 30 Mbps | 4K60, 25 Mbps |
| Fire TV Stick HD (2026) | AFTCL001 | Vega OS 2.0 | 32-bit (armv7) | 1 GB | 4K30, 20 Mbps | 4K60, 35 Mbps | 1080p60, 20 Mbps | 4K60, 25 Mbps |

All three run the same MediaTek MT8698 family with four Cortex-A55 cores and
1 GB of RAM. The lab stick (`GT55NP0263130L67`) reports **AFTCR001** in
`/etc/platform-info`, so it is the 3rd-gen 4K stick, not the 4K Select.

## Lessons and features

"Native?" says whether the lesson applies to Astra's native player or only to a
WebView app. Effort: S = under a day, M = a few days, L = a week or more.

| # | Lesson or feature | In Astra today? | Native? | Recommendation | Effort |
|---|---|---|---|---|---|
| 1 | Build for armv7. Moonfin's Vega build only produces `armv7-release`. | **Yes.** Since 1.4.1, `build:release` and `build-submission.sh` target armv7, and the README says so. 1.5.1 shipped armv7 only. | Yes | Confirmed: all three sticks are 32-bit, so armv7 is the only package to ship. x86_64 stays for the Vega Virtual Device. Nothing to build. | none |
| 2 | Model from the user agent (`AFTCR001 user/55`). | No. Astra sends no model anywhere. | Partly. We have no WebView user agent. React Native's Kepler `Platform.constants` is typed with `Model` and `Release`, but on the AFTCR001 stick it only returns `isTesting`, `reactNativeVersion`, `uiMode` and `keplerOSVariant` (checked on device 2026-10-27). | Add `model` and `os` to telemetry events, Stats for Nerds and About. The values come from Amazon's `@amazon-devices/react-native-device-info` (`getModel()`, system version; approved by Levi 2026-10-27, an OS system module so the package gains no native library). On AFTCR001 it reports the model and OS 2.0. An unrecognised model gets the strictest H.264 limit (20 Mbps). | S |
| 3 | Per-model decoder bitrate caps, with HEVC left uncapped because remuxes play far past the 35 Mbps Amazon lists. | Partly. Astra declares a decoder width cap (issue #21) and the user's bitrate cap, but no per-codec bitrate limit. | Yes, as Jellyfin `CodecProfile` conditions. | Add the H.264 `VideoBitrate` limit from the table above. Leave HEVC uncapped. VP9 and AV1 are never copied into Astra's HLS profiles (only HEVC and H.264 are), so a limit on them would change nothing. | S |
| 4 | Transcodes as fMP4 HLS with `hevc,h264` and 2-second segments. | Astra deliberately uses **MPEG-TS for HEVC**, because Jellyfin's fMP4 muxer duplicated open-GOP timestamps and caused micro-stutter on Vega. H.264 already uses fMP4. | Partly. Moonfin moved off TS because the **WebView** drops HEVC inside TS, which Shaka does not. Their 2-second segments are tied to WebView buffering. | Add an off-by-default playback setting that sends HEVC as fMP4 with 2-second segments, then compare it with TS on the stick. Keep TS as the default until a long device run says otherwise. | S to build, M to test |
| 5 | Send the stop report from the shell when the app goes to the background. | Astra stops and returns to details on background, but the stop report waits in the native queue behind any running load or unload. A kill during that wait loses it. | Yes. The cause differs: Moonfin's page scripts freeze, while ours wait on the native release. | Send the stop report as soon as the app goes to the background, before releasing media. | S |
| 6 | The shell turns network loss into online and offline events. A reconnect overlay with Retry (their live TV commit). | No. A dropped network leaves a spinner or a playback error. | Yes. `keplerscript-netmgr-lib` is already a dependency. | Add an app-wide "no connection" overlay with Retry, driven by netmgr events. Use only the system's connected flag: the library's own reachability check would request `clients3.google.com`, a new endpoint, so Astra turns it off. | M |
| 7 | A second Back exits to the launcher. | Astra has its own version: three Backs within 2.2 s on Home open an Exit / Cancel prompt. | Yes | Keep Astra's three-Back guard for opening the prompt, and make Back on the open prompt exit. Stay stays focused, and a Back within half a second of the prompt opening is ignored so a held key cannot open and close it in one go. | S |
| 8 | Performance tier from the Chrome version. | No. | No. On Vega it always reads "high": every stick reports Chrome 144, and Moonfin's own test expects that. | **Skip.** All three sticks share the same SoC and RAM, so there is no low-end Vega device to detect. Astra already has the focused-backdrop switch, and the memory-trim work covers the real limit (1 GB). Revisit only if a slower Vega device ships. | none |
| 9 | Hide the cast button the WebView draws over video. | Not applicable. | No (WebView only) | Nothing to do. | none |
| 10 | Live TV needs a TS profile. | Astra has no live TV. | WebView quirk | Note it for if we ever add live TV. | none |
| 11 | PCM-in-MKV direct play, and hls.js with smaller buffers for high-bitrate remuxes. | Direct play is off in Astra; Shaka's buffer goals are already tuned. | WebView only | Nothing to do. | none |
| 12 | System media controls. | **Yes** (`kepler-media-controls`). | Yes | Already done. | none |
| 13 | Device IP for LAN discovery. | **Yes** (`services/network`). | Yes | Already done. | none |
| 14 | Self-signed certificates allowed per host. | No. | WebView specific (`onSslError`) | Out of scope for now. | none |
| 15 | Sleep timer. | No. | Yes | Build it: 15/30/60/90 minutes and end of episode. When it runs out, report the position and stop, then pause. | M |
| 16 | Audio and subtitles picked from the Jellyfin user's own settings. | Partly. Astra uses its own app settings (preferred audio language, subtitle mode and language) and the server's default subtitle. It does not read `AudioLanguagePreference`, `SubtitleLanguagePreference`, `SubtitleMode`, `PlayDefaultAudioTrack` or the Remember settings. | Yes | Use the server user's settings when Astra's own are left on the default. Skip commentary and audio-description tracks, add a fallback language, and remember manual picks per series. | M |

### Already done (confirmed on main)

- **Quick Connect:** `jellyfin/auth.ts`, Setup screen.
- **LAN server discovery:** `jellyfin/discovery.ts`, `services/network`.
- **Still-watching prompt:** PlayerScreen.
- **Merged Continue Watching / Next Up:** HomeScreen and the home-section settings.
- **Language localization:** PR #41 (`feat/i18n`), not merged yet.

### Out of scope

Seerr and Jellyseerr, or anything else that requests or downloads content (an
Appstore policy risk). Also out: the themes store, games, books and achievements.

## Plan

| PR | Base | Contents |
|---|---|---|
| P0 | feat/i18n | Rows 2, 3 and 4: model and OS in telemetry and Stats for Nerds, per-codec bitrate caps, and the fMP4 HEVC experiment setting. Plus the device test checklist. |
| P1 | P0 | Rows 5, 6 and 7: early stop report, connection overlay, Back on the exit prompt. |
| P2 | P1 | Rows 15 and 16: sleep timer and server-driven track selection, translated. |
| P3 | P2 | Supporter features. Needs the Ko-fi link, the playback count and Amazon IAP SKUs first. |

All four stack on `feat/i18n` (PR #41), because each one adds translated
screen text and the settings screen was rewritten for translation there.

## Checked against the server (2026-10-27)

PlaybackInfo replayed on Jellyfin 10.11 with the new profiles:

| Source | Profile | Server decision |
|---|---|---|
| H.264, 12 Mbps | TS, limit 20 Mbps | video copied |
| H.264, 12 Mbps | TS, limit 8 Mbps (test) | video re-encoded at 8 Mbps (`VideoBitrateNotSupported`) |
| HEVC HDR10, 23 Mbps | TS, any limit | video copied, no bitrate target |
| HEVC HDR10, 23 Mbps | fMP4 experiment, limit 20 Mbps | video copied, segment length 2 |

So the limit does what it should. One side effect: in the fMP4 experiment, HEVC
and H.264 share one transcoding profile, and Jellyfin applies the H.264 limit as
that profile's bitrate target. An HEVC **copy** is unaffected, but an HEVC
**re-encode** (subtitle burn-in, for example) aims at 20 Mbps instead of the
viewer's bitrate cap. That is acceptable for an off-by-default experiment, and
it is something to watch in the device test.

## Notes

- **Telemetry is opt-in only.** It is armed on a device only by entering the
  operator phrase, so adding the model to it is good for lab devices and testers.
  It will not give a fleet-wide count of daily users or crashes by model. The
  Appstore console's own reports already break those down by device. Fleet-wide
  telemetry would be a new data collection decision and is not part of this work.
- **The lab stick is AFTCR001.** We do not have a 4K Select (AFTCA002) or an
  HD stick (AFTCL001) in the lab, so those rows of the test checklist need
  hardware we don't have.
