// Quick smoke test for market.js A-share + US network calls (read-only).
import { aStockQuote, usStockQuote, quote, toSecid } from "../lib/market.js";

console.log("toSecid tests:");
console.log("  600519 ->", toSecid("600519"), "(expect 1.600519)");
console.log("  000001 ->", toSecid("000001"), "(expect 1.000001)");
console.log("  300750 ->", toSecid("300750"), "(expect 0.300750)");

const tests = [
  ["A股 600519 贵州茅台 (code)", () => aStockQuote("600519")],
  ["A股 贵州茅台 (name search)", () => aStockQuote("贵州茅台")],
  ["A股 000001 上证指数", () => aStockQuote("000001")],
  ["美股 AAPL (known)", () => usStockQuote("AAPL")],
  ["美股 NVDA (known)", () => usStockQuote("NVDA")],
  ["美股 unknown ticker probe", () => usStockQuote("PLTR")],
  ["自动路由 US:AAPL", () => quote("US:AAPL")],
  ["自动路由 600519", () => quote("600519")],
];

for (const [label, fn] of tests) {
  const r = await fn();
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(r, null, 2));
}
