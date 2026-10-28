import React, {useCallback, useEffect, useState} from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {describeDeviceModel, readDeviceModel} from '../../services/deviceModel';
import {
  configureManualTelemetry,
  telemetryStatus,
} from '../../services/telemetry';
import {
  TVFocusGuideView,
  useKeplerBackHandler,
} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {PreferenceRadioGroup} from '../../components/PreferenceRadioGroup';
import {QrCode} from '../../components/QrCode';
import {measureServerBandwidth} from '../../services/jellyfin';
import {
  checkSessionLink,
  serverSocket,
  type ServerSocketSnapshot,
} from '../../services/serverSocket';
import {
  syncPlay,
  type SyncPlayAccess,
  type SyncPlayGroupInfo,
  type SyncPlayGroupState,
} from '../../services/syncPlay';
import {
  APP_VERSION,
  BUILD_DATE,
  BUILD_NUMBER,
  KOFI_URL,
} from '../../config/app';
import {releaseHighlights} from '../../config/releaseNotes';
import {
  defaultUserPreferences,
  defaultPlaybackPrefs,
  DisplayPreferences,
  getDisplayPreferences,
  getUserPreferences,
  PlaybackPreferences,
  readPlaybackPreferences,
  readServerProfiles,
  removeServerProfile,
  removeServerProfilesByUrl,
  ServerProfile,
  setDisplayPreferences,
  signOutServerProfile,
  STILL_WATCHING_OPTIONS,
  StillWatchingAfter,
  updateUserPreferences,
  UserPreferences,
  writePlaybackPreferences,
} from '../../services/storage';
import {
  getServerCapabilities,
  serverCapabilityKey,
  updateServerCapabilities,
} from '../../services/serverCapabilities';
import type {
  ServerCapabilities,
  VideoTranscodeCapability,
} from '../../services/serverCapabilities';
import {
  getLocale,
  getLocaleTag,
  LANGUAGES,
  MessageKey,
  t,
  tn,
  useChangeLanguage,
} from '../../i18n';

const EASTER_EGG_TEXT =
  'For Kimberly — whose love of Star Trek started all of this.';

type SettingsRoute =
  | {route: 'preferences'}
  | {route: 'login'}
  | {route: 'customization'}
  | {route: 'playback'}
  | {route: 'telemetry'}
  | {route: 'about'}
  | {route: 'language'}
  | {route: 'autoSignIn'}
  | {route: 'accountSort'}
  | {route: 'manageServers'}
  | {route: 'serverDetail'; serverUrl: string; serverName: string}
  | {route: 'accountDetail'; profile: ServerProfile}
  | {route: 'homeSections'}
  | {route: 'displayPreferences'}
  | {route: 'maxBitrate'}
  | {route: 'connectionTest'}
  | {route: 'liveConnection'}
  | {route: 'syncPlay'}
  | {route: 'hlsSegmentLength'}
  | {route: 'audioChannels'}
  | {route: 'serverTranscoding'}
  | {route: 'audioLanguage'}
  | {route: 'subtitleLanguage'}
  | {route: 'fallbackLanguage'}
  | {route: 'subtitleMode'}
  | {route: 'subtitleAppearance'}
  | {route: 'autoplay'}
  | {route: 'autoplayCountdown'}
  | {route: 'stillWatching'}
  | {route: 'seekDuration'}
  | {route: 'skipIntro'};

interface SettingsScreenProps {
  onAddServer?: () => void;
  onBack?: () => void;
  serverProfile: ServerProfile;
}

const bitrateOptions = (): Array<{
  label: string;
  value: PlaybackPreferences['maxBitrateBps'];
}> => [
  // The low caps are for servers that struggle to re-encode 4K -- a Dolby
  // Vision Profile 5 title has to be re-encoded for this device (issue #26).
  // A lower cap makes the server downscale, which is far lighter work.
  {label: '4 Mbps', value: 4000000},
  {label: '8 Mbps', value: 8000000},
  {label: '12 Mbps', value: 12000000},
  {label: '20 Mbps', value: 20000000},
  {label: '40 Mbps', value: 40000000},
  {label: '80 Mbps', value: 80000000},
  {label: '120 Mbps', value: 120000000},
  {label: t('settings.unlimited'), value: 200000000},
];

const videoTranscodeOptions = (): Array<{
  label: string;
  value: VideoTranscodeCapability;
}> => [
  {label: t('capabilities.hardwareLabel'), value: 'hardware'},
  {label: t('capabilities.cpuLabel'), value: 'cpu'},
  {label: t('capabilities.unknownLabel'), value: 'unknown'},
];

/** Where the current answer came from, said plainly under the question. */
const capabilitySourceNote = (capabilities: ServerCapabilities) => {
  if (capabilities.videoTranscode === 'unable') {
    return t('settings.capabilityUnable');
  }
  if (capabilities.videoTranscodeSource === 'detected') {
    return t('settings.capabilityDetected');
  }
  if (capabilities.videoTranscode === 'cpu') {
    return t('settings.capabilityCpu');
  }
  if (capabilities.videoTranscodeSource === 'stated') {
    return t('settings.capabilityStated');
  }
  return t('settings.capabilityDefault');
};

const audioChannelOptions = (): Array<{
  label: string;
  value: PlaybackPreferences['maxAudioChannels'];
}> => [
  {label: t('settings.stereo20'), value: 2},
  {label: t('settings.surround51'), value: 6},
  {label: t('settings.surround71'), value: 8},
];

const hlsSegmentLengthOptions = (): Array<{
  label: string;
  value: PlaybackPreferences['hlsSegmentLengthSeconds'];
}> => [
  {label: t('settings.autoRecommended'), value: 0},
  ...([4, 3, 2] as const).map((value) => ({
    label: tn('settings.secondsCount', value),
    value,
  })),
];

