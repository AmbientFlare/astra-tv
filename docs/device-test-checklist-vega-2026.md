# Device test checklist: Vega sticks (1.6.0)

Run this on each stick before a store submission. Mark each line pass, fail
or n/a, with the build number and date.

| Stick | Model | In the lab? |
|---|---|---|
| Fire TV Stick 4K Select (2025) | AFTCA002 | Not yet. Levi has one ("have"), but it is not on the bench. |
| Fire TV Stick 4K, 3rd Gen (2026) | AFTCR001 | **Yes**: `GT55NP0263130L67` |
| Fire TV Stick HD (2026) | AFTCL001 | No |

The model is in `/etc/platform-info`
(`vega device run-cmd -d <serial> -c 'cat /etc/platform-info'`).

## 1. Install and start

- [ ] The armv7 package installs over the store build as an update, and saved
      servers and sign-ins survive.
- [ ] Cold start reaches Home. A fresh install reaches the language picker,
      then Setup.
- [ ] `tar -tf <vpkg> | grep '^lib/'` lists only `lib/armv7/` entries.
- [ ] `manifest.toml` version matches the release.

## 2. Device model (P0)

- [ ] Settings → About shows the stick's name and OS version (AFTCR001:
      "Fire TV Stick 4K (3rd Gen) · OS 2.0", seen 2026-10-27).
- [ ] Stats for Nerds shows the same `Device` line.
- [ ] With telemetry armed, `app.start` carries `model` and `os`.

## 3. Bitrate limits (P0)

- [ ] **AFTCR001 / AFTCL001:** an H.264 file above 20 Mbps is re-encoded. Stats
      for Nerds shows video Transcode, and the server reason includes the
      bitrate.
- [ ] **AFTCA002:** the same file up to 30 Mbps is copied.
- [ ] **All:** a 4K HDR10 HEVC remux above 35 Mbps (the 60–80 Mbps samples)
      is still copied, not re-encoded. Watch 10 minutes and note any dropped
      frames or rebuffering. This is the HEVC headroom test.
- [ ] **AFTCL001 only:** a VP9 or AV1 4K file is re-encoded, not offered to the
      decoder. Its VP9 decoder stops at 1080p.

## 4. HEVC fMP4 experiment (P0)

Settings → Playback → HLS segment length → "HEVC as fMP4 (experiment)".
Compare the same title with the switch off (MPEG-TS) and on.

- [ ] A 4K HDR10 remux starts, and Stats for Nerds shows container mp4 and
      2-second segments.
- [ ] 30 minutes with no micro-stutter on panning shots. The old fMP4 problem
      was duplicate timestamps on open-GOP sources: look at slow pans.
- [ ] Seek forward and back 5 times; picture and sound recover each time.
- [ ] Audio stays in sync after 30 minutes (AC3 and AAC sources).
- [ ] A subtitle burn-in (PGS) re-encode works. In this mode it aims at
      20 Mbps; see the gap analysis.
- [ ] Result recorded: keep TS as default, or switch.

## 5. Reliability (P1)

- [ ] Home button during playback: Jellyfin's dashboard shows the session stop
      within 5 seconds, and the resume point is right on reopening.
- [ ] Force-stop during playback (`vega device terminate-app`): the stop and
      position still reach the server.
- [ ] Unplug the router's uplink or Wi-Fi during playback: the "no connection"
      overlay shows. Restore the network and press Retry: playback carries on
      from the same point.
- [ ] Same on Home and in a library: the overlay shows, and Retry reloads.
- [ ] Unplug for under 3 seconds: no notice.
- [x] On Home, Back three times opens the exit prompt ("Press Back again to
      close the app, or choose Stay."), and Back again closes Astra
      (AFTCR001, build 2026102706, 2026-10-27).

## 6. Features (P2)

- [ ] Sleep timer 15 minutes: playback pauses at 15:00, and the server shows
      the position.
- [ ] Sleep timer "end of episode": playback stops at the credits or the end,
      and autoplay does not start the next episode.
- [ ] A new series with the Jellyfin user's audio language set (Dashboard →
      Users → Playback) starts in that language with no Astra setting changed.
- [ ] Commentary and audio-description tracks are never picked automatically.
- [ ] Pick a different audio or subtitle track in episode 1; episode 2 of the
      same series starts with the same pick.

## 7. Memory and long play

- [ ] Two hours of 4K HDR playback with no crash (1 GB RAM on every stick).
- [ ] Leave Astra for another app for 10 minutes mid-video, then come back:
      Astra resumes, or returns to the details page, without crashing.
