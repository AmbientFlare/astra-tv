# Jellyfin Android TV Reference Inventory

This inventory was taken from `~/projects/reference/jellyfin-androidtv` during Astra Step 6.

## Startup, Servers, And Users

- Splash/startup routing, stored server/user bootstrap, auto sign-in.
- Server discovery, manual server add, server validation, server delete/update.
- Public user listing, stored/private user listing, username/password login.
- Quick Connect login.
- User image display and switch-user flows.
- Authentication sorting and auto-sign-in preferences.

Blockers/adaptations:
- Android Activity/Fragment lifecycle, XML layouts, Toasts, permissions, and Leanback toolbar patterns need React Native/Vega equivalents.
- UDP discovery is not available in current Vega RN deps, so Astra uses HTTP subnet probing unless a socket module is added.

## Home And Library Browsing

- Home rows for views/libraries, latest media, continue watching, next up, now playing/audio queue, live TV, recordings, and notifications.
- Enhanced browse/grid screens for movies, TV, music, playlists, folders, genres, letters, suggestions, collections, favorites, recently added, premieres, and similar items.
- Sort/filter/jump-letter interactions.
- Poster, thumb, backdrop, missing-art placeholders, watched indicators, and favorite indicators.
- Series navigation through series details, seasons, next-up, and episodes.

Blockers/adaptations:
- Android Leanback row/grid adapters and presenters are Android-specific. Data queries port directly; focus/grid UI must be React Native.
- Android resource drawables/icons need replacement with RN assets or generated/vector assets.

## Item Details

- Full item detail page with poster/backdrop, synopsis, ratings, genres, runtime, people/cast, similar items, next up, favorite/watched toggles, trailers, resume/play buttons.
- Detail lists for episodes, music favorites, and arbitrary item collections.
- Context menus via KeyProcessor for play, shuffle, favorite, watched, queue, delete, and details.

Blockers/adaptations:
- Android popups, fragments, and resource layouts need RN screens/overlays.
- Destructive actions such as delete should remain deferred until confirmation UX exists.

## Playback

- PlaybackInfo request using device profile, media source selection, start ticks, audio/subtitle stream indices, direct play/direct stream/transcode selection.
- Video playback controller, previous/next item, queue, next-up prompt, still-watching prompt.
- Start/progress/stopped session reporting.
- Resume position via Jellyfin `UserData.PlaybackPositionTicks`.
- Audio track selection, subtitle track selection, chapter selection, quality/bitrate selection, playback speed, zoom/aspect ratio.
- Subtitle styling preferences and subtitle offset.
- Media segment controls such as intro/credits handling.
- External player support.
- Audio now-playing screen and music queue.

Blockers/adaptations:
- ExoPlayer/VLC/external-player code does not exist on Vega; playback must use Amazon W3C `VideoPlayer`, `KeplerVideoSurfaceView`, and Shaka for HLS/DASH later.
- Refresh-rate switching, codec forcing, AVC/HEVC levels, Android audio focus, and external player intents are platform-specific.
- Embedded text/audio track switching depends on W3C media track behavior and may require stream reloads through Jellyfin PlaybackInfo.

## Search

- Search screen and search view model using Jellyfin item search.
- Remote/keyboard query handling and result browsing.

Blockers/adaptations:
- Android SearchManager/Intent integration is Android-specific. The Jellyfin query ports directly.

## Live TV And DVR

- Live TV guide grid, channels, program details, recording popup, recording schedule, recordings browsing, timers, favorites, channel filters/order.

Blockers/adaptations:
- Guide grid and popups are Android view-heavy and need RN rewrites.
- DVR APIs are portable, but recording UX needs confirmation and conflict states.

## Photos, Music, And Screensaver

- Photo player and photo queue.
- Audio now-playing, albums/artists, lyrics UI, favorites.
- In-app screensaver and Android TV channel/dream integration.

Blockers/adaptations:
- Android DreamService/Leanback channel integration is not available on Vega.
- Photo/music data APIs port; playback/display surfaces need RN equivalents.

## Settings

- Main settings and routes for authentication, server/user management, customization, home sections, library display, live TV guide options, playback, subtitles, screensaver, telemetry, developer tools, about, and licenses.
- Playback settings include player choice, max bitrate, codecs, AVC/HEVC levels, buffer length, audio behavior, refresh rate switching, zoom mode, next-up, inactivity prompts, resume subtract duration, prerolls, and media segments.
- Customization includes theme, clock, backdrop, watched indicators, subtitle background/text/stroke colors.

Blockers/adaptations:
- Android SharedPreferences/DataStore, Compose screens, and Android-specific player settings need RN storage and Vega-specific capability checks.
- License/about content ports directly; app version/GPL/backend/Ko-fi sections are straightforward.

## Integrations, Telemetry, And Background Work

- Crash/telemetry configuration and upload.
- Android WorkManager periodic updates for Leanback channels.
- Media content provider, launcher integrations, recommendations, and notifications.

Blockers/adaptations:
- Android WorkManager, content providers, TV channels, intents, and notification APIs do not map directly to Vega.
- Telemetry should be redesigned for an open-source GPL app with explicit opt-in.

## Straight-Port Priority

- Jellyfin data calls: libraries, resume, next-up, search, item details, seasons, episodes, PlaybackInfo, play-state reporting.
- RN screens: home rows, library grids, search, item details, settings/about, playback overlays.
- User-configurable defaults backed by Astra storage.

## Adaptation Priority

- HLS/DASH/Shaka playback path.
- Robust W3C embedded/external subtitle rendering and styling.
- Bitrate/media-source switching without playback disruption.
- Live TV guide grid.
- Android-specific integrations replaced with Vega-native equivalents if available.
