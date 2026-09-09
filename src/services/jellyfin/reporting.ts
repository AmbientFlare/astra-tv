import type {PlaybackReportInput} from './types';
import {normalizeServerUrl, getJson, buildUrl, getAuthHeaders} from './http';

const reportPlayback = async (
  serverUrl: string,
  accessToken: string,
  endpoint: 'Playing' | 'Playing/Progress' | 'Playing/Stopped',
  input: PlaybackReportInput,
) => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const body =
    endpoint === 'Playing/Stopped'
      ? {
          ItemId: input.itemId,
          MediaSourceId: input.mediaSourceId,
          PlaySessionId: input.playSessionId,
          PositionTicks: input.positionTicks,
          AudioStreamIndex: input.audioStreamIndex,
          SubtitleStreamIndex: input.subtitleStreamIndex,
          Failed: input.failed ?? false,
        }
      : {
          ItemId: input.itemId,
          AudioStreamIndex: input.audioStreamIndex,
          MediaSourceId: input.mediaSourceId,
          PlaySessionId: input.playSessionId,
          PositionTicks: input.positionTicks,
          SubtitleStreamIndex: input.subtitleStreamIndex,
          CanSeek: (input.runTimeTicks ?? 0) > 0,
          IsPaused: input.isPaused ?? false,
          IsMuted: false,
          PlayMethod: input.playMethod ?? 'DirectPlay',
          RepeatMode: 'RepeatNone',
          PlaybackOrder: 'Default',
        };

  await getJson(
    buildUrl(baseUrl, `/Sessions/${endpoint}`, {api_key: accessToken}),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(accessToken),
      },
      body: JSON.stringify(body),
    },
  );
};

export const reportPlaybackStart = (
  serverUrl: string,
  accessToken: string,
  input: PlaybackReportInput,
) => reportPlayback(serverUrl, accessToken, 'Playing', input);

export const reportPlaybackProgress = (
  serverUrl: string,
  accessToken: string,
  input: PlaybackReportInput,
) => reportPlayback(serverUrl, accessToken, 'Playing/Progress', input);

export const reportPlaybackStopped = (
  serverUrl: string,
  accessToken: string,
  input: PlaybackReportInput,
) => reportPlayback(serverUrl, accessToken, 'Playing/Stopped', input);

export const setFavorite = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  itemId: string,
  isFavorite: boolean,
) => {
  const baseUrl = normalizeServerUrl(serverUrl);
  await getJson(
    buildUrl(baseUrl, `/Users/${userId}/FavoriteItems/${itemId}`, {
      api_key: accessToken,
    }),
    {
      method: isFavorite ? 'POST' : 'DELETE',
      headers: getAuthHeaders(accessToken),
    },
  );
};

export const setPlayed = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  itemId: string,
  isPlayed: boolean,
) => {
  const baseUrl = normalizeServerUrl(serverUrl);
  await getJson(
    buildUrl(baseUrl, `/Users/${userId}/PlayedItems/${itemId}`, {
      api_key: accessToken,
    }),
    {
      method: isPlayed ? 'POST' : 'DELETE',
      headers: getAuthHeaders(accessToken),
    },
  );
};
