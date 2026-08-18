# dsh-trading-toolkit

A-share + US stock trading toolkit for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agents: 行情查询（A股+美股）、ADX 三状态信号、简易回测预览。**只读设计——永不下单、不触碰任何交易凭据。**

## Tools

| 工具 | 说明 |
|------|------|
| `market_quote` | 股票实时行情，自动识别 A股/美股：6位代码（600519）、前缀代码（sh600519）、中文名（贵州茅台）、美股 ticker（AAPL/NVDA）、指数（上证指数/深证成指/创业板指/科创50/沪深300）。数据源：东方财富，国内直连免 Key |
| `kline_history` | 历史 OHLCV K线：A股/美股，周期 1m/5m/15m/30m/60m/1d/1w/1M，复权 0/1/2，最多 1000 根，输出可直接喂给 regime_signal |
| `regime_signal` | ADX 三状态市场分类：`trend`（趋势）/ `oscillating`（震荡）/ `noise`（噪声），含多空方向与 200-EMA 偏向。纯计算 |
| `backtest_run` | 基于跨状态规则的简易多空回测（总收益/最大回撤/胜率/交易次数）。教育用途预览，非生产级回测 |

## 安装

```sh
dsh plugin add kentleenot/dsh-trading-toolkit
```

然后将插件加入你的 DeepSeek Harness 组合配置（参见 harness 第三方插件文档）。

## 用法示例（agent 可调用）

```
market_quote(symbol: "600519")        # A股：贵州茅台
market_quote(symbol: "贵州茅台")       # A股：中文名搜索
market_quote(symbol: "000001")        # A股：上证指数
market_quote(symbol: "AAPL")          # 美股：苹果
market_quote(symbol: "NVDA")          # 美股：英伟达（未知 ticker 自动探测市场）
market_quote(symbol: "US:AAPL")       # 强制美股
market_quote(symbol: "CN:600519")     # 强制 A股
kline_history(symbol: "600519", period: "1d", limit: 120)   # 贵州茅台日K
kline_history(symbol: "AAPL", period: "60m", limit: 48)     # 苹果60分钟K
kline_history(symbol: "贵州茅台", period: "1w", limit: 30)  # 中文名周K
regime_signal(candles: [[high, low, close], ...])
backtest_run(candles: [[high, low, close], ...], feePct: 0.05)
```

## 自动路由规则

- 6 位数字 / `sh|sz|bj` 前缀 / 中文名 → A股
- 纯字母 ticker（AAPL、NVDA、PLTR）→ 美股
- `US:` / `CN:` 前缀 → 强制指定市场
- 常见美股 ticker（AAPL/MSFT/NVDA/TSLA/META/AMZN/GOOGL/HOOD/AMD/NFLX/BRK/JPM/KO/DIS/BA）走内置映射；未知 ticker 自动探测 NASDAQ/NYSE/AMEX

## 为什么做这个

本插件把作者实盘策略栈（PrinciplesV2 —— ADX 驱动的三状态自适应策略）以**只读、教学**形式开放。状态分类沿用生产环境相同的阈值：

- `trend`：ADX >= 25，方向由 +DI/-DI 交叉决定，200-EMA 偏向覆盖
- `oscillating`：15 <= ADX < 25
- `noise`：ADX < 15

行情数据源用东方财富公开接口：国内直连、无需代理、无需 API Key、免费，同时覆盖沪深与美股。

## 开发

```sh
npm test          # node --test test/
node test/smoke-market.mjs   # 行情网络冒烟测试（A股+美股）
```

## License

MIT
