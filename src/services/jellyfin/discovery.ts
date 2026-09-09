import type {DiscoveredServer, DiscoveryOptions} from './types';
import {getJson, normalizeServerUrl, buildUrl, getAuthHeaders} from './http';

const scanCandidate = async (
  address: string,
  timeoutMs: number,
): Promise<DiscoveredServer | null> => {
  try {
    const response = await getJson<{
      Id?: string;
      ServerName?: string;
    }>(`${address}/System/Info/Public`, {}, timeoutMs);

    return {
      id: response.Id ?? address,
      name: response.ServerName ?? 'Media Server',
      address,
    };
  } catch {
    return null;
  }
};

export const measureServerBandwidth = async (
  serverUrl: string,
  accessToken: string,
): Promise<number> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const download = async (sizeBytes: number) => {
    const url = buildUrl(baseUrl, '/Playback/BitrateTest', {
      Size: sizeBytes,
      api_key: accessToken,
    });
    const started = Date.now();
    const response = await fetch(url, {headers: getAuthHeaders(accessToken)});

    if (!response.ok) {
      throw new Error(`Bandwidth test failed (HTTP ${response.status}).`);
    }

    const buffer = await response.arrayBuffer();
    const seconds = (Date.now() - started) / 1000;
    return (buffer.byteLength * 8) / seconds;
  };

  // Small warm-up so connection setup / TLS handshake doesn't count
  // against the real measurement.
  await download(500000);
  const bitsPerSecond = await download(20000000);
  return Math.round(bitsPerSecond);
};

export const discoverServers = async ({
  subnetPrefixes = ['192.168.0', '192.168.1'],
  timeoutMs = 300,
}: DiscoveryOptions = {}): Promise<DiscoveredServer[]> => {
  const candidates = subnetPrefixes.flatMap((prefix) =>
    Array.from(
      {length: 254},
      (_, index) => `http://${prefix}.${index + 1}:8096`,
    ),
  );
  const discovered = new Map<string, DiscoveredServer>();
  const workers = Array.from({length: 48}, async (_, workerIndex) => {
    for (
      let candidateIndex = workerIndex;
      candidateIndex < candidates.length;
      candidateIndex += 48
    ) {
      const server = await scanCandidate(candidates[candidateIndex], timeoutMs);

      if (server) {
        discovered.set(server.address, server);
      }
    }
  });

  await Promise.all(workers);

  return Array.from(discovered.values());
};
