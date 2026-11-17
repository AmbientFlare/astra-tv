import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';

import {KOFI_URL} from '../../config/app';
import {t} from '../../i18n';
import {QrCode} from '../QrCode';
import {FOCUS_BORDER_WIDTH, colors, focusStyles} from '../../theme';

interface SupportCardProps {
  onDismiss: () => void;
}

/**
 * The one-time Ko-fi card, shown on Home after
 * `SUPPORT_CARD_AFTER_PLAYBACKS` videos. Dismissing it stores
 * `AppStateConfig.supportCardShown`, so it never comes back.
 */
export const SupportCard = ({onDismiss}: SupportCardProps) => {
  const buttonRef = useRef<any>(null);
  const [isFocused, setFocused] = useState(false);

  // Same reason as WhatsNewNotice: the screen behind has already claimed
  // focus, so take it back explicitly once mounted.
  useEffect(() => {
    const timer = setTimeout(() => {
      buttonRef.current?.requestTVFocus?.();
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.backdrop} testID="support-card">
      <TVFocusGuideView
        autoFocus
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp
        style={styles.card}>
        <View style={styles.text}>
          <Text style={styles.title}>{t('support.title')}</Text>
          <Text style={styles.body}>{t('support.body')}</Text>
          <Text style={styles.note}>{t('support.note')}</Text>
          <Text style={styles.signature}>— Levi</Text>
          <TouchableOpacity
            accessibilityLabel={t('support.dismissLabel')}
            accessibilityRole="button"
            activeOpacity={1}
            hasTVPreferredFocus
            onBlur={() => setFocused(false)}
            onFocus={() => setFocused(true)}
            onPress={onDismiss}
            ref={buttonRef}
            style={[styles.button, isFocused && focusStyles.control]}
            testID="support-card-ok">
            <Text style={styles.buttonLabel}>{t('common.ok')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.code}>
          <QrCode size={260} testID="support-card-qr" value={KOFI_URL} />
          <Text style={styles.link}>{KOFI_URL.replace('https://', '')}</Text>
        </View>
      </TVFocusGuideView>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: colors.scrim.heavy,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 40,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface.sunken,
    borderColor: colors.border.subtle,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    maxWidth: 1100,
    paddingHorizontal: 48,
    paddingVertical: 40,
  },
  text: {
    flex: 1,
    marginRight: 48,
  },
  title: {
    color: colors.text.primary,
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 24,
  },
  body: {
    color: colors.text.secondary,
    fontSize: 22,
    lineHeight: 32,
    marginBottom: 18,
  },
  note: {
    color: colors.text.secondary,
    fontSize: 18,
    lineHeight: 26,
    marginBottom: 18,
  },
  signature: {
    color: colors.text.muted,
    fontSize: 22,
    marginBottom: 32,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface.control,
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: FOCUS_BORDER_WIDTH,
    paddingHorizontal: 44 - FOCUS_BORDER_WIDTH,
    paddingVertical: 16 - FOCUS_BORDER_WIDTH,
  },
  buttonLabel: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '600',
  },
  code: {
    alignItems: 'center',
  },
  link: {
    color: colors.text.secondary,
    fontSize: 18,
    marginTop: 12,
  },
});
