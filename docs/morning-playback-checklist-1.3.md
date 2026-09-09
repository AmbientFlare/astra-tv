# Astra 1.3 morning playback checklist

The candidate is already installed on the development Fire TV. Check Settings
→ About for version **1.3.0**, build **20260905.1**. It is not a public release.
Use ordinary viewing first; no server configuration changes are needed.

For any failure, record the title/episode, approximate playback timestamp,
what you pressed, whether subtitles were on, and whether sound or picture
stopped first. Photograph the error or playback stats if available. Avoid
sharing tokens, server credentials, or unredacted private logs.

## First pass — normal use

- [ ] **Start a movie and an episode.** Picture and sound start normally;
  pause for roughly a minute, then resume. Pausing should not trigger recovery.
- [ ] **Resume something partway through.** Check the scene, time counter and
  progress bar agree. Exit, reopen, and verify the saved position is close to
  where you stopped, allowing a small reporting/segment delay.
- [ ] **Seek both ways.** Try repeated short backward/forward seeks, a large
  jump, a chapter jump if available, and a backward jump just after resuming.
  Playback should resume near the chosen point, not jump to the beginning or
  show a nearly finished bar halfway through the title.
- [ ] **Switch subtitles on, then off.** Playback should continue near the
  same point, subtitles should appear/disappear, and audio should stay synced.
  A brief reload is expected. If another audio track exists, switch it too.
- [ ] **Exit while loading.** Start a title and immediately press Back. Stay
  on the library for a little while: no late audio or surprise playback.
- [ ] **Go Home during playback, then reopen Astra.** Playback should stop in
  the background and return to the library, not continue invisible audio.
  Reopening the title should work.
- [ ] **Music → video → music**, if you use music. No overlapping audio;
  both players should remain usable after switching.

## During actual watching

- [ ] **Watch continuously for at least an hour.** Check lip sync at the
  beginning, middle and end; note freezes, repeated reloads or audio dropouts.
  Ideally do this once with an HEVC title without subtitles and once with an
  H.264/fMP4 title with subtitles. Use stats/server playback information if
  available; client codec labels alone are inferred, not proof of the route.
- [ ] **Let an episode truly finish.** It should not finish early. Confirm
  the next-episode card/countdown works, and Back dismisses it. With autoplay
  enabled, verify the next episode starts; with it disabled, verify it waits.
- [ ] **Check credits and movie endings.** Try Skip Credits when offered.
  A finished movie should not launch unrelated content. Check Jellyfin's
  watched/resume state after leaving the player.

## Optional controlled checks

- [ ] **Brief connection interruption.** Only if convenient, disconnect the
  Fire TV's network (do not shut down a shared server), then restore it.
  Playback should recover near its prior position or show a usable error/Retry
  state, not spin forever or falsely announce the episode has finished.
  Retry after restoring the connection. Photograph any error/stats.
- [ ] **Second Vega device, if available.** Use the same Jellyfin account on
  both, play different titles, and confirm Jellyfin shows separate devices
  and stopping one does not disturb the other. Skip if no second device.

Do not deliberately corrupt media to test premature EOF. If a natural early
ending occurs, record its timestamp and diagnostics. Automated fault tests
cover this path, but its real-device behavior is not yet verified.

## Report back

“Passed: __. Failed: __. Title/time: __. Steps: __. Subtitles/audio track: __.”
Attach a photo if helpful. Say which checks were skipped; an untested route
is different from a passing one. Audio/video sync needs your eyes and ears.
