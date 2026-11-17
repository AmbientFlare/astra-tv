/**
 * Every colour the interface draws, by the job it does.
 *
 * One accent, one focus colour and a short scale of greys. A screen that
 * needs a colour takes the nearest job here rather than a new value; a
 * theme is another set of values for these same names.
 *
 * Not here: subtitle colours, which the viewer picks, and the QR code, which
 * has to stay black on white.
 */
const midnight = {
  text: {
    primary: '#ffffff',
    body: '#e4ecef',
    secondary: '#b8c5cc',
    muted: '#8b97a5',
    faint: '#6f7d8c',
    accent: '#4cc9f0',
    accentSoft: '#89cff0',
    error: '#ffb4a8',
    warning: '#f0c674',
    success: '#7be49b',
    live: '#ff5a5f',
    star: '#f5c518',
    onAccent: '#0b0d10',
  },
  surface: {
    screen: '#0c1116',
    sunken: '#12171d',
    card: '#182027',
    raised: '#1d2530',
    control: '#24313a',
    selected: '#2b4150',
    focus: '#2e5a72',
    danger: '#5a2d36',
    dangerFocus: '#7a3843',
    success: '#1f5133',
    subtitlePreview: '#46565e',
    black: '#000000',
    tile: '#0074B8',
    tileFocus: '#FF6200',
  },
  fill: {
    accent: '#4cc9f0',
    live: '#ff5a5f',
    badge: '#d6232f',
    track: 'rgba(255,255,255,0.24)',
    trackSolid: '#2a313b',
    trackOnArt: 'rgba(0,0,0,0.56)',
    hairline: 'rgba(255,255,255,0.15)',
    positive: '#2f9c7c',
    positiveFocus: '#36b28e',
  },
  border: {
    focus: '#4cc9f0',
    subtle: '#2f3d46',
    control: '#8ca1aa',
    hairline: 'rgba(255,255,255,0.2)',
    disabled: 'rgba(255,255,255,0.08)',
    screen: '#0c1116',
    selected: '#2e5a72',
  },
  scrim: {
    /** Three steps that stand in for a gradient under the player's text. */
    fadeFar: 'rgba(0,0,0,0.16)',
    fadeMid: 'rgba(0,0,0,0.36)',
    tile: 'rgba(0,0,0,0.28)',
    medium: 'rgba(0,0,0,0.56)',
    strong: 'rgba(0,0,0,0.76)',
    heavy: 'rgba(0,0,0,0.84)',
    backdrop: 'rgba(12,17,22,0.52)',
    hero: 'rgba(12,17,22,0.62)',
    /** A lighter step of `hero`, for fading artwork into the screen. */
    heroFade: 'rgba(12,17,22,0.32)',
    panel: 'rgba(12,17,22,0.94)',
    idle: '#020304',
  },
} as const;

type Midnight = typeof midnight;
export interface Palette {
  text: Record<keyof Midnight['text'], string>;
  surface: Record<keyof Midnight['surface'], string>;
  fill: Record<keyof Midnight['fill'], string>;
  border: Record<keyof Midnight['border'], string>;
  scrim: Record<keyof Midnight['scrim'], string>;
}
export interface PaletteOverrides {
  text?: Partial<Palette['text']>;
  surface?: Partial<Palette['surface']>;
  fill?: Partial<Palette['fill']>;
  border?: Partial<Palette['border']>;
  scrim?: Partial<Palette['scrim']>;
}

const copy = (): Palette => ({
  text: {...midnight.text},
  surface: {...midnight.surface},
  fill: {...midnight.fill},
  border: {...midnight.border},
  scrim: {...midnight.scrim},
});

/**
 * The palette in use. Screens read it once, as their styles are built, so a
 * theme has to be written into it before any screen is loaded: see
 * `applyPalette` and `Boot`.
 */
export const colors: Palette = copy();

/** Sets `colors` to the default palette with a theme's changes on top. */
export const applyPalette = (overrides: PaletteOverrides = {}) => {
  const base = copy();
  (Object.keys(base) as Array<keyof Palette>).forEach((group) => {
    Object.assign(colors[group], base[group], overrides[group]);
  });
};
