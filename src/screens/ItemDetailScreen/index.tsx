import React, {useCallback, useEffect, useState} from 'react';
import {Image, Linking, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {MediaCard} from '../../components/MediaCard';
import {
  getEpisodes,
  getItemDetails,
  getSeasons,
  getSimilarItems,
  JellyfinMediaItem,
  setFavorite,
  setPlayed,
} from '../../services/jellyfin';
import {ServerProfile} from '../../services/storage';

interface ItemDetailScreenProps {
  item: JellyfinMediaItem;
  onBack?: () => void;
  onPlay?: (item: JellyfinMediaItem) => void;
  onSelectEpisode?: (item: JellyfinMediaItem) => void;
  onSelectItem?: (item: JellyfinMediaItem) => void;
  onSelectPerson?: (personId: string, personName?: string) => void;
  serverProfile: ServerProfile;
}

const formatRuntime = (ticks?: number) => {
  if (!ticks) {
    return null;
  }

  const minutes = Math.round(ticks / 10000000 / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return hours > 0 ? `${hours}h ${remainder}m` : `${minutes}m`;
};

export const ItemDetailScreen = ({
  item,
  onBack,
  onPlay,
  onSelectEpisode,
  onSelectItem,
  onSelectPerson,
  serverProfile,
}: ItemDetailScreenProps) => {
  const [detail, setDetail] = useState(item);
  const [seasons, setSeasons] = useState<JellyfinMediaItem[]>([]);
  const [episodes, setEpisodes] = useState<JellyfinMediaItem[]>([]);
  const [similarItems, setSimilarItems] = useState<JellyfinMediaItem[]>([]);
  const [selectedSeason, setSelectedSeason] =
    useState<JellyfinMediaItem | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isUpdatingUserData, setUpdatingUserData] = useState(false);

  const loadDetail = useCallback(
    async (mounted = true) => {
      setLoading(true);
      setErrorText(null);
      try {
        const result = await getItemDetails(
          serverProfile.serverUrl,
          serverProfile.accessToken,
          serverProfile.userId,
          item.id,
        );

        if (!mounted) {
          return;
        }

        setDetail(result);

        if (result.type === 'Series') {
          const seasonResults = await getSeasons(
            serverProfile.serverUrl,
            serverProfile.accessToken,
            serverProfile.userId,
            result.id,
          );

          if (mounted) {
            setSeasons(seasonResults);
            setSelectedSeason(seasonResults[0] ?? null);
          }
        }
      } catch (error) {
        if (mounted) {
          setErrorText(
            error instanceof Error
              ? error.message
              : 'Unable to load item details.',
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    },
    [item.id, serverProfile],
  );

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    let mounted = true;

    const loadSimilarItems = async () => {
      try {
        const results = await getSimilarItems(
          serverProfile.serverUrl,
          serverProfile.accessToken,
          detail.id,
          serverProfile.userId,
        );

        if (mounted) {
          setSimilarItems(results);
        }
      } catch {
        if (mounted) {
          setSimilarItems([]);
        }
      }
    };

    loadSimilarItems();

    return () => {
      mounted = false;
    };
  }, [detail.id, serverProfile]);

  useEffect(() => {
    let mounted = true;

    const loadEpisodes = async () => {
      if (!selectedSeason || detail.type !== 'Series') {
        setEpisodes([]);
        return;
      }

      try {
        const results = await getEpisodes(
          serverProfile.serverUrl,
          serverProfile.accessToken,
          serverProfile.userId,
          detail.id,
          selectedSeason.id,
        );

        if (mounted) {
          setEpisodes(results);
        }
      } catch (error) {
        if (mounted) {
          setErrorText(
            error instanceof Error ? error.message : 'Unable to load episodes.',
          );
        }
      }
    };

    loadEpisodes();

    return () => {
      mounted = false;
    };
  }, [detail.id, detail.type, selectedSeason, serverProfile]);

  const runtime = formatRuntime(detail.runTimeTicks);
  const meta = [
    detail.productionYear,
    runtime,
    detail.officialRating,
    detail.communityRating ? `${detail.communityRating.toFixed(1)}/10` : null,
  ].filter(Boolean);
  const actors =
    detail.people?.filter((person) => person.type === 'Actor' && person.id) ??
    [];
  const director = detail.people?.find((person) => person.type === 'Director');
  const firstTrailer = detail.remoteTrailers?.[0];

  const updateFavorite = async () => {
    const nextValue = !detail.isFavorite;
    setUpdatingUserData(true);
    setDetail((current) => ({...current, isFavorite: nextValue}));
    setErrorText(null);

    try {
      await setFavorite(
        serverProfile.serverUrl,
        serverProfile.accessToken,
        serverProfile.userId,
        detail.id,
        nextValue,
      );
    } catch (error) {
      setDetail((current) => ({...current, isFavorite: !nextValue}));
      setErrorText(
        error instanceof Error ? error.message : 'Unable to update favorite.',
      );
    } finally {
      setUpdatingUserData(false);
    }
  };

  const updatePlayed = async () => {
    const nextValue = !detail.isPlayed;
    setUpdatingUserData(true);
    setDetail((current) => ({...current, isPlayed: nextValue}));
    setErrorText(null);

    try {
      await setPlayed(
        serverProfile.serverUrl,
        serverProfile.accessToken,
        serverProfile.userId,
        detail.id,
        nextValue,
      );
    } catch (error) {
      setDetail((current) => ({...current, isPlayed: !nextValue}));
      setErrorText(
        error instanceof Error
          ? error.message
          : 'Unable to update watched state.',
      );
    } finally {
      setUpdatingUserData(false);
    }
  };

  return (
    <ScrollView style={styles.screen} testID="item-detail-screen">
      <View style={styles.hero}>
        {detail.backdropUrl ? (
          <Image source={{uri: detail.backdropUrl}} style={styles.backdrop} />
        ) : null}
        <View style={styles.heroContent}>
          {detail.imageUrl ? (
            <Image source={{uri: detail.imageUrl}} style={styles.poster} />
          ) : null}
          <View style={styles.copy}>
            <Text style={styles.title}>{detail.name}</Text>
            <Text style={styles.meta}>{meta.join('  |  ')}</Text>
            <Text numberOfLines={5} style={styles.overview}>
              {detail.overview ?? 'No synopsis available.'}
            </Text>
            {detail.genres?.length ? (
              <Text style={styles.genres}>{detail.genres.join(' / ')}</Text>
            ) : null}
            {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
            {isLoading ? (
              <Text style={styles.status}>Loading details...</Text>
            ) : null}
            <TVFocusGuideView style={styles.actions}>
              <FocusableItem
                focusedStyle={styles.actionFocused}
                hasTVPreferredFocus={true}
                onPress={() =>
                  detail.type === 'Series'
                    ? episodes[0] && onPlay?.(episodes[0])
                    : onPlay?.(detail)
                }
                style={styles.actionButton}
                testID="detail-play-button">
                <Text style={styles.actionText}>
                  {detail.type === 'Series'
                    ? 'Play All'
                    : detail.resumePositionTicks
                    ? 'Resume'
                    : 'Play'}
                </Text>
              </FocusableItem>
              {detail.type === 'Movie' && detail.resumePositionTicks ? (
                <FocusableItem
                  focusedStyle={styles.actionFocused}
                  onPress={() => onPlay?.({...detail, resumePositionTicks: 0})}
                  style={styles.actionButton}
                  testID="detail-play-from-start-button">
                  <Text style={styles.actionText}>Play from Start</Text>
                </FocusableItem>
              ) : null}
              {detail.type === 'Series' && episodes.length ? (
                <FocusableItem
                  focusedStyle={styles.actionFocused}
                  onPress={() => {
                    const unwatched =
                      episodes.filter((episode) => !episode.isPlayed) ??
                      episodes;
                    const pool = unwatched.length ? unwatched : episodes;
                    const randomEpisode =
                      pool[Math.floor(Math.random() * pool.length)];
                    if (randomEpisode) {
                      onPlay?.(randomEpisode);
                    }
                  }}
                  style={styles.actionButton}
                  testID="detail-shuffle-button">
                  <Text style={styles.actionText}>Shuffle All</Text>
                </FocusableItem>
              ) : null}
              <FocusableItem
                disabled={isUpdatingUserData}
                focusedStyle={styles.actionFocused}
                onPress={updatePlayed}
                style={styles.actionButton}
                testID="detail-watched-button">
                <Text style={styles.actionText}>
                  {detail.isPlayed ? 'Unwatched' : 'Watched'}
                </Text>
              </FocusableItem>
              <FocusableItem
                disabled={isUpdatingUserData}
                focusedStyle={styles.actionFocused}
                onPress={updateFavorite}
                style={styles.actionButton}
                testID="detail-favorite-button">
                <Text style={styles.actionText}>
                  {detail.isFavorite ? 'Unfavorite' : 'Favorite'}
                </Text>
              </FocusableItem>
              {detail.type === 'Movie' && firstTrailer ? (
                <FocusableItem
                  focusedStyle={styles.actionFocused}
                  onPress={() => Linking.openURL(firstTrailer.url)}
                  style={styles.actionButton}
                  testID="detail-trailer-button">
                  <Text style={styles.actionText}>Trailer</Text>
                </FocusableItem>
              ) : null}
              {errorText ? (
                <FocusableItem
                  focusedStyle={styles.actionFocused}
                  onPress={() => loadDetail()}
                  style={styles.actionButton}
                  testID="detail-retry-button">
                  <Text style={styles.actionText}>Retry</Text>
                </FocusableItem>
              ) : null}
              <FocusableItem
                focusedStyle={styles.actionFocused}
                onPress={onBack}
                style={styles.actionButton}
                testID="detail-back-button">
                <Text style={styles.actionText}>Back</Text>
              </FocusableItem>
            </TVFocusGuideView>
            {director ? (
              <Text style={styles.director}>Directed by {director.name}</Text>
            ) : null}
          </View>
        </View>
      </View>

      {seasons.length ? (
        <>
          <Text style={styles.sectionTitle}>Seasons</Text>
          <ScrollView horizontal={true} style={styles.rowScroller}>
            <TVFocusGuideView style={styles.row}>
              {seasons.map((season) => (
                <MediaCard
                  imageUrl={season.imageUrl}
                  key={season.id}
                  onPress={() => setSelectedSeason(season)}
                  subtitle={
                    selectedSeason?.id === season.id ? 'Selected' : 'Season'
                  }
                  title={season.name}
                  unplayedCount={season.unplayedItemCount}
                />
              ))}
            </TVFocusGuideView>
          </ScrollView>
        </>
      ) : null}

      {episodes.length ? (
        <>
          <Text style={styles.sectionTitle}>Episodes</Text>
          <ScrollView horizontal={true} style={styles.rowScroller}>
            <TVFocusGuideView style={styles.row}>
              {episodes.map((episode) => (
                <MediaCard
                  imageUrl={episode.imageUrl}
                  key={episode.id}
                  onPress={() => onSelectEpisode?.(episode)}
                  subtitle={
                    episode.indexNumber
                      ? `Episode ${episode.indexNumber}`
                      : 'Episode'
                  }
                  title={episode.name}
                />
              ))}
            </TVFocusGuideView>
          </ScrollView>
        </>
      ) : null}

      {actors.length ? (
        <>
          <Text style={styles.sectionTitle}>Cast & Crew</Text>
          <ScrollView horizontal={true} style={styles.rowScroller}>
            <TVFocusGuideView style={styles.row}>
              {actors.map((person) => (
                <PersonCard
                  key={person.id}
                  imageUrl={person.imageUrl}
                  name={person.name}
                  onPress={() =>
                    person.id && onSelectPerson?.(person.id, person.name)
                  }
                  role={person.role}
                />
              ))}
            </TVFocusGuideView>
          </ScrollView>
        </>
      ) : null}

      {similarItems.length ? (
        <>
          <Text style={styles.sectionTitle}>More Like This</Text>
          <ScrollView horizontal={true} style={styles.rowScroller}>
            <TVFocusGuideView style={styles.row}>
              {similarItems.map((similarItem) => (
                <MediaCard
                  imageUrl={similarItem.imageUrl}
                  key={similarItem.id}
                  onPress={() => onSelectItem?.(similarItem)}
                  subtitle={
                    similarItem.productionYear
                      ? String(similarItem.productionYear)
                      : similarItem.type
                  }
                  title={similarItem.name}
                  unplayedCount={similarItem.unplayedItemCount}
                />
              ))}
            </TVFocusGuideView>
          </ScrollView>
        </>
      ) : null}
    </ScrollView>
  );
};

const PersonCard = ({
  imageUrl,
  name,
  onPress,
  role,
}: {
  imageUrl?: string;
  name: string;
  onPress?: () => void;
  role?: string;
}) => (
  <FocusableItem
    focusedStyle={styles.personFocused}
    onPress={onPress}
    style={styles.personCard}
    testID={`person-${name}`}>
    {imageUrl ? (
      <Image source={{uri: imageUrl}} style={styles.personImage} />
    ) : null}
    <Text numberOfLines={1} style={styles.personName}>
      {name}
    </Text>
    <Text numberOfLines={1} style={styles.personRole}>
      {role ?? 'Actor'}
    </Text>
  </FocusableItem>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
  },
  hero: {
    minHeight: 520,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.25,
  },
  heroContent: {
    flexDirection: 'row',
    padding: 72,
    gap: 36,
  },
  poster: {
    width: 250,
    height: 375,
    borderRadius: 8,
    backgroundColor: '#182027',
  },
  copy: {
    flex: 1,
    paddingTop: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 54,
    fontWeight: '800',
  },
  meta: {
    color: '#B8C5CC',
    fontSize: 24,
    marginTop: 10,
  },
  overview: {
    color: '#E4ECEF',
    fontSize: 26,
    lineHeight: 34,
    marginTop: 22,
  },
  genres: {
    color: '#89CFF0',
    fontSize: 22,
    marginTop: 18,
  },
  director: {
    color: '#B8C5CC',
    fontSize: 20,
    marginTop: 16,
  },
  error: {
    color: '#FFB4A8',
    fontSize: 22,
    marginTop: 16,
  },
  status: {
    color: '#B8C5CC',
    fontSize: 22,
    marginTop: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 28,
  },
  actionButton: {
    minWidth: 128,
    height: 58,
    borderRadius: 8,
    backgroundColor: '#25313A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionFocused: {
    backgroundColor: '#2E5A72',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 14,
    marginHorizontal: 72,
    marginTop: 8,
  },
  rowScroller: {
    marginBottom: 36,
    paddingHorizontal: 72,
  },
  row: {
    flexDirection: 'row',
    gap: 26,
  },
  personCard: {
    width: 170,
    borderRadius: 8,
    backgroundColor: '#182027',
    padding: 12,
  },
  personFocused: {
    backgroundColor: '#2E5A72',
  },
  personImage: {
    width: 146,
    height: 146,
    borderRadius: 8,
    backgroundColor: '#25313A',
    marginBottom: 10,
  },
  personName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  personRole: {
    color: '#B8C5CC',
    fontSize: 17,
    marginTop: 4,
  },
});
