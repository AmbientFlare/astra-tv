# Music player research audit

Date: 2026-09-06  
Audited source: Astra commit `ff95045df40b6d07e6b1f5b13512f8edc38d9182`  
Scope: music only; no application source, dependencies, manifest, or production
configuration was changed.

## Executive verdict

Astra already has a real TV music player rather than a superficial library
browser: a persistent audio service, tested queue semantics, a bottom dock,
artist/album/genre/playlist paths, remote-command integration, a cleartext
workaround, and burn-in protection. The central product gap is not fundamental
audio playback. It is the missing *listener-visible control surface* for a
capable internal queue: queue visibility/editing, repeat/shuffle controls,
explicit and discoverable transport/seek controls, and a focused recovery
surface are absent from the released Now Playing page.

The evidence does **not** support blaming Vega for those omissions. Current
Vega packages and official KMC documents explicitly support app-owned media UI,
overridable next/previous/shuffle/repeat handlers, session metadata, remote/
voice command routing, and focus APIs. Conversely, no source proves that Vega
will provide a browser-style system mini-player, lock-screen notification,
process-relaunch playback persistence, or an editable queue for free. Those
are app responsibilities or remain platform questions.

The highest-confidence implementation candidates are therefore:

1. A remote-safe expanded Now Playing page with visible Previous, Play/Pause,
   Next, seek, queue position, repeat, shuffle, and a Queue entry point.
2. A focused queue overlay/screen limited initially to Jump to, Remove, Play
   next, and Clear; reorder/save-to-server remain separately justified work.
3. Explicit loading, failure, Retry, and unsupported-track actions, preserving
   the existing stop-after-three-errors protection.
4. Jellyfin music playback-session reporting: start, throttled progress, and
   stopped reports with a durable play-session ID and correct queue/current-item
   semantics.
5. Accessibility/focus work: semantic labels and current/selected state for
   music controls, deliberate modal focus trapping and return focus, and an
   idle-visual accessibility/motion check.
6. A Vega hardware regression matrix that validates KMC source routing,
   HTTP-HLS, backgrounding, lifecycle, and system control presentation before
   interpreting platform behavior as fixed.

Do **not** implement background headless playback, a local artwork cache, a
browser-equivalent Media Session UI, Android audio-focus/integration APIs, or
server-playlist editing on the evidence here. None has enough outcome/value or
Vega-specific evidence to justify it yet.

## Evidence standard, versions, and limitations

### Evidence labels

| Label | Meaning |
|---|---|
| Code-confirmed | Present in the audited source and, where stated, covered by a named test. |
| Device-confirmed | Reproduced on the connected Vega stick during this audit or recorded by a dated prior device run. |
| Official-contract | Directly supported by current official documentation or installed public typings. |
| Comparative | Supported by a current first-party comparison-client source; not a Vega requirement. |
| Unresolved | Insufficient evidence; it is not a platform limitation or defect claim. |

### Audit environment

- Astra source package: `1.3.0`; installed dependencies:
  `@amazon-devices/react-native-w3cmedia` `2.3.2`,
  `@amazon-devices/kepler-media-controls` `1.0.25`, and
  `@amazon-devices/react-native-kepler` `2.1.0+rn0.72.0`.
- SDK available on the research host: Vega CLI/SDK `0.24.9914`.
- Connected physical target: non-simulated Vega TV device, product `callie`,
  `armv7l`, OS `1.2` build `547`, developer mode enabled. Its serial, account,
  server URL, and library contents are intentionally omitted.
- The existing installed Astra application launched, navigated through the
  Music entry and artist detail, built a playing sequence from the visible
  Play-all action, displayed the docked Now Playing state, and advanced its
  elapsed counter. This is Device-confirmed basic browse/start/dock evidence.
  Screenshots are ephemeral local test artifacts and are not retained in this
  repository because they contain personal library metadata.
- `inputd-cli` injected generic `KEY_PLAYPAUSE`, `KEY_PAUSE`, `KEY_STOP`,
  `KEY_HOME`, and Linux `KEY_NEXTSONG` while a current artist queue was
  playing. None produced a valid KMC/background effect; the current track and
  elapsed playback remained visible after `KEY_NEXTSONG`. These injected key
  codes may not emulate the retail remote/KMC provider path. This is an
  **injector-routing limitation**, not evidence that Astra KMC fails.
