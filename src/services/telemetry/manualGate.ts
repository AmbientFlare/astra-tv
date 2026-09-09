import {getItem, setItem} from '../storageAdapter';
const KEY = 'astra.telemetry.enabled.v1';
export const readManualGate = async (): Promise<boolean> => {
  try {
    return (await getItem(KEY)) === '1';
  } catch {
    return false;
  }
};
// This phrase prevents accidental activation; it is not authentication.
export const setManualGate = async (phrase: string): Promise<boolean> => {
  const enabled = phrase.trim().toLowerCase() === 'rawclaw';
  try {
    await setItem(KEY, enabled ? '1' : '0');
    return enabled;
  } catch {
    return false;
  }
};
