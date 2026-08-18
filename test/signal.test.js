import { test } from "node:test";
import assert from "node:assert/strict";
import { computeADX, classifyRegime, ema } from "../lib/signal.js";

/** Deterministic PRNG (mulberry32) so tests never flake. */
function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic trending series: steady uptrend with small pullbacks. */
function makeTrending(n = 120) {
  const candles = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += 1 + Math.sin(i / 5) * 0.5;
    const open = price - 0.2;
    const high = price + 0.6;
    const low = price - 0.6;
    candles.push({ high, low, close: price });
  }
  return candles;
}

/** Synthetic noise: deterministic random walk around a flat mean. */
function makeNoise(n = 120) {
  const rand = rng(42);
  const candles = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += (rand() - 0.5) * 0.4;
    candles.push({ high: price + 0.3, low: price - 0.3, close: price });
  }
  return candles;
}

test("computeADX returns null for insufficient data", () => {
  const r = computeADX([{ high: 1, low: 1, close: 1 }]);
  assert.equal(r.adx, null);
});

test("computeADX on trending series yields high ADX", () => {
  const r = computeADX(makeTrending());
  assert.ok(r.adx !== null, "adx should be computed");
  assert.ok(r.adx > 20, `expected strong trend ADX > 20, got ${r.adx}`);
});

test("classifyRegime trending -> trend/long", () => {
  const r = classifyRegime(makeTrending());
  assert.equal(r.regime, "trend");
  assert.equal(r.direction, "long");
});

test("classifyRegime noise -> noise", () => {
  const r = classifyRegime(makeNoise());
  assert.equal(r.regime, "noise");
});

test("ema computes a finite value", () => {
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isFinite(e));
});
