import {StyleSheet} from 'react-native';

/** Styles shared by the settings pages and their rows. */
export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
    paddingHorizontal: 84,
    paddingTop: 60,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 58,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9FB0BA',
    fontSize: 28,
    marginTop: 8,
  },
  group: {
    marginTop: 36,
    width: 960,
  },
  groupTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
    marginTop: 14,
  },
  menuRow: {
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: '#182027',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 18,
  },
  rowFocused: {
    backgroundColor: '#2E5A72',
  },
  icon: {
    color: '#89CFF0',
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
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  rowValue: {
    color: '#B8C5CC',
    fontSize: 20,
    marginTop: 4,
  },
  description: {
    color: '#B8C5CC',
    fontSize: 22,
    marginBottom: 18,
  },
  statusLines: {
    gap: 4,
  },
  statusLine: {
    marginTop: 0,
  },
  infoText: {
    color: '#9FB0BA',
    fontSize: 19,
    fontStyle: 'italic',
    marginTop: -6,
    opacity: 0.76,
  },
  backButton: {
    width: 120,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.74)',
    justifyContent: 'center',
  },
  confirmDialog: {
    width: 620,
    borderRadius: 8,
    backgroundColor: '#101820',
    borderColor: '#324555',
    borderWidth: 2,
    padding: 34,
  },
  confirmTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
  },
  confirmBody: {
    color: '#B8C5CC',
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
    backgroundColor: '#25313A',
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    minWidth: 150,
  },
  dangerButton: {
    backgroundColor: '#5A2D36',
  },
  dangerFocused: {
    backgroundColor: '#7A3843',
  },
});
