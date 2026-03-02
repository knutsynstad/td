import { connectRealtime } from '@devvit/web/client';
import { deltaProfiler } from '../../utils/deltaProfiler';
import type {
  CommandRequest,
  CommandResponse,
  DealDamageHit,
  EntityDelta,
  GameDelta,
  MetaSyncResponse,
  StructureDelta,
  StructuresSyncResponse,
  WaveDelta,
} from '../../../shared/game-protocol';
import type { Vec2, WorldState } from '../../../shared/game-state';
import { postJson, getJson } from './httpClient';
import {
  isCoinBalanceResponse,
  isCommandResponse,
  isDeltaBatch,
  isHeartbeatResponse,
  isMetaSyncResponse,
  isResyncResponse,
  isStructuresSyncResponse,
  isVec2,
  hasHeartbeatWaveState,
  parseJoinResponse,
} from './responseGuards';
import { createDeltaBuffer } from './deltaBuffer';

type SnapshotOptions = { skipMobReplacement?: boolean };

export type DeltaBatchContext = {
  batchTickSeq: number;
  serverTimeMs?: number;
};

export type PresenceCallbacks = {
  onSnapshot: (snapshot: WorldState, options?: SnapshotOptions) => void;
  onSelfReady: (playerId: string, username: string, position: Vec2) => void;
  onRemoteJoin: (playerId: string, username: string, position: Vec2) => void;
  onRemoteLeave: (playerId: string) => void;
  onPlayerMove: (playerId: string, username: string, next: Vec2) => void;
  onSelfPositionFromServer?: (position: Vec2) => void;
  onMobDelta: (delta: EntityDelta, context: DeltaBatchContext) => void;
  onStructureDelta: (delta: StructureDelta, context: DeltaBatchContext) => void;
  onWaveDelta: (delta: WaveDelta, context: DeltaBatchContext) => void;
  onCoinBalance: (coins: number) => void;
  onResyncRequired: (reason: string) => void;
  onResetBanner?: (reason: string) => void;
  onHeartbeatWaveState?: (
    wave: number,
    active: boolean,
    nextWaveAtMs: number,
    serverTimeMs?: number
  ) => void;
};

