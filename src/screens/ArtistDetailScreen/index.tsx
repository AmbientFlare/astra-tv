/**
 * Artist detail, shaped like Spotify rather than like a folder listing:
 * hero, popular tracks, then the discography.
 *
 * Two decisions worth knowing about:
 *
 * 1. EXPAND ALL. Jellyfin's client makes you open each album to reach its
 *    tracks, which is painful when assembling a queue. "Expand all albums"
 *    inlines every track in release order so a whole discography can be
 *    queued, or individual tracks picked, without leaving the screen.
 *
 * 2. TOP TRACKS ARE BEST-EFFORT. Jellyfin has no global popularity, only this
 *    user's own play counts — zero across a freshly added library. The API
 *    layer falls back played -> rated -> newest album, so the section shows
 *    something meaningful on first run. It is labelled "Popular" only when it
 *    is genuinely play-count based.
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
  getAlbumTracks,
  getArtist,
  getArtistAlbums,
  getArtistFallbackImage,
  getArtistTopTracks,
  MusicAlbum,
  MusicSession,
  MusicTrack,
} from '../../services/jellyfin/music';
import {audioPlayback} from '../../services/audioPlayer';
import {ServerProfile} from '../../services/storage';
import {formatTotalRuntime, metaLine} from '../../utils/duration';

interface ArtistDetailScreenProps {
  artistId: string;
  onBack?: () => void;
  onSelectAlbum?: (albumId: string) => void;
  serverProfile: ServerProfile;
}

interface AlbumWithTracks {
  album: MusicAlbum;
  tracks: MusicTrack[];
}

export const ArtistDetailScreen = ({
  artistId,
  onBack,
  onSelectAlbum,
  serverProfile,
}: ArtistDetailScreenProps) => {
  const [artist, setArtist] = useState<{
    imageUrl?: string;
    name: string;
    overview?: string | null;
  } | null>(null);
  const [albums, setAlbums] = useState<MusicAlbum[]>([]);
  const [topTracks, setTopTracks] = useState<MusicTrack[]>([]);
  const [hasPlayCounts, setHasPlayCounts] = useState(false);
  const [expanded, setExpanded] = useState<AlbumWithTracks[] | null>(null);
  const [isExpanding, setExpanding] = useState(false);
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
      setExpanded(null);

      try {
        const [detail, albumPage, tracks] = await Promise.all([
          getArtist(session, artistId),
          getArtistAlbums(session, artistId, {limit: 200}),
          getArtistTopTracks(session, artistId, 10),
        ]);

        if (!active) {
          return;
        }

        setAlbums(albumPage.items);
        setTopTracks(tracks);
        setHasPlayCounts(tracks.some((track) => (track.playCount ?? 0) > 0));

        // Many artists have no image. Rather than a coloured box, borrow the
        // earliest album's cover — far better than an empty tile.
        let imageUrl = detail.imageUrl;

        if (!imageUrl) {
          imageUrl =
            (await getArtistFallbackImage(session, artistId)) ??
            albumPage.items[albumPage.items.length - 1]?.imageUrl;
        }

        if (active) {
          setArtist({
            imageUrl,
            name: detail.name,
            overview: detail.overview,
          });
        }
      } catch (error) {
        if (active) {
          setErrorText(
            error instanceof Error ? error.message : 'Unable to load artist.',
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
  }, [artistId, session]);

  useEffect(() => {
    audioPlayback.setSession(session);

    return audioPlayback.subscribe((status) => {
      setPlayingTrackId(status.track?.id ?? null);
    });
  }, [session]);

  /** Every track by this artist, in release order — the expand-all payload. */
  const loadEverything = useCallback(async (): Promise<AlbumWithTracks[]> => {
    if (expanded) {
      return expanded;
    }

    // Newest first — the user wants recent work at the top when scanning a
    // discography for something to queue.
    const ordered = [...albums].sort(
      (left, right) => (right.productionYear ?? 0) - (left.productionYear ?? 0),
    );
    const loaded = await Promise.all(
      ordered.map(async (album) => ({
        album,
        tracks: (await getAlbumTracks(session, album.id)).items,
      })),
    );

    setExpanded(loaded);

    return loaded;
  }, [albums, expanded, session]);

  const toggleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(null);
      return;
    }

    setExpanding(true);

    try {
      await loadEverything();
    } catch {
      setErrorText('Unable to load every album for this artist.');
    } finally {
      setExpanding(false);
    }
  }, [expanded, loadEverything]);

  const playAll = useCallback(
    async (shuffle: boolean) => {
      const everything = await loadEverything();
      const tracks = everything.flatMap((entry) => entry.tracks);

      if (tracks.length) {
        audioPlayback.setSession(session);
        await audioPlayback.play(tracks, {shuffle});
      }
    },
    [loadEverything, session],
  );

  const playTracks = useCallback(
    (tracks: MusicTrack[], startIndex: number) => {
      audioPlayback.setSession(session);
      audioPlayback.play(tracks, {startIndex});
    },
    [session],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (errorText && !artist) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{errorText}</Text>
        <FocusableItem
          focusedStyle={styles.actionFocused}
          hasTVPreferredFocus={true}
          onPress={onBack}
          style={styles.action}
          testID="artist-back">
          <Text style={styles.actionText}>Back</Text>
        </FocusableItem>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root}>
      <View style={styles.hero}>
        {artist?.imageUrl ? (
          <Image source={{uri: artist.imageUrl}} style={styles.portrait} />
        ) : (
          <View style={[styles.portrait, styles.placeholder]}>
            <Text style={styles.placeholderText}>
              {(artist?.name ?? '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.heroText}>
          <Text numberOfLines={2} style={styles.title}>
            {artist?.name}
          </Text>
          <Text style={styles.meta}>
            {metaLine(
              albums.length ? `${albums.length} albums` : undefined,
              expanded
                ? `${expanded.reduce(
                    (sum, entry) => sum + entry.tracks.length,
                    0,
                  )} tracks`
                : undefined,
            )}
          </Text>

          <TVFocusGuideView style={styles.actions}>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              hasTVPreferredFocus={true}
              onPress={() => playAll(false)}
              style={styles.action}
              testID="artist-play-all">
              <Text style={styles.actionText}>Play all</Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              onPress={() => playAll(true)}
              style={styles.action}
              testID="artist-shuffle">
              <Text style={styles.actionText}>Shuffle</Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              onPress={toggleExpand}
              style={styles.action}
              testID="artist-expand">
              <Text style={styles.actionText}>
                {isExpanding
                  ? 'Loading...'
                  : expanded
                  ? 'Collapse albums'
                  : 'Expand all albums'}
              </Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              onPress={onBack}
              style={styles.action}
              testID="artist-back">
              <Text style={styles.actionText}>Back</Text>
            </FocusableItem>
          </TVFocusGuideView>
        </View>
      </View>

      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

      {topTracks.length && !expanded ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {hasPlayCounts ? 'Popular' : 'Tracks'}
          </Text>
          {topTracks.map((track, index) => (
            <TrackRow
              isPlaying={track.id === playingTrackId}
              key={track.id}
              onPress={() => playTracks(topTracks, index)}
              position={index + 1}
              track={track}
            />
          ))}
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>All tracks</Text>
          {expanded.map((entry) => (
            <View key={entry.album.id}>
              <Text style={styles.albumHeading}>
                {metaLine(entry.album.name, entry.album.productionYear)}
              </Text>
              {entry.tracks.map((track, index) => (
                <TrackRow
                  isPlaying={track.id === playingTrackId}
                  key={track.id}
                  onPress={() => playTracks(entry.tracks, index)}
                  track={track}
                />
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Albums</Text>
          <ScrollView horizontal={true}>
            <TVFocusGuideView style={styles.albumRow}>
              {albums.map((album) => (
                <FocusableItem
                  focusedStyle={styles.albumFocused}
                  key={album.id}
                  onPress={() => onSelectAlbum?.(album.id)}
                  style={styles.albumTile}
                  testID={`artist-album-${album.id}`}>
                  {album.imageUrl ? (
                    <Image
                      source={{uri: album.imageUrl}}
                      style={styles.albumCover}
                    />
                  ) : (
                    <View style={[styles.albumCover, styles.placeholder]}>
                      <Text style={styles.placeholderText}>
                        {album.name.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text numberOfLines={1} style={styles.albumName}>
                    {album.name}
                  </Text>
                  <Text style={styles.albumMeta}>
                    {metaLine(
                      album.productionYear,
                      formatTotalRuntime(album.runTimeTicks),
                    )}
                  </Text>
                </FocusableItem>
              ))}
            </TVFocusGuideView>
          </ScrollView>
          {!albums.length ? (
            <Text style={styles.status}>No albums for this artist.</Text>
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
  hero: {flexDirection: 'row', padding: 32},
  portrait: {
    backgroundColor: '#161b22',
    borderRadius: 140,
    height: 240,
    width: 240,
  },
  placeholder: {alignItems: 'center', justifyContent: 'center'},
  placeholderText: {color: '#54d38a', fontSize: 60, fontWeight: '700'},
  heroText: {flex: 1, paddingLeft: 30},
  title: {color: '#f4f6f8', fontSize: 46, fontWeight: '700'},
  meta: {color: '#8b97a5', fontSize: 17, marginTop: 10},
  actions: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 24},
  action: {
    borderRadius: 8,
    marginBottom: 10,
    marginRight: 12,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  actionFocused: {backgroundColor: '#54d38a'},
  actionText: {color: '#f4f6f8', fontSize: 19, fontWeight: '600'},
  section: {paddingBottom: 26, paddingHorizontal: 26},
  sectionTitle: {
    color: '#f4f6f8',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 8,
  },
  albumHeading: {
    color: '#c8d2dc',
    fontSize: 19,
    fontWeight: '600',
    marginTop: 18,
    paddingHorizontal: 14,
  },
  albumRow: {flexDirection: 'row'},
  albumTile: {marginRight: 16, width: 200},
  albumFocused: {transform: [{scale: 1.05}]},
  albumCover: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    height: 200,
    width: 200,
  },
  albumName: {color: '#f4f6f8', fontSize: 17, marginTop: 8},
  albumMeta: {color: '#8b97a5', fontSize: 14},
  status: {color: '#8b97a5', fontSize: 17, padding: 14},
  error: {color: '#ff8a80', fontSize: 18, paddingHorizontal: 26},
});
