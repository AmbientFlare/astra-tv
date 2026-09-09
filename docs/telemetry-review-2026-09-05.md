# Telemetry proposal review

Reviewed: 2026-09-05. Scope: read the supplied manifest, all client source,
insertion instructions, both storage variants, and collector source/configuration;
preserve the proposal and document findings. No telemetry implementation,
privilege change, dependency migration, collector modification, or device install
was performed. This is a proposal review, not acceptance of working telemetry.

## Useful design to retain

- Default-off, fail-closed collection: construct no transport and perform no
  collector network activity until the local gate positively enables it.
- Add an isolated optional sink to the existing trace ring. Preserve current
  playback trace vocabulary and the release console shim's import ordering.
- Diagnostics must never control or await media teardown, fail playback, or
  generate a native-console warning storm when the collector is unreachable.
- Epoch-millisecond timestamps, Jellyfin PlaySessionId correlation, actual
  playback decisions, bounded crash-tail persistence, and adaptive heartbeat
  are useful additions. Avoid per-segment log events; aggregate measurements.
- Keep storage migration separate from diagnostics. This checkout actually uses
  Kepler AsyncStorage; the alternate async-storage dependency is not installed.
- Stage work: verify the gate, integrate trace forwarding, inspect real events,
  then add richer measurements. Do not claim the complete pipeline from a
  successful collector health response alone.

## Findings to resolve before integration

1. **Gate privilege is unverified.** Installed net-manager README requires
   `com.amazon.network.privilege.restricted-net-info` for `getMacAddress()`;
   its TypeScript comment omits `network.`. The current manifest lacks the
   restricted privilege. Build/sign acceptance and real-device success must be
   established before relying on MAC gating. The supplied allowlist is empty
   and token is a placeholder. Manual activation is an alternative default-off
   mechanism, not proof of hardware identity; its public phrase is not a secret.

2. **Do not replace device identity blindly.** Current identity initialization
   retries a failed storage read instead of treating it as a new installation.
   The proposed adapter returns null on read failure and the identity replacement
   may overwrite an existing stored ID. It also ignores a false write result.
   Preserve existing IDs and distinguish unavailable storage from missing data.
   Sorting all MACs makes enumeration order irrelevant, but does not make the
   derived ID invariant when an Ethernet interface is added or removed. Existing
   persistent random installation IDs already address the shared-ID problem;
   hardware derivation is not a prerequisite for telemetry.

3. **Bootstrap/crash state has ordering defects.** Bootstrap loads and clears the
   previous crash tail; the App insertion then loads it again and reports a
   default clean exit. Pass the original result through once. Bootstrap lacks
   an in-flight/idempotence guard and can create multiple transports. Persisted
   tail clearing before acknowledged delivery loses evidence if the collector
   is offline. Periodic writes omit the session ID and can overlap. Background
   must not permanently mark a process clean after it resumes; reset activity
   state appropriately. An unclean exit is not proof of ANR specifically.

4. **Transport is not fully bounded.** An event-count cap does not cap event
   bytes or serialization time. The timeout only calls AbortController: without
   it, or if native fetch does not settle after abort, the promise chain can
   remain blocked. Repeated immediate flushes append pending promises. Stop does
   not abort an in-flight request or prevent post-await queue restoration, though
   the scheduling guard prevents a new timer after stop. Failed-batch capacity
   trimming does not increment dropped counts. Permanent oversized events can
   repeatedly fail. Add coalescing, byte limits, lifecycle guards, and tests.

5. **Heartbeat conclusions overstate the measurements.** The supplied `starve`
   classification falls back to `server` even when bandwidth/frame data are
   absent, and never uses the proposed segment latency fields. Device verdict
   does not require a healthy buffer. These are hypotheses, not diagnoses; use
   unknown when evidence is insufficient. Validate finite values, handle frame
   counter resets, establish initial baselines, and guard stop/start lifecycle.
   The insertion sample calls playback-quality APIs again despite instructions
   to reuse existing samples. Avoid that duplicate work.

6. **Playback facts must describe the selected route.** The insertion derives
   playMethod from support flags, which need not match the requested delivery
   route. Current Jellyfin code already calculates selected `playMethod` and
   URL-derived `transcodeReasons`; preserve the distinction between source,
   requested delivery, and observed output. Verify any additional server fields
   against actual responses. `emitVariants` is provided but not wired by the
   insertions; a post-load playable-track list alone cannot explain all rejected
   variants or load-time filtering failures. The App example also passes
   `storageBackend`, absent from its supplied function's TypeScript interface.

7. **Redaction is not end-to-end.** The proposal only scrubs `api_key` in selected
   URL fields, while forwarding arbitrary traces, captured console messages,
   headers, and bodies. Such logs cannot be assumed safe to share. Keep actual
   tokens and private operator settings out of tracked/public source and docs.
   A hardware gate does not authenticate a collector or encrypt LAN traffic.

8. **Collector limits are weaker than advertised.** Rotation triggers pruning;
   an old low-volume active file can remain beyond 14 days. Tail reads limit
   line count but not bytes, and can read a large file with very large lines.
   Ingest silently truncates overlarge batches while the client checks only
   response.ok. Missing token configuration opens authentication. Compression
   and fsync occur inside the write lock. These observations concern supplied
   source; no running-service reconfiguration was authorized or performed.

9. **Avoid unsupported platform/recovery claims.** A package search finding no
   CPU/RAM/temperature API does not establish all platform capabilities, nor
   prove that every playback route is hardware decoded. The handoff's statement
   that retries never surface an error is not accurate for current PlayerScreen,
   which has terminal failure text and Retry. The reported HTTP 500 incident was
   resolved by the user restarting the Jellyfin container. It is not evidence
   that telemetry or another decoder rewrite is needed to fix that incident.

## Verification and next implementation gates

Read-only checks confirmed current identity/storage behavior, installed native
API privilege documentation, current route metadata and Retry UI, and an active
local collector with a successful health response. No live viewing logs or
secret files were read, and no synthetic ingest requests were sent.

Before a future implementation is considered complete, test zero collector
requests while unarmed; repeated/concurrent bootstrap; identity preservation on
storage failures; bounded offline/slow collector behavior; redaction and payload
caps; crash/relaunch/background/resume accounting; session correlation across
recovery/handoff; and actual-device gate and real-event delivery. Playback must
remain unaffected. No new build or tests were run for this documentation review.

## Preservation and cleanup

The original proposal is retained as a local-only compressed reference under
`docs/local-reference/`, excluded using `.git/info/exclude`. It includes all
human-authored handoff files, not generated Python bytecode. Operator notes and
archive checksum are alongside it. The original standalone handoff directory
is moved to desktop Trash only after archive/content verification; it remains
recoverable until Trash is emptied. No deployed collector or viewing logs are
part of that cleanup.
