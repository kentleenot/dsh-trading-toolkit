/**
 * kline.js — historical OHLCV klines for A-shares and US stocks, read-only.
 * Data source: EastMoney push2his kline API (direct connection, no proxy, no key).
 * Periods (klt): 1/5/15/30/60 = minutes, 101 = daily, 102 = weekly, 103 = monthly.
 * Adjustment (fqt): 0 = none, 1 = forward-adjusted (default), 2 = backward-adjusted.
 *
 * Limit note: EastMoney's kline API controls row count via the beg/end date range
 * (the `lmt` param is ignored), so we derive `beg` from the requested limit and
 * then slice to exactly `limit` candles.
 */

import { toSecid, searchAStock } from "./market.js";

const KLINE_API = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const TIMEOUT_MS = 15000;

const KLT_MAP = {
  "1m": 1, "5m": 5, "15m": 15, "30m": 30, "60m": 60,
  "1h": 60,
  "1d": 101, "day": 101, "daily": 101,
  "1w": 102, "week": 102, "weekly": 102,
  "1M": 103, "month": 103, "monthly": 103,
};

/** Approx candles per trading day per period (for beg-date derivation). */
const BARS_PER_DAY = { 1: 240, 5: 48, 15: 16, 30: 8, 60: 4, 101: 1, 102: 1 / 5, 103: 1 / 21 };
/** Multiplier for calendar days (covers weekends/holidays). */
const DAY_MULT = { 101: 1.6, 102: 8, 103: 35, 1: 1.3, 5: 1.3, 15: 1.3, 30: 1.3, 60: 1.3 };

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-trading-toolkit/0.2",
        Referer: "https://quote.eastmoney.com/",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Normalize a period string to a klt int. Returns null if unsupported. */
export function normalizePeriod(period) {
  const key = String(period || "1d").trim().toLowerCase();
  return KLT_MAP[key] ?? null;
}

/** YYYYMMDD for a date N calendar days before today (or before `end` if end is a real date). */
function begDate(end, daysBack) {
  const isRealEnd = end && /^\d{8}$/.test(String(end)) && String(end) <= new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const base = isRealEnd ? new Date(+String(end).slice(0, 4), +String(end).slice(4, 6) - 1, +String(end).slice(6, 8)) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() - daysBack);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Resolve A-share symbol to secid. */
async function resolveCnSecid(symbol) {
  const code = String(symbol || "").trim();
  const secid = toSecid(code);
  if (secid) return { secid, symbol: code };
  if (/[\u4e00-\u9fa5]/.test(code)) {
    const hits = await searchAStock(code);
    if (hits.length) return { secid: hits[0].secid, symbol: hits[0].code, name: hits[0].name };
  }
  return null;
}

/** Fetch klines for an exact secid. Returns {error} on failure, never throws. */
async function fetchKlines(secid, klt, fqt, limit, opts) {
  const end = opts.end ?? "20500101";
  const daysBack = Math.ceil((limit / (BARS_PER_DAY[klt] || 1)) * (DAY_MULT[klt] || 1.6)) + 2;
  const beg = opts.beg ?? begDate(end, daysBack);
  const url = `${KLINE_API}?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=${fqt}&beg=${beg}&end=${end}&lmt=${limit}`;
  const j = await fetchJson(url);
  const data = j?.data;
  if (!data) return { error: `行情不可用: ${secid}` };
  const raw = data.klines || [];
  if (!raw.length) return { error: `没有K线数据: ${secid}` };

  const klines = raw.slice(-limit).map((line) => {
    const [date, open, close, high, low, volume, amount, amplitude] = line.split(",");
    return {
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount),
      amplitude: Number(amplitude),
    };
  });
  return { symbol: data.code, name: data.name, period: klt, klines };
}

/**
 * Fetch klines for an A-share or US symbol.
 * @param {string} symbol code/name/ticker, e.g. "600519", "贵州茅台", "AAPL"
 * @param {object} opts { period, fqt, limit, beg, end }
 */
export async function getKlines(symbol, opts = {}) {
  const period = normalizePeriod(opts.period ?? "1d");
  if (period === null) return { error: `不支持的周期: ${opts.period}（支持 1m/5m/15m/30m/60m/1d/1w/1M）` };
  const fqt = opts.fqt ?? 1;
  const limit = Math.min(Math.max(parseInt(opts.limit ?? 120, 10) || 120, 2), 1000);

  try {
    const raw = String(symbol || "").trim();
    let cn = false;

    if (/^(US|CN):/i.test(raw)) {
      const [, mkt, rest] = raw.match(/^(US|CN):(.+)$/i);
      cn = mkt.toUpperCase() !== "US";
      return cn ? fetchKlines((await resolveCnSecid(rest))?.secid, period, fqt, limit, opts)
                : probeUsKlines(rest, period, fqt, limit, opts);
    }
    if (/[\u4e00-\u9fa5]/.test(raw) || /^(sh|sz|bj)/i.test(raw) || /^\d{6}$/.test(raw)) {
      const resolved = await resolveCnSecid(raw);
      if (!resolved) return { error: `无法解析标的: ${symbol}` };
      return fetchKlines(resolved.secid, period, fqt, limit, opts);
    }
    // Bare ticker -> US
    return probeUsKlines(raw, period, fqt, limit, opts);
  } catch (e) {
    return { error: e.message };
  }
}

/** Probe NASDAQ(105)/NYSE(106)/AMEX(107) for a US ticker; first hit wins. */
async function probeUsKlines(ticker, period, fqt, limit, opts) {
  const t = String(ticker || "").trim().toUpperCase().replace(/\.(US|NASDAQ|NYSE|AMEX)$/, "");
  if (!/^[A-Z][A-Z0-9]{0,4}$/.test(t)) return { error: `无法识别的美股代码: ${ticker}` };
  let lastErr = null;
  for (const mkt of [105, 106, 107]) {
    const r = await fetchKlines(`${mkt}.${t}`, period, fqt, limit, opts);
    if (r && !r.error) return r;
    lastErr = r?.error || lastErr;
  }
  return { error: `美股代码不存在或暂无K线: ${t}${lastErr ? `（${lastErr}）` : ""}` };
}

export default { getKlines, normalizePeriod };
