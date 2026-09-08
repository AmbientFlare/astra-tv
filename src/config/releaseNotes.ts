import {APP_VERSION, BUILD_NUMBER} from './app';

/**
 * What changed in this release, in the words a viewer would use rather than
 * the words the code uses. This is the single source: the About page lists it,
 * and the one-time What's New notice shows it after an update. Rewrite the
 * list on every version bump, and keep it to the handful of things somebody
 * would actually notice.
 */
export const RELEASE_HIGHLIGHTS: readonly string[] = [
  'Turning on subtitles no longer forces your server to re-encode the video. ' +
    'On a server without a graphics card that was the difference between ' +
    'smooth playback and constant buffering.',
  'Switching subtitle tracks, or turning them off, is now instant instead of ' +
    'reloading the video.',
  'Videos the server handed back in a form Astra could not play — some MKV ' +
    'and AVI files — are asked for again properly instead of failing to start.',
  'Astra now learns what your server can actually do, and stops retrying the ' +
    'things it has already proved it cannot.',
  'Each subtitle track is now marked Instant or Reloads, so on a release with ' +
    'twenty of them you can see which ones switch on without rebuilding the ' +
    'video.',
];

/**
 * Identity of the What's New notice, stored as
 * `AppStateConfig.acknowledgedNoticeId`. The build number is part of it, so
 * every build shows the notice once — that is what test builds want, since a
 * rebuilt version is a different set of changes. Drop `BUILD_NUMBER` here to
 * go back to one prompt per released version.
 */
export const CURRENT_NOTICE_ID = `whats-new-${APP_VERSION}-${BUILD_NUMBER}`;
