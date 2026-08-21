/**
 * dsh-trading-toolkit — a model-facing trading toolkit for DeepSeek Harness.
 *
 * Cordis plugin exporting three read-only tools:
 *   - market_quote:   crypto/US-stock token quotes (CoinGecko + DexScreener)
 *   - regime_signal:  ADX three-state regime classification (trend/oscillating/noise)
 *   - backtest_run:   trivial price-series backtest preview (no orders)
 *
 * All logic is pure and read-only: this plugin never places orders, never
 * touches exchange keys, and performs no side effects beyond public API reads.
 *
 * @module dsh-trading-toolkit
 */
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { quote } from "./market.js";
import { getKlines } from "./kline.js";
import { classifyRegime } from "./signal.js";

/** Cordis plugin name (registered with the loader). */
const name = "trading-toolkit";

/** Services this plugin must resolve before it applies. */
const inject = ["tools"];

/** Composition-row configuration. */
const Config = z.object({
  /** Default quote source preference: auto | coingecko | dexscreener. */
  quoteSource: z.string().default("auto"),
  /** ADX threshold for trend regime. */
  trendAdx: z.number().default(25),
  /** ADX threshold for oscillating regime. */
  oscAdx: z.number().default(15),
});

/** Convert candles from model input (array of [high, low, close]) to objects. */
function toCandles(rows) {
  return (rows || []).map((r) => {
    if (Array.isArray(r)) return { high: r[0], low: r[1], close: r[2] };
    return { high: r.high, low: r.low, close: r.close };
  });
}

