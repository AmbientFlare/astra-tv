import React, {useEffect, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {MediaCard} from '../../components/MediaCard';
import {
  getEpisodes,
  getItemDetails,
  getSeasons,
  JellyfinMediaItem,
} from '../../services/jellyfin';
import {ServerProfile} from '../../services/storage';

interface ItemDetailScreenProps {
  item: JellyfinMediaItem;
  onBack?: () => void;
  onPlay?: (item: JellyfinMediaItem) => void;
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
  serverProfile,
}: ItemDetailScreenProps) => {
  const [detail, setDetail] = useState(item);
  const [seasons, setSeasons] = useState<JellyfinMediaItem[]>([]);
  const [episodes, setEpisodes] = useState<JellyfinMediaItem[]>([]);
  const [selectedSeason, setSelectedSeason] =
    useState<JellyfinMediaItem | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadDetail = async () => {
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
      }
    };

    loadDetail();

    return () => {
      mounted = false;
    };
  }, [item.id, serverProfile]);

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
            <TVFocusGuideView style={styles.actions}>
              {detail.type !== 'Series' ? (
                <FocusableItem
                  focusedStyle={styles.actionFocused}
                  hasTVPreferredFocus={true}
                  onPress={() => onPlay?.(detail)}
                  style={styles.actionButton}
                  testID="detail-play-button">
                  <Text style={styles.actionText}>
                    {detail.resumePositionTicks ? 'Resume' : 'Play'}
                  </Text>
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
                  onPress={() => onPlay?.(episode)}
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
    </ScrollView>
  );
};

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
  error: {
    color: '#FFB4A8',
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
});
