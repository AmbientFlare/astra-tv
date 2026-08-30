import {
  selectSubtitleStreamIndex,
  subtitleChangeRequiresReload,
} from '../src/services/jellyfin';

const tracks = [
  {index: 2, language: 'spa'},
  {index: 3, language: 'eng'},
  {index: 4, isForced: true, language: 'deu'},
];

describe('PlaybackInfo subtitle selection', () => {
  it("honors Jellyfin's default subtitle stream in Default mode", () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'default',
        preferredLanguage: 'English',
        serverDefaultSubtitleStreamIndex: 2,
      }),
    ).toBe(2);
  });

  it("uses the preferred subtitle language before Jellyfin's default", () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'English',
        serverDefaultSubtitleStreamIndex: 2,
      }),
    ).toBe(3);
  });

  it('falls back from a missing preferred language to the server default, then the first track', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'French',
        serverDefaultSubtitleStreamIndex: 2,
      }),
    ).toBe(2);
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'French',
      }),
    ).toBe(2);
  });

  it('turns subtitles off in Always Off mode', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOff',
        preferredLanguage: 'English',
        serverDefaultSubtitleStreamIndex: 3,
      }),
    ).toBeUndefined();
  });

  it('selects the first forced subtitle or none in Only Forced mode', () => {
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
      }),
    ).toBeUndefined();
  });

  it('selects none when there are no tracks', () => {
    expect(
      selectSubtitleStreamIndex([], {
        mode: 'alwaysOn',
        preferredLanguage: 'English',
      }),
    ).toBeUndefined();
  });

  it('preserves explicit manual Off over automatic policy', () => {
    expect(
      selectSubtitleStreamIndex(tracks, {
        mode: 'alwaysOn',
        preferredLanguage: 'English',
        manualSelection: {},
      }),
    ).toBeUndefined();
  });

  it('reloads video only when a burned-in subtitle is entered or removed', () => {
    const textTrack = {burnInRequired: false};
    const burnInTrack = {burnInRequired: true};

    expect(subtitleChangeRequiresReload(undefined, textTrack)).toBe(false);
    expect(subtitleChangeRequiresReload(textTrack, null)).toBe(false);
    expect(subtitleChangeRequiresReload(textTrack, textTrack)).toBe(false);
    expect(subtitleChangeRequiresReload(textTrack, burnInTrack)).toBe(true);
    expect(subtitleChangeRequiresReload(burnInTrack, textTrack)).toBe(true);
    expect(subtitleChangeRequiresReload(burnInTrack, null)).toBe(true);
  });
});
