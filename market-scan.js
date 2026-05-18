// market-scan.js — 全市場掃描工具（V0013 規則49結構性缺陷修補）
//
// 解決的問題：
//   1. 固定清單盲點 → 每次掃描 TWSE 全部 1300+ 上市股 + TPEx 1000+ 上櫃股
//   2. 規則49「5日/7日累計漲幅Top10」→ 提供 --days=N 計算累計漲幅
//   3. 族群掃描不完整 → --sector=族群名 掃描完整族群清單
//   4. 規則41-v2過濾 → 自動標記開高走低/開低走高
//   5. 規則24爆量偵測 → 自動計算成交量倍數
//
// 使用方式：
//   node market-scan.js                        # 今日全市場 Top20 漲幅
//   node market-scan.js --date=20260429        # 指定日期
//   node market-scan.js --top=30               # Top30
//   node market-scan.js --days=5               # 計算5日累計（需指定--base或自動找）
//   node market-scan.js --sector=DRAM記憶體    # 族群掃描
//   node market-scan.js --sector=記憶體        # 族群模糊搜尋
//   node market-scan.js --otc                  # 含上櫃
//   node market-scan.js --filter=開低走高      # 只顯示開低走高
//   node market-scan.js --list-sectors         # 列出所有族群

import { SECTORS, listSectors } from "./sectors.js";
import { todayYYYYMMDD, fetchTWSEMonthly } from "./twse.js";

// ── 參數解析 ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let targetDate = todayYYYYMMDD();
let topN = 20;
let days = 1;
let baseDate = null;
let sectorFilter = null;
let includeOTC = false;
let patternFilter = null; // "開低走高" | "開高走低"
let listSectorsFlag = false;
let excludeETF = true;    // 預設排除ETF（00開頭）
let minVol = 500;         // 最低成交量（張，預設500張過濾極低流動性）

for (const a of args) {
  if (a.startsWith("--date="))    targetDate = a.slice(7).replace(/-/g, "");
  else if (a.startsWith("--top="))     topN = parseInt(a.slice(6));
  else if (a.startsWith("--days="))    days = parseInt(a.slice(7));
  else if (a.startsWith("--base="))    baseDate = a.slice(7).replace(/-/g, "");
  else if (a.startsWith("--sector="))  sectorFilter = a.slice(9);
  else if (a.startsWith("--min-vol=")) minVol = parseInt(a.slice(10));
  else if (a === "--otc")              includeOTC = true;
  else if (a === "--include-etf")      excludeETF = false;
  else if (a === "--list-sectors")     listSectorsFlag = true;
  else if (a.startsWith("--filter="))  patternFilter = a.slice(9);
}

// ── 列出族群模式 ────────────────────────────────────────────────────
if (listSectorsFlag) {
  console.log("\n📋 可用族群清單：");
  for (const s of listSectors()) {
    console.log(`  ${s.name.padEnd(16)} (${s.count}檔) — ${s.desc}`);
  }
  console.log("\n使用方式：node market-scan.js --sector=族群名");
  process.exitCode = 0;
}

// ── 工具函數 ────────────────────────────────────────────────────────
const parseNum = (s) => {
  if (!s || s.trim() === "--" || s.trim() === "---") return NaN;
  return parseFloat(String(s).replace(/,/g, "").trim()) || 0;
};

function isETF(code) {
  return /^0[0-9]/.test(code) || code.length > 4;
}

/** 找到最近一個有效交易日（往前找最多10天）*/
async function findValidDate(fromDate, maxTry = 10) {
  let d = new Date(`${fromDate.slice(0,4)}-${fromDate.slice(4,6)}-${fromDate.slice(6,8)}`);
  for (let i = 0; i < maxTry; i++) {
    const yyyymmdd = d.toISOString().slice(0,10).replace(/-/g, "");
    const data = await fetchTWSEAll(yyyymmdd);
    if (data && data.length > 0) return { date: yyyymmdd, data };
    d.setDate(d.getDate() - 1);
  }
  throw new Error("找不到有效交易日");
}

