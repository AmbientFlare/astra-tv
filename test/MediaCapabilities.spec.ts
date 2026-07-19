import {probeAudioOutputCapabilities} from '../src/services/mediaCapabilities';

describe('runtime audio capabilities', () => {
  it('uses codec-specific AC3/EAC3 probes and keeps DTS unverified', async () => {
    const decodingInfo = jest.fn(async (configuration: any) => ({
      supported:
        configuration.audio.contentType.includes('ac-3') ||
        configuration.audio.contentType.includes('ec-3') ||
        configuration.audio.contentType.includes('mp4a.6B') ||
        configuration.audio.contentType.includes('opus') ||
        configuration.audio.contentType.includes('dtsh'),
    }));
    const isTypeSupported = jest.fn(() => true);

    const result = await probeAudioOutputCapabilities({
      decodingInfo: decodingInfo as any,
      isTypeSupported,
    });

    expect(result).toEqual({
      ac3: true,
      eac3: true,
      mp3: true,
      opus: true,
      dtsProbeSupported: true,
      dtsDirectPlayVerified: false,
      preferredTranscodeCodec: 'ac3',
      probeSucceeded: true,
    });
    expect(decodingInfo).toHaveBeenCalledTimes(5);
    expect(isTypeSupported).toHaveBeenCalledWith('audio/mp4; codecs="ac-3"');
    expect(isTypeSupported).toHaveBeenCalledWith('audio/mp4; codecs="ec-3"');
    expect(isTypeSupported).toHaveBeenCalledWith('audio/mp4; codecs="mp4a.6B"');
    expect(isTypeSupported).toHaveBeenCalledWith('audio/mp4; codecs="opus"');
  });

  it('selects EAC3 when AC3 is not supported', async () => {
    const result = await probeAudioOutputCapabilities({
      decodingInfo: jest.fn(async (configuration: any) => ({
        supported: configuration.audio.contentType.includes('ec-3'),
      })) as any,
      isTypeSupported: jest.fn(() => true),
    });

    expect(result.ac3).toBe(false);
    expect(result.eac3).toBe(true);
    expect(result.preferredTranscodeCodec).toBe('eac3');
  });

  it('falls back to AAC if the platform probe is unavailable', async () => {
    const result = await probeAudioOutputCapabilities({
      decodingInfo: jest.fn() as any,
      isTypeSupported: jest.fn(() => {
        throw new Error('native service unavailable');
      }),
    });

    expect(result.preferredTranscodeCodec).toBe('aac');
    expect(result.probeSucceeded).toBe(false);
  });
});
