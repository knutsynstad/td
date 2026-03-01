import type { T2 } from '@devvit/web/shared';

export const KEYS = {
  META: 'meta',
  PLAYERS: 'p:all',
  INTENTS: 'intents',
  STRUCTURES: 'structures',
  MOBS: 'mobs',
  WAVE: 'wave',
  QUEUE: 'queue',
  SEEN: 'seen',
  SNAPS: 'snaps',
  LEADER_LOCK: 'leaderLock',
  CASTLE_COIN_BALANCE: 'castle:coins',
  PLAYER: (userId: T2) => `p:${userId}`, // Hash
} as const;

export const FIELDS = {
  USER_COIN_BALANCE: 'coins',
  USER_COIN_LAST_ACCRUED_MS: 'lastAccruedMs',
} as const;
