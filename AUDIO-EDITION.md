# Astra — Audio Edition: Handoff Notes

**Date:** 2026-07-27
**Purpose:** Complete context for adding music playback to Astra, written for
someone (or something) picking this up cold.
**Status:** Music browsing and playback work end to end. Device testing
confirmed both progressive HTTPS playback and AAC/TS HLS playback from a plain
`http://192.168.x.x:8096` Jellyfin server. The HLS compatibility fix and remote
control corrections are implemented on the `music` branch.

---

## 1. What Astra is

A Jellyfin client for **Amazon Fire TV running Vega OS** (a.k.a. Kepler) — not
Android TV. React Native 0.72 against the `@amazon-devices/*` SDK.

- Repo: `github.com/AmbientFlare/astra-tv` (public)
- Package id: `com.astra.tv`, component `com.astra.tv.main`
- Shipping version 1.0.3; this music work is targeting **1.1.0**
- Video playback already shipped and works

**Vega is not Android.** Do not assume Android TV APIs, `react-native-track-player`,
`react-native-fs`, MMKV, or any other native module works. The available Amazon
packages are listed in `package.json`; anything else must be verified on npm and
tested on device.

### Platform constraints discovered

- **No filesystem API.** Persistence is `AsyncStorage` (key/value) only. Any
  design involving caching artwork or media to disk is a non-starter.
- **The system screensaver does not fire during audio playback.** Verified: 14
  minutes idle, no screensaver. Burn-in protection must be built in-app.
- **Background audio works.** Audio continues when the app is backgrounded —
  measured 35.1s of playback across a 35s backgrounded gap, exactly real-time.
  Amazon's own audio sample pauses on background *by choice*; do not copy that.
- **No JS console access from the host.** `vega device copy-logs` returns system
  logs only. `console.log` from the app is not retrievable. **All diagnosis must
  render on screen.** This is the single most important workflow fact here.

---

## 2. The open problem

### Symptom

Playing any track from an `http://` Jellyfin server fails instantly. The player
reports `readyState 0 (HAVE_NOTHING)`, emits `error`, and the queue advances.
The same track from an `https://` server plays perfectly.

### What was ruled out — do not re-test these

| Hypothesis | How it was ruled out |
|---|---|
| Bad stream URL | Fetched the exact failing URL from a machine on the same LAN: `206 Partial Content`, `audio/mpeg`, `accept-ranges: bytes`. |
| Invalid/expired token | Same fetch succeeded with the same token. |
| `%2C`-encoded commas in `Container` | The working https playback uses the identical encoding. |
| Wrong `Container` list | Server direct-plays correctly with it; verified 206 responses. |
| Missing media control focus | Added `setMediaControlFocus()` before `initialize()`. Did not fix it. (Kept anyway — required for remote control.) |
| Jellyfin could return an https URL | `/System/Info/Public` reports `"LocalAddress": "http://192.168.0.18:8096"`. No TLS on 8920 or 8096. The https address is a **reverse proxy** in front of the same server. |
| **Cleartext blocks all media** | **WRONG.** Video plays fine over `http://192.168.0.18:8096`. |

### The actual cause (high confidence, not yet proven by fix)

**Cleartext is blocked for *native* media fetches, not for media in general.**

| Path | Who fetches | Cleartext | Result |
|---|---|---|---|
| Browsing / metadata / artwork | JS `fetch` | http | works |
| **Video** — HLS via ShakaPlayer | **JS** — Shaka pulls segments, feeds MSE | http | **works** |
| **Audio** — `AudioPlayer.src = url` | **native media pipeline** | http | **fails** |
| Audio | native media pipeline | https | works |

The variable is **who performs the fetch**, not the scheme alone and not
audio-vs-video. Anything JavaScript downloads is fine over cleartext. Handing a
cleartext URL to the native player fails.

Video escapes this only incidentally: `getStreamUrl` sets
`EnableDirectPlay: false` / `EnableDirectStream: false` (see
`src/services/jellyfin/index.ts`, ~line 961), forcing HLS. Shaka then does all
downloading in JS and the native layer only ever receives buffers.

---

## 3. The implemented fix

