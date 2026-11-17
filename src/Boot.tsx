import React, {useEffect, useState} from 'react';
import {loadTheme} from './theme/themes';

/**
 * Applies the viewer's theme, then loads the app.
 *
 * Every screen builds its styles from the palette as its module is loaded,
 * so the app is required only once the palette is set. Reading the choice
 * failing must not keep the app from starting: it starts in the default.
 */
export const Boot = () => {
  const [Root, setRoot] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    let mounted = true;
    loadTheme()
      .catch(() => undefined)
      .then(() => {
        if (mounted) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const {App} = require('./App');
          setRoot(() => App);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  return Root ? <Root /> : null;
};
