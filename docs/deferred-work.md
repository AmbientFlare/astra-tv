# Deferred Work

Running list of known-good ideas that were deliberately left out of scope, with
enough context to pick them up cold. Add to this rather than burying TODOs in
code.

---

## Rebalance the video buffer toward the playhead

**Deferred from:** the issue #9 HLS segment-duration candidate; issue #12
raises its priority if new diagnostics prove requests are genuinely late.

**What exists now.** Astra uses Shaka's 10-second `bufferingGoal`, two-second
`rebufferingGoal`, and default 30-second `bufferBehind`. That nominally retains
a 40-second media window: 10 seconds ahead of playback and 30 seconds behind.

**Experiment.** Test a 20-second `bufferingGoal`, 20-second `bufferBehind`, and
four-second `rebufferingGoal` as a separate hardware candidate. The nominal
media-time window remains 40 seconds, so at a constant bitrate its compressed
media budget should be similar while providing ten additional seconds of
protection against a temporary network interruption. Raising the rebuffering
threshold should also reduce repeated play/stall loops after a genuine outage.

**Why this remains a separate experiment.** Whole-segment buffering, separate
audio/video queues, MSE eviction timing, and container overhead mean equal
media-time windows do not guarantee byte-for-byte equal memory use. Changing
buffering alongside the segment-duration work would also make issue #9 results
ambiguous.

Build `20260822.1` isolated Amazon's recommended MPEG-TS sequence mode and was
rejected after audio accumulated an approximately 0.75–1.5-second lead during
the one-hour hardware run. Build `20260822.2` then reproduced drift with W3C
Media 2.2 while its buffer map showed one continuous ten-second future range,
ample bandwidth, and no stalls or errors. The retained transport stream also
had bounded rather than accumulating A/V timestamps. That evidence rules out
buffer starvation as the long-run drift cause, so do not use this experiment
for that symptom. Retain it only for a separately reproduced network-recovery
or genuinely late-fetch problem.

**Hardware acceptance.** Compare the current 10-ahead/30-behind configuration
with 20-ahead/20-behind using high-bitrate 4K stream copy, active transcoding,
long playback, repeated 10-second rewind, large seeks, track changes, and a
controlled 10–15 second network interruption. Watch buffered-ahead time,
dropped frames, waiting/stalled events, process memory, native MSE errors, and
recovery time. Retain 20/20 only if long-playback memory and parser stability
are no worse.

---

## Scheme recovery for stored server profiles

**Deferred from:** the 2026-07-27 removal of a server-specific HTTP-to-HTTPS
rewrite.

**What exists now.** `connect()` resolves http/https once at setup time via
`getServerUrlCandidates` (`src/services/serverUrl/index.ts`) and the URL that
actually answered is persisted as `ServerProfile.serverUrl`. Every other API
call just uses the stored value. This is the right default — no per-request
scheme probing.

**The gap.** Resolution happens _only_ at connect/setup. If a server later moves
from HTTP to HTTPS (or a reverse proxy starts redirecting), an already-saved
profile keeps the stale scheme and every request fails. The only current
recovery is deleting and re-adding the server, which is not discoverable.

This is exactly the situation the old hardcode was papering over, so it is a real
scenario, not a hypothetical.

**Why it was left out.** Fixing it properly means adding scheme-recovery to the
boot-restore path in `src/navigation/index.tsx` and deciding what happens when a
request fails mid-session — which touches every API call in
`src/services/jellyfin/index.ts`. That is a much larger change than the hardcode
removal warranted.

**Suggested approach when picked up.**

1. On boot restore (`navigation/index.tsx:194` area), probe the stored profile
   with a cheap `/System/Info/Public` call before trusting it.
2. On failure, re-run `getServerUrlCandidates(profile.serverUrl)` and retry.
3. If an alternate scheme answers, persist the corrected URL via
   `upsertServerProfile` so the fix is permanent and silent.
4. Only surface an error if every candidate fails.

Keep the probe off the hot path — it should not delay a profile that works.

**Related:** `test/ServerUrl.spec.ts` already covers candidate generation, so
this work only needs coverage for the recovery/persistence behavior.