Route audio the way video already goes: **HLS through ShakaPlayer**, so the
fetch happens in JS.

Verified working against the LAN server **over plain http**:

```
GET /Audio/{id}/universal?UserId=…&Container=aac&TranscodingContainer=ts
    &TranscodingProtocol=hls&AudioCodec=aac&api_key=…

HTTP/1.1 200 OK
Content-Type: application/vnd.apple.mpegurl

#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=256000,AVERAGE-BANDWIDTH=256000,CODECS="mp4a.40.2"
main.m3u8?…
```

**Critical gotcha:** the source container must be **excluded** from `Container`.
Leaving `mp3` in the list makes Jellyfin direct-play and silently ignore every
HLS parameter — it returns the raw MP3 with ID3 tags. This wasted a cycle.

### Recommended strategy — choose per server, not globally

| Server scheme | Strategy | Cost |
|---|---|---|
| `https://` | Direct play, progressive (current behaviour) | None. No server work, seeking proven working. |
| `http://` | HLS via ShakaPlayer | One transcode per track. |

Rationale: most self-hosters run plain http on a LAN, so audio must work there;
but imposing a transcode on https users who currently get free direct play would
be a regression. Pick based on `isCleartextUrl(session.serverUrl)`.

### Implementation

1. `src/services/audioPlayer/index.ts` selects HLS when the saved server URL is
   cleartext and progressive direct play for HTTPS.
2. The HLS branch wraps the shared `AudioPlayer` with ShakaPlayer and unloads
   the adaptive instance cleanly between tracks or before video playback.
3. `getAudioHlsStreamUrl` in `src/services/jellyfin/music.ts` requests AAC/TS
   HLS and deliberately advertises only `Container=aac`.
4. Device testing confirmed playback, FF/RW seeking, D-pad track changes,
   background audio, play/pause, and music-to-video handoff over local HTTP.

### Alternatives not tried

- Fetching audio in JS and feeding MSE directly, bypassing Shaka. More control,
  much more code.
- Asking the user to put TLS in front of their LAN server. Rejected — pushes
  platform limitations onto users.
- A local reverse proxy inside the app. Not possible; no server capability.

---

## 4. What is built and working

| Area | Path | Notes |
|---|---|---|
| Music API | `src/services/jellyfin/music.ts` | Paginated; validated against a live server |
| Queue model (pure) | `src/services/audioQueue/index.ts` | 24 tests, no I/O |
| Playback engine | `src/services/audioPlayer/index.ts` | Singleton; outlives screens |
| Remote input | `src/hooks/useRemoteInput.ts` | Handles three separate Vega input hazards |
| Music gating | `src/hooks/useMusicAvailability.ts` | Library presence AND user preference |
| Top-level nav | `src/components/LibraryNav/` | Movies / TV Shows / Music / Playlists |
| Browse | `src/screens/MusicScreen/` | Infinite scroll, A–Z rail with position marker |
| Artist / Album | `src/screens/ArtistDetailScreen/`, `AlbumDetailScreen/` | |
| Genre / Playlist | `src/screens/MusicCollectionScreen/` | |
| Now-playing bar | `src/components/NowPlayingBar/` | Docked; **carries on-screen diagnostics** |
| URL handling | `src/services/serverUrl/index.ts` | Scheme resolution, casing, cleartext detection |

**151 tests passing.** `npm test`, `npm run lint`.

### Vega input hazards (all confirmed on device)

1. **Every key event fires twice** — down and up phases; some keys also emit a
   separate `<key>_up` type. Observed advancing two tracks on one press.
2. **A fixed dedupe window is insufficient.** A handler slower than the window
   (async fetch, ~1.4s diagnostic) lets the up-phase through. The window must
   stay open until the handler settles.
3. **Skip buttons fire on two channels at once** — one press emits both
   `DPAD: skip_forward` and `KMC: FAST_FORWARD`. Deduping cannot catch this;
   each action must be owned by exactly one channel.

`useRemoteInput` handles all three. Reuse it; do not hand-roll.

### Other device-confirmed facts

