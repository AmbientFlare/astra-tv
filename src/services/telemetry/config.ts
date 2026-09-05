import operator from './operator.generated';
// The MAC privilege was denied on the development hardware. Use local opt-in.
export const TELEMETRY_GATE_MODE = 'manual';
export const TELEMETRY_MAC_ALLOWLIST: readonly string[] = [];
export const TELEMETRY_ENDPOINT = operator.endpoint;
export const TELEMETRY_TOKEN = operator.token;
export const TELEMETRY_ENABLED = true;
export const TELEMETRY_SCHEMA_VERSION = 1;
export const TELEMETRY_REDACT_API_KEY = true;
export const TELEMETRY_HEARTBEAT_STEADY_MS = 10000;
export const TELEMETRY_HEARTBEAT_ACTIVE_MS = 2000;
export const TELEMETRY_FLUSH_INTERVAL_MS = 5000;
export const TELEMETRY_MAX_BATCH = 40;
export const TELEMETRY_QUEUE_CAPACITY = 400;
export const TELEMETRY_REQUEST_TIMEOUT_MS = 4000;
export const TELEMETRY_BACKOFF_START_MS = 15000;
export const TELEMETRY_BACKOFF_MAX_MS = 300000;
