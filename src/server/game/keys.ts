export type GameRedisKeys = {
  meta: string;
  players: string;
  intents: string;
  structures: string;
  mobs: string;
  wave: string;
  pendingCommands: string;
  lastSeen: string;
  rateLimits: string;
  snapshots: string;
};

const sanitizeChannelId = (value: string): string => value.replace(/[^A-Za-z0-9_]/g, "_");

export const getGameChannelName = (postId: string): string => `game_${sanitizeChannelId(postId)}`;

export const getGameRedisKeys = (postId: string): GameRedisKeys => {
  const prefix = `game:${postId}`;
  return {
    meta: `${prefix}:meta`,
    players: `${prefix}:players`,
    intents: `${prefix}:intents`,
    structures: `${prefix}:structures`,
    mobs: `${prefix}:mobs`,
    wave: `${prefix}:wave`,
    pendingCommands: `${prefix}:pendingCommands`,
    lastSeen: `${prefix}:players:lastSeen`,
    rateLimits: `${prefix}:rateLimits`,
    snapshots: `${prefix}:snapshots`,
  };
};
