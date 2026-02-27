export const shuffle = <T>(
  values: T[],
  random: () => number = Math.random,
): T[] => {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

export const pickUniqueRandom = <T>(
  items: T[],
  count: number,
  random: () => number = Math.random,
): T[] => shuffle(items, random).slice(0, count);
