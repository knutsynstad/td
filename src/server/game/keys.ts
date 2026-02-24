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
  tickLease: string;
  tickLeaseToken: string;
  lastTickRunMs: string;
  lastPublishTickSeq: string;
};

export type EconomyRedisKeys = {
  coins: string;
  castle: string;
};

const sanitizeChannelId = (value: string): string =>
  value.replace(/[^A-Za-z0-9_]/g, '_');

const GLOBAL_GAME_ID = 'global';

export const getGameChannelName = (_postId: string): string =>
  `game_${sanitizeChannelId(GLOBAL_GAME_ID)}`;

export const getGameRedisKeys = (_postId: string): GameRedisKeys => {
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
    tickLease: `${prefix}:tl`,
    tickLeaseToken: `${prefix}:tlt`,
    lastTickRunMs: `${prefix}:ltr`,
    lastPublishTickSeq: `${prefix}:lpt`,
  };
};

export const getEconomyRedisKeys = (): EconomyRedisKeys => ({
  coins: 'g:c',
  castle: 'g:cs',
});
