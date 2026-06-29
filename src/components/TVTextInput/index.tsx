import React, {forwardRef, useImperativeHandle, useRef, useState} from 'react';
import {
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  ViewStyle,
} from 'react-native';

interface TVTextInputProps extends TextInputProps {
  auxOptions?: string;
  containerStyle?: StyleProp<ViewStyle>;
  focusDelayMs?: number;
  focusStrategy?: 'native' | 'delayed' | 'press';
  focusedContainerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

const keyboardTitle = (placeholder: TextInputProps['placeholder']) =>
  typeof placeholder === 'string' && placeholder.trim()
    ? `title:${placeholder.trim()}`
    : 'title:Enter text';

export const TVTextInput = forwardRef<TextInput, TVTextInputProps>(
  (
    {
      containerStyle,
      focusDelayMs = 125,
      focusStrategy = 'native',
      focusedContainerStyle,
      inputStyle,
      onBlur,
      onFocus,
      onPressIn,
      placeholder,
      style,
      ...props
    },
    forwardedRef,
  ) => {
    const inputRef = useRef<TextInput>(null);
    const [isFocused, setFocused] = useState(false);
    const vegaKeyboardProps = {
      auxOptions: props.auxOptions ?? keyboardTitle(placeholder),
    };

    useImperativeHandle(forwardedRef, () => inputRef.current as TextInput);

    const requestFocus = () => {
      inputRef.current?.focus();
    };

    const requestDelayedFocus = () => {
      setTimeout(requestFocus, focusDelayMs);
    };

    return (
      <TextInput
        {...props}
        {...vegaKeyboardProps}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          if (focusStrategy === 'delayed') {
            requestDelayedFocus();
          }
          onFocus?.(event);
        }}
        onPressIn={(event) => {
          if (focusStrategy === 'press') {
            requestFocus();
          }
          onPressIn?.(event);
        }}
        placeholder={placeholder}
        ref={inputRef}
        returnKeyType={props.returnKeyType ?? 'done'}
        showSoftInputOnFocus={true}
        style={[
          styles.input,
          containerStyle,
          style as StyleProp<TextStyle>,
          inputStyle,
          isFocused && focusedContainerStyle,
        ]}
      />
    );
  },
);

const styles = StyleSheet.create({
  input: {
    color: '#FFFFFF',
    fontSize: 26,
    padding: 0,
  },
});
