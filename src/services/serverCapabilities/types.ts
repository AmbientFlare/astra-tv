/**
 * What Astra knows about one server's ability to re-encode video.
 *
 * `EnableVideoPlaybackTranscoding` reports permission rather than capability,
 * so it cannot answer this on its own -- a CPU-only NAS grants it and then
 * produces zero frames (measured on the GPU-less lab server, 2026-09-08). The user is
 * the cheapest source of the real answer, and playback is the authoritative
 * one, so both feed the same field.
 */
export type VideoTranscodeCapability =
  /** A GPU or other dedicated encoder. Force the re-encode on heavy titles. */
  | 'hardware'
  /** CPU only: fine for 1080p, expect trouble on 4K HDR. */
  | 'cpu'
  /** Not answered yet. Try the re-encode once; playback settles it. */
  | 'unknown'
  /** Observed failing: a forced session produced no frames. Never force. */
  | 'unable';

/**
 * Where a capability value came from. Measurement outranks a stated answer,
 * but the two are kept distinguishable so Settings can say which it is and a
 * user who fixes their server is not stuck with a verdict from before.
 */
export type CapabilitySource = 'default' | 'stated' | 'detected';

export interface ServerCapabilities {
  videoTranscode: VideoTranscodeCapability;
  videoTranscodeSource: CapabilitySource;
  /**
   * Transcoding profiles clamp to 6 channels (`deviceProfile.ts`), so 2 and 6
   * are the only values that change what the server is asked for.
   */
  maxAudioChannels: 2 | 6;
  maxAudioChannelsSource: CapabilitySource;
  /** Whether the first-run questions have been answered for this server. */
  /**
   * When a forced re-encode was last actually attempted against this server.
   * 0 means never, which is why a brand new suppressed answer still gets one
   * try: a stated answer is a guess until something measures it.
   */
  lastTranscodeProbeAtMs: number;
  interviewCompleted: boolean;
  /**
   * Set when detection contradicts what the user said, cleared once the notice
   * has been shown. Someone whose GPU dropped out of its container wants to
   * know, so this is worth one interruption -- but only one.
   */
  pendingCapabilityNotice: boolean;
  updatedAtMs: number;
}
