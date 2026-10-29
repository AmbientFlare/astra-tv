import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {JellyfinStreamInfo} from '../../services/jellyfin';
import {describeDecodeLimits} from '../../services/jellyfin/deviceProfile';
import {
  describeDeviceModel,
  knownDevice,
  readDeviceModel,
} from '../../services/deviceModel';
import {getTraces} from '../../services/logging/trace';
import {telemetryStatus} from '../../services/telemetry';
import {formatBufferingTime} from '../../services/playbackHealth';
import {APP_VERSION, BUILD_NUMBER} from '../../config/app';
import {
  formatDiagnosticCodec,
  formatDiagnosticKbps,
  formatDiagnosticMbps,
  formatDiagnosticTime,
  formatDropRatio,
} from './formatDiagnostics';
import type {PlaybackDebugInfo} from './types';

export const PlaybackStatsOverlay = ({
  diagnostics,
  positionSeconds,
  showTraces = false,
  streamInfo,
}: {
  diagnostics: PlaybackDebugInfo | null;
  positionSeconds: number;
  showTraces?: boolean;
  streamInfo: JellyfinStreamInfo;
}) => {
  const deliveredAudioIndex =
    streamInfo.deliveredAudioStreamIndex ?? streamInfo.audioStreamIndex;
  const audioTrack = streamInfo.audioTracks.find(
    (track) => track.index === deliveredAudioIndex,
  );
  const requestedAudioIndex = streamInfo.audioStreamIndex;
  const trackMatch = requestedAudioIndex === deliveredAudioIndex;
  const activeVideoWidth =
    diagnostics?.activeVideoWidth ??
    (streamInfo.videoDeliveryMethod === 'Copy' ? streamInfo.width : undefined);
  const activeVideoHeight =
    diagnostics?.activeVideoHeight ??
    (streamInfo.videoDeliveryMethod === 'Copy' ? streamInfo.height : undefined);
  const sourceResolution = `${streamInfo.width ?? '?'}x${
    streamInfo.height ?? '?'
  }`;
  const activeResolution = `${activeVideoWidth ?? '?'}x${
    activeVideoHeight ?? '?'
  }`;

  return (
    <View style={styles.statsOverlay} testID="player-stats-overlay">
      <Text style={styles.statsTitle}>Stats for Nerds</Text>
      <Text style={styles.statsLine}>{`Telemetry ${
        telemetryStatus().armed ? 'armed' : 'off'
      }  ${telemetryStatus().reason}  sent=${
        telemetryStatus().counters?.sent ?? 0
      } drop=${telemetryStatus().counters?.dropped ?? 0} fail=${
        telemetryStatus().counters?.failed ?? 0
      }`}</Text>
      <Text style={styles.statsLine}>
        Codec delivery is inferred from the server request.
      </Text>
      <Text style={styles.statsLine}>
        {`Position  ${formatDiagnosticTime(positionSeconds)}   Buffer  ${
          diagnostics?.bufferedAheadSeconds !== undefined
            ? `${diagnostics.bufferedAheadSeconds.toFixed(1)}s`
            : '—'
        }`}
      </Text>
      <Text style={styles.statsLine}>
        {`Buffer map  ranges ${
          diagnostics?.bufferedRangeCount ?? '—'
        }   total ahead ${
          diagnostics?.furthestBufferedAheadSeconds !== undefined
            ? `${diagnostics.furthestBufferedAheadSeconds.toFixed(1)}s`
            : '—'
        }   next gap ${
          diagnostics?.nextBufferedGapSeconds !== undefined
            ? `${diagnostics.nextBufferedGapSeconds.toFixed(3)}s`
            : '—'
        }`}
      </Text>
      <Text style={styles.statsLine}>
        {`Video  ${formatDiagnosticCodec(
          streamInfo.sourceVideoCodec,
        )} → ${formatDiagnosticCodec(
          streamInfo.outputVideoCodec ?? streamInfo.deliveredVideoCodec,
        )}   ${streamInfo.videoDeliveryMethod ?? 'Unknown'}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Resolution  source ${sourceResolution} → active ${activeResolution}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Audio  ${formatDiagnosticCodec(
          streamInfo.sourceAudioCodec ?? audioTrack?.codec,
          streamInfo.sourceAudioProfile ?? audioTrack?.profile,
        )} → ${formatDiagnosticCodec(
          streamInfo.outputAudioCodec ?? streamInfo.deliveredAudioCodec,
        )}   ${streamInfo.audioDeliveryMethod ?? 'Unknown'}   ${
          audioTrack?.channels ?? '?'
        } ch`}
      </Text>
      <Text style={styles.statsLine}>
        {`Audio rate  ${formatDiagnosticKbps(
          streamInfo.sourceAudioBitrate ?? audioTrack?.bitrate,
        )} → ${formatDiagnosticKbps(streamInfo.outputAudioBitrate)}   ${
          streamInfo.sourceAudioSampleRate ?? audioTrack?.sampleRate ?? '?'
        } Hz`}
      </Text>
      {streamInfo.audioOutputCapabilities ? (
        <Text style={styles.statsLine}>
          {`Audio sink  AC3 ${
            streamInfo.audioOutputCapabilities.ac3 ? 'yes' : 'no'
          }   EAC3 ${
            streamInfo.audioOutputCapabilities.eac3 ? 'yes' : 'no'
          }   Opus ${
            streamInfo.audioOutputCapabilities.opus ? 'yes' : 'no'
          }   MP3 ${
            streamInfo.audioOutputCapabilities.mp3 ? 'yes' : 'no'
          }   DTS ${
            streamInfo.audioOutputCapabilities.dtsDirectPlayVerified
              ? 'verified'
              : streamInfo.audioTranscodePolicy?.split(',').includes('dts')
              ? 'trial'
              : streamInfo.audioOutputCapabilities.dtsProbeSupported
              ? 'probe only'
              : 'no'
          }`}
        </Text>
      ) : null}
      <Text style={styles.statsLine}>
        {`Device  ${describeDeviceModel(readDeviceModel())}`}
      </Text>
      {streamInfo.videoDecodeLimits ? (
        <Text style={styles.statsLine}>
          {`Decoder  ${describeDecodeLimits(
            streamInfo.videoDecodeLimits,
            knownDevice(readDeviceModel().model).maxVideoWidth,
          )}`}
        </Text>
      ) : null}
      <Text style={styles.statsLine}>
        {`Audio policy  ${
          streamInfo.audioTranscodePolicy?.toUpperCase() ?? 'AAC'
        }`}
      </Text>
      <Text style={[styles.statsLine, !trackMatch && styles.statsWarning]}>
        {`Track  ${requestedAudioIndex ?? 'auto'} → ${
          deliveredAudioIndex ?? 'unknown'
        }${trackMatch ? '' : '  MISMATCH'}   ${
          audioTrack?.title ?? `Track ${deliveredAudioIndex ?? '?'}`
        }`}
      </Text>
      <Text style={styles.statsLine}>
        {`Container  ${
          streamInfo.sourceContainer?.toUpperCase() ??
          streamInfo.container?.toUpperCase() ??
          'UNKNOWN'
        } → HLS/${
          streamInfo.outputContainer?.toUpperCase() ?? 'UNKNOWN'
        }   Overall ${streamInfo.playMethod}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Delivery  HLS target ${
          streamInfo.hlsSegmentTargetSeconds !== undefined
            ? `${streamInfo.hlsSegmentTargetSeconds}s`
            : '—'
        }   min segments ${
          streamInfo.hlsMinimumSegmentCount ?? '—'
        }   Astra ${APP_VERSION} (${BUILD_NUMBER})`}
      </Text>
      <Text style={styles.statsLine}>
        {`Bandwidth  stream ${formatDiagnosticMbps(
          diagnostics?.streamBandwidth ?? streamInfo.bitrate,
        )}   network ${formatDiagnosticMbps(diagnostics?.estimatedBandwidth)}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Frames  dropped ${formatDropRatio(
          diagnostics?.decodedFrames,
          diagnostics?.droppedFrames,
        )}   Buffering time ${formatBufferingTime(
          diagnostics?.bufferingTimeSeconds,
        )}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Events  waiting ${diagnostics?.waitingEventCount ?? 0} / stalled ${
          diagnostics?.stalledEventCount ?? 0
        } / errors ${diagnostics?.errorEventCount ?? 0}   last ${
          diagnostics?.lastPlaybackEvent ?? '—'
        }${
          diagnostics?.lastPlaybackEventSeconds !== undefined
            ? ` @ ${formatDiagnosticTime(diagnostics.lastPlaybackEventSeconds)}`
            : ''
        }`}
      </Text>
      <Text style={styles.statsLine}>
        {`Shaka errors  ${diagnostics?.shakaErrorEventCount ?? 0}   ${
          diagnostics?.lastError ?? 'No recorded failure'
        }`}
      </Text>
      {streamInfo.transcodeReasons?.length ? (
        <Text style={styles.statsLine}>
          {`Server reason  ${streamInfo.transcodeReasons.join(', ')}`}
        </Text>
      ) : null}
      {/* Playback traces. JS console output reaches no artifact that
          `vega device copy-logs` can retrieve, so timings for the reload path
          have to be read here on the device. */}
      {(showTraces ? getTraces() : []).slice(-8).map((entry, index) => (
        <Text key={`${entry.label}-${index}`} style={styles.statsLine}>
          {`T+${(entry.sinceStartMs / 1000).toFixed(1)}s  ${entry.label}  ${
            entry.detail
          }`}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  statsOverlay: {
    position: 'absolute',
    right: 42,
    top: 34,
    width: 650,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.86)',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  statsTitle: {
    color: '#4CC9F0',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  statsLine: {
    color: '#FFFFFF',
    fontFamily: 'monospace',
    fontSize: 16,
    lineHeight: 23,
  },
  statsWarning: {
    color: '#FFB86C',
    fontWeight: '800',
  },
});
