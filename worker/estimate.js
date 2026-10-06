// Satış tahmini: yorum artışı x kategori katsayısı.
// Sonuç HER ZAMAN tahmindir, panelde "tahmini" etiketiyle gösterilir.

export function estimateDailySales(reviewDelta, coefficient) {
  const d = Number(reviewDelta);
  const c = Number(coefficient);
  if (!Number.isFinite(d) || !Number.isFinite(c) || d <= 0 || c <= 0) return 0;
  return Math.round(d * c);
}
