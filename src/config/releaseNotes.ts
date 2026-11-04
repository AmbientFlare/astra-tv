import {APP_VERSION, BUILD_NUMBER} from './app';

import {getLocale, Locale} from '../i18n';

/**
 * What changed in this release, in the words a viewer would use rather than
 * the words the code uses. This is the single source: the About page lists it,
 * and the one-time What's New notice shows it after an update. Rewrite the
 * list on every version bump, and keep it to the handful of things somebody
 * would actually notice.
 *
 * Every release ships its notes in every interface language, and the viewer
 * sees the ones for the language they picked in Astra. The record is keyed by
 * Locale, so leaving a language out fails the build. Write English first,
 * then translate each bullet, using the on-screen names of menus as the
 * catalogues spell them (Settings → Playback is Einstellungen → Wiedergabe).
 */
export const RELEASE_HIGHLIGHTS: Readonly<Record<Locale, readonly string[]>> = {
  en: [
    'Fire TV no longer closes Astra when you leave it during a video ' +
      'or the screensaver comes on, so coming back no longer starts ' +
      'over from Home.',
    'Astra now sends crash reports and anonymous playback stats so ' +
      'crashes and playback problems can be fixed. Never titles, ' +
      'searches, server addresses or account details. Turn it off under ' +
      'Settings → Send crash reports and usage stats.',
  ],
  de: [
    'Fire TV beendet Astra nicht mehr, wenn du es während eines ' +
      'Videos verlässt oder der Bildschirmschoner startet. Beim ' +
      'Zurückkehren beginnt es nicht mehr von vorn auf der Startseite.',
    'Astra sendet jetzt Absturzberichte und anonyme ' +
      'Wiedergabestatistiken, damit Abstürze und Wiedergabeprobleme ' +
      'behoben werden können. Nie Titel, Suchen, Serveradressen oder ' +
      'Kontodaten. Abschalten unter Einstellungen → Absturzberichte und ' +
      'Nutzungsstatistiken senden.',
  ],
  es: [
    'Fire TV ya no cierra Astra cuando lo dejas durante un video o se ' +
      'activa el protector de pantalla, así que al volver ya no empieza ' +
      'de nuevo desde el inicio.',
    'Astra ahora envía informes de errores y estadísticas anónimas de ' +
      'reproducción para poder corregir fallos y problemas al ' +
      'reproducir. Nunca títulos, búsquedas, direcciones de servidor ni ' +
      'datos de la cuenta. Desactívalo en Ajustes → Enviar informes de ' +
      'errores y estadísticas de uso.',
  ],
  fr: [
    'Fire TV ne ferme plus Astra quand vous le quittez pendant une ' +
      'vidéo ou que l’économiseur d’écran se lance : en y revenant, il ne ' +
      'redémarre plus depuis l’accueil.',
    'Astra envoie désormais des rapports de plantage et des ' +
      'statistiques de lecture anonymes pour corriger les plantages et ' +
      'les problèmes de lecture. Jamais de titres, de recherches, ' +
      'd’adresses de serveur ni d’informations de compte. Désactivez-le ' +
      'dans Paramètres → Envoyer les rapports de plantage et ' +
      "statistiques d'utilisation.",
  ],
  it: [
    'Fire TV non chiude più Astra quando lo lasci durante un video o ' +
      'parte il salvaschermo, quindi tornandoci non riparte più dalla ' +
      'Home.',
    'Astra ora invia segnalazioni di arresto e statistiche di ' +
      'riproduzione anonime per correggere arresti e problemi di ' +
      'riproduzione. Mai titoli, ricerche, indirizzi del server o dati ' +
      'dell’account. Disattivalo in Impostazioni → Invia segnalazioni di ' +
      "arresto e statistiche d'uso.",
  ],
  pt: [
    'O Fire TV não fecha mais o Astra quando você sai dele durante um ' +
      'vídeo ou o protetor de tela liga, então ao voltar ele não ' +
      'recomeça mais pelo Início.',
    'O Astra agora envia relatórios de falhas e estatísticas anônimas ' +
      'de reprodução para corrigir falhas e problemas de reprodução. ' +
      'Nunca títulos, buscas, endereços de servidor ou dados da conta. ' +
      'Desative em Configurações → Enviar relatórios de falhas e ' +
      'estatísticas de uso.',
  ],
};

export const releaseHighlights = (): readonly string[] =>
  RELEASE_HIGHLIGHTS[getLocale()];

/**
 * One line per language, each written in that language, telling the viewer
 * Astra can be switched to it. The What's New notice lists the lines for every
 * language other than the one in use, because a household that updated from
 * an English-only version never saw the first-run picker. Set
 * `SHOW_LANGUAGE_LINES` to false once this has been announced, or keep it on
 * for the release that adds a new language (and add that language's line).
 */
export const SHOW_LANGUAGE_LINES = true;

export const LANGUAGE_LINES: Readonly<Record<Locale, string>> = {
  en: 'English: you can switch Astra to English under Settings → Language.',
  de:
    'Deutsch: Astra gibt es jetzt auf Deutsch. Stell es unter ' +
    'Einstellungen → Sprache ein.',
  es: 'Español: Astra ya está en español. Cámbialo en Ajustes → Idioma.',
  fr:
    'Français : Astra est maintenant en français. Changez la langue dans ' +
    'Paramètres → Langue.',
  it:
    'Italiano: Astra ora parla italiano. Cambia lingua in ' +
    'Impostazioni → Lingua.',
  pt:
    'Português: o Astra agora está em português. Mude em ' +
    'Configurações → Idioma.',
};

export const languageLines = (): string[] =>
  SHOW_LANGUAGE_LINES
    ? (Object.keys(LANGUAGE_LINES) as Locale[])
        .filter((locale) => locale !== getLocale())
        .map((locale) => LANGUAGE_LINES[locale])
    : [];

/**
 * Identity of the What's New notice, stored as
 * `AppStateConfig.acknowledgedNoticeId`. The build number is part of it, so
 * every build shows the notice once — that is what test builds want, since a
 * rebuilt version is a different set of changes. Drop `BUILD_NUMBER` here to
 * go back to one prompt per released version.
 */
export const CURRENT_NOTICE_ID = `whats-new-${APP_VERSION}-${BUILD_NUMBER}`;
