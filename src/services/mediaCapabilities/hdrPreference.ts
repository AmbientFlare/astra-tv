import type {HdrSupport} from './hdr';

export type VideoHdrPreference = 'AUTO' | 'PQ' | 'HLG';

/** Soft HLS variant preference; decoder acceptance is not display validation. */
export const preferredVideoHdrLevel = (
  support: HdrSupport,
  sourceVideoRangeType?: string,
): VideoHdrPreference => {
  if (
    !support.probeSucceeded ||
    support.controlsFailed ||
    support.hdrFieldsIgnored ||
    support.alwaysTrue
  ) {
    return 'AUTO';
  }
  if (sourceVideoRangeType === 'HLG') {
    return support.results.hlgUhd.supported ? 'HLG' : 'AUTO';
  }
  if (sourceVideoRangeType && sourceVideoRangeType !== 'HDR10') {
    return 'AUTO';
  }
  // Missing source metadata still permits the HDR10 preference. Shaka 4.8.5
  // keeps the original candidates when no variant matches (including SDR).
  return support.verdict === 'hdr10-supported' ? 'PQ' : 'AUTO';
};
