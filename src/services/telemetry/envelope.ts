import {APP_VERSION, BUILD_NUMBER} from '../../config/app';
import {getDeviceId} from '../deviceIdentity';
import {TELEMETRY_SCHEMA_VERSION} from './config';

export interface TelemetryEvent {
  v: number;
  ts: number;
  sid?: string;
  inst: string;
  app: string;
  build: string;
  ev: string;
  d?: Record<string, unknown>;
}
let sessionId: string | undefined;
export const setTelemetrySession = (value?: string): void => {
  sessionId = value?.slice(0, 128);
};
export const getTelemetrySession = () => sessionId;

// Preserve useful query parameters while removing credentials from all sinks,
// including trace text and console tails. Logs still contain private viewing data.
export const scrubText = (text: string): string =>
  text
    .replace(/([?&](?:api_?key|access_token|token)=)[^&\s"']*/gi, '$1REDACTED')
    .replace(
      /(\b(?:Authorization|X-Emby-Token|X-MediaBrowser-Token)\s*[:=]\s*)[^\r\n]*/gi,
      '$1REDACTED',
    )
    .replace(/(Token\s*=\s*")[^"]*/gi, '$1REDACTED')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1REDACTED@');
export const scrubUrl = scrubText;

const secretKey =
  /^(authorization|cookie|set-cookie|x-astra-token|x-emby-token|x-mediabrowser-token|api_?key|access_token|token|password)$/i;
export const sanitizeDetail = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') {
    return scrubText(value.slice(0, 4000));
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (depth >= 4) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeDetail(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, 40)) {
      result[key.slice(0, 128)] = secretKey.test(key)
        ? 'REDACTED'
        : sanitizeDetail((value as Record<string, unknown>)[key], depth + 1);
    }
    return result;
  }
  return undefined;
};
export const makeEvent = (
  ev: string,
  detail?: Record<string, unknown>,
): TelemetryEvent => ({
  v: TELEMETRY_SCHEMA_VERSION,
  ts: Date.now(),
  sid: sessionId,
  inst: getDeviceId(),
  app: APP_VERSION,
  build: BUILD_NUMBER,
  ev: ev.slice(0, 128),
  d: sanitizeDetail(detail) as Record<string, unknown> | undefined,
});
