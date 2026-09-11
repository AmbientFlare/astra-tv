import {
  compareJellyfinVersions,
  getJellyfinVersionWarning,
  isJellyfinVersionBelowMinimum,
  MIN_SUPPORTED_JELLYFIN_VERSION,
} from '../src/services/jellyfin';

describe('Jellyfin server support floor', () => {
  it('centralizes the minimum at 10.10.0', () => {
    expect(MIN_SUPPORTED_JELLYFIN_VERSION).toBe('10.10.0');
  });

  it.each([
    ['10.9.11', true],
    ['10.10', false],
    ['10.10.0', false],
    ['10.10.7', false],
    ['10.11.11', false],
    ['12.0', false],
    ['12.0.0', false],
  ])('%s is below the floor: %s', (version, below) => {
    expect(isJellyfinVersionBelowMinimum(version)).toBe(below);
  });

  it('accepts release suffixes without changing the comparison', () => {
    expect(isJellyfinVersionBelowMinimum('10.10.7-rc1')).toBe(false);
    expect(isJellyfinVersionBelowMinimum('v10.9.11+build')).toBe(true);
  });

  it('does not classify unknown versions as unsupported or throw', () => {
    expect(compareJellyfinVersions('unknown')).toBeNull();
    expect(isJellyfinVersionBelowMinimum('')).toBe(false);
    expect(getJellyfinVersionWarning('unknown')).toBeNull();
  });

  it('formats the unsupported-version warning with the server version', () => {
    expect(getJellyfinVersionWarning('10.9.11')).toBe(
      'Astra officially supports Jellyfin Server 10.10 and newer. This server is running Jellyfin 10.9.11. It may work, but this version is unsupported. Update Jellyfin if you experience problems.',
    );
  });
});
