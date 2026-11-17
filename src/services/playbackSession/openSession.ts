import type {PlaybackReportInput} from '../jellyfin/types';
import {getItem, removeItem, setItem} from '../storageAdapter';

/**
 * A note of the playback session that is open on the server, kept on disk.
 *
 * The server keeps a session's transcode until the client reports that it
 * stopped. An app that is ended mid-film never sends that report, and a
 * server that has already finished transcoding the title then keeps the
 * whole file: about 10 GB a film, until its daily clean-up. The note lets
 * the next launch send the stop report the last one could not.
 *
 * It holds no token. The report is sent with the signed-in profile's.
 */

const STORAGE_KEY = 'astra.openPlaybackSession.v1';

export interface OpenSession {
  itemId: string;
  mediaSourceId?: string;
  playSessionId: string;
  positionTicks?: number;
  serverUrl: string;
  userId: string;
}

type Owner = Pick<OpenSession, 'serverUrl' | 'userId'>;

/** The session this run of the app opened, if it is still open. */
let current: string | null = null;
let writes: Promise<void> = Promise.resolve();

const queue = (write: () => Promise<void>) => {
  // Storage failing must never reach playback; the cost is one leftover
  // transcode, which is where things stood before this note existed.
  writes = writes.then(write).catch(() => undefined);
  return writes;
};

/** Records a session as open, or updates the position it has reached. */
export const noteSessionOpen = (
  owner: Owner,
  report: PlaybackReportInput,
): Promise<void> => {
  const {playSessionId} = report;
  if (!playSessionId) {
    return Promise.resolve();
  }
  current = playSessionId;
  const note: OpenSession = {
    itemId: report.itemId,
    mediaSourceId: report.mediaSourceId,
    playSessionId,
    positionTicks: report.positionTicks,
    serverUrl: owner.serverUrl,
    userId: owner.userId,
  };
  return queue(() => setItem(STORAGE_KEY, JSON.stringify(note)));
};

/** Call once the server has been told the session stopped. */
export const noteSessionClosed = (playSessionId?: string): Promise<void> => {
  if (!playSessionId || current !== playSessionId) {
    return Promise.resolve();
  }
  current = null;
  return queue(() => removeItem(STORAGE_KEY));
};

const parse = (raw: string | null): OpenSession | null => {
  if (!raw) {
    return null;
  }
  try {
    const note = JSON.parse(raw) as Partial<OpenSession>;
    return typeof note.itemId === 'string' &&
      typeof note.playSessionId === 'string' &&
      typeof note.serverUrl === 'string' &&
      typeof note.userId === 'string'
      ? (note as OpenSession)
      : null;
  } catch {
    return null;
  }
};

/**
 * Reports the stop of a session a previous run of the app left open.
 *
 * `sendStop` rejecting keeps the note, so an unreachable server is tried
 * again at the next launch. A note for another server or user is left for
 * when that profile is the one signed in.
 */
export const closeLeftoverSession = async (
  owner: Owner,
  sendStop: (report: PlaybackReportInput) => Promise<void>,
): Promise<boolean> => {
  await writes;
  const note = parse(await getItem(STORAGE_KEY).catch(() => null));
  if (
    !note ||
    note.playSessionId === current ||
    note.serverUrl !== owner.serverUrl ||
    note.userId !== owner.userId
  ) {
    return false;
  }
  await sendStop({
    itemId: note.itemId,
    mediaSourceId: note.mediaSourceId,
    playSessionId: note.playSessionId,
    positionTicks: note.positionTicks,
  });
  // A session may have started while that was in flight; its note stays.
  if (current === null) {
    await queue(() => removeItem(STORAGE_KEY));
  }
  return true;
};

export const resetOpenSessionForTests = () => {
  current = null;
  writes = Promise.resolve();
};
