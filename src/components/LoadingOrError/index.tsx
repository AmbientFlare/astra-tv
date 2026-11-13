/**
 * The one place Astra says "working on it", "that did not work" or "there is
 * nothing here", so no screen can answer a slow or failed request with a blank
 * page. Renders nothing at all once there is content to show.
 */
import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../FocusableItem';
import {t} from '../../i18n';
import {colors} from '../../theme';

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
  loadingText = t('common.loading'),
  onRetry,
  retryLabel = t('common.retry'),
  testID = 'loading-or-error',
}: LoadingOrErrorProps) => {
  if (isLoading) {
    return (
      <View style={styles.row} testID={`${testID}-loading`}>
        <ActivityIndicator color={colors.text.accent} />
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
    color: colors.text.secondary,
    fontSize: 24,
  },
  error: {
    color: colors.text.error,
    fontSize: 24,
  },
  retry: {
    alignItems: 'center',
    backgroundColor: colors.surface.control,
    borderRadius: 8,
    height: 46,
    justifyContent: 'center',
    minWidth: 110,
    paddingHorizontal: 18,
  },
  retryText: {
    color: colors.text.primary,
    fontSize: 22,
    fontWeight: '700',
  },
});