- A controlled device run started artist Play all, waited for active docked
  playback, launched the installed system launcher, waited more than 35
  seconds, then used the Vega CLI `launch-app` operation to open Astra. Astra
  came up at its home screen with no dock/temporary queue. This is
  Device-confirmed **CLI relaunch-reset** behavior for this artifact/device;
  `launch-app` is not a foreground-resume primitive, so it neither proves
  whether audio continued under the launcher nor establishes process-death or
  retail-Home behavior.
- The audit did not alter the saved server profile, capture tokens or private
  URLs, run a network fault, or create/delete server playlists. Therefore the
  cleartext-HLS, reconnect, process-death, real-remote/voice, and system-media
  presentation claims below retain their stated limitations.

### Automated verification

The following source-level suites passed on this commit:

| Command coverage | Result |
|---|---|
| `AudioQueue`, `AudioHandoff`, `AudioIdleGate`, `RemoteInput`, `JellyfinMusic`, `MusicAvailability` | 6 suites, 59 tests passed. |
| `App`, `JumpMarker`, `Duration` | 3 suites, 39 tests and 1 snapshot passed. |

The UI test emits expected host-only warnings because the native W3C Turbo
module is unavailable under Jest. That is not device media evidence.

### External-source version ledger

All web material below was retrieved on 2026-09-06. “Current on retrieval” is
not a claim that the source has a published semantic version; a commit, API
version, release, or path-version is recorded whenever the publisher supplies
one.

