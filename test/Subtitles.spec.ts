import {activeWebVttText, parseWebVtt} from '../src/services/subtitles';

describe('external WebVTT subtitles', () => {
  const sample = `\uFEFFWEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:03.500 position:50%\r\n<i>Hello &amp; welcome.</i>\r\n\r\n2\r\n00:03.500 --> 00:05.000\r\nSecond line<br>continues here.\r\n`;

  it('parses Jellyfin WebVTT cues, settings, markup, and entities', () => {
    expect(parseWebVtt(sample)).toEqual([
      {
        endTime: 3.5,
        startTime: 1,
        text: 'Hello & welcome.',
      },
      {
        endTime: 5,
        startTime: 3.5,
        text: 'Second line\ncontinues here.',
      },
    ]);
  });

  it('selects only cues active at the current playback position', () => {
    const cues = parseWebVtt(sample);

    expect(activeWebVttText(cues, 0.5)).toBe('');
    expect(activeWebVttText(cues, 2)).toBe('Hello & welcome.');
    expect(activeWebVttText(cues, 4)).toBe('Second line\ncontinues here.');
    expect(activeWebVttText(cues, 5)).toBe('');
  });

  it('accepts SRT-style comma timestamps after Jellyfin conversion', () => {
    expect(parseWebVtt('00:01:02,250 --> 00:01:04,000\nCaption text')).toEqual([
      {
        endTime: 64,
        startTime: 62.25,
        text: 'Caption text',
      },
    ]);
  });
});
