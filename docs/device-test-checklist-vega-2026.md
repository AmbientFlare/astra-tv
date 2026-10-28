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

- [x] Settings → About shows the stick's name and OS version (AFTCR001:
      "Fire TV Stick 4K (3rd Gen) · OS 2.0", seen 2026-10-27).
- [x] Stats for Nerds shows the same `Device` line (AFTCR001, build 2026102818, 2026-10-28).
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

- [x] Home button during playback: Jellyfin's dashboard shows the session stop
      within 5 seconds, and the resume point is right on reopening (stop seen
      about 4 s after another app opened; 3000 Miles to Graceland; AFTCR001, build 2026102818, 2026-10-28).
- [x] Force-stop during playback (`vega device terminate-app`): the stop and
      position still reach the server (stop seen 0.1 s later (AFTCR001, build 2026102818, 2026-10-28)).
- [ ] Unplug the router's uplink or Wi-Fi during playback: the "no connection"
      overlay shows. Restore the network and press Retry: playback carries on
      from the same point.
- [ ] Same on Home and in a library: the overlay shows, and Retry reloads.
- [ ] Unplug for under 3 seconds: no notice.
- [x] On Home, Back three times opens the exit prompt ("Press Back again to
      close the app, or choose Stay."), and Back again closes Astra
      (AFTCR001, build 2026102706, 2026-10-27).

## 6. Features (P2)

- [x] Menu → Sleep timer → 15 min: playback pauses at 15:00, the "Sleep timer
      ended" notice shows, and the Jellyfin dashboard shows the session stopped
      at that position (AFTCR001, build 2026102818, 2026-10-28).
- [ ] Press Play or Select on that notice: playback carries on from the same
      point and the dashboard shows a new session.
      **Fails** (AFTCR001, build 2026102818, 2026-10-28): the new session starts and buffers, but the
      player stays paused; a second Play press is needed. The wake reload goes
      through `startPlayback` with reason `seek` while `isPausedRef` is still
      true from `goToSleep`, so `restorePaused` keeps it paused.
- [ ] Sleep timer "End of episode": playback holds at the end of the video
      (not at the credits), and autoplay does not start the next episode.
      **Fails** (AFTCR001, build 2026102818, 2026-10-28), and so does autoplay with no timer: on HLS/TS
      transcodes (Game of Thrones S1E1, House of the Dragon S1E2, both started
      from a resume point) playback stops a second before the end, `ended`
      never fires, and the watchdog reloads in a loop (black screen, "Stream
      loaded", errors source=watchdog). The next episode never starts.
- [ ] A 30-minute timer set near the end of episode 1 is still counting in
      episode 2 (Menu shows the minutes left). Leaving the player cancels it.
      Blocked by the end-of-video bug above.
- [ ] On a fresh install, a series with the Jellyfin user's audio language set
      (Dashboard → Users → Playback) starts in that language with no Astra
      setting changed.
- [ ] Commentary and audio-description tracks are never picked automatically.
- [ ] Second-choice language: set preferred audio to a language the file
      lacks; the second choice plays.
- [x] Pick a different audio track in one episode; another episode of the
      same series starts with the same pick, even after a force-stop
      (Cardcaptor Sakura S2E3 → S2E4, Japanese over English; AFTCR001, build
      2026102707, 2026-10-27).
- [x] The same for a subtitle pick, and turning subtitles off in a series
      keeps them off (Fallout S2E2 German → S2E3 German after a force-stop,
      though the track is named differently; Off in S2E3 → S2E4 Off, even
      over a default-flagged forced English track; AFTCR001, build 2026102818, 2026-10-28).
- [x] Menu shows the Sleep timer column between Subtitles and Diagnostics, and
      all four columns fit (AFTCR001, build 2026102707, 2026-10-27).

## 7. Support (P3)

- [x] Settings → About: the Ko-fi QR code scans and opens
      ko-fi.com/astrafiretv. It is the same size as the source code next to it
      (decoded from a screenshot; AFTCR001, build 2026102708, 2026-10-27).
- [x] What's New (after installing a new build): the five 1.6.0 bullets and
      the language lines fit on the card. Checked in English and French, the
      longest language, with a Ko-fi code that has since been removed, so
      there is more room now (AFTCR001, throwaway builds 2026102709 and
      2026102710, 2026-10-27).
- [x] The support card shows on Home after the counted video, with a
      scannable code. OK closes it, and it stays gone after a restart
      (AFTCR001, throwaway build 2026102708 with the threshold set to 1,
      2026-10-27).
- [ ] With the real threshold: the 25th video brings the card up on Home.
- [ ] The card never covers a video, What's New or the server notice.
- [ ] Scan each code with a real phone camera, not only from a screenshot.

## 8. Quick play and music Stop (P4)

- [x] In a movie library, Play/Pause on a focused movie starts it without
      the details page (24 Hour Party People; AFTCR001, build 2026102712,
      2026-10-27).
- [x] The same on a movie with a resume point starts at that point
      (3000 Miles to Graceland (AFTCR001, build 2026102818, 2026-10-28)).
- [x] In a shows library, Play/Pause on a series with a part-watched episode
      resumes that episode (Cardcaptor Sakura, at about 17%; AFTCR001, build
      2026102712, 2026-10-27).
- [x] A series with only finished episodes starts its Next Up episode, and a
      series nobody has started starts episode 1 (House of the Dragon S1E2;
      Game of Thrones S1E1 (AFTCR001, build 2026102818, 2026-10-28)).
- [x] Play/Pause on a collection or folder card opens it, as Select does
      (47 Ronin Collection (AFTCR001, build 2026102818, 2026-10-28)).
- [x] With music playing, Play/Pause in a library pauses the music and
      starts nothing; a second press resumes it (AFTCR001, build 2026102716,
      2026-10-28).
- [x] Now Playing → Stop: the music stops, the screen closes and the Now
      Playing bar is gone (AFTCR001, build 2026102715, 2026-10-28).
- [x] Now Playing's buttons are a column, so Up and Down reach Stop and Back
      without Left or Right skipping the track (AFTCR001, build 2026102715,
      2026-10-28).
- [x] Music plays on a Jellyfin 12.0 server with legacy authorization off
      (The Beatles, Revolver; AFTCR001, build 2026102714, 2026-10-27).

## 9. Ask if still watching (P5)

- [x] Settings → Playback shows "Ask if still watching" (After 3 episodes)
      only while Next episode autoplay is on, and Never saves (AFTCR001,
      build 2026102717, 2026-10-28).
- [ ] With "After 5 episodes", five episodes play in a row before
      "Continue watching?". Blocked by the end-of-video bug in section 6.
- [ ] With Never, a long run of episodes never stops to ask. Blocked by the
      same bug.

## 10. Memory and long play

- [ ] Two hours of 4K HDR playback with no crash (1 GB RAM on every stick).
- [x] Leave Astra for another app for 10 minutes mid-video, then come back:
      Astra resumes, or returns to the details page, without crashing. No
      crash report and the position was saved, but Astra came back on Home:
      the OS had closed it in the background and it started fresh
      (AFTCR001, build 2026102818, 2026-10-28).
