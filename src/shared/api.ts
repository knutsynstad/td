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
