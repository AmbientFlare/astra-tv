# Astra 1.4 TV UX Refresh Plan

## Summary

- Consolidate the non-music findings from `EXTERNAL_USER_FEEDBACK.md`,
  `EXTERNAL_MENTIONS_INDEX.md`, and the current implementation into this
  canonical plan; record future execution progress in
  `docs/IMPLEMENTATION_STATUS.md`.
- Treat “basic/clunky” as a discoverability, navigation, consistency, and
  browsing-trust problem—not justification for rewriting the stable playback
  core.
- Use an artwork-led, remote-first design influenced by Wholphin/Moonfin
  patterns: persistent navigation, first-class Favorites, stronger focus
  feedback, useful metadata near focused content, and customization without
  animated carousels or autoplaying previews.
- Preserve current music behavior but exclude its screens and research from
  this work. Defer Live TV to a separate feature plan requiring the offered
  tuner/EPG test environment.

## Implementation Changes

### Shared TV design system and navigation

- Add centralized color, spacing, typography, focus, card, scrim, and safe-area
  tokens; migrate non-music screens away from duplicated literal styles.
- Introduce shared `TVScreen`, `Artwork`, `MediaCard`, `ActionButton`,
  `SectionRow`, `Hero`, and loading/error/empty-state primitives.
- Replace Home’s isolated top buttons with a collapsed left navigation rail on
  Home, libraries, Favorites, and Search. It expands when focused and contains
  Home, available video libraries, Favorites, Search, Settings, and profile
  switching.
- Keep detail and playback screens immersive without the rail. Hardware Back
  remains authoritative; remove redundant on-screen Back actions where they do
  not add context.
- Preserve the custom route stack, focus restoration, library-session cache,
  playback routes, and global now-playing shell.

### Home, Favorites, library, and search

- Recompose Home around the user’s likely intent:
  - Focus starts on Continue Watching when populated, otherwise Next Up, then
    the first library.
  - Continue Watching and Next Up use landscape cards with progress and episode
    context.
  - Latest Movies/Shows retain poster cards.
  - Focus updates a restrained backdrop and metadata preview using
    already-loaded data; no auto-rotation or trailers.
- Add remote-friendly Home customization: show/hide and move sections up/down.
  Dynamic server-library rows follow the configured standard sections.
- Add a first-class Favorites destination backed by Jellyfin server state.
  Fetch video favorites globally and group them into Movies, Shows, and
  Episodes; hide empty groups and provide a clear all-empty state.
- Keep the existing library grid plus information panel, but expose Sort,
  Filter, Favorites, and Display through a visible “Library options” action
  instead of a hidden interaction.
- Redesign Search with the same grid/preview language as libraries while
  preserving the current two-character threshold and debounce. Do not store
  search history.
- Invalidate affected Favorites and library views after favorite/watched
  mutations so returning from details cannot show stale state.

### Detail pages and browsing trust

- Consolidate movie, series, season, and episode heroes around one hierarchy:
  title and essential metadata, synopsis, primary Play/Resume action, then
  Favorite/Watched/Trailer or contextual actions.
- Replace text-heavy action rows with consistent icon-and-label controls and
  unmistakable selected states.
- Add favorite, watched, unwatched-count, and playback-progress indicators to
  cards where Jellyfin supplies those values.
- Make artwork failure explicit:
  - Distinguish missing image metadata from an image request failure.
  - Fall back to a readable title placeholder instead of leaving a blank card.
  - Ensure failed backdrops never reduce text contrast.
- Preserve unknown server views and folders rather than filtering them out.
  Empty screens must distinguish a valid empty collection from a request
  failure and always offer retry for failures.
- Keep image requests bounded to display size and preserve the 1.3
  library-loading and focus-restoration performance gains.

### Public interfaces and persisted data

- Extend the route union with `favorites` and introduce a typed primary-
  destination model for the navigation rail.
- Add `HomeSectionId` and a persisted `homeSectionOrder` preference. Existing
  installations receive the default order while retaining their current
  visibility booleans.
- Add `getFavoriteItems()` to the Jellyfin service using
  `/Users/{userId}/Items` with `Recursive=true`, `Filters=IsFavorite`, and video
  item types; do not weaken existing library-scoped APIs.
- Extend shared card/artwork props with aspect variant, progress,
  favorite/watched badges, fallback state, and focus-preview callbacks.
- Keep storage reads backward compatible; malformed or absent new preferences
  fall back safely without deleting existing server profiles or playback
  settings.

### Feedback, backlinks, and release consistency

- Keep backlinking as a discoverability workstream, not an application feature.
- Add a release checklist covering the website, website release page, public
  GitHub default branch, Amazon copy, JellyWatch listing, Jellyfin forum post,
  and known external articles.
- Update project-controlled version/install surfaces to one release value and
  lead with “Vega OS vs Fire OS” eligibility plus the Amazon Appstore path.
- Publish fresh 1.4 screenshots for Home, Favorites, library, search, and
  details only after physical-device acceptance.
- Request focused post-release retests for the historical missing-art/empty-
  folder complaint and issues #15/#17; classify older “slow/clunky” claims as
  historical until retested.

## Test Plan

- Component tests: navigation-rail expansion and routing, deterministic initial
  focus, card variants/badges, artwork failure fallback, hero contrast, visible
  library options, and unified detail actions.
- Data tests: global favorites request shape, grouping and empty groups,
  mutation invalidation, unknown-folder preservation, and preference
  migration/order fallback.
- Interaction tests: Home → library → detail → Back restores the exact card;
  Home → Favorites reflects favorite/unfavorite changes; Search → detail → Back
  preserves query/results; loading, empty, failure, and retry states remain
  focusable.
- Regression gates: TypeScript, ESLint, complete Jest suite/snapshot, release
  build, and no changes to playback delivery/session behavior.
- Physical Vega acceptance at 1920×1080: cold launch, every D-pad path, no focus
  traps, readable overscan/safe areas, long-row scrolling, missing/broken
  artwork, large libraries, profile switching, background/resume, and Back
  behavior.
- Performance acceptance: no regression from 1.3 library loading, no full-
  screen re-fetch on focus changes, stable card layout during image failure,
  and responsive navigation while artwork loads.

## Assumptions and Defaults

- The first release targets navigation and browsing quality, Favorites
  discoverability, customization, and artwork/folder trust; it does not attempt
  feature parity with mature Android clients.
- The current dark visual identity and cyan accent remain, but are normalized
  through tokens and stronger contrast.
- Music routes continue to work unchanged and are excluded from redesign
  acceptance.
- Live TV, DVR, Seerr integration, themes, trailers-on-focus, and editable music
  features are explicitly outside this implementation.
- Existing dirty documentation changes and the untracked music-research files
  must be preserved.
