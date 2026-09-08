import {
  acknowledgeCapabilityNotice,
  applyServerCapabilities,
  capabilityNoticeWarranted,
  clearServerCapabilities,
  defaultServerCapabilities,
  getServerCapabilities,
  recordTranscodeFailure,
  recordTranscodeProbe,
  recordTranscodeSuccess,
  serverCapabilityKey,
  shouldAttemptServerTranscode,
  shouldProbeTranscode,
  suppressesForcedTranscode,
  TRANSCODE_PROBE_INTERVAL_MS,
  updateServerCapabilities,
} from '../src/services/serverCapabilities';
import {AsyncStorage} from '@amazon-devices/react-native-kepler';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const store = new Map<string, string>();
  return {
    AsyncStorage: {
      __store: store,
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };
});

const store = (AsyncStorage as unknown as {__store: Map<string, string>})
  .__store;

const NAS = 'http://192.168.1.50:8096';
const GPU = 'http://192.168.1.60:8096';
/** A fixed "now" so the weekly boundary cases read as arithmetic, not timing. */
const NOW = 1_800_000_000_000;

beforeEach(() => {
  store.clear();
});

describe('serverCapabilityKey', () => {
  it('files a server under its base URL, not its profile id', () => {
    // A profile id is `<server>:<user>`; whether a box has a GPU is a fact
    // about the box, so two users on one server must share one record.
    expect(serverCapabilityKey('HTTP://Nas.local:8096/')).toBe(
      'http://nas.local:8096',
    );
  });
});

describe('per-server storage', () => {
  it('gives an unanswered server the defaults', async () => {
    expect(await getServerCapabilities(NAS)).toEqual(defaultServerCapabilities);
  });

  it('keeps two servers apart', async () => {
    await updateServerCapabilities(NAS, {
      videoTranscode: 'cpu',
      videoTranscodeSource: 'stated',
    });
    await updateServerCapabilities(GPU, {
      videoTranscode: 'hardware',
      videoTranscodeSource: 'stated',
    });

    expect((await getServerCapabilities(NAS)).videoTranscode).toBe('cpu');
    expect((await getServerCapabilities(GPU)).videoTranscode).toBe('hardware');
  });

  it('round-trips through storage', async () => {
    await updateServerCapabilities(NAS, {
      interviewCompleted: true,
      maxAudioChannels: 2,
      maxAudioChannelsSource: 'stated',
    });

    const reread = await getServerCapabilities(NAS);
    expect(reread.interviewCompleted).toBe(true);
    expect(reread.maxAudioChannels).toBe(2);
  });

  it('fills in a field a stored record predates rather than dropping it', async () => {
    store.set(
      'astra.serverCapabilities.v1',
      JSON.stringify({
        version: 1,
        servers: {[NAS]: {videoTranscode: 'cpu'}},
      }),
    );

    const stored = await getServerCapabilities(NAS);
    expect(stored.videoTranscode).toBe('cpu');
    expect(stored.interviewCompleted).toBe(false);
  });

  it('returns the defaults for unreadable storage', async () => {
    store.set('astra.serverCapabilities.v1', 'not json');
    expect(await getServerCapabilities(NAS)).toEqual(defaultServerCapabilities);
  });

  it('forgets one server without touching the other', async () => {
    await updateServerCapabilities(NAS, {videoTranscode: 'cpu'});
    await updateServerCapabilities(GPU, {videoTranscode: 'hardware'});

    await clearServerCapabilities(NAS);

    expect((await getServerCapabilities(NAS)).videoTranscode).toBe('unknown');
    expect((await getServerCapabilities(GPU)).videoTranscode).toBe('hardware');
  });
});

describe('recordTranscodeFailure', () => {
  it('writes the measured verdict over a stated one', async () => {
    await updateServerCapabilities(NAS, {
      videoTranscode: 'hardware',
      videoTranscodeSource: 'stated',
    });

    const next = await recordTranscodeFailure(NAS);

    expect(next.videoTranscode).toBe('unable');
    expect(next.videoTranscodeSource).toBe('detected');
  });

  it('raises the notice only for someone who said hardware', async () => {
    // The GPU that fell out of its container: the user was told better, so
    // they get told about it once.
    await updateServerCapabilities(GPU, {
      videoTranscode: 'hardware',
      videoTranscodeSource: 'stated',
    });
    expect((await recordTranscodeFailure(GPU)).pendingCapabilityNotice).toBe(
      true,
    );
  });

  it('stays quiet for someone who already said CPU only', async () => {
    await updateServerCapabilities(NAS, {
      videoTranscode: 'cpu',
      videoTranscodeSource: 'stated',
    });
    expect((await recordTranscodeFailure(NAS)).pendingCapabilityNotice).toBe(
      false,
    );
  });

  it("stays quiet for someone who said I don't know", async () => {
    expect((await recordTranscodeFailure(NAS)).pendingCapabilityNotice).toBe(
      false,
    );
  });

  it('clears once acknowledged', async () => {
    await updateServerCapabilities(GPU, {
      videoTranscode: 'hardware',
      videoTranscodeSource: 'stated',
    });
    await recordTranscodeFailure(GPU);

    await acknowledgeCapabilityNotice(GPU);

    expect((await getServerCapabilities(GPU)).pendingCapabilityNotice).toBe(
      false,
    );
  });
});

