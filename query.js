// 台股即時/歷史收盤價查詢工具 — Stock.md V0009 三方混合架構
// 數據源：
//   - 上市 .TW   → TWSE 官方 API（primary）+ Yahoo（fallback）
//   - 上櫃 .TWO  → TPEx 官方 API（primary）+ Yahoo（fallback）
//   - 指數/美股/ADR/匯率/期貨 → Yahoo Finance
//
// 使用方式：
//   node query.js                          (查詢預設清單)
//   node query.js 2330.TW 4979.TWO         (查詢指定代號)
//   node query.js --date=20260420 2618.TW  (查詢指定日期)

import YahooFinance from "yahoo-finance2";
import { fetchTaiwanStock, todayYYYYMMDD } from "./twse.js";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// 預設查詢清單（4/20 重點追蹤）
const DEFAULT_SYMBOLS = [
  // Win 持股
  "2618.TW",   // 長榮航（進場 35.3×2 張）
  // Top 5 推薦驗證
  "2454.TW",   // 聯發科
  "2382.TW",   // 廣達
  "1301.TW",   // 台塑
  "2912.TW",   // 統一超
  // 迴避清單驗證
  "2330.TW",   // 台積電
  "4979.TWO",  // 華星光
  "2337.TW",   // 旺宏（已停損）
  // 大盤
  "^TWII",     // 加權指數
];

const NAME_MAP = {
  // ── 半導體・晶圓代工 ──────────────────────────
  "2330.TW": "台積電",
  "2303.TW": "聯電",
  "5347.TW": "世界先進",
  "3105.TW": "穩懋",
  // ── IC設計 ───────────────────────────────────
  "2454.TW": "聯發科",
  "3034.TW": "聯詠",
  "2379.TW": "瑞昱",
  "3711.TW": "日月光投控",   // OSAT
  // ── 記憶體 ───────────────────────────────────
  "2337.TW": "旺宏",
  "2344.TW": "華邦電",
  "2408.TW": "南亞科",
  "6770.TW": "力積電",
  // ── PCB・載板 ────────────────────────────────
  "3037.TW": "欣興",
  "3189.TW": "景碩",
  "8046.TW": "南電",
  "3221.TWO": "台嘉碩",
  // ── 電子代工・品牌 ───────────────────────────
  "2317.TW": "鴻海",
  "2382.TW": "廣達",
  "2357.TW": "華碩",
  "3231.TW": "緯創",
  "2324.TW": "仁寶",
  // ── AI電源・散熱 ─────────────────────────────
  "2308.TW": "台達電",
  "3017.TW": "奇鋐",
  "3230.TW": "雙鴻",
  // ── 光通訊・CPO ──────────────────────────────
  "3081.TWO": "聯亞",
  "3363.TWO": "上詮",
  "4979.TWO": "華星光",
  "6442.TWO": "光聖",
  // ── 面板・其他電子 ───────────────────────────
  "4960.TW": "誠美材",
  "2379.TW": "瑞昱",
  // ── 傳產・航運 ───────────────────────────────
  "1301.TW": "台塑",
  "1303.TW": "南亞",
  "2002.TW": "中鋼",
  "2618.TW": "長榮航",
  "2634.TW": "漢翔",
  // ── 觀光旅遊 ─────────────────────────────────
  "2731.TW": "雄獅",
  "5706.TW": "鳳凰",
  "2748.TW": "雄獅旅遊",
  // ── 金融 ─────────────────────────────────────
  "2886.TW": "兆豐金",
  "2891.TW": "中信金",
  "2892.TW": "第一金",
  // ── ETF ──────────────────────────────────────
  "0050.TW": "元大台灣50",
  // ── 消費 ─────────────────────────────────────
  "2912.TW": "統一超",
  // ── 兆赫 ─────────────────────────────────────
  "2485.TW": "兆赫",
  // ── 其他曾查詢 ───────────────────────────────
  "8358.TWO": "金居",
  "8033.TWO": "雷虎",
  "2886.TW": "兆豐金",
  // ── 指數・ADR・期指 ──────────────────────────
  "^TWII": "加權指數",
  "^TWOII": "櫃買指數",
  "^SOX": "費城半導體指數",
  "^VIX": "VIX恐慌指數",
  "^GSPC": "S&P500",
  "^IXIC": "NASDAQ",
  "^DJI": "道瓊",
  "TSM": "台積電ADR",
  "ASX": "聯發科ADR",
  "MU": "美光(Micron)",
  "SNDK": "SanDisk(NAND)",
  "WDC": "西部數據",
  "AMAT": "應用材料",
  "LRCX": "科林研發",
  "NVDA": "NVIDIA",
  "AMD": "超微",
  "INTC": "英特爾",
  "NQ=F": "那斯達克期指",
  "ES=F": "S&P500期指",
  "CL=F": "原油期貨",
  "GC=F": "黃金期貨",
  "USDTWD=X": "美元台幣匯率",
};

