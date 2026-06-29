import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

interface TVTextInputProps extends TextInputProps {
  containerStyle?: StyleProp<ViewStyle>;
  focusedContainerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export const TVTextInput = forwardRef<TextInput, TVTextInputProps>(
  (
    {
      containerStyle,
      focusedContainerStyle,
      inputStyle,
      onBlur,
      onFocus,
      style,
      ...props
    },
    forwardedRef,
  ) => {
    const inputRef = useRef<TextInput>(null);
    const [isFocused, setFocused] = useState(false);
    const [isKeyboardOpen, setKeyboardOpen] = useState(false);
    const inputValue = typeof props.value === 'string' ? props.value : '';
    const displayValue = props.secureTextEntry
      ? '*'.repeat(inputValue.length)
      : inputValue;
    const keyboardRows = useMemo(
      () => [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
        ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
        ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
        ['.', '-', '_', '/', ':', '@'],
      ],
      [],
    );

    useImperativeHandle(forwardedRef, () => inputRef.current as TextInput);

    const focusInput = () => {
      inputRef.current?.focus();
    };

    const openKeyboard = () => {
      focusInput();
      setKeyboardOpen(true);
    };

    const updateValue = (nextValue: string) => {
      props.onChangeText?.(nextValue);
    };

    const appendCharacter = (character: string) => {
      updateValue(`${inputValue}${character}`);
    };

    const backspace = () => {
      updateValue(inputValue.slice(0, -1));
    };

    const closeKeyboard = () => {
      setKeyboardOpen(false);
    };

    return (
      <>
        <TouchableOpacity
          activeOpacity={1}
          hasTVPreferredFocus={props.hasTVPreferredFocus}
          onFocus={openKeyboard}
          onPress={openKeyboard}
          style={[
            styles.container,
            containerStyle,
            style as StyleProp<ViewStyle>,
            isFocused && focusedContainerStyle,
          ]}>
          <TextInput
            {...props}
            hasTVPreferredFocus={false}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
            onFocus={(event) => {
              setFocused(true);
              setKeyboardOpen(true);
              onFocus?.(event);
            }}
            ref={inputRef}
            showSoftInputOnFocus={true}
            style={[styles.input, inputStyle]}
          />
        </TouchableOpacity>
        <Modal
          animationType="fade"
          onRequestClose={closeKeyboard}
          transparent={true}
          visible={isKeyboardOpen}>
          <View style={styles.keyboardScrim}>
            <View style={styles.keyboardPanel}>
              <Text numberOfLines={1} style={styles.keyboardValue}>
                {displayValue || props.placeholder || ''}
              </Text>
              {keyboardRows.map((row, rowIndex) => (
                <View key={row.join('')} style={styles.keyboardRow}>
                  {row.map((character, index) => (
                    <KeyboardButton
                      hasTVPreferredFocus={rowIndex === 0 && index === 0}
                      key={character}
                      label={character}
                      onPress={() => appendCharacter(character)}
                    />
                  ))}
                </View>
              ))}
              <View style={styles.keyboardRow}>
                <KeyboardButton
                  label="space"
                  onPress={() => appendCharacter(' ')}
                  wide={true}
                />
                <KeyboardButton
                  label="backspace"
                  onPress={backspace}
                  wide={true}
                />
                <KeyboardButton
                  label="clear"
                  onPress={() => updateValue('')}
                  wide={true}
                />
                <KeyboardButton
                  label="done"
                  onPress={closeKeyboard}
                  wide={true}
                />
              </View>
            </View>
          </View>
        </Modal>
      </>
    );
  },
);

const KeyboardButton = ({
  hasTVPreferredFocus,
  label,
  onPress,
  wide,
}: {
  hasTVPreferredFocus?: boolean;
  label: string;
  onPress: () => void;
  wide?: boolean;
}) => {
  const [isFocused, setFocused] = useState(false);

  return (
    <TouchableOpacity
      activeOpacity={1}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={[
        styles.keyboardKey,
        wide && styles.keyboardKeyWide,
        isFocused && styles.keyboardKeyFocused,
      ]}>
      <Text style={styles.keyboardKeyText}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  input: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 26,
    padding: 0,
  },
  keyboardScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 52,
  },
  keyboardPanel: {
    width: 920,
    borderRadius: 8,
    backgroundColor: '#101820',
    padding: 24,
  },
  keyboardValue: {
    height: 54,
    borderRadius: 8,
    backgroundColor: '#18242D',
    color: '#FFFFFF',
    fontSize: 28,
    marginBottom: 18,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  keyboardRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  keyboardKey: {
    width: 72,
    height: 54,
    borderRadius: 8,
    backgroundColor: '#25313A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardKeyWide: {
    width: 150,
  },
  keyboardKeyFocused: {
    backgroundColor: '#2E5A72',
    borderColor: '#4CC9F0',
    borderWidth: 3,
  },
  keyboardKeyText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
});
