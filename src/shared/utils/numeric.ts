export function weightedSplit(
  total: number,
  count: number,
  random: () => number = Math.random,
): number[] {
  if (count <= 0) return [];
  const weights = Array.from({ length: count }, () => 0.75 + random());
  const sum = weights.reduce((a, v) => a + v, 0);
  const raw = weights.map((v) => (v / sum) * total);
  const base = raw.map((v) => Math.floor(v));
  let remainder = total - base.reduce((a, v) => a + v, 0);
  while (remainder > 0) {
    let bestIdx = 0;
    let bestFrac = -1;
    for (let i = 0; i < raw.length; i += 1) {
      const frac = raw[i]! - base[i]!;
      if (frac > bestFrac) {
        bestFrac = frac;
        bestIdx = i;
      }
    }
    base[bestIdx] = (base[bestIdx] ?? 0) + 1;
    remainder -= 1;
  }
  return base;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)),
  );
  return sorted[idx] ?? 0;
}
