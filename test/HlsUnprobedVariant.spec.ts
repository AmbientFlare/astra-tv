import {
  describeUnprobedVariants as describeWithCap,
  UNPROBED_SOURCE_ATTRIBUTES,
  UNPROBED_SOURCE_MAX_BANDWIDTH,
} from '../src/w3cmedia/hlsUnprobedVariant';

const describeUnprobedVariants = (
  playlist: string,
  attributes: Readonly<Record<string, string>>,
) => describeWithCap(playlist, attributes, UNPROBED_SOURCE_MAX_BANDWIDTH);

describe('describeUnprobedVariants', () => {
  it('describes a variant that has no codecs', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=19808000,AVERAGE-BANDWIDTH=19808000',
      'live.m3u8?MediaSourceId=live-1',
      '',
    ].join('\n');

    expect(describeUnprobedVariants(master, UNPROBED_SOURCE_ATTRIBUTES)).toBe(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=19808000,AVERAGE-BANDWIDTH=19808000,' +
          'CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30',
        'live.m3u8?MediaSourceId=live-1',
        '',
      ].join('\n'),
    );
  });

  it('caps the bitrate the app asked for, which the device turns down', () => {
    const master =
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=79808000,AVERAGE-BANDWIDTH=79808000\n';

    expect(describeUnprobedVariants(master, {})).toBe(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=20000000,AVERAGE-BANDWIDTH=20000000\n',
    );
  });

  it('keeps a bitrate already under the cap', () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\n';

    expect(describeUnprobedVariants(master, {})).toBe(master);
  });

  it('keeps details the variant already has', () => {
    const master =
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\n';

    expect(describeUnprobedVariants(master, UNPROBED_SOURCE_ATTRIBUTES)).toBe(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360,' +
        'CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=30\n',
    );
  });

  it('keeps a CRLF line ending after the added attributes', () => {
    const master = '#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=1\r\nlive.m3u8\r\n';

    expect(describeUnprobedVariants(master, {CODECS: '"avc1.640028"'})).toBe(
      '#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.640028"\r\n' +
        'live.m3u8\r\n',
    );
  });

  it('leaves a playlist alone when every variant names its codecs', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64001F,mp4a.40.2"',
      'live.m3u8',
    ].join('\n');

    expect(
      describeUnprobedVariants(master, UNPROBED_SOURCE_ATTRIBUTES),
    ).toBeNull();
  });

  it('leaves a media playlist alone', () => {
    const media = '#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nhls/0.ts\n';

    expect(
      describeUnprobedVariants(media, UNPROBED_SOURCE_ATTRIBUTES),
    ).toBeNull();
  });
});
