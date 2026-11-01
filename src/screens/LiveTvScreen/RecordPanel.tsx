import React from 'react';
import {
  formatClockTime,
  LiveTvChannel,
  LiveTvProgram,
} from '../../services/jellyfin/liveTv';
import {t} from '../../i18n';
import {ActionPanel} from './ActionPanel';

export type RecordAction =
  | 'record'
  | 'recordSeries'
  | 'cancel'
  | 'cancelSeries'
  | 'watch';

interface Props {
  channel: LiveTvChannel;
  /** Resolves once the server has the change; rejects if it refused. */
  onAction: (action: RecordAction) => Promise<void>;
  onClose: () => void;
  program: LiveTvProgram;
}

/**
 * Opened from a guide programme that has not started, like the programme page
 * in Jellyfin's web client: record this airing or the whole series, or watch
 * the channel now.
 */
export const RecordPanel = ({channel, onAction, onClose, program}: Props) => {
  const actions: RecordAction[] = [
    program.timerId ? 'cancel' : 'record',
    ...(program.isSeries || program.seriesTimerId
      ? [program.seriesTimerId ? 'cancelSeries' : 'recordSeries']
      : []),
    'watch',
  ] as RecordAction[];

  return (
    <ActionPanel
      actions={actions.map((key) => ({
        key,
        label: t(`liveTv.record.${key}`),
      }))}
      meta={[
        `${formatClockTime(program.startTime)} – ${formatClockTime(
          program.endTime,
        )}`,
        program.episodeTitle ?? '',
        [channel.number, channel.name].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join('  ·  ')}
      onAction={onAction}
      onClose={onClose}
      overview={program.overview}
      status={
        program.timerId
          ? t('liveTv.record.scheduled')
          : program.seriesTimerId
          ? t('liveTv.record.seriesScheduled')
          : undefined
      }
      testID="livetv-record"
      title={program.name}
    />
  );
};
