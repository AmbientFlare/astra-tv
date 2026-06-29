import React, {forwardRef, useImperativeHandle, useRef, useState} from 'react';
import {
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  TouchableOpacity,
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

    useImperativeHandle(forwardedRef, () => inputRef.current as TextInput);

    const focusInput = () => {
      inputRef.current?.focus();
    };

    return (
      <TouchableOpacity
        activeOpacity={1}
        hasTVPreferredFocus={props.hasTVPreferredFocus}
        onFocus={focusInput}
        onPress={focusInput}
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
            onFocus?.(event);
          }}
          ref={inputRef}
          showSoftInputOnFocus={true}
          style={[styles.input, inputStyle]}
        />
      </TouchableOpacity>
    );
  },
);

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
});
