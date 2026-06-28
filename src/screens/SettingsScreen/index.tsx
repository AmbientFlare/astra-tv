import React from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../../components/FocusableItem';
import {ServerProfile} from '../../services/storage';

interface SettingsScreenProps {
  onBack?: () => void;
  serverProfile: ServerProfile;
}

const settingGroups = [
  {
    title: 'Server',
    rows: ['Manage servers', 'Switch user', 'Sign out'],
  },
  {
    title: 'Playback Defaults',
    rows: [
      'Preferred audio language',
      'Preferred subtitles',
      'Maximum bitrate',
    ],
  },
  {
    title: 'Library',
    rows: ['Poster size', 'Watched indicators', 'Home rows'],
  },
];

export const SettingsScreen = ({
  onBack,
  serverProfile,
}: SettingsScreenProps) => (
  <ScrollView style={styles.screen} testID="settings-screen">
    <Text style={styles.title}>Settings</Text>
    <Text style={styles.subtitle}>{serverProfile.name}</Text>
    <FocusableItem
      focusedStyle={styles.rowFocused}
      onPress={onBack}
      style={styles.backButton}
      testID="settings-back-button">
      <Text style={styles.backText}>Back</Text>
    </FocusableItem>
    {settingGroups.map((group) => (
      <View key={group.title} style={styles.group}>
        <Text style={styles.groupTitle}>{group.title}</Text>
        {group.rows.map((row) => (
          <FocusableItem
            focusedStyle={styles.rowFocused}
            key={row}
            style={styles.row}
            testID={`settings-${row}`}>
            <Text style={styles.rowText}>{row}</Text>
            <Text style={styles.rowValue}>Planned</Text>
          </FocusableItem>
        ))}
      </View>
    ))}
    <View style={styles.group}>
      <Text style={styles.groupTitle}>About</Text>
      <View style={styles.about}>
        <Text style={styles.aboutText}>Astra 0.1.0</Text>
        <Text style={styles.aboutText}>GPL-3.0 licensed media client</Text>
        <Text style={styles.aboutText}>
          Backends: Jellyfin now, Kodi and Emby planned
        </Text>
        <Text style={styles.aboutText}>Support: ko-fi.com/astratv</Text>
        <Image
          source={require('../../assets/kofi-qr.png')}
          style={styles.qrImage}
        />
      </View>
    </View>
  </ScrollView>
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
    width: 860,
  },
  groupTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 14,
  },
  row: {
    height: 62,
    borderRadius: 8,
    backgroundColor: '#182027',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 18,
  },
  rowFocused: {
    backgroundColor: '#2E5A72',
  },
  rowText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  rowValue: {
    color: '#B8C5CC',
    fontSize: 20,
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
  qrImage: {
    width: 132,
    height: 132,
    borderRadius: 8,
    marginTop: 10,
  },
});
