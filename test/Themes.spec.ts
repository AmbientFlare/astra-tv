import {colors} from '../src/theme';
import {
  appliedTheme,
  applyTheme,
  getStoredTheme,
  loadTheme,
  storeTheme,
} from '../src/theme/themes';
import {getItem, setItem} from '../src/services/storageAdapter';

jest.mock('../src/services/storageAdapter', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(() => Promise.resolve()),
}));

const stored = getItem as jest.Mock;

describe('themes', () => {
  afterEach(() => applyTheme('midnight'));

  it('changes the palette in place and restores it', () => {
    const palette = colors;
    const original = colors.surface.screen;
    applyTheme('black');
    expect(colors).toBe(palette);
    expect(colors.surface.screen).toBe('#000000');
    expect(appliedTheme()).toBe('black');
    applyTheme('ember');
    expect(colors.fill.accent).toBe(colors.border.focus);
    // A value Black changed and Ember does not goes back to the default.
    expect(colors.fill.accent).not.toBe('#4cc9f0');
    applyTheme('midnight');
    expect(colors.surface.screen).toBe(original);
    expect(colors.fill.accent).toBe('#4cc9f0');
  });

  it('applies the saved theme at start', async () => {
    stored.mockResolvedValue('ember');
    expect(await loadTheme()).toBe('ember');
    expect(appliedTheme()).toBe('ember');
  });

  it('falls back to the default for an unknown or unreadable choice', async () => {
    stored.mockResolvedValue('neon');
    expect(await getStoredTheme()).toBe('midnight');
    stored.mockRejectedValue(new Error('storage'));
    expect(await loadTheme()).toBe('midnight');
  });

  it('saves a choice without applying it', async () => {
    await storeTheme('black');
    expect(setItem).toHaveBeenCalledWith('astra.theme.v1', 'black');
    expect(appliedTheme()).toBe('midnight');
  });
});
