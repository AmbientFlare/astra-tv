# Music-player research plan

Status: proposed research only  
Prepared: 2026-09-06  
Scope: establish a defensible comparison between Astra's current music
experience, mature music/media clients, Jellyfin's web experience, and the
capabilities and constraints of Vega OS. This document proposes research; it
does not make product decisions or authorize implementation changes.

## Purpose and decision rule

The research must answer three different questions, without conflating them:

1. What do established music-focused applications normally do, especially in a
   ten-foot, remote-operated experience?
2. What can Astra's current code and device evidence demonstrably do today?
3. For every important difference, is it an Astra product/implementation gap,
   a Jellyfin server/API limitation, a Vega OS limitation, a test/evidence gap,
   or an intentional TV-specific trade-off?

The final audit must not treat a feature found in a browser, Android TV app, or
legacy Fire OS app as a requirement for Vega. A difference becomes a proposed
improvement only after the research identifies the user outcome, the precise
input/lifecycle contract it needs, and a credible Vega implementation route.

## Current implementation summary

### Architecture and state ownership

- Music is an independent playback path, not the video `PlayerScreen` with
  audio styling. `src/services/audioPlayer/index.ts` exports one module-global
  `audioPlayback` service so playback survives navigation between music,
  library, search, and video browse screens.
- The service owns a lazily initialized Vega `AudioPlayer`, an optional Shaka
  wrapper for cleartext-HLS audio, the current Jellyfin music session, a
  generation counter for invalidating late loads, a `PlaybackStatus` observable,
  and a pure queue. It listens to native playing, pause, waiting,
  loadedmetadata, timeupdate, ended, and error events.
- It creates `AudioPlayer` as MUSIC/MEDIA and obtains Kepler media-control focus
  through a root-level component instance before initialization. Device notes
  say this focus acquisition is required for playback to start.
- The pure `src/services/audioQueue/index.ts` model already represents a track
  list, playback order, cursor, repeat off/all/one, and shuffle. It has tested
  operations for create, next/previous, jump, shuffle/repeat changes, enqueue,
  play-next, and removal. The public UI does not expose most editing operations
  or repeat/shuffle changes once a queue is playing.
- `play()` replaces the queue. Album, artist, playlist, and track actions build
  a new queue from their locally loaded tracks; there is no queue persistence,
  queue history, save/restore, or server playlist write path visible in the
  current implementation.

### Delivery, transitions, errors, and persistence

- HTTPS music uses Jellyfin's audio universal URL with a native-container list
  and assigns it directly to `AudioPlayer.src`. The historical device spike
  demonstrated direct play and seeks with this route.
- For a cleartext HTTP Jellyfin server, Astra selects an audio HLS URL and
  loads it through Shaka/MSE. This is a targeted Vega accommodation: ordinary
  JavaScript fetch works over HTTP, but the native audio fetch path was observed
  to reject cleartext URLs. The source code implements this per-server choice;
  current hardware coverage must be independently revalidated.
- Track end advances the queue with a guard against duplicate `ended` events.
  Manual Next advances even in repeat-one; automatic completion repeats the
  current item in repeat-one. Previous restarts the current track after three
  seconds and otherwise moves back; explicit `skipPrevious` always moves back.
- Seeks are direct `currentTime` writes. Remote fast-forward/rewind/skip map to
  10-second seeks through Kepler Media Controls. A 0.5-second end guard avoids
  accidentally turning a near-end seek into an automatic next track.
- Three consecutive errors halt playback with a general actionable message
  instead of rapidly skipping the entire queue. HLS errors surface a Shaka
  error code/category when available. There is no documented music-specific
  retry control, recovery policy, offline state, or per-track error choice.
- The service has cancellation/teardown for stop and music-to-video handoff,
  but research should test its race and interruption behavior as a distinct
  audio lifecycle—not infer it from the more extensive video lifecycle work.
- The chosen in-UI player was physically observed to continue in the background
  in the 2026-07-27 spike. The app does not currently persist the queue,
  track, position, or repeat/shuffle intent across a process death/relaunch.

### Screens, navigation, focus, and visible controls

