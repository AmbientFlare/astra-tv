const DEBUG_LOGS = false;

export const debugLog = (...args: unknown[]) => {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
};

export const debugInfo = (...args: unknown[]) => {
  if (DEBUG_LOGS) {
    console.info(...args);
  }
};
