import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../FocusableItem';

type RadioValue = string | number | boolean;

interface PreferenceRadioGroupProps<Value extends RadioValue> {
  onSelect: (value: Value) => void;
  options: Array<{label: string; value: Value}>;
  preferredFocusValue?: Value;
  selectedValue: Value;
  title?: string;
}

export const PreferenceRadioGroup = <Value extends RadioValue>({
  onSelect,
  options,
  preferredFocusValue,
  selectedValue,
  title,
}: PreferenceRadioGroupProps<Value>) => (
  <View style={styles.group}>
    {title ? <Text style={styles.title}>{title}</Text> : null}
    <TVFocusGuideView style={styles.row}>
      {options.map((option) => {
        const selected = option.value === selectedValue;

        return (
          <FocusableItem
            focusedStyle={styles.optionFocused}
            hasTVPreferredFocus={
              option.value === (preferredFocusValue ?? selectedValue)
            }
            key={`${title ?? 'radio'}-${option.label}`}
            onPress={() => onSelect(option.value)}
            style={styles.option}
            testID={`preference-radio-${title ?? 'group'}-${option.label}`}>
            <View style={[styles.circle, selected && styles.circleSelected]}>
              {selected ? <View style={styles.dot} /> : null}
            </View>
            <Text style={styles.text}>{option.label}</Text>
          </FocusableItem>
        );
      })}
    </TVFocusGuideView>
  </View>
);

const styles = StyleSheet.create({
  group: {
    marginBottom: 18,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  option: {
    alignItems: 'center',
    backgroundColor: '#24313A',
    borderRadius: 8,
    flexDirection: 'row',
    minHeight: 52,
    minWidth: 150,
    paddingHorizontal: 14,
  },
  optionFocused: {
    backgroundColor: '#2E5A72',
  },
  circle: {
    alignItems: 'center',
    borderColor: '#8CA1AA',
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    marginRight: 10,
    width: 20,
  },
  circleSelected: {
    borderColor: '#4CC9F0',
  },
  dot: {
    backgroundColor: '#4CC9F0',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
  },
});
