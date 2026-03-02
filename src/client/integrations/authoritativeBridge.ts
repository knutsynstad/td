import { connectRealtime } from '@devvit/web/client';
import type {
  CommandRequest,
  CommandResponse,
  CoinBalanceResponse,
  DeltaBatch,
  EntityDelta,
  GameDelta,
  HeartbeatResponse,
  JoinResponse,
  MetaSyncResponse,
  ResyncResponse,
  StructureDelta,
  StructuresSyncResponse,
  WaveDelta,
} from '../../shared/game-protocol';
import type { Vec2, WorldState } from '../../shared/game-state';
import { isRecord } from '../../shared/utils';

type SnapshotOptions = { skipMobReplacement?: boolean };

type DeltaBatchContext = { batchTickSeq: number };

type PresenceCallbacks = {
  onSnapshot: (snapshot: WorldState, options?: SnapshotOptions) => void;
  onSelfReady: (playerId: string, username: string, position: Vec2) => void;
  onRemoteJoin: (playerId: string, username: string, position: Vec2) => void;
  onRemoteLeave: (playerId: string) => void;
  onPlayerMove: (playerId: string, username: string, next: Vec2) => void;
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

type AuthoritativeBridge = {
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
  resync: () => Promise<void>;
  fetchStructures: () => Promise<StructuresSyncResponse>;
  fetchMeta: () => Promise<MetaSyncResponse>;
  heartbeat: (position: Vec2) => Promise<void>;
  refreshCoinBalance: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const postJson = async (url: string, body: unknown): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`request failed ${response.status}`);
  }
  return response.json();
};

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed ${response.status}`);
  }
  return response.json();
};

const isCoinBalanceResponse = (value: unknown): value is CoinBalanceResponse =>
  isRecord(value) &&
  value.type === 'coinBalance' &&
  typeof value.coins === 'number';

const isVec2 = (value: unknown): value is Vec2 =>
  isRecord(value) && typeof value.x === 'number' && typeof value.z === 'number';

const isJoinResponse = (value: unknown): value is JoinResponse => {
  if (!isRecord(value)) return false;
  if (value.type !== 'join') return false;
  if (
    typeof value.playerId !== 'string' ||
    typeof value.username !== 'string' ||
    typeof value.channel !== 'string'
  ) {
    return false;
  }
  if (!isRecord(value.snapshot) || !isRecord(value.snapshot.players))
    return false;
  return true;
};

const isDeltaBatch = (value: unknown): value is DeltaBatch =>
  isRecord(value) &&
  Array.isArray(value.events) &&
  typeof value.tickSeq === 'number' &&
  typeof value.worldVersion === 'number';

const isHeartbeatResponse = (value: unknown): value is HeartbeatResponse =>
  isRecord(value) &&
  value.type === 'heartbeatAck' &&
  typeof value.tickSeq === 'number' &&
  typeof value.worldVersion === 'number';

const hasHeartbeatWaveState = (
  value: HeartbeatResponse
): value is HeartbeatResponse & {
  wave: number;
  waveActive: boolean;
  nextWaveAtMs: number;
} =>
  typeof value.wave === 'number' &&
  typeof value.waveActive === 'boolean' &&
  typeof value.nextWaveAtMs === 'number';

const isResyncResponse = (value: unknown): value is ResyncResponse =>
  isRecord(value) && value.type === 'snapshot' && isRecord(value.snapshot);

const isStructuresSyncResponse = (
  value: unknown
): value is StructuresSyncResponse =>
  isRecord(value) &&
  value.type === 'structures' &&
  isRecord(value.structures) &&
  typeof value.structureChangeSeq === 'number';

const isMetaSyncResponse = (value: unknown): value is MetaSyncResponse =>
  isRecord(value) && value.type === 'meta' && isRecord(value.meta);

const isCommandResponse = (value: unknown): value is CommandResponse =>
  isRecord(value) &&
  value.type === 'commandAck' &&
  typeof value.accepted === 'boolean' &&
  typeof value.tickSeq === 'number' &&
  typeof value.worldVersion === 'number';

const parseJoinResponse = (value: unknown): JoinResponse => {
  if (!isJoinResponse(value)) {
    throw new Error('invalid join response');
  }
  return value;
};

const DELTA_BUFFER_MAX_BATCHES = 50;
const DELTA_BUFFER_MAX_MS = 10_000;

type BufferedBatch = { batch: DeltaBatch; receivedAtMs: number };

const applyDelta = (
  delta: GameDelta,
  callbacks: PresenceCallbacks,
  batchContext: DeltaBatchContext
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

export const connectAuthoritativeBridge = async (
  callbacks: PresenceCallbacks
): Promise<AuthoritativeBridge> => {
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
  let lastBatchLogMs = 0;
  let firstBatchLogged = false;
  const deltaBuffer: BufferedBatch[] = [];
  const pushToDeltaBuffer = (batch: DeltaBatch) => {
    const receivedAtMs = typeof performance !== 'undefined' ? performance.now() : 0;
    deltaBuffer.push({ batch, receivedAtMs });
    while (deltaBuffer.length > DELTA_BUFFER_MAX_BATCHES) {
      deltaBuffer.shift();
    }
    const cutoffMs = receivedAtMs - DELTA_BUFFER_MAX_MS;
    while (deltaBuffer.length > 0 && deltaBuffer[0]!.receivedAtMs < cutoffMs) {
      deltaBuffer.shift();
    }
  };
  const replayBufferedDeltasNewerThan = (tickSeq: number) => {
    const batchContext = { batchTickSeq: 0 };
    for (const { batch } of deltaBuffer) {
      if (batch.tickSeq <= tickSeq) continue;
      batchContext.batchTickSeq = batch.tickSeq;
      for (const event of batch.events) {
        if (!event || typeof event !== 'object') continue;
        const type = (event as { type?: string }).type;
        if (type === 'entityDelta' || type === 'waveDelta') {
          try {
            applyDelta(event, callbacks, batchContext);
          } catch (err) {
            console.error('[MobDelta] Error replaying buffered delta', {
              type,
              tickSeq: batch.tickSeq,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
  };
  console.log('[MobDelta] Realtime connecting', {
    channel: joinResponse.channel,
  });
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
      pushToDeltaBuffer(batch);
      const eventTypes = batch.events.map((e) => e?.type).filter(Boolean);
      const entityCount = eventTypes.filter((t) => t === 'entityDelta').length;
      const structureCount = eventTypes.filter((t) => t === 'structureDelta').length;
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (!firstBatchLogged) {
        firstBatchLogged = true;
        console.log('[MobDelta] First batch received', {
          msSinceLoad: now,
          events: batch.events.length,
          types: [...new Set(eventTypes)],
          entityDeltas: entityCount,
          structureDeltas: structureCount,
          tickSeq: batch.tickSeq,
        });
      }
      if (now - lastBatchLogMs > 2000) {
        lastBatchLogMs = now;
        console.log('[MobDelta] Batch (every 2s)', {
          events: batch.events.length,
          types: [...new Set(eventTypes)],
          entityDeltas: entityCount,
          tickSeq: batch.tickSeq,
        });
      }
      for (const event of batch.events) {
        if (
          event &&
          typeof event === 'object' &&
          (event as { type?: string }).type === 'structureDelta' &&
          batch.tickSeq <= snapshotTickSeq
        ) {
          continue;
        }
        try {
          applyDelta(event, callbacks, { batchTickSeq: batch.tickSeq });
        } catch (err) {
          console.error('[MobDelta] Error applying delta', {
            deltaType:
              event && typeof event === 'object'
                ? (event as { type?: string }).type
                : 'unknown',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      }
    },
  });
  console.log('[MobDelta] Realtime connected');

  const sendCommand = async (
    command: CommandRequest['envelope']['command']
  ): Promise<CommandResponse> => {
    seq += 1;
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
      deltaBuffer.length = 0;
    } else {
      replayBufferedDeltasNewerThan(snapshotTickSeq);
    }
  };

  const fetchStructures = async (): Promise<StructuresSyncResponse> => {
    const payload = await getJson('/api/game/structures');
    if (!isStructuresSyncResponse(payload)) {
      throw new Error('invalid structures sync response');
    }
    return payload;
  };

  const fetchMeta = async (): Promise<MetaSyncResponse> => {
    const payload = await getJson('/api/game/meta');
    if (!isMetaSyncResponse(payload)) {
      throw new Error('invalid meta sync response');
    }
    return payload;
  };

  return {
    playerId: joinResponse.playerId,
    sendMoveIntent: async (position, target, desiredDir) => {
      await sendCommand({
        type: 'moveIntent',
        playerId: joinResponse.playerId,
        intent: {
          updatedAtMs: Date.now(),
          target,
          desiredDir,
        },
        clientPosition: position,
      });
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
