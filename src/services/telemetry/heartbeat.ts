import {emit, isTelemetryArmed} from './index';
import {
  TELEMETRY_HEARTBEAT_STEADY_MS,
  TELEMETRY_HEARTBEAT_ACTIVE_MS,
} from './config';

export interface HeartbeatSample {
  pos?: number;
  ahead?: number;
  buffering?: boolean;
  paused?: boolean;
  bwEst?: number;
  bitrate?: number;
  width?: number;
  height?: number;
  decodedFrames?: number;
  droppedFrames?: number;
  segP50?: number;
  segP95?: number;
  segCount?: number;
  segmentDurationSec?: number;
}

const nonnegative = (v: number | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : undefined;

export class PlaybackHeartbeat {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private lastDropped = 0;
  private lastDecoded = 0;
  private hasBaseline = false;
  constructor(private readonly sample: () => HeartbeatSample) {}

  start(): void {
    this.stop();
    if (!isTelemetryArmed()) {
      return;
    }
    this.hasBaseline = false;
    const g = ++this.generation;
    this.tick(g);
  }
  stop(): void {
    ++this.generation;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = undefined;
  }

  private tick = (generation: number): void => {
    if (generation !== this.generation) {
      return;
    }
    if (!isTelemetryArmed()) {
      return;
    }
    let now: HeartbeatSample;
    try {
      now = this.sample();
    } catch {
      if (generation === this.generation) {
        this.timer = setTimeout(
          () => this.tick(generation),
          TELEMETRY_HEARTBEAT_STEADY_MS,
        );
      }
      return;
    }
    if (generation !== this.generation || !isTelemetryArmed()) {
      return;
    }
    const n = Object.fromEntries(
      Object.entries(now).map(([k, v]) => [
        k,
        typeof v === 'number' ? nonnegative(v) : v,
      ]),
    ) as HeartbeatSample;
    const dropped = n.droppedFrames ?? 0,
      decoded = n.decodedFrames ?? 0;
    const usable =
      this.hasBaseline &&
      dropped >= this.lastDropped &&
      decoded >= this.lastDecoded;
    const dDropped = usable ? dropped - this.lastDropped : 0,
      dDecoded = usable ? decoded - this.lastDecoded : 0;
    this.hasBaseline =
      n.droppedFrames !== undefined && n.decodedFrames !== undefined;
    this.lastDropped = dropped;
    this.lastDecoded = decoded;
    const ratio = dDecoded > 0 ? dDropped / dDecoded : 0;
    const network =
      n.buffering === true &&
      (n.bwEst ?? 0) > 0 &&
      n.bitrate !== undefined &&
      n.bwEst! < n.bitrate;
    const device = n.buffering === true && (n.ahead ?? 0) >= 2 && ratio > 0.02;
    const server =
      n.buffering === true &&
      n.bwEst !== undefined &&
      (n.bitrate ?? 0) > 0 &&
      n.bwEst >= n.bitrate! &&
      n.segP95 !== undefined &&
      (n.segmentDurationSec ?? 0) > 0 &&
      n.segP95 > n.segmentDurationSec! * 1000;
    emit('hb', {
      ...n,
      dDropped,
      dDecoded,
      dropRatio: Number(ratio.toFixed(4)),
      starve: network
        ? 'network'
        : device
        ? 'device'
        : server
        ? 'server'
        : n.buffering
        ? 'unknown'
        : 'none',
    });
    if (generation !== this.generation) {
      return;
    }
    const active = n.buffering === true || (n.pos ?? 0) < 5;
    this.timer = setTimeout(
      () => this.tick(generation),
      active ? TELEMETRY_HEARTBEAT_ACTIVE_MS : TELEMETRY_HEARTBEAT_STEADY_MS,
    );
  };
}
