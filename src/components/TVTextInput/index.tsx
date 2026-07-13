import React, {forwardRef, useImperativeHandle, useRef, useState} from 'react';
import {
  StyleProp,
  StyleSheet,
  TextInputProps,
  TextStyle,
  ViewStyle,
} from 'react-native';
import {TextInput} from '@amazon-devices/react-native-kepler';

interface TVTextInputProps extends TextInputProps {
  auxOptions?: string;
  containerStyle?: StyleProp<ViewStyle>;
  focusDelayMs?: number;
  focusStrategy?: 'native' | 'delayed' | 'press';
  focusedContainerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  // When true the soft keyboard opens as soon as the field receives focus.
  // Leave false (the default) for forms with several fields — otherwise merely
  // moving D-pad focus across the fields pops the keyboard on each one, which
  // the user then has to dismiss before navigating on. With it false the
  // keyboard opens only when the field is actively pressed (clicked into).
  // Screens with a single auto-focused field (e.g. Search) opt in to true.
  openKeyboardOnFocus?: boolean;
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
      openKeyboardOnFocus = false,
      placeholder,
      style,
      ...props
    },
    forwardedRef,
  ) => {
    const inputRef = useRef<TextInput>(null);
    const [isFocused, setFocused] = useState(false);
    // Armed by an actual press on the field; gates the soft keyboard so D-pad
    // focus alone never opens it. Reset on blur so navigating back onto the
    // field later doesn't reopen the keyboard until it's pressed again.
    const [keyboardArmed, setKeyboardArmed] = useState(false);
    const vegaKeyboardProps = {
      auxOptions: props.auxOptions ?? keyboardTitle(placeholder),
    };

    useImperativeHandle(forwardedRef, () => inputRef.current as TextInput);

    const requestTVFocus = () => {
      inputRef.current?.requestTVFocus?.();
    };

    const requestDelayedFocus = () => {
      setTimeout(requestTVFocus, focusDelayMs);
    };

    return (
      <TextInput
        {...props}
        {...vegaKeyboardProps}
        onBlur={(event) => {
          setFocused(false);
          setKeyboardArmed(false);
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
          // A press means the user is clicking into the field — arm the
          // keyboard (and re-assert focus) so it opens here rather than on
          // every incidental focus while navigating the form.
          setKeyboardArmed(true);
          if (focusStrategy === 'press') {
            requestTVFocus();
          }
          onPressIn?.(event);
        }}
        placeholder={placeholder}
        ref={inputRef}
        returnKeyType={props.returnKeyType ?? 'done'}
        showSoftInputOnFocus={openKeyboardOnFocus || keyboardArmed}
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
