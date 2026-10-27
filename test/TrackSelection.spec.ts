import {
  isSecondaryTrack,
  selectAudioStreamIndex,
  selectSubtitleStreamIndex,
} from '../src/services/jellyfin';

const audio = [
  {type: 'Audio', index: 1, language: 'eng', channels: 6, isDefault: true},
  {
    type: 'Audio',
    index: 2,
    language: 'eng',
    channels: 2,
    title: 'Director Commentary',
  },
  {type: 'Audio', index: 3, language: 'fre', channels: 6},
  {
    type: 'Audio',
    index: 4,
    language: 'eng',
    channels: 2,
    displayTitle: 'English AD - AAC - Stereo',
  },
  {type: 'Audio', index: 5, language: 'jpn', channels: 2},
];

describe('secondary tracks', () => {
  it('spots commentary and audio description by title', () => {
    expect(isSecondaryTrack({title: 'Commentary with the cast'})).toBe(true);
    expect(isSecondaryTrack({displayTitle: 'Audio Description'})).toBe(true);
    expect(isSecondaryTrack({displayTitle: 'English AD - AAC'})).toBe(true);
    expect(isSecondaryTrack({displayTitle: 'English - AC3 - 5.1'})).toBe(false);
    expect(isSecondaryTrack({displayTitle: 'Headroom - AAC'})).toBe(false);
  });
});

describe('audio track selection', () => {
  const base = {maxChannels: 6, preferredLanguage: 'server'};

  it("follows the server's default when set to the Jellyfin account", () => {
    expect(
      selectAudioStreamIndex(audio, {...base, serverDefaultIndex: 3}),
    ).toBe(3);
  });

  it('never lands on a commentary track the server marked as default', () => {
    expect(
      selectAudioStreamIndex(audio, {...base, serverDefaultIndex: 2}),
    ).toBe(1);
  });

  it('prefers the chosen language over the server default', () => {
    expect(
      selectAudioStreamIndex(audio, {
        ...base,
        preferredLanguage: 'fr',
        serverDefaultIndex: 1,
      }),
    ).toBe(3);
  });

  it('uses the second-choice language when the first is missing', () => {
    expect(
      selectAudioStreamIndex(audio, {
        ...base,
        fallbackLanguage: 'ja',
        preferredLanguage: 'de',
        serverDefaultIndex: 1,
      }),
    ).toBe(5);
  });

  it('carries a series pick, even a commentary one, to the next episode', () => {
    expect(
      selectAudioStreamIndex(audio, {
        ...base,
        preferredLanguage: 'en',
        seriesPick: {channels: 6, language: 'fre'},
      }),
    ).toBe(3);
    expect(
      selectAudioStreamIndex(audio, {
        ...base,
        preferredLanguage: 'en',
        seriesPick: {channels: 2, language: 'eng', secondary: true},
      }),
    ).toBe(2);
  });

  it('ignores a series pick the episode cannot match', () => {
    expect(
      selectAudioStreamIndex(audio, {
        ...base,
        preferredLanguage: 'en',
        seriesPick: {language: 'ger'},
      }),
    ).toBe(1);
  });
});

describe('subtitle track selection', () => {
  const tracks = [
    {index: 6, language: 'eng', title: 'Commentary'},
    {index: 7, language: 'eng'},
    {index: 8, language: 'spa'},
    {index: 9, language: 'spa', isForced: true},
  ];

  it('matches two-letter codes from Settings against the file language', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'en',
      }),
    ).toBe(7);
  });

  it('uses the second-choice language with All subtitles on', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        fallbackLanguage: 'es',
        mode: 'alwaysOn',
        preferredLanguage: 'de',
      }),
    ).toBe(8);
  });

  it('keeps subtitles off for a series the viewer turned them off in', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'en',
        seriesPick: {off: true},
      }),
    ).toBeUndefined();
  });

  it('carries a series pick of a forced track', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'default',
        preferredLanguage: 'en',
        seriesPick: {forced: true, language: 'spa'},
      }),
    ).toBe(9);
  });
});
