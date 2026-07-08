import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../FocusableItem';
import {
  JellyfinMediaStream,
  PlaybackTrackSelection,
} from '../../services/jellyfin';
import {
  readPlaybackPreferences,
  writePlaybackPreferences,
} from '../../services/storage';

interface PlaybackTrackSelectorsProps {
  audioStreamIndex?: number;
  mediaStreams?: JellyfinMediaStream[];
  onChange: (selection: PlaybackTrackSelection) => void;
  subtitleStreamIndex?: number;
}

const normalizeLanguage = (language?: string) =>
  language?.trim().toLowerCase().split('-')[0];

const languageAliases: Record<string, string[]> = {
  de: ['de', 'deu', 'ger', 'german'],
  deu: ['de', 'deu', 'ger', 'german'],
  en: ['en', 'eng', 'english'],
  eng: ['en', 'eng', 'english'],
  es: ['es', 'spa', 'spanish'],
  spa: ['es', 'spa', 'spanish'],
  fr: ['fr', 'fra', 'fre', 'french'],
  fra: ['fr', 'fra', 'fre', 'french'],
  it: ['it', 'ita', 'italian'],
  ita: ['it', 'ita', 'italian'],
  ja: ['ja', 'jpn', 'japanese'],
  jpn: ['ja', 'jpn', 'japanese'],
  ko: ['ko', 'kor', 'korean'],
  kor: ['ko', 'kor', 'korean'],
  pt: ['pt', 'por', 'portuguese'],
  por: ['pt', 'por', 'portuguese'],
};

const matchesLanguage = (track: JellyfinMediaStream, language: string) => {
  const normalizedTarget = normalizeLanguage(language);
  const normalizedTrack = normalizeLanguage(track.language);

  if (!normalizedTarget) {
    return false;
  }
  const targets = languageAliases[normalizedTarget] ?? [normalizedTarget];

  return (
    (normalizedTrack !== undefined && targets.includes(normalizedTrack)) ||
    targets.some((target) => track.displayTitle?.toLowerCase().includes(target))
  );
};

const labelForTrack = (track: JellyfinMediaStream) =>
  [
    track.displayTitle,
    track.language?.toUpperCase(),
    track.codec?.toUpperCase(),
    track.channels ? `${track.channels}ch` : undefined,
  ]
    .filter(Boolean)
    .join(' / ') || 'Default';

const selectPreferredTrack = (
  tracks: JellyfinMediaStream[],
  preferredLanguage: string,
) =>
  tracks.find((track) => matchesLanguage(track, preferredLanguage)) ??
  tracks.find((track) => track.isDefault) ??
  tracks[0];

