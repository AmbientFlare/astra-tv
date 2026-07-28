# Deferred Work

Running list of known-good ideas that were deliberately left out of scope, with
enough context to pick them up cold. Add to this rather than burying TODOs in
code.

---

## Scheme recovery for stored server profiles

**Deferred from:** the 2026-07-27 removal of the hardcoded
`jelly2.ambientflare.art` http→https rewrite.

**What exists now.** `connect()` resolves http/https once at setup time via
`getServerUrlCandidates` (`src/services/serverUrl/index.ts`) and the URL that
actually answered is persisted as `ServerProfile.serverUrl`. Every other API
call just uses the stored value. This is the right default — no per-request
scheme probing.

**The gap.** Resolution happens *only* at connect/setup. If a server later moves
from HTTP to HTTPS (or a reverse proxy starts redirecting), an already-saved
profile keeps the stale scheme and every request fails. The user's only recourse
is deleting and re-adding the server, which is not discoverable.

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
