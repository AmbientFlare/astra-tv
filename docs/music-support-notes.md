# Music Support — Research Notes

Date: 2026-07-27
Status: historical research and implementation findings
Target: Astra 1.1.0

## Reference material

Three Vega sample apps now sit in `reference/` (gitignored, safe to clone into):

| App | Why it matters |
|---|---|
| `vega-audio-sample` | **Amazon's official music player sample.** MIT-0. Cloned 2026-07-27 from `github.com/AmazonAppDev/vega-audio-sample`. |
| `vega-sports-app` | Has the only local example of a **headless player service**. MIT-0. |
| `vega-video-sample` | Pre-existing video reference. |

`vega-audio-sample` structure mirrors Astra's almost exactly (`src/components`,
`src/screens`, `src/navigation`, `src/w3cmedia/shakaplayer`), so its patterns
port directly rather than needing translation.

Relevant patterns implemented by the sample:

- `src/utils/AudioHandler.ts` (516 lines) — the `useAudioHandler` hook: player
  init, track transitions, next/previous, buffering state, time updates
- `src/utils/AppOverrideMediaControlHandler.ts` (156 lines) — extends
  `KeplerMediaControlHandler` to wire TV remote play/pause/seek to the player
- `src/store/AudioProvider.tsx` (53 lines) — global playback context
- Components: `AlbumCarousel`, `AlbumGrid`, `AlbumDetailPage`, `TrackList`,
  `TrackItem`, `PlaybackControls`, `AudioSeekBar`, `AudioTile`
- Screens: `Home`, `Library`, `Player`, `PlaylistDetail`, `Search`, `Settings`

## Dependencies: nothing new is required

The audio sample's playback stack is entirely packages Astra **already has
installed at compatible versions**:

```
@amazon-devices/react-native-w3cmedia   2.1.99   (sample wants ~2.1.0)
  └── exports AudioPlayer, KeplerMediaControlHandler
@amazon-devices/kepler-media-controls   1.0.21   (sample wants ~1.0.0)
@amazon-devices/kepler-media-types      present
```

Note `kepler-media-controls` is currently a **declared dependency with zero
imports** in `src/` — it is the unused piece that the audio sample uses for
remote-control integration.

If the headless route is taken later, these are additionally needed and all
exist on the public npm registry (verified 2026-07-27):

```
@amazon-devices/headless-task-manager   1.2.7
@amazon-devices/kepler-player-server    2.2.11
@amazon-devices/kepler-player-client    2.2.11
@amazon-devices/keplerscript-audio-lib  2.0.17
```

## The two playback architectures

### A. In-UI W3C audio — what the official sample does

`AudioPlayer` from `react-native-w3cmedia`, driven from the UI thread, with
`KeplerMediaControlHandler` for remote integration. Simple, proven, no manifest
changes beyond a media-control module declaration.

### B. Headless player service — what the sports app does

A `[[components.service]]` using the headless runtime loader
(`/com.amazon.kepler.headless.runtime.loader_2@IKeplerScript_2_0`), a
`service.js` at project root registering `onStartService`/`onStopService` via
`HeadlessEntryPointRegistry`, and `PlayerServerFactory` creating a player server
that the UI talks to as a client. Playback runs in **its own JavaScript
runtime**, separate from the UI.

Amazon documents ~30% better time-to-first-frame for complex UIs, and headless
playback gets Vega Media Controls integration automatically.

Gotcha found in `HeadlessEntryPoint.ts`: the headless runtime has no
`window`/`navigator`/`self`, so W3C media globals must be manually shimmed
before use. The sports app does this in `initializeGlobalVariables()`.

## RESOLVED: background audio works. Use architecture A.

**Device spike, 2026-07-27, x86_64 Fire TV, Jellyfin 10.11.11.**
Throwaway spike app (`com.astra.tv.spike`), `AudioPlayer` only — no headless
service, no Shaka.

