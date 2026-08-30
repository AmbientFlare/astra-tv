import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {
  CURRENT_NOTICE_ID,
  DeveloperNotice,
  NOTICE_BODY,
  NOTICE_TITLE,
} from '../src/components/DeveloperNotice';

describe('developer notice', () => {
  it('renders the title, every paragraph and a dismiss control', () => {
    const screen = render(<DeveloperNotice onDismiss={jest.fn()} />);

    expect(screen.getByText(NOTICE_TITLE)).toBeTruthy();
    NOTICE_BODY.forEach((paragraph) => {
      expect(screen.getByText(paragraph)).toBeTruthy();
    });
    expect(screen.getByTestId('developer-notice-ok')).toBeTruthy();
  });

  it('dismisses when the button is pressed', () => {
    const onDismiss = jest.fn();
    const screen = render(<DeveloperNotice onDismiss={onDismiss} />);

    fireEvent.press(screen.getByTestId('developer-notice-ok'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has a stable notice id, so dismissal is not undone by a rebuild', () => {
    // Changing this value re-shows the notice to every user; that must be a
    // deliberate edit rather than an accident.
    expect(CURRENT_NOTICE_ID).toBe('vega-os-1.2-apology-2026-08');
  });

  it('does not promise anything on Amazon behalf or link outside the app', () => {
    const text = [NOTICE_TITLE, ...NOTICE_BODY].join(' ').toLowerCase();
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/refund|purchase|subscribe|pay/);
  });
});