- Home enters Music on Artists and can open Playlists. `MusicScreen` offers
  Artists, Albums, Genres, and Playlists; paginated/infinite browse; poster or
  list view; and an A--Z/# jump rail. Artist details offer top tracks, albums,
  expand/collapse, Play all, and Shuffle. Album details offer Play, Shuffle,
  View artist, and track start. Genre resolves to albums; playlist resolves to
  ordered tracks with Play and Shuffle.
- `NowPlayingBar` is globally mounted beneath every route, including non-music
  browsing. It displays artwork, title, artist/album, progress, state,
  diagnostics when requested, and a playback error. It opens `NowPlayingScreen`
  when selected.
- `NowPlayingScreen` is deliberately minimal: artwork, metadata, elapsed/total
  time, Play/Pause and Back are focusable. Left/right remote input skips
  previous/next only on this screen. It has no visible seek/scrubber, explicit
  previous/next buttons, queue view, queue editing, repeat/shuffle controls,
  output/device controls, lyrics, track menu, or retry action.
- The service state is subscribed to by music details and the dock to highlight
  the playing row and keep metadata/progress current. Back from Now Playing
  pops the route stack; the dock remains available while a queue exists.
- The shared `useRemoteInput` hook normalizes duplicate down/up delivery,
  prevents an async handler from reopening its duplicate window, and separates
  D-pad navigation from Kepler Media Controls (KMC) transport ownership. This
  exists because a physical skip press was observed on both channels. Volume,
  mute, and Guide are system-owned in existing spike evidence.
- Most music controls are `FocusableItem` buttons. The dock has an explicit
  accessibility label, while many music tabs, tiles, actions, and rows rely on
  their displayed text and do not publish semantic selected/current/checked
  state. Focus restoration after returning from details or Now Playing has not
  been explicitly documented or hardware-tested.

### Vega-specific accommodations already present

- In-UI `AudioPlayer` + `KeplerMediaControlHandler` was selected over a
  headless player service after direct device evidence that background playback
  works. That decision is evidence-backed but device/version bounded.
- Cleartext audio takes the HLS/Shaka route because the native audio pipeline
  rejects HTTP media while JS fetch does not. HTTPS direct play avoids needless
  server transcoding for supported source containers.
- Duplicate remote delivery and D-pad/KMC dual delivery are normalized and
  assigned to one logical owner.
- Vega suppresses the system screensaver during audio playback. Astra therefore
  supplies `AudioIdleVisual`: after three minutes of no input it shows moving,
  rotating queue artwork; the first press only dismisses it and must not also
  operate playback or focus.
- Native player state may be imperfect on MSE sources, so play/pause events are
  treated as authoritative rather than `AudioPlayer.paused` in one path.

### Existing repository evidence to retain and reconcile

- `docs/music-support-notes.md` is the primary historical record: Amazon sample
  architecture, physical audio spikes, remote anomalies, seek behavior,
  background behavior, screensaver evidence, Jellyfin music API discoveries,
  and intended TV UX. It includes superseded hypotheses; research must retain
  dates and distinguish confirmed, corrected, and proposed statements.
- `README.md` and `docs/release-1.1.0.md` state the shipped contract and openly
  name missing editable queue, per-track popup/long-press actions, and playlist
  creation. Treat these as release claims to validate, not as fresh evidence.
- `docs/reference-inventory.md` records the Jellyfin Android TV reference
  surface, including audio now playing, queue, context menus, search, and
  Android-only integrations. It is an inventory, not proof those behaviors are
  portable to Vega.
- `docs/playback-architecture-review-2026-09-04.md`, `docs/release-1.3.0.md`,
  `docs/morning-playback-checklist-1.3.md`, `docs/native-hls-probe-2026-09-05.md`,
  and `docs/IMPLEMENTATION_STATUS.md` contain adjacent lifecycle/platform
  evidence. Video findings must not be automatically applied to audio, but its
  test methodology and handoff conditions are useful.
- `reference/vega-audio-sample` is the checked-in Amazon reference sample. It
  is a useful current implementation comparison for AudioPlayer/Shaka/KMC and
  lifecycle handling, but it is a sample—not a Vega product-policy authority.
