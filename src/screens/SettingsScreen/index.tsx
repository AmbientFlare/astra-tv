import React, {useCallback, useEffect, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  TVFocusGuideView,
  useKeplerBackHandler,
} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {PreferenceRadioGroup} from '../../components/PreferenceRadioGroup';
import {measureServerBandwidth} from '../../services/jellyfin';
import {APP_VERSION, BUILD_DATE, BUILD_NUMBER} from '../../config/app';
import {
  defaultUserPreferences,
  defaultPlaybackPrefs,
  DisplayPreferences,
  getDisplayPreferences,
  getUserPreferences,
  markServerProfileUsed,
  PlaybackPreferences,
  readPlaybackPreferences,
  readServerProfiles,
  removeServerProfile,
  ServerProfile,
  setDisplayPreferences,
  signOutServerProfile,
  updateUserPreferences,
  UserPreferences,
  writePlaybackPreferences,
} from '../../services/storage';

const EASTER_EGG_TEXT =
  'For Kimberly — whose love of Star Trek started all of this.';

type SettingsRoute =
  | {route: 'preferences'}
  | {route: 'login'}
  | {route: 'customization'}
  | {route: 'playback'}
  | {route: 'about'}
  | {route: 'autoSignIn'}
  | {route: 'accountSort'}
  | {route: 'manageServers'}
  | {route: 'serverDetail'; profile: ServerProfile}
  | {route: 'accountDetail'; profile: ServerProfile}
  | {route: 'homeSections'}
  | {route: 'displayPreferences'}
  | {route: 'maxBitrate'}
  | {route: 'connectionTest'}
  | {route: 'audioChannels'}
  | {route: 'audioLanguage'}
  | {route: 'subtitleLanguage'}
  | {route: 'subtitleMode'}
  | {route: 'autoplay'}
  | {route: 'autoplayCountdown'}
  | {route: 'seekDuration'}
  | {route: 'skipIntro'};

interface SettingsScreenProps {
  onAddServer?: () => void;
  onBack?: () => void;
  onSelectProfile?: (profile: ServerProfile | null) => void;
  serverProfile: ServerProfile;
}

const bitrateOptions: Array<{
  label: string;
  value: PlaybackPreferences['maxBitrateBps'];
}> = [
  {label: '40 Mbps', value: 40000000},
  {label: '80 Mbps', value: 80000000},
  {label: '120 Mbps', value: 120000000},
  {label: 'Unlimited', value: 200000000},
];

const audioChannelOptions: Array<{
  label: string;
  value: PlaybackPreferences['maxAudioChannels'];
}> = [
  {label: 'Stereo (2.0)', value: 2},
  {label: '5.1 Surround', value: 6},
  {label: '7.1 Surround', value: 8},
];

const languageOptions: Array<{label: string; value: string}> = [
  {label: 'English', value: 'en'},
  {label: 'Spanish', value: 'es'},
  {label: 'French', value: 'fr'},
  {label: 'German', value: 'de'},
  {label: 'Japanese', value: 'ja'},
  {label: 'Portuguese', value: 'pt'},
  {label: 'Italian', value: 'it'},
  {label: 'Korean', value: 'ko'},
];

