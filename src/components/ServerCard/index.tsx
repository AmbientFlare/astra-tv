import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../FocusableItem';
import {ServerProfile} from '../../services/storage';

interface ServerCardProps {
  server: ServerProfile;
  onPress?: () => void;
}

export const ServerCard = ({server, onPress}: ServerCardProps) => (
  <FocusableItem
    accessibilityLabel={server.name}
    focusedStyle={styles.focused}
    onPress={onPress}
    style={styles.card}
    testID={`server-card-${server.id}`}>
    <View>
      <Text style={styles.name}>{server.name}</Text>
      <Text style={styles.meta}>{server.serverType}</Text>
      <Text style={styles.url}>{server.serverUrl}</Text>
    </View>
  </FocusableItem>
);

const styles = StyleSheet.create({
  card: {
    width: 560,
    minHeight: 180,
    borderRadius: 8,
    backgroundColor: '#1E2A32',
    padding: 28,
  },
  focused: {
    backgroundColor: '#244654',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '700',
  },
  meta: {
    color: '#78D4B6',
    fontSize: 28,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  url: {
    color: '#B8C5CC',
    fontSize: 28,
    marginTop: 8,
  },
});
