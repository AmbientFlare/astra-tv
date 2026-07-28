import {
  CLEARTEXT_MEDIA_MESSAGE,
  getServerUrlCandidates,
  isCleartextUrl,
  normalizeServerUrl,
} from '../src/services/serverUrl';

describe('normalizeServerUrl', () => {
  it('trims whitespace and strips trailing slashes', () => {
    expect(normalizeServerUrl('  https://media.example.com/  ')).toBe(
      'https://media.example.com',
    );
    expect(normalizeServerUrl('https://media.example.com///')).toBe(
      'https://media.example.com',
    );
  });

  it('leaves a well-formed url untouched', () => {
    expect(normalizeServerUrl('http://192.168.1.50:8096')).toBe(
      'http://192.168.1.50:8096',
    );
  });

  it('applies no host-specific rewriting', () => {
    // Guards against reintroducing a hardcoded personal server.
    const url = 'http://media.example.com';
    expect(normalizeServerUrl(url)).toBe(url);
  });
});

describe('getServerUrlCandidates', () => {
  it('returns nothing for empty input', () => {
    expect(getServerUrlCandidates('   ')).toEqual([]);
  });

  it('tries the requested scheme first, then the alternate', () => {
    expect(getServerUrlCandidates('http://media.example.com')).toEqual([
      'http://media.example.com',
      'https://media.example.com',
    ]);
    expect(getServerUrlCandidates('https://media.example.com')).toEqual([
      'https://media.example.com',
      'http://media.example.com',
    ]);
  });

  it('recovers a server that moved from http to https', () => {
    // The case the old hardcoded rewrite existed to handle, now generic.
    expect(getServerUrlCandidates('http://media.example.com')).toContain(
      'https://media.example.com',
    );
  });

  it('preserves ports and paths when switching scheme', () => {
    expect(getServerUrlCandidates('http://media.example.com:8920')).toEqual([
      'http://media.example.com:8920',
      'https://media.example.com:8920',
    ]);
  });

  it('prefers http for private and loopback addresses', () => {
    expect(getServerUrlCandidates('192.168.1.50:8096')[0]).toBe(
      'http://192.168.1.50:8096',
    );
    expect(getServerUrlCandidates('10.0.0.8')[0]).toBe('http://10.0.0.8');
    expect(getServerUrlCandidates('172.16.4.2')[0]).toBe('http://172.16.4.2');
    expect(getServerUrlCandidates('localhost:8096')[0]).toBe(
      'http://localhost:8096',
    );
    expect(getServerUrlCandidates('jellyfin.local')[0]).toBe(
      'http://jellyfin.local',
    );
  });

  it('does not treat a public address as private', () => {
    // 172.32.x is outside the 172.16-31 private range.
    expect(getServerUrlCandidates('172.32.0.1')[0]).toBe('https://172.32.0.1');
    expect(getServerUrlCandidates('media.example.com')[0]).toBe(
      'https://media.example.com',
    );
  });

  it('always offers both schemes for a bare host', () => {
    expect(getServerUrlCandidates('media.example.com')).toHaveLength(2);
    expect(getServerUrlCandidates('192.168.1.50')).toHaveLength(2);
  });
});

describe('isCleartextUrl', () => {
  // Vega's media pipeline refuses cleartext. Confirmed on device: the same
  // stream URL gives readyState 0 over http:// and plays over https://.
  it('detects unencrypted urls', () => {
    expect(isCleartextUrl('http://192.168.0.18:8096')).toBe(true);
    expect(isCleartextUrl('http://media.example.com')).toBe(true);
    expect(isCleartextUrl('  http://media.example.com  ')).toBe(true);
  });

  it('does not flag https', () => {
    expect(isCleartextUrl('https://media.example.com')).toBe(false);
    expect(isCleartextUrl('HTTPS://media.example.com')).toBe(false);
  });

  it('is case-insensitive about the scheme', () => {
    expect(isCleartextUrl('HTTP://media.example.com')).toBe(true);
  });

  it('names the fix, not just the symptom', () => {
    expect(CLEARTEXT_MEDIA_MESSAGE).toMatch(/https:\/\//);
    expect(CLEARTEXT_MEDIA_MESSAGE).toMatch(/playback|play/i);
  });
});

describe('scheme and host casing', () => {
  // The TV on-screen keyboard auto-capitalizes. React Native's URL rejects a
  // non-lowercase scheme, which surfaces as "Invalid base URL" on every
  // request and looks like an unreachable server.
  it('lowercases an auto-capitalized scheme', () => {
    expect(normalizeServerUrl('Http://jelly2.example.com/')).toBe(
      'http://jelly2.example.com',
    );
    expect(normalizeServerUrl('HTTPS://media.example.com')).toBe(
      'https://media.example.com',
    );
    expect(normalizeServerUrl('HtTpS://media.example.com')).toBe(
      'https://media.example.com',
    );
  });

  it('lowercases the host so casing cannot fork a profile', () => {
    expect(normalizeServerUrl('https://Media.Example.COM')).toBe(
      'https://media.example.com',
    );
  });

  it('preserves path casing', () => {
    // Only scheme and host are case-insensitive; a proxied sub-path is not.
    expect(normalizeServerUrl('Http://Example.com/Jellyfin')).toBe(
      'http://example.com/Jellyfin',
    );
  });

  it('preserves the port', () => {
    expect(normalizeServerUrl('HTTP://192.168.0.18:8096')).toBe(
      'http://192.168.0.18:8096',
    );
  });

  it('still detects cleartext after casing is normalized', () => {
    expect(isCleartextUrl(normalizeServerUrl('Http://example.com'))).toBe(true);
  });

  it('builds candidates from a capitalized scheme', () => {
    expect(getServerUrlCandidates('Http://media.example.com')).toEqual([
      'http://media.example.com',
      'https://media.example.com',
    ]);
  });
});
