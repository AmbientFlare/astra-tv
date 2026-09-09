import {VideoTranscodeCapability} from '../../services/serverCapabilities';

export interface CapabilityChoice<Value> {
  value: Value;
  label: string;
  detail: string;
}

/**
 * Wording rule for this whole screen: describe the outcome, not the hardware.
 * "Does your server have a GPU" is a question about a spec sheet; "4K HDR may
 * stutter" is a question about what the viewer will see, and someone setting
 * up against a friend's server can still answer the second one honestly by
 * picking the third option.
 */
export const videoTranscodeChoices: Array<
  CapabilityChoice<VideoTranscodeCapability>
> = [
  {
    value: 'hardware',
    label: 'Yes, it has a graphics card',
    detail:
      'A dedicated GPU handles the conversion. Best results on 4K and HDR.',
  },
  {
    value: 'cpu',
    label: 'No, processor only',
    // Deliberately not "a modern CPU is fine": 4K HDR tone-mapping is the most
    // expensive job Jellyfin does, and measured CPU-only servers ranged from
    // rough to producing no picture at all.
    detail:
      'Handles most 1080p video. Astra will not ask it to convert 4K HDR, ' +
      'but retries occasionally in case it turns out it can.',
  },
  {
    value: 'unknown',
    label: "I don't know",
    detail:
      "Fine to pick, including for someone else's server. Astra works it " +
      'out from your first few playbacks and remembers what it finds.',
  },
];

export const audioChannelChoices: Array<CapabilityChoice<2 | 6>> = [
  {
    value: 6,
    label: 'Surround sound',
    detail:
      '5.1 or better, through a receiver or soundbar. Astra asks for up to ' +
      'six channels.',
  },
  {
    value: 2,
    label: 'Stereo',
    detail:
      'TV speakers, or a two-channel setup. Surround tracks are mixed down ' +
      'to stereo.',
  },
];
