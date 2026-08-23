import {trimHlsMediaPlaylistForResume} from '../src/w3cmedia/hlsResumePlaylist';

describe('Jellyfin dynamic HLS resume playlist', () => {
  const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:6.000000, nodesc
hls1/main/0.ts
#EXTINF:6.000000, nodesc
hls1/main/1.ts
#EXTINF:6.000000, nodesc
hls1/main/2.ts
#EXTINF:6.000000, nodesc
hls1/main/3.ts
#EXT-X-ENDLIST`;

  it('makes the segment containing the resume position first', () => {
    const result = trimHlsMediaPlaylistForResume(playlist, 13);

    expect(result?.skippedSegments).toBe(2);
    expect(result?.skippedDurationSeconds).toBe(12);
    expect(result?.playlist).toContain('#EXT-X-MEDIA-SEQUENCE:2');
    expect(result?.playlist).not.toContain('hls1/main/0.ts');
    expect(result?.playlist).not.toContain('hls1/main/1.ts');
    expect(result?.playlist).toContain('hls1/main/2.ts');
  });

  it('does not trim playback from the beginning or a master playlist', () => {
    expect(trimHlsMediaPlaylistForResume(playlist, 0)).toBeNull();
    expect(
      trimHlsMediaPlaylistForResume(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmain.m3u8',
        30,
      ),
    ).toBeNull();
  });
});
