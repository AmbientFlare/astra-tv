import {StyleSheet} from 'react-native';
import {colors} from '../../theme';

/** Styles shared by the settings pages and their rows. */
export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.screen,
    paddingHorizontal: 84,
    paddingTop: 60,
  },
  title: {
    color: colors.text.primary,
    fontSize: 58,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.text.muted,
    fontSize: 28,
    marginTop: 8,
  },
  group: {
    marginTop: 36,
    width: 960,
  },
  groupTitle: {
    color: colors.text.primary,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
    marginTop: 14,
  },
  menuRow: {
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: colors.surface.card,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 18,
  },
  rowFocused: {
    backgroundColor: colors.surface.focus,
  },
  icon: {
    color: colors.text.accentSoft,
    fontSize: 30,
    fontWeight: '800',
    marginRight: 18,
    textAlign: 'center',
    width: 38,
  },
  rowCopy: {
    flex: 1,
  },
  rowText: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '700',
  },
  rowValue: {
    color: colors.text.secondary,
    fontSize: 20,
    marginTop: 4,
  },
  description: {
    color: colors.text.secondary,
    fontSize: 22,
    marginBottom: 18,
  },
  statusLines: {
    gap: 4,
  },
  statusLine: {
    marginTop: 0,
  },
  subtitlePreview: {
    alignItems: 'center',
    backgroundColor: colors.surface.subtitlePreview,
    borderRadius: 8,
    justifyContent: 'center',
    marginBottom: 22,
    minHeight: 120,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  infoText: {
    color: colors.text.muted,
    fontSize: 19,
    fontStyle: 'italic',
    marginTop: -6,
    opacity: 0.76,
  },
  backButton: {
    width: 120,
    height: 50,
    borderRadius: 8,
    backgroundColor: colors.surface.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  backText: {
    color: colors.text.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: colors.scrim.strong,
    justifyContent: 'center',
  },
  confirmDialog: {
    width: 620,
    borderRadius: 8,
    backgroundColor: colors.surface.sunken,
    borderColor: colors.border.subtle,
    borderWidth: 2,
    padding: 34,
  },
  confirmTitle: {
    color: colors.text.primary,
    fontSize: 34,
    fontWeight: '800',
  },
  confirmBody: {
    color: colors.text.secondary,
    fontSize: 22,
    lineHeight: 30,
    marginTop: 14,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 26,
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.surface.control,
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    minWidth: 150,
  },
  dangerButton: {
    backgroundColor: colors.surface.danger,
  },
  dangerFocused: {
    backgroundColor: colors.surface.dangerFocus,
  },
});
