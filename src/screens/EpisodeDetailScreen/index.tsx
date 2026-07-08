import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {MediaCard} from '../../components/MediaCard';
import {PlaybackTrackSelectors} from '../../components/PlaybackTrackSelectors';
import {
  getEpisodes,
  getItemDetails,
  JellyfinMediaItem,
  PlaybackTrackSelection,
  setFavorite,
  setPlayed,
} from '../../services/jellyfin';
import {ServerProfile} from '../../services/storage';

const TICKS_PER_SECOND = 10000000;

interface EpisodeDetailScreenProps {
  item: JellyfinMediaItem;
  onBack?: () => void;
  onGoToSeries?: (item: JellyfinMediaItem) => void;
  onPlay?: (
    item: JellyfinMediaItem,
    selection?: PlaybackTrackSelection,
  ) => void;
  onSelectEpisode?: (item: JellyfinMediaItem) => void;
  onSelectPerson?: (personId: string, personName?: string) => void;
  serverProfile: ServerProfile;
}

const formatRuntime = (ticks?: number) => {
  if (!ticks) {
    return null;
  }

  const minutes = Math.round(ticks / TICKS_PER_SECOND / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return hours > 0 ? `${hours}h ${remainder}m` : `${minutes}m`;
};

const formatDate = (dateText?: string) => {
  if (!dateText) {
    return null;
  }

  const date = new Date(dateText);

  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
};

const formatEndsAt = (ticks?: number) => {
  if (!ticks) {
    return null;
  }

  const end = new Date(Date.now() + (ticks / TICKS_PER_SECOND) * 1000);

  return end.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
};

const audioLayout = (channels?: number) => {
  if (!channels) {
    return null;
  }

  if (channels >= 8) {
    return '7.1';
  }

  if (channels >= 6) {
    return '5.1';
  }

  return channels === 2 ? 'Stereo' : `${channels}ch`;
};

export const EpisodeDetailScreen = ({
  item,
  onBack,
  onGoToSeries,
  onPlay,
  onSelectEpisode,
  onSelectPerson,
  serverProfile,
}: EpisodeDetailScreenProps) => {
  const [detail, setDetail] = useState(item);
  const [seasonEpisodes, setSeasonEpisodes] = useState<JellyfinMediaItem[]>([]);
  const [seriesItem, setSeriesItem] = useState<JellyfinMediaItem | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isUpdatingUserData, setUpdatingUserData] = useState(false);
  const [trackSelection, setTrackSelection] = useState<PlaybackTrackSelection>(
    {},
  );

  const loadDetail = useCallback(
    async (mounted = true) => {
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

        if (result.seriesId && result.parentId) {
          const episodes = await getEpisodes(
            serverProfile.serverUrl,
            serverProfile.accessToken,
            serverProfile.userId,
            result.seriesId,
            result.parentId,
          );

          if (mounted) {
            setSeasonEpisodes(episodes);
          }
        }

        if (result.seriesId) {
          const series = await getItemDetails(
            serverProfile.serverUrl,
            serverProfile.accessToken,
            serverProfile.userId,
            result.seriesId,
          );

          if (mounted) {
            setSeriesItem(series);
          }
        }
      } catch (error) {
        if (mounted) {
          setErrorText(
            error instanceof Error
              ? error.message
              : 'Unable to load episode details.',
          );
        }
      }
    },
    [item.id, serverProfile],
  );

  useEffect(() => {
    let mounted = true;

    loadDetail(mounted);

    return () => {
      mounted = false;
    };
  }, [loadDetail]);

  const currentEpisodeIndex = seasonEpisodes.findIndex(
    (episode) => episode.id === detail.id,
  );
  const previousEpisode =
    currentEpisodeIndex > 0 ? seasonEpisodes[currentEpisodeIndex - 1] : null;
  const nextEpisode =
    currentEpisodeIndex >= 0 && currentEpisodeIndex < seasonEpisodes.length - 1
      ? seasonEpisodes[currentEpisodeIndex + 1]
      : null;
  const videoStream = detail.mediaStreams?.find(
    (stream) => stream.type === 'Video',
  );
  const audioStream = detail.mediaStreams?.find(
    (stream) => stream.type === 'Audio',
  );
  const badges = [
    videoStream?.height ? `${videoStream.height}p` : null,
    videoStream?.codec?.toUpperCase(),
    audioStream?.codec?.toUpperCase(),
    audioLayout(audioStream?.channels),
  ].filter(Boolean);
  const meta = [
    detail.officialRating,
    detail.parentIndexNumber && detail.indexNumber
      ? `S${detail.parentIndexNumber}:E${detail.indexNumber}`
      : null,
    formatDate(detail.premiereDate),
  ].filter(Boolean);
  const guestStars = useMemo(
    () =>
      detail.people?.filter(
        (person) => person.type === 'GuestStar' && person.id,
      ) ?? [],
    [detail.people],
  );

  const updateFavorite = async () => {
    const nextValue = !detail.isFavorite;
    setUpdatingUserData(true);
    setDetail((current) => ({...current, isFavorite: nextValue}));

    try {
      await setFavorite(
        serverProfile.serverUrl,
        serverProfile.accessToken,
        serverProfile.userId,
        detail.id,
        nextValue,
      );
    } catch {
      setDetail((current) => ({...current, isFavorite: !nextValue}));
    } finally {
      setUpdatingUserData(false);
    }
  };

  const updatePlayed = async () => {
    const nextValue = !detail.isPlayed;
    setUpdatingUserData(true);
    setDetail((current) => ({...current, isPlayed: nextValue}));

    try {
      await setPlayed(
        serverProfile.serverUrl,
        serverProfile.accessToken,
        serverProfile.userId,
        detail.id,
        nextValue,
      );
    } catch {
      setDetail((current) => ({...current, isPlayed: !nextValue}));
    } finally {
      setUpdatingUserData(false);
    }
  };

  return (
    <ScrollView style={styles.screen} testID="episode-detail-screen">
      <View style={styles.hero}>
        {detail.backdropUrl || detail.imageUrl ? (
          <Image
            source={{uri: detail.backdropUrl ?? detail.imageUrl}}
            style={styles.backdrop}
          />
        ) : null}
        <View style={styles.heroShade} />
        <View style={styles.heroContent}>
          <Text style={styles.seriesName}>
            {detail.seriesName ?? 'Episode'}
          </Text>
          <Text style={styles.title}>{detail.name}</Text>
          <Text style={styles.meta}>{meta.join('  |  ')}</Text>
          {badges.length ? (
            <View style={styles.badges}>
              {badges.map((badge) => (
                <Text key={badge} style={styles.badge}>
                  {badge}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={styles.meta}>
            {[
              detail.genres?.join(' / '),
              formatRuntime(detail.runTimeTicks),
              formatEndsAt(detail.runTimeTicks)
                ? `Ends at ${formatEndsAt(detail.runTimeTicks)}`
                : null,
            ]
              .filter(Boolean)
              .join('  |  ')}
          </Text>
          <Text numberOfLines={5} style={styles.overview}>
            {detail.overview ?? 'No synopsis available.'}
          </Text>
          {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
          <TVFocusGuideView style={styles.actions}>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              hasTVPreferredFocus={true}
              onPress={() => onPlay?.(detail, trackSelection)}
              style={styles.actionButton}
              testID="episode-play-button">
              <Text style={styles.actionText}>Play</Text>
            </FocusableItem>
            <FocusableItem
              disabled={isUpdatingUserData}
              focusedStyle={styles.actionFocused}
              onPress={updatePlayed}
              style={styles.actionButton}
              testID="episode-watched-button">
              <Text style={styles.actionText}>
                {detail.isPlayed ? 'Unwatched' : 'Watched'}
              </Text>
            </FocusableItem>
            <FocusableItem
              disabled={isUpdatingUserData}
              focusedStyle={styles.actionFocused}
              onPress={updateFavorite}
              style={styles.actionButton}
              testID="episode-favorite-button">
              <Text style={styles.actionText}>
                {detail.isFavorite ? 'Unfavorite' : 'Favorite'}
              </Text>
            </FocusableItem>
            {previousEpisode ? (
              <FocusableItem
                focusedStyle={styles.actionFocused}
                onPress={() => onSelectEpisode?.(previousEpisode)}
                style={styles.actionButton}
                testID="episode-previous-button">
                <Text style={styles.actionText}>Previous</Text>
              </FocusableItem>
            ) : null}
            {seriesItem ? (
              <FocusableItem
                focusedStyle={styles.actionFocused}
                onPress={() => onGoToSeries?.(seriesItem)}
                style={styles.actionButton}
                testID="episode-series-button">
                <Text style={styles.actionText}>Go to Series</Text>
              </FocusableItem>
            ) : null}
            <FocusableItem
              focusedStyle={styles.actionFocused}
              onPress={onBack}
              style={styles.actionButton}
              testID="episode-back-button">
              <Text style={styles.actionText}>Back</Text>
            </FocusableItem>
          </TVFocusGuideView>
          <PlaybackTrackSelectors
            audioStreamIndex={trackSelection.audioStreamIndex}
            mediaStreams={detail.mediaStreams}
            onChange={setTrackSelection}
            subtitleStreamIndex={trackSelection.subtitleStreamIndex}
          />
        </View>
      </View>

      {nextEpisode ? (
        <>
          <Text style={styles.sectionTitle}>Next Episode</Text>
          <ScrollView horizontal={true} style={styles.rowScroller}>
            <TVFocusGuideView style={styles.row}>
              <MediaCard
                imageUrl={nextEpisode.imageUrl}
                onPress={() => onSelectEpisode?.(nextEpisode)}
                subtitle={
                  nextEpisode.indexNumber
                    ? `Episode ${nextEpisode.indexNumber}`
                    : 'Episode'
                }
                title={nextEpisode.name}
              />
            </TVFocusGuideView>
          </ScrollView>
        </>
      ) : null}

      {guestStars.length ? (
        <>
          <Text style={styles.sectionTitle}>Guest Stars</Text>
          <ScrollView horizontal={true} style={styles.rowScroller}>
            <TVFocusGuideView style={styles.row}>
              {guestStars.map((person) => (
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

      {detail.chapters?.length ? (
        <>
          <Text style={styles.sectionTitle}>Chapters</Text>
          <ScrollView horizontal={true} style={styles.rowScroller}>
            <TVFocusGuideView style={styles.row}>
              {detail.chapters.map((chapter, index) => (
                <FocusableItem
                  focusedStyle={styles.chapterFocused}
                  key={`${chapter.startPositionTicks}-${index}`}
                  onPress={() =>
                    onPlay?.(
                      {
                        ...detail,
                        resumePositionTicks: chapter.startPositionTicks,
                      },
                      trackSelection,
                    )
                  }
                  style={styles.chapterCard}
                  testID={`episode-chapter-${index}`}>
                  <Image
                    source={{
                      uri: `${serverProfile.serverUrl}/Items/${detail.id}/Images/Chapter/${index}?api_key=${serverProfile.accessToken}`,
                    }}
                    style={styles.chapterImage}
                  />
                  <Text numberOfLines={1} style={styles.chapterTitle}>
                    {chapter.name}
                  </Text>
                </FocusableItem>
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
    testID={`episode-person-${name}`}>
    {imageUrl ? (
      <Image source={{uri: imageUrl}} style={styles.personImage} />
    ) : null}
    <Text numberOfLines={1} style={styles.personName}>
      {name}
    </Text>
    <Text numberOfLines={1} style={styles.personRole}>
      {role ?? 'Guest Star'}
    </Text>
  </FocusableItem>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
  },
  hero: {
    minHeight: 560,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12,17,22,0.62)',
  },
  heroContent: {
    paddingHorizontal: 72,
    paddingTop: 70,
    paddingBottom: 34,
  },
  seriesName: {
    color: '#9FB0BA',
    fontSize: 26,
    fontWeight: '700',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 56,
    fontWeight: '800',
    marginTop: 8,
  },
  meta: {
    color: '#B8C5CC',
    fontSize: 23,
    marginTop: 12,
  },
  badges: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  badge: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    backgroundColor: '#24313A',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  overview: {
    color: '#E4ECEF',
    fontSize: 25,
    lineHeight: 34,
    marginTop: 22,
    maxWidth: 980,
  },
  error: {
    color: '#FFB4A8',
    fontSize: 22,
    marginTop: 16,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 28,
  },
  actionButton: {
    minWidth: 128,
    height: 58,
    borderRadius: 8,
    backgroundColor: '#25313A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  actionFocused: {
    backgroundColor: '#2E5A72',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
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
  chapterCard: {
    width: 260,
    borderRadius: 8,
    backgroundColor: '#182027',
    overflow: 'hidden',
  },
  chapterFocused: {
    backgroundColor: '#2E5A72',
  },
  chapterImage: {
    width: 260,
    height: 146,
    backgroundColor: '#25313A',
  },
  chapterTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    padding: 12,
  },
});
