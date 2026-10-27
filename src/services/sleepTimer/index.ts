import {useEffect, useRef, useState} from 'react';

export const SLEEP_TIMER_MINUTES = [15, 30, 60, 90] as const;

export type SleepTimerChoice =
  | (typeof SLEEP_TIMER_MINUTES)[number]
  | 'endOfItem'
  | null;

export type SleepTimer =
  | {kind: 'minutes'; minutes: number; endsAt: number}
  | {kind: 'endOfItem'};

// Kept outside the player so a timer set in one episode carries on into the
// next one, which mounts a new player screen.
let current: SleepTimer | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

export const getSleepTimer = () => current;

export const setSleepTimer = (
  choice: SleepTimerChoice,
  now: number = Date.now(),
) => {
  current =
    choice === null
      ? null
      : choice === 'endOfItem'
      ? {kind: 'endOfItem'}
      : {kind: 'minutes', minutes: choice, endsAt: now + choice * 60_000};
  notify();
};

export const clearSleepTimer = () => {
  if (current) {
    current = null;
    notify();
  }
};

/** The choice a timer was set with, for marking the selected button. */
export const sleepTimerChoice = (timer: SleepTimer | null): SleepTimerChoice =>
  timer === null
    ? null
    : timer.kind === 'endOfItem'
    ? 'endOfItem'
    : (timer.minutes as SleepTimerChoice);

const REMAINING_REFRESH_MS = 30_000;

/**
 * The current timer and whole minutes left on it. `onExpire` runs once when
 * a minutes timer runs out, after the timer is cleared.
 */
export const useSleepTimer = (onExpire: () => void) => {
  const [timer, setTimer] = useState<SleepTimer | null>(current);
  const [now, setNow] = useState(() => Date.now());
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    const listener = () => {
      setTimer(current);
      setNow(Date.now());
    };
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (timer?.kind !== 'minutes') {
      return;
    }
    const expiry = setTimeout(() => {
      if (current === timer) {
        clearSleepTimer();
        expire.current();
      }
    }, Math.max(0, timer.endsAt - Date.now()));
    const refresh = setInterval(() => setNow(Date.now()), REMAINING_REFRESH_MS);
    return () => {
      clearTimeout(expiry);
      clearInterval(refresh);
    };
  }, [timer]);

  const minutesLeft =
    timer?.kind === 'minutes'
      ? Math.max(1, Math.ceil((timer.endsAt - now) / 60_000))
      : undefined;
  return {minutesLeft, timer};
};
