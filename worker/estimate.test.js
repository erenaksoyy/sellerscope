import test from "node:test";
import assert from "node:assert/strict";
import { estimateDailySales, reviewDelta } from "./estimate.js";

test("normal: 10 yorum x 20 katsayı = 200 satış", () => {
  assert.equal(estimateDailySales(10, 20), 200);
});

test("sıfır yorum artışı = sıfır satış", () => {
  assert.equal(estimateDailySales(0, 20), 0);
});

test("negatif delta (yorum silinmesi) şişirmez, sıfır döner", () => {
  assert.equal(estimateDailySales(-5, 20), 0);
});

test("kesirli sonuç yuvarlanır", () => {
  assert.equal(estimateDailySales(3, 7.5), 23);
});

test("geçersiz girdiler sıfır döner", () => {
  assert.equal(estimateDailySales(NaN, 20), 0);
  assert.equal(estimateDailySales(10, 0), 0);
  assert.equal(estimateDailySales("bozuk", 20), 0);
  assert.equal(estimateDailySales(10, undefined), 0);
});

test("reviewDelta: iki sayı da biliniyorsa fark", () => {
  assert.equal(reviewDelta(100, 112), 12);
  assert.equal(reviewDelta(0, 5), 5); // gerçekten 0 yorumdan 5'e çıkmış ürün
  assert.equal(reviewDelta(112, 100), -12);
});

test("reviewDelta: taraflardan biri bilinmiyorsa 0 (sahte patlama yok)", () => {
  assert.equal(reviewDelta(null, 5000), 0); // ilk görülen ürün ya da sayı ilk kez geldi
  assert.equal(reviewDelta(5000, null), 0); // bugün sayı alınamadı
  assert.equal(reviewDelta(undefined, undefined), 0);
  assert.equal(estimateDailySales(reviewDelta(null, 5000), 20), 0);
});
