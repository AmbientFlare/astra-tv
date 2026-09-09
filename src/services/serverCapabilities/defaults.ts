import {ServerCapabilities, VideoTranscodeCapability} from './types';

/**
 * What a server is assumed to be before anyone has said otherwise.
 *
 * `unknown` rather than `hardware`: the optimistic default is what shipped in
 * build 20260908.04 and it cost a NAS user three watchdog deaths and no
 * playback at all. `unknown` still attempts the re-encode once -- the fallback
 * needs a forced session to learn from -- but it is honest about not knowing,
 * and after one failure the answer is written down instead of rediscovered.
 */
export const defaultServerCapabilities: ServerCapabilities = {
  videoTranscode: 'unknown',
  videoTranscodeSource: 'default',
  maxAudioChannels: 6,
  maxAudioChannelsSource: 'default',
  lastTranscodeProbeAtMs: 0,
  interviewCompleted: false,
  pendingCapabilityNotice: false,
  updatedAtMs: 0,
};

/**
 * How long a suppressed server goes unquestioned before Astra tries it again.
 *
 * Both suppressed states are guesses that can go stale in the same direction:
 * someone picks "processor only" without knowing the box has a GPU, or a GPU
 * that genuinely failed comes back when its container is fixed. Neither is
 * discoverable without asking, so ask -- rarely. A week means the cost of a
 * wrong answer is one slow start every seven days, and the cost is only paid
 * at all by someone playing a heavy title on a server that really cannot do
 * it. A probe that succeeds costs nothing; it just works.
 */
export const TRANSCODE_PROBE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * States in which Astra would not normally ask a server to re-encode.
 *
 * `cpu` is here because the answer has to mean something -- the wizard tells
 * people 4K HDR "may stutter or fail to start" on a CPU-only server, and it
 * would be dishonest to then ask that server to do it on every heavy title.
 * It is only safe to honour because of the probe below: a wrong guess costs a
 * week, not forever.
 */
export const suppressesForcedTranscode = (
  capability: VideoTranscodeCapability,
) => capability === 'unable' || capability === 'cpu';

/**
 * Whether this playback should ask anyway, to find out if the answer still
 * holds. True for a never-probed server, which is what makes a first playback
 * informative even when the stated answer says not to bother.
 */
export const shouldProbeTranscode = (
  capability: VideoTranscodeCapability,
  lastTranscodeProbeAtMs: number,
  nowMs: number,
) =>
  suppressesForcedTranscode(capability) &&
  nowMs - lastTranscodeProbeAtMs >= TRANSCODE_PROBE_INTERVAL_MS;

/**
 * Whether to ask this server for a re-encode of a heavy title.
 *
 * Everything not suppressed is asked normally; a suppressed server is asked
 * only when its answer has gone stale enough to be worth re-testing.
 */
export const shouldAttemptServerTranscode = (
  capability: VideoTranscodeCapability,
  lastTranscodeProbeAtMs = 0,
  nowMs = Date.now(),
) =>
  !suppressesForcedTranscode(capability) ||
  shouldProbeTranscode(capability, lastTranscodeProbeAtMs, nowMs);

/**
 * Whether to warn the viewer that a heavy title may not play smoothly.
 *
 * Both remaining cases have earned it: a server that cannot re-encode will
 * deliver the source untouched, and one that has not been asked yet may be
 * about to spend twelve seconds finding out.
 */
export const shouldWarnForCapability = (capability: VideoTranscodeCapability) =>
  capability === 'unable';

/**
 * Detection contradicts a stated answer only when the user claimed capability
 * the server does not have. Someone who said `cpu` or `unknown` and turned out
 * to be right needs no interruption; someone who said `hardware` has a GPU
 * that is not doing its job, and would rather be told.
 */
export const capabilityNoticeWarranted = (
  stated: VideoTranscodeCapability,
  statedSource: 'default' | 'stated' | 'detected',
) => statedSource === 'stated' && stated === 'hardware';
