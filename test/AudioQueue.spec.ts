import {
  createQueue,
  currentTrack,
  cycleRepeat,
  displayPosition,
  enqueue,
  jumpTo,
  nextTrack,
  orderedTracks,
  playNext,
  previousTrack,
  QueueState,
  removeAt,
  setShuffle,
} from '../src/services/audioQueue';
import {MusicTrack} from '../src/services/jellyfin/music';

const track = (id: string): MusicTrack => ({id, name: `Track ${id}`});
const tracks = (...ids: string[]) => ids.map(track);

const names = (state: QueueState | null) =>
  state ? orderedTracks(state).map((item) => item.id) : null;

describe('createQueue', () => {
  it('starts at the requested index in natural order', () => {
    const queue = createQueue(tracks('a', 'b', 'c'), {startIndex: 1});

    expect(currentTrack(queue)?.id).toBe('b');
    expect(displayPosition(queue)).toBe(2);
  });

  it('clamps an out-of-range start index', () => {
    expect(
      currentTrack(createQueue(tracks('a', 'b'), {startIndex: 99}))?.id,
    ).toBe('b');
    expect(
      currentTrack(createQueue(tracks('a', 'b'), {startIndex: -5}))?.id,
    ).toBe('a');
  });

  it('keeps the chosen track playing when starting shuffled', () => {
    // Picking a track then hitting shuffle should not jump to a different song.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const queue = createQueue(tracks('a', 'b', 'c', 'd', 'e'), {
        shuffle: true,
        startIndex: 3,
      });

      expect(currentTrack(queue)?.id).toBe('d');
    }
  });

  it('handles an empty track list', () => {
    const queue = createQueue([]);

    expect(currentTrack(queue)).toBeNull();
    expect(displayPosition(queue)).toBe(0);
    expect(nextTrack(queue)).toBeNull();
  });
});

describe('nextTrack', () => {
  it('advances through the queue', () => {
    const queue = createQueue(tracks('a', 'b', 'c'));

    expect(currentTrack(nextTrack(queue)!)?.id).toBe('b');
  });

  it('returns null at the end with repeat off, signalling stop', () => {
    const queue = createQueue(tracks('a', 'b'), {startIndex: 1});

    expect(nextTrack(queue)).toBeNull();
  });

  it('wraps at the end with repeat all', () => {
    const queue = createQueue(tracks('a', 'b'), {
      repeat: 'all',
      startIndex: 1,
    });

    expect(currentTrack(nextTrack(queue)!)?.id).toBe('a');
  });

  it('repeats the same track when a track ends under repeat one', () => {
    const queue = createQueue(tracks('a', 'b'), {repeat: 'one'});

    expect(currentTrack(nextTrack(queue, {auto: true})!)?.id).toBe('a');
  });

  it('still advances under repeat one when the user presses next', () => {
    // A finished track repeats; a deliberate skip must move on anyway.
    const queue = createQueue(tracks('a', 'b'), {repeat: 'one'});

    expect(currentTrack(nextTrack(queue, {auto: false})!)?.id).toBe('b');
  });
});

describe('previousTrack', () => {
  it('steps backwards', () => {
    const queue = createQueue(tracks('a', 'b', 'c'), {startIndex: 2});

    expect(currentTrack(previousTrack(queue))?.id).toBe('b');
  });

  it('stays put at the head with repeat off', () => {
    const queue = createQueue(tracks('a', 'b'));

    expect(currentTrack(previousTrack(queue))?.id).toBe('a');
  });

  it('wraps to the end at the head with repeat all', () => {
    const queue = createQueue(tracks('a', 'b', 'c'), {repeat: 'all'});

    expect(currentTrack(previousTrack(queue))?.id).toBe('c');
  });
});

describe('setShuffle', () => {
  it('does not change what is currently playing', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const queue = createQueue(tracks('a', 'b', 'c', 'd', 'e'), {
        startIndex: 2,
      });
      const shuffled = setShuffle(queue, true);

      expect(currentTrack(shuffled)?.id).toBe('c');
    }
  });

  it('restores natural order and keeps the current track when turned off', () => {
    const queue = setShuffle(
      createQueue(tracks('a', 'b', 'c', 'd'), {startIndex: 2}),
      true,
    );
    const restored = setShuffle(queue, false);

    expect(currentTrack(restored)?.id).toBe('c');
    expect(names(restored)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('retains every track when shuffled', () => {
    const shuffled = setShuffle(createQueue(tracks('a', 'b', 'c', 'd')), true);

    expect(names(shuffled)!.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is a no-op when the mode already matches', () => {
    const queue = createQueue(tracks('a', 'b'));

    expect(setShuffle(queue, false)).toBe(queue);
  });
});

describe('repeat cycling', () => {
  it('cycles off -> all -> one -> off', () => {
    let queue = createQueue(tracks('a'));

    expect(queue.repeat).toBe('off');
    queue = cycleRepeat(queue);
    expect(queue.repeat).toBe('all');
    queue = cycleRepeat(queue);
    expect(queue.repeat).toBe('one');
    queue = cycleRepeat(queue);
    expect(queue.repeat).toBe('off');
  });
});

describe('queue editing', () => {
  it('appends without disturbing playback', () => {
    const queue = enqueue(
      createQueue(tracks('a', 'b'), {startIndex: 1}),
      tracks('c'),
    );

    expect(currentTrack(queue)?.id).toBe('b');
    expect(names(queue)).toEqual(['a', 'b', 'c']);
  });

  it('inserts play-next directly after the current track', () => {
    const queue = playNext(
      createQueue(tracks('a', 'b', 'c')),
      tracks('x', 'y'),
    );

    expect(names(queue)).toEqual(['a', 'x', 'y', 'b', 'c']);
    expect(currentTrack(queue)?.id).toBe('a');
    expect(currentTrack(nextTrack(queue)!)?.id).toBe('x');
  });

  it('keeps the same track playing when an earlier entry is removed', () => {
    const queue = removeAt(
      createQueue(tracks('a', 'b', 'c'), {startIndex: 2}),
      0,
    );

    expect(currentTrack(queue)?.id).toBe('c');
    expect(names(queue)).toEqual(['b', 'c']);
  });

  it('clamps the cursor when the last entry is removed', () => {
    const queue = removeAt(createQueue(tracks('a', 'b'), {startIndex: 1}), 1);

    expect(names(queue)).toEqual(['a']);
    expect(currentTrack(queue)?.id).toBe('a');
  });

  it('ignores an out-of-range removal', () => {
    const queue = createQueue(tracks('a'));

    expect(removeAt(queue, 5)).toBe(queue);
    expect(removeAt(queue, -1)).toBe(queue);
  });

  it('ignores empty additions', () => {
    const queue = createQueue(tracks('a'));

    expect(enqueue(queue, [])).toBe(queue);
    expect(playNext(queue, [])).toBe(queue);
  });
});

describe('jumpTo', () => {
  it('moves to a position and clamps out-of-range values', () => {
    const queue = createQueue(tracks('a', 'b', 'c'));

    expect(currentTrack(jumpTo(queue, 2))?.id).toBe('c');
    expect(currentTrack(jumpTo(queue, 99))?.id).toBe('c');
    expect(currentTrack(jumpTo(queue, -3))?.id).toBe('a');
  });
});
