import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../FocusableItem';
import {JellyfinMediaSource} from '../../services/jellyfin';

interface MediaSourcePickerProps {
  onSelect: (mediaSourceId: string) => void;
  selectedMediaSourceId?: string;
  sources: JellyfinMediaSource[];
}

const formatBytes = (bytes?: number) =>
  bytes && bytes > 0 ? `${(bytes / 1073741824).toFixed(1)} GB` : undefined;

export const formatMediaSourceLabel = (
  source: JellyfinMediaSource,
  index: number,
) => {
  const video = source.MediaStreams?.find((stream) => stream.Type === 'Video');
  const height = source.Height ?? video?.Height;
  const bitrate = source.Bitrate
    ? `${Math.round(source.Bitrate / 1000000)} Mbps`
    : undefined;
  const name = source.Name?.replace(/\s+/g, ' ').trim();

  return [
    name || `Version ${index + 1}`,
    height ? `${height}p` : undefined,
    source.Container?.toUpperCase(),
    bitrate,
    formatBytes(source.Size),
  ]
    .filter(Boolean)
    .join(' · ');
};

export const MediaSourcePicker = ({
  onSelect,
  selectedMediaSourceId,
  sources,
}: MediaSourcePickerProps) => {
  const [visible, setVisible] = useState(false);
  const playableSources = useMemo(
    () =>
      sources.filter(
        (source, index, all) =>
          source.Id &&
          all.findIndex((candidate) => candidate.Id === source.Id) === index,
      ),
    [sources],
  );

  if (playableSources.length < 2) {
    return null;
  }

  const selectedIndex = Math.max(
    0,
    playableSources.findIndex((source) => source.Id === selectedMediaSourceId),
  );

  return (
    <View style={styles.container} testID="media-source-picker">
      <FocusableItem
        focusedStyle={styles.buttonFocused}
        onPress={() => setVisible((current) => !current)}
        style={styles.button}
        testID="media-source-picker-button">
        <Text style={styles.buttonText}>
          Version ·{' '}
          {formatMediaSourceLabel(
            playableSources[selectedIndex],
            selectedIndex,
          )}
        </Text>
      </FocusableItem>
      {visible ? (
        <View style={styles.menu} testID="media-source-picker-menu">
          {playableSources.map((source, index) => (
            <FocusableItem
              focusedStyle={styles.optionFocused}
              key={source.Id}
              onPress={() => {
                if (source.Id) {
                  onSelect(source.Id);
                  setVisible(false);
                }
              }}
              style={[
                styles.option,
                source.Id === selectedMediaSourceId && styles.optionSelected,
              ]}
              testID={`media-source-option-${source.Id}`}>
              <Text style={styles.optionText}>
                {formatMediaSourceLabel(source, index)}
              </Text>
            </FocusableItem>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {alignItems: 'flex-start', marginTop: 12, maxWidth: 980},
  button: {
    backgroundColor: '#25313B',
    borderRadius: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonFocused: {backgroundColor: '#7A5AF8'},
  buttonText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  menu: {gap: 8, marginTop: 8, width: 900},
  option: {
    backgroundColor: '#172129',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionFocused: {backgroundColor: '#7A5AF8'},
  optionSelected: {borderColor: '#9D86FF', borderWidth: 2},
  optionText: {color: '#fff', fontSize: 17},
});