| Question | Result |
|---|---|
| Q1 Jellyfin audio plays via `AudioPlayer`? | **YES** — `/Audio/{id}/universal` with `Container=mp3&TranscodingProtocol=http`. `loadedmetadata duration=144.378`, played to completion. |
| Q2 Physical remote drives playback via KMC? | **YES** — `setMediaControlFocus` + a `KeplerMediaControlHandler` subclass. Remote play/pause logged `REMOTE -> toggle` and moved the player. |
| Q3 Audio survives backgrounding? | **YES** — see below. |
| Q4 Screensaver behavior | **Answered in v2 — does not fire.** See below. |

Q3 evidence:

```
18:44:20  APP STATE -> background @ 38.0s
18:44:55  APP STATE -> active @ 73.1s
18:44:55  RETURNED: 38.0s -> 73.1s (advanced 35.1s)
18:44:55  *** AUDIO KEPT PLAYING IN BACKGROUND ***
```

35.1s of playback across a 35s wall-clock gap — exact real-time, no throttling
or buffer drain. Audio genuinely continued while the app was backgrounded.

### Consequence

**Build architecture A.** The headless player service (architecture B) is *not*
needed and should not be built. That removes four dependencies
(`headless-task-manager`, `kepler-player-server`, `kepler-player-client`,
`keplerscript-audio-lib`), a `[[components.service]]` manifest entry, a
`service.js` entry point, the separate-runtime W3C global shims, and the whole
UI-as-client indirection.

Astra needs **zero new dependencies** for music playback.

The player must declare `AudioContentType.CONTENT_TYPE_MUSIC` and
`AudioUsageType.USAGE_MEDIA` in the `AudioPlayer` constructor — the spike did,
and this is the most likely lever the platform uses when deciding background and
screensaver policy. Do not leave these at defaults.

### Note: Amazon's sample pauses on background by choice, not by constraint

`reference/vega-audio-sample/src/screens/Player.tsx:206-221` explicitly calls
`audioRef.current?.pause()` on `BACKGROUND_STATE`. The spike proves the platform
does not require this. **Do not copy that handler** — it would suppress a
capability the device offers for free.

## Spike v2 results (2026-07-27) — remote, queue, screensaver

### Q4 Screensaver: DOES NOT FIRE during audio playback

Last remote input `18:58:07`, observed still playing at `19:12` — **14 minutes
idle, no screensaver.** Audio-only playback suppresses the system screensaver
the same way video does.

**Consequence: burn-in is a real risk and Astra must supply its own idle
visual.** A static now-playing screen could sit unchanged for hours on an OLED.

Agreed design direction: after ~3 minutes of audio-only playback with no input,
swap to an in-app screensaver — album art drifting around the screen
(DVD-logo style), or a slow cycle through artwork from the current album artist.
Must dismiss instantly on any remote input and must never interrupt playback.

This is a **product requirement, not polish** — it should be in the 1.1.0 scope,
not deferred.

### Q5 Remote mapping

| Input | Result |
|---|---|
| Dpad left / right | Track change (handled directly, not via KMC) |
| Dpad select | Play/pause — **fires twice per press** |
| Double-arrow FF / RW | Logs `FAST_FORWARD`/`REWIND` but **audio does not move** — see seek finding below |
| Mute, volume ± | Handled by the TV directly, never reaches the app |
| TV Guide button | Leaves the app; audio keeps playing. Backing out lands on the Fire TV main menu, not Astra. Acceptable — not worth fighting. |
| Menu | Delivers a `menu` event; nothing bound in the spike. `PlayerScreen` already binds this to its settings panel. |

### CONFIRMED BUG: every dpad event fires twice

Not cosmetic — it corrupts state. One physical press of RIGHT advanced **two**
tracks:

```
18:55:45  DPAD: right
18:55:45  load track 2/25: Lion — Hollywood Undead
18:55:45  DPAD: right
18:55:45  load track 3/25: Crawling Kingsnake — The Black Keys
```

