import {APP_VERSION, BUILD_NUMBER} from './app';

/**
 * What changed in this release, in the words a viewer would use rather than
 * the words the code uses. This is the single source: the About page lists it,
 * and the one-time What's New notice shows it after an update. Rewrite the
 * list on every version bump, and keep it to the handful of things somebody
 * would actually notice.
 */
export const RELEASE_HIGHLIGHTS: readonly string[] = [
  'Fewer crashes, especially when leaving a video, opening a very large ' +
    'library, or coming back to Astra after using another app.',
  'Next Up shows how many episodes of the season are left, and an ' +
    "episode's page lists the rest of its season.",
  'Faster seeking: taps add up before Astra jumps, holding speeds it up, ' +
    'and scene previews show when your server has made them.',
  'Subtitles now sit on the picture with a shadow; choose a dark box ' +
    'instead under Settings → Playback.',
  'On 1080p sticks Astra asks the server to shrink 4K films so they can ' +
    'play, and lower bitrate limits are available for slow connections.',
];

/**
 * Identity of the What's New notice, stored as
 * `AppStateConfig.acknowledgedNoticeId`. The build number is part of it, so
 * every build shows the notice once — that is what test builds want, since a
 * rebuilt version is a different set of changes. Drop `BUILD_NUMBER` here to
 * go back to one prompt per released version.
 */
export const CURRENT_NOTICE_ID = `whats-new-${APP_VERSION}-${BUILD_NUMBER}`;
