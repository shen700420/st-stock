// 台股官方數據源 — TWSE（上市）+ TPEx（上櫃）
// 解決 Yahoo Finance API 對台股個股收盤後延遲 2-3 天的問題
// V0009 規則 33 實作：三方混合架構（Yahoo + TWSE + TPEx）

/**
 * 將西元年 YYYYMMDD 轉換為民國年 (ROC) YYY/MM/DD
 * 2026/04/20 → "115/04/20"
 */
function toROCDate(yyyymmdd) {
  const y = parseInt(yyyymmdd.substring(0, 4), 10);
  const m = yyyymmdd.substring(4, 6);
  const d = yyyymmdd.substring(6, 8);
  return `${y - 1911}/${m}/${d}`;
}

/**
 * 今日日期 YYYYMMDD（台北時區）
 */
export function todayYYYYMMDD() {
  const now = new Date();
  const tw = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const y = tw.getFullYear();
  const m = String(tw.getMonth() + 1).padStart(2, "0");
  const d = String(tw.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * 從 TWSE STOCK_DAY 查詢上市個股某月日線
 * 回傳該月最後一筆交易日（通常為今日或最近一日）
 * 端點範例：
 *   https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20260420&stockNo=2330
 */
export async function fetchTWSE(stockNo, date = todayYYYYMMDD()) {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${stockNo}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (stock-api research)",
      "Accept": "application/json",
    },
  });
  if (!resp.ok) throw new Error(`TWSE HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.stat !== "OK") throw new Error(`TWSE stat=${json.stat}`);
  if (!json.data || json.data.length === 0) throw new Error("TWSE no data");

  // 篩選 <= 目標日期的最後一筆
  const targetROC = toROCDate(date);
  let latest = null;
  for (const row of json.data) {
    if (row[0] <= targetROC) latest = row;
  }
  if (!latest) latest = json.data[json.data.length - 1];

  // 欄位順序：日期 / 成交股數 / 成交金額 / 開盤 / 最高 / 最低 / 收盤 / 漲跌 / 成交筆數
  const parseNum = (s) => parseFloat(String(s).replace(/,/g, "")) || 0;
  const close = parseNum(latest[6]);
  const open = parseNum(latest[3]);
  const high = parseNum(latest[4]);
  const low = parseNum(latest[5]);
  const volume = parseNum(latest[1]); // 股數
  // 漲跌可能是 "X(漲X)" 或直接數字
  const changeRaw = String(latest[7]).replace(/,/g, "");
  const change = parseFloat(changeRaw) || 0;
  const prevClose = close - change;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  // ROC 日期轉回西元
  const rocParts = latest[0].split("/");
  const gregYear = parseInt(rocParts[0], 10) + 1911;
  const dataDate = `${gregYear}-${rocParts[1]}-${rocParts[2]}`;

  return {
    source: "TWSE",
    stockNo,
    dataDate,
    open,
    high,
    low,
    close,
    prevClose,
    change,
    changePercent,
    volume,
    volumeShares: volume,
  };
}

/**
 * 從 TPEx 查詢上櫃個股日線
 * TPEx 新版 API（2024 後端點）：
 *   https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=4979&date=YYYY/MM/DD&response=json
 * 若新端點失敗，嘗試舊端點：
 *   https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=YYY/MM&stkno=4979
 */
export async function fetchTPEx(stockNo, date = todayYYYYMMDD()) {
  // 嘗試新版 API
  const gregDate = `${date.substring(0, 4)}/${date.substring(4, 6)}/${date.substring(6, 8)}`;
  const newUrl = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${stockNo}&date=${gregDate}&response=json`;

  try {
    const resp = await fetch(newUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (stock-api research)",
        "Accept": "application/json",
      },
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json.tables?.[0]?.data && json.tables[0].data.length > 0) {
        return parseTPExNew(json.tables[0].data, stockNo, date);
      }
    }
  } catch (e) {
    // fall through to legacy
  }

  // 降級：舊版月線 API
  const rocYM = toROCDate(date).substring(0, 6); // "115/04"
  const legacyUrl = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${rocYM}&stkno=${stockNo}`;
  const resp2 = await fetch(legacyUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (stock-api research)" },
  });
  if (!resp2.ok) throw new Error(`TPEx HTTP ${resp2.status}`);
  const json2 = await resp2.json();
  if (!json2.aaData || json2.aaData.length === 0) throw new Error("TPEx no data");
  return parseTPExLegacy(json2.aaData, stockNo, date);
}

function parseTPExNew(rows, stockNo, date) {
  const targetROC = toROCDate(date);
  let latest = null;
  for (const row of rows) {
    if (row[0] <= targetROC) latest = row;
  }
  if (!latest) latest = rows[rows.length - 1];
  const parseNum = (s) => parseFloat(String(s).replace(/,/g, "")) || 0;
  // 新版欄位：[日期, 成交股數, 成交金額, 開盤, 最高, 最低, 收盤, 漲跌, ...]
  const close = parseNum(latest[6]);
  const open = parseNum(latest[3]);
  const high = parseNum(latest[4]);
  const low = parseNum(latest[5]);
  const change = parseFloat(String(latest[7]).replace(/,/g, "")) || 0;
  const prevClose = close - change;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const rocParts = latest[0].split("/");
  const dataDate = `${parseInt(rocParts[0], 10) + 1911}-${rocParts[1]}-${rocParts[2]}`;
  return {
    source: "TPEx",
    stockNo,
    dataDate,
    open, high, low, close, prevClose, change, changePercent,
    volume: parseNum(latest[1]),
  };
}

function parseTPExLegacy(rows, stockNo, date) {
  const targetROC = toROCDate(date);
  let latest = null;
  for (const row of rows) {
    if (row[0] <= targetROC) latest = row;
  }
  if (!latest) latest = rows[rows.length - 1];
  const parseNum = (s) => parseFloat(String(s).replace(/,/g, "")) || 0;
  // 舊版欄位：[日期, 成交股數(千股), 成交金額(千元), 開盤, 最高, 最低, 收盤, 漲跌, 成交筆數]
  const close = parseNum(latest[6]);
  const open = parseNum(latest[3]);
  const high = parseNum(latest[4]);
  const low = parseNum(latest[5]);
  const change = parseFloat(String(latest[7]).replace(/,/g, "")) || 0;
  const prevClose = close - change;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const rocParts = latest[0].split("/");
  const dataDate = `${parseInt(rocParts[0], 10) + 1911}-${rocParts[1]}-${rocParts[2]}`;
  return {
    source: "TPEx",
    stockNo,
    dataDate,
    open, high, low, close, prevClose, change, changePercent,
    volume: parseNum(latest[1]) * 1000, // 千股轉股
  };
}

/**
 * 取得個股整月日線資料（用於計算多日累計漲幅）
 * 回傳格式：[{ dataDate: "2026-04-22", open, high, low, close, change, changePercent, volume }, ...]
 * 按日期升序排列
 */
export async function fetchTWSEMonthly(stockNo, date = todayYYYYMMDD()) {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${stockNo}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (stock-api research)", "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`TWSE HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.stat !== "OK" || !json.data?.length) throw new Error("TWSE no data");
  const parseNum = (s) => parseFloat(String(s).replace(/,/g, "")) || 0;
  return json.data.map(row => {
    const close = parseNum(row[6]);
    const change = parseFloat(String(row[7]).replace(/,/g, "")) || 0;
    const prevClose = close - change;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
    const rocParts = row[0].split("/");
    const dataDate = `${parseInt(rocParts[0], 10) + 1911}-${rocParts[1]}-${rocParts[2]}`;
    return {
      dataDate,
      open: parseNum(row[3]), high: parseNum(row[4]), low: parseNum(row[5]),
      close, change, changePercent, volume: parseNum(row[1]) / 1000, // 股→張
    };
  }).sort((a, b) => a.dataDate.localeCompare(b.dataDate));
}

