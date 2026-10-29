/** The choice lists and value labels the settings pages show. */
import type {
  ServerCapabilities,
  VideoTranscodeCapability,
} from '../../services/serverCapabilities';
import type {
  PlaybackPreferences,
  StillWatchingAfter,
  UserPreferences,
} from '../../services/storage';
import {t, tn} from '../../i18n';

export const bitrateOptions = (): Array<{
  label: string;
  value: PlaybackPreferences['maxBitrateBps'];
}> => [
  // The low caps are for servers that struggle to re-encode 4K -- a Dolby
  // Vision Profile 5 title has to be re-encoded for this device (issue #26).
  // A lower cap makes the server downscale, which is far lighter work.
  {label: '4 Mbps', value: 4000000},
  {label: '8 Mbps', value: 8000000},
  {label: '12 Mbps', value: 12000000},
  {label: '20 Mbps', value: 20000000},
  {label: '40 Mbps', value: 40000000},
  {label: '80 Mbps', value: 80000000},
  {label: '120 Mbps', value: 120000000},
  {label: t('settings.unlimited'), value: 200000000},
];

export const videoTranscodeOptions = (): Array<{
  label: string;
  value: VideoTranscodeCapability;
}> => [
  {label: t('capabilities.hardwareLabel'), value: 'hardware'},
  {label: t('capabilities.cpuLabel'), value: 'cpu'},
  {label: t('capabilities.unknownLabel'), value: 'unknown'},
];

/** Where the current answer came from, said plainly under the question. */
export const capabilitySourceNote = (capabilities: ServerCapabilities) => {
  if (capabilities.videoTranscode === 'unable') {
    return t('settings.capabilityUnable');
  }
  if (capabilities.videoTranscodeSource === 'detected') {
    return t('settings.capabilityDetected');
  }
  if (capabilities.videoTranscode === 'cpu') {
    return t('settings.capabilityCpu');
  }
  if (capabilities.videoTranscodeSource === 'stated') {
    return t('settings.capabilityStated');
  }
  return t('settings.capabilityDefault');
};

export const audioChannelOptions = (): Array<{
  label: string;
  value: PlaybackPreferences['maxAudioChannels'];
}> => [
  {label: t('settings.stereo20'), value: 2},
  {label: t('settings.surround51'), value: 6},
  {label: t('settings.surround71'), value: 8},
];

export const hlsSegmentLengthOptions = (): Array<{
  label: string;
  value: PlaybackPreferences['hlsSegmentLengthSeconds'];
}> => [
  {label: t('settings.autoRecommended'), value: 0},
  ...([4, 3, 2] as const).map((value) => ({
    label: tn('settings.secondsCount', value),
    value,
  })),
];

// Content languages for audio and subtitle tracks, named in the app's language.
export const languageOptions = (): Array<{label: string; value: string}> => [
  {label: t('settings.langEnglish'), value: 'en'},
  {label: t('settings.langSpanish'), value: 'es'},
  {label: t('settings.langFrench'), value: 'fr'},
  {label: t('settings.langGerman'), value: 'de'},
  {label: t('settings.langJapanese'), value: 'ja'},
  {label: t('settings.langPortuguese'), value: 'pt'},
  {label: t('settings.langItalian'), value: 'it'},
  {label: t('settings.langKorean'), value: 'ko'},
];

export const audioLanguageOptions = (): Array<{
  label: string;
  value: string;
}> => [
  {label: t('settings.audioFromAccount'), value: 'server'},
  ...languageOptions(),
];

export const fallbackLanguageOptions = (): Array<{
  label: string;
  value: string;
}> => [{label: t('settings.fallbackNone'), value: ''}, ...languageOptions()];

export const subtitleAppearanceOptions = (): Array<{
  label: string;
  value: UserPreferences['subtitleAppearance'];
}> => [
  {label: t('settings.textWithShadow'), value: 'shadow'},
  {label: t('settings.darkBackground'), value: 'background'},
];

export const subtitleModeOptions = (): Array<{
  label: string;
  value: UserPreferences['subtitleMode'];
}> => [
  {label: t('settings.subtitleDefault'), value: 'default'},
  {label: t('settings.subtitlesAllOn'), value: 'alwaysOn'},
  {label: t('settings.subtitlesAllOff'), value: 'alwaysOff'},
  {label: t('settings.subtitlesForced'), value: 'forcedOnly'},
];

export const labelForSubtitleMode = (mode: UserPreferences['subtitleMode']) =>
  subtitleModeOptions().find((option) => option.value === mode)?.label ??
  t('settings.subtitleDefault');

export const labelForSkip = (mode: UserPreferences['skipIntroCredits']) =>
  ({
    ask: t('settings.skipAsk'),
    auto: t('settings.skipAuto'),
    ignore: t('settings.skipIgnore'),
  }[mode]);

export const labelForStillWatching = (episodes: StillWatchingAfter) =>
  episodes === 0
    ? t('settings.stillWatchingNever')
    : t('settings.stillWatchingAfter', {count: episodes});
