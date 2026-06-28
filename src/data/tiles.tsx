import React from 'react';
import {ImageSourcePropType, StyleSheet, Text} from 'react-native';

export interface TileData {
  id: string;
  label: string;
  accessibilityLabel: string;
  description?: string | React.JSX.Element;
  icon: ImageSourcePropType;
}

const descStyles = StyleSheet.create({
  bold: {
    fontWeight: 'bold',
  },
});

export const tiles: TileData[] = [
  {
    id: 'home',
    label: 'Home',
    accessibilityLabel: 'Home',
    icon: require('../assets/home.png'),
  },
  {
    id: 'get-started',
    label: 'Get\nstarted',
    accessibilityLabel: 'Get started',
    description: (
      <>
        Edit <Text style={descStyles.bold}>App.tsx</Text> for live changes.
        {'\n'}Not seeing updates? Check Fast Refresh is enabled.
      </>
    ),
    icon: require('../assets/get-started.png'),
  },
  {
    id: 'debug',
    label: 'Test &\nDebug',
    accessibilityLabel: 'Test and Debug',
    description:
      "Press 'd' in the Metro terminal for the developer menu, or debug via Chrome Dev Tools in Vega Studio.",
    icon: require('../assets/debug.png'),
  },
  {
    id: 'learn-more',
    label: 'Learn\nmore',
    accessibilityLabel: 'Learn more',
    description: (
      <>
        Read the docs at{' '}
        <Text style={descStyles.bold}>developer.amazon.com</Text> or join the
        community forums.
      </>
    ),
    icon: require('../assets/learn-more.png'),
  },
];