- Relevant automated evidence is in `test/AudioQueue.spec.ts`,
  `test/AudioHandoff.spec.ts`, `test/AudioIdleGate.spec.ts`,
  `test/RemoteInput.spec.ts`, `test/JellyfinMusic.spec.ts`, and navigation/app
  tests. These establish code intent and selected pure behavior, not device UX.

## Suspected weak areas to investigate, not pre-judged defects

| Area | Observed current state | Research must establish |
|---|---|---|
| Queue UX | Strong pure model; no public queue screen/editor or actions such as play next/enqueue/remove/reorder. | Which operations are baseline for TV music, which are discoverable with a remote, and whether Vega focus/modal APIs support an accessible queue safely. |
| Expanded Now Playing | Minimal metadata/transport page; left/right is hidden in a hint; no scrubber, repeat/shuffle, queue, explicit transport, or recovery. | Minimum viable ten-foot controls, focus layout, semantics, and which controls should be KMC/system rather than app UI. |
| Seek and transport semantics | 10-second KMC seek only; previous has a 3-second restart rule; next/end/repeat logic exists. | Expectations for press/hold, start-over, unknown duration/live-like streams, near-end clamping, KMC vs D-pad ownership, and discoverability. |
| Playback persistence | Background continuation demonstrated; process-relaunch recovery is absent. | Which persistence scopes mature TV clients offer; what Jellyfin can resume server-side; what local storage and Vega lifecycle make safe. |
| Errors/network | General stop-after-three-errors behavior; static-ish error wording; no explicit retry/offline UI. | User-visible loading/reconnecting/failure patterns, source-specific diagnostics, network loss/return behavior, and safe automatic retries. |
| Metadata/artwork | Basic cover and fallback boxes; dock/Now Playing use track art; historical artist fallback preference exists. | Correct image precedence/fallbacks, resizing/cache behavior, loading/failed artwork states, content labels, and how artwork affects burn-in mitigation. |
| Focus/accessibility | Focusable controls exist, but music semantic labels/state and restoration are incomplete. | Screen-reader/TV accessibility contract, current/selected state, focus trap/return target, nonvisual transport discoverability, motion/burn-in considerations. |
| Context/command UI | No music-specific popup, long-press, overflow, or command surface is shipped. | Whether KMC/Menu/context events and Vega focus behavior can support one without colliding with navigation; exact high-value actions. |
| Library transitions | New play actions replace the queue; album/artist/playlist relationships are present. | Expected behavior for play from row, play all, shuffle, return-to-source, artist/album links, genre behavior, and web-to-TV parity. |
| System integration | KMC focus and remote work; volume/Guide are system-owned; no verified system metadata/notification/lock-screen surface. | What Vega media controls actually display/accept (metadata, artwork, commands, focus arbitration) and what is unavailable by design. |
| Web-originated expectations | Jellyfin web is likely richer and browser media has different fetch/session affordances. | Exact Web UX/API behavior users expect, whether it is server-side or browser-only, and why/when it cannot surface in Vega. |

## Research questions

### Behavioral baseline

For each comparison client, capture observable behavior for: play/pause; item
replacement versus enqueue; play next; next/previous and restart thresholds;
shuffle scope and reshuffle; repeat states; seeking/hold behavior; progress;
track end/gapless or crossfade where offered; queue end; errors; loading;
backgrounding; relaunch/resume; artwork/metadata; album/artist links; and
return-to-browse focus.

Questions requiring explicit answers include:

- When a listener selects a track, album, artist, genre, or playlist, what
  becomes the queue and what must remain visible/editable?
- Which actions belong in the dock, the expanded screen, an overflow/context
  menu, a command palette, the remote's transport keys, or system UI?
- How do mature TV clients communicate current track, position, buffering,
  repeat/shuffle, queue position, and an unplayable item from a sofa distance?
- What does Previous do at 0--3 seconds, after a completed track, in
  repeat-one, and in a shuffled queue? What are the corresponding physical
  remote and visible-button behaviors?
- How do products prevent a system remote event, D-pad key, focus Select, and
  long press from triggering the same operation twice?
