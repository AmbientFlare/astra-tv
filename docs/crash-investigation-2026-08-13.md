# Crash and ANR investigation — 2026-08-13

## Executive assessment

The supplied telemetry contains three separate signatures. It does not support
attributing all of them to one Astra defect.

1. The repeatable crash (`ac6b7eed84ffd57b2ff503ae84b8e12c`) is a native
   Vega media-parser failure while processing an MSE `SourceBuffer` append. The
   faulting code is Amazon's `ATVNativeFragmentParser`, below Astra, Shaka, and
   the JavaScript W3C Media bridge. Astra initiates the append, but there is no
   Astra or Hermes frame at the fault.
2. The abort (`aea8ad4ce571569c33e4d6ae72e00bce`) is glibc detecting
   damaged heap metadata during a later allocation from a React Native host
   object property lookup. The allocation site is the detector, not evidence
   that `NativeObjectWrapper::get` caused the damage. With one event and no
   allocator diagnostic string, registers, or preceding memory trace, its
   original corrupting write cannot be located.
3. The four ANR rows contain only one or two unsymbolicated program counters in
   the system Hermes library. They establish only that the sampled thread was
   in Hermes. They do not identify a JavaScript function or distinguish a busy
   JS thread from a player lifecycle wait.

The leading actionable risk is that the release is still built against
`@amazon-devices/react-native-w3cmedia` 2.1.99 and
`/com.amazon.kepler.w3cmedia_2@IW3cmedia_1`. Amazon's current Vega 0.22 media
documentation recommends `~2.2.20`, and the 0.22.2 release notes describe the
new `IW3cmedia_2` implementation in W3C Media 2.2.11/2.2.21. The crash occurs
inside the old interface's native append path on two device models and two OS
builds. Moving to the current supported W3C Media interface is therefore the
first remediation to validate; it is not proof by itself that 2.1.99 contains
this exact native bug.

There is also a close published platform match: Amazon's Vega 0.21 release
notes list a known app crash after 1–2 hours of video playback caused by map
iterator race conditions. `get_total_buffered_size` is reached during each
append and is a plausible buffered-state iteration site. If the three affected
sessions had been playing for roughly that duration, the documented race
becomes the strongest root-cause candidate. Playback duration is absent from
the supplied rows, so this remains a conditional correlation rather than a
confirmed identification.

## Evidence and scope

### Native fragment-parser crash

- Descriptor: `ac6b7eed84ffd57b2ff503ae84b8e12c`
- Total: 3 events on 3 affected devices
- Astra 1.1.1 build `2026080401`: 2 events, Fire TV Stick 4K Select
  (`AFTCA002`), OS `2101020054720`
- Astra 1.1.0 build `2026072904`: 1 event, Fire TV Stick HD (2nd generation)
  (`AFTCL001`), OS `2101020054820`
- Native path:
  `SourceBufferStateImpl::get_total_buffered_size` →
  `DemuxerImpl::get_total_buffered_size` → `DemuxerImpl::append_data` →
  `SourceBuffer::append_data` → `SourceBuffer::append_async`

This predates the 1.1.1 append gate and recurred after it. The 1.1.1 change is
therefore not the original cause and did not remove the underlying failure.
Because the report omits the signal, fault address, registers, function locals,
and source around `SourceBufferState.cpp:705`, it cannot distinguish a null or
stale object, an iterator/data race, or an invalid internal buffer-size state.
The documented extended-playback map-iterator race should be checked first by
joining each event to its playback-session duration.

### Heap-corruption abort

- Descriptor: `aea8ad4ce571569c33e4d6ae72e00bce`
- Total: 1 event on one `AFTCA002` device
- Build value: `202607073` (does not match a documented Astra build number and
  should be verified in the raw event)
- Detection path: `malloc_printerr` → `_int_malloc` → `operator new` →
  `facebook::jsi::Function::createFromHostFunction` →
  `volta::react::NativeObjectWrapper::get`

This is consistent with an earlier native overwrite, double free, or use after
free being detected during an unrelated allocation. It may share a native
lifetime problem with the media crash, but the supplied data does not establish
that relationship.

### Hermes ANRs

- Four descriptors, one event and one affected device each
- All are Astra 1.1.1 build `2026080401`, `AFTCA002`, OS `2101020054720`
- Offsets: `0x77122`, `0x6fc46`, `0x9aa22`/`0x9a84f`, and `0x7f992`

