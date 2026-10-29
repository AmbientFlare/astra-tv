import {useEffect, useRef} from 'react';
import {
  getServerCapabilities,
  shouldAttemptServerTranscode,
  shouldProbeTranscode,
} from '../../services/serverCapabilities';

/**
 * EnableVideoPlaybackTranscoding is a permission, not a capability: a
 * CPU-only NAS reports it happily and then cannot start a 4K Dolby Vision
 * re-encode at all. Measured on 2026-09-07: the forced session never
 * received a manifest, held zero buffered ranges for its whole life and
 * died to the watchdog with no decoded frames -- three times -- where the
 * unforced passthrough of the same file played with 0.025% drops. So treat
 * a forced session that produces no frames as proof the server cannot do
 * the work, stop forcing for the rest of this screen, and fall back to the
 * passthrough route plus the warning the server should have earned up front.
 *
 * The same verdict is remembered per server across restarts. Without this
 * the 12 s dead start is paid again every time the player mounts; with it,
 * the NAS is asked once and never again until it starts working. Both refs
 * are the player's to flip as a session proves or disproves the server.
 */
export const useServerTranscodeCapability = (serverKey: string) => {
  const decoderTranscodeUnusable = useRef(false);
  // Set when this server's suppressed answer has gone stale enough to re-test.
  // Held rather than acted on immediately: the probe is only spent when a
  // heavy title actually triggers a forced attempt, so someone who only
  // watches 1080p never pays for it and never uses up their weekly try.
  const transcodeProbeArmed = useRef(false);

  useEffect(() => {
    let mounted = true;
    getServerCapabilities(serverKey)
      .then((capabilities) => {
        if (!mounted) {
          return;
        }
        const now = Date.now();
        transcodeProbeArmed.current = shouldProbeTranscode(
          capabilities.videoTranscode,
          capabilities.lastTranscodeProbeAtMs,
          now,
        );
        if (
          !shouldAttemptServerTranscode(
            capabilities.videoTranscode,
            capabilities.lastTranscodeProbeAtMs,
            now,
          )
        ) {
          decoderTranscodeUnusable.current = true;
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [serverKey]);

  return {decoderTranscodeUnusable, transcodeProbeArmed};
};
