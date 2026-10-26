import {APP_VERSION, BUILD_NUMBER} from './app';

/**
 * What changed in this release, in the words a viewer would use rather than
 * the words the code uses. This is the single source: the About page lists it,
 * and the one-time What's New notice shows it after an update. Rewrite the
 * list on every version bump, and keep it to the handful of things somebody
 * would actually notice.
 */
export const RELEASE_HIGHLIGHTS: readonly string[] = [
  'Watch together with SyncPlay. Join a group started in another Jellyfin ' +
    'app, or start one from Astra and pick something to play: everyone in ' +
    'the group opens it, and play, pause and seek on any of them goes to all.',
  'If Astra is closed or restarted during a SyncPlay session, it rejoins the ' +
    'group on its own when it opens again.',
  'Accounts the server only lets join groups no longer see the option to ' +
    'start one, and accounts without SyncPlay are told so.',
];

/**
 * Identity of the What's New notice, stored as
 * `AppStateConfig.acknowledgedNoticeId`. The build number is part of it, so
 * every build shows the notice once — that is what test builds want, since a
 * rebuilt version is a different set of changes. Drop `BUILD_NUMBER` here to
 * go back to one prompt per released version.
 */
export const CURRENT_NOTICE_ID = `whats-new-${APP_VERSION}-${BUILD_NUMBER}`;
