import React, {useCallback, useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {
  syncPlay,
  type SyncPlayAccess,
  type SyncPlayGroupInfo,
  type SyncPlayGroupState,
} from '../../services/syncPlay';
import {MessageKey, t} from '../../i18n';
import {styles} from './styles';
import {MenuRow, Page} from './widgets';

const syncPlayStateLabel: Record<SyncPlayGroupState, MessageKey> = {
  Idle: 'syncPlay.stateIdle',
  Waiting: 'syncPlay.stateWaiting',
  Paused: 'syncPlay.statePaused',
  Playing: 'syncPlay.statePlaying',
};

export const SyncPlayPage = ({
  onBack,
  userName,
}: {
  onBack: () => void;
  userName?: string;
}) => {
  const [snapshot, setSnapshot] = useState(() => syncPlay.getSnapshot());
  const [groups, setGroups] = useState<SyncPlayGroupInfo[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [access, setAccess] = useState<SyncPlayAccess>('CreateAndJoinGroups');

  useEffect(() => syncPlay.onChange(setSnapshot), []);

  const refresh = useCallback(async () => {
    setMessage(t('syncPlay.looking'));
    // Unknown counts as allowed: the server still refuses what it must.
    const allowed = await syncPlay
      .getAccess()
      .catch((): SyncPlayAccess => 'CreateAndJoinGroups');
    setAccess(allowed);
    if (allowed === 'None') {
      setGroups([]);
      setMessage(t('syncPlay.notAllowedAdmin'));
      return;
    }
    try {
      const found = await syncPlay.listGroups();
      setGroups(found);
      setMessage(
        found.length
          ? null
          : allowed === 'JoinGroups'
          ? t('syncPlay.noGroupsJoinOnly')
          : t('syncPlay.noGroups'),
      );
    } catch (error) {
      setGroups([]);
      setMessage(
        error instanceof Error && error.message.includes(' 403')
          ? t('syncPlay.notAllowed')
          : t('syncPlay.listFailed'),
      );
    }
  }, []);

  useEffect(() => {
    if (!snapshot.group) {
      void refresh();
    }
  }, [refresh, snapshot.group]);

  const join = async (group: SyncPlayGroupInfo) => {
    setMessage(t('syncPlay.joining', {name: group.GroupName}));
    try {
      await syncPlay.join(group.GroupId);
      setMessage(null);
    } catch {
      setMessage(t('syncPlay.joinFailed'));
    }
  };

  const groupName = userName
    ? t('syncPlay.userGroup', {name: userName})
    : t('syncPlay.astraGroup');
  const create = async () => {
    setMessage(t('syncPlay.starting', {name: groupName}));
    try {
      await syncPlay.create(groupName);
      setMessage(null);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message.includes(' 403')
          ? t('syncPlay.mayNotStart')
          : t('syncPlay.startGroupFailed'),
      );
    }
  };

  const leave = async () => {
    try {
      await syncPlay.leave();
    } catch {
      setMessage(t('syncPlay.leftAnyway'));
    }
  };

  const group = snapshot.group;
  return (
    <Page title="SyncPlay" onBack={onBack}>
      <Text style={styles.description}>{t('syncPlay.body')}</Text>
      {group ? (
        <>
          <View style={styles.statusLines}>
            <Text style={[styles.infoText, styles.statusLine]}>
              {t('syncPlay.inGroup', {
                name: group.GroupName,
                state: snapshot.state
                  ? t(syncPlayStateLabel[snapshot.state])
                  : t('syncPlay.stateJoining'),
              })}
            </Text>
            <Text style={[styles.infoText, styles.statusLine]}>
              {t('syncPlay.with', {
                names: group.Participants.join(', ') || t('syncPlay.justYou'),
              })}
            </Text>
            {!snapshot.playingItemId ? (
              <Text style={[styles.infoText, styles.statusLine]}>
                {t('syncPlay.nothingYet')}
              </Text>
            ) : null}
            {snapshot.lastEvent ? (
              <Text style={[styles.infoText, styles.statusLine]}>
                {t('syncPlay.last', {event: snapshot.lastEvent})}
              </Text>
            ) : null}
          </View>
          <MenuRow
            icon="×"
            preferred={true}
            title={t('syncPlay.leave')}
            subtitle={t('syncPlay.leaveHint')}
            onPress={leave}
          />
        </>
      ) : (
        <>
          {groups?.map((candidate, index) => (
            <MenuRow
              icon="◈"
              key={candidate.GroupId}
              preferred={index === 0}
              title={candidate.GroupName}
              subtitle={`${candidate.Participants.join(', ')} · ${
                syncPlayStateLabel[candidate.State]
                  ? t(syncPlayStateLabel[candidate.State])
                  : candidate.State
              }`}
              onPress={() => void join(candidate)}
            />
          ))}
          {access === 'CreateAndJoinGroups' ? (
            <MenuRow
              icon="+"
              preferred={!groups?.length}
              title={t('syncPlay.startGroup')}
              subtitle={t('syncPlay.othersCanJoin', {name: groupName})}
              onPress={() => void create()}
            />
          ) : null}
          <MenuRow
            icon="↻"
            preferred={!groups?.length && access !== 'CreateAndJoinGroups'}
            title={t('syncPlay.lookAgain')}
            subtitle={t('syncPlay.lookAgainHint')}
            onPress={() => void refresh()}
          />
        </>
      )}
      {snapshot.clockOffsetMs !== null ? (
        <Text style={styles.infoText}>
          Server clock {snapshot.clockOffsetMs >= 0 ? '+' : ''}
          {Math.round(snapshot.clockOffsetMs)} ms, round trip{' '}
          {Math.round(snapshot.pingMs ?? 0)} ms
        </Text>
      ) : null}
      {snapshot.lastError ? (
        <Text style={styles.infoText}>{snapshot.lastError}</Text>
      ) : null}
      {message ? <Text style={styles.infoText}>{message}</Text> : null}
    </Page>
  );
};
