import React, {useEffect, useMemo, useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import {
  getTrickplayFrame,
  getTrickplayImageSource,
  getTrickplayInfo,
  TrickplayInfo,
} from '../../services/jellyfin/trickplay';

interface Props {
  serverUrl: string;
  accessToken: string;
  itemId: string;
  mediaSourceId: string;
  userId?: string;
  target: number | null;
}

/** Optional, independent of the video pipeline. Failure leaves timestamp seeking intact. */
export const SeekThumbnail = ({target, ...props}: Props) => {
  const {serverUrl, accessToken, itemId, mediaSourceId, userId} = props;
  const context = useMemo(
    () => ({serverUrl, accessToken, itemId, mediaSourceId, userId}),
    [serverUrl, accessToken, itemId, mediaSourceId, userId],
  );
  const [metadata, setMetadata] = useState<{
    context: typeof context;
    info: TrickplayInfo | null;
  } | null>(null);
  const [failedContext, setFailedContext] = useState<typeof context | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    getTrickplayInfo(
      serverUrl,
      accessToken,
      itemId,
      mediaSourceId,
      controller.signal,
      userId,
    )
      .then((info) => {
        if (!controller.signal.aborted) {
          setMetadata({context, info});
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMetadata({context, info: null});
        }
      });
    return () => controller.abort();
  }, [context, serverUrl, accessToken, itemId, mediaSourceId, userId]);

  const info = metadata?.context === context ? metadata.info : null;
  const frame =
    info && target !== null ? getTrickplayFrame(info, target) : null;
  const sheet = frame?.sheet;
  const source = useMemo(
    () =>
      info && sheet !== undefined
        ? getTrickplayImageSource(
            serverUrl,
            accessToken,
            itemId,
            mediaSourceId,
            info.Width,
            sheet,
          )
        : null,
    [serverUrl, accessToken, itemId, mediaSourceId, info, sheet],
  );
  if (!info || !frame || !source || failedContext === context) {
    return null;
  }

  return (
    <Sprite
      key={source.uri}
      source={source}
      info={info}
      frame={frame}
      onError={() => setFailedContext(context)}
    />
  );
};

const Sprite = ({
  source,
  info,
  frame,
  onError,
}: {
  source: ReturnType<typeof getTrickplayImageSource>;
  info: TrickplayInfo;
  frame: NonNullable<ReturnType<typeof getTrickplayFrame>>;
  onError(): void;
}) => {
  const [size, setSize] = useState<{width: number; height: number} | null>(
    null,
  );
  const scale = Math.min(240 / info.Width, 180 / info.Height);
  if (
    size &&
    (frame.left + info.Width > size.width ||
      frame.top + info.Height > size.height)
  ) {
    return null;
  }
  return (
    <View pointerEvents="none" style={styles.position}>
      <View
        testID="player-seek-thumbnail"
        style={[
          styles.viewport,
          {width: info.Width * scale, height: info.Height * scale},
        ]}>
        <Image
          testID="player-seek-thumbnail-image"
          source={source}
          resizeMode="stretch"
          onError={onError}
          onLoad={(event) => {
            // The last sprite may have fewer rows. Use its actual dimensions so
            // stretching it to the full grid does not select the wrong scene.
            const actual = event.nativeEvent.source;
            const width = actual?.width ?? info.Width * info.TileWidth;
            const height = actual?.height ?? info.Height * info.TileHeight;
            if (
              !(width > 0 && height > 0) ||
              width > 4096 ||
              height > 4096 ||
              width * height > 8000000 ||
              frame.left + info.Width > width ||
              frame.top + info.Height > height
            ) {
              onError();
              return;
            }
            setSize({width, height});
          }}
          style={[
            styles.sheet,
            size ? styles.visible : styles.hidden,
            {
              width: (size?.width ?? info.Width * info.TileWidth) * scale,
              height: (size?.height ?? info.Height * info.TileHeight) * scale,
              left: -frame.left * scale,
              top: -frame.top * scale,
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: {position: 'absolute'},
  visible: {opacity: 1},
  hidden: {opacity: 0},
  position: {
    position: 'absolute',
    bottom: 200,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  viewport: {
    width: 240,
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 6,
    backgroundColor: '#161D24',
    marginBottom: 12,
  },
});
