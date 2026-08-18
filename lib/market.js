/**
 * market.js — A-share (China stock) market quotes, read-only.
 * Data source: EastMoney push2 API (direct connection, no proxy, no API key).
 * Supports Shanghai/Shenzhen stocks, indices, ETFs via code or name search.
 * All functions return plain JSON; failures return { error } instead of throwing.
 */

const EASTMONEY_QUOTE = "https://push2.eastmoney.com/api/qt/stock/get";
const EASTMONEY_LIST = "https://push2.eastmoney.com/api/qt/ulist.np/get";
const EASTMONEY_SEARCH = "https://searchapi.eastmoney.com/api/suggest/get";

const TIMEOUT_MS = 10000;

async function fetchJson(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-trading-toolkit/0.2",
        Referer: "https://quote.eastmoney.com/",
        ...extraHeaders,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Normalize an A-share symbol to plain 6-digit code: "600519" | "sh600519" | "600519.SH" -> "600519". */
export function normalizeSymbol(sym) {
  let s = String(sym || "").trim().toLowerCase();
  s = s.replace(/\.(sh|sz|bj)$/, "").replace(/^(sh|sz|bj)/, "");
  s = s.replace(/\D/g, "");
  return s;
}

/** Map a 6-digit code to EastMoney secid: 1.xxxxxx (SH) or 0.xxxxxx (SZ/BJ). */
export function toSecid(code) {
  if (!/^\d{6}$/.test(code)) return null;
  // 6xx = SH stocks, 5xx/9xx = SH funds/bonds, 000001 bare = SH index
  if (code.startsWith("6") || code.startsWith("5") || code.startsWith("9") || code === "000001") {
    return `1.${code}`;
  }
  // 0xx/3xx = SZ stocks, 1xx/2xx = SZ funds, 4xx/8xx = BJ -> 0.
  return `0.${code}`;
}

/**
 * Search by keyword (code or Chinese name) via EastMoney suggest API.
 * @returns {Array<{code:string, name:string, secid:string, type:string}>}
 */
export async function searchAStock(keyword) {
  try {
    const url = `${EASTMONEY_SEARCH}?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=8`;
    const j = await fetchJson(url, { Referer: "https://quote.eastmoney.com/" });
    const list = j?.QuotationCodeTable?.Data || [];
    return list
      .filter((x) => x && (String(x.Classify) === "AStock" || String(x.MarketType) === "1" || String(x.MarketType) === "2"))
      .map((x) => ({
        code: x.Code,
        name: x.Name,
        secid: x.QuoteID || `${String(x.MarketType) === "1" ? 1 : 0}.${x.Code}`,
        type: x.SecurityTypeName || "",
      }));
  } catch (e) {
    return [];
  }
}

/**
 * A-share quote by code or name.
 * @param {string} symbol code like "600519", "000001", or name like "贵州茅台"
 */
export async function aStockQuote(symbol) {
  try {
    const raw = String(symbol || "").trim();
    let secid = toSecid(normalizeSymbol(raw));

    if (!secid && /[\u4e00-\u9fa5]/.test(raw)) {
      // Chinese name -> search first
      const hits = await searchAStock(raw);
      if (!hits.length) return { error: `未找到: ${raw}` };
      secid = hits[0].secid;
    }
    // Explicit index name/code mapping (000001 bare maps to SH index above; keep others here)
    if (!secid && INDEX_SECIDS[raw]) {
      secid = INDEX_SECIDS[raw].secid;
    }
    if (!secid) return { error: `无法识别的代码: ${symbol}` };

    const fields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170";
    const url = `${EASTMONEY_QUOTE}?fltt=2&invt=2&secid=${secid}&fields=${fields}`;
    const j = await fetchJson(url);
    const d = j?.data;
    if (!d || d.f57 === undefined) return { error: `行情不可用: ${symbol}` };

    return {
      source: "eastmoney",
      symbol: d.f57,
      name: d.f58,
      price: d.f43,
      prevClose: d.f60,
      change: d.f169,
      changePct: d.f170,
      open: d.f46,
      high: d.f44,
      low: d.f45,
      volume: d.f47,      // hands (手)
      amount: d.f48,      // CNY
      ts: new Date().toISOString(),
    };
  } catch (e) {
    return { error: e.message };
  }
}

/** Convenience: A-share indices (上证指数/深证成指/创业板指...). */
export const INDEX_SECIDS = {
  "000001": { secid: "1.000001", name: "上证指数" },
  "399001": { secid: "0.399001", name: "深证成指" },
  "399006": { secid: "0.399006", name: "创业板指" },
  "000688": { secid: "1.000688", name: "科创50" },
  "000300": { secid: "1.000300", name: "沪深300" },
};

export default { aStockQuote, usStockQuote, quote, searchAStock, normalizeSymbol, toSecid, INDEX_SECIDS };

// ---------------------------------------------------------------------------
// US stocks (via the same EastMoney push2 API)
// ---------------------------------------------------------------------------

/** secid market prefixes used by EastMoney for US markets. */
const US_MARKETS = [105, 106, 107]; // 105=NASDAQ 106=NYSE 107=AMEX

/** Common US tickers -> secid (avoids a probe round-trip). */
export const KNOWN_US_TICKERS = {
  AAPL: "105.AAPL",
  MSFT: "105.MSFT",
  NVDA: "105.NVDA",
  TSLA: "105.TSLA",
  META: "105.META",
  AMZN: "105.AMZN",
  GOOGL: "105.GOOGL",
  GOOG: "105.GOOG",
  HOOD: "105.HOOD",
  AMD: "105.AMD",
  NFLX: "105.NFLX",
  BRK: "106.BRK",
  JPM: "106.JPM",
  KO: "106.KO",
  DIS: "106.DIS",
  BA: "106.BA",
};

/** Normalize a US ticker: uppercase, strip exchange suffix. */
export function normalizeTicker(sym) {
  return String(sym || "").trim().toUpperCase()
    .replace(/\.(US|NASDAQ|NYSE|AMEX)$/, "")
    .replace(/^US:/, "");
}

/** Fetch full quote for a known secid via stock/get. */
async function fetchQuoteBySecid(secid) {
  const fields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170";
  const url = `${EASTMONEY_QUOTE}?fltt=2&invt=2&secid=${secid}&fields=${fields}`;
  const j = await fetchJson(url);
  const d = j?.data;
  if (!d || d.f57 === undefined) return { error: `行情不可用: ${secid}` };
  return {
    source: "eastmoney-us",
    symbol: d.f57,
    name: d.f58,
    price: d.f43,
    prevClose: d.f60,
    change: d.f169,
    changePct: d.f170,
    open: d.f46,
    high: d.f44,
    low: d.f45,
    volume: d.f47,
    amount: d.f48,
    currency: "USD",
    ts: new Date().toISOString(),
  };
}

/** Probe which market hosts an unknown ticker via the batch list API. */
async function probeTicker(ticker) {
  const secids = US_MARKETS.map((m) => `${m}.${ticker}`).join(",");
  const url = `${EASTMONEY_LIST}?fltt=2&invt=2&secids=${secids}&fields=f2,f3,f12,f13,f14`;
  try {
    const j = await fetchJson(url);
    const diff = j?.data?.diff;
    if (!Array.isArray(diff) || !diff.length) return null;
    const hit = diff.find((r) => String(r.f12).toUpperCase() === ticker);
    if (!hit) return null;
    // Reconstruct the market prefix from the hit's secid-like field (f13 is market)
    const mkt = hit.f13;
    return `${mkt}.${ticker}`;
  } catch {
    return null;
  }
}

/**
 * US stock quote by ticker.
 * @param {string} symbol e.g. "AAPL", "NVDA", "BRK.B" (-> BRK), "105.AAPL"
 */
export async function usStockQuote(symbol) {
  try {
    let ticker = normalizeTicker(symbol);
    if (!/^[A-Z][A-Z0-9]{0,4}$/.test(ticker)) return { error: `无法识别的美股代码: ${symbol}` };

    // Explicit market prefix: 105.AAPL
    const m = ticker.match(/^(10[5-7])\.([A-Z0-9]+)$/);
    if (m) return fetchQuoteBySecid(`${m[1]}.${m[2]}`);

    const known = KNOWN_US_TICKERS[ticker];
    if (known) return await fetchQuoteBySecid(known);

    const secid = await probeTicker(ticker);
    if (!secid) return { error: `美股代码不存在: ${ticker}` };
    return await fetchQuoteBySecid(secid);
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Unified quote entry: auto-routes A-share vs US stock.
 *   "600519" / "sh600519" / "贵州茅台" -> A-share
 *   "AAPL" / "NVDA" / "105.AAPL"       -> US stock
 *   "US:AAPL" / "CN:600519"             -> explicit market
 */
export async function quote(symbol) {
  const raw = String(symbol || "").trim();
  if (/^(US|CN):/i.test(raw)) {
    const [mkt, rest] = raw.split(":");
    return mkt.toUpperCase() === "US" ? usStockQuote(rest) : aStockQuote(rest);
  }
  // Chinese name -> A-share
  if (/[\u4e00-\u9fa5]/.test(raw)) return aStockQuote(raw);
  // 6-digit code or sh/sz prefix -> A-share
  if (/^(sh|sz|bj)/i.test(raw) || /^\d{6}$/.test(raw)) return aStockQuote(raw);
  // bare letters -> US ticker
  return usStockQuote(raw);
}
