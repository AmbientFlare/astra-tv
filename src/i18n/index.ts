import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import {en, MessageKey, Messages} from './locales/en';
import {de} from './locales/de';
import {es} from './locales/es';
import {fr} from './locales/fr';
import {it} from './locales/it';
import {pt} from './locales/pt';

export type Locale = 'en' | 'de' | 'es' | 'fr' | 'it' | 'pt';
export type {MessageKey};

// Each language is listed under its own name, so someone who does not read
// English can still find theirs on the first screen.
export const LANGUAGES: ReadonlyArray<{locale: Locale; name: string}> = [
  {locale: 'en', name: 'English'},
  {locale: 'de', name: 'Deutsch'},
  {locale: 'es', name: 'Español'},
  {locale: 'fr', name: 'Français'},
  {locale: 'it', name: 'Italiano'},
  {locale: 'pt', name: 'Português'},
];

const catalogs: Record<Locale, Messages> = {en, de, es, fr, it, pt};

// BCP 47 tags for date and time formatting. Portuguese is Brazilian because
// Brazil is the only Portuguese-speaking Fire TV market.
const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en-US',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-BR',
};

const LANGUAGE_KEY = 'astra.language.v1';

let currentLocale: Locale = 'en';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && value in catalogs;

export const getLocale = (): Locale => currentLocale;

export const getLocaleTag = (): string => LOCALE_TAGS[currentLocale];

// Text is read through t() at render time, so the app shell remounts the
// navigator after calling this rather than every screen subscribing.
export const setActiveLocale = (locale: Locale): void => {
  currentLocale = locale;
};

export type MessageParams = Record<string, string | number>;

const interpolate = (template: string, params?: MessageParams): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )
    : template;

export const t = (key: MessageKey, params?: MessageParams): string =>
  interpolate(catalogs[currentLocale][key] ?? en[key], params);

// Keys that come in `.one` / `.other` pairs, named without the suffix.
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? Base : never;
}[MessageKey];

// French and Brazilian Portuguese treat zero as singular; the other four use
// the singular for exactly one.
const isSingular = (count: number): boolean =>
  currentLocale === 'fr' || currentLocale === 'pt'
    ? Math.abs(count) < 2
    : count === 1;

export const tn = (
  key: PluralKey,
  count: number,
  params?: MessageParams,
): string =>
  t(`${key}.${isSingular(count) ? 'one' : 'other'}` as MessageKey, {
    count,
    ...params,
  });

export const readStoredLocale = async (): Promise<Locale | null> => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
};

export const storeLocale = async (locale: Locale): Promise<void> => {
  await AsyncStorage.setItem(LANGUAGE_KEY, locale);
};

export {LanguageContext, useChangeLanguage} from './LanguageContext';
