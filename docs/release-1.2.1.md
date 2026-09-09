# Astra 1.2.1 release candidate

Version 1.2.1 adds two playback preferences users have been asking for — a
global subtitle setting and Skip Credits / Next Episode — and fixes a resume
stall found on hardware while validating them.

## What's new

- **Subtitle preference** (Settings > Playback > Subtitle mode): Default
  (per video), All subtitles on, All subtitles off, Only forced. Resolved
  against Jellyfin's PlaybackInfo response for every new video, movie or
  episode, initial playback or resume, before the stream is built — so the
  same track and burn-in decision the preference implies is what actually
  plays. Choosing a track in the player during playback affects only that
  session and never rewrites the global preference.
- **Skip Credits** (Settings > Playback > Skip intro/credits: Ask /
  Auto-skip / Ignore): a focused card appears during the credits, sourced
  from Jellyfin's `Outro` media segments where the server provides them, or
  from a chapter named "Credits" otherwise. No fixed timestamps are assumed.
- **Next Episode** (Settings > Playback > Next episode autoplay, countdown
  duration): an episode with a resolvable successor offers Next Episode on
  its credits card, and an "Up next" countdown or "Continue watching?" card
  at the end of the episode. Movies never auto-advance. Unattended autoplay
  is capped at three episodes in a row, after which Astra stops and asks;
  choosing Next Episode by hand always resets the count, as does starting a
  new playback session.

## Fix found during validation

Testing the subtitle preference on hardware surfaced a playback stall:
resuming, jumping a long distance, or switching tracks on a session with
burned-in subtitles could load the stream and then sit on "Buffering"
indefinitely, with Stats for Nerds showing zero frames decoded and a single
buffered range far ahead of the playhead.

Jellyfin's fMP4 transcode for that route keeps the source's own timestamps
(`-copyts`), so a segment that starts mid-file is timestamped at its
position in the source — for example 5,595 seconds into a two-hour movie —
while Shaka's playhead starts at zero. In segments mode Shaka trusts the
segment's own timestamp, so the two never meet. The equivalent MPEG-TS
stream-copy route was unaffected: it carries no init segment, so this class
of drift cannot occur there.

`shouldUseSequenceModeForMidFileStart` switches only an fMP4 session whose
start time is above zero into Shaka's HLS sequence mode, which places each
segment immediately after the last regardless of its own timestamp. From-start
fMP4 playback and every MPEG-TS session are unchanged.

## Validated on device

Physical Fire TV Stick, Vega OS 1.2:

- All subtitles off, all subtitles on (including a burned-in PGS track), and
  Default (per video) each start the right track across multiple titles; an
  audio-track switch preserves the subtitle choice.
- A movie's and a series episode's credits both show the card; Skip Credits
  jumps to the end of the credits and nothing auto-plays afterward for a
  movie.
- Next Episode from the credits card, and from the end-of-episode prompt,
  starts the correct following episode.
- Autoplay chains through episodes automatically, with burned-in subtitles
  on, and stops on "Continue watching?" after the third episode; Back
  during an "Up next" countdown cancels it without navigating.
- Resume, audio-track switching, and long chapter jumps on the previously
  accepted stream-copy route are unaffected.

## Release metadata

- Version: `1.2.1`
- Build: `20260902.1`
- Build date: `2026-09-02`
- Built against Vega SDK `0.24.9914`

## Known limitations, carried forward

- A double-arrow chapter jump still takes roughly 38 seconds to resume
  playback; this predates 1.2.0 and is below the JS thread.
- Subtitles rendered by the app can drift out of sync after a long seek that
  requires buffering. Astra currently burns in every subtitle rather than
  rendering text tracks itself, which avoids this for ordinary playback.
- Server discovery scans port 8096 only, so a Jellyfin instance on another
  port must be added by URL.
- The episode detail screen's Play button does not relabel itself "Resume"
  the way the movie detail screen does, even though it does resume from the
  saved position.
