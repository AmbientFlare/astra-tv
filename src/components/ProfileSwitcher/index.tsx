import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../FocusableItem';
import {
  getUserPreferences,
  readServerProfiles,
  ServerProfile,
} from '../../services/storage';
import {t} from '../../i18n';
import {colors} from '../../theme';

interface ProfileSwitcherProps {
  currentProfileId?: string;
  onAddUser: () => void;
  onClose: () => void;
  onSelect: (profile: ServerProfile) => void;
}

const displayName = (profile: ServerProfile) =>
  profile.username ?? profile.name ?? t('profiles.user');

export const ProfileSwitcher = ({
  currentProfileId,
  onAddUser,
  onClose,
  onSelect,
}: ProfileSwitcherProps) => {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const firstRowRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const [saved, preferences] = await Promise.all([
        readServerProfiles(),
        getUserPreferences(),
      ]);

      if (!mounted) {
        return;
      }

      const sorted = [...saved].sort((left, right) =>
        preferences.accountSortBy === 'name'
          ? displayName(left).localeCompare(displayName(right))
          : right.lastUsed - left.lastUsed,
      );

      setProfiles(sorted);
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  // The rows arrive after the screen behind has claimed focus, so
  // hasTVPreferredFocus alone leaves the remote driving the screen behind.
  useEffect(() => {
    const timer = setTimeout(() => {
      firstRowRef.current?.requestTVFocus?.();
    }, 120);
    return () => clearTimeout(timer);
  }, [profiles]);

  return (
    <View style={styles.overlay} testID="profile-switcher">
      <TVFocusGuideView
        autoFocus
        style={styles.dialog}
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp>
        <Text style={styles.title}>{t('profiles.title')}</Text>
        <ScrollView style={styles.list}>
          <TVFocusGuideView style={styles.listContent}>
            {profiles.map((profile, index) => {
              const isCurrent = profile.id === currentProfileId;
              const signedOut = !profile.accessToken;

              return (
                <FocusableItem
                  focusRef={index === 0 ? firstRowRef : undefined}
                  focusedStyle={styles.rowFocused}
                  hasTVPreferredFocus={index === 0}
                  key={profile.id}
                  onPress={() => (isCurrent ? onClose() : onSelect(profile))}
                  style={[styles.row, isCurrent && styles.rowCurrent]}
                  testID={`profile-switcher-${profile.id}`}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {displayName(profile).slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text numberOfLines={1} style={styles.rowName}>
                      {displayName(profile)}
                    </Text>
                    <Text numberOfLines={1} style={styles.rowServer}>
                      {profile.name}
                      {signedOut ? `  ·  ${t('profiles.signedOut')}` : ''}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <Text style={styles.currentTag}>
                      {t('profiles.current')}
                    </Text>
                  ) : null}
                </FocusableItem>
              );
            })}
            <FocusableItem
              focusRef={profiles.length === 0 ? firstRowRef : undefined}
              focusedStyle={styles.rowFocused}
              hasTVPreferredFocus={profiles.length === 0}
              onPress={onAddUser}
              style={styles.row}
              testID="profile-switcher-add">
              <View style={[styles.avatar, styles.avatarAdd]}>
                <Text style={styles.avatarText}>+</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName}>{t('profiles.addUser')}</Text>
                <Text style={styles.rowServer}>
                  {t('profiles.addUserHint')}
                </Text>
              </View>
            </FocusableItem>
          </TVFocusGuideView>
        </ScrollView>
        <Text style={styles.hint}>{t('common.pressBackToClose')}</Text>
      </TVFocusGuideView>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: colors.scrim.strong,
    justifyContent: 'center',
    padding: 64,
  },
  dialog: {
    width: 640,
    maxHeight: 760,
    borderRadius: 8,
    backgroundColor: colors.surface.sunken,
    borderColor: colors.border.subtle,
    borderWidth: 2,
    padding: 36,
  },
  title: {
    color: colors.text.primary,
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 22,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 14,
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface.raised,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 18,
    padding: 16,
  },
  rowCurrent: {
    backgroundColor: colors.surface.selected,
  },
  rowFocused: {
    backgroundColor: colors.surface.focus,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surface.focus,
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  avatarAdd: {
    backgroundColor: colors.surface.control,
  },
  avatarText: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '800',
  },
  rowBody: {
    flex: 1,
  },
  rowName: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '700',
  },
  rowServer: {
    color: colors.text.secondary,
    fontSize: 18,
    marginTop: 2,
  },
  currentTag: {
    color: colors.text.accent,
    fontSize: 18,
    fontWeight: '700',
  },
  hint: {
    color: colors.text.faint,
    fontSize: 18,
    marginTop: 20,
  },
});
