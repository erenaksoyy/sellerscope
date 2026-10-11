// Satış tahmini: yorum artışı x kategori katsayısı.
// Sonuç HER ZAMAN tahmindir, panelde "tahmini" etiketiyle gösterilir.

// Yorum artışı. Önceki ya da bugünkü sayı bilinmiyorsa (ilk görülen ürün,
// aktör sayı döndürmedi) artış hesaplanamaz -> 0 (yanlış şişirme yok).
export function reviewDelta(prevCount, currentCount) {
  if (prevCount == null || currentCount == null) return 0;
  return currentCount - prevCount;
}

export function estimateDailySales(reviewDelta, coefficient) {
  const d = Number(reviewDelta);
  const c = Number(coefficient);
  if (!Number.isFinite(d) || !Number.isFinite(c) || d <= 0 || c <= 0) return 0;
  return Math.round(d * c);
}