- Reassigning `player.src` on a live `AudioPlayer` changes track — no
  teardown/rebuild per track needed (Amazon's sample rebuilds; unnecessary).
- `ended` sometimes fires **twice** for one track. Guard queue advance.
- Seeking past `duration` fires `ended` and advances. Clamp to `duration - 0.5s`.
- `AudioPlayer` seeking works over direct play: both `currentTime =` and
  `fastSeek()` move playback, `seekable` reports the whole file.
- `manifest.toml` must declare `Next`/`Previous` in `command_options` or the
  remote's skip buttons fall back to *seek*. This was also silently broken for
  video.
- The TV keyboard **auto-capitalizes**, producing `Http://…`. React Native's
  `URL` rejects a non-lowercase scheme → "Invalid base URL" on every request.
  `normalizeServerUrl` now lowercases scheme and host.

---

## 5. Jellyfin API notes (validated against a live server)

- **Genres:** `/Users/{id}/Items?IncludeItemTypes=MusicGenre` returns **0**.
  Use `/MusicGenres`. `/Genres?IncludeItemTypes=MusicAlbum` also returns 0.
- **Empty filter ids return the entire library.** `AlbumArtistIds=` returned all
  821 albums; `ArtistIds=` returned all 11,547 tracks. Every id-scoped call must
  refuse an empty id (`requireId` in `music.ts`).
- **Album artists:** `/Artists/AlbumArtists`, not `/Users/{id}/Items`.
- **`NameStartsWith` matches SortName**, so "The Beatles" files under B.
- **`UserViews` collection types observed:** `movies`, `music`, `playlists`,
  `tvshows`. Playlists is its own view, not a filter over music.
- **Use `/UserViews`, never `/Library/MediaFolders`** — the latter is admin-only
  and 403s for normal users (fixed in 1.0.3).

### Reference library (for scale expectations)

Jellyfin **10.11.11**. 821 albums · 11,547 tracks · 157 album artists · 18
playlists. **98.3% mp3**, 1.4% m4a, ~0.3% exotic (asf/wv/ape). Median 192 kbps.

**Every play count is 0.** Jellyfin exposes only the local user's `PlayCount`
and there is no global popularity, so any "Popular tracks" feature needs a
fallback chain. `getArtistTopTracks` does played → rated → newest album, and the
UI labels the section "Popular" only when play counts actually exist.

---

## 6. Build, deploy, debug

```bash
export KEPLER_SDK_PATH=/home/levi/vega/sdk/0.23.8358
export PATH=/home/levi/vega/bin:$KEPLER_SDK_PATH/bin:$PATH

npm run lint && npm test
npx react-native build-vega --build-type Release --target x86_64 \
  --build-number <YYYYMMDDNN> --build-version 1.0.4

VPKG=build/private/kepler/@amazon-devices/astra/undefined/vega/x86_64/Release/@amazon-devices/astra_x86_64.vpkg
vega device list
vega run-app "$VPKG" com.astra.tv.main
vega device installed-packages
vega device uninstall-app --appName com.astra.tv.main   # note: --appName, takes the COMPONENT id
```

Target device: Fire TV stick `GT533M0752050H4U`, x86_64. Only x86_64 is needed —
aarch64/armv7 mapped to zero supported devices at submission.

### Paused-video system idle suppression

Astra includes a local native IDL Turbo Module at
`packages/astra-user-engagement`. It calls Vega's
`com.amazon.kepler.user_engagement` API while video is paused, preventing the
system idle experience from preempting Astra's own three-minute paused-video
visual. The hint starts immediately on pause and stops on resume or player
unmount; it is intentionally not held during ordinary app browsing.

The native module must be built before a clean application build:

```bash
(cd packages/astra-user-engagement && \
  vega build --target x86_64 --buildType Release)
```

The resulting release library and Turbo Module manifest are retained in the
package directory so application autolinking can stage the module. Vega treats
engagement as a reviewed hint, not an unconditional system guarantee, so verify
the behavior on physical hardware.

### Audio idle input contract

The audio visual activates after three minutes. Album art and the title/artist
block travel independently over separate broad four-point paths. Each circuit
takes about one minute and explicitly ends at its own starting coordinate, so
the native animation loops continuously without a visible reset or teleport.
Artwork changes every 30 seconds without fading the cover to black.

The first physical remote press is wake-only: it dismisses the overlay without
performing its normal action. `audioIdleGate` blocks both down/up delivery for
600 ms and is checked by `useRemoteInput`, `FocusableItem`, and the native
Kepler Media Controls handler. This covers D-pad navigation, Select, dedicated
transport buttons, system transport UI, and voice-driven media commands. The
next physical press operates the normal playback or navigation control.

Individual track rows on album, playlist, and artist screens expose visible
`Play next` and `+ Queue` controls. Do not make queue discovery depend on
Vega's Menu event; its delivery is not consistent across remote models.

### Debugging workflow — important

**There is no way to read the app's JS console from the host.** Every diagnosis
in this project came from rendering state on screen and photographing the TV.
The `NowPlayingBar` currently shows `ready=<readyState>` and the stream URL
(origin + path only) for exactly this reason. Keep that pattern.

The `readyState` values are the highest-signal diagnostic:
`0 NOTHING · 1 METADATA · 2 CURRENT · 3 FUTURE · 4 ENOUGH`.
`0` means nothing was fetched at all; `3`+ means audio is genuinely decoding.

**Never print query strings on screen** — they contain the access token. This
already leaked once into a photograph.

### Reference apps

`reference/` (gitignored) holds cloned samples. `vega-audio-sample` is Amazon's
official music player (MIT-0) — the closest prior art. `vega-sports-app` has the
only headless-player example. `finloop/react-native-jellyfin-client` is a
parallel Jellyfin-on-Vega client, video-only, MIT-0. `vega-scrolling-sample` has
FlashList + pagination patterns.

**Metro must not crawl `reference/`** — several samples ship an identically named
`plugins/eslint-plugin-amzn-a11y/package.json` and Haste collides. A `blockList`
in `metro.config.js` handles this.

---

## 7. Remaining work

**Blocking:**
1. **HLS audio path for http servers** — section 3 above.

**Feature work (task 9, partly done):**
2. Full now-playing screen (the docked bar exists).
3. Per-track queue actions — the menu button currently does nothing.
4. **In-app idle visual / screensaver.** Required, not polish: the system
   screensaver does not fire during audio, so a static now-playing screen can
   burn in. Design agreed: after ~3 min idle, cross-fade artwork from the
   current album artist with drift; fall back to a single bouncing cover when
   only one image exists; any input dismisses instantly; never interrupts
   playback.

**Known issues:**
5. **Astra does not appear in the Fire TV "Apps & Channels" list**, though it is
   installed and launches via CLI. Untriaged. Suspect a launcher cache or a
   manifest category issue. Note the system log shows a missing
   `SplashScreenImages.zip` asset.
6. Playlists have no artwork (Jellyfin rarely sets it) — currently a letter
   placeholder. Could composite from the first few tracks' album art.
7. Remove the diagnostics line from `NowPlayingBar` once playback is stable.

**Deliberately deferred:**
- FlashList instead of FlatList — works but adds a native dependency.
- Adopting `LocalAddress` from `/System/Info/Public` when a server advertises
  https but the user typed http.
- Scheme recovery for already-stored profiles (`docs/deferred-work.md`).

---

## 8. Related documents

- `docs/music-support-notes.md` — full research log, including superseded
  conclusions and the evidence behind them.
- `docs/emby-support-notes.md` — Emby support analysis; blocked on an unresolved
  Emby Premiere transcoding question.
- `docs/deferred-work.md` — smaller deferred items with context.

## 9. A note on method

Three wrong conclusions were reached and corrected during this work:

1. "The vpkg package name is why the spike replaced Astra" — wrong; both
   packages later coexisted.
2. "Progressive MP3 can't seek because there's no byte-range support" — wrong;
   the server sends `accept-ranges` and seeking works fine.
3. "Vega can't play any media over cleartext HTTP" — wrong; video does.

Each came from reasoning ahead of the evidence, usually by comparing two cases
that differed in several variables at once. **The reliable loop here is: change
one variable, render the result on screen, photograph it.** It is slow and it
has been right every time.
