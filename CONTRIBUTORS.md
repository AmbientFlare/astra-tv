# Contributors

Astra is developed by AmbientFlare. The people below wrote code that is now
part of Astra. Thank you, all of you. You gave your time to a project you
didn't have to, and every Astra user benefits from it.

The list is permanent. An entry stays even if the code is later rewritten,
because the work shaped what Astra became. New contributors are added in the
release that first ships their code. Each entry links the pull request and
lists the commits on `main` that carry their authorship.

## Code contributors

### [@gerritsa](https://github.com/gerritsa)

First shipped in **1.5.1**.

- Faster seeking ([#31](https://github.com/AmbientFlare/astra-tv/pull/31)):
  presses add up into one jump, holding speeds the step up, Jellyfin
  Trickplay thumbnails show while seeking, and seeks wait for the last one to
  finish instead of piling up. Commits
  [`54667dc`](https://github.com/AmbientFlare/astra-tv/commit/54667dc) and
  [`1529a9b`](https://github.com/AmbientFlare/astra-tv/commit/1529a9b).
- Subtitle appearance and control auto-hide
  ([#32](https://github.com/AmbientFlare/astra-tv/pull/32)): the
  shadowed-text and dark-box subtitle setting, and playback controls that
  hide again after resuming. Commit
  [`f56b55c`](https://github.com/AmbientFlare/astra-tv/commit/f56b55c).

### [@toomanybyt3s](https://github.com/toomanybyt3s)

First shipped in **1.5.1**.

- Decoder width ceiling for HD-only devices
  ([#25](https://github.com/AmbientFlare/astra-tv/pull/25)): Astra reads the
  widest video the device's decoder accepts and asks Jellyfin not to send
  anything wider, so 4K films can play on 1080p-only sticks. Commit
  [`455e542`](https://github.com/AmbientFlare/astra-tv/commit/455e542).

### [@brontodev](https://github.com/brontodev)

First shipped in **1.2.1**.

- Skip Credits and Next Episode
  ([#14](https://github.com/AmbientFlare/astra-tv/pull/14)). This code was
  worked into a larger playback change rather than merged as a branch, so
  their name is not on a commit; the credit is recorded here instead. The
  Jellyfin media-segments client that Skip Credits runs on (`getMediaSegments`
  and the `JellyfinMediaSegment` type) is their code. They also designed the
  feature's shape: a decision module kept separate from the player, with
  credits taken from the server's own `Outro` segments instead of guessed
  offsets. Landed in
  [`88dcf7e`](https://github.com/AmbientFlare/astra-tv/commit/88dcf7e).

## Reports and testing

Detailed reports with server-side evidence made these fixes possible:

- **[@eamcd](https://github.com/eamcd)**, **[@Jailbone](https://github.com/Jailbone)**
  and **[@stspivey421](https://github.com/stspivey421)**: playback, subtitle
  and Live TV reports behind the 1.2.1 and 1.3.0 fixes.

## Contributing

Astra is source-available, not open source (see [LICENSE.md](LICENSE.md)).
Pull requests are still read, and if your code is used, in whole or in part,
you are listed here.
