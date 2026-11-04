/* global globalThis */
import {trace} from '../logging/trace';

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsShape {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}
interface HermesShape {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, error: unknown) => void;
  }) => void;
}

// Room for the message and the top of the stack; crashTail keeps js.* details
// at this length where other traces are cut to 300.
export const JS_ERROR_DETAIL_MAX = 1500;
// How long a fatal error may wait for the tail to reach storage before the
// default handler ends the app.
const FATAL_PERSIST_WAIT_MS = 800;

export const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    const stack = (error.stack ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('at '))
      .slice(0, 8)
      .join(' | ');
    return `${error.name}: ${error.message}${stack ? ' | ' + stack : ''}`.slice(
      0,
      JS_ERROR_DETAIL_MAX,
    );
  }
  return String(error).slice(0, JS_ERROR_DETAIL_MAX);
};

let installed = false;

/**
 * Records uncaught errors and unhandled rejections as traces, so they land in
 * the crash tail. On a fatal error the tail is written before the default
 * handler runs, because that handler ends the app.
 */
export const installJsErrorCapture = (
  persist: () => Promise<void> | undefined,
): void => {
  if (installed) {
    return;
  }
  installed = true;
  const scope = globalThis as unknown as {
    ErrorUtils?: ErrorUtilsShape;
    HermesInternal?: HermesShape;
  };
  const errorUtils = scope.ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      trace(isFatal ? 'js.fatal' : 'js.error', describeError(error));
      const write = isFatal ? persist() : undefined;
      if (!write) {
        previous(error, isFatal);
        return;
      }
      void Promise.race([
        write.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, FATAL_PERSIST_WAIT_MS)),
      ]).then(() => previous(error, isFatal));
    });
  }
  // React Native installs its own tracker in development builds only.
  const isDev = typeof __DEV__ !== 'undefined' && (__DEV__ as boolean) === true;
  if (!isDev) {
    try {
      scope.HermesInternal?.enablePromiseRejectionTracker?.({
        allRejections: true,
        onUnhandled: (_id, error) =>
          trace('js.unhandledRejection', describeError(error)),
      });
    } catch {
      /* Diagnostics must never break startup. */
    }
  }
};
