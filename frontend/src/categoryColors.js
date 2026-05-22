const COLORS = [
  '#4C6EF5', // blue
  '#F76707', // orange
  '#2F9E44', // green
  '#E03131', // red
  '#7950F2', // purple
  '#0CA678', // teal
  '#F59F00', // amber
  '#D6336C', // pink
  '#1098AD', // cyan
  '#66A80F', // lime
];

export function getCategoryColor(category) {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) & 0xffffffff;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}