- What should happen if a request fails before metadata, after playback starts,
  during a queue transition, while backgrounded, or when the network returns?
- Which playback state belongs to Jellyfin (server progress/resume/user data)
  versus Astra (temporary queue/order/focus) versus Vega (active media session)?

### Jellyfin web and client parity

- Inventory the Jellyfin web player, current official Jellyfin clients, and
  their source/API calls for queue changes, play-next, playlists, resume,
  PlaySession reporting, media metadata, and error treatment.
- For every behavior present on web but absent or broken in Astra, classify it
  as (a) server/API available and feasible, (b) server/API available but needs a
  TV-specific design, (c) browser-only capability, (d) Android/legacy-Fire-OS
  capability with no known Vega equivalent, or (e) not actually supported by
  Jellyfin consistently.
- Test a fresh queue from album/artist/playlist/genre, a selected track in the
  middle, a track from search, a server playlist with mixed/invalid media, and
  a user with no play-count history. Establish whether Astra's data queries and
  queue construction match the intended scope and order.

### Vega OS questions needing special investigation

- What exact media-session capabilities does the current Vega SDK expose for
  `AudioPlayer` and `KeplerMediaControlHandler`: artwork/title/artist updates,
  next/previous/seek, queue/repeat/shuffle state, media-control focus,
  foreground/background behavior, and command acknowledgement?
- Which physical remotes, system overlays, voice controls, and button variants
  deliver D-pad events, KMC commands, both, neither, or repeated phases? Test
  a current retail device and record firmware/SDK/library versions.
- Does focus ownership change when the app is backgrounded, an overlay is open,
  video takes over, the Guide/Home button is used, or playback returns to the
  app? Can two internal players momentarily compete?
- Is background audio policy stable across current Vega versions and Appstore
  policy? Does background audio receive network loss/reconnect events, persist
  through memory pressure, and retain system media controls?
- Confirm current HTTP behavior by origin and transport: JS metadata/artwork
  fetch, native progressive audio, Shaka HLS manifest/segments, HTTPS direct
  play, and a server redirect. Do not label this simply an “audio limitation.”
- Does the native/player+Shaka route expose reliable duration, seekable ranges,
  buffering state, ended, error causes, track transition timing, and metadata
  on direct and cleartext-HLS routes? Are they consistent across supported
  containers and long tracks?
- Does the platform suppress its screensaver for all audio states or only while
  playing? Verify the app idle visual's wake press, focus behavior, motion,
  accessibility, and burn-in impact.
- Which accessibility APIs are implemented and honored on Vega: labels, roles,
  selected/checked/current states, focus announcements, modal semantics,
  reduced motion, and text scaling? Which observed gaps are framework limits
  rather than app omissions?
- Is native HLS parsing usable/beneficial for audio? Existing probe evidence is
  capability-only and explicitly not a performance or reliability result.

## Comparison applications and systems

Use a deliberately mixed set. No single client is the specification.

| Tier | Candidates | Why study them | How to use the evidence |
|---|---|---|---|
| Primary Jellyfin parity | Jellyfin Web, Jellyfin Android TV, Jellyfin Roku/WebOS if current and maintained | Same server/API model; reveals what is server-backed versus client policy. | Prefer source and direct behavior captures; version each finding. Android/Roku/WebOS UI is comparative evidence, never an assumed Vega implementation. |
| TV-music UX | Spotify on TV, Amazon Music on Fire TV/Vega if available, Apple Music on tvOS, YouTube Music TV | Mature ten-foot playback, queue, transport, visual hierarchy, artwork, and remote discoverability. | Observe only repeatable user flows; use vendor help/accessibility documentation for intended behavior. Respect account/availability differences. |
| Media-center peers | Plex TV client(s), Kodi, Emby TV client where access/current documentation exists | Queue/source navigation, local-server interruption, music metadata, and TV context menus. | Separate server features from client UI; capture platform and version. |
| Web/mobile/desktop contrast | Jellyfin Web, Spotify desktop/web, Apple Music desktop/web, VLC/desktop media player as needed | Defines familiar music semantics and browser-only affordances. | Mark them as expectations/semantics references, not direct ten-foot designs. |
| Platform baseline | Official Amazon Vega audio sample, Vega W3C media and media-controls docs, Vega accessibility/focus/input docs; Android TV and legacy Fire OS docs only as contrast | Identifies actual current platform contracts and migration traps. | Official current Vega material outranks samples; Android/Fire OS sources must be labeled non-Vega. |