// 解析命令列參數
const args = process.argv.slice(2);
let targetDate = todayYYYYMMDD();
const symbols = [];
for (const a of args) {
  if (a.startsWith("--date=")) {
    targetDate = a.substring(7).replace(/-/g, "");
  } else {
    symbols.push(a);
  }
}
const querySymbols = symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log(`  台股三方混合查詢（現在：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}）`);
console.log(`  目標日期：${targetDate.substring(0,4)}-${targetDate.substring(4,6)}-${targetDate.substring(6,8)}`);
console.log("═══════════════════════════════════════════════════════════════════════\n");

const results = [];
const UNRESOLVED_NAMES = [];   // 追蹤名稱未解析的代號

for (const sym of querySymbols) {
  try {
    const r = await fetchTaiwanStock(sym, yahooFinance, targetDate);
    const name = NAME_MAP[sym] || null;
    const resolvedName = name ?? `⚠️ 未知(${sym})`;  // 未解析時加警告標記
    if (!name) UNRESOLVED_NAMES.push(sym);
    results.push({
      代號: sym,
      名稱: resolvedName,
      來源: r.source,
      資料日: r.dataDate,
      收盤: r.close?.toFixed(2) ?? "N/A",
      漲跌: (r.change >= 0 ? "+" : "") + r.change?.toFixed(2),
      漲跌幅: (r.changePercent >= 0 ? "+" : "") + r.changePercent?.toFixed(2) + "%",
      開盤: r.open?.toFixed(2) ?? "N/A",
      最高: r.high?.toFixed(2) ?? "N/A",
      最低: r.low?.toFixed(2) ?? "N/A",
      前收: r.prevClose?.toFixed(2) ?? "N/A",
      成交量: r.volume?.toLocaleString() ?? "N/A",
    });
  } catch (err) {
    results.push({
      代號: sym,
      名稱: NAME_MAP[sym] ?? "未知",
      來源: "ERROR",
      錯誤: err.message.slice(0, 60),
    });
  }
}

console.table(results);

// JSON 摘要
const jsonOutput = results.reduce((acc, r) => {
  if (r.來源 !== "ERROR") {
    acc[r.代號] = {
      name: r.名稱,
      source: r.來源,
      dataDate: r.資料日,
      price: parseFloat(r.收盤),
      change: parseFloat(r.漲跌),
      changePercent: parseFloat(r.漲跌幅),
      open: parseFloat(r.開盤),
      high: parseFloat(r.最高),
      low: parseFloat(r.最低),
      prevClose: parseFloat(r.前收),
      volume: r.成交量,
    };
  }
  return acc;
}, {});

console.log("\n📋 JSON 摘要：");
console.log(JSON.stringify(jsonOutput, null, 2));

// ── 名稱未解析警告（防止代號錯誤被忽視）──────────────────────────
if (UNRESOLVED_NAMES.length > 0) {
  console.log("\n⚠️  【名稱未解析警告】以下代號不在 NAME_MAP 中，名稱無法確認：");
  UNRESOLVED_NAMES.forEach(s => console.log(`     ❌ ${s} → 名稱顯示為「⚠️ 未知」，請確認代號是否正確後重新查詢`));
  console.log("     → 分析前必須先確認代號正確（R01/R03），嚴禁使用未確認名稱的數據進行推薦");
}

console.log("\n✅ 查詢完成");
console.log("  來源說明：TWSE=證交所官方（上市）｜TPEx=櫃買中心官方（上櫃）｜Yahoo=備援");
console.log("═══════════════════════════════════════════════════════════════════════\n");
