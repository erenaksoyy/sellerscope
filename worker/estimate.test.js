import test from "node:test";
import assert from "node:assert/strict";
import { estimateDailySales } from "./estimate.js";

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
