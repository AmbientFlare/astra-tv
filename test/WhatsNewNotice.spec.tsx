import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {
  CURRENT_NOTICE_ID,
  NOTICE_BODY,
  NOTICE_TITLE,
  WhatsNewNotice,
} from '../src/components/WhatsNewNotice';
import {APP_VERSION, BUILD_NUMBER} from '../src/config/app';

describe("what's new notice", () => {
  it('renders the title, every highlight and a dismiss control', () => {
    const screen = render(<WhatsNewNotice onDismiss={jest.fn()} />);

    expect(screen.getByText(NOTICE_TITLE)).toBeTruthy();
    expect(NOTICE_BODY.length).toBeGreaterThan(0);
    NOTICE_BODY.forEach((highlight) => {
      expect(screen.getByText(`• ${highlight}`)).toBeTruthy();
    });
    expect(screen.getByTestId('whats-new-notice-ok')).toBeTruthy();
  });

  it('dismisses when the button is pressed', () => {
    const onDismiss = jest.fn();
    const screen = render(<WhatsNewNotice onDismiss={onDismiss} />);

    fireEvent.press(screen.getByTestId('whats-new-notice-ok'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('survives a host element with no requestTVFocus, and cleans up', () => {
    // The component asks for focus on a timer because the screen behind it
    // already holds focus; hasTVPreferredFocus alone did not take it back, and
    // the first centre press navigated away instead of dismissing. This pins
    // the optional-chaining guard and the timer cleanup only — that focus
    // actually lands is a device behaviour and is verified on hardware.
    jest.useFakeTimers();
    const screen = render(<WhatsNewNotice onDismiss={jest.fn()} />);

    expect(() => jest.runAllTimers()).not.toThrow();
    expect(() => screen.unmount()).not.toThrow();

    jest.useRealTimers();
  });

  it('ties the notice id to the version and build, so every build shows once', () => {
    // Test builds change more often than the version does, so the build number
    // is part of the id: each installed build earns exactly one prompt.
    expect(CURRENT_NOTICE_ID).toBe(`whats-new-${APP_VERSION}-${BUILD_NUMBER}`);
    expect(CURRENT_NOTICE_ID).toBe('whats-new-1.3.1-20260908.10');
  });

  it('does not promise anything on Amazon behalf or link outside the app', () => {
    const text = [NOTICE_TITLE, ...NOTICE_BODY].join(' ').toLowerCase();
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/refund|purchase|subscribe|pay/);
  });
});
