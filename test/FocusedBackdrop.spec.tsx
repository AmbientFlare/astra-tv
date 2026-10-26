/**
 * The backdrop crossfade only swaps its images when a fade runs to the end.
 * A fade cut short by a newer image, or by the screen going away, used to swap
 * anyway and repoint images that were already being replaced or removed.
 */
import 'react-native';
import {act, render} from '@testing-library/react-native';
import React from 'react';
import {Animated, Image} from 'react-native';
import {FocusedBackdrop} from '../src/components/FocusedBackdrop';

/**
 * Fades the test finishes by hand. Like React Native's own, a stopped fade
 * reports back once with finished false.
 */
let fades: Array<{finish: () => void; stopped: boolean}> = [];

beforeEach(() => {
  fades = [];
  jest.spyOn(Animated, 'parallel').mockImplementation(() => {
    let done: Animated.EndCallback | undefined;
    const fade = {
      finish: () => {
        const callback = done;
        done = undefined;
        callback?.({finished: true});
      },
      stopped: false,
    };
    fades.push(fade);
    return {
      reset: () => undefined,
      start: (callback?: Animated.EndCallback) => {
        done = callback;
      },
      stop: () => {
        fade.stopped = true;
        const callback = done;
        done = undefined;
        callback?.({finished: false});
      },
    };
  });
});

afterEach(() => jest.restoreAllMocks());

const shownUris = (view: ReturnType<typeof render>) =>
  view.UNSAFE_getAllByType(Image).map((image) => image.props.source.uri);

it('crossfades to a new image and keeps only that one', () => {
  const view = render(<FocusedBackdrop imageUrl="a.jpg" />);
  view.rerender(<FocusedBackdrop imageUrl="b.jpg" />);
  expect(shownUris(view)).toEqual(['a.jpg', 'b.jpg']);

  act(() => fades[0].finish());
  expect(shownUris(view)).toEqual(['b.jpg']);
});

it('does not swap in an image whose fade was interrupted', () => {
  const view = render(<FocusedBackdrop imageUrl="a.jpg" />);
  view.rerender(<FocusedBackdrop imageUrl="b.jpg" />);
  view.rerender(<FocusedBackdrop imageUrl="c.jpg" />);
  expect(fades[0].stopped).toBe(true);
  // The stopped fade to b must not have promoted b over a.
  expect(shownUris(view)).toEqual(['a.jpg', 'c.jpg']);

  act(() => fades[1].finish());
  expect(shownUris(view)).toEqual(['c.jpg']);
});

it('settles back when focus returns to the image already shown', () => {
  const view = render(<FocusedBackdrop imageUrl="a.jpg" />);
  view.rerender(<FocusedBackdrop imageUrl="b.jpg" />);
  view.rerender(<FocusedBackdrop imageUrl="a.jpg" />);
  expect(fades[0].stopped).toBe(true);
  expect(fades).toHaveLength(1);
  expect(shownUris(view)).toEqual(['a.jpg']);
});

it('stops the fade when unmounted part way', () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const view = render(<FocusedBackdrop imageUrl="a.jpg" />);
  view.rerender(<FocusedBackdrop imageUrl="b.jpg" />);
  act(() => view.unmount());
  expect(fades[0].stopped).toBe(true);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});
