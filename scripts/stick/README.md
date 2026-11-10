# On-stick playback tests

Jest covers the player's logic. This covers what Jest cannot: a real decoder,
a real server and the real remote, on a Fire TV stick on the bench.

```bash
npm run test:stick                      # test the build already on the stick
npm run test:stick -- --install build/armv7-release/astra_armv7.vpkg
npm run test:stick -- --list
```

A run takes about twelve minutes and stops at the first failure. Screenshots
of every check go to `tmp/stick-test/<time>/`; the one named `FAILED-…` shows
the screen at the moment a step failed.

## What it checks

1. A cold start reaches Home.
2. Home leads to a detail page.
3. Playback starts at the beginning (through Play from Start when the title
   has saved progress), the position advances, and the build on the stick is
   the one in `src/config/app.ts`.
4. Pause holds the position and resume moves on.
5. Seeking forward and back lands where it should and keeps playing.
6. Menu opens Playback Options and Back closes it.
7. Back asks before stopping; Stay keeps playing and Leave returns to the
   detail page.
8. A second session starts straight after the first was torn down.
9. Leaving well into the film makes the detail page offer Resume, and Resume
   picks up where it left off.
10. Home during playback: the same Astra process is still there 20 s later,
   returning to it shows the detail page, and it plays again.

After every step it also checks that Astra is still the process the run
started with, so a crash and restart fails the run even if the screen looks
right.

Not covered yet: audio and subtitle switching, the next-episode countdown,
credits prompts, the sleep timer, and Live TV.

A failure is not always Astra's. If the stick's link to the server is slow
the player sits on "Stream loaded" and steps fail with "Playback is not
advancing"; the Bandwidth line in the failure screenshot shows the network
speed the player measured.

## What it needs

- One stick connected (`vega device list`). With several, set `ASTRA_STICK`
  to a serial.
- Astra signed in on the stick, with **Settings → Stats for Nerds** on. The
  tests read the position, build and failure line from that panel.
- `tesseract` and Python 3 with Pillow on this machine.
- A playable title. `ASTRA_STICK_ITEM_PATH` is the remote presses from a
  fresh Home to its detail page; the default, `DOWN,RIGHT,ENTER,ENTER`, is
  the first title of the second library in the first row under Live TV on
  the lab server.

The title is played for a few minutes and left about ten minutes in, so the
server will show it as in progress for the signed-in user.

## How it works

`stick.py` drives the stick through the Vega CLI: `inputd-cli` for remote
presses, `gwsi-tool-screenshooter` for the screen, `vlcm list` for the app's
process and state. JS console output reaches no log the CLI can fetch, so
the screen is the only view of the player: each screenshot is read with
tesseract. The position is read twice, once in the whole panel and once on
its own line, and counts only when both agree.

Things learned the hard way:

- `KEY_HOME` is accepted and does nothing. `KEY_HOMEPAGE` is the Home button.
- `vega device launch-app` restarts a running app. `vlcm launch-app` on the
  stick returns to it, as picking the tile does.
- A seek commits itself after 0.8 s. Pressing OK after that pauses.
- Ending Astra while it plays means the server is never told to stop. A
  server with throttling off has by then transcoded the whole film, and it
  keeps the files: about 10 GB a time on the lab server, where five of them
  filled the disk and nothing would play. Astra now sends the missing stop
  report at its next launch, which frees them, but the suite still leaves
  the player first, both after a failure and before a fresh start.
- The stick keeps only its last few seconds of log. The run records it as it
  goes and saves it as `stick.log` beside the screenshots; without that
  there is nothing to say why Astra went away.