**The fix already exists in shipping code** — `src/screens/PlayerScreen/index.tsx:982-996`
dedupes on the normalized event type with a 350ms window, stripping a trailing
`_up`:

```ts
const key = (event.eventType ?? '').replace(/_up$/, '');
if (lastHandledKeyEvent.current.type === key &&
    now - lastHandledKeyEvent.current.time < 350) { return; }
```

Any new input handling must reuse this. Consider extracting it to a shared hook
rather than copying it a third time.

### Seeking failed — and it is NOT a server/format problem

`FAST_FORWARD`/`REWIND` reached the handler and set `player.currentTime`, but
playback position did not change.

**An earlier revision of this note blamed progressive MP3 for lacking byte-range
support and concluded music must use HLS. That was wrong.** Direct measurement
against the server on 2026-07-27 disproves it. All three URL strategies return a
fully seekable static file:

```
A) universal, with the spike's forced mp3 transcode params
B) universal, with a real container list and no transcode hints
C) /Audio/{id}/stream?static=true

   all three ->  HTTP/2 206
                 accept-ranges: bytes
                 content-range: bytes 0-99/10948504
```

The server serves the **original file** with full range support in every case.
Nothing is being transcoded or repackaged, and there is nothing wrong with the
bytes on the wire.

**So the seek failure is client-side, in Vega's `AudioPlayer`.**

### Library composition (probed 2026-07-27)

11,547 audio items. Sample of 3,000:

| Container | Share | | Codec | Share |
|---|---|---|---|---|
| mp3 | 98.3% | | mp3 | 98.3% |
| m4a | 1.4% | | alac | 0.6% |
| asf / wv / ape | 0.3% | | flac / aac / wmav2 / wavpack / ape | 1.1% |

Median bitrate 192 kbps, max 3086 kbps.

**With a proper `Container` list, ~99.7% of this library direct-plays with zero
transcoding.** Only ~10 files (ASF/WavPack/APE) would need conversion. Forcing
`Container=mp3&TranscodingContainer=mp3&AudioCodec=mp3` as the spike did is
unnecessary and should not be carried into the real implementation — send the
full list of natively supported containers and let the server direct-play.

### RESOLVED by spike v3 (2026-07-27): seeking works, with direct play

Removing the forced transcode fixed it completely. v3 requests only
`Container=mp3,m4a,aac,flac,alac,ogg,opus,wav,webma` with **no**
`TranscodingContainer`, `TranscodingProtocol`, `AudioCodec`, or
`MaxStreamingBitrate`. Jellyfin direct-plays the original file and the player
reports the whole file as seekable:

```
seekable: [0.00-215.48] len=1
t=127.08 dur=215.48 ready=3 seeking=false

try currentTime = 157.09
  immediately after: t=157.09 ready=3 seeking=true
  event: seeking / event: seeked -> t=157.22
  after 700ms: t=157.63 (moved 30.54s)
  *** currentTime SETTER WORKS ***

try fastSeek(187.63)
  event: seeking / event: seeked -> t=187.81
  after 700ms: t=188.18 (moved 30.54s)
  *** fastSeek WORKS ***
```

Both seek methods work. `seeking`/`seeked` events fire correctly. 10-second
skips via the remote also land correctly (`seek +10: 4.36 -> asked 14.36`,
`landed t=14.87 (MOVED)`).

**Conclusions for the real implementation:**

1. **Never force a transcode for music.** Send the native container list and let
   the server direct-play. ~99.7% of this library plays untouched, seeking works,
   and the server does no work.
2. **HLS is not needed for audio.** Shaka stays out of the music path entirely.
   Reserve transcoding for the ~0.3% exotic formats (ASF/WavPack/APE).
3. `currentTime = x` is sufficient; `fastSeek()` is available but unnecessary.

### The double-arrow buttons fire on TWO channels at once

One physical press emits **both** a dpad event and a KMC command:

```
19:25:22  DPAD: skip_forward
19:25:22  KMC:  FAST_FORWARD
19:25:22  seek +10: 4.36 -> asked 14.36
```

