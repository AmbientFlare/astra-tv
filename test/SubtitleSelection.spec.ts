import {selectSubtitleStreamIndex} from '../src/services/jellyfin';

const tracks = [
  {index: 2, language: 'spa'},
  {index: 3, language: 'eng'},
  {index: 4, isForced: true, language: 'deu'},
];

describe('global subtitle preference resolution', () => {
  it("follows the server's default stream in Default (per video) mode", () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'default',
        preferredLanguage: 'English',
        serverDefaultSubtitleStreamIndex: 2,
      }),
    ).toBe(2);
  });

  it('selects none in Default mode when the server chose none', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'default',
        preferredLanguage: 'English',
      }),
    ).toBeUndefined();
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'default',
        preferredLanguage: 'English',
        serverDefaultSubtitleStreamIndex: -1,
      }),
    ).toBeUndefined();
  });

  it("prefers the configured language over the server's default when all on", () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'English',
        serverDefaultSubtitleStreamIndex: 2,
      }),
    ).toBe(3);
  });

  it('matches language codes case-insensitively through the alias table', () => {
    expect(
      selectSubtitleStreamIndex([{index: 7, language: 'ENG'}], {
        mode: 'alwaysOn',
        preferredLanguage: 'english',
      }),
    ).toBe(7);
    expect(
      selectSubtitleStreamIndex([{index: 8, language: 'nl'}], {
        mode: 'alwaysOn',
        preferredLanguage: 'nl',
      }),
    ).toBe(8);
  });

  it('falls back from a missing language to the server default, then the first track', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'French',
        serverDefaultSubtitleStreamIndex: 3,
      }),
    ).toBe(3);
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'French',
      }),
    ).toBe(2);
  });

  it('selects none when all on and the item has no subtitles', () => {
    expect(
      selectSubtitleStreamIndex([], {
        mode: 'alwaysOn',
        preferredLanguage: 'English',
      }),
    ).toBeUndefined();
  });

  it('turns subtitles off in All Off mode regardless of the server default', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOff',
        preferredLanguage: 'English',
        serverDefaultSubtitleStreamIndex: 3,
      }),
    ).toBeUndefined();
  });

  it('selects the first forced track or none in Only Forced mode', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'forcedOnly',
        preferredLanguage: 'English',
      }),
    ).toBe(4);
    expect(
      selectSubtitleStreamIndex(tracks.slice(0, 2), {
        mode: 'forcedOnly',
        preferredLanguage: 'English',
        serverDefaultSubtitleStreamIndex: 2,
      }),
    ).toBeUndefined();
  });

  it('keeps a manual choice, including Off, over every automatic mode', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'English',
        manualSelection: {},
      }),
    ).toBeUndefined();
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOff',
        preferredLanguage: 'English',
        manualSelection: {streamIndex: 2},
      }),
    ).toBe(2);
  });

  it('ignores tracks without a stream index', () => {
    expect(
      selectSubtitleStreamIndex(
        [{language: 'eng'}, {index: 5, language: 'eng'}],
        {
          mode: 'alwaysOn',
          preferredLanguage: 'English',
        },
      ),
    ).toBe(5);
  });
});