// Content languages for audio and subtitle tracks, named in the app's language.
const languageOptions = (): Array<{label: string; value: string}> => [
  {label: t('settings.langEnglish'), value: 'en'},
  {label: t('settings.langSpanish'), value: 'es'},
  {label: t('settings.langFrench'), value: 'fr'},
  {label: t('settings.langGerman'), value: 'de'},
  {label: t('settings.langJapanese'), value: 'ja'},
  {label: t('settings.langPortuguese'), value: 'pt'},
  {label: t('settings.langItalian'), value: 'it'},
  {label: t('settings.langKorean'), value: 'ko'},
];

const audioLanguageOptions = (): Array<{label: string; value: string}> => [
  {label: t('settings.audioFromAccount'), value: 'server'},
  ...languageOptions(),
];

const fallbackLanguageOptions = (): Array<{label: string; value: string}> => [
  {label: t('settings.fallbackNone'), value: ''},
  ...languageOptions(),
];

export const SettingsScreen = ({
  onAddServer,
  onBack,
  serverProfile,
}: SettingsScreenProps) => {
  const keplerBackHandler = useKeplerBackHandler();
  const changeLanguage = useChangeLanguage();
  const [stack, setStack] = useState<SettingsRoute[]>([{route: 'preferences'}]);
  const [telemetryPhrase, setTelemetryPhrase] = useState('');
  const [telemetryMessage, setTelemetryMessage] = useState('');
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>(
    defaultUserPreferences,
  );
  const [playbackPrefs, setPlaybackPrefs] =
    useState<PlaybackPreferences>(defaultPlaybackPrefs);
  const [displayPreferencesState, setDisplayPreferenceState] =
    useState<DisplayPreferences>({
      imageSize: 'medium',
      imageType: 'Primary',
    });
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<{
    body: string;
    onConfirm: () => Promise<void>;
    title: string;
  } | null>(null);

  const current = stack[stack.length - 1];
  const push = (entry: SettingsRoute) =>
    setStack((entries) => [...entries, entry]);
  const pop = useCallback(() => {
    if (stack.length > 1) {
      setStack((entries) => entries.slice(0, -1));
    } else {
      onBack?.();
    }
  }, [onBack, stack.length]);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await readServerProfiles());
  }, []);

  // One entry per server; profiles are per-user, so a server with two
  // signed-in users has two profiles sharing a serverUrl.
  const serverGroups = React.useMemo(() => {
    const groups = new Map<
      string,
      {accounts: ServerProfile[]; name: string; serverUrl: string}
    >();

    for (const profile of profiles) {
      const group = groups.get(profile.serverUrl);

      if (group) {
        group.accounts.push(profile);
      } else {
        groups.set(profile.serverUrl, {
          accounts: [profile],
          name: profile.name,
          serverUrl: profile.serverUrl,
        });
      }
    }

    return [...groups.values()];
  }, [profiles]);

  useEffect(() => {
    refreshProfiles();
    getUserPreferences().then(setPreferences);
    readPlaybackPreferences().then(setPlaybackPrefs);
    getDisplayPreferences().then(setDisplayPreferenceState);
  }, [refreshProfiles]);

  // Kept per server: the NAS and the GPU box give different answers, and the
  // one showing here must be the one for the server currently signed in to.
  const capabilityKey = serverCapabilityKey(serverProfile.serverUrl);

  useEffect(() => {
    getServerCapabilities(capabilityKey).then(setCapabilities);
  }, [capabilityKey]);

  const handleSettingsBack = useCallback(() => {
    if (confirmAction) {
      setConfirmAction(null);
    } else {
      pop();
    }

    return true;
  }, [confirmAction, pop]);

  useEffect(() => {
    const subscription = keplerBackHandler.addEventListener(
      'hardwareBackPress',
      handleSettingsBack,
    );

    return () => {
      subscription.remove();
    };
  }, [handleSettingsBack, keplerBackHandler]);

  const savePreferences = async (patch: Partial<UserPreferences>) => {
    const next = await updateUserPreferences(patch);
    setPreferences(next);
  };

  const saveDisplayPrefs = async (next: DisplayPreferences) => {
    setDisplayPreferenceState(next);
    await setDisplayPreferences(next);
  };

  const savePlaybackPrefs = async (patch: Partial<PlaybackPreferences>) => {
    const next = await writePlaybackPreferences(patch);
    setPlaybackPrefs(next);
  };

  const page = (() => {
    switch (current.route) {
      case 'login':
        return (
          <Page title={t('settings.login')} onBack={pop}>
            <MenuRow
              icon="⇥"
              title={t('settings.autoSignIn')}
              subtitle={
                preferences.autoSignIn === 'mostRecent'
                  ? t('settings.mostRecentlyUsed')
                  : t('settings.disabled')
              }
              onPress={() => push({route: 'autoSignIn'})}
            />
            <MenuRow
              icon="↕"
              title={t('settings.sortAccountsBy')}
              subtitle={
                preferences.accountSortBy === 'lastUsed'
                  ? t('settings.mostRecentlyUsed')
                  : t('settings.name')
              }
              onPress={() => push({route: 'accountSort'})}
            />
            <MenuRow
              icon="▣"
              title={t('settings.manageServers')}
              subtitle={tn('settings.savedServers', serverGroups.length)}
              onPress={() => push({route: 'manageServers'})}
            />
          </Page>
        );
      case 'autoSignIn':
        return (
          <RadioPage
            title={t('settings.autoSignIn')}
            onBack={pop}
            options={[
              {label: t('settings.disable'), value: 'disabled'},
              {label: t('settings.mostRecentlyUsed'), value: 'mostRecent'},
            ]}
            selectedValue={preferences.autoSignIn}
            onSelect={(autoSignIn) => savePreferences({autoSignIn})}
          />
        );
      case 'accountSort':
        return (
          <RadioPage
            title={t('settings.sortAccountsBy')}
            onBack={pop}
            options={[
              {label: t('settings.mostRecentlyUsed'), value: 'lastUsed'},
              {label: t('settings.name'), value: 'name'},
            ]}
            selectedValue={preferences.accountSortBy}
            onSelect={(accountSortBy) => savePreferences({accountSortBy})}
          />
        );
      case 'manageServers':
        return (
          <Page title={t('settings.manageServers')} onBack={pop}>
            <MenuRow
              icon="+"
              preferred
              title={t('settings.addServer')}
              subtitle={t('settings.addServerHint')}
              onPress={onAddServer}
            />
            {serverGroups.length === 0 ? (
              <Text style={styles.infoText}>
                {t('settings.noSavedServers')}
              </Text>
            ) : null}
            {serverGroups.map((group) => (
              <MenuRow
                icon="▣"
                key={group.serverUrl}
                title={group.name}
                subtitle={`${group.serverUrl}  ·  ${tn(
                  'settings.userCount',
                  group.accounts.length,
                )}`}
                onPress={() =>
                  push({
                    route: 'serverDetail',
                    serverName: group.name,
                    serverUrl: group.serverUrl,
                  })
                }
              />
            ))}
          </Page>
        );
      case 'serverDetail': {
        const accounts =
          serverGroups.find((group) => group.serverUrl === current.serverUrl)
            ?.accounts ?? [];

        return (
          <Page title={current.serverName} onBack={pop}>
            <Text style={styles.groupTitle}>{t('settings.accounts')}</Text>
            {accounts.map((profile) => (
              <MenuRow
                icon="◉"
                key={profile.id}
                title={profile.username ?? profile.userId}
                subtitle={`${t('settings.lastUsedOn', {
                  date: new Date(profile.lastUsed).toLocaleDateString(
                    getLocaleTag(),
                  ),
                })}${
                  profile.accessToken ? '' : `  ·  ${t('profiles.signedOut')}`
                }`}
                onPress={() => push({route: 'accountDetail', profile})}
              />
            ))}
            <Text style={styles.groupTitle}>{t('settings.server')}</Text>
            <DangerRow
              title={t('settings.removeServer')}
              subtitle={`${current.serverUrl}  ·  ${
                accounts.length === 1
                  ? t('settings.removesItsUser')
                  : t('settings.removesAllUsers')
              }`}
              onPress={() =>
                setConfirmAction({
                  title: t('settings.removeServerConfirm'),
                  body: t('settings.removeServerBody'),
                  onConfirm: async () => {
                    await removeServerProfilesByUrl(current.serverUrl);
                    await refreshProfiles();
                    setStack([
                      {route: 'preferences'},
                      {route: 'login'},
                      {route: 'manageServers'},
                    ]);
                  },
                })
              }
            />
          </Page>
        );
      }
      case 'accountDetail':
        return (
          <Page
            title={current.profile.username ?? t('settings.account')}
            onBack={pop}>
            <DangerRow
              title={t('settings.signOut')}
              subtitle={t('settings.signOutHint')}
              onPress={() =>
                setConfirmAction({
                  title: t('settings.signOutConfirm'),
                  body: t('settings.signOutBody'),
                  onConfirm: async () => {
                    await signOutServerProfile(current.profile.id);
                    await refreshProfiles();
                    pop();
                  },
                })
              }
            />
            <DangerRow
              title={t('settings.remove')}
              subtitle={t('settings.removeAccount')}
              onPress={() =>
                setConfirmAction({
                  title: t('settings.removeAccountConfirm'),
                  body: t('settings.removeAccountBody'),
                  onConfirm: async () => {
                    await removeServerProfile(current.profile.id);
                    await refreshProfiles();
                    setStack([
                      {route: 'preferences'},
                      {route: 'login'},
                      {route: 'manageServers'},
                    ]);
                  },
                })
              }
            />
          </Page>
        );
      case 'customization':
        return (
          <Page title={t('settings.customization')} onBack={pop}>
            <MenuRow
              icon="☰"
              title={t('settings.homeSections')}
              subtitle={t('settings.homeSectionsHint')}
              onPress={() => push({route: 'homeSections'})}
            />
            <MenuRow
              icon="▧"
              title={t('settings.displayPreferences')}
              subtitle={t('settings.displayPreferencesHint')}
              onPress={() => push({route: 'displayPreferences'})}
            />
            <ToggleRow
              title={t('settings.backdropBlur')}
              subtitle={t('settings.backdropBlurHint')}
              value={preferences.focusedBackdropEnabled}
              onToggle={() =>
                savePreferences({
                  focusedBackdropEnabled: !preferences.focusedBackdropEnabled,
                })
              }
            />
            <ToggleRow
              title={t('nav.music')}
              subtitle={t('settings.musicHint')}
              value={preferences.musicEnabled}
              onToggle={() =>
                savePreferences({musicEnabled: !preferences.musicEnabled})
              }
            />
          </Page>
        );
      case 'homeSections':
        return (
          <Page title={t('settings.homeSections')} onBack={pop}>
            {[
              ['continueWatching', t('home.continueWatching')],
              ['nextUp', t('home.nextUp')],
              ['latestMovies', t('home.latestMovies')],
              ['latestShows', t('home.latestShows')],
            ].map(([key, label]) => (
              <ToggleRow
                key={key}
                title={label}
                value={
                  preferences.homeSections[
                    key as keyof UserPreferences['homeSections']
                  ]
                }
                onToggle={() =>
                  savePreferences({
                    homeSections: {
                      ...preferences.homeSections,
                      [key]:
                        !preferences.homeSections[
                          key as keyof UserPreferences['homeSections']
                        ],
                    },
                  })
                }
              />
            ))}
          </Page>
        );
      case 'displayPreferences':
        return (
          <Page title={t('settings.displayPreferences')} onBack={pop}>
            <PreferenceRadioGroup
              title={t('settings.imageSize')}
              options={[
                {label: t('settings.small'), value: 'small'},
                {label: t('settings.medium'), value: 'medium'},
                {label: t('settings.large'), value: 'large'},
              ]}
              selectedValue={displayPreferencesState.imageSize}
              onSelect={(imageSize) =>
                saveDisplayPrefs({...displayPreferencesState, imageSize})
              }
            />
            <PreferenceRadioGroup
              title={t('settings.imageType')}
              options={[
                {label: t('settings.poster'), value: 'Primary'},
                {label: t('settings.thumb'), value: 'Thumb'},
                {label: t('settings.banner'), value: 'Banner'},
              ]}
              selectedValue={displayPreferencesState.imageType}
              onSelect={(imageType) =>
                saveDisplayPrefs({...displayPreferencesState, imageType})
              }
            />
          </Page>
        );
      case 'telemetry':
        return (
          <Page title="Developer telemetry" onBack={pop}>
            <Text style={{color: 'white', fontSize: 22}}>
              Off by default. Enabling sends viewing diagnostics to the
              configured operator collector. Enter the operator phrase only on
              your own test device. Logs contain private viewing information.
            </Text>
            <TextInput
              testID="telemetry-phrase"
              value={telemetryPhrase}
              onChangeText={setTelemetryPhrase}
              placeholder="Operator phrase"
              placeholderTextColor="#aaaaaa"
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                color: 'white',
                borderColor: '#aaaaaa',
                borderWidth: 1,
                padding: 16,
                fontSize: 24,
              }}
            />
            <MenuRow
              icon="↗"
              title="Enable on this device"
              onPress={() => {
                void configureManualTelemetry(telemetryPhrase).then(
                  (enabled) => {
                    setTelemetryPhrase('');
                    setTelemetryMessage(
                      enabled
                        ? 'Enabled on this device.'
                        : 'Not enabled: check phrase and build configuration.',
                    );
                  },
                );
              }}
            />
            <MenuRow
              icon="×"
              title="Disable telemetry"
              onPress={() => {
                void configureManualTelemetry('').then(() =>
                  setTelemetryMessage('Telemetry stopped.'),
                );
              }}
            />
            <Text style={{color: 'white', fontSize: 22}}>
              {telemetryMessage || telemetryStatus().reason}
            </Text>
          </Page>
        );
      case 'playback':
        return (
          <Page title={t('settings.playback')} onBack={pop}>
            {/* Wired now: max bitrate and seek duration. Other playback
                choices persist as UI state until player support exists. */}
            <ToggleRow
              title={t('settings.statsForNerds')}
              subtitle={t('settings.statsForNerdsHint')}
              value={playbackPrefs.showPlaybackStats}
              onToggle={() =>
                savePlaybackPrefs({
                  showPlaybackStats: !playbackPrefs.showPlaybackStats,
                })
              }
            />
            <ToggleRow
              title={t('settings.statsWithLogs')}
              subtitle={t('settings.statsWithLogsHint')}
              value={playbackPrefs.showPlaybackTraces}
              onToggle={() =>
                savePlaybackPrefs({
                  showPlaybackTraces: !playbackPrefs.showPlaybackTraces,
                })
              }
            />
            {playbackPrefs.showPlaybackStats &&
              playbackPrefs.showPlaybackTraces && (
                <MenuRow
                  icon="↯"
                  title="Developer telemetry"
                  subtitle="Local opt-in diagnostics; off by default"
                  onPress={() => push({route: 'telemetry'})}
                />
              )}
            <MenuRow
              icon="↯"
              title={t('settings.maxBitrate')}
              subtitle={
                bitrateOptions().find(
                  (o) => o.value === playbackPrefs.maxBitrateBps,
                )?.label
              }
              onPress={() => push({route: 'maxBitrate'})}
            />
            <MenuRow
              icon="⇄"
              title={t('settings.testConnection')}
              subtitle={t('settings.testConnectionHint')}
              onPress={() => push({route: 'connectionTest'})}
            />
            <MenuRow
              icon="◉"
              title={t('settings.liveConnection')}
              subtitle={t('settings.liveConnectionHint')}
              onPress={() => push({route: 'liveConnection'})}
            />
            <MenuRow
              icon="◈"
              title="SyncPlay"
              subtitle={t('settings.syncPlayHint')}
              onPress={() => push({route: 'syncPlay'})}
            />
            <MenuRow
              icon="◎"
              title={t('settings.audioOutput')}
              subtitle={t('settings.audioOutputHint')}
              onPress={() => push({route: 'audioChannels'})}
            />
            <MenuRow
              icon="⚙"
              title={t('settings.serverTranscoding')}
              subtitle={t('settings.serverTranscodingHint')}
              onPress={() => push({route: 'serverTranscoding'})}
            />
            <MenuRow
              icon="♫"
              title={t('settings.audioLanguage')}
              subtitle={
                audioLanguageOptions().find(
                  (o) => o.value === playbackPrefs.preferredAudioLanguage,
                )?.label ?? t('settings.langEnglish')
              }
              onPress={() => push({route: 'audioLanguage'})}
            />
            <MenuRow
              icon="▱"
              title={t('settings.subtitleLanguage')}
              subtitle={
                languageOptions().find(
                  (o) => o.value === preferences.preferredSubtitleLanguage,
                )?.label ?? preferences.preferredSubtitleLanguage
              }
              onPress={() => push({route: 'subtitleLanguage'})}
            />
            <MenuRow
              icon="♫"
              title={t('settings.fallbackLanguage')}
              subtitle={
                fallbackLanguageOptions().find(
                  (o) => o.value === playbackPrefs.fallbackLanguage,
                )?.label ?? t('settings.fallbackNone')
              }
              onPress={() => push({route: 'fallbackLanguage'})}
            />
            <MenuRow
              icon="▰"
              title={t('settings.subtitleMode')}
              subtitle={labelForSubtitleMode(preferences.subtitleMode)}
              onPress={() => push({route: 'subtitleMode'})}
            />
            <MenuRow
              icon="▱"
              title={t('settings.subtitleAppearance')}
              subtitle={
                subtitleAppearanceOptions().find(
                  (option) => option.value === preferences.subtitleAppearance,
                )?.label ?? t('settings.textWithShadow')
              }
              onPress={() => push({route: 'subtitleAppearance'})}
            />
            <ToggleRow
              title={t('settings.nextEpisodeAutoplay')}
              subtitle={t('settings.countdownValue', {
                seconds: preferences.nextEpisodeCountdownSeconds,
              })}
              value={preferences.nextEpisodeAutoplay}
              onToggle={() =>
                savePreferences({
                  nextEpisodeAutoplay: !preferences.nextEpisodeAutoplay,
                })
              }
            />
            {preferences.nextEpisodeAutoplay ? (
              <MenuRow
                icon="◷"
                title={t('settings.countdownDuration')}
                subtitle={`${preferences.nextEpisodeCountdownSeconds}s`}
                onPress={() => push({route: 'autoplayCountdown'})}
              />
            ) : null}
            {preferences.nextEpisodeAutoplay ? (
              <MenuRow
                icon="?"
                title={t('settings.stillWatching')}
                subtitle={labelForStillWatching(
                  preferences.stillWatchingAfterEpisodes,
                )}
                onPress={() => push({route: 'stillWatching'})}
              />
            ) : null}
            <MenuRow
              icon="»"
              title={t('settings.seekDuration')}
              subtitle={`${playbackPrefs.seekDurationSeconds}s`}
              onPress={() => push({route: 'seekDuration'})}
            />
            <MenuRow
              icon="⋮"
              title={t('settings.hlsSegmentLength')}
              subtitle={
                playbackPrefs.hlsSegmentLengthSeconds
                  ? t('settings.compatibilityMode', {
                      seconds: playbackPrefs.hlsSegmentLengthSeconds,
                    })
                  : t('settings.autoRecommended')
              }
              onPress={() => push({route: 'hlsSegmentLength'})}
            />
            <MenuRow
              icon="⊘"
              title={t('settings.skipIntro')}
              subtitle={labelForSkip(preferences.skipIntroCredits)}
              onPress={() => push({route: 'skipIntro'})}
            />
          </Page>
        );
      case 'maxBitrate':
        return (
          <RadioPage
            title={t('settings.maxBitrate')}
            onBack={pop}
            options={bitrateOptions()}
            selectedValue={playbackPrefs.maxBitrateBps}
            onSelect={(maxBitrateBps) => savePlaybackPrefs({maxBitrateBps})}
          />
        );
      case 'connectionTest':
        return (
          <ConnectionTestPage
            currentMaxBitrateBps={playbackPrefs.maxBitrateBps}
            onApplyBitrate={(maxBitrateBps) =>
              savePlaybackPrefs({maxBitrateBps})
            }
            onBack={pop}
            serverProfile={serverProfile}
          />
        );
      case 'syncPlay':
        return <SyncPlayPage onBack={pop} userName={serverProfile.username} />;
      case 'liveConnection':
        return (
          <LiveConnectionPage onBack={pop} serverProfile={serverProfile} />
        );
      case 'audioChannels':
        return (
          <Page title={t('settings.audioOutput')} onBack={pop}>
            <Text style={styles.description}>
              {t('settings.audioOutputHint')}
            </Text>
            <PreferenceRadioGroup
              options={audioChannelOptions()}
              selectedValue={playbackPrefs.maxAudioChannels}
              onSelect={(maxAudioChannels) =>
                savePlaybackPrefs({maxAudioChannels})
              }
            />
            <Text style={styles.infoText}>{t('settings.audioOutputNote')}</Text>
          </Page>
        );
      case 'serverTranscoding':
        return (
          <Page title={t('settings.serverTranscoding')} onBack={pop}>
            <Text style={styles.description}>
              {t('settings.hardwareTranscodingQuestion', {
                name: serverProfile.name,
              })}
            </Text>
            <PreferenceRadioGroup
              options={videoTranscodeOptions()}
              selectedValue={
                capabilities?.videoTranscode === 'unable'
                  ? 'unknown'
                  : capabilities?.videoTranscode ?? 'unknown'
              }
              onSelect={(videoTranscode) => {
                void updateServerCapabilities(capabilityKey, {
                  pendingCapabilityNotice: false,
                  videoTranscode,
                  videoTranscodeSource:
                    videoTranscode === 'unknown' ? 'default' : 'stated',
                }).then(setCapabilities);
              }}
            />
            <Text style={styles.infoText}>
              {capabilities
                ? capabilitySourceNote(capabilities)
                : t('settings.loadingServerSettings')}
            </Text>
          </Page>
        );
      case 'audioLanguage':
        return (
          <Page title={t('settings.audioLanguage')} onBack={pop}>
            <Text style={styles.description}>
              {t('settings.audioLanguageHint')}
            </Text>
            {/* Fixed v1 list; later this can expand from Jellyfin item language data. */}
            <PreferenceRadioGroup
              options={audioLanguageOptions()}
              selectedValue={playbackPrefs.preferredAudioLanguage}
              onSelect={(preferredAudioLanguage) =>
                savePlaybackPrefs({preferredAudioLanguage})
              }
            />
            <Text style={styles.infoText}>
              {t('settings.audioLanguageNote')}
            </Text>
          </Page>
        );
      case 'fallbackLanguage':
        return (
          <Page title={t('settings.fallbackLanguage')} onBack={pop}>
            <Text style={styles.description}>
              {t('settings.fallbackLanguageHint')}
            </Text>
            <PreferenceRadioGroup
              options={fallbackLanguageOptions()}
              selectedValue={playbackPrefs.fallbackLanguage}
              onSelect={(fallbackLanguage) =>
                savePlaybackPrefs({fallbackLanguage})
              }
            />
          </Page>
        );
      case 'subtitleLanguage':
        return (
          <RadioPage
            title={t('settings.subtitleLanguage')}
            onBack={pop}
            options={languageOptions()}
            selectedValue={preferences.preferredSubtitleLanguage}
            onSelect={(preferredSubtitleLanguage) =>
              savePreferences({preferredSubtitleLanguage})
            }
          />
        );
      case 'subtitleMode':
        return (
          <Page title={t('settings.subtitleMode')} onBack={pop}>
            <Text style={styles.description}>
              {t('settings.subtitleModeHint')}
            </Text>
            <PreferenceRadioGroup
              options={subtitleModeOptions()}
              selectedValue={preferences.subtitleMode}
              onSelect={(subtitleMode) => savePreferences({subtitleMode})}
            />
            <Text style={styles.infoText}>
              {t('settings.subtitleModeNote')}
            </Text>
          </Page>
        );
      case 'subtitleAppearance':
        return (
          <Page title={t('settings.subtitleAppearance')} onBack={pop}>
            <Text style={styles.description}>
              {t('settings.subtitleAppearanceHint')}
            </Text>
            <PreferenceRadioGroup
              options={subtitleAppearanceOptions()}
              selectedValue={preferences.subtitleAppearance}
              onSelect={(subtitleAppearance) =>
                savePreferences({subtitleAppearance})
              }
            />
            <Text style={styles.infoText}>
              {t('settings.subtitleAppearanceNote')}
            </Text>
          </Page>
        );
      case 'stillWatching':
        return (
          <RadioPage
            title={t('settings.stillWatching')}
            onBack={pop}
            options={STILL_WATCHING_OPTIONS.map((value) => ({
              label: labelForStillWatching(value),
              value,
            }))}
            selectedValue={preferences.stillWatchingAfterEpisodes}
            onSelect={(stillWatchingAfterEpisodes) =>
              savePreferences({stillWatchingAfterEpisodes})
            }
          />
        );
      case 'autoplayCountdown':
        return (
          <RadioPage
            title={t('settings.countdownDuration')}
            onBack={pop}
            options={[10, 15, 30].map((value) => ({
              label: `${value}s`,
              value: value as 10 | 15 | 30,
            }))}
            selectedValue={preferences.nextEpisodeCountdownSeconds}
            onSelect={(nextEpisodeCountdownSeconds) =>
              savePreferences({nextEpisodeCountdownSeconds})
            }
          />
        );
      case 'seekDuration':
        return (
          <RadioPage
            title={t('settings.seekDuration')}
            onBack={pop}
            options={[10, 15, 30, 60].map((value) => ({
              label: `${value}s`,
              value,
            }))}
            selectedValue={playbackPrefs.seekDurationSeconds}
            onSelect={(seekDurationSeconds) =>
              savePlaybackPrefs({seekDurationSeconds})
            }
          />
        );
      case 'hlsSegmentLength':
        return (
          <Page title={t('settings.hlsSegmentLength')} onBack={pop}>
            <Text style={styles.description}>
              {t('settings.hlsSegmentLengthHint')}
            </Text>
            <PreferenceRadioGroup
              options={hlsSegmentLengthOptions()}
              selectedValue={playbackPrefs.hlsSegmentLengthSeconds}
              onSelect={(hlsSegmentLengthSeconds) =>
                savePlaybackPrefs({hlsSegmentLengthSeconds})
              }
            />
            <ToggleRow
              title={t('settings.hevcFmp4')}
              subtitle={t('settings.hevcFmp4Hint')}
              value={playbackPrefs.hevcFmp4Experiment}
              onToggle={() =>
                savePlaybackPrefs({
                  hevcFmp4Experiment: !playbackPrefs.hevcFmp4Experiment,
                })
              }
            />
          </Page>
        );
      case 'skipIntro':
        return (
          <RadioPage
            title={t('settings.skipIntro')}
            onBack={pop}
            options={[
              {label: t('settings.skipAsk'), value: 'ask'},
              {label: t('settings.skipAuto'), value: 'auto'},
              {label: t('settings.skipIgnore'), value: 'ignore'},
            ]}
            selectedValue={preferences.skipIntroCredits}
            onSelect={(skipIntroCredits) => savePreferences({skipIntroCredits})}
          />
        );
      case 'language':
        return (
          <RadioPage
            title={t('settings.language')}
            onBack={pop}
            options={LANGUAGES.map((language) => ({
              label: language.name,
              value: language.locale,
            }))}
            selectedValue={getLocale()}
            onSelect={(locale) => {
              if (locale !== getLocale()) {
                changeLanguage(locale);
              }
            }}
          />
        );
      case 'about':
        return (
          <Page title={t('settings.about')} onBack={pop}>
            <View style={styles.about}>
              <Text style={styles.aboutText}>Astra {APP_VERSION}</Text>
              <Text style={styles.aboutText}>
                {t('about.build', {build: BUILD_NUMBER})}
              </Text>
              <Text style={styles.aboutText}>
                {t('about.buildDate', {date: BUILD_DATE})}
              </Text>
              {readDeviceModel().model ? (
                <Text style={styles.aboutText} testID="about-device">
                  {t('about.device', {
                    device: describeDeviceModel(readDeviceModel()),
                  })}
                </Text>
              ) : null}
              <Text style={styles.aboutText}>{t('about.license')}</Text>
              <Text style={styles.aboutText}>{t('about.openSource')}</Text>
              <Text style={styles.aboutText}>{t('about.compatible')}</Text>
              <Text style={styles.aboutText}>{t('about.support')}</Text>
              <Text style={styles.aboutText}>{t('about.website')}</Text>
              <Text style={styles.aboutText}>{t('about.source')}</Text>
              <View style={styles.qrRow}>
                <View style={styles.qrImage}>
                  <QrCode
                    size={QR_SIZE}
                    testID="about-kofi-qr"
                    value={KOFI_URL}
                  />
                </View>
                <Image
                  source={require('../../assets/source-qr.png')}
                  style={styles.qrImage}
                />
              </View>
              <View style={styles.releaseNotes}>
                <Text style={styles.releaseNotesTitle}>
                  {t('about.whatsNewIn', {version: APP_VERSION})}
                </Text>
                {releaseHighlights().map((highlight) => (
                  <Text
                    key={highlight.slice(0, 24)}
                    style={styles.releaseNotesText}>
                    {`\u2022 ${highlight}`}
                  </Text>
                ))}
              </View>
              <Text style={styles.easterEgg}>{EASTER_EGG_TEXT}</Text>
            </View>
          </Page>
        );
      case 'preferences':
      default:
        return (
          <Page
            title={t('settings.preferences')}
            subtitle={serverProfile.name}
            onBack={onBack}>
            <MenuRow
              icon="⇥"
              title={t('settings.login')}
              subtitle={t('settings.loginHint')}
              onPress={() => push({route: 'login'})}
              preferred
            />
            <MenuRow
              icon="▧"
              title={t('settings.customization')}
              subtitle={t('settings.customizationHint')}
              onPress={() => push({route: 'customization'})}
            />
            <MenuRow
              icon="▶"
              title={t('settings.playback')}
              subtitle={t('settings.playbackHint')}
              onPress={() => push({route: 'playback'})}
            />
            <MenuRow
              icon="文"
              title={t('settings.language')}
              subtitle={
                LANGUAGES.find((language) => language.locale === getLocale())
                  ?.name
              }
              onPress={() => push({route: 'language'})}
            />
            <MenuRow
              icon="ⓘ"
              title={t('settings.about')}
              subtitle={t('settings.aboutHint')}
              onPress={() => push({route: 'about'})}
            />
          </Page>
        );
    }
  })();

  return (
    <>
      {page}
      {confirmAction ? (
        <ConfirmDialog
          body={confirmAction.body}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            confirmAction.onConfirm().finally(() => setConfirmAction(null));
          }}
          title={confirmAction.title}
        />
      ) : null}
    </>
  );
};

