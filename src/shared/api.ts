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

export type BankBalanceResponse = {
  type: 'bankBalance';
  postId: string;
  bankEnergy: number;
};

export type BankDepositResponse = {
  type: 'bankDeposit';
  postId: string;
  deposited: number;
  bankEnergy: number;
};

export type BankWithdrawResponse = {
  type: 'bankWithdraw';
  postId: string;
  withdrawn: number;
  bankEnergy: number;
};
