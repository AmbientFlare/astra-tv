/** Release events distinguish held keys from repeated taps. A gap is a fallback
 * for media-control channels that do not deliver release events. */
export class SeekAcceleration {
  private direction: number = 0;
  private startedAt = 0;
  private lastAt = 0;

  step(direction: 1 | -1, baseSeconds: number, now = Date.now()): number {
    if (
      direction !== this.direction ||
      now - this.lastAt > 500 ||
      now < this.lastAt
    ) {
      this.startedAt = now;
    }
    this.direction = direction;
    this.lastAt = now;
    const heldMs = now - this.startedAt;
    const multiplier = heldMs >= 2500 ? 6 : heldMs >= 1000 ? 3 : 1;
    return Math.min(baseSeconds * multiplier, Math.max(60, baseSeconds));
  }

  release(direction: 1 | -1): boolean {
    if (direction !== this.direction) {
      return false;
    }
    this.reset();
    return true;
  }

  reset(): void {
    this.direction = 0;
    this.startedAt = 0;
    this.lastAt = 0;
  }
}
