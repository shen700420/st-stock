/**
 * ST 台股 Dashboard — 數據抓取腳本
 * 由 GitHub Actions 排程執行，輸出 docs/data/latest.json
 *
 * 執行方式：node scripts/fetch-data.js
 */

import YahooFinance from "yahoo-finance2";
import { fetchTaiwanStock, todayYYYYMMDD } from "../twse.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

// 讀取庫存設定
const portfolio = JSON.parse(readFileSync(join(ROOT, "portfolio.json"), "utf8"));
const today = todayYYYYMMDD();

console.log(`\n🚀 開始抓取數據（${today}）...`);

// ── 抓取單一標的 ────────────────────────────────────────────
async function fetchOne(symbol) {
  try {
    const r = await fetchTaiwanStock(symbol, yahooFinance, today);
    return {
      symbol,
      source: r.source,
      dataDate: r.dataDate,
      price: r.close ?? null,
      change: r.change ?? null,
      changePercent: r.changePercent ?? null,
      open: r.open ?? null,
      high: r.high ?? null,
      low: r.low ?? null,
      prevClose: r.prevClose ?? null,
      volume: r.volume ?? null,
    };
  } catch (err) {
    console.warn(`  ⚠️ ${symbol} 抓取失敗：${err.message.slice(0, 80)}`);
    return { symbol, error: err.message.slice(0, 80) };
  }
}

// ── 計算持倉損益與警示 ───────────────────────────────────────
function calcPosition(pos, priceData) {
  if (!priceData || priceData.error || priceData.price == null) {
    return { ...pos, priceData: null, alerts: ["⚠️ 無法取得最新價格"] };
  }

  const { price, open, high, low, changePercent, volume, dataDate } = priceData;
  const marketValue = price * pos.shares;
  const costValue = pos.costPerShare * pos.shares;
  const pnl = marketValue - costValue;
  const pnlPercent = ((price - pos.costPerShare) / pos.costPerShare) * 100;

  // ── 型態判定 ────────────────────────────────────────────
  const alerts = [];

  // R02 停損線
  if (price <= pos.stopLoss) {
    alerts.push(`🔴 R02 強制停損觸發！收盤${price} ≤ 停損線${pos.stopLoss}`);
  } else if (price <= pos.alertStopLoss) {
    alerts.push(`🟡 警戒停損接近：收盤${price} ≤ 警戒線${pos.alertStopLoss}`);
  }

  // R17 出貨型判定（收盤 < 最高 × 0.98）
  if (high && price < high * 0.98) {
    const isR24Candidate = Math.abs(changePercent) >= 3 || (high - low) / low > 0.05;
    if (isR24Candidate) {
      alerts.push(`🔴 R24 出貨型警戒：收${price} < 最高${high}×0.98=${(high * 0.98).toFixed(1)}`);
    } else {
      alerts.push(`🟡 出貨型：收盤低於最高×0.98`);
    }
  }

  // R35 連日開高走低（簡單判定：open>prevClose AND close<open）
  if (open && priceData.prevClose && open > priceData.prevClose && price < open) {
    alerts.push(`🟡 開高走低型（R35 計數中）`);
  }

  return {
    ...pos,
    price,
    open,
    high,
    low,
    change: priceData.change,
    changePercent: priceData.changePercent,
    volume: priceData.volume,
    dataDate,
    marketValue: Math.round(marketValue),
    costValue: Math.round(costValue),
    pnl: Math.round(pnl),
    pnlPercent: parseFloat(pnlPercent.toFixed(2)),
    alerts,
  };
}

// ── 主流程 ──────────────────────────────────────────────────
const allSymbols = [
  ...portfolio.positions.map((p) => p.symbol),
  ...portfolio.watchlist,
  ...portfolio.globalIndicators,
];

// 去重
const uniqueSymbols = [...new Set(allSymbols)];

console.log(`  查詢 ${uniqueSymbols.length} 個標的...`);
const rawResults = await Promise.all(uniqueSymbols.map(fetchOne));

// 建立 symbol → data 映射
const priceMap = {};
for (const r of rawResults) {
  priceMap[r.symbol] = r;
}

// 計算持倉
const positions = portfolio.positions.map((pos) =>
  calcPosition(pos, priceMap[pos.symbol])
);

// 組合觀察清單
const watchlist = portfolio.watchlist.map((sym) => priceMap[sym] ?? { symbol: sym, error: "未取得" });

// 組合全球指標
const globalIndicators = portfolio.globalIndicators.map((sym) => priceMap[sym] ?? { symbol: sym, error: "未取得" });

// 彙總統計
const totalMarketValue = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
const totalCostValue = positions.reduce((s, p) => s + (p.costValue ?? 0), 0);
const totalPnl = totalMarketValue - totalCostValue;
const totalPnlPercent = totalCostValue > 0 ? ((totalPnl / totalCostValue) * 100).toFixed(2) : "0.00";

const hasAlerts = positions.some((p) => p.alerts && p.alerts.length > 0);

// 輸出 JSON
const output = {
  _meta: {
    updatedAt: new Date().toISOString(),
    dataDate: today,
    version: "V0014補4",
  },
  summary: {
    totalMarketValue,
    totalCostValue,
    totalPnl,
    totalPnlPercent: parseFloat(totalPnlPercent),
    positionCount: positions.length,
    hasAlerts,
  },
  positions,
  watchlist,
  globalIndicators,
};

// 確保目錄存在
mkdirSync(join(ROOT, "docs", "data"), { recursive: true });
const outPath = join(ROOT, "docs", "data", "latest.json");
writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

console.log(`\n✅ 數據已寫入 docs/data/latest.json`);
console.log(`   持倉：${positions.length} 檔 | 總市值：NT$${totalMarketValue.toLocaleString()} | 浮損益：${totalPnl >= 0 ? "+" : ""}NT$${totalPnl.toLocaleString()}`);
if (hasAlerts) {
  console.log(`   ⚠️ 有警示需要處理！`);
}
