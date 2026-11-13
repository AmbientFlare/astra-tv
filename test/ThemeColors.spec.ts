import fs from 'fs';
import path from 'path';

const SOURCE = path.join(__dirname, '../src');

// The viewer picks subtitle colours, and a QR code has to stay black on
// white, so neither follows the theme.
const EXEMPT = [
  'theme/colors.ts',
  'theme/themes.ts',
  'components/QrCode/index.tsx',
  'screens/PlayerScreen/ExternalSubtitleOverlay.tsx',
];

const COLOUR = /['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))['"]/;

const sourceFiles = (folder: string): string[] =>
  fs.readdirSync(folder, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'shakaplayer' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

describe('theme colours', () => {
  it('are the only colours written in the source', () => {
    const strays = sourceFiles(SOURCE).flatMap((file) => {
      const name = path.relative(SOURCE, file).split(path.sep).join('/');
      if (EXEMPT.includes(name)) {
        return [];
      }
      return fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          COLOUR.test(line) ? [`${name}:${index + 1}: ${line.trim()}`] : [],
        );
    });
    expect(strays).toEqual([]);
  });
});
