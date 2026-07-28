# Multi-Server Support Notes — Emby

Date: 2026-07-27
Investigated against: app version 1.0.3
Status: investigation only, no code changed

## Decision

**Add Emby support to the existing app, *conditional* on resolving the Emby
Premiere transcoding question below. Do not pursue Plex.** Ship one binary, one
Appstore listing, one IAP entitlement — not separate per-backend apps.

> **Read "BLOCKING RISK: Emby Premiere and transcoding" before starting work.**
> The API port is a day of work, but it is worthless if free-tier Emby servers
> cannot serve this app at all. Resolve that first.

Plex was investigated and dropped: it shares essentially nothing with the
Emby/Jellyfin API (different auth, response shapes, time units, device-profile
mechanism, and a *stateful* track-selection model), and it would have forced a
full adapter-interface refactor. Details preserved in "Why Plex was dropped"
below so the analysis doesn't have to be redone.

## Current coupling (the good news)

The entire server surface is **one file**: `src/services/jellyfin/index.ts`
(1,562 lines). Nothing else in the app makes a network call to the media server.
Screens consume ~25 exported functions and never build a URL themselves.

`src/screens/PlayerScreen/index.tsx` (1,858 lines) only touches `getStreamUrl`
and the three `reportPlayback*` functions, plus `streamInfo.url`,
`track.deliveryUrl`, `track.burnInRequired`, and the audio/subtitle stream
indices. Shaka and the w3cmedia layer are transport-agnostic.

`ServerType = 'jellyfin' | 'emby'` **already exists** at
`src/services/storage/index.ts:3` and is persisted on `ServerProfile`. The setup
wizard already asks for it on step one. Nothing branches on it today except
Quick Connect gating at `src/screens/SetupScreen/index.tsx:144`.

### Known coupling leaks (documented, not blocking for Emby)

These only matter if a non-Emby-family backend is ever added:

1. **Ticks.** Jellyfin's 100ns unit is spread through `PlayerScreen` (42 refs),
   the detail screens, and `LibraryInfoPanel`. Emby uses ticks too, so this is a
   non-issue for the current plan.
2. **Session as three loose props.** `serverUrl`, `accessToken`, `userId` are
   threaded separately — 72 and 52 call sites respectively. Not touched by the
   Emby plan.
3. **`Jellyfin*` type names** are imported into 11 files. Cosmetic.

## Jellyfin vs Emby: complete divergence list

Of **28 endpoint sites** in the service file, only these differ. Everything else
— `PlaybackInfo`, `/Sessions/Playing*`, `/Users/{id}/Items`,
`/Shows/{id}/Seasons`, `/Shows/{id}/Episodes`, `/Shows/NextUp`,
`/Users/{id}/Items/Latest`, `/Users/{id}/Items/Resume`, `/Items/{id}/Similar`,
`/Persons/{name}`, `/FavoriteItems`, `/PlayedItems`, `/Playback/BitrateTest`,
`/Videos/{id}/stream`, `/System/Info/Public`, `/Users/AuthenticateByName` — is
byte-identical, with the same JSON shapes, the same ticks, the same
`MediaSources`/`MediaStreams` structure, and the same default port 8096.

| Site | Jellyfin | Emby 4.x |
|---|---|---|
| `index.ts:785` | `/UserViews` | `/Users/${userId}/Views` |
| `index.ts:1060` | `.../Subtitles/${index}/Stream.vtt` | inserts a position segment: `.../Subtitles/${index}/${startTicks}/Stream.vtt` |
| `index.ts:555,564,584,795,1293` | `fillWidth` | `maxWidth` (`fillWidth` is Jellyfin 10.8+) |
| `normalizeServerUrl` | no prefix | optional `/emby` base prefix for proxied installs |
| QuickConnect — `:703,714,734,749` | supported | does not exist — already gated |

Auth headers already work for both: `getPreAuthHeaders`/`getAuthHeaders`
(`index.ts:277-287`) send `X-Emby-Authorization` alongside `Authorization`.

## BLOCKING RISK: Emby Premiere and transcoding

**This decides whether Emby support is viable at all. Resolve it before writing
any code.**

### Why Astra is unusually exposed here

Astra never direct-plays. `getStreamUrl` sends `EnableDirectPlay: false` and
`EnableDirectStream: false` in the PlaybackInfo body (`index.ts:967-968`), so
**100% of playback — including pure remuxes where the codecs already match — goes
through the server's transcoding endpoint.** There is no fallback path.

This was a deliberate Vega platform decision, documented in the comment at
`index.ts:961-966`:

- raw-file direct play blocks the JS thread inside `setSrcUri` when
  `KeplerMediaSink` rejects a stream (HDR10)
- byte-range seeking into raw files is unreliable on this platform; HLS segments
  seek cleanly

So the obvious mitigation — "just direct-play on Emby free" — is a road that was
already tried and rejected for platform reasons, not an easy escape hatch.

Note also that even when the server *stream-copies* (full source quality, no
re-encode), the request still goes through the same transcoding endpoint and
almost certainly counts as "transcoding" for licensing purposes. Astra gets no
benefit from the fact that most of its playback is remux-only.

