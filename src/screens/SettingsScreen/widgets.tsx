import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {PreferenceRadioGroup} from '../../components/PreferenceRadioGroup';
import {t} from '../../i18n';
import {styles} from './styles';

export const Page = ({
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
      <Text style={styles.backText}>{t('common.back')}</Text>
    </FocusableItem>
    <View style={styles.group}>{children}</View>
  </ScrollView>
);

export const MenuRow = ({
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

export const DangerRow = (
  props: Omit<Parameters<typeof MenuRow>[0], 'icon'>,
) => <MenuRow {...props} icon="!" />;

export const ToggleRow = ({
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

export const RadioPage = <Value extends string | number>({
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

export const ConfirmDialog = ({
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
          <Text style={styles.backText}>{t('common.cancel')}</Text>
        </FocusableItem>
        <FocusableItem
          focusedStyle={styles.dangerFocused}
          onPress={onConfirm}
          style={[styles.confirmButton, styles.dangerButton]}>
          <Text style={styles.backText}>{t('common.confirm')}</Text>
        </FocusableItem>
      </TVFocusGuideView>
    </View>
  </View>
);
