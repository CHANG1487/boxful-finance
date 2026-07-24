/* ------------------------------------------------------------------
 *  BOXFUL 損益儀表板 — 設定檔
 *  這是唯一需要你日後維護的檔案。改資料來源、Token、顯示項目都在這裡。
 * ------------------------------------------------------------------ */
window.CONFIG = {
  // 你的 Apps Script 網頁應用程式網址（/exec 結尾）
  ENDPOINT: "https://script.google.com/macros/s/AKfycbxVTGHFhRdcjMrQ0ZPngn7AjFDVjSITincrMbypLVPHtVQWQBv0De3lK0zXZ7iDLST_zg/exec",

  // 與 Apps Script 內設定相同的 Token
  TOKEN: "fKqCpryftfVPYn9x1bcBLTgZJcGkjijd",

  // 成本／費用堆疊圖只顯示前幾大項目，其餘併為「Others」
  TOP_N: 6,

  // 圖三「費用明細」要排除的科目（以名稱開頭比對）。EBITDA 不看折舊攤銷，故排除。
  EXCLUDE_EXPENSE_PREFIX: ["Depreciation", "Amortization"],

  // Apps Script 回傳的三張表對應的鍵（依分頁順序：第1張=合計、第2張=2B、第3張=2C）
  SEGMENTS: [
    { key: "total", label: "合計", hasOrders: false },
    { key: "b2b",   label: "2B",   hasOrders: true  },
    { key: "b2c",   label: "2C",   hasOrders: false },
  ],

  // 預設開啟的分頁
  DEFAULT_SEGMENT: "total",

  // 「本期需說明」異常偵測門檻
  ANOMALY: {
    relThreshold: 0.4,   // 偏離近期基準 ±40% 以上才算異常
    absFloor: 30000,     // 且金額變動至少 3 萬（濾掉零碎小項）
    baselineWindow: 6,   // 以前 6 個月中位數為基準
    topN: 8,             // 最多列出前 8 大
  },
};
