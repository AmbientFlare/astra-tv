import {
  shakaFailure,
  formatPlaybackFailure,
  formatBufferingTime,
} from '../src/services/playbackHealth';

describe('safe playback diagnostics', () => {
  it('retains HTTP status and request kind without secrets', () => {
    const result = shakaFailure({
      code: 1001,
      category: 1,
      severity: 2,
      data: [
        'https://private?ApiKey=secret',
        500,
        'private body',
        {Authorization: 'secret'},
        1,
      ],
    });
    expect(formatPlaybackFailure(result)).toBe(
      'source=shaka code=1001 category=1 severity=2 http=500 request=segment',
    );
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  });
  it('does not interpret other errors as HTTP status', () => {
    expect(
      shakaFailure({code: 1002, data: ['', 500, '', {}, 1]}).httpStatus,
    ).toBeUndefined();
    expect(
      shakaFailure({code: 1001, data: ['', 'secret', '', {}, 'secret']}),
    ).toEqual({source: 'shaka', code: 1001});
    expect(shakaFailure(null).code).toBeUndefined();
    expect(shakaFailure({code: NaN}).code).toBeUndefined();
  });
  it('renders unavailable buffering durations without NaN or Infinity', () => {
    for (const value of [undefined, NaN, Infinity, -1]) {
      expect(formatBufferingTime(value)).toBe('—');
    }
    expect(formatBufferingTime(0)).toBe('0.0s');
    expect(formatBufferingTime(2.34)).toBe('2.3s');
  });
});
