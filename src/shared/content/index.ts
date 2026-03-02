export {
  type StructureDef,
  STRUCTURE_DEFS,
  getStructureDef,
  getStructureFootprint,
  getStructureCoinCost,
} from './structures';

export {
  type TowerTypeId,
  type TowerDef,
  type TowerUpgradeId,
  type TowerUpgradeDef,
  TOWER_DEFS,
  TOWER_UPGRADE_DEFS,
  getTowerDef,
  getTowerUpgradeDef,
  getTowerDps,
} from './towers';

export {
  type MobTypeId,
  type MobDef,
  MOB_DEFS,
  getMobDef,
  DEFAULT_MOB_TYPE,
} from './mobs';

export {
  WAVE_SPAWN_BASE,
  getWaveMobCount,
  getWaveSpawnRate,
  WAVE_MIN_SPAWNERS,
  WAVE_MAX_SPAWNERS,
} from './waves';

export {
  COINS_CAP,
  USER_COINS_MIN,
  USER_COINS_MAX,
  COIN_ACCRUAL_INTERVAL_MS,
  COINS_PER_PLAYER_KILL,
  CASTLE_COINS_MIN,
  CASTLE_DEATH_TAX,
  CASTLE_DEATH_TAX_RATIO,
  DECAY_GRACE_MS,
  DECAY_HP_PER_HOUR,
  REPAIR_DISCOUNT_RATE,
  REPAIR_WARNING_HP_RATIO,
  REPAIR_CRITICAL_HP_RATIO,
} from './economy';

export {
  WORLD_BOUNDS,
  GRID_SIZE,
  CASTLE_RADIUS,
  CASTLE_HALF_EXTENT,
  PLAYER_SPEED,
} from './world';
