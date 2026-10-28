import {createContext, useContext} from 'react';
import type {Locale} from './index';

// Provided by the app shell, which stores the choice and remounts the
// navigator so every screen re-reads its text. The default does nothing, so
// screens rendered on their own in tests need no provider.
export const LanguageContext = createContext<(locale: Locale) => void>(
  () => undefined,
);

export const useChangeLanguage = () => useContext(LanguageContext);