// ── TWSE 全市場單日 ─────────────────────────────────────────────────
async function fetchTWSEAll(date) {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json&date=${date}`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (market-scan research)" },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json.stat !== "OK" || !json.data?.length) return null;
    // fields: 證券代號[0] 證券名稱[1] 成交股數[2] 成交金額[3] 開盤[4] 最高[5] 最低[6] 收盤[7] 漲跌價差[8] 成交筆數[9]
    return json.data.map(row => {
      const code   = row[0].trim();
      const name   = row[1].trim();
      const volume = parseNum(row[2]) / 1000; // 股→張
      const open   = parseNum(row[4]);
      const high   = parseNum(row[5]);
      const low    = parseNum(row[6]);
      const close  = parseNum(row[7]);
      const change = parseNum(row[8]);
      const prevClose = close - change;
      const pct    = prevClose > 0 ? (change / prevClose) * 100 : 0;
      return { code, name, open, high, low, close, change, pct, volume, prevClose, market: "TWSE", date };
    }).filter(r => !isNaN(r.close) && r.close > 0);
  } catch (e) {
    return null;
  }
}

// ── TPEx 全市場單日 ─────────────────────────────────────────────────
async function fetchTPExAll(date) {
  const y = parseInt(date.slice(0,4)) - 1911;
  const rocDate = `${y}/${date.slice(4,6)}/${date.slice(6,8)}`;
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=${rocDate}&se=EW&response=json`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (market-scan research)" },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const rows = json.tables?.[0]?.data;
    if (!rows?.length) return null;
    // fields: 代號[0] 名稱[1] 收盤[2] 漲跌[3] 開盤[4] 最高[5] 最低[6] 成交股數[7]
    return rows.map(row => {
      const code   = row[0].trim();
      const name   = row[1].trim();
      const close  = parseNum(row[2]);
      const change = parseNum(row[3]);
      const open   = parseNum(row[4]);
      const high   = parseNum(row[5]);
      const low    = parseNum(row[6]);
      const volume = parseNum(row[7]) / 1000; // 股→張
      const prevClose = close - change;
      const pct    = prevClose > 0 ? (change / prevClose) * 100 : 0;
      return { code, name, open, high, low, close, change, pct, volume, prevClose, market: "TPEx", date };
    }).filter(r => !isNaN(r.close) && r.close > 0);
  } catch (e) {
    return null;
  }
}

// ── 標記型態 ────────────────────────────────────────────────────────
function getPattern(r) {
  if (!r.open || !r.close) return "—";
  if (r.close > r.open)  return "✅開低走高";
  if (r.close < r.open)  return "❌開高走低";
  return "🟡橫盤";
}

// ── 主程式 ──────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log(`  📡 台股全市場掃描（V0013）`);
console.log(`  目標日期：${targetDate.slice(0,4)}-${targetDate.slice(4,6)}-${targetDate.slice(6,8)}`);
if (sectorFilter) console.log(`  族群篩選：${sectorFilter}`);
if (patternFilter) console.log(`  型態篩選：${patternFilter}`);
console.log("═══════════════════════════════════════════════════════════════════════\n");

