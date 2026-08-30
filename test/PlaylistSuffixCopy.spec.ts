export {};

import {
  byteOffsetOfLine,
  trimHlsMediaPlaylistForResume,
} from '../src/w3cmedia/hlsResumePlaylist';

/** Encodes exactly as the filter's fallback path does. */
const encodeString = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index);
  }
  return bytes;
};

/** Mirrors the filter's fast path, so the test pins the shipped behaviour. */
const encodeByCopy = (
  source: Uint8Array,
  trimmed: NonNullable<ReturnType<typeof trimHlsMediaPlaylistForResume>>,
): Uint8Array | null => {
  if (!trimmed.suffixCopyable) {
    return null;
  }
  const cutOffset = byteOffsetOfLine(source, trimmed.firstKeptLineIndex);
  if (cutOffset < 0) {
    return null;
  }
  const header = encodeString(trimmed.header);
  const suffix = source.subarray(cutOffset);
  const out = new Uint8Array(header.length + suffix.length);
  out.set(header, 0);
  out.set(suffix, header.length);
  return out;
};

const buildPlaylist = (segmentCount: number, newline = '\n'): string => {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (let index = 0; index < segmentCount; index += 1) {
    lines.push('#EXTINF:6.000000,', `hls1/main/${index}.ts`);
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join(newline);
};

describe('byteOffsetOfLine', () => {
  it('returns 0 for the first line', () => {
    expect(byteOffsetOfLine(encodeString('a\nb\nc'), 0)).toBe(0);
  });

  it('finds subsequent line starts', () => {
    const bytes = encodeString('aa\nbbb\nc');
    expect(byteOffsetOfLine(bytes, 1)).toBe(3);
    expect(byteOffsetOfLine(bytes, 2)).toBe(7);
  });

  it('reports -1 when the line does not exist', () => {
    expect(byteOffsetOfLine(encodeString('a\nb'), 9)).toBe(-1);
  });

  it('is unaffected by multi-byte UTF-8, whose bytes are never 0x0A', () => {
    // "é" encodes as 0xC3 0xA9; neither byte is a newline.
    const bytes = new Uint8Array([0xc3, 0xa9, 0x0a, 0x78]);
    expect(byteOffsetOfLine(bytes, 1)).toBe(3);
  });
});

describe('copied suffix equals the rebuilt playlist', () => {
  it.each([
    ['short', 12, 30],
    ['typical', 400, 600],
    ['large', 3000, 4000],
    ['resume near the start', 400, 12],
    ['resume near the end', 400, 2340],
  ])('%s', (_name, segmentCount, resumeSeconds) => {
    const playlist = buildPlaylist(segmentCount);
    const trimmed = trimHlsMediaPlaylistForResume(playlist, resumeSeconds);
    expect(trimmed).not.toBeNull();

    const copied = encodeByCopy(encodeString(playlist), trimmed!);
    expect(copied).not.toBeNull();
    expect(copied).toEqual(encodeString(trimmed!.playlist));
  });

  it('falls back rather than copying when the source uses CRLF', () => {
    const playlist = buildPlaylist(400, '\r\n');
    const trimmed = trimHlsMediaPlaylistForResume(playlist, 600);
    expect(trimmed).not.toBeNull();
    expect(trimmed!.suffixCopyable).toBe(false);
    expect(encodeByCopy(encodeString(playlist), trimmed!)).toBeNull();
  });

  it('still trims correctly when no media sequence header exists', () => {
    const playlist = buildPlaylist(200).replace(
      '#EXT-X-MEDIA-SEQUENCE:0\n',
      '',
    );
    const trimmed = trimHlsMediaPlaylistForResume(playlist, 300);
    expect(trimmed).not.toBeNull();
    expect(trimmed!.header).toContain('#EXT-X-MEDIA-SEQUENCE:');

    const copied = encodeByCopy(encodeString(playlist), trimmed!);
    expect(copied).toEqual(encodeString(trimmed!.playlist));
  });
});