Candidate selection must be narrowed in the research kickoff to current,
available versions. A candidate with only stale documentation can inform
historical context but cannot establish present behavior.

## Sources and documentation to pursue

Prioritize primary sources, implementation source, and reproducible device
observations. Use secondary articles only to find a primary source or flag a
user-reported issue for verification.

1. Amazon developer documentation for the installed Vega SDK generation:
   W3C `AudioPlayer`; Kepler media controls, including its command
   attributes/features and core-versus-manifest-gated command tables; focus;
   remote/input events;
   app lifecycle/background media requirements; manifest/service rules;
   focus/navigation; accessibility; Appstore media/background policy; and
   release notes/known issues. Retrieve and version the official Vega audio
   sample used by this repository rather than relying on a remembered API.
2. Current source and docs for `@amazon-devices/react-native-w3cmedia`,
   `@amazon-devices/kepler-media-controls`, and
   `@amazon-devices/react-native-kepler`; inspect installed type definitions in
   this checkout as the exact shipped-contract baseline.
3. Jellyfin server API/OpenAPI/SDK types and current server source for:
   audio universal/HLS URLs, `PlaybackInfo`, media sources, user playback
   reporting, `PlaySessionId`, audio playlists, user data/resume, image APIs,
   MusicGenres, pagination/order, and error response semantics. Compare with
   the deployed server version rather than assuming current `master` applies.
4. Current Jellyfin Web and Android TV repositories/release notes, plus their
   visible behavior. Use `docs/reference-inventory.md` as a starting index and
   revalidate it against current revision(s).
5. First-party product support/accessibility materials for selected comparison
   clients. For app behavior without public specification, record a dated,
   screen-recorded/manual observation with device/OS/app version and exact
   inputs instead of presenting it as universal behavior.
6. Standards only for contrast: W3C Media Session, HTML media, and relevant
   accessibility guidance. Explicitly mark web-standard affordances as not
   evidence of Vega support.
7. Repository records listed above, release history, test source, and a clean
   physical-device evidence log. Historical notes with corrected claims must
   remain traceable but cannot be used as final conclusions without validation.

## Proposed comparison methodology

### 1. Establish the audited build and evidence ledger

- Record Astra commit, package versions, Vega OS/device model/firmware, remote
  model, display/audio output, Jellyfin server version/configuration, transport
  (HTTP/HTTPS), library corpus, and comparison-app versions.
- Create a finding ledger with: claim, source type, source URL/path, observed
  date, platform/version, exact steps, expected/actual result, confidence
  (confirmed/likely/unknown), and classification (Astra, Jellyfin, Vega,
  network/server, or intentional trade-off).
- Treat existing device spikes as historical evidence and rerun the critical
  claims on the audited build. Preserve contradictory results rather than
  overwriting them.

### 2. Build a fixed scenario matrix

Use the same scenarios where each client/platform permits it. At minimum:

- Start a single track; start midway through an album; Play all artist; Shuffle
  album/artist/playlist; genre collection; existing playlist; search result.
- Pause/resume; visible and physical next/previous; previous at 0s/2s/4s;
  repeated next; repeat off/all/one; shuffle on/off while playing; end of queue;
  an intentionally malformed or unsupported track.
- Seek forward/backward, near start/end, during loading/buffering, with unknown
  duration if obtainable, and on direct HTTPS versus HTTP-HLS routes.
- Navigate to/from details, browse while playing, open/close now playing, use
  Back/Home/Guide, start video while music plays, foreground/background, force
  process restart where safe, and return after server/network loss.
- Trigger menu/context/long-press/remote transport/voice controls where
  supported; record duplicate delivery or focus changes, not merely success.
- Inspect all loading, empty, artwork-missing, artwork-loading, error, retry,
  server-unreachable, and reconnection states from normal viewing distance.