### What is actually unverified

Emby gates some functionality behind a paid Emby Premiere subscription. The
specifics have shifted across Emby versions and **should not be taken on
memory or assumption from any source, including prior notes in this file.** The
open questions:

1. Does a **free** Emby server serve `/Items/{id}/PlaybackInfo` and return a
   usable `TranscodingUrl` at all?
2. Is the gate on **hardware acceleration only** (software transcode and remux
   still work free — the benign case), or on the **transcoding subsystem
   generally** (the fatal case)?
3. Does a **remux / stream-copy** to HLS count against the gate, or only a real
   re-encode?
4. Are there additional per-client restrictions on third-party API clients
   independent of Premiere?

### The test that resolves it

Stand up a **stock free Emby server with no Premiere licence** and a library with
at least one already-compatible file (h264/AAC in MP4 — the case that should
remux, not re-encode), then run Astra's actual code path against it:

- `POST /Items/{id}/PlaybackInfo` with Astra's device profile and
  `EnableDirectPlay: false` / `EnableDirectStream: false`
- confirm a `TranscodingUrl` comes back rather than an error or an empty
  `MediaSources`
- fetch the resulting `master.m3u8` and confirm segments actually serve
- repeat with a file that *must* re-encode (HDR10 HEVC) to separate the
  remux case from the re-encode case

Then repeat the whole thing against a Premiere-licensed server to see which
behaviors differ.

### Outcomes and what each means

| Result on free Emby | Consequence |
|---|---|
| Remux **and** re-encode both work | No problem. Premiere is a performance concern (HW accel), not a functional one. Proceed with the plan as written. |
| Remux works, re-encode gated | Partial support. Astra plays compatible files but fails on HDR10/incompatible audio. Shippable *only* with a clear in-app message and store-listing disclosure. Ugly. |
| Neither works without Premiere | **Emby support is not viable as designed.** Options: (a) ship it as "Emby Premiere required", disclosed in the store listing and at the setup wizard's server-type step; (b) revisit direct play for Emby specifically, accepting the known Vega seeking/HDR10 problems; (c) drop Emby. |

If the outcome is the third row, that likely reopens the whole "is a second
backend worth it" question — a backend that only works for paying Emby customers
is a much smaller addressable audience than the one that motivated this work.

## Implementation approach

**Do not build the `MediaBackend` adapter interface.** It is not needed for a
backend this similar, and it would touch every screen for no benefit.

The app holds exactly **one active server profile at a time**
(`src/navigation/index.tsx:47` — a single `ServerProfile | null`), so a
module-scoped dialect is honest here rather than a hack:

```
src/services/jellyfin/dialect.ts

type Dialect = {
  basePath: string;
  imageWidthParam: 'fillWidth' | 'maxWidth';
  label: string;                 // "Jellyfin Server" / "Emby Server"
  subtitlePath(itemId, mediaSourceId, index, startTicks): string;
  supportsQuickConnect: boolean;
  viewsPath(userId: string): string;
};

setActiveDialect(profile.serverType)
```

Three call sites set it, all in `src/navigation/index.tsx`:

- boot restore — `:194`
- profile switch — `:247`
- new connection — `:89`

`connect()` and `discoverServers()` run in the setup wizard *before* a profile
exists, so those take the server type as an explicit argument — the user has
already picked it on step one.

**Zero screen changes.** No prop threading, no type renames, no touching the 72
`serverUrl` / 52 `accessToken` call sites. `PlayerScreen` does not move.

## Where the real cost is (assuming the Premiere question clears)

Not the endpoints — **`src/services/jellyfin/deviceProfile.ts`**.

That file encodes hard-won, physically-verified knowledge about *Jellyfin's*
transcoding pipeline, and none of it transfers to Emby on faith:

- the `VideoRangeType` / SDR `CodecProfile` condition used to force HDR10
  tonemapping
- the note that Jellyfin applies codec conditions across *every* codec listed in
  a `TranscodingProfile` (the observed "Neighbors 4K forced to 1080p" bug)
- ASS/SSA/PGS/DVBSUB forced to `Method: 'Encode'` because Vega's caption surface
  renders timed text only
- `MinSegments` / `BreakOnNonKeyFrames` HLS behavior
- the `ENABLE_UNVERIFIED_DTS_REMUX_TRIAL` flag (`src/config/app.ts`) — DTS-HD
  remux is confirmed rejected by this device's HLS/fMP4 path

**Keep `buildDeviceProfile` as two builders sharing the codec-capability logic**,
rather than one profile with conditionals. Different servers, different bugs — an
Emby fix must not be able to regress the tuned Jellyfin path.

### Verify on real hardware before claiming Emby support

- does `VideoRangeType` exist as a `CodecProfile` property on the target Emby
  version?
- does `Method: 'Encode'` trigger subtitle burn-in the same way?
- do `MinSegments` / `BreakOnNonKeyFrames` behave identically on Emby's HLS?
- **Premiere gating — see "BLOCKING RISK" above.** This is not a
  late-stage test item; it gates the entire feature and must be answered first.