v3 only acted on the KMC side (its dpad switch ignores `skip_forward`), so one
press produced one seek. **The real player must deliberately pick one channel
per action** — if both the `useTVEventHandler` switch and the
`KeplerMediaControlHandler` act on skip, every press seeks twice as far.

The 350ms dedupe does **not** protect against this, because the two events
arrive on different paths with different type strings.

### Seeking past the end advances the track

```
19:25:17  seek +10: 207.99 -> asked 217.99   (track is 215.48s)
19:25:17  event: seeked -> t=215.48
19:25:18  event: ended -> advance
```

Reasonable, but should be deliberate: clamp to `duration - ~0.5s`, or treat
end-overshoot as an explicit "next track". Do not leave it accidental.

### Dedupe fix confirmed working

Dpad events no longer double-fire; repeated `select` presses log as distinct
events seconds apart rather than paired within the same second.

### Superseded: what v3 was originally going to isolate

`MediaPlayer` (the `AudioPlayer` base, `dist/MediaPlayer.d.ts`) exposes the full
HTML media seek surface: `set currentTime`, `fastSeek(time)`, `get seekable():
TimeRanges`, `get seeking()`, `get duration()`, `get readyState()`.

The setter exists, so the API call was not wrong. Leading hypothesis: the player
reports **`seekable.length === 0`** for a progressive HTTP source and silently
ignores `currentTime` writes. The one observed `duration=NaN` supports the idea
that the player sometimes fails to establish a timeline for these streams.

v3 should log, around a seek attempt:

- `duration`, `readyState`, `seeking`
- `seekable.length` and each range's `start`/`end`
- `currentTime` immediately before and ~500ms after the write
- the same for `fastSeek()` as an alternative path

Answered above — progressive direct play seeks fine. HLS is not needed.
`vega-audio-sample`'s `loadAdaptivePlayerData` shows the `ShakaPlayer` wrapping
pattern if an exotic format ever forces transcoding, but it is not the default
path.

### Q6 Track advance: reassigning `src` on a live player works

Tracks 1→5 auto-advanced cleanly on `ended` by assigning `player.src` and
letting `loadedmetadata` trigger `play()`. **No need to tear down and rebuild the
player per track**, which is what `vega-audio-sample` does. Simpler, and it
survived repeated rapid track changes.

### Minor: `duration=NaN` observed

`loadedmetadata duration=NaN` on one track during rapid switching. Cause unknown
— possibly the MP3 transcode not reporting duration before buffering, or a race
from back-to-back track loads. Re-check under HLS; if it persists, the UI needs
to tolerate an unknown duration rather than render `NaN`.

### Open question deferred, not answered

Whether Appstore review objects to a music app that keeps playing when
backgrounded is still unknown. The platform permits it; policy is a separate
matter. Worth checking before submission, not before building.

## Track-end behavior needs handling (found during the spike)

At end of track the player emits `ended`, and subsequent remote presses produce
`REMOTE -> toggle` in the log but **no** `playing`/`pause` event — calling
`play()` on an ended player parked at its final position does nothing. From the
user's seat the remote appears dead.

```
18:46:00  event: ended
18:46:17  REMOTE -> toggle      <- no resulting event
18:46:23  REMOTE -> toggle      <- no resulting event
18:46:33  event: ended
```

Real player must, on `ended`, either advance the queue or reset
`currentTime` to 0 before re-arming play. A duplicate `ended` also fired, so the
handler needs to be idempotent — guard against double-advancing the queue.

## Product requirements captured during research

The reference point was Jellyfin's Android TV client, adapted for Vega and
remote-first navigation.

### Library organization

- Jellyfin's tab order (Album suggestions / Album Artists / Artists / Playlists /
  Songs / Genres) is **wrong**. Preferred default: **Artists → Albums → Genres →
  Playlists**.
- Keep the A–Z + `#` side rail for jump-scrolling — it is the one thing the
  Jellyfin client gets right.