function apply(ctx, config) {
  // ---- market_quote -------------------------------------------------------
  ctx.tools.register(defineTool({
    name: "market_quote",
    description:
      "Get a current stock quote (price, change %, open/high/low, volume, amount). " +
      "Supports A-shares and US stocks with auto-routing:\n" +
      "  A-share: 6-digit code (600519), prefixed code (sh600519, 600519.SH), or Chinese name (贵州茅台). " +
      "  US stock: ticker (AAPL, NVDA, TSLA), or 105.AAPL for explicit market. " +
      "  Indices: 上证指数/深证成指/创业板指/科创50/沪深300. " +
      "  Force market: US:AAPL or CN:600519. " +
      "Data source: EastMoney, direct connection, no API key. Read-only.",
    parameters: {
      symbol: { type: "string", required: true, description: "A-share code/name or US ticker, e.g. 600519, 贵州茅台, AAPL, NVDA." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          name: { type: "string" },
          price: { type: "number" },
          change: { type: "number" },
          changePct: { type: "number" },
          open: { type: "number" },
          high: { type: "number" },
          low: { type: "number" },
          volume: { type: "number" },
          amount: { type: "number" },
          currency: { type: "string" },
          source: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_args, v) => {
        if (v.error) return [{ type: "text", text: `market_quote error: ${v.error}` }];
        const cur = v.currency === "USD" ? "$" : "¥";
        const chg = v.changePct === undefined ? "n/a" : `${v.changePct >= 0 ? "+" : ""}${Number(v.changePct).toFixed(2)}%`;
        return [{ type: "text", text: `${v.name}(${v.symbol}) ${cur}${Number(v.price).toFixed(2)} (${chg})` }];
      },
    },
    execute: async (args) => {
      const r = await quote(args.symbol);
      return r.error ? { error: r.error } : r;
    },
    presentCall: (args) => ({ card: "generic", title: `行情查询: ${args.symbol}`, kind: "search", rawInput: args }),
  }));

  // ---- regime_signal ------------------------------------------------------
  ctx.tools.register(defineTool({
    name: "regime_signal",
    description:
      "Classify market regime from OHLC candles using the ADX three-state model: " +
      "trend (ADX >= 25, with long/short direction), oscillating (15 <= ADX < 25), noise (ADX < 15). " +
      "Also reports +DI/-DI and 200-EMA bias. Read-only, pure computation.",
    parameters: {
      candles: {
        type: "array",
        required: true,
        description: "OHLC candles oldest-first. Each entry: [high, low, close] or {high, low, close}.",
        items: {
          type: "array",
          items: { type: "number" },
          description: "[high, low, close]",
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          regime: { type: "string", enum: ["trend", "oscillating", "noise"] },
          direction: { type: "string", enum: ["long", "short"] },
          adx: { type: "number" },
          plusDi: { type: "number" },
          minusDi: { type: "number" },
          ema200: { type: "number" },
          price: { type: "number" },
          error: { type: "string" },
        },
      },
      render: (_args, v) => {
        if (v.error) return [{ type: "text", text: `regime_signal error: ${v.error}` }];
        const dir = v.direction ? ` / ${v.direction}` : "";
        return [{ type: "text", text: `regime: ${v.regime}${dir} (ADX ${v.adx}, +DI ${v.plusDi}, -DI ${v.minusDi})` }];
      },
    },
    execute: (args) => {
      try {
        const candles = toCandles(args.candles);
        if (!candles.length) return { error: "no candles provided" };
        return classifyRegime(candles, { trendAdx: config.trendAdx, oscAdx: config.oscAdx });
      } catch (e) {
        return { error: e.message };
      }
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Regime signal (${Array.isArray(args.candles) ? args.candles.length : 0} candles)`,
      kind: "other",
      rawInput: args,
    }),
  }));

  // ---- kline_history ------------------------------------------------------
  ctx.tools.register(defineTool({
    name: "kline_history",
    description:
      "Fetch historical OHLCV klines for an A-share or US stock, compatible with regime_signal. " +
      "Symbols: A-share code/name (600519, 贵州茅台) or US ticker (AAPL, NVDA). " +
      "Periods: 1m/5m/15m/30m/60m/1d/1w/1M. Adjustment: fqt 0=none, 1=forward (default), 2=backward. " +
      "Returns up to `limit` (default 120, max 1000) candles as {date, open, close, high, low, volume, amount, amplitude}. " +
      "Read-only, EastMoney direct connection, no API key.",
    parameters: {
      symbol: { type: "string", required: true, description: "A-share code/name or US ticker, e.g. 600519, 贵州茅台, AAPL." },
      period: { type: "string", description: "1m/5m/15m/30m/60m/1d/1w/1M, default 1d." },
      fqt: { type: "number", description: "Adjustment: 0 none, 1 forward (default), 2 backward." },
      limit: { type: "number", description: "Max candles, default 120, max 1000." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          name: { type: "string" },
          period: { type: "number" },
          klines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                date: { type: "string" }, open: { type: "number" }, close: { type: "number" },
                high: { type: "number" }, low: { type: "number" }, volume: { type: "number" },
                amount: { type: "number" }, amplitude: { type: "number" },
              },
            },
          },
          error: { type: "string" },
        },
      },
      render: (_args, v) => {
        if (v.error) return [{ type: "text", text: `kline_history error: ${v.error}` }];
        const last = v.klines?.[v.klines.length - 1];
        const first = v.klines?.[0];
        const span = first && last ? `${first.date} ~ ${last.date}` : "";
        return [{
          type: "text",
          text: `${v.name}(${v.symbol}) ${v.klines.length}根K线 ${span} 最新收盘 ${last?.close ?? "n/a"}`,
        }];
      },
    },
    execute: async (args) => {
      const r = await getKlines(args.symbol, {
        period: args.period ?? "1d",
        fqt: args.fqt ?? 1,
        limit: args.limit ?? 120,
      });
      return r.error ? { error: r.error } : r;
    },
    presentCall: (args) => ({
      card: "generic",
      title: `K线: ${args.symbol} (${args.period ?? "1d"})`,
      kind: "search",
      rawInput: args,
    }),
  }));
  ctx.tools.register(defineTool({
    name: "backtest_run",
    description:
      "Run a trivial long/short backtest over a price series with a simple cross-regime rule: " +
      "long when regime is trend+long, short when trend+short, flat otherwise. Returns total return, " +
      "max drawdown, win rate, and trade count. Educational preview only — not a production backtest.",
    parameters: {
      candles: {
        type: "array",
        required: true,
        description: "OHLC candles oldest-first: [high, low, close] or {high, low, close}.",
        items: { type: "array", items: { type: "number" } },
      },
      feePct: { type: "number", description: "Per-trade fee in percent, default 0.05." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          trades: { type: "number" },
          totalReturnPct: { type: "number" },
          maxDrawdownPct: { type: "number" },
          winRatePct: { type: "number" },
          error: { type: "string" },
        },
      },
      render: (_args, v) => {
        if (v.error) return [{ type: "text", text: `backtest_run error: ${v.error}` }];
        return [{
          type: "text",
          text: `trades: ${v.trades} | total ${v.totalReturnPct >= 0 ? "+" : ""}${v.totalReturnPct}% | maxDD ${v.maxDrawdownPct}% | win ${v.winRatePct}%`,
        }];
      },
    },
    execute: (args) => {
      try {
        const candles = toCandles(args.candles);
        if (candles.length < 30) return { error: "need >= 30 candles for a meaningful preview" };
        const fee = (args.feePct ?? 0.05) / 100;
        let position = 0; // +1 long, -1 short, 0 flat
        let entry = 0;
        let equity = 1;
        let peak = 1;
        let maxDd = 0;
        let trades = 0;
        let wins = 0;
        const rets = [];
        for (let i = 1; i < candles.length; i++) {
          const prev = candles[i - 1].close;
          const cur = candles[i].close;
          const ret = cur / prev - 1;
          const regime = classifyRegime(candles.slice(0, i + 1), { trendAdx: config.trendAdx, oscAdx: config.oscAdx });
          const target = regime.regime === "trend" ? (regime.direction === "long" ? 1 : -1) : 0;
          if (target !== position) {
            if (position !== 0) {
              const tradeRet = position * (cur / entry - 1) - fee;
              equity *= 1 + tradeRet;
              rets.push(tradeRet);
              trades++;
              if (tradeRet > 0) wins++;
            }
            position = target;
            entry = cur;
          }
        }
        if (position !== 0) {
          const final = candles[candles.length - 1].close;
          const tradeRet = position * (final / entry - 1) - fee;
          equity *= 1 + tradeRet;
          rets.push(tradeRet);
          trades++;
          if (tradeRet > 0) wins++;
        }
        // recompute max drawdown on equity path
        let eq = 1;
        let pk = 1;
        for (const r of rets) {
          eq *= 1 + r;
          pk = Math.max(pk, eq);
          maxDd = Math.max(maxDd, (pk - eq) / pk);
        }
        return {
          trades,
          totalReturnPct: Math.round((equity - 1) * 10000) / 100,
          maxDrawdownPct: Math.round(maxDd * 10000) / 100,
          winRatePct: trades ? Math.round((wins / trades) * 1000) / 10 : 0,
        };
      } catch (e) {
        return { error: e.message };
      }
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Backtest preview (${Array.isArray(args.candles) ? args.candles.length : 0} candles)`,
      kind: "other",
      rawInput: args,
    }),
  }));
}

export { Config, apply, inject, name };