const subtitleAppearanceOptions = (): Array<{
  label: string;
  value: UserPreferences['subtitleAppearance'];
}> => [
  {label: t('settings.textWithShadow'), value: 'shadow'},
  {label: t('settings.darkBackground'), value: 'background'},
];

const subtitleModeOptions = (): Array<{
  label: string;
  value: UserPreferences['subtitleMode'];
}> => [
  {label: t('settings.subtitleDefault'), value: 'default'},
  {label: t('settings.subtitlesAllOn'), value: 'alwaysOn'},
  {label: t('settings.subtitlesAllOff'), value: 'alwaysOff'},
  {label: t('settings.subtitlesForced'), value: 'forcedOnly'},
];

const labelForSubtitleMode = (mode: UserPreferences['subtitleMode']) =>
  subtitleModeOptions().find((option) => option.value === mode)?.label ??
  t('settings.subtitleDefault');

const labelForSkip = (mode: UserPreferences['skipIntroCredits']) =>
  ({
    ask: t('settings.skipAsk'),
    auto: t('settings.skipAuto'),
    ignore: t('settings.skipIgnore'),
  }[mode]);

const labelForStillWatching = (episodes: StillWatchingAfter) =>
  episodes === 0
    ? t('settings.stillWatchingNever')
    : t('settings.stillWatchingAfter', {count: episodes});

