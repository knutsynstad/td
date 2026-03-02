import type { CommandEnvelope, EntityDelta } from '../../shared/game-protocol';
import type { GameWorld, StructureState } from '../../shared/game-state';
import { STRUCTURE_DEFS } from '../../shared/content/structures';
import { clamp } from '../../shared/utils';
import { SIM_TICK_MS } from '../config';
import { activateWave } from './waves';

export type CommandApplyResult = {
  structureUpserts: StructureState[];
  structureRemoves: string[];
  waveChanged: boolean;
  movedPlayers: EntityDelta['players'];
};

export const applyCommands = (
  world: GameWorld,
  commands: CommandEnvelope[],
  nowMs: number
): CommandApplyResult => {
  const structureUpserts: StructureState[] = [];
  const structureRemoves: string[] = [];
  const movedPlayers: EntityDelta['players'] = [];
  let waveChanged = false;

  for (const envelope of commands) {
    const { command } = envelope;
    if (command.type === 'moveIntent') {
      world.intents.set(command.playerId, command.intent);
      const player = world.players.get(command.playerId);
      if (!player) continue;
      const from = { x: player.position.x, z: player.position.z };
      const nextPosition = command.clientPosition
        ? {
            x: clamp(command.clientPosition.x, -120, 120),
            z: clamp(command.clientPosition.z, -120, 120),
          }
        : command.intent.target
          ? {
              x: clamp(command.intent.target.x, -120, 120),
              z: clamp(command.intent.target.z, -120, 120),
            }
          : from;
      player.position = nextPosition;
      player.target = command.intent.target
        ? {
            x: clamp(command.intent.target.x, -120, 120),
            z: clamp(command.intent.target.z, -120, 120),
          }
        : undefined;
      player.lastSeenMs = nowMs;
      movedPlayers.push({
        playerId: player.playerId,
        username: player.username,
        interpolation: {
          from,
          to: nextPosition,
          t0: nowMs - SIM_TICK_MS,
          t1: nowMs,
        },
      });
      continue;
    }
    if (command.type === 'buildStructure') {
      const def = STRUCTURE_DEFS[command.structure.type];
      const structure: StructureState = {
        structureId: command.structure.structureId,
        ownerId: command.playerId,
        type: command.structure.type,
        center: command.structure.center,
        hp: def.hp,
        maxHp: def.maxHp,
        createdAtMs: world.meta.lastTickMs,
      };
      world.structures.set(structure.structureId, structure);
      structureUpserts.push(structure);
      continue;
    }
    if (command.type === 'buildStructures') {
      for (const requested of command.structures) {
        const def = STRUCTURE_DEFS[requested.type];
        const structure: StructureState = {
          structureId: requested.structureId,
          ownerId: command.playerId,
          type: requested.type,
          center: requested.center,
          hp: def.hp,
          maxHp: def.maxHp,
          createdAtMs: world.meta.lastTickMs,
        };
        world.structures.set(structure.structureId, structure);
        structureUpserts.push(structure);
      }
      continue;
    }
    if (command.type === 'removeStructure') {
      world.structures.delete(command.structureId);
      structureRemoves.push(command.structureId);
      continue;
    }
    if (command.type === 'startWave') {
      waveChanged = activateWave(world) || waveChanged;
      continue;
    }
    if (command.type === 'dealDamage') {
      const mob = world.mobs.get(command.mobId);
      if (mob && command.damage > 0) {
        mob.hp = Math.max(0, mob.hp - command.damage);
      }
      continue;
    }
    if (command.type === 'dealDamages') {
      let applied = 0;
      for (const hit of command.hits) {
        const mob = world.mobs.get(hit.mobId);
        if (mob && hit.damage > 0) {
          mob.hp = Math.max(0, mob.hp - hit.damage);
          applied += 1;
        }
      }
      if (command.hits.length > 0) {
        console.log(
          `[DealDamage] applied ${applied}/${command.hits.length} hits, mobs=${world.mobs.size}`
        );
      }
      continue;
    }
  }

  return { structureUpserts, structureRemoves, waveChanged, movedPlayers };
};