**Estimate: ~a day of code, ~a week of device testing — *if* the Premiere
question comes back clean.** The testing is the project. If it comes back dirty,
the estimate is irrelevant because the feature changes shape or dies.

## Pre-existing issues found during this investigation

1. **Personal infrastructure hardcoded in shipping code.**
   `normalizeServerUrl` (`index.ts:269-272`) contains an `http→https` redirect
   for `jelly2.ambientflare.art`. Should be a general rule or removed.

2. **Jellyfin-specific user-visible strings.** `"Jellyfin request failed"`
   (`:629`), `"No playable URL returned from Jellyfin."` (`:1050`), and the
   `"Jellyfin Server"` fallback names (`:654`, `:1497`). These want the dialect's
   `label`.

3. ~~The setup wizard already offers "emby" and speaks Jellyfin dialect to it.~~
   **Not a bug — corrected 2026-07-27.** Emby is rendered `disabled` with a
   "coming soon" label (`src/screens/SetupScreen/index.tsx`, `isComingSoon`),
   and `test/App.spec.tsx:247` asserts it stays disabled. No user can select it,
   so no broken profiles exist and no migration is needed.

   Implication for the work: shipping Emby is partly a matter of flipping
   `isComingSoon` off — but do not flip it until the Premiere transcoding
   question above is resolved, and update that test when it changes.

## One app vs. three — rationale

Shipping one app, decided on these grounds:

- **IAP is decisive.** `ASTRA_PRO_SKU = 'astra.pro'`
  (`src/services/iap/index.ts:5`) is a single entitlement. Separate apps mean
  separate SKUs, so a user who buys Pro and later switches backends pays twice.
  There is no clean cross-app entitlement story in the Amazon Appstore.
- One listing, one review cycle, one version number. `manifest.toml` carries a
  single `com.astra.tv` package id.
- **Multi-server users are the actual feature.** `readServerProfiles()` and
  `ProfileSwitcher` already support a list of servers; Jellyfin-at-home plus a
  friend's Emby share becomes one row in the switcher instead of two apps.
- Fixes to the ~90% shared surface (player, subtitles, focus handling,
  device-capability logic) land once.

Accepted downsides: larger blast radius (an Emby regression ships to Jellyfin
users, mitigated by the narrow seam), and muddier store positioning — solvable in
the listing copy.

The "one codebase, build flags, three binaries" variant was explicitly rejected:
it carries all the merge complexity of one app *plus* all the release overhead of
three, and still fragments IAP.

## Why Plex was dropped

Preserved so this doesn't get re-investigated. Every layer differs:

| Concern | Jellyfin/Emby | Plex |
|---|---|---|
| Auth | `POST /Users/AuthenticateByName` | plex.tv PIN flow (`/api/v2/pins`, poll) or `/users/signin`, `X-Plex-Token` |
| Discovery | HTTP scan `:8096/System/Info/Public` | GDM UDP 32414, or `plex.tv/api/v2/resources` |
| Response shape | `{Items: [{Id, Name, Type}]}` | `{MediaContainer: {Metadata: [{ratingKey, title, type}]}}` |
| Time unit | ticks (100ns) | milliseconds |
| Device profile | `DeviceProfile` JSON in PlaybackInfo body | `X-Plex-Client-Profile-Extra` header DSL |
| Stream URL | `TranscodingUrl` from PlaybackInfo | `/video/:/transcode/universal/decision` then `start.m3u8` |
| Keep-alive | progress reports | separate `/transcode/universal/ping` — transcode **dies** without it |
| Track selection | per-request `AudioStreamIndex` | **stateful**: `PUT /library/parts/{id}?audioStreamID=` then re-decide |
| Progress | `POST /Sessions/Playing/Progress` | `GET /:/timeline?state=playing&time=` |
| Watched | `/Users/{id}/PlayedItems/{id}` | `/:/scrobble`, `/:/unscrobble` |
| Libraries | `/UserViews` | `/library/sections` |
| Seasons/Episodes | `/Shows/{id}/Seasons` | `/library/metadata/{id}/children`, `/grandchildren` |

Additional blockers:

- **Stateful track selection** conflicts with the stateless
  `getStreamUrl(itemId, ..., {audioStreamIndex, subtitleStreamIndex})` signature.
  Hideable behind an adapter, but it costs two round-trips and mutates
  server-side state visible to other Plex clients.
- **`PersonDetailScreen` would be degraded.** Plex has no `/Persons/{name}`
  equivalent with overview and birth date — only `Role` tags and an `?actor=`
  filter. Filmography yes, bio no.
- Estimated 2–4 weeks, with most risk concentrated in re-learning transcode
  decision and subtitle burn-in behavior that was already paid for on Jellyfin.

Note that the dialect approach chosen for Emby is a *config* pattern, while Plex
would need *polymorphism*. Building the dialect now costs nothing that would have
to be unwound — if Plex is ever revisited, promote the dialect into a real
`MediaBackend` interface at that point.
