/* ------------------------------------------------------------------
 *  資料層：用 OAuth 權杖直接讀 Google Sheets API v4,
 *  並用「文字標籤」定位各關鍵列（不寫死列號，插/刪列也不會壞）
 * ------------------------------------------------------------------ */
window.Sheets = (function () {

  /* ---------- 小工具 ---------- */

  // 把一格值轉成數字：已是數字直接用；字串去逗號/空白；"-" 或空白視為 0
  function num(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    let s = String(v).trim();
    if (s === "" || s === "-" || s === "–" || s === "\\-") return 0;
    s = s.replace(/,/g, "").replace(/\s/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  // 取一列的「科目名稱」：以第 3 欄(index 2)為主，退而求其次
  function label(row) {
    const cands = [row[2], row[1], row[3], row[0]];
    for (let i = 0; i < cands.length; i++) {
      const s = (cands[i] === null || cands[i] === undefined) ? "" : String(cands[i]).trim();
      if (s) return s;
    }
    return "";
  }

  // 從一格判斷是否為「年-月」，回傳 {year, month} 或 null
  // 支援：Sheets API 序列數字日期、ISO 字串、M/D/YYYY 字串、Date 物件
  function toYearMonth(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") {
      // Google/Excel 序列日期（自 1899-12-30 起算的天數）；只認 ~2019–2031 的合理範圍
      if (v >= 43800 && v <= 48300) {
        const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
        return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
      }
      return null;   // 一般數字（如年份 2025、金額）不是日期
    }
    const s = String(v);
    let m = s.match(/^(\d{4})-(\d{2})-\d{2}/);            // ISO: 2025-01-31...
    if (m) return { year: +m[1], month: +m[2] };
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);         // M/D/YYYY
    if (m) return { year: +m[3], month: +m[1] };
    if (v instanceof Date && !isNaN(v)) return { year: v.getFullYear(), month: v.getMonth() + 1 };
    return null;
  }

  /* ---------- 解析單一張表 ---------- */

  function parseSheet(grid) {
    if (!grid || !grid.length) throw new Error("空的表");

    // 1) 找「月份列」：只在表頭區（前 20 列）找含最多日期的那一列，避免與下方金額列混淆
    let monthRowIdx = -1;
    let best = 0;
    const scanTo = Math.min(grid.length, 20);
    for (let r = 0; r < scanTo; r++) {
      let cnt = 0;
      for (let c = 0; c < grid[r].length; c++) if (toYearMonth(grid[r][c])) cnt++;
      if (cnt > best) { best = cnt; monthRowIdx = r; }
    }
    if (monthRowIdx < 0 || best < 3) throw new Error("找不到月份列");

    // months：依欄位順序記錄 {col, year, month, label:'2025/01'}
    const months = [];
    const mr = grid[monthRowIdx];
    for (let c = 0; c < mr.length; c++) {
      const ym = toYearMonth(mr[c]);
      if (ym) months.push({
        col: c, year: ym.year, month: ym.month,
        label: ym.year + "/" + ("0" + ym.month).slice(-2),
      });
    }

    // 2) 依標籤找「某一列」，回傳對齊 months 的數值陣列
    function metricRow(re, opts) {
      const options = opts || {};
      for (let r = 0; r < grid.length; r++) {
        const lb = label(grid[r]);
        if (!lb) continue;
        if (options.exclude && options.exclude.test(lb)) continue;
        if (re.test(lb)) {
          const vals = months.map(function (mo) { return num(grid[r][mo.col]); });
          if (options.requireData && vals.every(function (x) { return x === 0; })) continue;
          return { name: lb, rowIndex: r, values: vals };
        }
      }
      return null;
    }

    // 3) 取某區段的明細列（start 與 end 兩個標籤列「之間」，且有資料）
    function sectionItems(startRe, endRe) {
      let start = -1;
      let end = -1;
      for (let r = 0; r < grid.length; r++) {
        const lb = label(grid[r]);
        if (start < 0 && startRe.test(lb)) { start = r; continue; }
        if (start >= 0 && endRe.test(lb)) { end = r; break; }
      }
      const items = [];
      if (start < 0 || end < 0) return items;
      for (let r2 = start + 1; r2 < end; r2++) {
        const lb2 = label(grid[r2]);
        if (!lb2) continue;
        const vals = months.map(function (mo) { return num(grid[r2][mo.col]); });
        const total = vals.reduce(function (a, b) { return a + b; }, 0);
        if (total !== 0) items.push({ name: lb2, values: vals, total: total });
      }
      return items;
    }

    // 關鍵彙總列（標籤定位）
    const revenue = metricRow(/^total income$/i);
    const cogs    = metricRow(/^total cost of sales$/i);
    const gp      = metricRow(/^gross profit$/i);
    const opex    = metricRow(/^total operating expenses$/i);
    // EBITDA：容忍 EBITDA / EBIDA 兩種拼法，排除「margin / %」
    const ebitda  = metricRow(/ebi.?t?da/i, { exclude: /margin|%/i, requireData: false });
    // 訂單數（2B）：以 orders 標籤定位；找不到就回 null（前端自動不畫）
    const orders  = metricRow(/^\s*orders?\b/i, { requireData: true });

    // 明細區段
    const incomeItems = sectionItems(/^income$/i, /^total income$/i);
    const cogsItems   = sectionItems(/less cost of sales/i, /^total cost of sales$/i);
    const opexItems   = sectionItems(/less operating expenses/i, /^total operating expenses$/i);

    return {
      months: months,
      revenue: revenue, cogs: cogs, gp: gp, opex: opex, ebitda: ebitda, orders: orders,
      incomeItems: incomeItems, cogsItems: cogsItems, opexItems: opexItems,
    };
  }

  /* ---------- 傳輸：OAuth 存取權杖 + 直接讀 Google Sheets API v4 ---------- */

  let TOKEN = null;
  function setToken(t) { TOKEN = t; }

  function apiGet(url) {
    return fetch(url, { headers: { Authorization: "Bearer " + TOKEN } }).then(function (res) {
      if (res.status === 401) { const e = new Error("登入已過期，請重新登入。"); e.code = 401; throw e; }
      if (res.status === 403) { const e = new Error("你的帳號沒有這份試算表的檢視權限，請向擁有者索取。"); e.code = 403; throw e; }
      if (!res.ok) return res.text().then(function (t) { throw new Error("Sheets API " + res.status + "：" + t.slice(0, 200)); });
      return res.json();
    });
  }

  /* ---------- 對外：抓取並解析全部（依分頁順序 → total / b2b / b2c） ---------- */

  function fetchAll() {
    if (!TOKEN) return Promise.reject(new Error("尚未登入 Google 帳號。"));
    const id = CONFIG.SPREADSHEET_ID;
    const metaUrl = "https://sheets.googleapis.com/v4/spreadsheets/" + id + "?fields=sheets.properties(title,index)";
    return apiGet(metaUrl).then(function (meta) {
      const titles = (meta.sheets || []).sort(function (a, b) { return a.properties.index - b.properties.index; })
        .map(function (s) { return s.properties.title; }).slice(0, 3);
      if (titles.length < 3) throw new Error("這份試算表分頁不足 3 個。");
      const ranges = titles.map(function (t) {
        return "ranges=" + encodeURIComponent("'" + t.replace(/'/g, "''") + "'");
      }).join("&");
      const vurl = "https://sheets.googleapis.com/v4/spreadsheets/" + id +
        "/values:batchGet?" + ranges + "&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS";
      return apiGet(vurl).then(function (res) {
        const parsed = {};
        CONFIG.SEGMENTS.forEach(function (seg, i) {
          const vr = res.valueRanges && res.valueRanges[i];
          parsed[seg.key] = parseSheet(vr && vr.values ? vr.values : []);
        });
        return parsed;
      });
    });
  }

  return { fetchAll: fetchAll, setToken: setToken, _parseSheet: parseSheet, _num: num };
})();