Those offsets cannot be decoded with Astra's Hermes bundle source map. They are
native offsets into the OS-provided `libhermes-0.12.0.so.0.12.0`, so they need
the exact matching OS debug rootfs/symbol file. Amazon's ACR guidance likewise
requires native `gdb` symbolication and symbols from the exact crashed build.

## Astra-side risk factors

These are credible triggers or amplifiers, not conclusions proved by the
current crash rows.

1. **Old W3C Media native interface.** `package-lock.json` resolves W3C Media
   2.1.99, and its compatibility metadata selects `IW3cmedia_1`. The official
   documentation has moved to 2.2.x and `IW3cmedia_2`.
2. **Published extended-playback race.** Vega's release notes document crashes
   after 1–2 hours from map iterator races. The failing buffered-size routine
   is consistent with that class of failure, pending duration confirmation.
3. **Teardown is delayed by network telemetry.** Player unmount and surface
   removal call `reportStopped()` and do not begin `ShakaPlayer.unload()` until
   that request settles. During that delay the native player and MSE buffers
   remain alive. Teardown should stop new media work first; reporting playback
   state should not own the media object's lifetime.
4. **Backgrounding pauses but does not itself release the player.** Amazon's
   media-app requirements say VOD media resources must be released when the app
   is pushed to the background. Astra currently relies on later surface
   destruction/unmount cleanup.
5. **Seeks are not serialized end to end.** Each seek waits for append work,
   but rapid remote events can start several asynchronous seeks that resume
   together. Amazon documents a Vega known issue where repeated forward seeks
   without waiting for each response can deadlock and produce an ANR.
6. **A known `sourceclose` lifecycle defect can freeze teardown.** Vega 0.22
   release notes say detaching a `MediaSource` may fail to emit `sourceclose`,
   leaving a player waiting for the event. Astra awaits Shaka `detach()` and
   `destroy()`, so this is a plausible ANR path that needs a complete ANR thread
   dump to confirm.
7. **The 1.1.1 append gate has no bounded completion timeout.** If Vega loses an
   `updateend`, `abort`, or `error` event while `updating` remains true, seeks,
   load completion, and unload can wait indefinitely.

## Recommended next investigation/remediation sequence

1. Rebuild a test candidate against the supported 2.2.x W3C Media package so
   the generated manifest selects `IW3cmedia_2`; validate install compatibility
   on both affected device models before rollout.
2. Begin Shaka cancellation/unload immediately on exit, surface destruction,
   and background transition. Send Jellyfin stopped/progress telemetry without
   holding native media teardown open.
3. Serialize seeks and coalesce repeated D-pad seeks to the latest requested
   target. Add bounded timeouts and structured logging around append,
   `updateend`, seek completion, detach, destroy, and deinitialize.
4. Reproduce with a loop covering long playback, rapid seek, track switches,
   app background/foreground, surface destruction, and exit during an append on
   both `AFTCA002` and `AFTCL001`.
5. Obtain the raw ACR/ANR artifacts: crash signal and fault address, registers,
   every thread, allocator error string, ANR reason/duration, event timestamps,
   foreground/background state, playback-session duration, `LCM_ANR_REASON`,
   and the ACR source-attribution field.
6. Symbolicate the Hermes offsets with the debug rootfs for OS
   `2101020054720`, and request Amazon symbol/source context for
   `ATVNativeFragmentParser` at `SourceBufferState.cpp:705`. App source maps
   cannot decode either native location.

## References

- [Amazon W3C Media API setup](https://developer.amazon.com/docs/vega-api/0.22/README.amazon-devices_react-native-w3cmedia.html)
- [Vega 0.21 release notes, including the extended-playback iterator race](https://developer.amazon.com/docs/vega/0.21/vega-release-notes.html)
- [Vega 0.22 release notes and media known issues](https://developer.amazon.com/docs/vega/0.22/vega-release-notes.html)
- [Amazon media-app resource lifecycle requirements](https://developer.amazon.com/docs/vega/0.21/media-player-requirements.html)
- [Amazon ACR symbolication troubleshooting](https://developer.amazon.com/docs/vega/0.22/acr-issues.html)
- [Amazon crash-source attribution guidance](https://developer.amazon.com/docs/vega/0.22/detect-crash.html)
