import type {KeplerTurboModule} from '@amazon-devices/keplerscript-turbomodule-api';
import {TurboModuleRegistry} from '@amazon-devices/keplerscript-turbomodule-api';

interface AstraDeviceInfoModule extends KeplerTurboModule {
  getFriendlyDeviceName: () => string;
}

const nativeModule =
  TurboModuleRegistry.get<AstraDeviceInfoModule>('AstraDeviceInfo');

/**
 * The device's friendly name, or an empty string when the platform does not
 * supply one (older firmware, or a host without the Identifiers component).
 */
export const getFriendlyDeviceName = (): string => {
  try {
    return nativeModule?.getFriendlyDeviceName() ?? '';
  } catch {
    return '';
  }
};