export const SettingsScreen = ({
  onAddServer,
  onBack,
  onSelectProfile,
  serverProfile,
}: SettingsScreenProps) => {
  const keplerBackHandler = useKeplerBackHandler();
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

  useEffect(() => {
    refreshProfiles();
    getUserPreferences().then(setPreferences);
    readPlaybackPreferences().then(setPlaybackPrefs);
    getDisplayPreferences().then(setDisplayPreferenceState);
  }, [refreshProfiles]);

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

  const serverGroups = profiles.reduce<
    Array<{serverId: string; serverName: string; accounts: ServerProfile[]}>
  >((groups, profile) => {
    const serverId = profile.serverId ?? profile.id;
    const group = groups.find((entry) => entry.serverId === serverId);

    if (group) {
      group.accounts.push(profile);
    } else {
      groups.push({
        serverId,
        serverName: profile.name,
        accounts: [profile],
      });
    }

    return groups;
  }, []);

  const sortedAccounts = (accounts: ServerProfile[]) =>
    [...accounts].sort((left, right) =>
      preferences.accountSortBy === 'name'
        ? (left.username ?? left.userId).localeCompare(
            right.username ?? right.userId,
          )
        : right.lastUsed - left.lastUsed,
    );

  const selectFallbackProfile = async (removedProfileIds: string[]) => {
    const remainingProfiles = (await readServerProfiles())
      .filter(
        (profile) =>
          profile.accessToken && !removedProfileIds.includes(profile.id),
      )
      .sort((left, right) => right.lastUsed - left.lastUsed);

    onSelectProfile?.(remainingProfiles[0] ?? null);
  };

  const page = (() => {
    switch (current.route) {
      case 'login':
        return (
          <Page title="Login" onBack={pop}>
            <MenuRow
              icon="⇥"
              title="Automatic sign in"
              subtitle={
                preferences.autoSignIn === 'mostRecent'
                  ? 'Most Recently Used'
                  : 'Disabled'
              }
              onPress={() => push({route: 'autoSignIn'})}
            />
            <MenuRow
              icon="↕"
              title="Sort accounts by"
              subtitle={
                preferences.accountSortBy === 'lastUsed'
                  ? 'Most Recently Used'
                  : 'Name'
              }
              onPress={() => push({route: 'accountSort'})}
            />
            <MenuRow
              icon="▣"
              title="Manage servers"
              subtitle={`${serverGroups.length} saved server${
                serverGroups.length === 1 ? '' : 's'
              }`}
              onPress={() => push({route: 'manageServers'})}
            />
          </Page>
        );
      case 'autoSignIn':
        return (
          <RadioPage
            title="Automatic sign in"
            onBack={pop}
            options={[
              {label: 'Disable', value: 'disabled'},
              {label: 'Most Recently Used', value: 'mostRecent'},
            ]}
            selectedValue={preferences.autoSignIn}
            onSelect={(autoSignIn) => savePreferences({autoSignIn})}
          />
        );
      case 'accountSort':
        return (
          <RadioPage
            title="Sort accounts by"
            onBack={pop}
            options={[
              {label: 'Most Recently Used', value: 'lastUsed'},
              {label: 'Name', value: 'name'},
            ]}
            selectedValue={preferences.accountSortBy}
            onSelect={(accountSortBy) => savePreferences({accountSortBy})}
          />
        );
      case 'manageServers':
        return (
          <Page title="Manage servers" onBack={pop}>
            <MenuRow
              icon="+"
              preferred
              title="Add server"
              subtitle="Connect another media server"
              onPress={onAddServer}
            />
            {profiles.length === 0 ? (
              <Text style={styles.infoText}>No saved servers yet.</Text>
            ) : null}
            {serverGroups.map((group) => (
              <MenuRow
                icon="▣"
                key={group.serverId}
                title={group.serverName}
                subtitle={`${group.accounts.length} account${
                  group.accounts.length === 1 ? '' : 's'
                } • ${group.accounts[0]?.serverUrl ?? ''}`}
                onPress={() =>
                  push({route: 'serverDetail', profile: group.accounts[0]})
                }
              />
            ))}
          </Page>
        );
      case 'serverDetail': {
        const serverAccounts = sortedAccounts(
          profiles.filter(
            (profile) =>
              (profile.serverId ?? profile.id) ===
              (current.profile.serverId ?? current.profile.id),
          ),
        );

        return (
          <Page title={current.profile.name} onBack={pop}>
            <Text style={styles.groupTitle}>Accounts</Text>
            {serverAccounts.map((profile) => (
              <MenuRow
                icon={profile.id === serverProfile.id ? '●' : '○'}
                key={profile.id}
                title={profile.username ?? profile.userId}
                subtitle={`Last used on ${new Date(
                  profile.lastUsed,
                ).toLocaleDateString()}`}
                onPress={() => push({route: 'accountDetail', profile})}
              />
            ))}
            <Text style={styles.groupTitle}>Server</Text>
            <DangerRow
              title="Remove server"
              subtitle={current.profile.serverUrl}
              onPress={() =>
                setConfirmAction({
                  title: 'Remove server?',
                  body: 'This removes the saved server profile from Astra.',
                  onConfirm: async () => {
                    const removedProfileIds = serverAccounts.map(
                      (profile) => profile.id,
                    );
                    await Promise.all(
                      serverAccounts.map((profile) =>
                        removeServerProfile(profile.id),
                      ),
                    );
                    await refreshProfiles();
                    if (removedProfileIds.includes(serverProfile.id)) {
                      await selectFallbackProfile(removedProfileIds);
                    }
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
          <Page title={current.profile.username ?? 'Account'} onBack={pop}>
            <MenuRow
              icon="✓"
              title="Use this account"
              subtitle={current.profile.name}
              onPress={async () => {
                const updatedProfile = await markServerProfileUsed(
                  current.profile.id,
                );
                await refreshProfiles();
                onSelectProfile?.(updatedProfile ?? current.profile);
                setStack([{route: 'preferences'}]);
              }}
            />
            <DangerRow
              title="Sign out"
              subtitle="Requires login on next use"
              onPress={() =>
                setConfirmAction({
                  title: 'Sign out?',
                  body: 'This clears the stored access token but keeps the server entry.',
                  onConfirm: async () => {
                    await signOutServerProfile(current.profile.id);
                    await refreshProfiles();
                    if (current.profile.id === serverProfile.id) {
                      await selectFallbackProfile([current.profile.id]);
                    }
                    pop();
                  },
                })
              }
            />
            <DangerRow
              title="Remove"
              subtitle="Remove account"
              onPress={() =>
                setConfirmAction({
                  title: 'Remove account?',
                  body: 'This deletes the saved account profile.',
                  onConfirm: async () => {
                    await removeServerProfile(current.profile.id);
                    await refreshProfiles();
                    if (current.profile.id === serverProfile.id) {
                      await selectFallbackProfile([current.profile.id]);
                    }
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
          <Page title="Customization" onBack={pop}>
            <MenuRow
              icon="☰"
              title="Home sections"
              subtitle="Choose visible Home rows"
              onPress={() => push({route: 'homeSections'})}
            />
            <MenuRow
              icon="▧"
              title="Display preferences"
              subtitle="Image size, image type, grid direction"
              onPress={() => push({route: 'displayPreferences'})}
            />
            <ToggleRow
              title="Focused backdrop blur"
              subtitle="Show blurred art behind browsing screens"
              value={preferences.focusedBackdropEnabled}
              onToggle={() =>
                savePreferences({
                  focusedBackdropEnabled: !preferences.focusedBackdropEnabled,
                })
              }
            />
          </Page>
        );
      case 'homeSections':
        return (
          <Page title="Home sections" onBack={pop}>
            {[
              ['myMedia', 'My Media'],
              ['continueWatching', 'Continue Watching'],
              ['nextUp', 'Next Up'],
              ['latestMovies', 'Latest Movies'],
              ['latestShows', 'Latest Shows'],
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
          <Page title="Display preferences" onBack={pop}>
            <PreferenceRadioGroup
              title="Image size"
              options={[
                {label: 'Small', value: 'small'},
                {label: 'Medium', value: 'medium'},
                {label: 'Large', value: 'large'},
              ]}
              selectedValue={displayPreferencesState.imageSize}
              onSelect={(imageSize) =>
                saveDisplayPrefs({...displayPreferencesState, imageSize})
              }
            />
            <PreferenceRadioGroup
              title="Image type"
              options={[
                {label: 'Poster', value: 'Primary'},
                {label: 'Thumb', value: 'Thumb'},
                {label: 'Banner', value: 'Banner'},
              ]}
              selectedValue={displayPreferencesState.imageType}
              onSelect={(imageType) =>
                saveDisplayPrefs({...displayPreferencesState, imageType})
              }
            />
          </Page>
        );
      case 'playback':
        return (
          <Page title="Playback" onBack={pop}>
            {/* Wired now: max bitrate and seek duration. Other playback
                choices persist as UI state until player support exists. */}
            <MenuRow
              icon="↯"
              title="Max streaming bitrate"
              subtitle={
                bitrateOptions.find(
                  (o) => o.value === playbackPrefs.maxBitrateBps,
                )?.label
              }
              onPress={() => push({route: 'maxBitrate'})}
            />
            <MenuRow
              icon="⇄"
              title="Test server connection"
              subtitle="Measure download speed and get a bitrate recommendation"
              onPress={() => push({route: 'connectionTest'})}
            />
            <MenuRow
              icon="◎"
              title="Audio output"
              subtitle="Match your TV or receiver's channel capability"
              onPress={() => push({route: 'audioChannels'})}
            />
            <MenuRow
              icon="♫"
              title="Preferred audio language"
              subtitle={
                languageOptions.find(
                  (o) => o.value === playbackPrefs.preferredAudioLanguage,
                )?.label ?? 'English'
              }
              onPress={() => push({route: 'audioLanguage'})}
            />
            <MenuRow
              icon="▱"
              title="Preferred subtitle language"
              subtitle={
                languageOptions.find(
                  (o) => o.value === playbackPrefs.preferredSubtitleLanguage,
                )?.label ?? 'English'
              }
              onPress={() => push({route: 'subtitleLanguage'})}
            />
            <MenuRow
              icon="▰"
              title="Subtitle mode"
              subtitle={labelForSubtitleMode(playbackPrefs.subtitleMode)}
              onPress={() => push({route: 'subtitleMode'})}
            />
            <ToggleRow
              title="Next episode autoplay"
              subtitle={`Countdown: ${preferences.nextEpisodeCountdownSeconds}s`}
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
                title="Countdown duration"
                subtitle={`${preferences.nextEpisodeCountdownSeconds}s`}
                onPress={() => push({route: 'autoplayCountdown'})}
              />
            ) : null}
            <MenuRow
              icon="»"
              title="Seek duration"
              subtitle={`${playbackPrefs.seekDurationSeconds}s`}
              onPress={() => push({route: 'seekDuration'})}
            />
            <MenuRow
              icon="⊘"
              title="Skip intro/credits"
              subtitle={labelForSkip(preferences.skipIntroCredits)}
              onPress={() => push({route: 'skipIntro'})}
            />
          </Page>
        );
      case 'maxBitrate':
        return (
          <RadioPage
            title="Max streaming bitrate"
            onBack={pop}
            options={bitrateOptions}
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
      case 'audioChannels':
        return (
          <Page title="Audio output" onBack={pop}>
            <Text style={styles.description}>
              Match your TV, soundbar, or receiver's channel capability
            </Text>
            <PreferenceRadioGroup
              options={audioChannelOptions}
              selectedValue={playbackPrefs.maxAudioChannels}
              onSelect={(maxAudioChannels) =>
                savePlaybackPrefs({maxAudioChannels})
              }
            />
            <Text style={styles.infoText}>
              7.1 requires direct play. Transcoded audio is 5.1 maximum.
            </Text>
          </Page>
        );
      case 'audioLanguage':
        return (
          <Page title="Preferred audio language" onBack={pop}>
            <Text style={styles.description}>
              Astra will select this language track when available
            </Text>
            {/* Fixed v1 list; later this can expand from Jellyfin item language data. */}
            <PreferenceRadioGroup
              options={languageOptions}
              selectedValue={playbackPrefs.preferredAudioLanguage}
              onSelect={(preferredAudioLanguage) =>
                savePlaybackPrefs({preferredAudioLanguage})
              }
            />
          </Page>
        );
      case 'subtitleLanguage':
        return (
          <RadioPage
            title="Preferred subtitle language"
            onBack={pop}
            options={languageOptions}
            selectedValue={playbackPrefs.preferredSubtitleLanguage}
            onSelect={(preferredSubtitleLanguage) =>
              savePlaybackPrefs({preferredSubtitleLanguage})
            }
          />
        );
      case 'subtitleMode':
        return (
          <RadioPage
            title="Subtitle mode"
            onBack={pop}
            options={[
              {label: 'Always On', value: 'alwaysOn'},
              {label: 'Always Off', value: 'alwaysOff'},
            ]}
            selectedValue={playbackPrefs.subtitleMode}
            onSelect={(subtitleMode) => savePlaybackPrefs({subtitleMode})}
          />
        );
      case 'autoplayCountdown':
        return (
          <RadioPage
            title="Countdown duration"
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
            title="Seek duration"
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
      case 'skipIntro':
        return (
          <RadioPage
            title="Skip intro/credits"
            onBack={pop}
            options={[
              {label: 'Ask', value: 'ask'},
              {label: 'Auto-skip', value: 'auto'},
              {label: 'Ignore', value: 'ignore'},
            ]}
            selectedValue={preferences.skipIntroCredits}
            onSelect={(skipIntroCredits) => savePreferences({skipIntroCredits})}
          />
        );
      case 'about':
        return (
          <Page title="About" onBack={pop}>
            <View style={styles.about}>
              <Text style={styles.aboutText}>Astra {APP_VERSION}</Text>
              <Text style={styles.aboutText}>Build: {BUILD_NUMBER}</Text>
              <Text style={styles.aboutText}>Build date: {BUILD_DATE}</Text>
              <Text style={styles.aboutText}>
                License: Astra Source-Available License v1.0
              </Text>
              <Text style={styles.aboutText}>
                Open source: React, React Native
              </Text>
              <Text style={styles.aboutText}>
                Compatible with: Jellyfin (trademark of its respective owners)
              </Text>
              <Text style={styles.aboutText}>
                Support: ko-fi.com/astrafiretv
              </Text>
              <Text style={styles.aboutText}>Website: watchastra.com</Text>
              <Text style={styles.aboutText}>
                Source: github.com/AmbientFlare/astra-tv
              </Text>
              <View style={styles.qrRow}>
                <Image
                  source={require('../../assets/kofi-qr.png')}
                  style={styles.qrImage}
                />
                <Image
                  source={require('../../assets/source-qr.png')}
                  style={styles.qrImage}
                />
              </View>
              <Text style={styles.easterEgg}>{EASTER_EGG_TEXT}</Text>
            </View>
          </Page>
        );
      case 'preferences':
      default:
        return (
          <Page
            title="Preferences"
            subtitle={serverProfile.name}
            onBack={onBack}>
            <MenuRow
              icon="⇥"
              title="Login"
              subtitle="Servers, accounts, automatic sign in"
              onPress={() => push({route: 'login'})}
              preferred
            />
            <MenuRow
              icon="▧"
              title="Customization"
              subtitle="Home layout, display preferences"
              onPress={() => push({route: 'customization'})}
            />
            <MenuRow
              icon="▶"
              title="Playback"
              subtitle="Video, subtitles, next up"
              onPress={() => push({route: 'playback'})}
            />
            <MenuRow
              icon="ⓘ"
              title="About"
              subtitle="Version, device info, licenses"
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

const labelForSubtitleMode = (mode: PlaybackPreferences['subtitleMode']) =>
  ({
    alwaysOff: 'Always Off',
    alwaysOn: 'Always On',
  }[mode]);

const labelForSkip = (mode: UserPreferences['skipIntroCredits']) =>
  ({ask: 'Ask', auto: 'Auto-skip', ignore: 'Ignore'}[mode]);

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
        error instanceof Error ? error.message : 'Connection test failed.',
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
      : [...bitrateOptions]
          .sort((a, b) => b.value - a.value)
          .find((option) => option.value <= usableBps) ?? bitrateOptions[0];
  const belowLowestOption =
    usableBps !== null && suggestion !== null
      ? usableBps < suggestion.value
      : false;

  return (
    <Page title="Test server connection" onBack={onBack}>
      <Text style={styles.description}>
        Downloads test data from {serverProfile.name || 'your server'} to
        measure real throughput between this device and the server.
      </Text>
      <MenuRow
        icon="⇄"
        preferred={true}
        title={phase === 'testing' ? 'Testing… (about 20 MB)' : 'Run test'}
        subtitle={phase === 'testing' ? 'This takes a few seconds' : undefined}
        onPress={phase === 'testing' ? undefined : runTest}
      />
      {phase === 'done' && measuredBps !== null && suggestion ? (
        <>
          <Text style={styles.infoText}>
            Measured speed: {(measuredBps / 1000000).toFixed(0)} Mbps
          </Text>
          {belowLowestOption ? (
            <Text style={styles.infoText}>
              Your connection is slower than the lowest bitrate cap. Playback of
              high-bitrate files may buffer; the server will transcode them down
              to fit.
            </Text>
          ) : null}
          <MenuRow
            icon="↯"
            title={`Set max bitrate to ${suggestion.label}`}
            subtitle={
              suggestion.value === currentMaxBitrateBps
                ? 'Already your current setting'
                : `Currently ${
                    bitrateOptions.find((o) => o.value === currentMaxBitrateBps)
                      ?.label ?? 'unknown'
                  }`
            }
            onPress={() => {
              onApplyBitrate(suggestion.value);
              onBack();
            }}
          />
          <Text style={styles.infoText}>
            If playback stutters or buffers, lower the max bitrate. If your
            network is fast and files look soft, raise it.
          </Text>
        </>
      ) : null}
      {phase === 'error' && errorText ? (
        <Text style={styles.infoText}>{errorText}</Text>
      ) : null}
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
      <Text style={styles.backText}>Back</Text>
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
          <Text style={styles.backText}>Cancel</Text>
        </FocusableItem>
        <FocusableItem
          focusedStyle={styles.dangerFocused}
          onPress={onConfirm}
          style={[styles.confirmButton, styles.dangerButton]}>
          <Text style={styles.backText}>Confirm</Text>
        </FocusableItem>
      </TVFocusGuideView>
    </View>
  </View>
);

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
    width: 132,
    height: 132,
    borderRadius: 8,
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
