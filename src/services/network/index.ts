import AMZNetInfo from '@amazon-devices/keplerscript-netmgr-lib';

const FALLBACK_SUBNET_PREFIXES = ['192.168.0', '192.168.1'];

/**
 * Derive the /24 subnet prefix from this device's own IP so server
 * discovery scans the network the Fire TV is actually on, instead of
 * guessing common home subnets.
 */
export const getLocalSubnetPrefixes = async (): Promise<string[]> => {
  try {
    const state = await AMZNetInfo.fetch();
    const details = state?.details as {ipAddress?: string | null} | null;
    const ipAddress = details?.ipAddress;

    if (ipAddress && /^\d{1,3}(\.\d{1,3}){3}$/.test(ipAddress)) {
      return [ipAddress.split('.').slice(0, 3).join('.')];
    }
  } catch (error) {
    console.warn('[Astra] Could not read device IP for discovery:', error);
  }

  return FALLBACK_SUBNET_PREFIXES;
};