describe('recordTranscodeSuccess', () => {
  it('clears a stale unable so a fixed GPU is picked up on its own', async () => {
    await recordTranscodeFailure(GPU);

    await recordTranscodeSuccess(GPU, 'unable');

    expect((await getServerCapabilities(GPU)).videoTranscode).toBe('hardware');
  });

  it('corrects a stated answer the server has just disproved', async () => {
    // Someone who picked "processor only" without knowing their box has a
    // GPU: the probe re-encoded successfully, so the guess is now wrong.
    await updateServerCapabilities(GPU, {
      videoTranscode: 'cpu',
      videoTranscodeSource: 'stated',
    });

    await recordTranscodeSuccess(GPU, 'cpu');

    const stored = await getServerCapabilities(GPU);
    expect(stored.videoTranscode).toBe('hardware');
    expect(stored.videoTranscodeSource).toBe('detected');
  });

  it('settles an unanswered server without asking anyone', async () => {
    await recordTranscodeSuccess(GPU, 'unknown');

    const stored = await getServerCapabilities(GPU);
    expect(stored.videoTranscode).toBe('hardware');
    expect(stored.videoTranscodeSource).toBe('detected');
    expect(stored.pendingCapabilityNotice).toBe(false);
  });
});

describe('recordTranscodeProbe', () => {
  it('buys another interval of quiet for this server only', async () => {
    const before = Date.now();

    await recordTranscodeProbe(NAS);

    const nas = await getServerCapabilities(NAS);
    const gpu = await getServerCapabilities(GPU);
    expect(nas.lastTranscodeProbeAtMs).toBeGreaterThanOrEqual(before);
    expect(gpu.lastTranscodeProbeAtMs).toBe(0);
  });
});

describe('policy predicates', () => {
  it('suppresses forcing where the answer says not to bother', () => {
    expect(suppressesForcedTranscode('hardware')).toBe(false);
    expect(suppressesForcedTranscode('unknown')).toBe(false);
    expect(suppressesForcedTranscode('cpu')).toBe(true);
    expect(suppressesForcedTranscode('unable')).toBe(true);
  });

  it('always gives a never-probed server one try', () => {
    // A stated answer is a guess until something measures it, so a fresh
    // record probes on its first heavy title even when it said "processor
    // only".
    expect(shouldProbeTranscode('cpu', 0, NOW)).toBe(true);
    expect(shouldProbeTranscode('unable', 0, NOW)).toBe(true);
  });

  it('re-tests a suppressed server once a week, not sooner', () => {
    const sixDays = NOW - 6 * 24 * 60 * 60 * 1000;
    expect(shouldProbeTranscode('cpu', sixDays, NOW)).toBe(false);
    expect(
      shouldProbeTranscode('cpu', NOW - TRANSCODE_PROBE_INTERVAL_MS, NOW),
    ).toBe(true);
  });

  it('never probes a server it would force anyway', () => {
    expect(shouldProbeTranscode('hardware', 0, NOW)).toBe(false);
    expect(shouldProbeTranscode('unknown', 0, NOW)).toBe(false);
  });

  it('forces freely, and forces a stale suppressed answer to re-prove itself', () => {
    expect(shouldAttemptServerTranscode('hardware', 0, NOW)).toBe(true);
    expect(shouldAttemptServerTranscode('unknown', 0, NOW)).toBe(true);
    // Suppressed and recently probed: leave it alone.
    expect(shouldAttemptServerTranscode('cpu', NOW - 1000, NOW)).toBe(false);
    expect(shouldAttemptServerTranscode('unable', NOW - 1000, NOW)).toBe(false);
    // Suppressed and stale: ask once.
    expect(shouldAttemptServerTranscode('cpu', 0, NOW)).toBe(true);
    expect(shouldAttemptServerTranscode('unable', 0, NOW)).toBe(true);
  });

  it('warrants a notice only where the stated answer was better', () => {
    expect(capabilityNoticeWarranted('hardware', 'stated')).toBe(true);
    expect(capabilityNoticeWarranted('cpu', 'stated')).toBe(false);
    expect(capabilityNoticeWarranted('hardware', 'detected')).toBe(false);
    expect(capabilityNoticeWarranted('unknown', 'default')).toBe(false);
  });
});

describe('applyServerCapabilities', () => {
  it('restates the audio answer for the server being switched to', async () => {
    await updateServerCapabilities(NAS, {
      maxAudioChannels: 2,
      maxAudioChannelsSource: 'stated',
    });
    const writePrefs = jest.fn(async () => undefined);

    await applyServerCapabilities(NAS, writePrefs);

    expect(writePrefs).toHaveBeenCalledWith({maxAudioChannels: 2});
  });

  it('leaves the live settings alone for a server nobody has answered for', async () => {
    const writePrefs = jest.fn(async () => undefined);

    await applyServerCapabilities(GPU, writePrefs);

    expect(writePrefs).not.toHaveBeenCalled();
  });
});
