import type { T2 } from '@devvit/web/shared';

export const KEYS = {
  META: 'meta',
  INTENTS: 'intents',
  STRUCTURES: 'structures',
  MOBS: 'mobs',
  WAVE: 'wave',
  QUEUE: 'queue',
  SNAPS: 'snaps',
  LEADER_LOCK: 'leaderLock',
  LEADER_HEARTBEAT: 'leaderHeartbeat',
  FOLLOWER_GATE: 'followerGate',
  LAST_RESET_REASON: 'lastResetReason',
  CASTLE_COIN_BALANCE: 'castle:coins',
  PLAYER: (userId: T2) => `p:${userId}`, // Hash - economy
  playerPresence: (playerId: string) => `player:${playerId}`,
  PLAYER_IDS: 'player_ids',
} as const;

export const FIELDS = {
  USER_COIN_BALANCE: 'coins',
  USER_COIN_LAST_ACCRUED_MS: 'lastAccruedMs',
} as const;
