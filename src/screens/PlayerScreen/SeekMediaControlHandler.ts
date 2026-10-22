import type {ITimeValue} from '@amazon-devices/kepler-media-controls';
import {KeplerMediaControlHandler} from '@amazon-devices/react-native-w3cmedia';

const seconds = (time: ITimeValue) =>
  time.seconds + (time.nanoseconds ?? 0) / 1000000000;

/** KMC owns transport keys; their duplicate D-pad events must be ignored. */
export class SeekMediaControlHandler extends KeplerMediaControlHandler {
  constructor(
    private readonly skip: (delta?: number, direction?: 1 | -1) => void,
    private readonly seek: (position: number) => void,
  ) {
    super();
  }

  async handleFastForward(): Promise<void> {
    this.skip(undefined, 1);
  }

  async handleRewind(): Promise<void> {
    this.skip(undefined, -1);
  }

  async handleSkipForward(delta: ITimeValue): Promise<void> {
    this.skip(seconds(delta));
  }

  async handleSkipBackward(delta: ITimeValue): Promise<void> {
    this.skip(-seconds(delta));
  }

  async handleSeek(position: ITimeValue): Promise<void> {
    this.seek(seconds(position));
  }

  async handleStartOver(): Promise<void> {
    this.seek(0);
  }
}
