/**
 * signal.js — ADX regime signal (trend / oscillating / noise).
 * Pure functions, no I/O, no dependencies. Mirrors the PrinciplesV2
 * three-state classification used by the author's live trading stack:
 *   - trend:       ADX >= 25, direction from +DI/-DI cross
 *   - oscillating: 15 <= ADX < 25
 *   - noise:       ADX < 15
 *
 * Input candles: [{ high, low, close }, ...] oldest first.
 */

export const ADX_PERIOD = 14;
export const TREND_ADX = 25;
export const OSC_ADX = 15;

function wilderSmooth(values, period) {
  if (values.length < period) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out.push(prev);
  }
  return out;
}

/**
 * Compute ADX, +DI, -DI from candles.
 * @returns {{adx:number|null, plusDi:number|null, minusDi:number|null}}
 */
export function computeADX(candles, period = ADX_PERIOD) {
  if (!Array.isArray(candles) || candles.length < period + 1) {
    return { adx: null, plusDi: null, minusDi: null };
  }
  const tr = [];
  const plusDm = [];
  const minusDm = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const hl = c.high - c.low;
    const hc = Math.abs(c.high - prev.close);
    const lc = Math.abs(c.low - prev.close);
    tr.push(Math.max(hl, hc, lc));
    const up = c.high - prev.high;
    const down = prev.low - c.low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  const atr = wilderSmooth(tr, period);
  const plusDiRaw = wilderSmooth(plusDm, period);
  const minusDiRaw = wilderSmooth(minusDm, period);
  if (atr.length === 0) return { adx: null, plusDi: null, minusDi: null };

  const dx = [];
  for (let i = 0; i < atr.length; i++) {
    const p = (100 * plusDiRaw[i]) / (atr[i] || 1e-12);
    const m = (100 * minusDiRaw[i]) / (atr[i] || 1e-12);
    const sum = p + m;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(p - m)) / sum);
  }
  const adxSeries = wilderSmooth(dx, period);
  const adx = adxSeries.length ? adxSeries[adxSeries.length - 1] : null;
  const plusDi = (100 * plusDiRaw[plusDiRaw.length - 1]) / (atr[atr.length - 1] || 1e-12);
  const minusDi = (100 * minusDiRaw[minusDiRaw.length - 1]) / (atr[atr.length - 1] || 1e-12);
  return { adx: round(adx), plusDi: round(plusDi), minusDi: round(minusDi) };
}

/** EMA helper (also used for the 200-EMA trend bias). */
export function ema(values, period) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/**
 * Classify regime from candles.
 * @returns {{regime:'trend'|'oscillating'|'noise', adx:number|null,
 *            plusDi:number|null, minusDi:number|null, direction:'long'|'short'|null,
 *            ema200:number|null, price:number|null}}
 */
export function classifyRegime(candles, opts = {}) {
  const trendAdx = opts.trendAdx ?? TREND_ADX;
  const oscAdx = opts.oscAdx ?? OSC_ADX;
  const { adx, plusDi, minusDi } = computeADX(candles, opts.period ?? ADX_PERIOD);
  const closes = candles.map((c) => c.close);
  const e200 = ema(closes, 200);
  const price = closes.length ? closes[closes.length - 1] : null;

  let regime = "noise";
  let direction = null;
  if (adx !== null) {
    if (adx >= trendAdx) {
      regime = "trend";
      if (plusDi !== null && minusDi !== null) {
        direction = plusDi >= minusDi ? "long" : "short";
      }
      // EMA-200 bias overrides pure DI when both are available.
      if (e200 !== null && price !== null) {
        direction = price >= e200 ? "long" : "short";
      }
    } else if (adx >= oscAdx) {
      regime = "oscillating";
    }
  }
  return { regime, adx, plusDi, minusDi, direction, ema200: e200 === null ? null : round(e200), price };
}

function round(v, d = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export default { computeADX, classifyRegime, ema, ADX_PERIOD, TREND_ADX, OSC_ADX };
