# Changelog

## 1.3.1 - 2026-09-08

### Fixed

- Turning on subtitles forced the server to re-encode the whole video. Astra
  asked for every subtitle to be burned into the picture, which also told the
  server it could not copy the video stream, so a file that needed no
  conversion at all became a full transcode the moment captions were switched
  on. On a server without hardware encoding that was the difference between
  smooth playback and constant buffering. Astra draws text subtitles itself
  again; burn-in is now reserved for the formats it cannot draw -- picture
  based subtitles and styled ASS/SSA. ([#20](https://github.com/AmbientFlare/astra-tv/issues/20))
- Subtitles in MP4 files (`mov_text`) were treated as a format Astra could not
  render, so they always burned in. They are text like any other and are now
  rendered in the app.
- Switching subtitle tracks, or turning them off, no longer reloads the video.
  A subtitle Astra draws itself changes nothing about the stream the server is
  sending, so the change is now instant.
- A stream the server handed back in a form Astra could not play -- seen with
  some MKV and AVI files -- is now asked for again properly instead of failing
  to start. ([#21](https://github.com/AmbientFlare/astra-tv/issues/21))

### Added

- Astra learns what each server can actually do and stops retrying what it has
  already proved it cannot. A first run asks two questions per server -- whether
  it has a graphics card and whether the room has surround sound, with "I don't
  know" as a real answer -- and playback then corrects those answers on its own.
  Settings gains a page to see and override any of it.
- The one-time notice after an update is now a "What's new" list for the build
  being installed, shown once and dismissed with a single press.
- Each subtitle track in the player options is marked Instant or Reloads. A
  release can carry twenty tracks whose titles differ only by language, and
  nothing in the title says whether picking one is free: the ones Astra draws
  itself switch on with no interruption, while picture-based ones need the
  server to rebuild the stream with them painted in.

## 1.3.0 - 2026-09-05

The playback release. Videos that used to stall, stick on a spinner or quit
partway through now recover on their own, HDR movies keep their HDR picture,
and large libraries open immediately and stay where you left them.

### Fixed

- HDR movies were re-encoded to washed-out SDR. Astra asked the server for a
  tone-mapped SDR stream on every HDR source, so an HDR10 or HLG movie arrived
  looking flat and cost the server a full video re-encode to get there. Astra
  now asks for the HDR variant its decoder has actually been shown to accept,
  and the picture that reaches the TV is the picture on the disc. Confirmed on
  a physical panel.
- Playback could stall partway through a video and behave as though it had
  ended, needing a manual track change to continue. Startup, seeks, track
  changes, chapter reloads and error recovery now run as one cancellable
  playback session instead of each driving the player directly, which removes
  the overlapping-session races behind the stalls and the stuck spinners.
- A video that ended early is now recognised as a failure and recovered from,
  rather than reported as a finished video.
- Progress, chapters and completion are measured against the item's real
  duration and position, so resumed playback no longer reports the wrong spot.
- Every installation now has its own stable Jellyfin device identity. Two Fire
  TVs signed into the same account no longer collide in the server's session
  list or evict each other's sessions.
- Backing out of a movie or episode returns to the library exactly where you
  left it -- same scroll position, same card focused -- instead of rebuilding
  the grid from the top with a spinner. The grid is now measured in rows
  rather than in cards, which is what put the list a third of the way down the
  alphabet regardless of where you actually were.

### Changed

- Library grids load roughly forty times faster. The grid used to request every
  field the detail screen needs for every item in the library: 2.7 seconds and
  2.04 MB for a 90-movie library, most of it cast and crew lists nothing on a
  card ever draws. It now requests what a card needs -- 0.06 seconds and 135 KB
  for the same library -- and fills in the details as focus settles, prefetching
  two rows ahead so the info panel is complete by the time you reach it.
- The player no longer re-renders four times a second while a video plays. JS
  contention is this platform's signature failure mode and this was paid every
  second of every playback.
- The diagnostics overlay reports dropped frames as a ratio. The platform's
  absolute frame counts are not believable -- roughly 4,600 fps on a 24 fps
  stream -- so the counts have been removed rather than shown as fact.

### Added

- Opt-in playback telemetry, off by default and inert unless an operator
  explicitly arms it with a build-time endpoint and token. Nothing is
  collected, buffered or sent otherwise, and the configuration is never
  committed to the repository.

## 1.2.1 - 2026-09-02

Adds a global subtitle preference and Skip Credits / Next Episode playback
controls, and fixes a resume stall found while validating them on hardware.

### Added

- A subtitle preference in Settings > Playback: Default (per video), All
  subtitles on, All subtitles off, or Only forced. Resolved against each
  video's PlaybackInfo response before its stream is built, so the choice
  applies to movies and episodes, initial playback and resume alike. A track
  chosen in the player affects only that video and does not change the
  preference.
- Skip Credits, from Jellyfin `Outro` media segments or a chapter named
  "Credits", with Ask / Auto-skip / Ignore in Settings > Playback.
- Next Episode, with an optional autoplay countdown (Settings > Playback:
  Next episode autoplay, countdown duration). Autoplay is capped at three
  episodes in a row before Astra pauses on a Continue Watching prompt; a
  manual Next Episode always resets the count, and a new playback session
  starts at zero.

### Fixed

- Playback could get stuck on "Buffering" with zero frames decoded when a
  transcoded session with burned-in subtitles resumed, jumped a long
  distance, or switched tracks partway into the video. The server's fMP4
  segments start at their source timestamp while the player's clock started
  at zero, so nothing lined up. Astra now starts that kind of session in
  Shaka's sequence mode, which places the first segment at the player's
  clock instead.

## 1.2.0 - 2026-08-29

Repairs playback on Fire TV devices that have taken the Vega OS 1.2 update.
Nothing in the app changed to cause the failures: the published 1.1.2 package
reproduces all of them on an updated device.

### Fixed

- Resuming a title from a saved position no longer exits to Home.
- Switching audio tracks during playback no longer exits to Home.
- Turning on burned-in subtitles during playback no longer exits to Home.
- Release logging no longer blocks the JavaScript thread. On Vega OS 1.2 the
  native logging bridge stalled the thread until the Fire TV thread monitor
  terminated the app; console output now goes to a bounded in-memory buffer,
  with `console.error` retained.
- The HLS resume trim copies the untouched playlist suffix with a native copy
  instead of rebuilding a 1.4-2.2 MB playlist character by character, removing
  about 5 seconds of synchronous work from every stream load.

### Changed

- Requires Vega OS `1.2`, as declared in the manifest and required by Vega
  SDK 0.24. Devices on an earlier Vega OS remain on 1.1.2.
- Built with Vega SDK `0.24.9914`; Amazon device libraries updated to the
  SDK 0.24 pins for the React Native 0.72 line. React and React Native are
  unchanged.

### Added

- Optional "Stats for Nerds with logs" view showing manifest handling and load
  timings, in Settings > Playback and the in-player Diagnostics column. Off by
  default. Vega exposes no JS console output to any retrievable log artifact,
  so this is the only on-device playback diagnostic.
- A one-time developer notice acknowledging the disruption, dismissed with a
  single OK.
- `npm run build:submission`, which sets the Vega package build number from
  `src/config/app.ts`. `npm run build:release` leaves it at 0, which sideloads
  but fails Amazon validation.

### Known limitations

- A double-arrow chapter jump still takes roughly 38 seconds. This predates the
  OS update and sits below the JavaScript thread.
- Subtitles rendered by the app can drift out of sync after a long seek that
  requires buffering.

## 1.1.2 - 2026-08-22

### Added

- Stats for Nerds now reports the HLS segment target, minimum segment count,
  exact app/build identity, and cumulative waiting, stalled, and error events.
- Stats for Nerds now distinguishes the current contiguous buffer from all
  buffered ranges and reports the next gap, so boundary gaps are not mistaken
  for late segment downloads.
- Playback health events emit privacy-safe structured container and delivery
  metadata without URLs, credentials, item IDs, or media titles.

### Fixed

- Playback settings now offer opt-in four-, three-, and two-second Jellyfin HLS
  segment targets on both fMP4 and MPEG-TS paths. Auto remains the default, so
  existing playback behavior is unchanged unless compatibility mode is chosen.
- HEVC video on Vega now uses Jellyfin HLS/MPEG-TS delivery, avoiding the
  duplicate open-GOP timestamps that caused visible MP4/MOV micro-stutter.
- Resuming an HLS/MPEG-TS title starts at the numbered Jellyfin segment that
  contains the saved position instead of processing every preceding segment.

### Changed

- The Vega W3C Media dependency moves from 2.1.99 / `IW3cmedia_1` to 2.2.21 /
  `IW3cmedia_2` for the next isolated long-playback stability and A/V-sync
  candidate.
- HLS/MPEG-TS returns to the previously accepted segments mode after a
  one-hour physical sequence-mode test still accumulated a roughly
  0.75–1.5-second audio lead. HLS/fMP4 remains in segments mode.
- HEVC/MPEG-TS requests AC3 audio when the device reports AC3 support. Two
  long AAC/TS hardware runs drifted while the generated transport-stream A/V
  timestamps remained stable; H.264/fMP4 retains the normal audio policy.

## 1.1.1 - 2026-08-04

### Fixed

- Text inputs now blur and dismiss the Vega keyboard before Search or Setup
  navigates away or unmounts.
- Shaka SourceBuffer appends, removes, and aborts are serialized before seeks
  and player teardown.
- Player and Library timers snapshot references and are cleared before those
  references are released.

## 1.1.0 - 2026-07-29

### Added

- Music library navigation for artists, albums, genres, and playlists, with
  paginated browsing, remembered poster/list layouts, and an A-Z jump rail.
- Artist, album, genre, and playlist detail screens with sequential playback
  and album shuffle.
- Persistent music playback with seeking, remote media controls, background
  playback, a docked player, and a simplified Now Playing screen.
- Three-minute audio idle visual with slowly drifting album art, because Vega
  suppresses its system screensaver while audio is active.
- Red unwatched-episode count badges on TV series posters, capped at `99+`.
- Multi-server URL normalization and HTTP/HTTPS connection recovery.
- Large Movies, TV Shows, and Music home cards backed by poster and album-cover
  collages from the connected Jellyfin server.
- Three-minute paused-video idle visual and Vega user-engagement integration to
  keep burn-in protection inside Astra.

### Fixed

- Cleartext LAN audio now uses AAC/TS HLS through ShakaPlayer. Vega rejects
  native-player HTTP media fetches even though JavaScript HTTP requests work.
- Source audio containers are excluded from HLS negotiation so Jellyfin cannot
  silently choose progressive direct play instead of returning a manifest.
- Remote key down/up duplication, slow-handler duplication, and dual
  D-pad/KMC command delivery no longer double-advance or immediately re-pause.
- Starting video stops music, unloads its adaptive stream, and removes stale
  track metadata from the bottom of the screen.
- Auto-capitalized server schemes and host casing no longer invalidate URLs.
- Video Next/Previous command declarations were restored in the Vega manifest.

### Changed

- HTTPS Jellyfin servers retain efficient progressive audio direct play; only
  HTTP servers use the compatibility HLS transcode path.
- Temporary on-screen audio URL and ready-state diagnostics are disabled for
  the release UI.
- Queue construction, per-track action popups, playlist creation, and
  music-specific long-press controls were removed after hardware testing showed
  they conflicted with reliable Vega focus navigation.
- D-pad Left/Right skips tracks only on Now Playing; it remains ordinary focus
  navigation everywhere else.

## 1.0.3 - 2026-07-21

### Added

- Quick user switching: the Home screen profile button opens a "Who's
  watching?" overlay for swapping between saved users or adding a new one —
  no sign-out required.
- Multiple users per server: signing in as another user keeps existing
  profiles instead of replacing them.
- The Home screen profile button now shows the signed-in username instead of
  a single initial.
- Settings > Manage servers groups accounts under their server (one entry per
  server with a user count) and supports per-account sign-out/removal.

### Fixed

- Libraries failed to load with "Jellyfin request failed 403" for non-admin
  users on Jellyfin 10.11+: the home screen used the admin-only
  `/Library/MediaFolders` endpoint. It now uses `/UserViews`, which also
  means each user sees exactly the libraries they have access to. (#6)
- Requests now send the standard `Authorization: MediaBrowser` header
  alongside the legacy `X-Emby-*` headers, keeping Astra compatible with
  Jellyfin 10.12/10.13 where legacy authorization is disabled/removed.

### Changed

- Updated release metadata and the About page to version 1.0.3, build
  20260721.1.

## 1.0.2 - 2026-07-18

### Added

- Jellyfin Quick Connect sign-in with a server-issued six-digit code.
- A guided setup flow with local server discovery and password-login fallback.
- Stats for Nerds playback diagnostics for codecs, stream-copy/transcode state,
  source and active resolution, container, bitrate, buffer, and frame health.
- Runtime audio capability probing for AC3, EAC3, MP3, and Opus delivery.

### Fixed

- Audio-track changes now reload a fresh Jellyfin stream and resume at the
  captured position instead of hanging indefinitely while buffering.
- Subtitle changes use the same clean reload-and-resume lifecycle.
- SubRip/SRT subtitles now render in Astra's own synchronized WebVTT overlay,
  independent of Fire TV's disabled system closed-caption renderer.
- PGS/PGSSUB and styled ASS/SSA subtitles are negotiated as video burn-in
  instead of unsupported external text tracks.
- Jellyfin WebVTT subtitle URLs with authentication query parameters are now
  identified with the correct `text/vtt` MIME type.
- Track navigation no longer changes streams until Select is released and the
  completed press is dispatched.
- DTS-HD audio uses stable AC3 conversion when Vega cannot accept DTS in the
  HLS/fMP4 playback path, while compatible HEVC video remains stream-copied.
- Removed the recovery bitrate cap that could unnecessarily reduce 4K video to
  1080p.
- Corrected playback diagnostics to report source and active video resolution
  and native frame-quality counters.

### Changed

- Emby is visible but disabled and marked Coming soon.
- Removed the periodic support/donation popup from application startup.
- Updated release metadata and the About page to version 1.0.2, build
  20260718.14.
- Added an in-app What's New section summarizing each release's user-visible
  improvements.

## 1.0.1 - 2026-07-07

### Added

- Astra Source-Available License and third-party notices.
- Public source and website links on the About page.

### Fixed

- Corrected About-page release information and support links.
- Replaced the placeholder support QR code with the final asset.

### Changed

- Finalized the first Amazon update package metadata.

## 1.0.0 - 2026-07-05

### Added

- Jellyfin server setup, authentication, and saved server profiles.
- Movie and television library browsing, search, detail pages, cast pages,
  seasons, and episodes.
- Resume playback, watch-progress reporting, and chapter navigation.
- Vega media playback with Jellyfin direct-play, stream-copy, and transcode
  fallback.
- Remote-first Fire TV navigation, settings, and Amazon submission assets.
