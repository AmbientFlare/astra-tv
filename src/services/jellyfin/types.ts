import type {AudioOutputCapabilities} from '../mediaCapabilities';
import type {UserPreferences} from '../storage';

export interface JellyfinServerInfo {
  /**
   * The URL that actually answered, after http/https resolution. Callers must
   * persist and reuse this rather than the raw user input.
   */
  baseUrl: string;
  id: string;
  name: string;
  version: string;
  operatingSystem?: string;
}

export interface JellyfinAuthResult {
  userId: string;
  accessToken: string;
  username?: string;
}

export interface JellyfinLibrary {
  id: string;
  imageUrl?: string;
  name: string;
  type?: string;
}

export interface JellyfinPerson {
  birthDate?: string;
  id: string;
  imageUrl?: string;
  isFavorite?: boolean;
  name: string;
  overview?: string;
}

export interface JellyfinMediaItem {
  id: string;
  name: string;
  type: string;
  backdropImageTags?: string[];
  chapters?: JellyfinChapter[];
  childCount?: number | null;
  isFolder?: boolean;
  /**
   * Standard Jellyfin field. 'Remote' means the server has no local file for
   * this item and resolves a media source when playback is requested, so any
   * file-shaped detail (path, size, container) is unknown until then.
   */
  locationType?: string;
  imageUrl?: string;
  backdropUrl?: string;
  communityRating?: number | null;
  criticsRating?: number;
  genres?: string[];
  indexNumber?: number;
  isFavorite?: boolean;
  isPlayed?: boolean;
  unplayedItemCount?: number;
  mediaSources?: JellyfinMediaSource[];
  mediaType?: string;
  mediaStreams?: JellyfinMediaStream[];
  officialRating?: string | null;
  overview?: string | null;
  parentId?: string;
  parentIndexNumber?: number;
  people?: Array<{
    Id?: string;
    Name?: string;
    Role?: string;
    Type?: string;
    id?: string;
    imageUrl?: string;
    name: string;
    role?: string;
    type?: string;
  }>;
  productionYear?: number;
  premiereDate?: string;
  recursiveItemCount?: number | null;
  runTimeTicks?: number;
  resumePositionTicks?: number;
  remoteTrailers?: Array<{name?: string; url: string}>;
  seriesId?: string;
  seriesName?: string;
}

export interface JellyfinMediaSource {
  Bitrate?: number;
  Container?: string;
  MediaStreams?: Array<{
    Channels?: number;
    Codec?: string;
    Height?: number;
    Type?: string;
  }>;
  Size?: number;
}

export interface JellyfinMediaStream {
  bitRate?: number;
  channels?: number;
  codec?: string;
  displayTitle?: string;
  height?: number;
  index?: number;
  isDefault?: boolean;
  language?: string;
  type?: string;
  videoRangeType?: string;
  width?: number;
}

export interface JellyfinChapter {
  name: string;
  startPositionTicks: number;
}

/** A timed range the server marks inside an item, such as its credits. */
export interface JellyfinMediaSegment {
  endTicks: number;
  id?: string;
  startTicks: number;
  type: string;
}

export interface JellyfinMediaTrack {
  id: string;
  index?: number;
  title: string;
  channels?: number;
  bitrate?: number;
  language?: string;
  codec?: string;
  profile?: string;
  sampleRate?: number;
  displayTitle?: string;
  deliveryMethod?: string;
  isDefault?: boolean;
  isForced?: boolean;
  isExternal?: boolean;
  deliveryUrl?: string;
  burnInRequired?: boolean;
  mimeType?: string;
  supportsTextTrack?: boolean;
  type: 'Audio' | 'Subtitle';
}

export interface JellyfinQualityOption {
  id: string;
  label: string;
  bitrate?: number;
  height?: number;
  width?: number;
}

export interface JellyfinStreamInfo {
  itemId: string;
  audioStreamIndex?: number;
  audioTracks: JellyfinMediaTrack[];
  bitrate?: number;
  container?: string;
  sourceContainer?: string;
  outputContainer?: string;
  sourceAudioBitrate?: number;
  sourceAudioCodec?: string;
  sourceAudioProfile?: string;
  sourceAudioSampleRate?: number;
  sourceVideoCodec?: string;
  sourceVideoRangeType?: string;
  outputAudioBitrate?: number;
  outputAudioCodec?: string;
  outputVideoCodec?: string;
  audioDeliveryMethod?: 'Copy' | 'Transcode' | 'Unknown';
  videoDeliveryMethod?: 'Copy' | 'Transcode' | 'Unknown';
  transcodeReasons?: string[];
  deliveredAudioCodec?: string;
  deliveredAudioStreamIndex?: number;
  deliveredVideoCodec?: string;
  audioOutputCapabilities?: AudioOutputCapabilities;
  audioTranscodePolicy?: string;
  height?: number;
  hlsMinimumSegmentCount?: number;
  hlsSegmentTargetSeconds?: number;
  width?: number;
  mediaSourceId?: string;
  playSessionId?: string;
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
  qualityOptions: JellyfinQualityOption[];
  runTimeTicks?: number;
  startPositionTicks?: number;
  /**
   * The subtitle stream this PlaybackInfo session plays, if any. Absent means
   * Off. It is either the caller's pinned choice or the global preference
   * resolved against the server's media source.
   */
  subtitleStreamIndex?: number;
  /** True when the server was asked to burn `subtitleStreamIndex` in. */
  subtitleBurnIn?: boolean;
  subtitleTracks: JellyfinMediaTrack[];
  transcodeUrl?: string;
  url: string;
}

export type JellyfinSortBy = 'name' | 'dateAdded' | 'releaseDate' | 'rating';
export type JellyfinImageType = 'Primary' | 'Thumb' | 'Banner';

export interface GetItemsOptions {
  filters?: Array<'IsFavorite' | 'IsUnplayed'>;
  imageType?: JellyfinImageType;
  /**
   * null asks the server for whatever it puts at the top of the view, with no
   * type filter. Use it for views whose CollectionType we do not recognise.
   */
  includeItemTypes?: string | null;
  recursive?: boolean;
  sortBy?: JellyfinSortBy;
  sortDescending?: boolean;
}

export interface PlaybackReportInput {
  failed?: boolean;
  itemId: string;
  audioStreamIndex?: number;
  mediaSourceId?: string;
  playSessionId?: string;
  playMethod?: JellyfinStreamInfo['playMethod'];
  positionTicks?: number;
  runTimeTicks?: number;
  isPaused?: boolean;
  subtitleStreamIndex?: number;
}

export interface DiscoveredServer {
  id: string;
  name: string;
  address: string;
}

export interface DiscoveryOptions {
  subnetPrefixes?: string[];
  timeoutMs?: number;
}

export type SubtitleMode = UserPreferences['subtitleMode'];

export interface SubtitleSelectionTrack {
  index?: number;
  isForced?: boolean;
  language?: string;
}

export interface SubtitleSelectionOptions {
  mode: SubtitleMode;
  preferredLanguage: string;
  serverDefaultSubtitleStreamIndex?: number;
  /**
   * A choice made in the player overlay, including an empty object for Off.
   * Keeping Off distinct from an absent override stops the global policy from
   * switching subtitles back on during an audio or quality reload.
   */
  manualSelection?: {streamIndex?: number};
}

export interface QuickConnectInitiateResult {
  code: string;
  secret: string;
}
