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
    'Sleep timer: press Menu during a video and pick 15 to 90 minutes ' +
      'or the end of the episode. Astra pauses and saves your place on ' +
      'the server.',
    'Audio can follow the language set on your Jellyfin account, and a ' +
      'second-choice language covers videos that lack your first. ' +
      'Commentary tracks are never picked on their own.',
    'An audio or subtitle track you choose in a series is kept for its ' +
      'next episodes.',
    'If the network drops, Astra pauses and shows Retry, which picks ' +
      'up where you were.',
    'Astra knows which Fire TV it is on, and asks the server to ' +
      'convert files that are too heavy for it instead of failing to ' +
      'play them.',
  ],
  de: [
    'Schlaf-Timer: Drück während eines Videos Menü und wähle 15 bis 90 ' +
      'Minuten oder das Ende der Folge. Astra pausiert und speichert ' +
      'deine Position auf dem Server.',
    'Die Audiosprache kann deinem Jellyfin-Konto folgen, und eine ' +
      'Zweitsprache springt ein, wenn ein Video deine erste nicht hat. ' +
      'Kommentarspuren werden nie von selbst gewählt.',
    'Eine Audio- oder Untertitelspur, die du in einer Serie wählst, ' +
      'bleibt für die nächsten Folgen erhalten.',
    'Bricht das Netzwerk ab, pausiert Astra und zeigt Erneut ' +
      'versuchen, womit es an derselben Stelle weitergeht.',
    'Astra erkennt, auf welchem Fire TV es läuft, und lässt zu schwere ' +
      'Dateien vom Server umwandeln, statt an ihnen zu scheitern.',
  ],
  es: [
    'Temporizador para dormir: pulsa Menú durante un video y elige de ' +
      '15 a 90 minutos o el final del episodio. Astra pausa y guarda tu ' +
      'posición en el servidor.',
    'El audio puede seguir el idioma de tu cuenta de Jellyfin, y un ' +
      'segundo idioma cubre los videos que no tienen el primero. Las ' +
      'pistas de comentarios nunca se eligen solas.',
    'La pista de audio o de subtítulos que elijas en una serie se ' +
      'mantiene en los siguientes episodios.',
    'Si se cae la red, Astra pausa y muestra Reintentar, que sigue ' +
      'desde donde estabas.',
    'Astra sabe en qué Fire TV está y pide al servidor que convierta ' +
      'los archivos demasiado pesados para él, en lugar de no poder ' +
      'reproducirlos.',
  ],
  fr: [
    'Minuterie de veille : appuyez sur Menu pendant une vidéo et ' +
      'choisissez de 15 à 90 minutes ou la fin de l’épisode. Astra se ' +
      'met en pause et enregistre votre position sur le serveur.',
    'L’audio peut suivre la langue réglée sur votre compte Jellyfin, ' +
      'et une langue de secours prend le relais quand une vidéo n’a pas ' +
      'la première. Les pistes de commentaires ne sont jamais choisies ' +
      'd’office.',
    'La piste audio ou de sous-titres choisie dans une série est ' +
      'conservée pour les épisodes suivants.',
    'Si le réseau coupe, Astra se met en pause et affiche Réessayer, ' +
      'qui reprend là où vous en étiez.',
    'Astra sait sur quel Fire TV il tourne et demande au serveur de ' +
      'convertir les fichiers trop lourds pour lui, au lieu d’échouer à ' +
      'les lire.',
  ],
  it: [
    'Timer di sospensione: premi Menu durante un video e scegli da 15 ' +
      'a 90 minuti o la fine dell’episodio. Astra mette in pausa e salva ' +
      'la posizione sul server.',
    'L’audio può seguire la lingua impostata nel tuo account Jellyfin, ' +
      'e una seconda lingua copre i video che non hanno la prima. Le ' +
      'tracce di commento non vengono mai scelte da sole.',
    'La traccia audio o di sottotitoli scelta in una serie resta per ' +
      'gli episodi successivi.',
    'Se la rete cade, Astra mette in pausa e mostra Riprova, che ' +
      'riparte da dove eri.',
    'Astra sa su quale Fire TV si trova e chiede al server di ' +
      'convertire i file troppo pesanti per lui, invece di non riuscire ' +
      'a riprodurli.',
  ],
  pt: [
    'Timer para dormir: aperte Menu durante um vídeo e escolha de 15 a ' +
      '90 minutos ou o fim do episódio. O Astra pausa e salva sua ' +
      'posição no servidor.',
    'O áudio pode seguir o idioma definido na sua conta do Jellyfin, e ' +
      'um segundo idioma cobre os vídeos que não têm o primeiro. Faixas ' +
      'de comentário nunca são escolhidas sozinhas.',
    'A faixa de áudio ou de legenda escolhida em uma série continua ' +
      'nos próximos episódios.',
    'Se a rede cair, o Astra pausa e mostra Tentar de novo, que ' +
      'continua de onde você estava.',
    'O Astra sabe em qual Fire TV está e pede ao servidor para ' +
      'converter arquivos pesados demais para ele, em vez de falhar ao ' +
      'reproduzi-los.',
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
