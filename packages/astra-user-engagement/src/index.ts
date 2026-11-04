import type {KeplerTurboModule} from '@amazon-devices/keplerscript-turbomodule-api';
import {TurboModuleRegistry} from '@amazon-devices/keplerscript-turbomodule-api';

interface AstraUserEngagementModule extends KeplerTurboModule {
  startVideoEngagement: () => boolean;
  stopVideoEngagement: () => boolean;
  releaseFreedMemory?: () => boolean;
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

/**
 * Hands memory the app has already freed back to the system. Lives here only
 * because this is Astra's one native module; it has nothing to do with
 * engagement.
 */
export const releaseFreedMemory = (): boolean => {
  try {
    return nativeModule?.releaseFreedMemory?.() ?? false;
  } catch {
    return false;
  }
};
