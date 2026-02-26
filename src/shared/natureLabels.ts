const ROCK_LABELS: readonly string[] = [
  'Rock',
  'Yup, rock',
  'A rock',
  'Stone',
  'Rock solid',
  'Very rock',
  "It's a rock",
  'Rock vibes',
  'Certified rock',
  'Rock of ages',
  'Just a rock',
  'Rock, innit',
  'Rock report',
  'Pet rock',
  'Rock on',
  'Rock-like substance',
];

const TREE_LABELS: readonly string[] = [
  'Tree',
  'Yup, tree',
  'A tree',
  'Wood',
  'Leafy lad',
  'Tree moment',
  'Very tree',
  'Tree confirmed',
  "It's a tree",
  'Tree vibes',
  'Certified tree',
  'Tree of life',
  'Just a tree',
  'Tree, innit',
  'Tree report',
  'Leafy boi',
  'Branch manager',
  'Wood facts',
  'Tree facts',
];

export function getNatureLabel(type: 'rock' | 'tree', seed: number): string {
  const labels = type === 'rock' ? ROCK_LABELS : TREE_LABELS;
  const idx = ((seed % labels.length) + labels.length) % labels.length;
  return labels[idx] ?? labels[0]!;
}
