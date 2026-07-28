import type {KeplerTurboModule} from '@amazon-devices/keplerscript-turbomodule-api';
import {TurboModuleRegistry} from '@amazon-devices/keplerscript-turbomodule-api';

interface AstraUserEngagementModule extends KeplerTurboModule {
  startVideoEngagement: () => boolean;
  stopVideoEngagement: () => boolean;
}

const nativeModule =
  TurboModuleRegistry.get<AstraUserEngagementModule>('AstraUserEngagement');

export const startVideoEngagement = (): boolean => {
  try {
    return nativeModule?.startVideoEngagement() ?? false;
  } catch {
    return false;
  }
};

export const stopVideoEngagement = (): boolean => {
  try {
    return nativeModule?.stopVideoEngagement() ?? false;
  } catch {
    return false;
  }
};