- **Infinite scroll**, not 100-per-page pagination. Library size in question is
  **821 albums**.
- View mode (List / Poster) should be remembered **per section** — albums,
  album artists, artists and playlists can each have their own. Poster preferred
  over Postcard; Postcard is near-identical and can be dropped.

### Artist screen — Spotify-shaped, not a flat grid

- Artist hero, then **top ~10 tracks**, then albums.
- An expand-all control that drops every album's tracks inline in order, so a
  queue or playlist can be built without drilling into each album.
- `Play all` and `Shuffle albums` actions.

### Album screen

Jellyfin shows: track count, runtime, year, then Play / Instant Mix / Shuffle /
Favorite, then an overflow with Add to collection, Add to playlist, Download all,
Delete (admin only), Edit metadata, Edit images, Identify, Refresh metadata,
Share, View album artist. `View album artist` is worth keeping — navigating from
an album back out to the artist is genuinely useful.

### Artwork fallbacks

- When an artist has no image (observed: Diane Warner, The Dreadnoughts), fall
  back to **the cover of their earliest album** rather than a flat colored box.

### Playback UX

- Jellyfin pops a small player docked at the bottom of the window rather than a
  full-screen takeover. Worth reproducing in spirit — **but note the official
  Vega sample uses a full-screen `Player` screen**, so a docked mini-player is
  net-new UI work, not something to crib.
- Queue is required. `IPlaylistState { repeatMode, shuffle }` in
  `kepler-media-controls` is the platform-side model for this.
- Playlists: local creation/management only. Import/export explicitly
  **descoped** — not useful given the hardware.

## Design problem: "top tracks" has no data source

Spotify's popular-tracks list is *global* popularity across all listeners.
Jellyfin only exposes `UserData.PlayCount`, which is the **local user's own**
play count. On a freshly-added music library that is zero for every track, so
the top-10 section renders empty for exactly the users seeing the feature for
the first time.

Needs a fallback chain, decided before build:
most-played → highest-rated → tracks from the most recent album.

Same class of problem as the missing-artist-art box, and worth solving the same
way.

## Album art: do not build a local cache

A proposed local cache of all 821 covers was rejected for two reasons:

1. **There is no filesystem API.** The available Amazon modules are
   `kepler-media-controls`, `keplerscript-netmgr-lib`, `react-native-kepler`,
   `react-native-w3cmedia`, `async-storage`. Persistence is key-value only.
   ~821 base64 covers would be roughly 25MB of string data in a store that
   JSON-parses on read — slower than fetching.
2. **821 covers are never on screen.** A windowed `FlatList` renders ~20 and
   recycles.

Correct fix, in order:

- request `fillWidth=200` thumbnails (video path currently requests 360 —
  `src/services/jellyfin/index.ts:555`)
- virtualize the grid so off-screen rows unmount
- rely on RN `Image`'s own caching — **verify on device** whether Kepler's
  implementation has a disk cache, since that determines whether scroll-back is
  instant

Only if that measures badly should a bounded LRU of ~60 covers be considered.

## Jellyfin music API surface (not yet implemented in Astra)

None of this exists in `src/services/jellyfin/index.ts` today — `getItems`
hardcodes `IncludeItemTypes: 'Movie,Series,Episode,Video'`.

Needed item types: `MusicArtist`, `MusicAlbum`, `Audio`, `Playlist`,
`MusicGenre`. Audio streaming uses the `/Audio/{id}/universal` endpoint family,
which is entirely separate from the `/Videos/` path the app uses now and has its
own transcoding parameters. A music device profile will also be needed —
`buildDeviceProfile` is video-shaped.

Pagination (`StartIndex`/`Limit`) is not currently used anywhere; library browse
fetches everything. That is a latent problem for large video libraries too.

## CORRECTED: cleartext is blocked for NATIVE media fetches, not for media generally

**An earlier revision of this section claimed Vega cannot play any media over
cleartext HTTP, and that it affected video too. That was wrong.** Video plays
fine from a plain-HTTP LAN server — verified on device by resuming a film.
The claim was drawn from a comparison of two servers differing in scheme, host,
port and reverse-proxying all at once.

