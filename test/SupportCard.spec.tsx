import React from 'react';
import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import {fireEvent, render} from '@testing-library/react-native';

import {SupportCard} from '../src/components/SupportCard';
import {KOFI_URL} from '../src/config/app';
import {setActiveLocale} from '../src/i18n';
import {
  readAppState,
  recordPlayback,
  shouldShowSupportCard,
  SUPPORT_CARD_AFTER_PLAYBACKS,
  writeAppState,
} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const store = new Map<string, string>();
  const {View} = jest.requireActual('react-native');

  return {
    AsyncStorage: {
      clear: () => store.clear(),
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
    TVFocusGuideView: View,
  };
});

beforeEach(() => {
  (AsyncStorage as unknown as {clear: () => void}).clear();
});

describe('support card', () => {
  afterEach(() => setActiveLocale('en'));

  it('counts playbacks and asks once the count reaches 25', async () => {
    expect(SUPPORT_CARD_AFTER_PLAYBACKS).toBe(25);
    for (let i = 1; i < SUPPORT_CARD_AFTER_PLAYBACKS; i++) {
      await recordPlayback();
    }
    expect(shouldShowSupportCard(await readAppState())).toBe(false);

    expect(await recordPlayback()).toBe(25);
    expect(shouldShowSupportCard(await readAppState())).toBe(true);

    await writeAppState({supportCardShown: true});
    await recordPlayback();
    expect(shouldShowSupportCard(await readAppState())).toBe(false);
  });

  it('keeps the count and other app state across writes', async () => {
    await writeAppState({acknowledgedNoticeId: 'whats-new-x', launchCount: 4});
    await recordPlayback();
    await recordPlayback();

    expect(await readAppState()).toEqual({
      acknowledgedNoticeId: 'whats-new-x',
      isPro: false,
      launchCount: 4,
      playbackCount: 2,
      supportCardShown: false,
      version: 1,
    });
  });

  it('starts from zero on state saved before the count existed', async () => {
    await AsyncStorage.setItem(
      'astra.appState.v1',
      JSON.stringify({
        acknowledgedNoticeId: 'a',
        isPro: false,
        launchCount: 9,
        version: 1,
      }),
    );
    const state = await readAppState();
    expect(state.launchCount).toBe(9);
    expect(state.playbackCount).toBe(0);
    expect(state.supportCardShown).toBe(false);
  });

  it('never asks a Pro owner', () => {
    expect(
      shouldShowSupportCard({
        acknowledgedNoticeId: '',
        isPro: true,
        launchCount: 0,
        playbackCount: 99,
        supportCardShown: false,
        version: 1,
      }),
    ).toBe(false);
  });

  it('shows the Ko-fi code and dismisses', () => {
    const onDismiss = jest.fn();
    const screen = render(<SupportCard onDismiss={onDismiss} />);

    expect(screen.getByText('Enjoying Astra?')).toBeTruthy();
    expect(screen.getByTestId('support-card-qr').props.accessibilityLabel).toBe(
      KOFI_URL,
    );
    expect(screen.getByText('ko-fi.com/astrafiretv')).toBeTruthy();

    fireEvent.press(screen.getByTestId('support-card-ok'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is translated', () => {
    setActiveLocale('de');
    const screen = render(<SupportCard onDismiss={jest.fn()} />);
    expect(screen.getByText('Gefällt dir Astra?')).toBeTruthy();
  });
});
