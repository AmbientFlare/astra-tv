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
    'Fewer crashes, especially when leaving a video, opening a very large ' +
      'library, or coming back to Astra after using another app.',
    'Next Up shows how many episodes of the season are left, and an ' +
      "episode's page lists the rest of its season.",
    'Faster seeking: taps add up before Astra jumps, holding speeds it up, ' +
      'and scene previews show when your server has made them.',
    'Subtitles now sit on the picture with a shadow; choose a dark box ' +
      'instead under Settings → Playback.',
    'On 1080p sticks Astra asks the server to shrink 4K films so they can ' +
      'play, and lower bitrate limits are available for slow connections.',
  ],
  de: [
    'Weniger Abstürze, vor allem beim Verlassen eines Videos, beim Öffnen ' +
      'sehr großer Mediatheken und bei der Rückkehr aus einer anderen App.',
    'Als Nächstes zeigt, wie viele Folgen der Staffel noch übrig sind, und ' +
      'die Seite einer Folge listet den Rest ihrer Staffel.',
    'Schnelleres Spulen: Tastendrücke summieren sich, bevor Astra springt, ' +
      'Gedrückthalten beschleunigt, und Szenenvorschauen erscheinen, wenn ' +
      'dein Server sie erstellt hat.',
    'Untertitel liegen jetzt mit Schatten auf dem Bild; einen dunklen ' +
      'Kasten wählst du unter Einstellungen → Wiedergabe.',
    'Auf 1080p-Sticks bittet Astra den Server, 4K-Filme zu verkleinern, ' +
      'damit sie laufen, und für langsame Verbindungen gibt es niedrigere ' +
      'Bitrate-Grenzen.',
  ],
  es: [
    'Menos cierres inesperados, sobre todo al salir de un video, abrir una ' +
      'biblioteca muy grande o volver a Astra desde otra app.',
    'A continuación muestra cuántos episodios quedan de la temporada, y la ' +
      'página de un episodio muestra el resto de su temporada.',
    'Saltos más rápidos: las pulsaciones se suman antes de que Astra salte, ' +
      'mantener pulsado acelera, y aparecen vistas previas de escenas si tu ' +
      'servidor las ha creado.',
    'Los subtítulos ahora van sobre la imagen con sombra; si prefieres un ' +
      'recuadro oscuro, elígelo en Ajustes → Reproducción.',
    'En los dispositivos 1080p, Astra pide al servidor que reduzca las ' +
      'películas 4K para poder reproducirlas, y hay límites de tasa de bits ' +
      'más bajos para conexiones lentas.',
  ],
  fr: [
    'Moins de plantages, surtout en quittant une vidéo, en ouvrant une très ' +
      'grande médiathèque ou en revenant dans Astra depuis une autre app.',
    'À suivre indique combien d’épisodes il reste dans la saison, et la ' +
      'page d’un épisode liste le reste de sa saison.',
    'Déplacement plus rapide : les appuis s’additionnent avant le saut, ' +
      'maintenir accélère, et des aperçus de scènes s’affichent quand votre ' +
      'serveur les a générés.',
    'Les sous-titres s’affichent désormais sur l’image avec une ombre ; ' +
      'pour un fond sombre, allez dans Paramètres → Lecture.',
    'Sur les clés 1080p, Astra demande au serveur de réduire les films 4K ' +
      'pour qu’ils puissent être lus, et des plafonds de débit plus bas sont ' +
      'proposés pour les connexions lentes.',
  ],
  it: [
    'Meno arresti anomali, soprattutto uscendo da un video, aprendo una ' +
      'libreria molto grande o tornando in Astra da un’altra app.',
    'Prossimi mostra quanti episodi mancano alla fine della stagione, e la ' +
      'pagina di un episodio elenca il resto della stagione.',
    'Spostamenti più rapidi: le pressioni si sommano prima del salto, ' +
      'tenere premuto accelera, e compaiono le anteprime delle scene se il ' +
      'tuo server le ha create.',
    'I sottotitoli ora stanno sull’immagine con un’ombra; se preferisci un ' +
      'riquadro scuro, sceglilo in Impostazioni → Riproduzione.',
    'Sugli stick 1080p Astra chiede al server di ridurre i film 4K per ' +
      'poterli riprodurre, e ci sono limiti di bitrate più bassi per le ' +
      'connessioni lente.',
  ],
  pt: [
    'Menos travamentos, principalmente ao sair de um vídeo, abrir uma ' +
      'biblioteca muito grande ou voltar ao Astra depois de usar outro app.',
    'A seguir mostra quantos episódios faltam na temporada, e a página de ' +
      'um episódio lista o resto da temporada.',
    'Avanço mais rápido: os toques se somam antes do Astra pular, segurar ' +
      'acelera, e prévias das cenas aparecem quando o seu servidor as gerou.',
    'As legendas agora ficam sobre a imagem com sombra; para uma caixa ' +
      'escura, escolha em Configurações → Reprodução.',
    'Em sticks 1080p, o Astra pede ao servidor para reduzir filmes 4K para ' +
      'que possam ser reproduzidos, e há limites de taxa de bits menores ' +
      'para conexões lentas.',
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
