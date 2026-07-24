/* ------------------------------------------------------------------
 *  資料層：向 Apps Script 抓三張表，並用「文字標籤」定位各關鍵列
 *  （不寫死列號，你日後插/刪列也不會壞）
 * ------------------------------------------------------------------ */
window.Sheets = (function () {

  /* ---------- 小工具 ---------- */

  // 把一格值轉成數字：已是數字直接用；字串去逗號/空白；"-" 或空白視為 0
  function num(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    var s = String(v).trim();
    if (s === "" || s === "-" || s === "–" || s === "\\-") return 0;
    s = s.replace(/,/g, "").replace(/\s/g, "");
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  // 取一列的「科目名稱」：以第 3 欄(index 2)為主，退而求其次
  function label(row) {
    var cands = [row[2], row[1], row[3], row[0]];
    for (var i = 0; i < cands.length; i++) {
      var s = (cands[i] === null || cands[i] === undefined) ? "" : String(cands[i]).trim();
      if (s) return s;
    }
    return "";
  }

  // 從一格判斷是否為「年-月」，回傳 {year, month} 或 null
  // 支援 Apps Script 傳回的 ISO 字串（月底日期，時區位移不影響年月）與 M/D/YYYY 字串、Date
  function toYearMonth(v) {
    if (v === null || v === undefined || v === "") return null;
    var s = String(v);
    var m = s.match(/^(\d{4})-(\d{2})-\d{2}/);            // ISO: 2025-01-31...
    if (m) return { year: +m[1], month: +m[2] };
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);         // M/D/YYYY
    if (m) return { year: +m[3], month: +m[1] };
    if (v instanceof Date && !isNaN(v)) return { year: v.getFullYear(), month: v.getMonth() + 1 };
    return null;
  }

  /* ---------- 解析單一張表 ---------- */

  function parseSheet(grid) {
    if (!grid || !grid.length) throw new Error("空的表");

    // 1) 找「月份列」：整張表中，含最多可解析日期的那一列
    var monthRowIdx = -1, best = 0;
    for (var r = 0; r < grid.length; r++) {
      var cnt = 0;
      for (var c = 0; c < grid[r].length; c++) if (toYearMonth(grid[r][c])) cnt++;
      if (cnt > best) { best = cnt; monthRowIdx = r; }
    }
    if (monthRowIdx < 0) throw new Error("找不到月份列");

    // months：依欄位順序記錄 {col, year, month, label:'2025/01'}
    var months = [];
    var mr = grid[monthRowIdx];
    for (var c = 0; c < mr.length; c++) {
      var ym = toYearMonth(mr[c]);
      if (ym) months.push({
        col: c, year: ym.year, month: ym.month,
        label: ym.year + "/" + ("0" + ym.month).slice(-2),
      });
    }

    // 2) 依標籤找「某一列」，回傳對齊 months 的數值陣列
    function metricRow(re, opts) {
      opts = opts || {};
      for (var r = 0; r < grid.length; r++) {
        var lb = label(grid[r]);
        if (!lb) continue;
        if (opts.exclude && opts.exclude.test(lb)) continue;
        if (re.test(lb)) {
          var vals = months.map(function (mo) { return num(grid[r][mo.col]); });
          if (opts.requireData && vals.every(function (x) { return x === 0; })) continue;
          return { name: lb, rowIndex: r, values: vals };
        }
      }
      return null;
    }

    // 3) 取某區段的明細列（start 與 end 兩個標籤列「之間」，且有資料）
    function sectionItems(startRe, endRe) {
      var start = -1, end = -1;
      for (var r = 0; r < grid.length; r++) {
        var lb = label(grid[r]);
        if (start < 0 && startRe.test(lb)) { start = r; continue; }
        if (start >= 0 && endRe.test(lb)) { end = r; break; }
      }
      var items = [];
      if (start < 0 || end < 0) return items;
      for (var r2 = start + 1; r2 < end; r2++) {
        var lb2 = label(grid[r2]);
        if (!lb2) continue;
        var vals = months.map(function (mo) { return num(grid[r2][mo.col]); });
        var total = vals.reduce(function (a, b) { return a + b; }, 0);
        if (total !== 0) items.push({ name: lb2, values: vals, total: total });
      }
      return items;
    }

    // 關鍵彙總列（標籤定位）
    var revenue = metricRow(/^total income$/i);
    var cogs    = metricRow(/^total cost of sales$/i);
    var gp      = metricRow(/^gross profit$/i);
    var opex    = metricRow(/^total operating expenses$/i);
    // EBITDA：容忍 EBITDA / EBIDA 兩種拼法，排除「margin / %」
    var ebitda  = metricRow(/ebi.?t?da/i, { exclude: /margin|%/i, requireData: false });
    // 訂單數（2B）：以 orders 標籤定位；找不到就回 null（前端自動不畫）
    var orders  = metricRow(/^\s*orders?\b/i, { requireData: true });

    // 明細區段
    var incomeItems = sectionItems(/^income$/i, /^total income$/i);
    var cogsItems   = sectionItems(/less cost of sales/i, /^total cost of sales$/i);
    var opexItems   = sectionItems(/less operating expenses/i, /^total operating expenses$/i);

    return {
      months: months,
      revenue: revenue, cogs: cogs, gp: gp, opex: opex, ebitda: ebitda, orders: orders,
      incomeItems: incomeItems, cogsItems: cogsItems, opexItems: opexItems,
    };
  }

  /* ---------- 傳輸：JSONP（用 <script> 載入，避開公司 Workspace 的跨網域/登入導向限制） ---------- */

  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var cb = "__boxful_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      var s = document.createElement("script");
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("連線逾時。常見原因：未登入公司 Google 帳號、或 Apps Script 存取權限不對。"));
      }, timeoutMs || 20000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cb] = function (data) { cleanup(); resolve(data); };
      s.onerror = function () { cleanup(); reject(new Error("載入失敗（Failed to load）——請確認 Apps Script 網址正確且已部署新版本。")); };
      s.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + cb;
      document.body.appendChild(s);
    });
  }

  /* ---------- 對外：抓取並解析全部 ---------- */

  function fetchAll() {
    var url = CONFIG.ENDPOINT + "?token=" + encodeURIComponent(CONFIG.TOKEN) + "&t=" + Date.now();
    return jsonp(url).then(function (data) {
      if (data && data.error) throw new Error("Apps Script 回傳：" + data.error + "（多半是 Token 不符）");
      var parsed = {};
      CONFIG.SEGMENTS.forEach(function (seg) {
        if (!data[seg.key]) throw new Error("回傳缺少分頁：" + seg.key);
        parsed[seg.key] = parseSheet(data[seg.key]);
      });
      return parsed;
    });
  }

  return { fetchAll: fetchAll, _parseSheet: parseSheet, _num: num };
})();