| Source | Version/scope captured | Role in this audit |
|---|---|---|
| [Jellyfin Web](https://github.com/jellyfin/jellyfin-web) | commit `a1c2e13286103953b417966f1c5cc75ddefdecbc` | Queue/transport and playback-reporting client parity. |
| [Jellyfin Android TV](https://github.com/jellyfin/jellyfin-androidtv) | commit `03e930b3446a62940adbfd35c909e4e7a73cea57`; release `v0.19.10` (2026-08-16) | TV-client queue/reporting comparison; Android-specific lifecycle explicitly excluded from Vega conclusions. |
| [Jellyfin stable OpenAPI](https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json) | `info.version` `12.0.0` | Server playback/reporting and audio-delivery operation availability, not deployed-server proof. |
| Amazon Vega documentation | URL paths `0.21`, `0.22`, and `0.23`; installed SDK `0.24.9914` | Current platform contract for W3C media, KMC, focus, lifecycle and Appstore testing. Path version and installed SDK are kept separate. |
| Amazon checked-in Vega Audio Sample | commit `5017d914cf2956658d752993f8a94dffd097c082`; manifest `2.23.0`; 2026-06-19 | Implementation example for direct/adaptive routes, KMC ordering, loading, and background handling—not platform policy. |
| [Apple Music on Apple TV](https://support.apple.com/guide/tv/control-music-playback-atvbef12564e/tvos) | tvOS guide; no article revision exposed | Current ten-foot queue/Now Playing behavior reference. |
| [Spotify Now Playing](https://support.spotify.com/us/article/now-playing/), [Queue](https://support.spotify.com/us/article/play-queue/), and [TV support](https://support.spotify.com/us/article/spotify-on-tv/) | Current help pages; no article revision exposed | Music semantics and recovery reference; only the TV page is TV-specific. |
| [YouTube Music connected devices](https://support.google.com/youtubemusic/answer/9231765) and [shuffle/repeat](https://support.google.com/youtubemusic/answer/9205192) | Current Google Help pages; no article revision exposed | Controller/cross-device queue contrast and shuffle/repeat scope; not a Vega design mandate. |
| [Plex Play Queues](https://support.plex.tv/articles/202188298-play-queues/) | Legacy support article; date/version not relied on | Historical conceptual contrast only, never a current UI assertion. |

## Current Astra architecture and behavior

### Player, queue, and delivery

| Concern | Current behavior and evidence | Assessment |
|---|---|---|
| State owner | Module-global `audioPlayback` owns `AudioPlayer`, optional Shaka wrapper, music session, load generation, observer status, and queue in [`src/services/audioPlayer/index.ts`](../src/services/audioPlayer/index.ts). | Code-confirmed. Correct scope for browse-while-listening; not persisted over relaunch. |
| Queue | Pure [`audioQueue`](../src/services/audioQueue/index.ts) has tracks, display order, cursor, repeat off/all/one, shuffle, enqueue, play-next, remove, and jump operations. [`test/AudioQueue.spec.ts`](../test/AudioQueue.spec.ts) covers the model. | Capability exceeds UI. No public editor/queue view or runtime repeat/shuffle control. |
| Delivery | HTTPS selects native progressive `AudioPlayer.src`; cleartext server origin selects Jellyfin AAC/TS HLS through Shaka/MSE. [`music.ts`](../src/services/jellyfin/music.ts) and `audioPlayer` implement the split. | Code-confirmed. Historical device notes support both routes; current per-route hardware rerun is unresolved. |
| Media focus | Root navigator supplies Kepler component instance; audio service calls `setMediaControlFocus` before player initialization. | Code-confirmed; a live playback run confirms an audio session can start, not that all KMC commands routed from retail hardware work. |
| Start/transition | New play replaces the queue. `ended` advances with a duplicate-event guard. Manual next differs from auto-next for repeat-one. | Code-confirmed and unit-tested. Gapless/crossfade is not offered or evaluated. |
| Previous/seek | Previous restarts over 3 s and otherwise moves earlier; KMC FF/RW/skip maps to ±10 s; seeking clamps at duration − 0.5 s. | Code-confirmed; direct-play seek is historical device-confirmed. Current HLS and physical remote seek are unresolved. |
| Errors | Native error moves forward until three consecutive failures, then stops and exposes a generic message. Shaka reports a code/category on terminal HLS error. | Code-confirmed. No user Retry, retry policy, per-item skip choice, offline/reconnection state, or test fault matrix. |
| Jellyfin watch state | `reportPlaybackStart`, `reportPlaybackProgress`, and `reportPlaybackStopped` are implemented for video in `src/services/jellyfin/index.ts` and called by `PlayerScreen`; `audioPlayer` does not import/call them. | Code-confirmed P0 parity gap. Music therefore has no demonstrated server watch-state/resume/session reporting, unlike Jellyfin Web/Android TV. |
| Persistence/lifecycle | `stop()` invalidates late loads and deinitializes audio/Shaka; video handoff calls stop. No persisted queue/item/position/repeat/shuffle. | Code-confirmed. Background continuation is historical device evidence, not current process-survival proof. |
| Background policy | `App.tsx` observes `AppState` only for telemetry; `audioPlayer` has no app-state pause/release branch. Historical music notes report continued audio after backgrounding. | Code-confirmed behavior plus historical device result, but current official lifecycle guidance says to stop content playback/release resources when an app is backgrounded. This is a certification/product-policy risk, not evidence that background audio is approved. |

### UI, navigation, remote, and accessibility

| Surface | Current behavior | Finding |
|---|---|---|
| Music library | Artists, Albums, Genres, Playlists; paginated browse; poster/list mode; A--Z rail in [`MusicScreen`](../src/screens/MusicScreen/index.tsx). | Strong TV library foundation. No global Songs surface, favorites, filters/sorts, or music search-specific path established here. |
| Artist/album/collection | Artist has Play all, Shuffle, expand albums/top tracks; album has Play, Shuffle, View artist; playlist has Play/Shuffle and track order; genre resolves to albums. | Artist/album navigation is mature enough for a first release. Genre lacks a direct play/shuffle semantic because it is album-only. |
| Dock | Global [`NowPlayingBar`](../src/components/NowPlayingBar/index.tsx) displays art/metadata/state/progress/error and opens Now Playing across routes. | Device-confirmed while playback was active. Excellent continuity; one focus target is too coarse for transport. |
| Expanded Now Playing | [`NowPlayingScreen`](../src/screens/NowPlayingScreen/index.tsx) has art, metadata, elapsed/total, focusable Play/Pause and Back. Only left/right D-pad changes tracks. | Confirmed major product gap: no visible next/previous, scrubber, repeat/shuffle, queue, retry, or position-in-queue. |
| Context/command UI | No music-specific Menu/long-press/overflow screen. | Deliberate 1.1 scope, not proven impossible on Vega. |
| Remote | Shared [`useRemoteInput`](../src/hooks/useRemoteInput.ts) collapses up phases, holds async dedupe, and gives transport to KMC so D-pad navigation remains browse-safe. | Strong documented accommodation. Actual retail-remote/voice matrix has not been re-run on this exact installed build. |
| Idle/burn-in | [`AudioIdleVisual`](../src/components/AudioIdleVisual/index.tsx) activates after 3 min and consumes first input through [`audioIdleGate`](../src/services/audioIdleGate/index.ts). | Appropriate response to historical screensaver suppression; VoiceView/reduced-motion/high-contrast validation missing. |
| Accessibility/focus | `FocusableItem` provides a button role and focus styling. Dock has an explicit label; many tabs, tiles, actions, and track rows lack labels and selected/current/checked semantics. | Code-confirmed gap. No documented focus restoration after Now Playing or modal queue return. |

### Relevant historical evidence retained with scope

`docs/music-support-notes.md`, `AUDIO-EDITION.md`, and `docs/release-1.1.0.md`
record a 2026-07 Vega device spike: direct HTTPS play and seek; HTTP native
audio failure but JS/Shaka HLS success; background advancement; screensaver
suppression; duplicate ended; double D-pad phases; and D-pad/KMC dual skip.
These are valuable Device-confirmed results for the recorded app/device/server
versions, but not a permanent Vega-wide guarantee. The current audit found no
contradictory code and did not claim a broader result.

## Scenario matrix

“N/O” means not observed in the current physical run. It is an explicit test
gap, not a pass.

| User outcome | Astra current result | Jellyfin/Web-TV evidence | Mature-TV comparison | Vega evidence | Classification and next validation |
|---|---|---|---|---|---|
| Start selected music | Artist Play all built a queue and played on current device; source replaces queue. | Web API offers PlayNow/PlayShuffle; Android TV has play-now/index queue. | Apple TV supports Play Next/Play Last; Spotify exposes queue. | `AudioPlayer` supports app-owned playback UI. | Implemented; test a single track, album, playlist, genre, search origin. |
| Browse while listening | Global dock present in source and current live run. | Web/Android maintain now-playing state. | Apple queue and Spotify Now Playing support continuation. | No platform dock supplied; app must render it. | Implemented. Test focus return and video browse specifically. |
| Queue visibility/editing | Internal only; N/O public UI. | Web exposes PlayLast/PlayNext and queue operations; Android TV add/remove/clear/peek. | Apple queue allows select, shuffle/repeat, Play Next/Last; Spotify queue controls next items. | KMC typings make playlist handlers app-owned, not automatic. | Astra UX gap; prototype a remote-safe queue overlay. |
| Shuffle/repeat | Model supports it, initial Play Shuffle exists; N/O runtime controls. | Web has SetShuffleQueue/SetRepeatMode; Android TV toggles queue order/repeat. | Apple and Spotify expose both. | Vega documents EnableShuffle and SetRepeatMode as core KMC commands; Astra's inherited W3C handlers are NOP unless it overrides them. | Astra integration/UI gap, not Vega limit. |
| Previous/next | Previous threshold, next, auto advance code-confirmed; no visible buttons. | Web/Android support both. | Apple/Spotify expose them. | KMC supports app override; default next/previous are NOP. | UX and KMC-state gap; physical semantics matrix needed. |
| Seek | ±10 s KMC path and currentTime implementation; N/O current remote/HLS. | Web player supports seek. | Standard transport convention, but UI mechanics differ. | W3C exposes HTML media APIs and basic KMC seek. | Implemented path; verify physical FF/RW and near-end on HTTPS/HLS. |
| Track end | Guarded advance/repeat-one model. | Both reference clients have queue progression. | Standard queue behavior. | Native ended event is available. | Implemented logic; device-test duplicate ended and rapid transitions. |
| Background/return | Historical continued play; current injector Home was inconclusive. A launcher-to-CLI-relaunch run cannot measure either because `launch-app` starts Astra at home. | Android TV uses an Android service path; not portable. | TV docs do not prove comparable process policy. | Official lifecycle docs require releasing unused media; do not equate with audio guarantee. | Unresolved Vega/current-build test gap. |
| Relaunch persistence | No source persistence; a controlled launcher-to-CLI-relaunch run returned to home with no dock/temporary queue. | Server has playback reports/resume, not necessarily temporary queue restore. | Product-dependent. | No cited Vega automatic persistence. | Current CLI-relaunch behavior confirmed; true process-death distinction and desired resume scope remain open. |
| System controls/metadata | KMC handler installed; app does not publish its own queue metadata/session state. | Web server session differs; Android reports a partial lazy queue. | Apple system UI is platform-specific. | KMC has metadata/session/playlist types and focus-ranked endpoints. | Astra integration opportunity; actual system UI visibility unresolved. |
| Jellyfin watch/resume state | Music has no code path to start/progress/stopped report. | Web typings expose all three; Android TV sends all three and queue/order data. | Mature streaming clients generally preserve listening state, but implementation varies. | Vega does not prevent ordinary HTTPS reporting; this is not a media constraint. | Astra parity gap; add ordered/coalesced audio session reporting, then validate in Jellyfin. |
| Popup/context commands | N/O music popup. | Android TV KeyProcessor contexts include queue/actions. | Apple uses Now Playing/queue actions. | Vega focus APIs can support modal roots; no automatic menu design. | App UX gap; validate focus trap before building. |
| Loading/error/network | Buffering/error string in dock; no Retry/reconnect UI. | Web has playback error/start/stop events; exact music UI N/O. | Spotify support documents recovery steps, not TV flow. | Native media events and KMC exist; no automatic recovery guarantee. | Astra UX/test gap. |
| Artwork/metadata | Track art/title/artist/album shown; placeholders in code. | Jellyfin provides image/item data. | Apple documents metadata/art/lyrics in Now Playing. | KMC metadata type supports art/album/artists. | Improve fallback/load/error semantics only after a corpus test. |
| Accessibility/focus | Visible border and basic roles; labels/state/restore incomplete. | Android’s semantics are not portable. | tvOS VoiceOver demonstrates expected outcome only. | Official Vega focus docs support explicit restore/root; UI navigation docs support labels. | Confirmed Astra gap; physical VoiceView test required. |

## Comparative evidence

### Jellyfin parity

The current [Jellyfin Web repository](https://github.com/jellyfin/jellyfin-web)
at `a1c2e13286103953b417966f1c5cc75ddefdecbc` exposes, in
[`sessionPlayer/plugin.js`](https://github.com/jellyfin/jellyfin-web/blob/master/src/plugins/sessionPlayer/plugin.js),
PlayNow, PlayShuffle, PlayInstantMix, PlayLast, PlayNext, next/previous, seek,
repeat and shuffle operations. Its TypeScript API also declares
start/progress/stopped reporting. This confirms that the Jellyfin *client/server
ecosystem* can represent queue and transport behavior; it does not prescribe a
Vega UI.

The current stable [Jellyfin OpenAPI document](https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json)
identifies itself as API `12.0.0` and defines `POST /Sessions/Playing`,
`/Sessions/Playing/Progress`, and `/Sessions/Playing/Stopped`, plus audio
universal-stream and item PlaybackInfo operations. It establishes that the
ordinary current server API has the reporting/delivery primitives; it cannot
prove that the private deployed server is API 12 or that a specific server
configuration/transcode route will accept every request. Astra's missing music
reporting is therefore a client gap pending deployment-version validation, not
a presumed Vega limitation.

The current [Jellyfin Android TV repository](https://github.com/jellyfin/jellyfin-androidtv)
at `03e930b3446a62940adbfd35c909e4e7a73cea57` (release `v0.19.10`,
2026-08-16) has an audio-specific queue in
[`RewriteMediaManager.kt`](https://github.com/jellyfin/jellyfin-androidtv/blob/master/app/src/main/java/org/jellyfin/androidtv/ui/playback/rewrite/RewriteMediaManager.kt)
and reports a lazy next-15-item queue/order/repeat state through
[`PlaySessionService.kt`](https://github.com/jellyfin/jellyfin-androidtv/blob/master/playback/jellyfin/src/main/kotlin/playsession/PlaySessionService.kt).
It supports add/remove/clear/play from index, but its Android media-session and
service lifecycles are **not** a Vega implementation path. Its error reporting
also stops a session with `failed = false`; Astra must not copy that semantics.

### Mature TV clients

| Client/source | Directly supported finding | What Astra may learn | What it must not infer |
|---|---|---|---|
| [Apple Music on Apple TV 4K](https://support.apple.com/guide/tv/control-music-playback-atvbef12564e/tvos) | Now Playing includes controls, metadata, queue, selection of queued item, shuffle, repeat, AutoPlay, Play Next and Play Last; stations/radio have exceptions. | A queue and explicit control state are normal ten-foot music outcomes. | tvOS clickpad gestures, Control Center, VoiceOver, and background policy are not Vega capabilities. |
| [Spotify Now Playing](https://support.spotify.com/us/article/now-playing/) and [Queue](https://support.spotify.com/us/article/play-queue/) | Play/pause/skip/shuffle/repeat and a queue that controls what plays next; rearrange/remove/clear instructions vary by device. | Queue visibility and next-item control are mature expectations. | These pages are not TV-specific proof of remote layout or feature parity. |
| [Spotify on TV](https://support.spotify.com/us/article/spotify-on-tv/) | TV support/recovery guidance calls out connectivity, updates, restart, reinstall, and alternate network. | Errors should explain recovery state rather than silently churn a queue. | It does not document a TV queue, accessibility, or background contract. |
| [YouTube Music on TV/connected devices](https://support.google.com/youtubemusic/answer/9231765) and [shuffle/repeat](https://support.google.com/youtubemusic/answer/9205192) | A phone can control YouTube-on-TV search/browse/playback; the service can restore active queues across connected devices, while its documented shuffle/repeat scope depends on the source context. | Cross-device queue restoration and controller-driven TV playback are deliberate service products with scope/privacy trade-offs, not mere player defaults. | Casting/controller and account-synced queue state do not imply that an Astra local Jellyfin queue should be persisted or remotely editable. |
| [Plex Play Queues](https://support.plex.tv/articles/202188298-play-queues/) | Queue is temporary, supports continuous playback, shuffle, reorder/remove/add. | A temporary queue is distinct from a permanent playlist. | The source is old and does not prove current Plex-TV UI behavior. |

The comparison establishes a stable behavioral norm—visible queue, explicit
transport and shuffle/repeat, clear now-playing context—not identical widgets.
Apple is the strongest current TV-specific primary source. Spotify confirms
music semantics but not TV mechanics; Plex is conceptual and dated.

## Vega OS capability dossier

### Confirmed contracts

- [AudioPlayer documentation](https://developer.amazon.com/docs/vega-api/0.22/README.amazon-devices_react-native-w3cmedia.html)
  says `AudioPlayer` is a TypeScript class for audio-only MP3/DASH/HLS, can
  prebuffer, renders no controls, and expects the app to build its media UI.
  That directly supports an Astra dock/Now Playing/queue implementation.
- [W3C Media/KMC integration](https://developer.amazon.com/docs/vega/0.21/media-player-media-control.html)
  says W3C media can publish basic state and handle play/pause/seek, and an
  app may pass an override handler to `setMediaControlFocus` for custom
  commands. [KMC overview](https://developer.amazon.com/docs/vega/0.21/media-controls-guide.html)
  describes async, session-targeted handlers, provider discovery ranked by
  focus, and app-maintained session capability/state.
- The installed `KeplerMediaControlHandler.d.ts` confirms that default
  `handleNext`, `handlePrevious`, `handleEnableShuffle`, `handleSetRepeatMode`,
  `handleGetMetadataInfo`, and `handleCustomAction` are NOP/playlist-management
  behaviors until overridden. Astra already overrides next/previous but does
  not expose or publish shuffle/repeat/metadata state.
- Installed KMC types contain artwork, artists, album/genre, track and seek
  range, action capabilities, playlist/repeat/shuffle data, and session state.
  This proves an integration route, not how Fire TV system UI renders it.
- The checked-in Amazon reference
  [`reference/vega-audio-sample`](../reference/vega-audio-sample) at
  `5017d914cf2956658d752993f8a94dffd097c082` (sample manifest `2.23.0`,
  2026-06-19) uses the same broad design: `AudioPlayer` for MP3/MP4, Shaka
  for adaptive media, KMC focus before initialization, custom play/pause/stop/
  start-over/seek handlers, loading/buffering state, and cleanup. Its full
  player and focus-preview screen both subscribe to Kepler app-state changes
  and pause when backgrounded. This is a valuable current Amazon example, but
  a sample's scoped preview/full-player policy is not an unconditional Vega
  contract or a substitute for a music-service decision.
- [`manifest.toml`](../manifest.toml) declares the KMC playback-server
  interface plus the optional Previous, Next, SkipForward, SkipBackward and
  the AdvancedSeek feature. The current
  [KMC attributes/features reference](https://developer.amazon.com/docs/vega/0.22/media-controls-attributes-features.html)
  lists EnableShuffle and SetRepeatMode as core commands: no manifest entry is
  needed to receive them. Astra still needs to override its inherited NOP
  handlers and synchronize queue state; a manifest declaration never supplies
  playlist behavior.
- [Focus Management](https://developer.amazon.com/docs/vega/0.22/focus-management.html)
  documents default Cartesian D-pad behavior, `TVFocusGuideView`, directional
  overrides, `setFocus`, and `setFocusRoot`; `hasTVPreferredFocus` applies only
  at mount. Queue/popup focus restoration is feasible but must be deliberately
  implemented and tested.
- [Using On-Screen Navigation](https://developer.amazon.com/docs/vega/0.22/using-on-screen-nav.html)
  documents `aria-label`, position-in-set, and alternate voice labels for RN
  interactive components. Current Astra controls can improve semantic labels
  without importing an Android accessibility system.

### Important limits and unanswered questions

- Official [media requirements](https://developer.amazon.com/docs/vega/0.22/media-player-requirements.html)
  require unused media resources to be released when backgrounded and retain
  context for quick resume in its VOD guidance. It does not prove an
  unconditional background-audio/process-survival policy for Astra.
- The current [foreground/background guide](https://developer.amazon.com/docs/vega/0.23/foreground-background.html)
  says the Fire TV home launcher/physical Home action backgrounds the app and
  lists stopping playback/releasing resources as cleanup. The current
  [Appstore test guidance](https://developer.amazon.com/docs/vega/0.22/test-before-submission.html)
  separately says that an *audio streaming app* should continue when a
  screensaver/Ambient experience appears. These are distinct transitions. The
  sources do not authorize continued music after Home/background, so Astra's
  historical background-audio choice requires policy clarification or current
  acceptance evidence. The current checked-in Amazon audio sample also pauses
  its player on a `background` state change; that is corroborating example
  evidence, not a policy ruling.
- No examined official source establishes lock-screen/notification artwork,
  a browser-like default mini-player, saved queue restoration, or a reliable
  system queue editor. Treat those as unresolved.
- The historical cleartext result is unusually specific: JS fetch/Shaka HLS
  worked while a native `AudioPlayer.src` HTTP fetch failed. It is a
  fetcher/route condition, not a universal “Vega audio cannot use HTTP” claim.
- Real remote, voice, command-options/manifest, focus loss, Bluetooth/HDMI,
  network-loss, and native-HLS-parsing behavior remain device/firmware test
  work. The current generic injector did not provide a valid KMC stimulus.

## Gap register and recommendations

| Priority | Finding | Classification/confidence | Recommendation and acceptance test |
|---|---|---|---|
| P0 | No visible/editable queue despite a capable pure model. | Astra product/UI gap, high. | Add queue entry from Now Playing; initial commands Jump, Remove, Play next, Clear; show current/next/order/repeat/shuffle. D-pad all actions, return focus to invoking control, VoiceView labels, and no duplicate KMC/D-pad operation. |
| P0 | Now Playing makes core transport invisible and repeat/shuffle unavailable after start. | Astra UX/KMC-state gap, high. | Add focusable Prev, Play/Pause, Next, ±10s seek, repeat cycle, shuffle toggle, queue and Retry; preserve browse left/right semantics. Device test KMC and visible controls separately. |
| P0 | Music error/loading/recovery lacks decision controls. | Astra UX/test gap, high. | Render loading/buffering, unsupported-item, server/offline, and exhausted-error states with Retry/Skip/Back as appropriate. Test failure before metadata, mid-track, transition, and recovery. |
| P0 | Music does not report Jellyfin start/progress/stopped playback state. | Astra/Jellyfin parity gap, high. | Reuse the proven session-reporting discipline but design an audio-specific queue/session contract. Acceptance: one start, coalesced monotonic progress, one stopped report per session; item/position/repeat changes, error, next, background, video handoff, and late requests are all ordered and inspected server-side. |
| P1 | Music controls lack complete accessible names/state and documented return focus. | Astra accessibility gap, high. | Add labels, selected/current/checked roles where supported; make modal root/return targets explicit; verify high contrast, VoiceView, D-pad, and idle wake press. |
| P1 | KMC session richness is not deliberately published by Astra. | Astra integration opportunity, medium. | Evaluate overriding metadata/session state plus shuffle/repeat/next/previous only after a system-control test demonstrates the presentation and command path. Never assume the UI renders it. |
| P1 | Background music policy conflicts with current generic lifecycle guidance. | Astra/Vega certification risk, high confidence in the conflict; desired music policy unresolved. | Obtain an official audio-specific background answer or Appstore acceptance evidence. Then make Home/background behavior explicit and test Home, app switch, Ambient/screensaver, TV power, warm return, and resource release separately. |
| P1 | Queue/repeat/shuffle do not survive relaunch. | Product choice, medium. | Decide scope after user evidence. If adopted, persist only sanitized queue IDs/order/current position/settings and reconcile unavailable server items; test process death. |
| P2 | Genre is browse-only album grid. | Astra UX gap, medium. | Research whether “play genre” should flatten albums/tracks, then add a predictable scoped action or preserve the intentional browse-only policy. |
| P2 | Artwork fallback/load failure treatment and burn-in motion accessibility are underspecified. | Astra content/accessibility gap, medium. | Define precedence/fallback and test missing/slow art plus reduce-motion/VoiceView. Do not add bulk disk cache without a Vega storage/performance case. |
| Hold | Headless audio service. | Intentional non-goal, high. | Existing in-UI player historically survived background; official requirements do not require a rewrite. Reconsider only after controlled lifecycle measurements show an unmet need. |
| Hold | Android media session, notification/lock-screen behavior, external-player intents. | Platform mismatch, high. | Do not port Android TV code. Re-open only with current Vega API evidence. |
| Hold | Server playlist creation/import/export. | Product/API scope unresolved. | No implementation until a TV-safe editing and permission/error design is independently justified. |

## Research-completeness audit

| Plan completion criterion | Evidence | Status |
|---|---|---|
| Versioned code/test map | Current source map, package versions, targeted tests, and navigation/player/queue/component inventory above. | Complete. |
| Astra result for baseline matrix | All scenarios are covered with current behavior or explicitly `N/O`; basic browse/start/dock is current device-confirmed. | Complete as an audit matrix; several entries are unresolved tests, not passes. |
| Current physical evidence for critical transport/lifecycle/focus | Current device confirms browse/start/dock/focus and a launcher-to-CLI-relaunch clears the ephemeral dock. Current physical KMC, HTTP-HLS, genuine foreground resume, audio continuity under launcher, interruption, and process-death runs are not validly reproduced. | Incomplete. |
| Jellyfin parity + two mature TV-music comparisons + web contrast | Jellyfin Web and Android TV source; Apple TV and Spotify primary sources; Plex conceptual contrast. | Complete with stated platform caveats. |
| Every Vega constraint has official/probe support and version scope | Claims are linked to official docs, installed typings, or dated local device evidence; open questions are marked unresolved. | Complete. |
| Missing web/Jellyfin behavior classified | Gap register classifies app, platform mismatch, product choice, and unresolved items. | Complete. |
| No uncited current product/platform claims or private data | External claims are linked; current Astra paths are linked; device identity and library metadata are redacted. | Complete. |
| Prioritized recommendations and no-change options | Gap register includes acceptance tests and Hold decisions. | Complete. |

The dossier is ready for product and implementation planning. The unresolved
physical matrix is intentionally retained rather than converted into a Vega
claim; it must be closed before certifying platform behavior or accepting any
change that depends on it.

### Physical-evidence boundary at audit close

The remaining matrix entries are not absent because the source was uninspected
or because a generic simulator was substituted for a device. The connected
non-simulated device is available and Astra playback was reproduced on it, but
the following test surfaces were unavailable to this audit:

- The developer `inputd-cli` reports no attached input devices and injects
  generic Linux key codes only. Its play/pause, stop, Home, and next-song
  injections did not produce a KMC command on the playing app. A retail remote,
  Alexa/voice route, or a purpose-built Vega KMC-client app is required to
  establish actual provider routing; the generic injector cannot be promoted
  to that evidence.
- The Vega CLI can launch an app but has no verified foreground-resume action.
  Launching the system launcher followed by `launch-app` establishes only the
  observed CLI-relaunch reset, not Home-button continuity, system background
  policy, or audio survival.
- No non-personal controlled Jellyfin corpus/server telemetry route was
  available for cleartext HTTP-HLS, malformed media, or network-fault tests.
  The connected private profile was intentionally not disrupted or logged for
  those probes. A sanitized test server/corpus is required.

These are **external test-surface gaps**, not a request for an application
rewrite and not evidence that Vega lacks the affected capability. The appendix
names the minimum inputs required to close them.

## Appendix: required hardware follow-up script

Run on the same app artifact and record device/firmware/remote/server route;
do not capture tokens or titles.

1. Controlled HTTPS direct play: play, pause/resume with physical remote,
   KMC next/previous, ±10s seeks near start/end, track end, repeat modes, and
   queue changes.
2. Controlled HTTP Jellyfin profile/corpus: verify metadata/artwork fetch,
   HLS manifest/segments, start, seek, background/return, and actionable
   failure when server cannot transcode.
3. KMC/system: inspect actual system transport presentation; test remote,
   Alexa/voice if available, menu, Guide/Home, video handoff, and duplicate
   event traces. Generic `inputd-cli` key names are insufficient evidence.
4. Lifecycle/network: Home/background 30+ seconds, foreground, app process
   termination/relaunch, server interruption before metadata/mid-track/at
   transition, network restoration, and no overlapping video/audio ownership.
   Record Home/app-switch separately from Ambient/screensaver: current official
   guidance treats them differently for audio streaming.
5. Accessibility: VoiceView, high contrast, all focusable music nodes, queue
   modal trap/restore, text scale/magnifier if enabled, and first idle-visual
   wake press.
6. Jellyfin reporting: inspect a new music session on the server while playing,
   pausing, advancing, stopping, failing and handing off to video. Confirm no
   stale progress revives a stopped session and that resume behavior is a
   deliberate product choice.

Record each result as pass/fail/unresolved with exact steps and sanitized
screenshots/logs. A failure on one route/device must be conditioned by that
route/device, not generalized to all Vega OS.
