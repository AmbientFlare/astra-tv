export interface AudioOutputCapabilities {
  ac3: boolean;
  eac3: boolean;
  mp3: boolean;
  opus: boolean;
  /**
   * Vega 0.23 recognizes DTS codec tags in MP4, but its media-descriptor API
   * maps them to the generic audio wildcard instead of a DTS decoder. Keep the
   * probe result for diagnostics, but do not advertise DTS direct playback
   * until the platform can verify that exact decoder/output path.
   */
  dtsProbeSupported: boolean;
  dtsDirectPlayVerified: false;
  preferredTranscodeCodec: 'ac3' | 'eac3' | 'aac';
  probeSucceeded: boolean;
}

interface AudioDecodingConfiguration {
  type: 'media-source';
  audio: {
    contentType: string;
    channels: string;
    bitrate: number;
    samplerate: number;
    spatialRendering: boolean;
  };
}

type DecodingInfo = (
  configuration: AudioDecodingConfiguration,
) => Promise<{supported: boolean}>;
type IsTypeSupported = (contentType: string) => boolean;

interface AudioCapabilityProbeDependencies {
  decodingInfo?: DecodingInfo;
  isTypeSupported?: IsTypeSupported;
}

const SAFE_AUDIO_CAPABILITIES: AudioOutputCapabilities = {
  ac3: false,
  eac3: false,
  mp3: false,
  opus: false,
  dtsProbeSupported: false,
  dtsDirectPlayVerified: false,
  preferredTranscodeCodec: 'aac',
  probeSucceeded: false,
};

const codecConfigurations = {
  ac3: {
    contentType: 'audio/mp4; codecs="ac-3"',
    bitrate: 640000,
  },
  eac3: {
    contentType: 'audio/mp4; codecs="ec-3"',
    bitrate: 768000,
  },
  mp3: {
    contentType: 'audio/mp4; codecs="mp4a.6B"',
    bitrate: 320000,
  },
  opus: {
    contentType: 'audio/mp4; codecs="opus"',
    bitrate: 512000,
  },
  dts: {
    contentType: 'audio/mp4; codecs="dtsh"',
    bitrate: 4000000,
  },
} as const;

const probeAudioCodec = async (
  codec: keyof typeof codecConfigurations,
  probeDecodingInfo: DecodingInfo,
  probeContainer: IsTypeSupported,
) => {
  const configuration = codecConfigurations[codec];

  if (!probeContainer(configuration.contentType)) {
    return false;
  }

  try {
    const result = await probeDecodingInfo({
      type: 'media-source',
      audio: {
        contentType: configuration.contentType,
        channels: '6',
        bitrate: configuration.bitrate,
        samplerate: 48000,
        spatialRendering: false,
      },
    });

    return result.supported;
  } catch (error) {
    console.warn(
      `[Astra] ${codec.toUpperCase()} capability probe failed:`,
      error,
    );
    return false;
  }
};

export const probeAudioOutputCapabilities = async (
  dependencies: AudioCapabilityProbeDependencies = {},
): Promise<AudioOutputCapabilities> => {
  try {
    let probeDecodingInfo = dependencies.decodingInfo;
    let probeContainer = dependencies.isTypeSupported;

    // Load Vega's native-backed media module only for a real device probe.
    // Off-device tests can exercise the policy without a Kepler turbo module.
    if (!probeDecodingInfo || !probeContainer) {
      const media = await import(
        '@amazon-devices/react-native-w3cmedia/dist/headless'
      );
      // Vega's declaration incorrectly requires both video and audio even
      // though its implementation explicitly accepts audio-only probes.
      probeDecodingInfo ??= media.decodingInfo as unknown as DecodingInfo;
      probeContainer ??= media.MediaSource.isTypeSupported.bind(
        media.MediaSource,
      );
    }

    const [ac3, eac3, mp3, opus, dtsProbeSupported] = await Promise.all([
      probeAudioCodec('ac3', probeDecodingInfo, probeContainer),
      probeAudioCodec('eac3', probeDecodingInfo, probeContainer),
      probeAudioCodec('mp3', probeDecodingInfo, probeContainer),
      probeAudioCodec('opus', probeDecodingInfo, probeContainer),
      probeAudioCodec('dts', probeDecodingInfo, probeContainer),
    ]);
    const preferredTranscodeCodec = ac3 ? 'ac3' : eac3 ? 'eac3' : 'aac';

    const capabilities: AudioOutputCapabilities = {
      ac3,
      eac3,
      mp3,
      opus,
      dtsProbeSupported,
      dtsDirectPlayVerified: false,
      preferredTranscodeCodec,
      probeSucceeded: true,
    };

    console.info('[Astra] Runtime audio capabilities:', capabilities);
    return capabilities;
  } catch (error) {
    console.warn(
      '[Astra] Unable to query runtime audio capabilities; using AAC fallback:',
      error,
    );
    return SAFE_AUDIO_CAPABILITIES;
  }
};

let cachedCapabilities: Promise<AudioOutputCapabilities> | null = null;

export const getAudioOutputCapabilities = () => {
  cachedCapabilities ??= probeAudioOutputCapabilities();
  return cachedCapabilities;
};

export const resetAudioOutputCapabilitiesCache = () => {
  cachedCapabilities = null;
};

export const defaultAudioOutputCapabilities = SAFE_AUDIO_CAPABILITIES;
