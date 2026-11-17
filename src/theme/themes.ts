import {getItem, setItem} from '../services/storageAdapter';
import {applyPalette, PaletteOverrides} from './colors';

/**
 * The looks a viewer can pick in Settings.
 *
 * A theme is the default palette with some of its values replaced. Styles
 * are built as each screen's module loads, so the chosen theme is applied
 * once, before the app is loaded, and a change takes effect at the next
 * start.
 */
export const THEME_IDS = ['midnight', 'black', 'ember'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = 'midnight';

const STORAGE_KEY = 'astra.theme.v1';

const themes: Record<ThemeId, PaletteOverrides> = {
  midnight: {},
  // True black for OLED sets, with the same cyan accent.
  black: {
    surface: {
      screen: '#000000',
      sunken: '#07090b',
      card: '#101418',
      raised: '#14191e',
      control: '#1c2228',
      selected: '#24333d',
    },
    fill: {trackSolid: '#1c2228'},
    border: {screen: '#000000', subtle: '#262d33'},
    scrim: {
      backdrop: 'rgba(0,0,0,0.52)',
      hero: 'rgba(0,0,0,0.62)',
      heroFade: 'rgba(0,0,0,0.32)',
      panel: 'rgba(0,0,0,0.94)',
    },
  },
  // Warm greys with an amber accent.
  ember: {
    text: {
      body: '#efe7df',
      secondary: '#cbbfb4',
      muted: '#9c8f84',
      faint: '#7f7268',
      accent: '#f5a623',
      accentSoft: '#f7c873',
    },
    surface: {
      screen: '#14100d',
      sunken: '#1a1512',
      card: '#221b17',
      raised: '#2a221c',
      control: '#352a22',
      selected: '#4a3826',
      focus: '#6b4a1e',
    },
    fill: {accent: '#f5a623', trackSolid: '#352d27'},
    border: {
      focus: '#f5a623',
      subtle: '#43362c',
      control: '#a8998c',
      screen: '#14100d',
      selected: '#6b4a1e',
    },
    scrim: {
      backdrop: 'rgba(20,16,13,0.52)',
      hero: 'rgba(20,16,13,0.62)',
      heroFade: 'rgba(20,16,13,0.32)',
      panel: 'rgba(20,16,13,0.94)',
    },
  },
};

const isThemeId = (value: unknown): value is ThemeId =>
  THEME_IDS.includes(value as ThemeId);

/** The theme this run of the app was drawn with. */
let applied: ThemeId = DEFAULT_THEME;
export const appliedTheme = () => applied;

export const applyTheme = (id: ThemeId) => {
  applied = id;
  applyPalette(themes[id]);
};

/** The theme saved for the next start; the default when none is. */
export const getStoredTheme = async (): Promise<ThemeId> => {
  const stored = await getItem(STORAGE_KEY).catch(() => null);
  return isThemeId(stored) ? stored : DEFAULT_THEME;
};

export const storeTheme = (id: ThemeId): Promise<void> =>
  setItem(STORAGE_KEY, id);

/** Applies the saved theme. Call before any screen module is loaded. */
export const loadTheme = async (): Promise<ThemeId> => {
  const id = await getStoredTheme();
  applyTheme(id);
  return id;
};
