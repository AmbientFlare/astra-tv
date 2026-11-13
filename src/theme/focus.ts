import {StyleSheet} from 'react-native';
import {colors} from './colors';

/**
 * How the focused thing on screen looks. There is one look per kind of
 * thing, so the eye learns it once:
 *
 * - control: buttons, tabs, pills and list rows fill and gain an outline.
 * - card: posters and tiles lift slightly and gain an outline.
 * - danger: a control that deletes or signs out.
 * - outline: the outline alone, for things with art of their own.
 * - none: the item draws its own focus (the guide grid).
 *
 * FocusableItem eases these in: it fades the fill and grows the card itself,
 * and takes only the outline from here. The styles below are the same looks
 * at rest, for the few buttons that cannot go through FocusableItem.
 */
export type FocusKind = 'control' | 'card' | 'danger' | 'outline' | 'none';

export const FOCUS_BORDER_WIDTH = 3;
export const CARD_FOCUS_SCALE = 1.04;

/** Focus arrives a little slower than it leaves, so a fast scroll stays crisp. */
export const FOCUS_IN_MS = 140;
export const FOCUS_OUT_MS = 90;

/** The fill that fades in behind a focused control. */
export const focusFill: Partial<Record<FocusKind, string>> = {
  control: colors.surface.focus,
  danger: colors.surface.dangerFocus,
};

export const focusStyles = StyleSheet.create({
  control: {
    backgroundColor: colors.surface.focus,
    borderColor: colors.border.focus,
  },
  card: {
    backgroundColor: colors.surface.control,
    borderColor: colors.border.focus,
    transform: [{scale: CARD_FOCUS_SCALE}],
  },
  danger: {
    backgroundColor: colors.surface.dangerFocus,
    borderColor: colors.border.focus,
  },
  outline: {
    borderColor: colors.border.focus,
  },
  none: {},
});
