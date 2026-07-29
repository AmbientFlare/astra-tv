# Astra 1.1.0

Version 1.1.0 adds couch-first Jellyfin music playback while preserving Astra's
movie and television experience.

## User-visible changes

- Browse music by artist, album, genre, and playlist.
- Switch between remembered poster and list layouts and move quickly through
  large collections with an A–Z rail.
- Open artist discographies, expand albums with cover artwork, and play a song,
  album, playlist, or shuffled album.
- Continue automatically through the album or playlist that supplied the
  selected song.
- Keep music playing while browsing Astra or while Astra is backgrounded.
- Seek with FF/RW and use the dedicated Play/Pause media button.
- Open the docked player for a simplified Now Playing screen. Left/Right changes
  tracks only on that screen and remains normal focus navigation elsewhere.
- Use Astra over an ordinary cleartext Jellyfin LAN address without configuring
  TLS or a reverse proxy.
- See large Movies, TV Shows, and Music cards built from server artwork.
- See unwatched episode counts on series posters, capped at `99+`.
- Use animated in-app burn-in protection during audio playback and paused
  video. The first input dismisses the visual without also activating a
  control.

## Deliberate scope

Astra 1.1.0 does not expose an editable music queue, per-track action popup,
music-specific long-press controls, or playlist creation. Hardware testing
showed those interactions competed with Vega focus navigation. Selecting a
track replaces the internal playback sequence with its source album or
playlist, providing predictable automatic advancement.

## HTTP compatibility

Vega accepts cleartext requests made by JavaScript but rejects cleartext media
URLs handed directly to its native audio pipeline. Astra therefore selects
delivery by saved server origin:

| Jellyfin origin | Audio delivery |
|---|---|
| HTTPS | Progressive direct play |
| HTTP | AAC audio in MPEG-TS HLS through ShakaPlayer |

The HLS request deliberately excludes source containers such as MP3. Including
MP3 makes Jellyfin silently choose direct play instead of returning an HLS
manifest.

## Validation

- Release: `1.1.0` build `2026072904`
- Target: x86_64 Fire TV running Vega OS
- Tests: 158 passing across 19 suites
- ESLint and TypeScript: passing
- Vega manifest and ABI validation: passing
- Exact package installed and launched on physical device

The Amazon upload file and checksum are documented in
[release-build.md](release-build.md).
