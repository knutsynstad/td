import { describe, expect, it } from 'vitest';
import {
  isCoinBalanceResponse,
  isCommandResponse,
  isDeltaBatch,
  isHeartbeatResponse,
  isJoinResponse,
  isMetaSyncResponse,
  isResyncResponse,
  isStructuresSyncResponse,
  isVec2,
  hasHeartbeatWaveState,
  parseJoinResponse,
} from './responseGuards';

describe('responseGuards', () => {
  describe('isVec2', () => {
    it('returns true for valid Vec2', () => {
      expect(isVec2({ x: 1, z: 2 })).toBe(true);
    });
    it('returns false for missing z', () => {
      expect(isVec2({ x: 1 })).toBe(false);
    });
    it('returns false for non-number', () => {
      expect(isVec2({ x: '1', z: 2 })).toBe(false);
      expect(isVec2(null)).toBe(false);
    });
  });

  describe('isCoinBalanceResponse', () => {
    it('returns true for valid response', () => {
      expect(isCoinBalanceResponse({ type: 'coinBalance', coins: 100 })).toBe(
        true
      );
    });
    it('returns false for wrong type', () => {
      expect(isCoinBalanceResponse({ type: 'other', coins: 100 })).toBe(false);
    });
    it('returns false for missing coins', () => {
      expect(isCoinBalanceResponse({ type: 'coinBalance' })).toBe(false);
    });
  });

  describe('isDeltaBatch', () => {
    it('returns true for valid batch', () => {
      expect(isDeltaBatch({ tickSeq: 1, worldVersion: 1, events: [] })).toBe(
        true
      );
    });
    it('returns false for missing events', () => {
      expect(isDeltaBatch({ tickSeq: 1, worldVersion: 1 })).toBe(false);
    });
    it('returns false for non-array events', () => {
      expect(isDeltaBatch({ tickSeq: 1, worldVersion: 1, events: {} })).toBe(
        false
      );
    });
  });

  describe('isJoinResponse', () => {
    it('returns true for valid join response', () => {
      expect(
        isJoinResponse({
          type: 'join',
          playerId: 'p1',
          username: 'u',
          channel: 'ch',
          snapshot: { players: {} },
        })
      ).toBe(true);
    });
    it('returns false for wrong type', () => {
      expect(
        isJoinResponse({
          type: 'other',
          playerId: 'p1',
          username: 'u',
          channel: 'ch',
          snapshot: { players: {} },
        })
      ).toBe(false);
    });
    it('returns false for missing snapshot.players', () => {
      expect(
        isJoinResponse({
          type: 'join',
          playerId: 'p1',
          username: 'u',
          channel: 'ch',
          snapshot: {},
        })
      ).toBe(false);
    });
  });

  describe('isCommandResponse', () => {
    it('returns true for valid response', () => {
      expect(
        isCommandResponse({
          type: 'commandAck',
          accepted: true,
          tickSeq: 1,
          worldVersion: 1,
        })
      ).toBe(true);
    });
    it('returns false for wrong type', () => {
      expect(
        isCommandResponse({
          type: 'other',
          accepted: true,
          tickSeq: 1,
          worldVersion: 1,
        })
      ).toBe(false);
    });
  });

  describe('isHeartbeatResponse', () => {
    it('returns true for valid response', () => {
      expect(
        isHeartbeatResponse({
          type: 'heartbeatAck',
          tickSeq: 1,
          worldVersion: 1,
        })
      ).toBe(true);
    });
  });

  describe('hasHeartbeatWaveState', () => {
    it('returns true when wave state present', () => {
      const resp = {
        type: 'heartbeatAck' as const,
        tickSeq: 1,
        worldVersion: 1,
        wave: 2,
        waveActive: true,
        nextWaveAtMs: 1000,
      };
      expect(hasHeartbeatWaveState(resp)).toBe(true);
    });
    it('returns false when wave state missing', () => {
      const resp = {
        type: 'heartbeatAck' as const,
        tickSeq: 1,
        worldVersion: 1,
      };
      expect(hasHeartbeatWaveState(resp)).toBe(false);
    });
  });

  describe('isResyncResponse', () => {
    it('returns true for valid resync', () => {
      expect(
        isResyncResponse({ type: 'snapshot', snapshot: { meta: {} } })
      ).toBe(true);
    });
  });

  describe('isStructuresSyncResponse', () => {
    it('returns true for valid response', () => {
      expect(
        isStructuresSyncResponse({
          type: 'structures',
          structures: {},
          structureChangeSeq: 1,
        })
      ).toBe(true);
    });
  });

  describe('isMetaSyncResponse', () => {
    it('returns true for valid response', () => {
      expect(
        isMetaSyncResponse({ type: 'meta', meta: { lastTickMs: 0 } })
      ).toBe(true);
    });
  });

  describe('parseJoinResponse', () => {
    it('returns value when valid', () => {
      const valid = {
        type: 'join',
        playerId: 'p1',
        username: 'u',
        channel: 'ch',
        snapshot: { players: {} },
      };
      expect(parseJoinResponse(valid)).toEqual(valid);
    });
    it('throws when invalid', () => {
      expect(() => parseJoinResponse({ type: 'other' })).toThrow(
        'invalid join response'
      );
    });
  });
});
