/**
 * Album detail.
 *
 * Layout follows what the Jellyfin client gets right — cover, metadata line,
 * a row of actions, then the track list — while dropping the actions that
 * don't belong on a TV. Server-management items (edit metadata, edit images,
 * identify, refresh, delete) are deliberately absent: they need a keyboard and
 * a mouse, and a 10-foot remote is the wrong instrument for them.
 *
 * "View album artist" is kept, because arriving at an album from a search or a
 * playlist and wanting the rest of that artist's work is a real path.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {TrackRow} from '../../components/TrackRow';
import {
  getAlbum,
  getAlbumTracks,
  MusicAlbum,
  MusicSession,
  MusicTrack,
} from '../../services/jellyfin/music';
import {audioPlayback} from '../../services/audioPlayer';
import {ServerProfile} from '../../services/storage';
import {formatTotalRuntime, metaLine} from '../../utils/duration';

interface AlbumDetailScreenProps {
  albumId: string;
  onBack?: () => void;
  onViewArtist?: (artistId: string, artistName?: string) => void;
  serverProfile: ServerProfile;
}

export const AlbumDetailScreen = ({
  albumId,
  onBack,
  onViewArtist,
  serverProfile,
}: AlbumDetailScreenProps) => {
  const [album, setAlbum] = useState<MusicAlbum | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);

  const session: MusicSession = useMemo(
    () => ({
      accessToken: serverProfile.accessToken,
      serverUrl: serverProfile.serverUrl,
      userId: serverProfile.userId,
    }),
    [serverProfile],
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setErrorText(null);

      try {
        const [detail, trackPage] = await Promise.all([
          getAlbum(session, albumId),
          getAlbumTracks(session, albumId),
        ]);

        if (!active) {
          return;
        }

        setAlbum(detail);
        setTracks(trackPage.items);
      } catch (error) {
        if (active) {
          setErrorText(
            error instanceof Error ? error.message : 'Unable to load album.',
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [albumId, session]);

  // Keep the now-playing highlight in sync while the user stays on the screen.
  useEffect(() => {
    audioPlayback.setSession(session);

    return audioPlayback.subscribe((status) => {
      setPlayingTrackId(status.track?.id ?? null);
    });
  }, [session]);

  const playFrom = useCallback(
    (startIndex: number, shuffle = false) => {
      audioPlayback.setSession(session);
      audioPlayback.play(tracks, {shuffle, startIndex});
    },
    [session, tracks],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (errorText || !album) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{errorText ?? 'Album not found.'}</Text>
        <FocusableItem
          focusedStyle={styles.actionFocused}
          hasTVPreferredFocus={true}
          onPress={onBack}
          style={styles.action}
          testID="album-back">
          <Text style={styles.actionText}>Back</Text>
        </FocusableItem>
      </View>
    );
  }

  const trackCount = tracks.length || album.trackCount;
  const totalTicks =
    album.runTimeTicks ??
    tracks.reduce((sum, track) => sum + (track.runTimeTicks ?? 0), 0);

  return (
    <ScrollView style={styles.root}>
      <View style={styles.hero}>
        {album.imageUrl ? (
          <Image source={{uri: album.imageUrl}} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.placeholder]}>
            <Text style={styles.placeholderText}>
              {album.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.heroText}>
          <Text numberOfLines={2} style={styles.title}>
            {album.name}
          </Text>
          {album.albumArtist ? (
            <Text style={styles.artist}>{album.albumArtist}</Text>
          ) : null}
          <Text style={styles.meta}>
            {metaLine(
              trackCount ? `${trackCount} tracks` : undefined,
              formatTotalRuntime(totalTicks),
              album.productionYear,
            )}
          </Text>

          <TVFocusGuideView style={styles.actions}>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              hasTVPreferredFocus={true}
              onPress={() => playFrom(0)}
              style={styles.action}
              testID="album-play">
              <Text style={styles.actionText}>Play</Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              onPress={() => playFrom(0, true)}
              style={styles.action}
              testID="album-shuffle">
              <Text style={styles.actionText}>Shuffle</Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              onPress={() => audioPlayback.addToQueue(tracks)}
              style={styles.action}
              testID="album-queue">
              <Text style={styles.actionText}>Add to queue</Text>
            </FocusableItem>
            {album.albumArtistId ? (
              <FocusableItem
                focusedStyle={styles.actionFocused}
                onPress={() =>
                  onViewArtist?.(album.albumArtistId!, album.albumArtist)
                }
                style={styles.action}
                testID="album-view-artist">
                <Text style={styles.actionText}>View artist</Text>
              </FocusableItem>
            ) : null}
            <FocusableItem
              focusedStyle={styles.actionFocused}
              onPress={onBack}
              style={styles.action}
              testID="album-back">
              <Text style={styles.actionText}>Back</Text>
            </FocusableItem>
          </TVFocusGuideView>
        </View>
      </View>

      <View style={styles.trackList}>
        {tracks.map((track, index) => (
          <TrackRow
            isPlaying={track.id === playingTrackId}
            key={track.id}
            onPress={() => playFrom(index)}
            track={track}
          />
        ))}
        {!tracks.length ? (
          <Text style={styles.status}>This album has no tracks.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {backgroundColor: '#0b0d10', flex: 1},
  centered: {
    alignItems: 'center',
    backgroundColor: '#0b0d10',
    flex: 1,
    justifyContent: 'center',
  },
  hero: {flexDirection: 'row', padding: 32},
  cover: {
    backgroundColor: '#161b22',
    borderRadius: 10,
    height: 260,
    width: 260,
  },
  placeholder: {alignItems: 'center', justifyContent: 'center'},
  placeholderText: {color: '#54d38a', fontSize: 64, fontWeight: '700'},
  heroText: {flex: 1, paddingLeft: 28},
  title: {color: '#f4f6f8', fontSize: 40, fontWeight: '700'},
  artist: {color: '#c8d2dc', fontSize: 24, marginTop: 6},
  meta: {color: '#8b97a5', fontSize: 17, marginTop: 10},
  actions: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 22},
  action: {
    borderRadius: 8,
    marginBottom: 10,
    marginRight: 12,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  actionFocused: {backgroundColor: '#54d38a'},
  actionText: {color: '#f4f6f8', fontSize: 19, fontWeight: '600'},
  trackList: {paddingBottom: 40, paddingHorizontal: 26},
  status: {color: '#8b97a5', fontSize: 17, padding: 14},
  error: {color: '#ff8a80', fontSize: 19, marginBottom: 16},
});
