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
};

export type EconomyRedisKeys = {
  coins: string;
  castle: string;
};

const sanitizeChannelId = (value: string): string => value.replace(/[^A-Za-z0-9_]/g, "_");

export const getGameChannelName = (postId: string): string => `game_${sanitizeChannelId(postId)}`;

export const getGameRedisKeys = (postId: string): GameRedisKeys => {
  const prefix = `g:${postId}`;
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
  };
};

export const getEconomyRedisKeys = (): EconomyRedisKeys => ({
  coins: "g:c",
  castle: "g:cs",
});
