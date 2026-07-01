import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {JellyfinMediaItem as MediaItem} from '../../services/jellyfin';

const formatRuntime = (ticks: number | null): string => {
  if (!ticks) {
    return '';
  }
  const totalMinutes = Math.floor(ticks / 600000000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const formatFileSize = (bytes: number | null): string => {
  if (!bytes) {
    return '';
  }
  return `${(bytes / 1073741824).toFixed(2)} GB`;
};

const formatBitrate = (bps: number | null): string => {
  if (!bps) {
    return '';
  }
  return `${(bps / 1000000).toFixed(1)} Mbps`;
};

const getResolutionLabel = (height: number | null): string => {
  if (!height) {
    return '';
  }
  if (height >= 2160) {
    return '4K';
  }
  if (height >= 1080) {
    return '1080p';
  }
  if (height >= 720) {
    return '720p';
  }
  return `${height}p`;
};

interface LibraryInfoPanelProps {
  item: MediaItem | null;
  serverUrl: string;
  accessToken: string;
}

export const LibraryInfoPanel = ({
  accessToken,
  item,
  serverUrl,
}: LibraryInfoPanelProps) => {
  if (!item) {
    return <View style={styles.empty} />;
  }

  const baseUrl = serverUrl.replace(/\/+$/, '');
  const imageUrl =
    item.backdropImageTags && item.backdropImageTags.length > 0
      ? `${baseUrl}/Items/${
          item.id
        }/Images/Backdrop?maxWidth=800&tag=${encodeURIComponent(
          item.backdropImageTags[0],
        )}&api_key=${encodeURIComponent(accessToken)}`
      : `${baseUrl}/Items/${
          item.id
        }/Images/Primary?maxWidth=400&api_key=${encodeURIComponent(
          accessToken,
        )}`;
  const metadata = [
    item.productionYear ? String(item.productionYear) : null,
    formatRuntime(item.runTimeTicks ?? null),
    item.officialRating ?? null,
  ].filter(Boolean);
  const director = item.people?.find(
    (person) => (person.Type ?? person.type) === 'Director',
  );
  const cast = (
    item.people
      ?.filter((person) => (person.Type ?? person.type) === 'Actor')
      .slice(0, 4)
      .map((person) => person.Name ?? person.name)
      .filter(Boolean) ?? []
  ).join(', ');
  const source = item.mediaSources?.[0];
  const videoStream = source?.MediaStreams?.find(
    (stream) => stream.Type === 'Video',
  );
  const audioStream = source?.MediaStreams?.find(
    (stream) => stream.Type === 'Audio',
  );
  const resolution = getResolutionLabel(videoStream?.Height ?? null);
  const videoCodec = videoStream?.Codec?.toUpperCase() ?? null;
  const audioLabel = audioStream
    ? `${audioStream.Codec?.toUpperCase()} ${
        audioStream.Channels ? `${audioStream.Channels}ch` : ''
      }`.trim()
    : null;
  const container = source?.Container?.toUpperCase() ?? null;
  const bitrate = formatBitrate(source?.Bitrate ?? null);
  const fileSize = formatFileSize(source?.Size ?? null);
  const fileCells = [
    {label: 'Quality', value: resolution},
    {label: 'Video Codec', value: videoCodec},
    {label: 'Audio', value: audioLabel},
    {label: 'Container', value: container},
    {label: 'Bitrate', value: bitrate},
    {label: 'File Size', value: fileSize},
  ].filter((cell) => cell.value);
  const isMovie = item.type === 'Movie';
  const isSeries = item.type === 'Series';

  return (
    <View style={styles.container}>
      <Image source={{uri: imageUrl}} style={styles.image} />
      <Text numberOfLines={2} style={styles.title}>
        {item.name}
      </Text>
      {metadata.length ? (
        <Text style={styles.metadata}>{metadata.join(' · ')}</Text>
      ) : null}
      {item.genres?.length ? (
        <View style={styles.genreRow}>
          {item.genres.slice(0, 4).map((genre) => (
            <View key={genre} style={styles.genreChip}>
              <Text style={styles.genreText}>{genre}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {item.communityRating !== null && item.communityRating !== undefined ? (
        <View style={styles.ratingRow}>
          <Text style={styles.star}>★</Text>
          <Text style={styles.ratingText}>
            {item.communityRating.toFixed(1)}/10
          </Text>
        </View>
      ) : null}
      {item.overview ? (
        <Text ellipsizeMode="tail" numberOfLines={6} style={styles.overview}>
          {item.overview}
        </Text>
      ) : null}
      {isMovie && director ? (
        <Text style={styles.personRow}>
          <Text style={styles.personLabel}>Director </Text>
          <Text style={styles.personName}>
            {director.Name ?? director.name}
          </Text>
        </Text>
      ) : null}
      {cast ? (
        <Text style={styles.castRow}>
          <Text style={styles.personLabel}>Cast </Text>
          <Text style={styles.personName}>{cast}</Text>
        </Text>
      ) : null}
      {isSeries && item.childCount !== null && item.childCount !== undefined ? (
        <Text style={styles.seriesSummary}>
          {item.childCount} Season{item.childCount !== 1 ? 's' : ''} ·{' '}
          {item.recursiveItemCount ?? 0} Episodes
        </Text>
      ) : null}
      {isMovie && source && fileCells.length ? (
        <>
          <View style={styles.divider} />
          <View style={styles.fileGrid}>
            {fileCells.map((cell) => (
              <View key={cell.label} style={styles.fileCell}>
                <Text style={styles.fileLabel}>{cell.label}</Text>
                <Text style={styles.fileValue}>{cell.value}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  empty: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingLeft: 24,
    paddingRight: 8,
    paddingTop: 16,
  },
  image: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 14,
  },
  metadata: {
    color: '#AAAAAA',
    fontSize: 13,
    marginTop: 6,
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  genreChip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    marginBottom: 4,
    marginRight: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  genreText: {
    color: '#CCCCCC',
    fontSize: 11,
  },
  ratingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 8,
  },
  star: {
    color: '#F5C518',
    fontSize: 14,
    marginRight: 5,
  },
  ratingText: {
    color: '#AAAAAA',
    fontSize: 13,
  },
  overview: {
    color: '#DDDDDD',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  personRow: {
    fontSize: 12,
    marginTop: 10,
  },
  castRow: {
    fontSize: 12,
    marginTop: 6,
  },
  personLabel: {
    color: '#AAAAAA',
  },
  personName: {
    color: '#FFFFFF',
  },
  seriesSummary: {
    color: '#AAAAAA',
    fontSize: 13,
    marginTop: 10,
  },
  divider: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    height: 1,
    marginBottom: 10,
    marginTop: 14,
  },
  fileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  fileCell: {
    marginBottom: 6,
    width: '50%',
  },
  fileLabel: {
    color: '#888888',
    fontSize: 11,
  },
  fileValue: {
    color: '#FFFFFF',
    fontSize: 12,
  },
});
