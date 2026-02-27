export type EconomyRedisKeys = {
  coins: string;
  castle: string;
};

export const getEconomyRedisKeys = (): EconomyRedisKeys => ({
  coins: 'g:c',
  castle: 'g:cs',
});