/**
 * 統一入口：台股個股三方混合查詢
 * 1. 上市 .TW → TWSE 優先，失敗 fallback Yahoo
 * 2. 上櫃 .TWO → TPEx 優先，失敗 fallback Yahoo
 * 3. 其他（^TWII / TSM / AAPL） → 直接 Yahoo
 */
export async function fetchTaiwanStock(symbol, yahooFinance, date = todayYYYYMMDD()) {
  const isTWSE = symbol.endsWith(".TW") && !symbol.startsWith("^");
  const isTPEx = symbol.endsWith(".TWO");
  const stockNo = symbol.replace(/\.(TW|TWO)$/, "");

  if (isTWSE) {
    try {
      return await fetchTWSE(stockNo, date);
    } catch (e) {
      // fallback to Yahoo
      const q = await yahooFinance.quote(symbol);
      return yahooToCommon(q, symbol, "Yahoo(fallback)");
    }
  }
  if (isTPEx) {
    try {
      return await fetchTPEx(stockNo, date);
    } catch (e) {
      const q = await yahooFinance.quote(symbol);
      return yahooToCommon(q, symbol, "Yahoo(fallback)");
    }
  }
  // 其他 → Yahoo
  const q = await yahooFinance.quote(symbol);
  return yahooToCommon(q, symbol, "Yahoo");
}

function yahooToCommon(q, symbol, source) {
  return {
    source,
    stockNo: symbol,
    dataDate: q.regularMarketTime
      ? new Date(q.regularMarketTime).toISOString().substring(0, 10)
      : "N/A",
    open: q.regularMarketOpen ?? 0,
    high: q.regularMarketDayHigh ?? 0,
    low: q.regularMarketDayLow ?? 0,
    close: q.regularMarketPrice ?? 0,
    prevClose: q.regularMarketPreviousClose ?? 0,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    volume: q.regularMarketVolume ?? 0,
    marketState: q.marketState,
  };
}