export const PlaybackTrackSelectors = ({
  audioStreamIndex,
  mediaStreams,
  onChange,
  subtitleStreamIndex,
}: PlaybackTrackSelectorsProps) => {
  const audioTracks = useMemo(
    () => mediaStreams?.filter((stream) => stream.type === 'Audio') ?? [],
    [mediaStreams],
  );
  const subtitleTracks = useMemo(
    () => mediaStreams?.filter((stream) => stream.type === 'Subtitle') ?? [],
    [mediaStreams],
  );
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<
    number | undefined
  >(audioStreamIndex);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<
    number | undefined
  >(subtitleStreamIndex);
  const [audioOpen, setAudioOpen] = useState(false);
  const [subtitleOpen, setSubtitleOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    readPlaybackPreferences().then((preferences) => {
      if (!mounted) {
        return;
      }

      const preferredAudio = selectPreferredTrack(
        audioTracks,
        preferences.preferredAudioLanguage,
      );
      const preferredSubtitle =
        preferences.subtitleMode === 'alwaysOn'
          ? selectPreferredTrack(
              subtitleTracks,
              preferences.preferredSubtitleLanguage,
            )
          : undefined;
      const nextAudioIndex = audioStreamIndex ?? preferredAudio?.index;
      const nextSubtitleIndex =
        subtitleStreamIndex ??
        (preferences.subtitleMode === 'alwaysOn'
          ? preferredSubtitle?.index
          : undefined);

      setSelectedAudioIndex(nextAudioIndex);
      setSelectedSubtitleIndex(nextSubtitleIndex);
      onChange({
        audioStreamIndex: nextAudioIndex,
        subtitleStreamIndex: nextSubtitleIndex,
      });
    });

    return () => {
      mounted = false;
    };
  }, [
    audioStreamIndex,
    audioTracks,
    onChange,
    subtitleStreamIndex,
    subtitleTracks,
  ]);

  const selectedAudio = audioTracks.find(
    (track) => track.index === selectedAudioIndex,
  );
  const selectedSubtitle = subtitleTracks.find(
    (track) => track.index === selectedSubtitleIndex,
  );

  const chooseAudio = (track: JellyfinMediaStream) => {
    setSelectedAudioIndex(track.index);
    setAudioOpen(false);
    onChange({
      audioStreamIndex: track.index,
      subtitleStreamIndex: selectedSubtitleIndex,
    });
  };

  const chooseSubtitle = (track?: JellyfinMediaStream) => {
    const nextSubtitleIndex = track?.index;

    setSelectedSubtitleIndex(nextSubtitleIndex);
    setSubtitleOpen(false);
    onChange({
      audioStreamIndex: selectedAudioIndex,
      subtitleStreamIndex: nextSubtitleIndex,
    });
    writePlaybackPreferences({
      preferredSubtitleLanguage: track?.language ?? 'en',
      subtitleMode: track ? 'alwaysOn' : 'alwaysOff',
    }).catch((error) => {
      console.warn('Unable to save subtitle preference', error);
    });
  };

  if (!audioTracks.length && !subtitleTracks.length) {
    return null;
  }

  return (
    <View style={styles.wrapper}>
      {audioTracks.length ? (
        <View style={styles.selector}>
          <Text style={styles.label}>Audio</Text>
          <FocusableItem
            focusedStyle={styles.buttonFocused}
            onPress={() => setAudioOpen((open) => !open)}
            style={styles.button}
            testID="preplay-audio-selector">
            <Text numberOfLines={1} style={styles.buttonText}>
              {selectedAudio ? labelForTrack(selectedAudio) : 'Default'}
            </Text>
          </FocusableItem>
          {audioOpen ? (
            <View style={styles.menu}>
              {audioTracks.map((track) => (
                <FocusableItem
                  focusedStyle={styles.menuItemFocused}
                  key={`audio-${track.index ?? track.displayTitle}`}
                  onPress={() => chooseAudio(track)}
                  style={[
                    styles.menuItem,
                    track.index === selectedAudioIndex && styles.menuSelected,
                  ]}>
                  <Text numberOfLines={1} style={styles.menuText}>
                    {labelForTrack(track)}
                  </Text>
                </FocusableItem>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {subtitleTracks.length ? (
        <View style={styles.selector}>
          <Text style={styles.label}>Captions</Text>
          <FocusableItem
            focusedStyle={styles.buttonFocused}
            onPress={() => setSubtitleOpen((open) => !open)}
            style={styles.button}
            testID="preplay-subtitle-selector">
            <Text numberOfLines={1} style={styles.buttonText}>
              {selectedSubtitle ? labelForTrack(selectedSubtitle) : 'Off'}
            </Text>
          </FocusableItem>
          {subtitleOpen ? (
            <View style={styles.menu}>
              <FocusableItem
                focusedStyle={styles.menuItemFocused}
                onPress={() => chooseSubtitle()}
                style={[
                  styles.menuItem,
                  selectedSubtitleIndex === undefined && styles.menuSelected,
                ]}>
                <Text style={styles.menuText}>Off</Text>
              </FocusableItem>
              {subtitleTracks.map((track) => (
                <FocusableItem
                  focusedStyle={styles.menuItemFocused}
                  key={`subtitle-${track.index ?? track.displayTitle}`}
                  onPress={() => chooseSubtitle(track)}
                  style={[
                    styles.menuItem,
                    track.index === selectedSubtitleIndex &&
                      styles.menuSelected,
                  ]}>
                  <Text numberOfLines={1} style={styles.menuText}>
                    {labelForTrack(track)}
                  </Text>
                </FocusableItem>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 22,
  },
  selector: {
    width: 300,
  },
  label: {
    color: '#9FB0BA',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#18242C',
    borderColor: '#314350',
    borderRadius: 8,
    borderWidth: 2,
    height: 54,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonFocused: {
    backgroundColor: '#2E5A72',
    borderColor: '#89CFF0',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  menu: {
    backgroundColor: '#101820',
    borderColor: '#314350',
    borderRadius: 8,
    borderWidth: 2,
    marginTop: 8,
    maxHeight: 260,
    padding: 6,
  },
  menuItem: {
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  menuItemFocused: {
    backgroundColor: '#2E5A72',
  },
  menuSelected: {
    backgroundColor: '#25313A',
  },
  menuText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
});
