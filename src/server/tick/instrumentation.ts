import { percentile } from '../../shared/utils';

type TickProfile = {
  maintenanceMs: number;
  simulationMs: number;
  broadcastMs: number;
  totalMs: number;
};

const MAX_PROFILE_SAMPLES = 300;

export type InstrumentationConfig = {
  slowThresholdMs: number;
  enableProfiling: boolean;
  profileLogEveryTicks: number;
  targetP95Ms: number;
};

export type RecordTickArgs<TPerf = unknown> = {
  maintenanceMs: number;
  simulationMs: number;
  broadcastMs: number;
  totalMs: number;
  tickSeq: number;
  commandCount: number;
  deltaCount: number;
  ticksProcessed: number;
  perf?: TPerf;
};

export const createTickInstrumentation = <TPerf = unknown>(
  config: InstrumentationConfig
) => {
  const tickProfiles: TickProfile[] = [];

  return {
    recordTick: (args: RecordTickArgs<TPerf>): void => {
      const {
        maintenanceMs,
        simulationMs,
        broadcastMs,
        totalMs,
        tickSeq,
        commandCount,
        deltaCount,
        ticksProcessed,
        perf,
      } = args;

      tickProfiles.push({
        maintenanceMs,
        simulationMs,
        broadcastMs,
        totalMs,
      });
      if (tickProfiles.length > MAX_PROFILE_SAMPLES) tickProfiles.shift();

      if (totalMs >= config.slowThresholdMs) {
        console.warn('Slow tick in game loop', {
          tickDurationMs: totalMs,
          tickSeq,
          commandCount,
          deltaCount,
          perf,
          stageBreakdownMs: {
            maintenance: maintenanceMs,
            simulation: simulationMs,
            broadcast: broadcastMs,
          },
        });
      }

      if (
        config.enableProfiling &&
        ticksProcessed % config.profileLogEveryTicks === 0
      ) {
        const totals = tickProfiles.map((entry) => entry.totalMs);
        const p95 = percentile(totals, 0.95);
        const avgTotal =
          totals.reduce((sum, value) => sum + value, 0) /
          Math.max(1, totals.length);
        const avgMaintenance =
          tickProfiles.reduce((sum, value) => sum + value.maintenanceMs, 0) /
          Math.max(1, tickProfiles.length);
        const avgSimulation =
          tickProfiles.reduce((sum, value) => sum + value.simulationMs, 0) /
          Math.max(1, tickProfiles.length);
        const avgBroadcast =
          tickProfiles.reduce((sum, value) => sum + value.broadcastMs, 0) /
          Math.max(1, tickProfiles.length);
        console.info('Game tick profile', {
          sampleSize: tickProfiles.length,
          avgTotalMs: Number(avgTotal.toFixed(2)),
          p95TotalMs: Number(p95.toFixed(2)),
          targetP95Ms: config.targetP95Ms,
          avgMaintenanceMs: Number(avgMaintenance.toFixed(2)),
          avgSimulationMs: Number(avgSimulation.toFixed(2)),
          avgBroadcastMs: Number(avgBroadcast.toFixed(2)),
        });
      }
    },
  };
};
