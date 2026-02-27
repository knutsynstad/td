import type { GameDelta } from '../../shared/game-protocol';

export type CollectionDirtySet = {
  upserted: Set<string>;
  removed: Set<string>;
};

export type DirtyTracker = {
  allMobsDirty: boolean;
  removedMobIds: Set<string>;
  structures: CollectionDirtySet;
  players: CollectionDirtySet;
  intents: CollectionDirtySet;
  waveDirty: boolean;
};

export const createDirtyTracker = (): DirtyTracker => ({
  allMobsDirty: false,
  removedMobIds: new Set(),
  structures: { upserted: new Set(), removed: new Set() },
  players: { upserted: new Set(), removed: new Set() },
  intents: { upserted: new Set(), removed: new Set() },
  waveDirty: false,
});

const markUpserted = (set: CollectionDirtySet, id: string): void => {
  set.upserted.add(id);
  set.removed.delete(id);
};

const markRemoved = (set: CollectionDirtySet, id: string): void => {
  set.removed.add(id);
  set.upserted.delete(id);
};

export const markMobsDirty = (tracker: DirtyTracker): void => {
  tracker.allMobsDirty = true;
};

export const markMobRemoved = (tracker: DirtyTracker, id: string): void => {
  tracker.removedMobIds.add(id);
};

export const markStructureUpserted = (
  tracker: DirtyTracker,
  id: string
): void => {
  markUpserted(tracker.structures, id);
};

export const markStructureRemoved = (
  tracker: DirtyTracker,
  id: string
): void => {
  markRemoved(tracker.structures, id);
};

export const markPlayerRemoved = (
  tracker: DirtyTracker,
  id: string
): void => {
  markRemoved(tracker.players, id);
};

export const markIntentRemoved = (
  tracker: DirtyTracker,
  id: string
): void => {
  markRemoved(tracker.intents, id);
};

export const markWaveDirty = (tracker: DirtyTracker): void => {
  tracker.waveDirty = true;
};

export const resetDirtyTracker = (tracker: DirtyTracker): void => {
  tracker.allMobsDirty = false;
  tracker.removedMobIds.clear();
  tracker.structures.upserted.clear();
  tracker.structures.removed.clear();
  tracker.players.upserted.clear();
  tracker.players.removed.clear();
  tracker.intents.upserted.clear();
  tracker.intents.removed.clear();
  tracker.waveDirty = false;
};

export const markDirtyFromDeltas = (
  tracker: DirtyTracker,
  deltas: GameDelta[]
): void => {
  for (const delta of deltas) {
    switch (delta.type) {
      case 'entityDelta':
        markMobsDirty(tracker);
        for (const id of delta.despawnedMobIds) {
          markMobRemoved(tracker, String(id));
        }
        for (const player of delta.players) {
          markUpserted(tracker.players, player.playerId);
          markUpserted(tracker.intents, player.playerId);
        }
        break;
      case 'structureDelta':
        for (const structure of delta.upserts) {
          markStructureUpserted(tracker, structure.structureId);
        }
        for (const id of delta.removes) {
          markStructureRemoved(tracker, id);
        }
        break;
      case 'waveDelta':
        markWaveDirty(tracker);
        break;
    }
  }
};
