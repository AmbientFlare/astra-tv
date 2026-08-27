# Source Selection via Jellyfin MediaSources (design note for next Astra update)

Date: 2026-08-24
Status: implemented 2026-08-25

## Why this note exists

Nebula Bridge (Levi's Jellyfin plugin) resolves streams from TorBox/indexers. Today
the server auto-picks the best cached stream and clients just play it. We want users
to be able to choose a source (e.g. lower resolution on bad bandwidth) — but with one
hard constraint:

**Amazon review constraint: Astra must NOT grow any plugin-like or sideload-y
features.** Source selection uses only data Jellyfin returns in its standard
PlaybackInfo response. There is no custom streaming protocol and nothing that
reads as a content-piracy facilitation layer inside the client. The intelligence
lives entirely in the Nebula Bridge plugin; Astra just displays what Jellyfin gives
it, like any well-behaved Jellyfin client. This is what keeps Astra in the Fire TV
store while giving users the capability.

## The key fact

Jellyfin item DTOs (`/Items/{id}` / `/Users/{uid}/Items/{id}`) already contain a
`MediaSources` array. When Nebula Bridge exposes multiple cached sources as alternate
versions of an episode/movie, each source appears in that array with:
- `Name` — human label incl. quality ("4K HDR", "1080p", etc.)
- `Size` — bytes (useful for low-bandwidth picking)
- `Container`, `MediaStreams` — format info
- `Id` — stable per-source id

Astra now requests this payload when a playable detail screen opens and retains all
distinct source IDs.

## Implemented behavior

1. When an item has `MediaSources.Length > 1`, offer a native "Select Source" action
   (long-press menu / options on the detail or pre-play screen).
2. Render the list from the array fields above: name + rounded size + container.
3. Play by passing the chosen `MediaSource.Id` (or full MediaSource info) into the
   existing playback-info/play flow Jellyfin already supports — same mechanism the
   official clients' version-switcher uses.
4. The choice is carried into the player for the current play action. The default
   remains Jellyfin's first/default source when the user makes no choice.

## What NOT to build

- No scraping, resolving, debrid, torrent, or indexer logic in Astra — ever.
- No dependency on Nebula Bridge being installed: with 0–1 sources the UI simply
  doesn't appear; Astra stays a plain Jellyfin player.
- No non-Jellyfin playback or source endpoint. Astra's separate optional Nebula
  capability/hydration requests only prepare standard Jellyfin hierarchy records.

## Server-side counterpart (tracked in nebula-bridge/REVIEW_NOTES.md)

Nebula Bridge now preserves the complete MediaSources array for an unpinned PlaybackInfo
request and returns the selected source when a client pins `MediaSourceId`.

## Resolved questions

- The Vega player already accepted `mediaSourceId`; its source lookup incorrectly used
  array index zero after the request. It now selects the matching response source.
- The UI is a detail-screen Versions button and remote-focusable menu for movies and
  episodes.
