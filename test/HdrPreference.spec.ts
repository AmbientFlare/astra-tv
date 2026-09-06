import {probeHdrSupport} from '../src/services/mediaCapabilities/hdr';
import {preferredVideoHdrLevel} from '../src/services/mediaCapabilities/hdrPreference';

const decodingInfo = (options: {
  main10?: boolean;
  pq?: boolean;
  hlg?: boolean;
}) =>
  jest.fn(
    async ({
      video,
    }: {
      video: {contentType: string; transferFunction?: string};
    }) => {
      if (video.contentType.includes('zzzz')) {
        return {supported: false};
      }
      if (video.transferFunction === 'astra-not-a-real-transfer') {
        return {supported: false};
      }
      if (video.contentType.includes('hvc1.2.') && options.main10 === false) {
        return {supported: false};
      }
      if (video.transferFunction === 'pq' && options.pq === false) {
        return {supported: false};
      }
      if (video.transferFunction === 'hlg' && options.hlg === false) {
        return {supported: false};
      }
      return {supported: true};
    },
  );

describe('preferredVideoHdrLevel', () => {
  it('selects PQ for supported HDR10 and falls back to PQ with missing metadata', async () => {
    const support = await probeHdrSupport({decodingInfo: decodingInfo({})});

    expect(preferredVideoHdrLevel(support, 'HDR10')).toBe('PQ');
    expect(preferredVideoHdrLevel(support)).toBe('PQ');
  });

  it('returns AUTO for rejected HDR10 and inconclusive probes', async () => {
    const rejected = await probeHdrSupport({
      decodingInfo: decodingInfo({pq: false}),
    });
    expect(preferredVideoHdrLevel(rejected, 'HDR10')).toBe('AUTO');

    const inconclusive = await probeHdrSupport({
      decodingInfo: jest.fn(async () => ({supported: false})),
    });
    expect(preferredVideoHdrLevel(inconclusive, 'HDR10')).toBe('AUTO');
  });

  it('evaluates HLG independently of PQ', async () => {
    const hlgOnly = await probeHdrSupport({
      decodingInfo: decodingInfo({pq: false, hlg: true}),
    });
    expect(preferredVideoHdrLevel(hlgOnly, 'HLG')).toBe('HLG');
    expect(preferredVideoHdrLevel(hlgOnly, 'HDR10')).toBe('AUTO');

    const pqOnly = await probeHdrSupport({
      decodingInfo: decodingInfo({pq: true, hlg: false}),
    });
    expect(preferredVideoHdrLevel(pqOnly, 'HLG')).toBe('AUTO');
  });

  it('returns AUTO for SDR, Dolby Vision, and HDR10+', async () => {
    const support = await probeHdrSupport({decodingInfo: decodingInfo({})});

    expect(preferredVideoHdrLevel(support, 'SDR')).toBe('AUTO');
    expect(preferredVideoHdrLevel(support, 'DV')).toBe('AUTO');
    expect(preferredVideoHdrLevel(support, 'HDR10+')).toBe('AUTO');
  });

  it('rejects always-true and color-ignored control results', async () => {
    const alwaysTrue = await probeHdrSupport({
      decodingInfo: jest.fn(async () => ({supported: true})),
    });
    expect(alwaysTrue.alwaysTrue).toBe(true);
    expect(preferredVideoHdrLevel(alwaysTrue, 'HDR10')).toBe('AUTO');

    const colorIgnored = await probeHdrSupport({
      decodingInfo: jest.fn(async ({video}) => ({
        supported: !video.contentType.includes('zzzz'),
      })),
    });
    expect(colorIgnored.hdrFieldsIgnored).toBe(true);
    expect(colorIgnored.alwaysTrue).toBe(true);
    expect(preferredVideoHdrLevel(colorIgnored, 'HDR10')).toBe('AUTO');
  });
});
