import type {
  CastleCoinsBalanceResponse,
  CastleCoinsDepositResponse,
  CastleCoinsWithdrawResponse,
} from '../../shared/api';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isCastleCoinsBalanceResponse = (
  value: unknown
): value is CastleCoinsBalanceResponse =>
  isRecord(value) &&
  value.type === 'castleCoinsBalance' &&
  typeof value.castleCoins === 'number';

const isCastleCoinsDepositResponse = (
  value: unknown
): value is CastleCoinsDepositResponse =>
  isRecord(value) &&
  value.type === 'castleCoinsDeposit' &&
  typeof value.deposited === 'number' &&
  typeof value.castleCoins === 'number';

const isCastleCoinsWithdrawResponse = (
  value: unknown
): value is CastleCoinsWithdrawResponse =>
  isRecord(value) &&
  value.type === 'castleCoinsWithdraw' &&
  typeof value.withdrawn === 'number' &&
  typeof value.castleCoins === 'number';

export const fetchCastleCoinsBalance = async (): Promise<number | null> => {
  try {
    const response = await fetch('/api/castle/coins');
    if (!response.ok) return null;
    const payload = await response.json();
    if (!isCastleCoinsBalanceResponse(payload)) return null;
    return Number.isFinite(payload.castleCoins)
      ? Math.max(0, Math.floor(payload.castleCoins))
      : null;
  } catch {
    return null;
  }
};

export const requestCastleCoinsDeposit = async (
  amount: number
): Promise<CastleCoinsDepositResponse | null> => {
  try {
    const response = await fetch('/api/castle/coins/deposit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!isCastleCoinsDepositResponse(payload)) return null;
    return payload;
  } catch {
    return null;
  }
};

export const requestCastleCoinsWithdraw = async (
  amount: number
): Promise<CastleCoinsWithdrawResponse | null> => {
  try {
    const response = await fetch('/api/castle/coins/withdraw', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!isCastleCoinsWithdrawResponse(payload)) return null;
    return payload;
  } catch {
    return null;
  }
};
