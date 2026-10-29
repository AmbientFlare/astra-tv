import type {ServerProfile} from '../../services/storage';

export type SettingsRoute =
  | {route: 'preferences'}
  | {route: 'login'}
  | {route: 'customization'}
  | {route: 'playback'}
  | {route: 'telemetry'}
  | {route: 'about'}
  | {route: 'language'}
  | {route: 'autoSignIn'}
  | {route: 'accountSort'}
  | {route: 'manageServers'}
  | {route: 'serverDetail'; serverUrl: string; serverName: string}
  | {route: 'accountDetail'; profile: ServerProfile}
  | {route: 'homeSections'}
  | {route: 'displayPreferences'}
  | {route: 'maxBitrate'}
  | {route: 'connectionTest'}
  | {route: 'liveConnection'}
  | {route: 'syncPlay'}
  | {route: 'hlsSegmentLength'}
  | {route: 'audioChannels'}
  | {route: 'serverTranscoding'}
  | {route: 'audioLanguage'}
  | {route: 'subtitleLanguage'}
  | {route: 'fallbackLanguage'}
  | {route: 'subtitleMode'}
  | {route: 'subtitleAppearance'}
  | {route: 'autoplay'}
  | {route: 'autoplayCountdown'}
  | {route: 'stillWatching'}
  | {route: 'seekDuration'}
  | {route: 'skipIntro'};
