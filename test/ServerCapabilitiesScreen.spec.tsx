import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {ServerCapabilitiesScreen} from '../src/screens/ServerCapabilitiesScreen';
import {updateServerCapabilities} from '../src/services/serverCapabilities';
import {writePlaybackPreferences} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');
  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
  };
});

jest.mock('../src/services/serverCapabilities', () => ({
  updateServerCapabilities: jest.fn(async () => undefined),
}));

jest.mock('../src/services/storage', () => ({
  writePlaybackPreferences: jest.fn(async () => undefined),
}));

const renderWizard = (onDone = jest.fn()) => ({
  onDone,
  screen: render(
    <ServerCapabilitiesScreen
      onDone={onDone}
      serverId="http://192.168.1.50:8096"
      serverName="NAS"
    />,
  ),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('first-run capability questions', () => {
  it('asks about the server first, and offers the third answer', () => {
    const {screen} = renderWizard();

    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByTestId('capability-choice-hardware')).toBeTruthy();
    expect(screen.getByTestId('capability-choice-cpu')).toBeTruthy();
    // Set up against someone else's server: not knowing has to be a real
    // answer, not a dead end.
    expect(screen.getByTestId('capability-choice-unknown')).toBeTruthy();
  });

  it('stores a hardware answer as a claim and moves to the audio question', () => {
    const {screen} = renderWizard();

    fireEvent.press(screen.getByTestId('capability-choice-hardware'));

    expect(updateServerCapabilities).toHaveBeenCalledWith(
      'http://192.168.1.50:8096',
      {videoTranscode: 'hardware', videoTranscodeSource: 'stated'},
    );
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
  });

  it('keeps "I don\'t know" as a default so detection never contradicts it', () => {
    const {screen} = renderWizard();

    fireEvent.press(screen.getByTestId('capability-choice-unknown'));

    expect(updateServerCapabilities).toHaveBeenCalledWith(
      'http://192.168.1.50:8096',
      {videoTranscode: 'unknown', videoTranscodeSource: 'default'},
    );
  });

  it('writes the audio answer to both the server record and the live profile', async () => {
    const {onDone, screen} = renderWizard();

    fireEvent.press(screen.getByTestId('capability-choice-cpu'));
    fireEvent.press(screen.getByTestId('capability-choice-2'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateServerCapabilities).toHaveBeenLastCalledWith(
      'http://192.168.1.50:8096',
      {
        interviewCompleted: true,
        maxAudioChannels: 2,
        maxAudioChannelsSource: 'stated',
      },
    );
    expect(writePlaybackPreferences).toHaveBeenCalledWith({
      maxAudioChannels: 2,
    });
  });

  it('finishes even when the write fails, so nobody is stranded here', async () => {
    (updateServerCapabilities as jest.Mock).mockRejectedValue(
      new Error('storage gone'),
    );
    const {onDone, screen} = renderWizard();

    fireEvent.press(screen.getByTestId('capability-choice-hardware'));
    fireEvent.press(screen.getByTestId('capability-choice-6'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
