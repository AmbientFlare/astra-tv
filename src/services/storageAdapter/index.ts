import {AsyncStorage} from '@amazon-devices/react-native-kepler';

/** Strict async storage boundary: missing values are null, failures reject. */
export const getItem = (key: string): Promise<string | null> =>
  AsyncStorage.getItem(key);
export const setItem = (key: string, value: string): Promise<void> =>
  AsyncStorage.setItem(key, value);
export const removeItem = (key: string): Promise<void> =>
  AsyncStorage.removeItem(key);