### What the evidence actually supports

| Path | Who fetches | Cleartext http | Result |
|---|---|---|---|
| Browsing / metadata / artwork | JS `fetch` | yes | works |
| **Video** — HLS via ShakaPlayer | **JS** (Shaka pulls segments, feeds MSE) | yes | **works** |
| **Audio** — `AudioPlayer.src = url` | **native media pipeline** | yes | **fails**, `readyState 0` |
| Audio over https | native media pipeline | no | works |

The distinguishing factor is **not the scheme on its own** and **not audio vs
video** — it is *who performs the fetch*. Anything downloaded by JavaScript is
fine over cleartext. Handing a cleartext URL to the native player is what fails.

Video escapes the restriction only incidentally: `getStreamUrl` forces HLS
(`EnableDirectPlay: false`), so ShakaPlayer does the downloading in JS and the
native layer only ever sees already-fetched buffers.

### The fix: route audio the way video already goes

Jellyfin will serve audio as HLS — verified against the LAN server over plain
http:

```
Content-Type: application/vnd.apple.mpegurl
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=256000,CODECS="mp4a.40.2"
```

The source container must be **excluded** from `Container` to trigger it;
leaving `mp3` in the list makes Jellyfin direct-play instead and the HLS
parameters are ignored.

**Proposed strategy — pick per server, not globally:**

| Server | Strategy | Cost |
|---|---|---|
| `https://` | direct play, progressive | none; server does no work, seeking already proven |
| `http://` | HLS through ShakaPlayer | one transcode per track |

That gives cleartext LAN users working audio (the common self-hosted setup)
without imposing transcoding on everyone. Not yet implemented.

## SUPERSEDED — original claim, kept for the evidence it contains

The same track, same server, same credentials:

| Stream URL | Result |
|---|---|
| `http://192.168.x.x:8096/Audio/<id>/universal` | `readyState 0 (HAVE_NOTHING)`, immediate error, no bytes |
| `https://media.example.com/Audio/<id>/universal` | `readyState 3 (HAVE_FUTURE_DATA)`, plays normally |

The URL was not at fault. Fetching the exact failing URL from a machine on the
same LAN returned `206 Partial Content`, `audio/mpeg`, `accept-ranges: bytes`.
The server, token, container list and query encoding were all correct.

### Why this is so confusing in practice

**Ordinary `fetch` over cleartext works fine.** Browsing, metadata, search and
artwork all succeed against an `http://` server. Only the native media pipeline
refuses it. So a LAN server appears completely healthy — full library, artwork,
navigation — and then fails the instant you press play, with no clue why.

### This explains the hardcode removed earlier the same day

`normalizeServerUrl` used to contain a rewrite of
one specific HTTP hostname to its HTTPS equivalent. That existed because playback
failed over http. It was the correct workaround for the wrong reason, applied to
one hostname. The general rule is now understood and handled properly.

### Jellyfin cannot solve this for you

`/System/Info/Public` on the LAN server reports:

```json
{"LocalAddress": "http://192.168.x.x:8096", "ServerName": "Media", ...}
```

