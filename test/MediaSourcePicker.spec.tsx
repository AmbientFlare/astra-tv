import 'react-native';
import {fireEvent, render} from '@testing-library/react-native';
import React from 'react';
import {
  formatMediaSourceLabel,
  MediaSourcePicker,
} from '../src/components/MediaSourcePicker';
import {JellyfinMediaSource} from '../src/services/jellyfin';

const sources: JellyfinMediaSource[] = [
  {
    Id: 'source-one',
    Name: '1080p WEB-DL',
    Container: 'mkv',
    Size: 5368709120,
    SupportsTranscoding: true,
    MediaStreams: [{Type: 'Video', Height: 1080}],
  },
  {
    Id: 'source-two',
    Name: '2160p HEVC HDR',
    Container: 'mkv',
    SupportsTranscoding: true,
    MediaStreams: [{Type: 'Video', Height: 2160}],
  },
];

describe('MediaSourcePicker', () => {
  it('does not appear for a single Jellyfin source', () => {
    const screen = render(
      <MediaSourcePicker onSelect={jest.fn()} sources={[sources[0]]} />,
    );

    expect(screen.queryByTestId('media-source-picker')).toBeNull();
  });

  it('opens a remote-focusable Versions menu and selects by source id', () => {
    const onSelect = jest.fn();
    const screen = render(
      <MediaSourcePicker onSelect={onSelect} sources={sources} />,
    );

    fireEvent.press(screen.getByTestId('media-source-picker-button'));
    fireEvent.press(screen.getByTestId('media-source-option-source-two'));

    expect(onSelect).toHaveBeenCalledWith('source-two');
  });

  it('labels standard source fields without provider knowledge', () => {
    expect(formatMediaSourceLabel(sources[0], 0)).toBe(
      '1080p WEB-DL · 1080p · MKV · 5.0 GB',
    );
  });
});
