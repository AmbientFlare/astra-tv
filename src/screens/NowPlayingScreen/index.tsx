import React, {useEffect, useMemo, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {TrackRow} from '../../components/TrackRow';
import {TVTextInput} from '../../components/TVTextInput';
import {useRemoteInput} from '../../hooks/useRemoteInput';
import {audioPlayback, PlaybackStatus} from '../../services/audioPlayer';
import {orderedTracks} from '../../services/audioQueue';
import {createMusicPlaylist} from '../../services/jellyfin/music';
import {ServerProfile} from '../../services/storage';
import {formatSeconds} from '../../utils/duration';

interface NowPlayingScreenProps {
  onBack: () => void;
  serverProfile: ServerProfile | null;
}

const defaultPlaylistName = () => {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  return `Astra Queue ${stamp}`;
};

export const NowPlayingScreen = ({
  onBack,
  serverProfile,
}: NowPlayingScreenProps) => {
  const [status, setStatus] = useState<PlaybackStatus>(
    audioPlayback.getStatus(),
  );
  const [selectedPosition, setSelectedPosition] = useState(status.queue.cursor);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [saveVisible, setSaveVisible] = useState(false);
  const [playlistName, setPlaylistName] = useState(defaultPlaylistName);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const tracks = useMemo(() => orderedTracks(status.queue), [status.queue]);

  useEffect(() => audioPlayback.subscribe(setStatus), []);

  useRemoteInput(
    (action) => {
      if (action === 'back') {
        if (actionsVisible) {
          setActionsVisible(false);
        } else if (saveVisible) {
          setSaveVisible(false);
        } else {
          onBack();
        }
      } else if (action === 'menu' && tracks.length) {
        if (saveVisible) {
          setSaveVisible(false);
        } else {
          setActionsVisible((visible) => !visible);
        }
      }
    },
    {
      enabled: !actionsVisible && !saveVisible,
      allowWhileDisabled: ['back', 'menu'],
    },
  );

  const selectedTrack = tracks[selectedPosition];
  const current = status.track;
  const savePlaylist = async () => {
    if (!serverProfile) {
      setSaveStatus('No Jellyfin server is active.');
      return;
    }

    setSaving(true);
    setSaveStatus(null);
    try {
      await createMusicPlaylist(
        {
          accessToken: serverProfile.accessToken,
          serverUrl: serverProfile.serverUrl,
          userId: serverProfile.userId,
        },
        playlistName,
        tracks,
      );
      setSaveStatus(`Saved “${playlistName.trim()}” to Jellyfin.`);
      setSaveVisible(false);
    } catch (error) {
      setSaveStatus(
        error instanceof Error ? error.message : 'Unable to save playlist.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root} testID="now-playing-screen">
      <View style={styles.hero}>
        {current?.imageUrl ? (
          <Image source={{uri: current.imageUrl}} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.placeholder]} />
        )}
        <View style={styles.summary}>
          <Text style={styles.eyebrow}>NOW PLAYING</Text>
          <Text numberOfLines={2} style={styles.title}>
            {current?.name ?? 'Nothing playing'}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {[current?.artistName, current?.albumName]
              .filter(Boolean)
              .join('  ·  ')}
          </Text>
          <Text style={styles.time}>
            {formatSeconds(status.positionSeconds)} /{' '}
            {formatSeconds(status.durationSeconds)}
          </Text>
          <TVFocusGuideView style={styles.controls}>
            <Action
              label="Previous"
              onPress={() => audioPlayback.skipPrevious()}
            />
            <Action
              label={status.isPlaying ? 'Pause' : 'Play'}
              onPress={() => audioPlayback.togglePlayPause()}
            />
            <Action label="Next" onPress={() => audioPlayback.next()} />
            <Action
              label={status.queue.shuffle ? 'Shuffle on' : 'Shuffle'}
              onPress={() => audioPlayback.toggleShuffle()}
            />
            <Action
              label={`Repeat ${status.queue.repeat}`}
              onPress={() => audioPlayback.cycleRepeat()}
            />
            <Action
              label="Clear queue"
              onPress={() => {
                audioPlayback.clearQueue();
                setSelectedPosition(0);
                setSaveStatus('Queue cleared; the current song was kept.');
              }}
            />
            <Action
              label="Save as playlist"
              onPress={() => {
                setSaveStatus(null);
                setSaveVisible(true);
              }}
            />
            <Action label="Back" onPress={onBack} />
          </TVFocusGuideView>
        </View>
      </View>

      <Text style={styles.queueTitle}>Queue · {tracks.length} tracks</Text>
      {saveStatus ? <Text style={styles.status}>{saveStatus}</Text> : null}
      <ScrollView style={styles.queue}>
        {tracks.map((track, position) => (
          <TrackRow
            hasTVPreferredFocus={position === status.queue.cursor}
            isPlaying={position === status.queue.cursor}
            key={`${track.id}-${position}`}
            onFocus={() => setSelectedPosition(position)}
            onPress={() => audioPlayback.playAtPosition(position)}
            position={position + 1}
            showArtist={true}
            track={track}
          />
        ))}
      </ScrollView>

      {actionsVisible && selectedTrack ? (
        <View style={styles.actionPanel}>
          <Text numberOfLines={1} style={styles.actionTitle}>
            {selectedTrack.name}
          </Text>
          <Text style={styles.actionHint}>Queue actions</Text>
          <Action
            label="Play now"
            onPress={() => {
              setActionsVisible(false);
              audioPlayback.playAtPosition(selectedPosition);
            }}
          />
          <Action
            label="Remove from queue"
            onPress={() => {
              audioPlayback.removeFromQueue(selectedPosition);
              setSelectedPosition((position) =>
                Math.max(0, Math.min(position, tracks.length - 2)),
              );
              setActionsVisible(false);
            }}
          />
          <Action label="Cancel" onPress={() => setActionsVisible(false)} />
        </View>
      ) : null}

      {saveVisible ? (
        <View style={styles.saveBackdrop}>
          <View style={styles.savePanel}>
            <Text style={styles.saveTitle}>Save queue as playlist</Text>
            <Text style={styles.saveHint}>
              This creates a reusable playlist on your Jellyfin server.
            </Text>
            <TVTextInput
              autoCorrect={false}
              auxOptions="title:Playlist name"
              focusedContainerStyle={styles.nameFocused}
              hasTVPreferredFocus={true}
              onChangeText={setPlaylistName}
              placeholder="Playlist name"
              style={styles.nameInput}
              testID="playlist-name-input"
              value={playlistName}
            />
            <View style={styles.saveActions}>
              <Action
                label={isSaving ? 'Saving…' : 'Save playlist'}
                onPress={isSaving ? () => {} : savePlaylist}
              />
              <Action label="Cancel" onPress={() => setSaveVisible(false)} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const Action = ({label, onPress}: {label: string; onPress: () => void}) => (
  <FocusableItem
    focusedStyle={styles.controlFocused}
    onPress={onPress}
    style={styles.control}>
    <Text style={styles.controlText}>{label}</Text>
  </FocusableItem>
);

const styles = StyleSheet.create({
  root: {backgroundColor: '#090c10', flex: 1, padding: 28},
  hero: {flexDirection: 'row'},
  art: {borderRadius: 12, height: 270, width: 270},
  placeholder: {backgroundColor: '#1d2530'},
  summary: {flex: 1, justifyContent: 'center', paddingLeft: 34},
  eyebrow: {color: '#54d38a', fontSize: 15, fontWeight: '800'},
  title: {color: '#f4f6f8', fontSize: 44, fontWeight: '800', marginTop: 8},
  subtitle: {color: '#a8b4c0', fontSize: 22, marginTop: 8},
  time: {color: '#6f7d8c', fontSize: 17, marginTop: 12},
  controls: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 18},
  control: {
    borderRadius: 8,
    marginRight: 10,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  controlFocused: {backgroundColor: '#54d38a'},
  controlText: {color: '#f4f6f8', fontSize: 17, fontWeight: '700'},
  queueTitle: {
    color: '#f4f6f8',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 24,
  },
  queue: {flex: 1},
  actionPanel: {
    backgroundColor: '#151b22',
    borderColor: '#2a3540',
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    position: 'absolute',
    right: 36,
    top: 190,
    width: 360,
  },
  actionTitle: {color: '#fff', fontSize: 24, fontWeight: '700'},
  actionHint: {color: '#8b97a5', fontSize: 16, marginBottom: 14, marginTop: 4},
  status: {color: '#54d38a', fontSize: 16, marginBottom: 6},
  saveBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1600,
  },
  savePanel: {
    backgroundColor: '#151b22',
    borderColor: '#354351',
    borderRadius: 14,
    borderWidth: 1,
    padding: 28,
    width: 650,
  },
  saveTitle: {color: '#f4f6f8', fontSize: 30, fontWeight: '800'},
  saveHint: {color: '#8b97a5', fontSize: 16, marginBottom: 20, marginTop: 8},
  nameInput: {
    backgroundColor: '#090c10',
    borderColor: '#354351',
    borderRadius: 8,
    borderWidth: 2,
    padding: 14,
  },
  nameFocused: {borderColor: '#54d38a'},
  saveActions: {flexDirection: 'row', marginTop: 16},
});
