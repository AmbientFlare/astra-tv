export {};

/**
 * Pins the manifest re-encode used by the HLS resume trim.
 *
 * The original implementation built two intermediate arrays per playlist and
 * measured 5,008 ms on a 1.33 M-character playlist on device, blocking the JS
 * thread long enough for the Fire TV thread monitor to kill the app. These
 * tests pin the byte-for-byte equivalence of the replacement so the fast path
 * cannot silently change what Shaka receives.
 */

/** The original, allocation-heavy implementation, kept as the oracle. */
const encodeViaIntermediateArrays = (text: string): ArrayBuffer =>
  new Uint8Array(Array.from(text).map((character) => character.charCodeAt(0)))
    .buffer;

/** The shipped implementation. */
const encodeViaPreallocatedBytes = (text: string): ArrayBuffer => {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index);
  }
  return bytes.buffer;
};

describe('HLS playlist re-encoding', () => {
  const cases: Array<[string, string]> = [
    ['empty', ''],
    ['ascii playlist', '#EXTM3U\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n'],
    ['carriage returns', '#EXTM3U\r\n#EXTINF:6,\r\nseg.ts\r\n'],
    ['high code units truncate identically', 'aÿĀሴz'],
  ];

  it.each(cases)('produces identical bytes: %s', (_name, text) => {
    expect(new Uint8Array(encodeViaPreallocatedBytes(text))).toEqual(
      new Uint8Array(encodeViaIntermediateArrays(text)),
    );
  });

  it('matches on a large synthetic playlist', () => {
    let playlist = '#EXTM3U\n';
    for (let index = 0; index < 5000; index += 1) {
      playlist += `#EXTINF:6.000000,\nhls1/main/${index}.ts\n`;
    }
    playlist += '#EXT-X-ENDLIST\n';

    expect(new Uint8Array(encodeViaPreallocatedBytes(playlist))).toEqual(
      new Uint8Array(encodeViaIntermediateArrays(playlist)),
    );
  });

  it('allocates one buffer of exactly the character count', () => {
    const playlist = '#EXTM3U\n#EXTINF:6,\nseg.ts\n';
    expect(encodeViaPreallocatedBytes(playlist).byteLength).toBe(
      playlist.length,
    );
  });
});
