import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../../components/FocusableItem';
import {LANGUAGES, Locale} from '../../i18n';
import {colors} from '../../theme';

// Shown before any language is chosen, so the prompt is written in every
// language rather than read through t().
const PROMPTS = [
  'Sprache wählen',
  'Elige tu idioma',
  'Choisissez votre langue',
  'Scegli la lingua',
  'Escolha seu idioma',
].join('  ·  ');

interface LanguagePickerScreenProps {
  onSelect: (locale: Locale) => void;
}

export const LanguagePickerScreen = ({onSelect}: LanguagePickerScreenProps) => (
  <View style={styles.screen} testID="language-picker">
    <Text style={styles.logo}>Astra</Text>
    <Text style={styles.title}>Choose your language</Text>
    <Text style={styles.subtitle}>{PROMPTS}</Text>
    <View style={styles.grid}>
      {LANGUAGES.map((language, index) => (
        <FocusableItem
          accessibilityLabel={language.name}
          hasTVPreferredFocus={index === 0}
          key={language.locale}
          onPress={() => onSelect(language.locale)}
          style={styles.option}
          testID={`language-${language.locale}`}>
          <Text style={styles.optionText}>{language.name}</Text>
        </FocusableItem>
      ))}
    </View>
  </View>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.screen,
    paddingHorizontal: 144,
    paddingVertical: 76,
  },
  logo: {
    color: colors.text.primary,
    fontSize: 82,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 36,
  },
  title: {
    color: colors.text.primary,
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 12,
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 24,
    lineHeight: 34,
    marginBottom: 36,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    width: 830,
  },
  option: {
    width: 260,
    height: 100,
    borderRadius: 8,
    backgroundColor: colors.surface.card,
    borderColor: colors.border.hairline,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    color: colors.text.primary,
    fontSize: 28,
    fontWeight: '700',
  },
});
