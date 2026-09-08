import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {
  CAPABILITY_NOTICE_TITLE,
  CapabilityNotice,
  capabilityNoticeBody,
} from '../src/components/CapabilityNotice';

describe('capability notice', () => {
  it('names the server and points at Settings rather than at the answer', () => {
    const screen = render(
      <CapabilityNotice onDismiss={jest.fn()} serverName="Levi 2" />,
    );

    expect(screen.getByText(CAPABILITY_NOTICE_TITLE)).toBeTruthy();
    capabilityNoticeBody('Levi 2').forEach((paragraph) => {
      expect(screen.getByText(paragraph)).toBeTruthy();
    });
    // The point of the notice: someone whose GPU dropped out of its container
    // has to come away knowing there is a server to go and fix.
    expect(capabilityNoticeBody('Levi 2').join(' ')).toContain('graphics card');
    expect(capabilityNoticeBody('Levi 2').join(' ')).toContain('Settings');
  });

  it('dismisses when the button is pressed', () => {
    const onDismiss = jest.fn();
    const screen = render(
      <CapabilityNotice onDismiss={onDismiss} serverName="NAS" />,
    );

    fireEvent.press(screen.getByTestId('capability-notice-ok'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
