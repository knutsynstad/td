export type CastleCoinsBalanceResponse = {
  type: 'castleCoinsBalance';
  castleCoins: number;
};

export type CastleCoinsDepositResponse = {
  type: 'castleCoinsDeposit';
  deposited: number;
  castleCoins: number;
};

export type CastleCoinsWithdrawResponse = {
  type: 'castleCoinsWithdraw';
  withdrawn: number;
  castleCoins: number;
};

export type GamePreviewResponse = {
  wave: number;
  mobsLeft: number;
  playerCount: number;
};
