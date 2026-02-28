export type GameRedisKeys = {
  meta: string;
  players: string;
  intents: string;
  structures: string;
  mobs: string;
  wave: string;
  queue: string;
  seen: string;
  rate: string;
  snaps: string;
  leaderLock: string;
};

const sanitizeChannelId = (value: string): string =>
  value.replace(/[^A-Za-z0-9_]/g, '_');

const GLOBAL_GAME_ID = 'global';

export const getGameChannelName = (): string =>
  `game_${sanitizeChannelId(GLOBAL_GAME_ID)}`;

export const getGameRedisKeys = (): GameRedisKeys => {
  const prefix = `g:${GLOBAL_GAME_ID}`;
  return {
    meta: `${prefix}:m`,
    players: `${prefix}:p`,
    intents: `${prefix}:i`,
    structures: `${prefix}:s`,
    mobs: `${prefix}:mb`,
    wave: `${prefix}:w`,
    queue: `${prefix}:q`,
    seen: `${prefix}:ls`,
    rate: `${prefix}:rl`,
    snaps: `${prefix}:sn`,
    leaderLock: `${prefix}:ll`,
  };
};
