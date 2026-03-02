export type ClockSkew = {
  sync: (serverEpochMs: number) => void;
  toPerfTime: (serverEpochMs: number) => number;
};

export const createClockSkew = (): ClockSkew => {
  let serverClockSkewMs = 0;
  let initialized = false;

  const sync = (serverEpochMs: number): void => {
    const sample = serverEpochMs - Date.now();
    if (!initialized) {
      serverClockSkewMs = sample;
      initialized = true;
      return;
    }
    serverClockSkewMs = serverClockSkewMs * 0.9 + sample * 0.1;
  };

  const toPerfTime = (serverEpochMs: number): number =>
    performance.now() + (serverEpochMs - (Date.now() + serverClockSkewMs));

  return { sync, toPerfTime };
};
