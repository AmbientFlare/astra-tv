import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../FocusableItem';
import {
  getUserPreferences,
  readServerProfiles,
  ServerProfile,
} from '../../services/storage';

interface ProfileSwitcherProps {
  currentProfileId?: string;
  onAddUser: () => void;
  onClose: () => void;
  onSelect: (profile: ServerProfile) => void;
}

const displayName = (profile: ServerProfile) =>
  profile.username ?? profile.name ?? 'User';

export const ProfileSwitcher = ({
  currentProfileId,
  onAddUser,
  onClose,
  onSelect,
}: ProfileSwitcherProps) => {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);

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

  return (
    <View style={styles.overlay} testID="profile-switcher">
      <View style={styles.dialog}>
        <Text style={styles.title}>Who's watching?</Text>
        <ScrollView style={styles.list}>
          <TVFocusGuideView style={styles.listContent}>
            {profiles.map((profile, index) => {
              const isCurrent = profile.id === currentProfileId;
              const signedOut = !profile.accessToken;

              return (
                <FocusableItem
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
                      {signedOut ? '  ·  Signed out' : ''}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <Text style={styles.currentTag}>Current</Text>
                  ) : null}
                </FocusableItem>
              );
            })}
            <FocusableItem
              focusedStyle={styles.rowFocused}
              hasTVPreferredFocus={profiles.length === 0}
              onPress={onAddUser}
              style={styles.row}
              testID="profile-switcher-add">
              <View style={[styles.avatar, styles.avatarAdd]}>
                <Text style={styles.avatarText}>+</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName}>Add user</Text>
                <Text style={styles.rowServer}>
                  Sign in on this or another server
                </Text>
              </View>
            </FocusableItem>
          </TVFocusGuideView>
        </ScrollView>
        <Text style={styles.hint}>Press Back to close</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.74)',
    justifyContent: 'center',
    padding: 64,
  },
  dialog: {
    width: 640,
    maxHeight: 760,
    borderRadius: 8,
    backgroundColor: '#101820',
    borderColor: '#324555',
    borderWidth: 2,
    padding: 36,
  },
  title: {
    color: '#FFFFFF',
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
    backgroundColor: '#1A252E',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 18,
    padding: 16,
  },
  rowCurrent: {
    backgroundColor: '#22333F',
  },
  rowFocused: {
    backgroundColor: '#315066',
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#2E5A72',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  avatarAdd: {
    backgroundColor: '#25313A',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  rowBody: {
    flex: 1,
  },
  rowName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  rowServer: {
    color: '#B8C5CC',
    fontSize: 18,
    marginTop: 2,
  },
  currentTag: {
    color: '#4CC9F0',
    fontSize: 18,
    fontWeight: '700',
  },
  hint: {
    color: '#6E7F8A',
    fontSize: 18,
    marginTop: 20,
  },
});