It advertises http because http is all it serves. Probing found no TLS at all —
`https://…:8920` (Jellyfin's https default) and `https://…:8096` both
unreachable. The working https address is a **reverse proxy** in front of the
same server.

### What Astra does about it

- `isCleartextUrl()` and `CLEARTEXT_MEDIA_MESSAGE` in `src/services/serverUrl/`.
- The playback service **fails fast** with an actionable message instead of
  three silent retries and a generic error.
- The setup wizard **warns at connect time**, before the user commits to a
  profile that can browse but never play.

### Follow-up worth doing

`LocalAddress` *does* report https on servers that have TLS configured. If a
user types `http://` at such a server, Astra could adopt the advertised https
address automatically. Not built — it would not have helped the server above,
which has nothing to advertise.

## Implementation log (2026-07-27)

Built against Astra 1.0.4-in-progress. 126 tests passing, device build clean.

| Area | Where |
|---|---|
| Music API | `src/services/jellyfin/music.ts` |
| Queue model (pure) | `src/services/audioQueue/index.ts` |
| Playback engine | `src/services/audioPlayer/index.ts` |
| Remote input | `src/hooks/useRemoteInput.ts` |
| Music gating | `src/hooks/useMusicAvailability.ts` |
| Top-level nav | `src/components/LibraryNav/` |
| Browse | `src/screens/MusicScreen/` |
| Artist / Album | `src/screens/ArtistDetailScreen/`, `src/screens/AlbumDetailScreen/` |

### Two API bugs caught by validating against a live server

1. **`MusicGenre` via `/Users/{id}/Items` returns zero.** Both
   `IncludeItemTypes=MusicGenre` and `/Genres?IncludeItemTypes=MusicAlbum` come
   back with `TotalRecordCount: 0`. Only `/MusicGenres` works. Would have
   shipped a permanently empty Genres tab.

2. **An empty filter id returns the whole library.** `AlbumArtistIds=` returned
   all 821 albums; `ArtistIds=` returned all 11,547 tracks. "Play everything by
   this artist" with a missing id would have silently queued the entire
   collection. Every id-scoped call now rejects via `requireId`, with a test
   asserting no HTTP request is issued.

### Library facts (probed, not assumed)

821 albums · 11,547 tracks · 157 album artists · 18 playlists · 98.3% mp3 ·
median 192 kbps. **Every play count is 0**, so the top-tracks fallback chain is
the path this library actually takes, not an edge case.

`UserViews` reports `movies`, `music`, `playlists`, `tvshows` — note playlists
is its own collection type, not a filter over music.

### Notable decisions

- **`FlatList` with windowing, not FlashList.** `@amazon-devices/shopify__flash-list`
  exists and `vega-scrolling-sample` uses it, but adding a native dependency is
  real risk and FlatList handles 821 items acceptably. Revisit if it measures
  badly on device.
- **Album/artist screens omit server-management actions** (edit metadata, edit
  images, identify, refresh, delete) that Jellyfin's client offers. They need a
  keyboard and mouse; a 10-foot remote is the wrong instrument. "View album
  artist" is kept — arriving from search or a playlist and wanting the rest of
  the artist's work is a real path.
- **"Popular" is only labelled Popular when play counts exist.** Otherwise the
  section reads "Tracks", so it does not imply data it does not have.
- **Expand-all sorts oldest-first** so a discography reads chronologically,
  while the album carousel stays newest-first like Spotify.
- **The dead `myMedia` preference was removed** — the row it controlled no
  longer exists, and a settings toggle that does nothing is worse than no
  toggle. Removed from the type, defaults, Settings UI and test fixtures.

### Manifest fix that also helps video

`command_options` now advertises `Play`, `Pause`, `Next`, `Previous` alongside
the existing `StartOver`/`SkipForward`/`SkipBackward`. Without `Next`/`Previous`
the remote's skip buttons fall back to a *seek*. This was also silently broken
for the **video** player, independently of music.

## Scope

What has been described is: a new audio playback engine, media-session
integration, queue management, 4–6 new screens, a Spotify-style artist layout,
A–Z jump scroll, infinite scroll, and an artwork strategy. That is a **minor
release, 1.1.0**, not a patch on the 1.0.3 that just shipped.

**Recommended order:**

1. **Spike playback + background behavior on real hardware.** Play a Jellyfin
   audio stream, drive it from the remote, background the app, observe. This is
   the question that could reshape everything; hit the wall in week one with a
   throwaway, not after the artist screen is pixel-perfect.
2. Decide architecture A vs B based on (1).
3. Jellyfin music API layer + pagination.
4. Queue model.
5. Browse UI.
6. Polish: artwork fallbacks, top-tracks fallback chain, per-section view modes.
