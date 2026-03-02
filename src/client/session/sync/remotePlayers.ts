import * as THREE from 'three';
import type { NpcEntity } from '../../domains/gameplay/types/entities';

type RemotePlayersContext = {
  scene: THREE.Scene;
  npcs: NpcEntity[];
  remotePlayersById: Map<string, NpcEntity>;
  makeNpc: (pos: THREE.Vector3, color: number, username: string) => NpcEntity;
  selfPlayerIdRef: { current: string | null };
};

export const createRemotePlayers = (ctx: RemotePlayersContext) => {
  const upsertRemoteNpc = (
    playerId: string,
    username: string,
    position: { x: number; z: number }
  ): void => {
    if (playerId === ctx.selfPlayerIdRef.current) return;
    const existing = ctx.remotePlayersById.get(playerId);
    if (existing) {
      existing.username = username;
      existing.target.set(position.x, 0, position.z);
      return;
    }
    const npc = ctx.makeNpc(
      new THREE.Vector3(position.x, 0, position.z),
      0xffc857,
      username
    );
    ctx.remotePlayersById.set(playerId, npc);
  };

  const removeRemoteNpc = (playerId: string): void => {
    const npc = ctx.remotePlayersById.get(playerId);
    if (!npc) return;
    ctx.scene.remove(npc.mesh);
    const index = ctx.npcs.indexOf(npc);
    if (index >= 0) {
      ctx.npcs.splice(index, 1);
    }
    ctx.remotePlayersById.delete(playerId);
  };

  return { upsertRemoteNpc, removeRemoteNpc };
};
