import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {encodeQr} from '../../services/qr';

interface QrCodeProps {
  value: string;
  /** Side in pixels, quiet zone included. Rounded down to whole modules. */
  size: number;
  testID?: string;
}

// Scanners want four light modules around the symbol.
const QUIET_ZONE = 4;

/**
 * Draws a QR code as plain Views, one per horizontal run of dark modules, on
 * a white square. Module sizes are whole pixels so no seams show between
 * runs on a 1080p panel.
 */
export const QrCode = ({value, size, testID}: QrCodeProps) => {
  const runs = useMemo(() => {
    const {modules} = encodeQr(value);
    const result: Array<{row: number; col: number; length: number}> = [];
    modules.forEach((cells, row) => {
      let start = -1;
      cells.forEach((dark, col) => {
        if (dark && start < 0) {
          start = col;
        }
        if (start >= 0 && (!dark || col === cells.length - 1)) {
          result.push({col: start, length: col - start + (dark ? 1 : 0), row});
          start = -1;
        }
      });
    });
    return {count: modules.length, result};
  }, [value]);

  const module = Math.max(1, Math.floor(size / (runs.count + QUIET_ZONE * 2)));
  const side = module * (runs.count + QUIET_ZONE * 2);

  return (
    <View
      accessibilityLabel={value}
      style={[styles.symbol, {height: side, width: side}]}
      testID={testID}>
      {runs.result.map(({row, col, length}) => (
        <View
          key={`${row}-${col}`}
          style={[
            styles.run,
            {
              height: module,
              left: (col + QUIET_ZONE) * module,
              top: (row + QUIET_ZONE) * module,
              width: length * module,
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  run: {
    backgroundColor: '#000000',
    position: 'absolute',
  },
  symbol: {
    backgroundColor: '#ffffff',
  },
});
