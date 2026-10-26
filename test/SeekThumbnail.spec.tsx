import React from 'react';
import {StyleSheet} from 'react-native';
import {act, render} from '@testing-library/react-native';
import {SeekThumbnail} from '../src/screens/PlayerScreen/SeekThumbnail';
import {getTrickplayInfo} from '../src/services/jellyfin/trickplay';

jest.mock('../src/services/jellyfin/trickplay', () => ({
  ...jest.requireActual('../src/services/jellyfin/trickplay'),
  getTrickplayInfo: jest.fn(),
}));

const info = {
  Width: 320,
  Height: 180,
  TileWidth: 10,
  TileHeight: 10,
  ThumbnailCount: 215,
  Interval: 10000,
};
const props = {
  serverUrl: 'https://server',
  accessToken: 'token',
  itemId: 'movie',
  mediaSourceId: 'version',
  target: 110,
};
const flush = async () => {
  for (let n = 0; n < 10; n++) {
    await Promise.resolve();
  }
};
const mount = async (target: number | null = 110) => {
  const view = render(<SeekThumbnail {...props} target={target} />);
  await act(flush);
  return view;
};

describe('seek thumbnails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getTrickplayInfo as jest.Mock).mockResolvedValue(info);
  });

  it('crops the requested frame without reloading the same sheet for every position', async () => {
    const view = await mount();
    let image = view.getByTestId('player-seek-thumbnail-image');
    const source = image.props.source;
    expect(StyleSheet.flatten(image.props.style)).toMatchObject({
      left: -240,
      top: -135,
      opacity: 0,
    });
    await act(async () => {
      image.props.onLoad({nativeEvent: {source: {width: 3200, height: 1800}}});
    });
    expect(
      StyleSheet.flatten(
        view.getByTestId('player-seek-thumbnail-image').props.style,
      ).opacity,
    ).toBe(1);
    view.rerender(<SeekThumbnail {...props} target={120} />);
    image = view.getByTestId('player-seek-thumbnail-image');
    expect(image.props.source).toBe(source);
    expect(StyleSheet.flatten(image.props.style)).toMatchObject({
      left: -480,
      top: -135,
    });
    expect(getTrickplayInfo).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('uses the actual dimensions of a partially filled final sprite', async () => {
    const view = await mount(2140);
    const image = view.getByTestId('player-seek-thumbnail-image');
    await act(async () => {
      image.props.onLoad({nativeEvent: {source: {width: 3200, height: 360}}});
    });
    expect(
      StyleSheet.flatten(
        view.getByTestId('player-seek-thumbnail-image').props.style,
      ),
    ).toMatchObject({left: -960, top: -135, height: 270, opacity: 1});
    view.unmount();
  });

  it('hides the image while a different sheet loads', async () => {
    const view = await mount();
    await act(async () => {
      view
        .getByTestId('player-seek-thumbnail-image')
        .props.onLoad({nativeEvent: {source: {width: 3200, height: 1800}}});
    });
    view.rerender(<SeekThumbnail {...props} target={1000} />);
    const image = view.getByTestId('player-seek-thumbnail-image');
    expect(image.props.source.uri).toContain('/1.jpg');
    expect(StyleSheet.flatten(image.props.style).opacity).toBe(0);
    expect(getTrickplayInfo).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('ignores a late metadata response from an old media version', async () => {
    let complete!: (value: typeof info) => void;
    (getTrickplayInfo as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const view = await mount();
    const oldSignal = (getTrickplayInfo as jest.Mock).mock.calls[0][4];
    view.rerender(<SeekThumbnail {...props} mediaSourceId="new-version" />);
    await act(flush);
    await act(async () => {
      complete({...info, Width: 160, Height: 90});
      await flush();
    });
    const image = view.getByTestId('player-seek-thumbnail-image');
    expect(oldSignal.aborted).toBe(true);
    expect(image.props.source.uri).toContain('/320/');
    expect(image.props.source.uri).toContain('new-version');
    view.unmount();
  });

  it('hides the optional preview when metadata is absent or unavailable', async () => {
    (getTrickplayInfo as jest.Mock).mockResolvedValueOnce(null);
    const absent = await mount();
    expect(absent.queryByTestId('player-seek-thumbnail')).toBeNull();
    absent.unmount();
    (getTrickplayInfo as jest.Mock).mockRejectedValueOnce(new Error('404'));
    const failed = await mount();
    expect(failed.queryByTestId('player-seek-thumbnail')).toBeNull();
    failed.unmount();
  });

  it('falls back after an image error without repeatedly retrying during scanning', async () => {
    const view = await mount();
    await act(async () => {
      view.getByTestId('player-seek-thumbnail-image').props.onError({});
    });
    view.rerender(<SeekThumbnail {...props} target={1500} />);
    expect(view.queryByTestId('player-seek-thumbnail')).toBeNull();
    expect(getTrickplayInfo).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('displays no old-version frame while new-version metadata is loading', async () => {
    const view = await mount();
    let complete!: (value: typeof info) => void;
    (getTrickplayInfo as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    view.rerender(<SeekThumbnail {...props} mediaSourceId="other-version" />);
    expect(view.queryByTestId('player-seek-thumbnail')).toBeNull();
    await act(async () => {
      complete(info);
      await flush();
    });
    expect(
      view.getByTestId('player-seek-thumbnail-image').props.source.uri,
    ).toContain('other-version');
    view.unmount();
  });

  it('keeps metadata when the preview is dismissed and aborts requests on unmount', async () => {
    const view = await mount(null);
    expect(view.queryByTestId('player-seek-thumbnail')).toBeNull();
    view.rerender(<SeekThumbnail {...props} />);
    expect(view.getByTestId('player-seek-thumbnail')).toBeTruthy();
    const signal = (getTrickplayInfo as jest.Mock).mock.calls[0][4];
    await act(async () => {
      view.unmount();
      await flush();
    });
    expect(signal.aborted).toBe(true);
  });
});
