import React, {useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {isIapAvailable, purchaseAstraPro} from '../../services/iap';

interface SupportScreenProps {
  onDismiss: () => void;
  onProPurchased: () => void;
}

export const SupportScreen = ({
  onDismiss,
  onProPurchased,
}: SupportScreenProps) => {
  const [statusText, setStatusText] = useState<string | null>(null);
  const [isPurchasing, setPurchasing] = useState(false);

  const buyPro = async () => {
    setPurchasing(true);
    setStatusText(null);

    try {
      if (!isIapAvailable()) {
        setStatusText('Astra Pro purchases are unavailable on this build.');
        return;
      }

      const purchased = await purchaseAstraPro();

      if (purchased) {
        onProPurchased();
      } else {
        setStatusText('Purchase was not completed.');
      }
    } catch (error) {
      setStatusText(
        error instanceof Error ? error.message : 'Unable to start purchase.',
      );
    } finally {
      setPurchasing(false);
    }
  };

  const donate = async () => {
    try {
      await Linking.openURL('https://ko-fi.com/astrafiretv');
      onDismiss();
    } catch {
      setStatusText('Unable to open Ko-fi on this device.');
    }
  };

  return (
    <View style={styles.screen} testID="support-screen">
      <Text style={styles.logo}>Astra</Text>
      <View style={styles.copy}>
        <Text style={styles.heading}>Astra is free, and always will be.</Text>
        <Text style={styles.body}>
          If Astra has replaced a streaming subscription, consider supporting
          development - it keeps new features coming and the lights on.
        </Text>
      </View>
      {statusText ? <Text style={styles.status}>{statusText}</Text> : null}
      <TVFocusGuideView style={styles.actions}>
        <SupportButton
          hasTVPreferredFocus={true}
          label={
            isPurchasing ? 'Starting purchase...' : 'Buy Astra Pro - $3.99'
          }
          onPress={buyPro}
        />
        <SupportButton label="Donate on Ko-fi" onPress={donate} />
        <SupportButton label="Maybe Later" onPress={onDismiss} />
      </TVFocusGuideView>
    </View>
  );
};

const SupportButton = ({
  hasTVPreferredFocus,
  label,
  onPress,
}: {
  hasTVPreferredFocus?: boolean;
  label: string;
  onPress: () => void;
}) => (
  <FocusableItem
    focusedStyle={styles.buttonFocused}
    hasTVPreferredFocus={hasTVPreferredFocus}
    onPress={onPress}
    style={styles.button}>
    <Text style={styles.buttonText}>{label}</Text>
  </FocusableItem>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#090D12',
    paddingHorizontal: 96,
    paddingTop: 72,
  },
  logo: {
    color: '#F2C879',
    fontSize: 76,
    fontWeight: '800',
  },
  copy: {
    maxWidth: 880,
    marginTop: 58,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '800',
  },
  body: {
    color: '#D7E1E7',
    fontSize: 28,
    lineHeight: 38,
    marginTop: 24,
  },
  status: {
    color: '#FFCF99',
    fontSize: 24,
    marginTop: 28,
  },
  actions: {
    gap: 16,
    marginTop: 44,
    width: 420,
  },
  button: {
    height: 62,
    borderRadius: 8,
    backgroundColor: '#202B34',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonFocused: {
    backgroundColor: '#6D5424',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
});
