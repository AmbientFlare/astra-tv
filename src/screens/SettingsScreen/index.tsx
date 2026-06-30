import React, {useCallback, useEffect, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView, useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {PreferenceRadioGroup} from '../../components/PreferenceRadioGroup';
import {APP_VERSION, BUILD_DATE} from '../../config/app';
import {
  defaultUserPreferences,
  DisplayPreferences,
  getDisplayPreferences,
  getUserPreferences,
  readServerProfiles,
  removeServerProfile,
  ServerProfile,
  setDisplayPreferences,
  signOutServerProfile,
  updateUserPreferences,
  UserPreferences,
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
  | {route: 'audioLanguage'}
  | {route: 'subtitleLanguage'}
  | {route: 'subtitleMode'}
  | {route: 'autoplay'}
  | {route: 'autoplayCountdown'}
  | {route: 'seekDuration'}
  | {route: 'skipIntro'};

interface SettingsScreenProps {
  onBack?: () => void;
  serverProfile: ServerProfile;
}

const bitrateOptions: Array<{
  label: string;
  value: UserPreferences['maxStreamingBitrate'];
}> = [
  {label: 'Auto', value: 'auto'},
  {label: '20 Mbps', value: '20000000'},
  {label: '12 Mbps', value: '12000000'},
  {label: '8 Mbps', value: '8000000'},
  {label: '4 Mbps', value: '4000000'},
  {label: '2 Mbps', value: '2000000'},
];

const languageOptions = ['English', 'Spanish', 'French', 'German', 'Japanese'];

export const SettingsScreen = ({
  onBack,
  serverProfile,
}: SettingsScreenProps) => {
  const [stack, setStack] = useState<SettingsRoute[]>([{route: 'preferences'}]);
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>(
    defaultUserPreferences,
  );
  const [displayPreferencesState, setDisplayPreferenceState] =
    useState<DisplayPreferences>({
      gridDirection: 'vertical',
      imageSize: 'medium',
      imageType: 'Primary',
    });
  const [confirmAction, setConfirmAction] = useState<{
    body: string;
    onConfirm: () => Promise<void>;
    title: string;
  } | null>(null);

  const current = stack[stack.length - 1];
  const push = (entry: SettingsRoute) => setStack((entries) => [...entries, entry]);
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
    getDisplayPreferences().then(setDisplayPreferenceState);
  }, [refreshProfiles]);

  useTVEventHandler((event) => {
    if (event.eventKeyAction === 1 || event.eventType !== 'back') {
      return;
    }

    if (confirmAction) {
      setConfirmAction(null);
    } else {
      pop();
    }
  });

  const savePreferences = async (patch: Partial<UserPreferences>) => {
    const next = await updateUserPreferences(patch);
    setPreferences(next);
  };

  const saveDisplayPrefs = async (next: DisplayPreferences) => {
    setDisplayPreferenceState(next);
    await setDisplayPreferences(next);
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
              subtitle={`${profiles.length} saved server${profiles.length === 1 ? '' : 's'}`}
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
            {profiles.map((profile) => (
              <MenuRow
                icon="▣"
                key={profile.id}
                title={profile.name}
                subtitle={profile.serverUrl}
                onPress={() => push({route: 'serverDetail', profile})}
              />
            ))}
          </Page>
        );
      case 'serverDetail':
        return (
          <Page title={current.profile.name} onBack={pop}>
            <Text style={styles.groupTitle}>Accounts</Text>
            <MenuRow
              icon="◉"
              title={current.profile.username ?? current.profile.userId}
              subtitle={`Last used on ${new Date(
                current.profile.lastUsed,
              ).toLocaleDateString()}`}
              onPress={() => push({route: 'accountDetail', profile: current.profile})}
            />
            <Text style={styles.groupTitle}>Server</Text>
            <DangerRow
              title="Remove server"
              subtitle={current.profile.serverUrl}
              onPress={() =>
                setConfirmAction({
                  title: 'Remove server?',
                  body: 'This removes the saved server profile from Astra.',
                  onConfirm: async () => {
                    await removeServerProfile(current.profile.id);
                    await refreshProfiles();
                    setStack([{route: 'preferences'}, {route: 'login'}, {route: 'manageServers'}]);
                  },
                })
              }
            />
          </Page>
        );
      case 'accountDetail':
        return (
          <Page title={current.profile.username ?? 'Account'} onBack={pop}>
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
                    setStack([{route: 'preferences'}, {route: 'login'}, {route: 'manageServers'}]);
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
            <PreferenceRadioGroup
              title="Grid direction"
              options={[
                {label: 'Vertical', value: 'vertical'},
                {label: 'Horizontal', value: 'horizontal'},
              ]}
              selectedValue={displayPreferencesState.gridDirection}
              onSelect={(gridDirection) =>
                saveDisplayPrefs({...displayPreferencesState, gridDirection})
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
              subtitle={bitrateOptions.find((o) => o.value === preferences.maxStreamingBitrate)?.label}
              onPress={() => push({route: 'maxBitrate'})}
            />
            <MenuRow icon="♫" title="Preferred audio language" subtitle={preferences.preferredAudioLanguage} onPress={() => push({route: 'audioLanguage'})} />
            <MenuRow icon="▱" title="Preferred subtitle language" subtitle={preferences.preferredSubtitleLanguage} onPress={() => push({route: 'subtitleLanguage'})} />
            <MenuRow icon="▰" title="Subtitle mode" subtitle={labelForSubtitleMode(preferences.subtitleMode)} onPress={() => push({route: 'subtitleMode'})} />
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
              <MenuRow icon="◷" title="Countdown duration" subtitle={`${preferences.nextEpisodeCountdownSeconds}s`} onPress={() => push({route: 'autoplayCountdown'})} />
            ) : null}
            <MenuRow icon="»" title="Seek duration" subtitle={`${preferences.seekDurationSeconds}s`} onPress={() => push({route: 'seekDuration'})} />
            <MenuRow icon="⊘" title="Skip intro/credits" subtitle={labelForSkip(preferences.skipIntroCredits)} onPress={() => push({route: 'skipIntro'})} />
          </Page>
        );
      case 'maxBitrate':
        return <RadioPage title="Max streaming bitrate" onBack={pop} options={bitrateOptions} selectedValue={preferences.maxStreamingBitrate} onSelect={(maxStreamingBitrate) => savePreferences({maxStreamingBitrate})} />;
      case 'audioLanguage':
        return <RadioPage title="Preferred audio language" onBack={pop} options={languageOptions.map((value) => ({label: value, value}))} selectedValue={preferences.preferredAudioLanguage} onSelect={(preferredAudioLanguage) => savePreferences({preferredAudioLanguage})} />;
      case 'subtitleLanguage':
        return <RadioPage title="Preferred subtitle language" onBack={pop} options={languageOptions.map((value) => ({label: value, value}))} selectedValue={preferences.preferredSubtitleLanguage} onSelect={(preferredSubtitleLanguage) => savePreferences({preferredSubtitleLanguage})} />;
      case 'subtitleMode':
        return <RadioPage title="Subtitle mode" onBack={pop} options={[
          {label: 'Default', value: 'default'},
          {label: 'Always On', value: 'alwaysOn'},
          {label: 'Always Off', value: 'alwaysOff'},
          {label: 'Only Forced', value: 'forcedOnly'},
        ]} selectedValue={preferences.subtitleMode} onSelect={(subtitleMode) => savePreferences({subtitleMode})} />;
      case 'autoplayCountdown':
        return <RadioPage title="Countdown duration" onBack={pop} options={[10, 15, 30].map((value) => ({label: `${value}s`, value: value as 10 | 15 | 30}))} selectedValue={preferences.nextEpisodeCountdownSeconds} onSelect={(nextEpisodeCountdownSeconds) => savePreferences({nextEpisodeCountdownSeconds})} />;
      case 'seekDuration':
        return <RadioPage title="Seek duration" onBack={pop} options={[10, 15, 30, 60].map((value) => ({label: `${value}s`, value: value as 10 | 15 | 30 | 60}))} selectedValue={preferences.seekDurationSeconds} onSelect={(seekDurationSeconds) => savePreferences({seekDurationSeconds})} />;
      case 'skipIntro':
        return <RadioPage title="Skip intro/credits" onBack={pop} options={[
          {label: 'Ask', value: 'ask'},
          {label: 'Auto-skip', value: 'auto'},
          {label: 'Ignore', value: 'ignore'},
        ]} selectedValue={preferences.skipIntroCredits} onSelect={(skipIntroCredits) => savePreferences({skipIntroCredits})} />;
      case 'about':
        return (
          <Page title="About" onBack={pop}>
            <View style={styles.about}>
              <Text style={styles.aboutText}>Astra {APP_VERSION}</Text>
              <Text style={styles.aboutText}>Build date: {BUILD_DATE}</Text>
              <Text style={styles.aboutText}>Device: Vega / Fire TV</Text>
              <Text style={styles.aboutText}>Server: {serverProfile.name}</Text>
              <Text style={styles.aboutText}>URL: {serverProfile.serverUrl}</Text>
              <Text style={styles.aboutText}>License: GPL-3.0</Text>
              <Text style={styles.aboutText}>Open source: React, React Native, Amazon Vega SDK, Jellyfin API</Text>
              <Text style={styles.aboutText}>Support: ko-fi.com/astratv</Text>
              <Image source={require('../../assets/kofi-qr.png')} style={styles.qrImage} />
              <Text style={styles.easterEgg}>{EASTER_EGG_TEXT}</Text>
            </View>
          </Page>
        );
      case 'preferences':
      default:
        return (
          <Page title="Preferences" subtitle={serverProfile.name} onBack={onBack}>
            <MenuRow icon="⇥" title="Login" subtitle="Servers, accounts, automatic sign in" onPress={() => push({route: 'login'})} preferred />
            <MenuRow icon="▧" title="Customization" subtitle="Home layout, display preferences" onPress={() => push({route: 'customization'})} />
            <MenuRow icon="▶" title="Playback" subtitle="Video, subtitles, next up" onPress={() => push({route: 'playback'})} />
            <MenuRow icon="ⓘ" title="About" subtitle="Version, device info, licenses" onPress={() => push({route: 'about'})} />
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

const labelForSubtitleMode = (mode: UserPreferences['subtitleMode']) =>
  ({
    alwaysOff: 'Always Off',
    alwaysOn: 'Always On',
    default: 'Default',
    forcedOnly: 'Only Forced',
  }[mode]);

const labelForSkip = (mode: UserPreferences['skipIntroCredits']) =>
  ({ask: 'Ask', auto: 'Auto-skip', ignore: 'Ignore'}[mode]);

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
    <FocusableItem focusedStyle={styles.rowFocused} onPress={onBack} style={styles.backButton} testID="settings-back-button">
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
  <FocusableItem hasTVPreferredFocus={preferred} focusedStyle={styles.rowFocused} onPress={onPress} style={styles.menuRow} testID={`settings-${title}`}>
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
  <FocusableItem focusedStyle={styles.rowFocused} onPress={onToggle} style={styles.menuRow} testID={`settings-toggle-${title}`}>
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
        <FocusableItem hasTVPreferredFocus focusedStyle={styles.rowFocused} onPress={onCancel} style={styles.confirmButton}>
          <Text style={styles.backText}>Cancel</Text>
        </FocusableItem>
        <FocusableItem focusedStyle={styles.dangerFocused} onPress={onConfirm} style={[styles.confirmButton, styles.dangerButton]}>
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
  qrImage: {
    width: 132,
    height: 132,
    borderRadius: 8,
    marginTop: 10,
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
