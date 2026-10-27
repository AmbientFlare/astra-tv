import {t} from '../../i18n';
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
export const videoTranscodeChoices = (): Array<
  CapabilityChoice<VideoTranscodeCapability>
> => [
  {
    value: 'hardware',
    label: t('capabilities.hardwareLabel'),
    detail: t('capabilities.hardwareDetail'),
  },
  {
    value: 'cpu',
    label: t('capabilities.cpuLabel'),
    // Deliberately not "a modern CPU is fine": 4K HDR tone-mapping is the most
    // expensive job Jellyfin does, and measured CPU-only servers ranged from
    // rough to producing no picture at all.
    detail: t('capabilities.cpuDetail'),
  },
  {
    value: 'unknown',
    label: t('capabilities.unknownLabel'),
    detail: t('capabilities.unknownDetail'),
  },
];

export const audioChannelChoices = (): Array<CapabilityChoice<2 | 6>> => [
  {
    value: 6,
    label: t('capabilities.surroundLabel'),
    detail: t('capabilities.surroundDetail'),
  },
  {
    value: 2,
    label: t('capabilities.stereoLabel'),
    detail: t('capabilities.stereoDetail'),
  },
];
