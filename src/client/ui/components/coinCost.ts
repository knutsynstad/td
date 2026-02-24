import coinIconUrl from '../../assets/ui/coin-icon.png?url'

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

export const buildCoinCostMarkup = (amount: number, iconAlt = 'Coin'): string => {
  const safeAlt = escapeHtml(iconAlt)
  return `<span class="coin-cost"><img class="coin-cost__icon" src="${coinIconUrl}" alt="${safeAlt}" /><span class="coin-cost__value">${amount}</span></span>`
}

export const getCoinIconUrl = () => coinIconUrl
