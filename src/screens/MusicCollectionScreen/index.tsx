/**
 * Genre and playlist contents.
 *
 * Both are "a named bag of music", so they share a screen rather than getting
 * two near-identical ones. A genre resolves to its albums (browsing a genre by
 * album is how people actually think about it); a playlist resolves to its
 * tracks in playlist order.
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
  getGenreAlbums,
  getPlaylistTracks,
  MusicAlbum,
  MusicSession,
  MusicTrack,
} from '../../services/jellyfin/music';
import {audioPlayback} from '../../services/audioPlayer';
import {ServerProfile} from '../../services/storage';
import {formatTotalRuntime, metaLine} from '../../utils/duration';

export type MusicCollectionKind = 'genre' | 'playlist';

interface MusicCollectionScreenProps {
  collectionId: string;
  kind: MusicCollectionKind;
  onBack?: () => void;
  onSelectAlbum?: (albumId: string) => void;
  serverProfile: ServerProfile;
  title: string;
}

export const MusicCollectionScreen = ({
  collectionId,
  kind,
  onBack,
  onSelectAlbum,
  serverProfile,
  title,
}: MusicCollectionScreenProps) => {
  const [albums, setAlbums] = useState<MusicAlbum[]>([]);
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
        if (kind === 'playlist') {
          const page = await getPlaylistTracks(session, collectionId);

          if (active) {
            setTracks(page.items);
          }
        } else {
          const page = await getGenreAlbums(session, collectionId, {
            limit: 200,
          });

          if (active) {
            setAlbums(page.items);
          }
        }
      } catch (error) {
        if (active) {
          setErrorText(
            error instanceof Error ? error.message : 'Unable to load.',
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
  }, [collectionId, kind, session]);

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

  const totalTicks = tracks.reduce(
    (sum, track) => sum + (track.runTimeTicks ?? 0),
    0,
  );

  return (
    <ScrollView style={styles.root}>
      <View style={styles.header}>
        <Text numberOfLines={2} style={styles.title}>
          {title}
        </Text>
        <Text style={styles.meta}>
          {kind === 'playlist'
            ? metaLine(
                tracks.length ? `${tracks.length} tracks` : undefined,
                formatTotalRuntime(totalTicks),
              )
            : metaLine(albums.length ? `${albums.length} albums` : undefined)}
        </Text>

        <TVFocusGuideView style={styles.actions}>
          {kind === 'playlist' && tracks.length ? (
            <>
              <FocusableItem
                focusedStyle={styles.actionFocused}
                hasTVPreferredFocus={true}
                onPress={() => playFrom(0)}
                style={styles.action}
                testID="collection-play">
                <Text style={styles.actionText}>Play</Text>
              </FocusableItem>
              <FocusableItem
                focusedStyle={styles.actionFocused}
                onPress={() => playFrom(0, true)}
                style={styles.action}
                testID="collection-shuffle">
                <Text style={styles.actionText}>Shuffle</Text>
              </FocusableItem>
              <FocusableItem
                focusedStyle={styles.actionFocused}
                onPress={() => audioPlayback.addToQueue(tracks)}
                style={styles.action}
                testID="collection-queue">
                <Text style={styles.actionText}>Add to queue</Text>
              </FocusableItem>
            </>
          ) : null}
          <FocusableItem
            focusedStyle={styles.actionFocused}
            hasTVPreferredFocus={kind === 'genre'}
            onPress={onBack}
            style={styles.action}
            testID="collection-back">
            <Text style={styles.actionText}>Back</Text>
          </FocusableItem>
        </TVFocusGuideView>
      </View>

      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

      {kind === 'playlist' ? (
        <View style={styles.trackList}>
          {tracks.map((track, index) => (
            <TrackRow
              isPlaying={track.id === playingTrackId}
              key={track.id}
              onPress={() => playFrom(index)}
              position={index + 1}
              showArtist={true}
              track={track}
            />
          ))}
          {!tracks.length && !errorText ? (
            <Text style={styles.status}>This playlist is empty.</Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.grid}>
          {albums.map((album) => (
            <FocusableItem
              focusedStyle={styles.tileFocused}
              key={album.id}
              onPress={() => onSelectAlbum?.(album.id)}
              style={styles.tile}
              testID={`collection-album-${album.id}`}>
              {album.imageUrl ? (
                <Image source={{uri: album.imageUrl}} style={styles.cover} />
              ) : (
                <View style={[styles.cover, styles.placeholder]}>
                  <Text style={styles.placeholderText}>
                    {album.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text numberOfLines={1} style={styles.tileTitle}>
                {album.name}
              </Text>
              <Text numberOfLines={1} style={styles.tileSubtitle}>
                {album.albumArtist}
              </Text>
            </FocusableItem>
          ))}
          {!albums.length && !errorText ? (
            <Text style={styles.status}>No albums in this genre.</Text>
          ) : null}
        </View>
      )}
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
  header: {paddingHorizontal: 30, paddingTop: 30},
  title: {color: '#f4f6f8', fontSize: 40, fontWeight: '700'},
  meta: {color: '#8b97a5', fontSize: 17, marginTop: 8},
  actions: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 18},
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 40,
    paddingHorizontal: 22,
  },
  tile: {margin: 8, width: 180},
  tileFocused: {transform: [{scale: 1.05}]},
  cover: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    height: 180,
    width: 180,
  },
  placeholder: {alignItems: 'center', justifyContent: 'center'},
  placeholderText: {color: '#54d38a', fontSize: 44, fontWeight: '700'},
  tileTitle: {color: '#f4f6f8', fontSize: 16, marginTop: 6},
  tileSubtitle: {color: '#8b97a5', fontSize: 14},
  status: {color: '#8b97a5', fontSize: 17, padding: 16},
  error: {color: '#ff8a80', fontSize: 18, paddingHorizontal: 26},
});
