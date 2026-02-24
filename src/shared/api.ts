export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

export type CastleCoinsBalanceResponse = {
  type: 'castleCoinsBalance';
  postId: string;
  castleCoins: number;
};

export type CastleCoinsDepositResponse = {
  type: 'castleCoinsDeposit';
  postId: string;
  deposited: number;
  castleCoins: number;
};

export type CastleCoinsWithdrawResponse = {
  type: 'castleCoinsWithdraw';
  postId: string;
  withdrawn: number;
  castleCoins: number;
};