export type GameSession = {
  playerId: string;
  sendMoveIntent: (
    position: Vec2,
    target: Vec2,
    desiredDir?: Vec2
  ) => Promise<void>;
  sendStartWave: () => Promise<void>;
  sendBuildStructure: (payload: {
    structureId: string;
    type: 'wall' | 'tower' | 'tree' | 'rock';
    center: Vec2;
  }) => Promise<CommandResponse>;
  sendBuildStructures: (
    payloads: Array<{
      structureId: string;
      type: 'wall' | 'tower' | 'tree' | 'rock';
      center: Vec2;
    }>
  ) => Promise<CommandResponse>;
  sendRemoveStructure: (structureId: string) => Promise<CommandResponse>;
  sendDealDamage: (
    mobId: string,
    damage: number,
    source: 'player' | 'tower',
    playerId: string
  ) => Promise<CommandResponse>;
  sendDealDamages: (hits: DealDamageHit[]) => Promise<CommandResponse>;
  resync: () => Promise<void>;
  fetchStructures: () => Promise<StructuresSyncResponse>;
  fetchMeta: () => Promise<MetaSyncResponse>;
  heartbeat: (position: Vec2) => Promise<void>;
  refreshCoinBalance: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const applyDelta = (
  delta: GameDelta,
  callbacks: PresenceCallbacks,
  batchContext: DeltaBatchContext,
  selfPlayerId: string
): void => {
  if (delta.type === 'presenceDelta') {
    if (delta.joined) {
      callbacks.onRemoteJoin(
        delta.joined.playerId,
        delta.joined.username,
        delta.joined.position
      );
    }
    if (delta.left) {
      callbacks.onRemoteLeave(delta.left.playerId);
    }
    return;
  }
  if (delta.type === 'entityDelta') {
    for (const player of delta.players) {
      if (player.playerId === selfPlayerId) {
        callbacks.onSelfPositionFromServer?.(player.interpolation.to);
        continue;
      }
      callbacks.onPlayerMove(
        player.playerId,
        player.username,
        player.interpolation.to
      );
    }
    callbacks.onMobDelta(delta, batchContext);
    return;
  }
  if (delta.type === 'structureDelta') {
    callbacks.onStructureDelta(delta, batchContext);
    return;
  }
  if (delta.type === 'waveDelta') {
    callbacks.onWaveDelta(delta, batchContext);
    return;
  }
  if (delta.type === 'resyncRequired') {
    callbacks.onResyncRequired(delta.reason);
  }
};

export const connectGameSession = async (
  callbacks: PresenceCallbacks
): Promise<GameSession> => {
  const joinPayload = await postJson('/api/game/join', {});
  const joinResponse = parseJoinResponse(joinPayload);
  callbacks.onSnapshot(joinResponse.snapshot);

  let snapshotTickSeq = joinResponse.snapshot.meta.tickSeq;

  for (const player of Object.values(joinResponse.snapshot.players)) {
    if (player.playerId === joinResponse.playerId) {
      callbacks.onSelfReady(player.playerId, player.username, player.position);
      continue;
    }
    callbacks.onRemoteJoin(player.playerId, player.username, player.position);
  }

  let seq = 0;
  const deltaBuffer = createDeltaBuffer();

  const replayBufferedDeltasNewerThan = (tickSeq: number): void => {
    const batchContext: DeltaBatchContext = { batchTickSeq: 0 };
    deltaBuffer.replayNewerThan(tickSeq, (batch, event, batchTickSeq) => {
      const type = (event as { type?: string }).type;
      if (type !== 'entityDelta' && type !== 'waveDelta') return;
      batchContext.batchTickSeq = batchTickSeq;
      try {
        applyDelta(
          event as GameDelta,
          callbacks,
          batchContext,
          joinResponse.playerId
        );
      } catch (err) {
        console.error('[MobDelta] Error replaying buffered delta', {
          type,
          tickSeq: batch.tickSeq,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  type PendingBatch = {
    batch: { tickSeq: number; worldVersion?: number; events: unknown[] };
    context: DeltaBatchContext;
  };
  const pendingBatches: PendingBatch[] = [];
  let rafScheduled = false;

  const flushPendingDeltas = (): void => {
    rafScheduled = false;
    deltaProfiler.mark('delta-flush-start');
    while (pendingBatches.length > 0) {
      const { batch, context } = pendingBatches.shift()!;
      const processEvent = (event: unknown): void => {
        if (!event || typeof event !== 'object') return;
        if (
          (event as { type?: string }).type === 'structureDelta' &&
          batch.tickSeq <= snapshotTickSeq
        ) {
          return;
        }
        try {
          applyDelta(
            event as GameDelta,
            callbacks,
            context,
            joinResponse.playerId
          );
        } catch (err) {
          console.error('[MobDelta] Error applying delta', {
            deltaType: (event as { type?: string }).type ?? 'unknown',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      };
      for (const event of batch.events) {
        if (
          (event as { type?: string; reason?: string })?.type ===
          'resyncRequired'
        ) {
          processEvent(event);
        }
      }
      for (const event of batch.events) {
        if ((event as { type?: string })?.type !== 'resyncRequired') {
          processEvent(event);
        }
      }
    }
    deltaProfiler.mark('delta-flush-end');
    deltaProfiler.measure(
      'delta-flush',
      'delta-flush-start',
      'delta-flush-end'
    );
  };

  const scheduleFlush = (): void => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(flushPendingDeltas);
  };

  const connection = await connectRealtime({
    channel: joinResponse.channel,
    onMessage: (payload) => {
      if (!isDeltaBatch(payload)) {
        console.warn('[MobDelta] Received non-delta batch', {
          hasPayload: !!payload,
          payloadKeys:
            payload && typeof payload === 'object' ? Object.keys(payload) : [],
        });
        return;
      }
      const batch = payload;
      deltaBuffer.push(batch);
      const entityDelta = batch.events.find(
        (e): e is EntityDelta =>
          (e as { type?: string })?.type === 'entityDelta'
      );
      const serverTimeMsFromBatch =
        entityDelta && typeof entityDelta.serverTimeMs === 'number'
          ? entityDelta.serverTimeMs
          : undefined;
      const batchContext: DeltaBatchContext = {
        batchTickSeq: batch.tickSeq,
        serverTimeMs: serverTimeMsFromBatch,
      };
      pendingBatches.push({ batch, context: batchContext });
      scheduleFlush();
    },
  });

  const sendCommand = async (
    command: CommandRequest['envelope']['command'],
    options?: { ignoreDuplicate?: boolean }
  ): Promise<CommandResponse> => {
    seq += 1;
    try {
      const payload = await postJson('/api/game/command', {
        envelope: {
          seq,
          sentAtMs: Date.now(),
          command,
        },
      } satisfies CommandRequest);
      if (!isCommandResponse(payload)) {
        return {
          type: 'commandAck',
          accepted: false,
          tickSeq: 0,
          worldVersion: 0,
          reason: 'invalid response',
        };
      }
      return payload;
    } catch (err) {
      if (
        options?.ignoreDuplicate &&
        err instanceof Error &&
        err.message.includes('429') &&
        err.message.includes('duplicate')
      ) {
        return {
          type: 'commandAck',
          accepted: true,
          tickSeq: 0,
          worldVersion: 0,
        };
      }
      throw err;
    }
  };

  const heartbeat = async (position: Vec2): Promise<void> => {
    if (!isVec2(position)) return;
    const payload = await postJson('/api/game/heartbeat', {
      playerId: joinResponse.playerId,
      position,
    });
    if (!isHeartbeatResponse(payload)) {
      throw new Error('invalid heartbeat response');
    }
    if (typeof payload.coins === 'number') {
      callbacks.onCoinBalance(payload.coins);
    }
    if (hasHeartbeatWaveState(payload) && callbacks.onHeartbeatWaveState) {
      callbacks.onHeartbeatWaveState(
        payload.wave,
        payload.waveActive,
        payload.nextWaveAtMs,
        payload.serverTimeMs
      );
    }
  };

  const refreshCoinBalance = async (): Promise<void> => {
    const payload = await getJson('/api/game/coins');
    if (!isCoinBalanceResponse(payload)) return;
    callbacks.onCoinBalance(payload.coins);
  };

  const resync = async (): Promise<void> => {
    const payload = await postJson('/api/game/resync', {
      playerId: joinResponse.playerId,
    });
    if (!isResyncResponse(payload)) {
      throw new Error('invalid resync response');
    }
    if (payload.resetReason && callbacks.onResetBanner) {
      callbacks.onResetBanner(payload.resetReason);
    }
    snapshotTickSeq = payload.snapshot.meta.tickSeq;
    callbacks.onSnapshot(payload.snapshot, {
      skipMobReplacement: !payload.resetReason,
    });
    if (payload.resetReason) {
      deltaBuffer.clear();
    } else {
      replayBufferedDeltasNewerThan(snapshotTickSeq);
    }
  };

  const fetchStructures = async () => {
    const payload = await getJson('/api/game/structures');
    if (!isStructuresSyncResponse(payload)) {
      throw new Error('invalid structures sync response');
    }
    return payload;
  };

  const fetchMeta = async () => {
    const payload = await getJson('/api/game/meta');
    if (!isMetaSyncResponse(payload)) {
      throw new Error('invalid meta sync response');
    }
    return payload;
  };

  return {
    playerId: joinResponse.playerId,
    sendMoveIntent: async (position, target, desiredDir) => {
      await sendCommand(
        {
          type: 'moveIntent',
          playerId: joinResponse.playerId,
          intent: {
            updatedAtMs: Date.now(),
            target,
            desiredDir,
          },
          clientPosition: position,
        },
        { ignoreDuplicate: true }
      );
    },
    sendStartWave: async () => {
      await sendCommand({
        type: 'startWave',
        playerId: joinResponse.playerId,
      });
    },
    sendBuildStructure: async (payload) => {
      return sendCommand({
        type: 'buildStructure',
        playerId: joinResponse.playerId,
        structure: payload,
      });
    },
    sendBuildStructures: async (payloads) => {
      if (payloads.length === 0) {
        return {
          type: 'commandAck',
          accepted: true,
          tickSeq: 0,
          worldVersion: 0,
        };
      }
      return sendCommand({
        type: 'buildStructures',
        playerId: joinResponse.playerId,
        structures: payloads,
      });
    },
    sendRemoveStructure: async (structureId) => {
      return sendCommand({
        type: 'removeStructure',
        playerId: joinResponse.playerId,
        structureId,
      });
    },
    sendDealDamage: async (mobId, damage, source, playerId) => {
      return sendCommand({
        type: 'dealDamage',
        playerId,
        mobId,
        damage,
        source,
      });
    },
    sendDealDamages: async (hits) => {
      if (hits.length === 0) {
        return {
          type: 'commandAck',
          accepted: true,
          tickSeq: 0,
          worldVersion: 0,
        };
      }
      return sendCommand({
        type: 'dealDamages',
        hits,
      });
    },
    resync,
    fetchStructures,
    fetchMeta,
    heartbeat,
    refreshCoinBalance,
    disconnect: async () => {
      await connection.disconnect();
    },
  };
};
