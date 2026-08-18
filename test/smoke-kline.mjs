// Smoke test for kline.js (A-share + US), read-only.
import { getKlines } from "../lib/kline.js";

const tests = [
  ["A股日K 600519", () => getKlines("600519", { period: "1d", limit: 30 })],
  ["A股中文名 贵州茅台 周K", () => getKlines("贵州茅台", { period: "1w", limit: 10 })],
  ["美股 AAPL 日K", () => getKlines("AAPL", { period: "1d", limit: 30 })],
  ["美股 NVDA 60m", () => getKlines("NVDA", { period: "60m", limit: 20 })],
  ["A股指数 000001", () => getKlines("000001", { period: "1d", limit: 10 })],
];

for (const [label, fn] of tests) {
  const r = await fn();
  console.log(`\n[${label}]`);
  if (r.error) { console.log("ERROR:", r.error); continue; }
  const k = r.klines;
  console.log(`${r.name}(${r.symbol}) period=${r.period} count=${k.length}`);
  console.log("  first:", JSON.stringify(k[0]));
  console.log("  last: ", JSON.stringify(k[k.length - 1]));
}
