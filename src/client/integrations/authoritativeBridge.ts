import { connectRealtime } from '@devvit/web/client';
import type {
  CommandRequest,
  CoinBalanceResponse,
  DeltaBatch,
  EntityDelta,
  GameDelta,
  HeartbeatResponse,
  JoinResponse,
  ResyncResponse,
  StructureDelta,
  WaveDelta,
} from '../../shared/game-protocol';
import type { Vec2, WorldState } from '../../shared/game-state';

type PresenceCallbacks = {
  onSnapshot: (snapshot: WorldState) => void;
  onSelfReady: (playerId: string, username: string, position: Vec2) => void;
  onRemoteJoin: (playerId: string, username: string, position: Vec2) => void;
  onRemoteLeave: (playerId: string) => void;
  onPlayerMove: (playerId: string, username: string, next: Vec2) => void;
  onMobDelta: (delta: EntityDelta) => void;
  onStructureDelta: (delta: StructureDelta) => void;
  onWaveDelta: (delta: WaveDelta) => void;
  onAck: (tickSeq: number, worldVersion: number, ackSeq: number) => void;
  onCoinBalance: (coins: number) => void;
  onResyncRequired: (reason: string) => void;
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
    type: 'wall' | 'tower' | 'tree' | 'rock' | 'bank';
    center: Vec2;
  }) => Promise<void>;
  resync: () => Promise<void>;
  heartbeat: (position: Vec2) => Promise<void>;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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
  value.type === 'deltaBatch' &&
  Array.isArray(value.events) &&
  typeof value.tickSeq === 'number' &&
  typeof value.worldVersion === 'number';

const isHeartbeatResponse = (value: unknown): value is HeartbeatResponse =>
  isRecord(value) &&
  value.type === 'heartbeatAck' &&
  typeof value.tickSeq === 'number' &&
  typeof value.worldVersion === 'number';

const isCoinBalanceResponse = (value: unknown): value is CoinBalanceResponse =>
  isRecord(value) &&
  value.type === 'coinBalance' &&
  typeof value.coins === 'number';

const isResyncResponse = (value: unknown): value is ResyncResponse =>
  isRecord(value) && value.type === 'snapshot' && isRecord(value.snapshot);

const parseJoinResponse = (value: unknown): JoinResponse => {
  if (!isJoinResponse(value)) {
    throw new Error('invalid join response');
  }
  return value;
};

const applyDelta = (delta: GameDelta, callbacks: PresenceCallbacks): void => {
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
    callbacks.onMobDelta(delta);
    return;
  }
  if (delta.type === 'structureDelta') {
    callbacks.onStructureDelta(delta);
    return;
  }
  if (delta.type === 'waveDelta') {
    callbacks.onWaveDelta(delta);
    return;
  }
  if (delta.type === 'ack') {
    callbacks.onAck(delta.tickSeq, delta.worldVersion, delta.ackSeq);
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

  for (const player of Object.values(joinResponse.snapshot.players)) {
    if (player.playerId === joinResponse.playerId) {
      callbacks.onSelfReady(player.playerId, player.username, player.position);
      continue;
    }
    callbacks.onRemoteJoin(player.playerId, player.username, player.position);
  }

  let seq = 0;
  const connection = await connectRealtime({
    channel: joinResponse.channel,
    onMessage: (payload) => {
      const batch = payload;
      if (!isDeltaBatch(batch)) return;
      for (const event of batch.events) {
        applyDelta(event, callbacks);
      }
    },
  });

  const sendCommand = async (
    command: CommandRequest['envelope']['command']
  ): Promise<void> => {
    seq += 1;
    await postJson('/api/game/command', {
      envelope: {
        seq,
        sentAtMs: Date.now(),
        command,
      },
    } satisfies CommandRequest);
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
    const coinPayload = await getJson('/api/game/coins');
    if (!isCoinBalanceResponse(coinPayload)) {
      throw new Error('invalid coin response');
    }
    callbacks.onCoinBalance(coinPayload.coins);
  };

  const resync = async (): Promise<void> => {
    const payload = await postJson('/api/game/resync', {
      tickSeq: 0,
      playerId: joinResponse.playerId,
    });
    if (!isResyncResponse(payload)) {
      throw new Error('invalid resync response');
    }
    callbacks.onSnapshot(payload.snapshot);
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
      await sendCommand({
        type: 'buildStructure',
        playerId: joinResponse.playerId,
        structure: payload,
      });
    },
    resync,
    heartbeat,
    disconnect: async () => {
      await connection.disconnect();
    },
  };
};
