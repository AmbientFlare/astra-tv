# Video seeking

Both directional and dedicated transport buttons use the configured
Settings > Playback > Seek duration. Repeated presses add to a pending
movie-time target rather than the native player's changing media clock.
The progress bar previews that target immediately. Playback seeks after
800 ms without another press, or immediately on Select. Back dismisses
the preview and any queued target; a native seek already dispatched may
still finish.

`VideoSeekController` owns accumulation, the debounce timer, cancellation
and the one-operation-at-a-time rule. Further input during a seek replaces
the queued target. A cancelled session cannot later dispatch that target.
Preview movement does not change subtitle timing or report uncommitted
positions to Jellyfin.

`SeekMediaControlHandler` routes Vega media-control commands through the
same controller. D-pad copies of dedicated transport keys are ignored
after media-control focus is claimed; D-pad handling remains available if
claiming that focus fails. Key-up events do not seek again. Other media
commands retain the SDK's default handling.

The player retains its existing strategy: jumps of at least 60 seconds,
or backward jumps before the start of a trimmed HLS playlist, rebuild the
stream. Shorter jumps wait for existing SourceBuffer work and native
`seeked`. A missing completion event triggers a reload after 15 seconds.
Reloaded seeks wait for `playing`, which calibrates the resumed HLS clock,
before allowing the next target to run. Both routes preserve pause state.
The preview shows timestamps; it does not request thumbnail images.

## Automated checks

`test/VideoSeeking.spec.ts` covers accumulation, direction changes, bounds,
queued targets, cancellation, errors and native event observation.
`test/PlayerSessionIntegration.spec.tsx` covers remote key phases, media-control
ownership, stale native positions, Select/Back, resumed HLS timelines,
short and long paused seeks, delayed playback after reload and teardown.

## Physical-device acceptance

Automated tests mock the Vega media pipeline. Before shipping, run these
checks on a Fire TV with a Jellyfin server:

- Tap, rapidly press and hold each direction using both button families.
  Check the preview accumulates, reverses cleanly and lands at the target.
- Confirm early with Select; dismiss with Back. Repeat while a seek is
  buffering. There must be no delayed extra jump after dismissal or exit.
- Test a small skip, a combined jump beyond one minute and the start/end
  boundaries, while playing and paused.
- Resume well into a video, then seek forward and back beyond the resumed
  playlist's beginning. Check movie time, subtitle timing and server reports.
- Repeat for H.264 and high-bitrate HEVC, stream copy/remux and active video
  transcoding. Record time to the first frame, stalls and native errors.
- Leave the player or background Astra during preview, native seeking and
  stream rebuilding. No old callback should affect subsequent playback.
