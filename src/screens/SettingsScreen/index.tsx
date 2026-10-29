import React, {useCallback, useEffect, useState} from 'react';
import {Text} from 'react-native';

import {useKeplerBackHandler} from '@amazon-devices/react-native-kepler';

import {PreferenceRadioGroup} from '../../components/PreferenceRadioGroup';

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
  updateUserPreferences,
  UserPreferences,
  writePlaybackPreferences,
} from '../../services/storage';
import {
  getServerCapabilities,
  serverCapabilityKey,
  updateServerCapabilities,
} from '../../services/serverCapabilities';
import type {ServerCapabilities} from '../../services/serverCapabilities';
import {
  getLocale,
  getLocaleTag,
  LANGUAGES,
  t,
  tn,
  useChangeLanguage,
} from '../../i18n';
import type {SettingsRoute} from './types';
import {
  audioChannelOptions,
  audioLanguageOptions,
  bitrateOptions,
  capabilitySourceNote,
  fallbackLanguageOptions,
  hlsSegmentLengthOptions,
  labelForSkip,
  labelForStillWatching,
  labelForSubtitleMode,
  languageOptions,
  subtitleAppearanceOptions,
  subtitleModeOptions,
  videoTranscodeOptions,
} from './options';
import {styles} from './styles';
import {
  ConfirmDialog,
  DangerRow,
  MenuRow,
  Page,
  RadioPage,
  ToggleRow,
} from './widgets';
import {AboutPage} from './AboutPage';
import {ConnectionTestPage} from './ConnectionTestPage';
import {LiveConnectionPage} from './LiveConnectionPage';
import {SyncPlayPage} from './SyncPlayPage';
import {TelemetryPage} from './TelemetryPage';

interface SettingsScreenProps {
  onAddServer?: () => void;
  onBack?: () => void;
  serverProfile: ServerProfile;
}

export const SettingsScreen = ({
  onAddServer,
  onBack,
  serverProfile,
}: SettingsScreenProps) => {
  const keplerBackHandler = useKeplerBackHandler();
  const changeLanguage = useChangeLanguage();
  const [stack, setStack] = useState<SettingsRoute[]>([{route: 'preferences'}]);
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
        return <TelemetryPage onBack={pop} />;
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
        return <AboutPage onBack={pop} />;
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