const ConnectionTestPage = ({
  currentMaxBitrateBps,
  onApplyBitrate,
  onBack,
  serverProfile,
}: {
  currentMaxBitrateBps: number;
  onApplyBitrate: (bitrateBps: PlaybackPreferences['maxBitrateBps']) => void;
  onBack: () => void;
  serverProfile: ServerProfile;
}) => {
  const [phase, setPhase] = useState<'idle' | 'testing' | 'done' | 'error'>(
    'idle',
  );
  const [measuredBps, setMeasuredBps] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const runTest = async () => {
    setPhase('testing');
    setErrorText(null);

    try {
      const bps = await measureServerBandwidth(
        serverProfile.serverUrl,
        serverProfile.accessToken,
      );
      setMeasuredBps(bps);
      setPhase('done');
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : t('settings.connectionTestFailed'),
      );
      setPhase('error');
    }
  };

  // Leave 20% headroom over sustained playback so bursts and container
  // overhead don't cause buffering right at the limit.
  const usableBps = measuredBps === null ? null : measuredBps * 0.8;
  const suggestion =
    usableBps === null
      ? null
      : [...bitrateOptions()]
          .sort((a, b) => b.value - a.value)
          .find((option) => option.value <= usableBps) ?? bitrateOptions()[0];
  const belowLowestOption =
    usableBps !== null && suggestion !== null
      ? usableBps < suggestion.value
      : false;

  return (
    <Page title={t('settings.testConnection')} onBack={onBack}>
      <Text style={styles.description}>
        {t('settings.connectionTestBody', {
          name: serverProfile.name || t('setup.yourServer'),
        })}
      </Text>
      <MenuRow
        icon="⇄"
        preferred={true}
        title={
          phase === 'testing' ? t('settings.testing') : t('settings.runTest')
        }
        subtitle={phase === 'testing' ? t('settings.testingHint') : undefined}
        onPress={phase === 'testing' ? undefined : runTest}
      />
      {phase === 'done' && measuredBps !== null && suggestion ? (
        <>
          <Text style={styles.infoText}>
            {t('settings.measuredSpeed', {
              mbps: (measuredBps / 1000000).toFixed(0),
            })}
          </Text>
          {belowLowestOption ? (
            <Text style={styles.infoText}>
              {t('settings.slowerThanLowest')}
            </Text>
          ) : null}
          <MenuRow
            icon="↯"
            title={t('settings.setMaxBitrate', {value: suggestion.label})}
            subtitle={
              suggestion.value === currentMaxBitrateBps
                ? t('settings.alreadyCurrent')
                : t('settings.currently', {
                    value:
                      bitrateOptions().find(
                        (o) => o.value === currentMaxBitrateBps,
                      )?.label ?? t('settings.unknown'),
                  })
            }
            onPress={() => {
              onApplyBitrate(suggestion.value);
              onBack();
            }}
          />
          <Text style={styles.infoText}>{t('settings.bitrateAdvice')}</Text>
        </>
      ) : null}
      {phase === 'error' && errorText ? (
        <Text style={styles.infoText}>{errorText}</Text>
      ) : null}
    </Page>
  );
};

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

