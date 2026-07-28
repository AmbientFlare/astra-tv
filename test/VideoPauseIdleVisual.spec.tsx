import React from 'react';
import {render} from '@testing-library/react-native';
import {VideoPauseIdleVisual} from '../src/components/VideoPauseIdleVisual';
import {
  startVideoEngagement,
  stopVideoEngagement,
} from '@astra/user-engagement';

jest.mock('@astra/user-engagement', () => ({
  startVideoEngagement: jest.fn(),
  stopVideoEngagement: jest.fn(),
}));
jest.mock('../src/components/AudioIdleVisual', () => ({
  AUDIO_IDLE_DELAY_MS: 180000,
}));

const start = startVideoEngagement as jest.MockedFunction<
  typeof startVideoEngagement
>;
const stop = stopVideoEngagement as jest.MockedFunction<
  typeof stopVideoEngagement
>;

describe('VideoPauseIdleVisual engagement', () => {
  beforeEach(() => {
    start.mockClear();
    stop.mockClear();
  });

  it('suppresses system idle while paused and releases on resume', () => {
    const screen = render(
      <VideoPauseIdleVisual paused title="Episode" artworkUrl={undefined} />,
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    screen.rerender(
      <VideoPauseIdleVisual
        paused={false}
        title="Episode"
        artworkUrl={undefined}
      />,
    );

    expect(stop).toHaveBeenCalled();
  });
});