- Exercise accessibility and focus: first focus, all four directions, modal
  open/close, return target, labels/current state, action discovery, idle
  visual wake press, and text/motion settings where the platform exposes them.

### 3. Compare by user outcome, not widgets

For each scenario, make a row with these columns:

| User outcome | Astra current behavior/evidence | Jellyfin web/client behavior | Mature TV-client convention | Vega capability/evidence | Gap classification | Candidate requirement and validation |
|---|---|---|---|---|---|---|

Use “not observed” rather than filling a cell from memory. A feature can be
considered a candidate only when it has an outcome, a chosen scope, a
Vega-feasible interaction model, and acceptance observations.

### 4. Separate code review from device validation

- Inspect code and tests first to state intended behavior and identify probes.
- Run targeted device tests for timing, focus, lifecycle, remote, and system
  integration. Screen recording plus sanitized app/server logs should be linked
  to each high-impact finding. Never expose Jellyfin access tokens.
- Use a small controlled corpus: supported MP3/AAC/FLAC/ALAC where relevant;
  an exotic/transcode candidate; missing/oversized artwork; multi-disc and
  compilation metadata; very short/long tracks; a bad URL or deliberate server
  outage; and HTTP/HTTPS routes. Do not draw codec conclusions from one song.
- When behavior differs across devices or routes, classify the condition rather
  than averaging it into one platform claim.

### 5. Convert evidence into a prioritized gap register

Rank only confirmed user-impacting gaps by reach, severity, frequency,
Vega feasibility, implementation risk, accessibility impact, and evidence
strength. Keep three separate buckets: implementable Astra changes, external
platform/server follow-ups, and intentional non-goals. Each item must include
its counter-evidence and proposed acceptance test.

## Objective definition of research completeness

Research is complete only when all of the following are true:

- A versioned code-and-test map covers every current music service, UI route,
  state owner, remote path, navigation handoff, and relevant repository record.
- The scenario matrix has an Astra result for every listed baseline scenario;
  critical transport/lifecycle/focus scenarios have current physical-device
  evidence, not just unit tests or historical spikes.
- At least one current Jellyfin parity source and two mature TV-music clients
  have been compared for all core transport, queue, now-playing, library, and
  error/loading scenarios. At least one web/desktop contrast is documented
  explicitly as non-TV reference behavior.
- Every claimed Vega constraint has an official current source, a repeatable
  probe, or both; its SDK/device/version scope and confidence are recorded.
- Every web/Jellyfin behavior missing from Astra is classified with evidence as
  app gap, server/API gap, Vega constraint, test gap, intentional TV trade-off,
  or unresolved. “Vega probably cannot” is not a valid conclusion.
- The report contains no uncited claims about current product or platform
  behavior, clearly labels historical/superseded repository evidence, and does
  not expose credentials, private hostnames, or personal library metadata.
- A final prioritized recommendation list includes measurable acceptance
  criteria and a no-change option where evidence does not justify work.

## Risks of false equivalence

- Browser clients can use Media Session, DOM focus, pointer/keyboard input,
  service workers, tab persistence, and native HTTP fetch behavior that are not
  Vega contracts. Similar UI does not prove similar lifecycle or control paths.
- Android TV and legacy Fire OS use Android media sessions, intents, audio focus,
  Leanback/Compose focus semantics, notification/lock-screen surfaces, and
  background services. None should be described as a Vega capability without
  current Vega evidence.
- A product can show a queue/repeat button while its server, device, or account
  tier implements it differently. Observe consequences—not only controls.
- Jellyfin client source often describes a particular server/version; server
  capabilities, user permissions, metadata quality, and plugins vary. A single
  local library cannot prove universal Jellyfin behavior.
- A device spike on one Fire TV and firmware revision is valuable evidence, but
  it is not a cross-Vega guarantee. Record scope and test variant remotes.
- “Background playback works” is separate from policy compliance, process
  survival, system controls, network recovery, and user expectation.
- An implementation gap may be intentionally omitted because remote focus makes
  it unsafe or inaccessible. The final dossier must articulate that trade-off
  rather than label every difference a defect.
