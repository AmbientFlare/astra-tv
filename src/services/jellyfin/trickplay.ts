import {buildUrl, getAuthHeaders, getJson, normalizeServerUrl} from './http';

export interface TrickplayInfo {
  Width: number;
  Height: number;
  TileWidth: number;
  TileHeight: number;
  ThumbnailCount: number;
  Interval: number;
}

type TrickplayMap = Record<string, Record<string, TrickplayInfo>>;
const canonicalId = (id: string) => id.replace(/-/g, '').toLowerCase();

/** Bound decoded sprite memory on Fire TV, including untrusted server metadata. */
const validInfo = (info: TrickplayInfo) => {
  if (
    !info ||
    ![
      info.Width,
      info.Height,
      info.TileWidth,
      info.TileHeight,
      info.ThumbnailCount,
      info.Interval,
    ].every((n) => Number.isSafeInteger(n) && n > 0)
  ) {
    return false;
  }
  const width = info.Width * info.TileWidth;
  const height = info.Height * info.TileHeight;
  return width <= 4096 && height <= 4096 && width * height <= 8000000;
};

export const selectTrickplayInfo = (
  data: TrickplayMap | undefined,
  mediaSourceId: string,
): TrickplayInfo | null => {
  const source = Object.entries(data ?? {}).find(
    ([id]) => canonicalId(id) === canonicalId(mediaSourceId),
  );
  if (!source) {
    return null;
  }
  // Prefer a small preview-sized resolution, never a different media version.
  const candidates = Object.values(source[1] ?? {})
    .filter(validInfo)
    .sort(
      (a, b) =>
        Math.abs(a.Width - 240) - Math.abs(b.Width - 240) || a.Width - b.Width,
    );
  return candidates[0] ?? null;
};

export const getTrickplayInfo = async (
  serverUrl: string,
  accessToken: string,
  itemId: string,
  mediaSourceId: string,
  signal: AbortController['signal'],
  userId?: string,
): Promise<TrickplayInfo | null> => {
  const response = await getJson<{
    Items?: Array<{Id?: string; Trickplay?: TrickplayMap}>;
  }>(
    buildUrl(normalizeServerUrl(serverUrl), 'Items', {
      Fields: 'Trickplay',
      Ids: itemId,
      Recursive: true,
      Limit: 1,
      userId,
      EnableImages: false,
      EnableUserData: false,
    }),
    {headers: getAuthHeaders(accessToken), signal},
    8000,
  );
  const item = response?.Items?.find(
    (entry) => canonicalId(entry.Id ?? '') === canonicalId(itemId),
  );
  return selectTrickplayInfo(item?.Trickplay, mediaSourceId);
};

export const getTrickplayFrame = (info: TrickplayInfo, seconds: number) => {
  if (!validInfo(info) || !Number.isFinite(seconds)) {
    return null;
  }
  const index = Math.min(
    info.ThumbnailCount - 1,
    Math.max(0, Math.floor((seconds * 1000) / info.Interval)),
  );
  const perSheet = info.TileWidth * info.TileHeight;
  const withinSheet = index % perSheet;
  return {
    sheet: Math.floor(index / perSheet),
    left: (withinSheet % info.TileWidth) * info.Width,
    top: Math.floor(withinSheet / info.TileWidth) * info.Height,
  };
};

export const getTrickplayImageSource = (
  serverUrl: string,
  accessToken: string,
  itemId: string,
  mediaSourceId: string,
  width: number,
  sheet: number,
) => ({
  uri: buildUrl(
    normalizeServerUrl(serverUrl),
    `Videos/${encodeURIComponent(itemId)}/Trickplay/${width}/${sheet}.jpg`,
    {mediaSourceId},
  ),
  headers: getAuthHeaders(accessToken),
});
