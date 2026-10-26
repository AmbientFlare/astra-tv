# Video seeking

Both directional and dedicated transport buttons use the configured
Settings > Playback > Seek duration. Repeated presses add to a pending
movie-time target rather than the native player's changing media clock.
The progress bar previews that target immediately. Playback seeks after
800 ms without another press, or immediately on Select. Back dismisses
the preview and any queued target; a native seek already dispatched may
still finish.

Holding a direction increases its step after one second (three times the
configured interval) and after 2.5 seconds (six times), capped at 60 seconds.
The configured 60-second interval stays at 60. Releasing or reversing resets
the acceleration. A gap longer than 500 ms also resets it for media-control
channels that do not provide a release event. Acceleration changes only the
preview target, not playback speed or the number of in-flight native seeks.

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

## Thumbnail previews

`SeekThumbnail` fetches `Fields=Trickplay` metadata once per item, media
version and authentication context. When the server has already generated
images, movie time selects a sprite sheet and a frame inside that sheet.
Headers authenticate image requests; access tokens are not added to image
URLs. Relative routes preserve a server URL's reverse-proxy base path.

Only the selected media version is eligible. Sprite geometry is validated,
with an eight-million-pixel limit and a 4096-pixel limit on either axis.
The preview fits within 240 by 180 layout units. Movement inside a sheet
reuses its image source; actual decoded dimensions handle a final sheet
with fewer rows. An image stays hidden until loaded, so an old frame is
not presented as the new target.

Preview requests are independent of the video pipeline: they never request
video segments, start a transcode or generate thumbnails on the client.
Missing metadata, unsupported server responses, authentication failures or
image errors leave timestamp seeking available. An image failure suppresses
further image attempts for that context to avoid retries on every keypress.
Metadata requests have an eight-second timeout and are cancelled on context
change or unmount. Native image loading and caching still need device checks.

The server API contract follows Jellyfin's
[Trickplay controller](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/TrickplayController.cs)
and [metadata DTO](https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Model/Dto/TrickplayInfoDto.cs).

## Automated checks

`test/VideoSeeking.spec.ts` covers accumulation, direction changes, bounds,
queued targets, cancellation, errors and native event observation.
`test/PlayerSessionIntegration.spec.tsx` covers remote key phases, media-control
ownership, stale native positions, Select/Back, resumed HLS timelines,
short and long paused seeks, delayed playback after reload and teardown.
`SeekAcceleration.spec.ts` checks held input versus taps, reversal, release,
gaps and step limits. `Trickplay.spec.ts` checks source selection, geometry,
authentication, base paths and request bounds. `SeekThumbnail.spec.tsx`
checks cropping, partial final sheets, reuse, failures and context changes.

## Physical-device acceptance

Automated tests mock the Vega media pipeline. Before shipping, run these
checks on a Fire TV with a Jellyfin server:

- Tap, rapidly press and hold each direction using both button families.
  Check the preview accumulates, reverses cleanly and lands at the target.
- Hold past one second and 2.5 seconds, then release and tap again. Check the
  step grows to its cap and resets, without extra native seeks while scanning.
- Test generated Trickplay images, a server without them, a missing sprite,
  the final partial sheet and an item with multiple media versions. Confirm
  scenes match movie time after resume and that timestamp seeking always works.
- Watch native memory and network use when scanning across sprite boundaries
  during high-bitrate playback; native image caching is not simulated by Jest.
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