const LiveConnectionPage = ({
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

const syncPlayStateLabel: Record<SyncPlayGroupState, MessageKey> = {
  Idle: 'syncPlay.stateIdle',
  Waiting: 'syncPlay.stateWaiting',
  Paused: 'syncPlay.statePaused',
  Playing: 'syncPlay.statePlaying',
};

const SyncPlayPage = ({
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

const Page = ({
  children,
  onBack,
  subtitle,
  title,
}: React.PropsWithChildren<{
  onBack?: () => void;
  subtitle?: string;
  title: string;
}>) => (
  <ScrollView style={styles.screen} testID="settings-screen">
    <Text style={styles.title}>{title}</Text>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    <FocusableItem
      focusedStyle={styles.rowFocused}
      onPress={onBack}
      style={styles.backButton}
      testID="settings-back-button">
      <Text style={styles.backText}>{t('common.back')}</Text>
    </FocusableItem>
    <View style={styles.group}>{children}</View>
  </ScrollView>
);

const MenuRow = ({
  icon,
  onPress,
  preferred,
  subtitle,
  title,
}: {
  icon: string;
  onPress?: () => void;
  preferred?: boolean;
  subtitle?: string;
  title: string;
}) => (
  <FocusableItem
    hasTVPreferredFocus={preferred}
    focusedStyle={styles.rowFocused}
    onPress={onPress}
    style={styles.menuRow}
    testID={`settings-${title}`}>
    <Text style={styles.icon}>{icon}</Text>
    <View style={styles.rowCopy}>
      <Text style={styles.rowText}>{title}</Text>
      {subtitle ? <Text style={styles.rowValue}>{subtitle}</Text> : null}
    </View>
  </FocusableItem>
);

const DangerRow = (props: Omit<Parameters<typeof MenuRow>[0], 'icon'>) => (
  <MenuRow {...props} icon="!" />
);

const ToggleRow = ({
  onToggle,
  subtitle,
  title,
  value,
}: {
  onToggle: () => void;
  subtitle?: string;
  title: string;
  value: boolean;
}) => (
  <FocusableItem
    focusedStyle={styles.rowFocused}
    onPress={onToggle}
    style={styles.menuRow}
    testID={`settings-toggle-${title}`}>
    <Text style={styles.icon}>{value ? '☑' : '☐'}</Text>
    <View style={styles.rowCopy}>
      <Text style={styles.rowText}>{title}</Text>
      {subtitle ? <Text style={styles.rowValue}>{subtitle}</Text> : null}
    </View>
  </FocusableItem>
);

const RadioPage = <Value extends string | number>({
  onBack,
  onSelect,
  options,
  selectedValue,
  title,
}: {
  onBack?: () => void;
  onSelect: (value: Value) => void;
  options: Array<{label: string; value: Value}>;
  selectedValue: Value;
  title: string;
}) => (
  <Page title={title} onBack={onBack}>
    <PreferenceRadioGroup
      options={options}
      selectedValue={selectedValue}
      onSelect={onSelect}
    />
  </Page>
);

const ConfirmDialog = ({
  body,
  onCancel,
  onConfirm,
  title,
}: {
  body: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) => (
  <View style={styles.confirmOverlay}>
    <View style={styles.confirmDialog}>
      <Text style={styles.confirmTitle}>{title}</Text>
      <Text style={styles.confirmBody}>{body}</Text>
      <TVFocusGuideView style={styles.confirmActions}>
        <FocusableItem
          hasTVPreferredFocus
          focusedStyle={styles.rowFocused}
          onPress={onCancel}
          style={styles.confirmButton}>
          <Text style={styles.backText}>{t('common.cancel')}</Text>
        </FocusableItem>
        <FocusableItem
          focusedStyle={styles.dangerFocused}
          onPress={onConfirm}
          style={[styles.confirmButton, styles.dangerButton]}>
          <Text style={styles.backText}>{t('common.confirm')}</Text>
        </FocusableItem>
      </TVFocusGuideView>
    </View>
  </View>
);

// Both About codes are version 3 (29 modules plus the quiet zone, 37 in all),
// so 148 gives whole 4-pixel modules.
const QR_SIZE = 148;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
    paddingHorizontal: 84,
    paddingTop: 60,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 58,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9FB0BA',
    fontSize: 28,
    marginTop: 8,
  },
  group: {
    marginTop: 36,
    width: 960,
  },
  groupTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
    marginTop: 14,
  },
  menuRow: {
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: '#182027',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 18,
  },
  rowFocused: {
    backgroundColor: '#2E5A72',
  },
  icon: {
    color: '#89CFF0',
    fontSize: 30,
    fontWeight: '800',
    marginRight: 18,
    textAlign: 'center',
    width: 38,
  },
  rowCopy: {
    flex: 1,
  },
  rowText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  rowValue: {
    color: '#B8C5CC',
    fontSize: 20,
    marginTop: 4,
  },
  description: {
    color: '#B8C5CC',
    fontSize: 22,
    marginBottom: 18,
  },
  statusLines: {
    gap: 4,
  },
  statusLine: {
    marginTop: 0,
  },
  infoText: {
    color: '#9FB0BA',
    fontSize: 19,
    fontStyle: 'italic',
    marginTop: -6,
    opacity: 0.76,
  },
  backButton: {
    width: 120,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  about: {
    backgroundColor: '#182027',
    borderRadius: 8,
    padding: 22,
  },
  aboutText: {
    color: '#DDE7EB',
    fontSize: 22,
    marginBottom: 10,
  },
  releaseNotes: {
    borderTopColor: '#34434B',
    borderTopWidth: 1,
    marginTop: 22,
    paddingTop: 18,
  },
  releaseNotesTitle: {
    color: '#89CFF0',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  releaseNotesText: {
    color: '#DDE7EB',
    fontSize: 20,
    lineHeight: 28,
    marginBottom: 8,
  },
  easterEgg: {
    color: '#9FB0BA',
    fontSize: 19,
    fontStyle: 'italic',
    marginTop: 16,
    opacity: 0.58,
  },
  qrRow: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 10,
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.74)',
    justifyContent: 'center',
  },
  confirmDialog: {
    width: 620,
    borderRadius: 8,
    backgroundColor: '#101820',
    borderColor: '#324555',
    borderWidth: 2,
    padding: 34,
  },
  confirmTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
  },
  confirmBody: {
    color: '#B8C5CC',
    fontSize: 22,
    lineHeight: 30,
    marginTop: 14,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 26,
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: '#25313A',
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    minWidth: 150,
  },
  dangerButton: {
    backgroundColor: '#5A2D36',
  },
  dangerFocused: {
    backgroundColor: '#7A3843',
  },
});
