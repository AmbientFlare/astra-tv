# Source Selection via Jellyfin MediaSources (design note for next Astra update)

Date: 2026-08-24
Status: proposal / brainstorm — no implementation yet

## Why this note exists

Nebula Bridge (Levi's Jellyfin plugin) resolves streams from TorBox/indexers. Today
the server auto-picks the best cached stream and clients just play it. We want users
to be able to choose a source (e.g. lower resolution on bad bandwidth) — but with one
hard constraint:

**Amazon review constraint: Astra must NOT grow any plugin-like or sideload-y
features.** Everything below uses ONLY data Jellyfin already returns in its standard
API responses. No new server endpoints consumed, no custom protocol, nothing that
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

Astra almost certainly already fetches this payload today and ignores everything
beyond the first/default source.

## What to build in Astra

1. When an item has `MediaSources.Length > 1`, offer a native "Select Source" action
   (long-press menu / options on the detail or pre-play screen).
2. Render the list from the array fields above: name + rounded size + container.
3. Play by passing the chosen `MediaSource.Id` (or full MediaSource info) into the
   existing playback-info/play flow Jellyfin already supports — same mechanism the
   official clients' version-switcher uses.
4. Optional nicety: remember last choice per item locally; default remains whatever
   Jellyfin marks as the default source so autoplay behavior is unchanged.

## What NOT to build

- No scraping, resolving, debrid, torrent, or indexer logic in Astra — ever.
- No dependency on Nebula Bridge being installed: with 0–1 sources the UI simply
  doesn't appear; Astra stays a plain Jellyfin player.
- No new network endpoints beyond stock Jellyfin API.

## Server-side counterpart (tracked in nebula-bridge/REVIEW_NOTES.md)

Nebula Bridge needs to stop discarding its per-source virtual items'
alternate-version links so sources actually populate `MediaSources`. That work is
described in the plugin repo, not here.

## Open questions for next session

- Confirm Vega OS player code path: where playback info is fetched, whether
  `MediaSources` is currently parsed at all.
- Verify chosen-source playback: does the current play flow accept a specific
  mediaSourceId, or does it need a small change?
- UX placement: long-press vs detail-screen button (Vega OS remote conventions).
