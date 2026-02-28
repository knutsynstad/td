export type TickTiming = {
  maintenanceMs: number;
  simulationMs: number;
  broadcastMs: number;
  totalMs: number;
};

export const createTickTimer = () => {
  let tickStartMs = 0;
  let maintenanceMs = 0;
  let simulationMs = 0;
  let broadcastMs = 0;

  return {
    startTick: () => {
      tickStartMs = Date.now();
      maintenanceMs = 0;
      simulationMs = 0;
      broadcastMs = 0;
    },
    measureAsync: async <T>(
      phase: 'maintenance' | 'simulation' | 'broadcast',
      fn: () => Promise<T>
    ): Promise<T> => {
      const start = Date.now();
      try {
        return await fn();
      } finally {
        const elapsed = Date.now() - start;
        if (phase === 'maintenance') maintenanceMs += elapsed;
        else if (phase === 'simulation') simulationMs += elapsed;
        else broadcastMs += elapsed;
      }
    },
    measureSync: <T>(
      phase: 'maintenance' | 'simulation' | 'broadcast',
      fn: () => T
    ): T => {
      const start = Date.now();
      try {
        return fn();
      } finally {
        const elapsed = Date.now() - start;
        if (phase === 'maintenance') maintenanceMs += elapsed;
        else if (phase === 'simulation') simulationMs += elapsed;
        else broadcastMs += elapsed;
      }
    },
    getTiming: (): TickTiming => ({
      maintenanceMs,
      simulationMs,
      broadcastMs,
      totalMs: Date.now() - tickStartMs,
    }),
  };
};
