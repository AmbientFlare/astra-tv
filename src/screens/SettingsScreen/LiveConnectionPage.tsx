import React, {useEffect, useState} from 'react';
import {Text} from 'react-native';
import {
  checkSessionLink,
  serverSocket,
  type ServerSocketSnapshot,
} from '../../services/serverSocket';
import type {ServerProfile} from '../../services/storage';
import {t} from '../../i18n';
import {styles} from './styles';
import {MenuRow, Page} from './widgets';

const secondsAgo = (atMs: number | null, nowMs: number) =>
  atMs === null
    ? 'never'
    : `${Math.max(0, Math.round((nowMs - atMs) / 1000))}s ago`;

const socketStatusLabel: Record<ServerSocketSnapshot['status'], string> = {
  idle: 'Not started',
  connecting: 'Connecting…',
  open: 'Connected',
  waiting: 'Disconnected, retrying',
  stopped: 'Stopped',
};

export const LiveConnectionPage = ({
  onBack,
  serverProfile,
}: {
  onBack: () => void;
  serverProfile: ServerProfile;
}) => {
  const [snapshot, setSnapshot] = useState(() => serverSocket.getSnapshot());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [check, setCheck] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = serverSocket.onStateChange(setSnapshot);
    // Ages tick even when no message arrives.
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      unsubscribe();
      clearInterval(clock);
    };
  }, []);

  const runCheck = async () => {
    setCheck(t('live.asking'));
    try {
      const link = await checkSessionLink(
        serverProfile.serverUrl,
        serverProfile.accessToken,
      );
      setCheck(
        !link.found
          ? t('live.noSession')
          : link.supportsRemoteControl
          ? t('live.attached')
          : t('live.seenNotControllable'),
      );
    } catch (error) {
      setCheck(error instanceof Error ? error.message : t('live.checkFailed'));
    }
  };

  return (
    <Page title={t('settings.liveConnection')} onBack={onBack}>
      <Text style={styles.description}>
        {t('live.body', {name: serverProfile.name || t('setup.yourServer')})}
      </Text>
      <Text style={styles.infoText}>
        Status: {socketStatusLabel[snapshot.status]}
        {snapshot.openedAtMs !== null
          ? ` (open ${secondsAgo(snapshot.openedAtMs, nowMs).replace(
              ' ago',
              '',
            )})`
          : ''}
      </Text>
      <Text style={styles.infoText}>
        Messages received: {snapshot.messagesReceived}, last{' '}
        {secondsAgo(snapshot.lastMessageAtMs, nowMs)}
      </Text>
      <Text style={styles.infoText}>
        Keep-alive:{' '}
        {snapshot.keepAliveIntervalMs === null
          ? 'not requested yet'
          : `every ${Math.round(snapshot.keepAliveIntervalMs / 1000)}s, ${
              snapshot.keepAlivesSent
            } sent`}
      </Text>
      <Text style={styles.infoText}>
        Connections opened: {snapshot.opens}
        {snapshot.lastCloseCode !== null
          ? `, last closed with code ${snapshot.lastCloseCode}`
          : ''}
      </Text>
      {snapshot.lastError ? (
        <Text style={styles.infoText}>Last error: {snapshot.lastError}</Text>
      ) : null}
      {snapshot.recent.length ? (
        <Text style={styles.infoText}>
          Recent:{' '}
          {snapshot.recent
            .slice(-6)
            .map((event) => `${event.type} (${secondsAgo(event.atMs, nowMs)})`)
            .join(', ')}
        </Text>
      ) : null}
      <MenuRow
        icon="⇄"
        preferred={true}
        title={t('live.checkWithServer')}
        subtitle={t('live.checkWithServerHint')}
        onPress={runCheck}
      />
      {check ? <Text style={styles.infoText}>{check}</Text> : null}
    </Page>
  );
};
