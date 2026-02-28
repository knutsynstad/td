export type GameLoopLogger = {
  onStarted: (ownerToken: string, channel: string) => void;
  onLockStolen: (ownerToken: string) => void;
  onLockLost: (ownerToken: string) => void;
  onError: (ownerToken: string, error: unknown) => void;
  onEnded: (ownerToken: string, durationMs: number, ticksProcessed: number) => void;
};

export const createGameLoopLogger = (): GameLoopLogger => ({
  onStarted: (ownerToken, channel) => {
    console.info('Game loop started', { ownerToken, channel });
  },
  onLockStolen: (ownerToken) => {
    console.warn('Leader lock stolen, exiting loop', { ownerToken });
  },
  onLockLost: (ownerToken) => {
    console.warn('Leader lock lost during refresh', { ownerToken });
  },
  onError: (ownerToken, error) => {
    console.error('Game loop error', { ownerToken, error });
  },
  onEnded: (ownerToken, durationMs, ticksProcessed) => {
    console.info('Game loop ended', { ownerToken, durationMs, ticksProcessed });
  },
});
