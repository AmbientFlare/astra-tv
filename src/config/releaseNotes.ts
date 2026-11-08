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
    "Live TV (beta): a channel list with what's on now and next, a guide, an On Now row on Home, recording, and Up/Down to change channels.",
    'Search and filter by genre inside a library.',
    'Choose the size and color of subtitles under Settings → Playback.',
  ],
  de: [
    'Live-TV (Beta): Senderliste mit dem, was jetzt und danach läuft, ein Programmführer, eine Zeile „Jetzt läuft“ auf der Startseite, Aufnahmen und Hoch/Runter zum Umschalten.',
    'In einer Mediathek nach Genre suchen und filtern.',
    'Größe und Farbe der Untertitel unter Einstellungen → Wiedergabe wählen.',
  ],
  es: [
    'TV en directo (beta): lista de canales con lo que se emite ahora y después, una guía, una fila «Ahora en directo» en el inicio, grabación y Arriba/Abajo para cambiar de canal.',
    'Busca y filtra por género dentro de una biblioteca.',
    'Elige el tamaño y el color de los subtítulos en Ajustes → Reproducción.',
  ],
  fr: [
    'TV en direct (bêta) : liste des chaînes avec le programme en cours et le suivant, un guide, une rangée « En ce moment » sur l’accueil, l’enregistrement, et Haut/Bas pour changer de chaîne.',
    'Recherchez et filtrez par genre dans une bibliothèque.',
    'Choisissez la taille et la couleur des sous-titres dans Paramètres → Lecture.',
  ],
  it: [
    'TV in diretta (beta): elenco dei canali con il programma in onda e il successivo, una guida, una riga «In onda ora» nella Home, la registrazione e Su/Giù per cambiare canale.',
    'Cerca e filtra per genere all’interno di una libreria.',
    'Scegli dimensione e colore dei sottotitoli in Impostazioni → Riproduzione.',
  ],
  pt: [
    'TV ao vivo (beta): lista de canais com o que passa agora e a seguir, um guia, uma fileira “Agora no ar” no Início, gravação e Cima/Baixo para trocar de canal.',
    'Pesquise e filtre por gênero dentro de uma biblioteca.',
    'Escolha o tamanho e a cor das legendas em Configurações → Reprodução.',
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
