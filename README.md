# 📈 ST 台股追蹤儀表板

個人台股短線持倉追蹤系統，搭配 ST 台股分析模型 V0014補4。

## 🚀 功能

- **即時持倉顯示**：市值、損益、停損線進度條
- **警示系統**：R02 停損、R24 出貨型、R35 開高走低 自動偵測
- **全球指標**：SOX / VIX / NQ期指 / TSM ADR / MU / SNDK / NVDA
- **觀察清單**：台積電、聯電、南亞科、華邦電、旺宏
- **GitHub Actions 自動排程**：每個交易日下午 2:45（台灣時間）自動更新

## 📁 結構

```
├── docs/               # GitHub Pages 靜態網站
│   ├── index.html      # Dashboard 主頁
│   └── data/
│       └── latest.json # 自動更新的股價數據
├── scripts/
│   └── fetch-data.js   # GitHub Actions 執行的抓價腳本
├── portfolio.json       # 🔧 庫存設定（自行維護）
├── twse.js             # TWSE / TPEx API 封裝
└── query.js            # CLI 查詢工具
```

## ⚙️ 修改持倉

編輯 `portfolio.json`：

```json
{
  "positions": [
    {
      "symbol": "6770.TW",
      "name": "力積電",
      "shares": 4000,
      "costPerShare": 60.85,
      "stopLoss": 57.81,
      "alertStopLoss": 60.71,
      "notes": "備注說明"
    }
  ]
}
```

## 🖥️ 本地執行

```bash
npm install
node scripts/fetch-data.js   # 抓取數據並更新 docs/data/latest.json
```

## 資料來源

- 上市股（.TW）：TWSE 台灣證券交易所官方 API
- 上櫃股（.TWO）：TPEx 櫃買中心官方 API  
- 指數 / ADR / 期指：Yahoo Finance
