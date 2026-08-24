/**
 * The one place Astra says "working on it", "that did not work" or "there is
 * nothing here", so no screen can answer a slow or failed request with a blank
 * page. Renders nothing at all once there is content to show.
 */
import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../FocusableItem';

interface LoadingOrErrorProps {
  /** Shown instead of the spinner row once loading has finished with nothing. */
  emptyText?: string;
  errorText?: string | null;
  isEmpty?: boolean;
  isLoading?: boolean;
  loadingText?: string;
  onRetry?: () => void;
  retryLabel?: string;
  testID?: string;
}

export const LoadingOrError = ({
  emptyText,
  errorText,
  isEmpty = false,
  isLoading = false,
  loadingText = 'Loading...',
  onRetry,
  retryLabel = 'Retry',
  testID = 'loading-or-error',
}: LoadingOrErrorProps) => {
  if (isLoading) {
    return (
      <View style={styles.row} testID={`${testID}-loading`}>
        <ActivityIndicator color="#4CC9F0" />
        <Text style={styles.status}>{loadingText}</Text>
      </View>
    );
  }

  if (errorText) {
    return (
      <View style={styles.row} testID={`${testID}-error`}>
        <Text style={styles.error}>{errorText}</Text>
        {onRetry ? (
          <FocusableItem
            focusedStyle={styles.retryFocused}
            onPress={onRetry}
            style={styles.retry}
            testID={`${testID}-retry`}>
            <Text style={styles.retryText}>{retryLabel}</Text>
          </FocusableItem>
        ) : null}
      </View>
    );
  }

  if (isEmpty && emptyText) {
    return (
      <View style={styles.row} testID={`${testID}-empty`}>
        <Text style={styles.status}>{emptyText}</Text>
        {onRetry ? (
          <FocusableItem
            focusedStyle={styles.retryFocused}
            onPress={onRetry}
            style={styles.retry}
            testID={`${testID}-retry`}>
            <Text style={styles.retryText}>{retryLabel}</Text>
          </FocusableItem>
        ) : null}
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
    marginTop: 6,
  },
  status: {
    color: '#B8C5CC',
    fontSize: 24,
  },
  error: {
    color: '#FFB4A8',
    fontSize: 24,
  },
  retry: {
    alignItems: 'center',
    backgroundColor: '#24313A',
    borderRadius: 8,
    height: 46,
    justifyContent: 'center',
    minWidth: 110,
    paddingHorizontal: 18,
  },
  retryFocused: {
    backgroundColor: '#315066',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
});