- Screenshots alone hide remote/focus timing, duplicate events, loading races,
  and assistive semantics; pair visuals with exact interaction traces.

## Expected final dossier structure

1. Executive verdict: what Astra does well, the highest-confidence gaps, the
   confirmed Vega constraints, and recommendations that should not be pursued.
2. Scope, versions, methodology, device/server corpus, evidence standards, and
   limitations.
3. Current Astra architecture map: player/service, queue, transport routes,
   event/state flow, UI routes, focus/remote ownership, lifecycle and tests.
4. Current Astra behavior matrix with links to code, tests, and device evidence.
5. Comparative behavior matrix: Jellyfin web/current clients, mature TV music
   apps, and web/desktop contrast; clearly separated observation from inference.
6. Vega OS capability dossier: official API contracts, probes, contradictions,
   firmware/device variability, system media/focus/background/accessibility.
7. Jellyfin/API dossier: source selection, playback/reporting, queue/playlist,
   metadata/artwork, and version/permission constraints.
8. Detailed gap register, each classified as Astra, Vega, Jellyfin, network, or
   intentional trade-off, with confidence and counter-evidence.
9. Prioritized product/technical recommendations with implementation options,
   non-goals, risks, and testable acceptance criteria. No code changes in the
   dossier itself.
10. Appendices: scenario scripts, raw observation logs, source list, version
    table, code/test inventory, terminology, and corrections to historical
    findings.

## Proposed `/goal` prompt for the research phase

```text
/goal Conduct the full, evidence-backed music-player audit described in
docs/MUSIC_PLAYER_RESEARCH_PLAN.md. Do not implement or modify application code.

First read /home/levi/START_HERE.md, the repository instructions, and the plan
in full. Inspect the current Astra music implementation and its tests yourself
before relying on historical notes. Then perform the external research using
primary, current sources and repeatable observations where possible.

Deliver a new research dossier in docs/ (choose a clear MUSIC_PLAYER_RESEARCH_
AUDIT filename) and, only if necessary, update docs/IMPLEMENTATION_STATUS.md
with a concise pointer to the completed audit. Do not change src/, package
dependencies, manifests, production infrastructure, or user data.

The audit must compare Astra with current Jellyfin Web and at least one current
Jellyfin TV client, plus at least two mature TV-oriented music/media clients.
Use browser/desktop or mobile clients only as explicitly labeled contrast.
Research current official Vega OS documentation, the installed SDK/type
definitions, the official Vega audio sample, Jellyfin API/server sources, and
first-party product/accessibility documentation. Version every external source
and cite it with a direct link. Treat third-party reports only as leads unless
independently verified.

Cover: player architecture; state and lifecycle; direct HTTPS and cleartext
HTTP-HLS delivery; playback controls; mini-player; expanded Now Playing; queue
construction, editing and visibility; album/artist/genre/playlist navigation;
shuffle and repeat; seek, previous/next and track-end semantics; transitions;
background and relaunch persistence; system media controls; popup/context/
command UI; focus and remote interactions; TV-oriented design; accessibility;
artwork/metadata; loading/error/retry/network interruption; music-to-video
handoff; and web-client-originated expectations.

For each discrepancy, classify it with evidence as: Astra implementation gap,
Jellyfin server/API limitation, Vega OS limitation, network/content condition,
intentional TV-specific trade-off, or unresolved. Do not infer Vega limitations
from web, Android TV, legacy Fire OS, or a single historical device spike. Mark
all hardware results with device, Vega firmware/SDK, remote model, server
version, route (HTTP/HTTPS), exact steps, and confidence. Revalidate critical
historical claims on the current audited build where feasible, including media
control focus, duplicate remote events, background audio, system screensaver,
direct-play seeking, and cleartext-HLS audio.

Use the plan's scenario matrix and completeness criteria as hard acceptance
criteria. The final dossier must include an executive verdict, source/version
ledger, current code/test map, comparison matrices, Vega capability dossier,
Jellyfin/API analysis, raw test scripts/evidence, a prioritized gap register,
and implementation-ready but code-free recommendations with acceptance tests.
Explicitly state findings that do not justify a change. Never expose credentials,
private URLs, access tokens, or personal library data.
```
