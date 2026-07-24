/* ------------------------------------------------------------------
 *  主程式：抓資料 → KPI → 圖表；分頁切換、重新整理、資料檢核、錯誤處理
 * ------------------------------------------------------------------ */
(function () {
  let DATA = null;                   // 解析後的三分頁資料
  let current = CONFIG.DEFAULT_SEGMENT;
  const instances = {};              // ECharts 實例

  const $ = function (s) { return document.querySelector(s); };

  /* ---------- Google 登入（OAuth） ---------- */
  let tokenClient = null;
  let gtoken = null;

  // 7 天內免重新登入：只在 localStorage 存過期戳（不存 access token 本身，因為它只活約 1 小時且存下有 XSS 風險）。
  // 頁面載入或 access token 過期時，若戳未過期就走 GIS 的靜默續發（prompt: ""）拿新 token — 使用者感受上就是免登入。
  const SESSION_KEY = "boxful_authz_expires_at";
  const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  function sessionValid() {
    const v = parseInt(localStorage.getItem(SESSION_KEY) || "0", 10);
    return v > Date.now();
  }
  function markSession() {
    try { localStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_TTL_MS)); } catch (e) { /* localStorage 被禁用時忽略，僅退化為單次登入 */ }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* 同上 */ }
  }

  function initAuth() {
    if (!(window.google && google.accounts && google.accounts.oauth2)) { setTimeout(initAuth, 300); return; }
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.OAUTH_CLIENT_ID,
        // 除了讀 Sheets 之外，還需要 openid email 才能拿到當前登入者的 email 做白名單比對
        scope: "openid email https://www.googleapis.com/auth/spreadsheets.readonly",
        callback: function (resp) {
          if (resp && resp.access_token) {
            gtoken = resp.access_token;
            Sheets.setToken(gtoken);
            markSession();          // 每次成功發 token 就把 7 天視窗往後推
            authorizeAndLoad();
          } else {
            showLogin("登入未完成，請再試一次。");
          }
        },
        error_callback: function () {
          // 靜默續發失敗（例如 Google 側撤銷授權、跨裝置登出）也會走這裡，此時 session 應視為失效
          clearSession();
          showLogin("登入被中斷或未授權，請再試一次。");
        },
      });
    } catch (e) { showLogin("Google 登入初始化失敗：" + (e.message || e)); return; }
    // 有 7 天內未過期的 session 就先靜默續發 access token；沒有才顯示登入畫面
    if (sessionValid()) tokenClient.requestAccessToken({ prompt: "" });
    else showLogin();
  }
  function signIn() {
    if (!tokenClient) { showLogin("Google 登入尚未就緒，請稍候再按一次。"); return; }
    tokenClient.requestAccessToken({ prompt: gtoken ? "" : "consent" });
  }

  // 401：access token 過期。7 天視窗還有效就靜默續發，否則要求重新登入。
  function handleAuthError() {
    gtoken = null;
    if (sessionValid() && tokenClient) tokenClient.requestAccessToken({ prompt: "" });
    else { clearSession(); showLogin("登入已過期，請重新登入。"); }
  }
  function showLogin(msg) {
    const node = document.createElement("div");
    node.className = "state";
    node.innerHTML =
      "<h2>請以公司 Google 帳號登入</h2>" +
      "<p>本儀表板僅供已授權的 BOXFUL 帳號檢視。" + (msg ? "<br/><b style='color:var(--danger)'>" + msg + "</b>" : "") + "</p>" +
      '<p style="margin-top:14px"><button class="ai-btn" id="signin-btn" style="font-size:14px;padding:9px 18px">使用 Google 登入</button></p>';
    showState(node);
    const b = document.getElementById("signin-btn");
    if (b) b.onclick = signIn;
  }

  /* ---------- 授權檢查 + 載入 ---------- */
  // 登入取得 token 後：先拿使用者 email → 讀「權限管理」sheet 白名單 → 比對；通過才進入 load()
  function authorizeAndLoad() {
    if (!gtoken) { showLogin(); return; }
    setLoading(true);
    showState(null);
    Promise.all([Sheets.fetchUserEmail(), Sheets.fetchAllowedEmails()])
      .then(function (arr) {
        const email = arr[0];
        const allowed = arr[1];
        if (allowed && !allowed.has(email)) {
          setLoading(false);
          showUnauthorized(email);
          return;
        }
        load();
      })
      .catch(function (err) {
        setLoading(false);
        if (err && err.code === 401) { handleAuthError(); }
        else { showError(err); }
      });
  }

  function load() {
    if (!gtoken) { showLogin(); return; }
    setLoading(true);
    showState(null);
    Sheets.fetchAll()
      .then(function (parsed) {
        DATA = parsed;
        stampUpdated();
        render();
      })
      .catch(function (err) {
        if (err && err.code === 401) { handleAuthError(); }
        else { showError(err); }
      })
      .then(function () { setLoading(false); });
  }

  function setLoading(on) {
    const b = $("#refresh");
    b.disabled = on;
    b.classList.toggle("loading", on);
  }
  function stampUpdated() {
    $("#updated").textContent = "資料更新時間：" + new Date().toLocaleString("zh-TW");
  }

  /* ---------- 分頁 ---------- */
  function buildTabs() {
    const box = $("#tabs");
    box.innerHTML = "";
    CONFIG.SEGMENTS.forEach(function (seg) {
      const btn = document.createElement("button");
      btn.textContent = seg.label;
      btn.setAttribute("aria-selected", seg.key === current);
      btn.onclick = function () {
        if (current === seg.key) return;
        current = seg.key;
        buildTabs();
        render();
      };
      box.appendChild(btn);
    });
  }

  /* ---------- 重點摘要（規則式，固定格式） ---------- */
  function renderSummary(d, seg) {
    const bullets = Charts.summary(d, seg);
    const box = $("#summary");
    if (!bullets.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    box.innerHTML =
      '<div class="sum-head"><span class="sum-badge">重點摘要</span>' +
      '<span class="sum-sub">依「' + seg.label + '」最新月自動產生</span></div>' +
      "<ul>" + bullets.map(function (b) { return "<li>" + b + "</li>"; }).join("") + "</ul>";
  }

  /* ---------- 本期需說明（異常清單） ---------- */
  function renderExceptions(d, seg) {
    const flags = Charts.anomalies(d);
    const box = $("#exceptions");
    if (!flags.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const icon = { up: "▲", down: "▼", flip: "⚠" };
    const cls = { up: "exc-up", down: "exc-down", flip: "exc-flip" };
    const rows = flags.map(function (f) {
      return "<tr>" +
        "<td class='num'>" + f.month + "</td>" +
        "<td>" + f.name + "</td>" +
        "<td class='num'>" + Charts.money(f.value) + "</td>" +
        "<td class='num'>" + Charts.money(f.base) + "</td>" +
        "<td class='" + cls[f.dir] + "'>" + icon[f.dir] + " " + f.rel + "</td>" +
        "<td>" + f.note + "</td></tr>";
    }).join("");
    box.innerHTML =
      '<div class="sum-head"><span class="sum-badge" style="background:#C0392B">本期需說明</span>' +
      '<span class="sum-sub">「' + seg.label + '」自動偵測 · 偏離近 6 月基準 ±' +
      Math.round((CONFIG.ANOMALY.relThreshold || 0.4) * 100) + "% 以上，依金額排序</span></div>" +
      '<div class="exc-wrap"><table class="exc">' +
      "<thead><tr><th>月份</th><th>科目</th><th>當月值</th><th>近期基準</th><th>偏離</th><th>判讀</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>";
  }

  /* ---------- KPI ---------- */
  function last(v) { return (v && v.values && v.values.length) ? v.values[v.values.length - 1] : null; }
  function renderKpis(d, seg) {
    const rev = last(d.revenue);
    const gp = last(d.gp);
    const cogs = last(d.cogs);
    const gpm = (rev ? gp / rev * 100 : null);
    // 最新月的累計 EBITDA%
    const months = d.months;
    const curYear = Math.max.apply(null, months.map(function (m) { return m.year; }));
    const curMonths = months.filter(function (m) { return m.year === curYear; });
    const lastM = curMonths.length ? Math.max.apply(null, curMonths.map(function (m) { return m.month; })) : null;
    let ebpct = null;
    if (d.ebitda && d.revenue && lastM) {
      let ce = 0;
      let cr = 0;
      months.forEach(function (m, i) {
        if (m.year === curYear && m.month <= lastM) { ce += d.ebitda.values[i]; cr += d.revenue.values[i]; }
      });
      ebpct = cr ? ce / cr * 100 : null;
    }
    const ord = seg.hasOrders ? last(d.orders) : null;
    const lastLabel = d.months.length ? d.months[d.months.length - 1].label : "";

    const cards = [
      { label: "最新月收入", val: Charts.money(rev), sub: lastLabel },
      { label: "毛利率", val: Charts.pct(gpm), sub: "本月毛利 " + Charts.money(gp) },
      { label: "累計 EBITDA%", val: Charts.pct(ebpct), sub: curYear + " 年初至今" },
      seg.hasOrders
        ? { label: "最新月訂單", val: ord == null ? "—" : Charts.money(ord) + " 筆", sub: lastLabel }
        : { label: "最新月成本", val: Charts.money(cogs), sub: lastLabel },
    ];
    $("#kpis").innerHTML = cards.map(function (c) {
      return '<div class="kpi"><div class="k-label">' + c.label +
        '</div><div class="k-val num">' + c.val +
        '</div><div class="k-sub num">' + c.sub + "</div></div>";
    }).join("");
  }

  /* ---------- 圖表 ---------- */
  function draw(id, option) {
    const el = document.getElementById(id);
    if (!instances[id]) instances[id] = echarts.init(el, null, { renderer: "canvas" });
    instances[id].setOption(option, true);
  }
  function show(cardId, chartId, visible, optionFn) {
    $("#" + cardId).classList.toggle("hidden", !visible);
    if (visible) draw(chartId, optionFn());
  }
  function render() {
    if (!DATA) return;
    const seg = CONFIG.SEGMENTS.filter(function (s) { return s.key === current; })[0];
    const d = DATA[current];
    const detail = current !== "total";
    const isTotal = current === "total";
    const hasOrders = seg.hasOrders && d.orders;

    renderKpis(d, seg);
    renderSummary(d, seg);
    renderExceptions(d, seg);

    // 概況
    draw("chart-pnl", Charts.pnlOption(d, seg.label));
    show("card-revcost", "chart-revcost", detail, function () { return Charts.revCostOption(d, seg.label, seg.hasOrders); });
    show("card-gpexp", "chart-gpexp", detail, function () { return Charts.gpExpOption(d, seg.label); });

    // 結構與效率分析
    show("card-rates", "chart-rates", true, function () { return Charts.ratesOption(d, seg.label); });
    show("card-perorder", "chart-perorder", !!hasOrders, function () { return Charts.perOrderOption(d, seg.label); });
    const hasWaaship = d.incomeItems.some(function (it) { return /waaship/i.test(it.name); });
    show("card-waaship", "chart-waaship", hasWaaship, function () { return Charts.waashipOption(d, seg.label); });
    show("card-expratio", "chart-expratio", true, function () { return Charts.expenseRatioOption(d, seg.label); });
    show("card-costmix", "chart-costmix", true, function () { return Charts.costMix100Option(d, seg.label); });
    show("card-contrib", "chart-contrib", isTotal, function () { return Charts.contributionOption(DATA); });

    renderCheck(d, seg);
    setTimeout(function () { Object.keys(instances).forEach(function (k) { instances[k].resize(); }); }, 30);
  }

  /* ---------- 資料檢核面板 ---------- */
  function renderCheck(d, seg) {
    function row(label, metric, isOrders) {
      const found = !!metric;
      const name = found ? metric.name : "—";
      const lastVal = found ? Charts.money(metric.values[metric.values.length - 1]) : "—";
      const ok = found && !(isOrders && metric.values.every(function (x) { return x === 0; }));
      const status = ok ? '<span class="ok">✓ 已定位</span>'
        : (isOrders ? '<span class="warn">未找到（本分頁不畫）</span>'
                    : '<span class="warn">✗ 未找到</span>');
      return "<tr><td>" + label + "</td><td>" + name + '</td><td class="num">' + lastVal + "</td><td>" + status + "</td></tr>";
    }
    const rows = [
      row("收入 (Total Income)", d.revenue),
      row("成本 (Total Cost of Sales)", d.cogs),
      row("毛利 (Gross Profit)", d.gp),
      row("費用 (Total Operating Expenses)", d.opex),
      row("EBITDA", d.ebitda),
    ];
    if (seg.hasOrders) rows.push(row("訂單數 (orders)", d.orders, true));

    const monthSpan = d.months.length ? (d.months[0].label + " – " + d.months[d.months.length - 1].label) : "—";
    $("#check-body").innerHTML =
      '<p style="color:var(--muted);margin:2px 0 12px">月份範圍：<b class="num">' + monthSpan +
      "</b>（共 " + d.months.length + " 個月）　成本明細 " + d.cogsItems.length +
      " 項、費用明細 " + d.opexItems.length + " 項（圖表取前 " + CONFIG.TOP_N + " 大）</p>" +
      '<table><thead><tr><th>指標</th><th>對應到的列</th><th>最新月值</th><th>狀態</th></tr></thead><tbody>' +
      rows.join("") + "</tbody></table>";
  }

  /* ---------- 狀態 / 錯誤 ---------- */
  function showState(node) {
    const s = $("#state");
    if (!node) { s.classList.add("hidden"); $("#dash").classList.remove("hidden"); return; }
    s.innerHTML = ""; s.appendChild(node); s.classList.remove("hidden"); $("#dash").classList.add("hidden");
  }
  function showError(err) {
    const msg = (err && err.message) ? err.message : String(err);
    const node = document.createElement("div");
    node.className = "state";
    node.innerHTML =
      "<h2>抓不到資料</h2><p>" + msg + "</p>" +
      "<p>請依序檢查：</p><ul>" +
      "<li>登入的 Google 帳號<b>有這份試算表的檢視權限</b>（向擁有者索取檢視權）。</li>" +
      "<li>GCP 專案已<b>啟用 Google Sheets API</b>。</li>" +
      "<li><code>config.js</code> 的 <code>OAUTH_CLIENT_ID</code> 與 <code>SPREADSHEET_ID</code> 正確。</li>" +
      "<li>OAuth 用戶端的「已授權 JavaScript 來源」有包含目前這個網址來源（例如 <code>https://你的帳號.github.io</code> 或 <code>http://localhost:8000</code>）。</li>" +
      "</ul>" +
      '<p style="margin-top:12px"><button class="ai-btn" id="relogin-btn">重新登入</button></p>';
    showState(node);
    const b = document.getElementById("relogin-btn");
    if (b) b.onclick = signIn;
  }

  // 通過 Google 登入、但 email 不在「權限管理」sheet 白名單上時的畫面
  function showUnauthorized(email) {
    const node = document.createElement("div");
    node.className = "state";
    node.innerHTML =
      "<h2>此帳號未獲授權</h2>" +
      "<p>目前登入帳號：<b>" + (email || "(未知)") + "</b></p>" +
      "<p>此帳號未列於試算表的「" + (CONFIG.AUTHZ_SHEET_TITLE || "權限管理") + "」白名單，無法檢視儀表板。" +
      "若你認為這是誤判，請聯繫試算表擁有者將此 email 加入白名單。</p>" +
      '<p style="margin-top:12px"><button class="ai-btn" id="switch-btn">改用其他帳號登入</button></p>';
    showState(node);
    const b = document.getElementById("switch-btn");
    if (b) b.onclick = function () {
      // 主動切換帳號：清掉 7 天視窗，強制彈 consent 讓使用者挑另一個帳號
      clearSession();
      gtoken = null;
      if (tokenClient) tokenClient.requestAccessToken({ prompt: "consent" });
      else showLogin();
    };
  }

  /* ---------- 啟動 ---------- */
  window.addEventListener("resize", function () {
    Object.keys(instances).forEach(function (k) { instances[k].resize(); });
  });
  document.addEventListener("DOMContentLoaded", function () {
    buildTabs();
    // 重新整理走完整流程（也會重新驗白名單），這樣白名單被更新後按 refresh 就會立刻套用
    $("#refresh").onclick = authorizeAndLoad;
    initAuth();
  });
})();
