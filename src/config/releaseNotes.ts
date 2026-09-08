import {APP_VERSION} from './app';

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
];

/**
 * Identity of the What's New notice, stored as
 * `AppStateConfig.acknowledgedNoticeId`. It is derived from the version, so
 * every release shows its notice exactly once and re-installing the same
 * version does not ask again. Append BUILD_NUMBER here instead if a notice
 * per build is ever wanted.
 */
export const CURRENT_NOTICE_ID = `whats-new-${APP_VERSION}`;