// 1. 族群掃描模式
if (sectorFilter) {
  // 找出符合族群名的所有股票
  const matchedSectors = Object.entries(SECTORS).filter(([name, data]) =>
    name.includes(sectorFilter) ||
    sectorFilter.includes(name) ||
    (data.desc && data.desc.includes(sectorFilter))
  );
  if (matchedSectors.length === 0) {
    console.log(`❌ 找不到族群：${sectorFilter}`);
    console.log(`   使用 --list-sectors 查看所有族群\n`);
    process.exitCode = 1; process.exit();
  }

  // 收集所有股票代號
  const allCodes = new Set();
  for (const [, sectorData] of matchedSectors) {
    for (const s of sectorData.stocks) allCodes.add(s);
  }

  // 取得今日數據（TWSE + TPEx 全市場）
  console.log(`📊 掃描族群：${matchedSectors.map(([n]) => n).join(", ")}`);
  console.log(`   共 ${allCodes.size} 檔標的\n`);

  const [twseData, tpexData] = await Promise.all([
    fetchTWSEAll(targetDate),
    includeOTC ? fetchTPExAll(targetDate) : Promise.resolve([]),
  ]);
  const allData = [...(twseData||[]), ...(tpexData||[])];
  const dataMap = new Map(allData.map(r => [r.code, r]));

  const results = [];
  for (const code of allCodes) {
    const cleanCode = code.replace(/\.(TW|TWO)$/, "");
    const r = dataMap.get(cleanCode);
    if (r) {
      results.push({ ...r, symbol: code, pattern: getPattern(r) });
    } else {
      results.push({ code: cleanCode, symbol: code, name: "—", pct: NaN, close: NaN, pattern: "無數據" });
    }
  }
  results.sort((a, b) => (b.pct || -99) - (a.pct || -99));

  console.log(`${"代號".padEnd(8)} ${"名稱".padEnd(10)} ${"收盤".padStart(8)} ${"漲跌%".padStart(8)} ${"型態".padEnd(12)} ${"成交(張)".padStart(10)} 市場`);
  console.log("─".repeat(72));
  for (const r of results) {
    const pctStr = isNaN(r.pct) ? "  N/A " : (r.pct >= 0 ? "+" : "") + r.pct.toFixed(2) + "%";
    const volStr = isNaN(r.volume) ? "      —" : Math.round(r.volume).toLocaleString();
    const closeStr = isNaN(r.close) ? "     N/A" : r.close.toFixed(2);
    console.log(
      `${r.code.padEnd(8)} ${(r.name||"").padEnd(10)} ${closeStr.padStart(8)} ${pctStr.padStart(8)} ${(r.pattern||"—").padEnd(12)} ${volStr.padStart(10)} ${r.market||"—"}`
    );
  }
  console.log("");

// 2. 全市場掃描模式
} else {
// 2a. 取得今日數據
const [twseToday, tpexToday] = await Promise.all([
  fetchTWSEAll(targetDate),
  includeOTC ? fetchTPExAll(targetDate) : Promise.resolve([]),
]);

if (!twseToday || twseToday.length === 0) {
  console.log(`⚠️  ${targetDate} 無交易數據（非交易日？）`);
  process.exit(1);
}

let allToday = [...twseToday, ...(tpexToday||[])];

// 過濾ETF
if (excludeETF) allToday = allToday.filter(r => !isETF(r.code));

// 過濾最低成交量
allToday = allToday.filter(r => r.volume >= minVol);

// 2b. 計算累計漲幅（多日模式）
let cumulativeMap = null; // code → cumPct
if (days > 1) {
  // 往前找 base 日期（days-1個交易日前）
  let d = new Date(`${targetDate.slice(0,4)}-${targetDate.slice(4,6)}-${targetDate.slice(6,8)}`);
  d.setDate(d.getDate() - (days + 2)); // 多給2天buffer應對假日
  const baseDateStr = d.toISOString().slice(0,10).replace(/-/g, "");

  console.log(`📅 計算 ${days} 日累計漲幅（基準日搜尋：${baseDateStr}~）`);
  const baseResult = await findValidDate(baseDateStr);
  console.log(`   基準日確認：${baseResult.date}`);

  const baseMap = new Map(baseResult.data.map(r => [r.code, r.close]));
  cumulativeMap = new Map();
  for (const r of allToday) {
    const baseClose = baseMap.get(r.code);
    if (baseClose && baseClose > 0) {
      const cumPct = (r.close - baseClose) / baseClose * 100;
      cumulativeMap.set(r.code, { cumPct, baseClose });
    }
  }
}

// 2c. 套用型態過濾
if (patternFilter) {
  allToday = allToday.filter(r => {
    const pat = getPattern(r);
    if (patternFilter === "開低走高") return pat === "✅開低走高";
    if (patternFilter === "開高走低") return pat === "❌開高走低";
    return true;
  });
}

// 2d. 排序（多日用累計，單日用漲跌%）
if (days > 1 && cumulativeMap) {
  allToday.sort((a, b) => {
    const ca = cumulativeMap.get(a.code)?.cumPct ?? -999;
    const cb = cumulativeMap.get(b.code)?.cumPct ?? -999;
    return cb - ca;
  });
} else {
  allToday.sort((a, b) => b.pct - a.pct);
}

// 2e. 輸出
const showList = allToday.slice(0, topN);

const modeLabel = days > 1 ? `📈 Top${topN} — ${days}日累計漲幅排行` : `📈 Top${topN} — 今日漲跌幅排行`;
console.log(modeLabel);
console.log(`   總掃描：${allToday.length} 檔（TWSE:${twseToday?.length||0} + TPEx:${tpexToday?.length||0}，ETF/低流動性已過濾）\n`);

const header = days > 1
  ? `${"#".padStart(3)} ${"代號".padEnd(7)} ${"名稱".padEnd(10)} ${"收盤".padStart(8)} ${"今日%".padStart(7)} ${"累計%".padStart(8)} ${"型態".padEnd(12)} ${"成交(張)".padStart(10)} 市場`
  : `${"#".padStart(3)} ${"代號".padEnd(7)} ${"名稱".padEnd(10)} ${"收盤".padStart(8)} ${"漲跌%".padStart(7)} ${"型態".padEnd(12)} ${"成交(張)".padStart(10)} 市場`;
console.log(header);
console.log("─".repeat(days > 1 ? 82 : 74));

for (let i = 0; i < showList.length; i++) {
  const r = showList[i];
  const pat = getPattern(r);
  const pctStr = (r.pct >= 0 ? "+" : "") + r.pct.toFixed(2) + "%";
  const volStr = Math.round(r.volume).toLocaleString();
  const closeStr = r.close.toFixed(2);

  if (days > 1 && cumulativeMap) {
    const cum = cumulativeMap.get(r.code);
    const cumStr = cum ? (cum.cumPct >= 0 ? "+" : "") + cum.cumPct.toFixed(2) + "%" : "  N/A";
    console.log(
      `${String(i+1).padStart(3)} ${r.code.padEnd(7)} ${r.name.padEnd(10)} ${closeStr.padStart(8)} ${pctStr.padStart(7)} ${cumStr.padStart(8)} ${pat.padEnd(12)} ${volStr.padStart(10)} ${r.market}`
    );
  } else {
    console.log(
      `${String(i+1).padStart(3)} ${r.code.padEnd(7)} ${r.name.padEnd(10)} ${closeStr.padStart(8)} ${pctStr.padStart(7)} ${pat.padEnd(12)} ${volStr.padStart(10)} ${r.market}`
    );
  }
}

// 3. 附加：族群強度速報（Top5出現哪些族群）
console.log("\n\n──────────────────────────────────────────────");
console.log("📊 Top10 所屬族群分析（規則49族群強度）");
console.log("──────────────────────────────────────────────");
const reverseMap = buildReverseMap();
for (let i = 0; i < Math.min(10, showList.length); i++) {
  const r = showList[i];
  const symbol = r.market === "TPEx" ? `${r.code}.TWO` : `${r.code}.TW`;
  const sectors = reverseMap[symbol] || ["未分類（需加入族群清單）"];
  const pctStr = (r.pct >= 0 ? "+" : "") + r.pct.toFixed(2) + "%";
  console.log(`  ${String(i+1).padStart(2)}. ${r.code} ${r.name.padEnd(8)} ${pctStr.padStart(7)}  族群：${sectors.join(", ")}`);
}

console.log("\n✅ 掃描完成");
console.log("  使用 --sector=族群名 做族群深度掃描");
console.log("  使用 --days=5 計算5日累計漲幅（規則49）");
console.log("  使用 --otc 加入上櫃股票");
console.log("  使用 --filter=開低走高 篩選強勢型態\n");

} // end else（全市場掃描模式）

// ── 補充：buildReverseMap（從 sectors.js import後在此重建）──────────
function buildReverseMap() {
  const map = {};
  for (const [sectorName, sectorData] of Object.entries(SECTORS)) {
    for (const stock of sectorData.stocks) {
      if (!map[stock]) map[stock] = [];
      map[stock].push(sectorName);
    }
  }
  return map;
}
