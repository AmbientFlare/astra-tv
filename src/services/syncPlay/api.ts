/**
 * Jellyfin's SyncPlay REST endpoints and the server clock they are timed by.
 */
import {buildUrl, getAuthHeaders, getJson} from '../jellyfin/http';

export type SyncPlayGroupState = 'Idle' | 'Waiting' | 'Paused' | 'Playing';

export interface SyncPlayGroupInfo {
  GroupId: string;
  GroupName: string;
  State: SyncPlayGroupState;
  Participants: string[];
  LastUpdatedAt: string;
}

export interface SyncPlayQueueItem {
  ItemId: string;
  PlaylistItemId: string;
}

export interface SyncPlayQueueUpdate {
  Reason: string;
  LastUpdate: string;
  Playlist: SyncPlayQueueItem[];
  PlayingItemIndex: number;
  StartPositionTicks: number;
  IsPlaying: boolean;
}

export type SyncPlayCommandType = 'Unpause' | 'Pause' | 'Seek' | 'Stop';

export interface SyncPlayCommand {
  GroupId: string;
  PlaylistItemId: string;
  When: string;
  PositionTicks: number;
  Command: SyncPlayCommandType;
  EmittedAt: string;
}

export interface SyncPlayGroupUpdate {
  GroupId: string;
  Type: string;
  Data?: unknown;
}

export interface SyncPlayReadyReport {
  When: string;
  PositionTicks: number;
  IsPlaying: boolean;
  PlaylistItemId: string;
}

/**
 * Parses a server timestamp. .NET writes seven fractional digits, which not
 * every JS engine accepts, so the fraction is cut to milliseconds first.
 */
export const parseServerDate = (value: string): number =>
  Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));

export interface SyncPlayApi {
  list(): Promise<SyncPlayGroupInfo[]>;
  join(groupId: string): Promise<void>;
  leave(): Promise<void>;
  pause(): Promise<void>;
  unpause(): Promise<void>;
  buffering(report: SyncPlayReadyReport): Promise<void>;
  ready(report: SyncPlayReadyReport): Promise<void>;
  ping(ms: number): Promise<void>;
  /** Server receive and send times for one round trip, as epoch ms. */
  utcTime(): Promise<{received: number; sent: number}>;
}

export const createSyncPlayApi = (
  serverUrl: string,
  accessToken: string,
): SyncPlayApi => {
  const call = <T>(path: string, body?: object) =>
    getJson<T>(
      buildUrl(serverUrl, path),
      body === undefined
        ? {headers: getAuthHeaders(accessToken)}
        : {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
              ...getAuthHeaders(accessToken),
              'Content-Type': 'application/json',
            },
          },
      15000,
    );
  return {
    list: async () => (await call<SyncPlayGroupInfo[]>('SyncPlay/List')) ?? [],
    join: (groupId) => call('SyncPlay/Join', {GroupId: groupId}),
    leave: () => call('SyncPlay/Leave', {}),
    pause: () => call('SyncPlay/Pause', {}),
    unpause: () => call('SyncPlay/Unpause', {}),
    buffering: (report) => call('SyncPlay/Buffering', report),
    ready: (report) => call('SyncPlay/Ready', report),
    ping: (ms) => call('SyncPlay/Ping', {Ping: Math.round(ms)}),
    utcTime: async () => {
      const reply = await call<{
        RequestReceptionTime: string;
        ResponseTransmissionTime: string;
      }>('GetUtcTime');
      return {
        received: parseServerDate(reply.RequestReceptionTime),
        sent: parseServerDate(reply.ResponseTransmissionTime),
      };
    },
  };
};
