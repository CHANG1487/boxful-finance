/* ------------------------------------------------------------------
 *  圖表層：用 ECharts 產生三種圖的設定
 * ------------------------------------------------------------------ */
window.Charts = (function () {

  /* ---------- 配色 ---------- */
  const C = {
    revenue: "#E23B3B",   // 收入（線）
    cogs:    "#8FB8E8",   // 成本（線）
    gp:      "#B0559B",   // 毛利（虛線）
    expense: "#3E9B4F",   // 費用（線）
    ebitdaNow:  "#12A594",// 今年累計 EBITDA%（柱）
    ebitdaPrev: "#C9E5DF",// 去年累計 EBITDA%（柱）
    gpLine:  "#E23B3B",   // 圖三毛利描邊
    ink: "#16232A", muted: "#64757C", grid: "#EceFf0",
  };
  // 成本／費用堆疊：飽和分類盤（前6）＋灰(Others)
  const CAT = ["#12A594", "#4C78C9", "#E4A93C", "#E2683B", "#8E6FC9", "#5AA9E6"];
  const OTHERS = "#B8BFC7";
  // 收入堆疊：柔和色（與成本區隔）
  const CATSOFT = ["#BFE3DC", "#CDE0F5", "#F3E1B8", "#F6D2C2", "#DFD3F0", "#CFE6F7"];

  // 圖三費用要排除的科目（開頭比對，例如 Depreciation - …）
  function excludedExpense(name) {
    const arr = (window.CONFIG && CONFIG.EXCLUDE_EXPENSE_PREFIX) || [];
    const lname = String(name).toLowerCase();
    return arr.some(function (p) { return lname.indexOf(String(p).toLowerCase()) === 0; });
  }

  /* ---------- 格式 ---------- */
  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return Math.round(n).toLocaleString("en-US");
  }
  function pct(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return n.toFixed(1) + "%";
  }

  /* ---------- 通用小工具 ---------- */
  // 依 months 對齊的數值陣列，加總「某年、月<=m」
  function sumUpTo(values, months, year, m) {
    let s = 0;
    for (let i = 0; i < months.length; i++)
      if (months[i].year === year && months[i].month <= m) s += (values[i] || 0);
    return s;
  }
  // Top-N：依 total 由大到小取 N，其餘併 Others（逐月加總）
  function topN(items, monthsLen, n) {
    const sorted = items.slice().sort(function (a, b) { return b.total - a.total; });
    const top = sorted.slice(0, n);
    const rest = sorted.slice(n);
    if (rest.length) {
      const o = new Array(monthsLen).fill(0);
      rest.forEach(function (it) { it.values.forEach(function (v, i) { o[i] += v; }); });
      top.push({ name: "Others", values: o, total: o.reduce(function (a, b) { return a + b; }, 0) });
    }
    return top;
  }

  /* ================================================================
   *  圖一：損益概況（雙軸組合）
   *  線＝今年按月 收入/成本/毛利/費用；柱＝今年 & 去年 累計 EBITDA%
   * ================================================================ */
  function pnlOption(d, segLabel) {
    const months = d.months;
    const years = months.map(function (m) { return m.year; });
    const curYear = Math.max.apply(null, years);
    const prevYear = curYear - 1;
    const cur = months.filter(function (m) { return m.year === curYear; })
                      .sort(function (a, b) { return a.month - b.month; });

    const x = cur.map(function (m) { return m.label; });
    const rev = [];
    const cogs = [];
    const gp = [];
    const exp = [];
    const ebNow = [];
    const ebPrev = [];
    const R = d.revenue ? d.revenue.values : null;
    const E = d.ebitda ? d.ebitda.values : null;

    cur.forEach(function (mo) {
      const idx = months.indexOf(mo);
      rev.push(d.revenue ? d.revenue.values[idx] : null);
      cogs.push(d.cogs ? d.cogs.values[idx] : null);
      gp.push(d.gp ? d.gp.values[idx] : null);
      exp.push(d.opex ? d.opex.values[idx] : null);
      // 累計 EBITDA%
      if (R && E) {
        const cumE = sumUpTo(E, months, curYear, mo.month);
        const cumR = sumUpTo(R, months, curYear, mo.month);
        ebNow.push(cumR ? +(cumE / cumR * 100).toFixed(2) : null);
        const cumEp = sumUpTo(E, months, prevYear, mo.month);
        const cumRp = sumUpTo(R, months, prevYear, mo.month);
        ebPrev.push(cumRp ? +(cumEp / cumRp * 100).toFixed(2) : null);
      } else { ebNow.push(null); ebPrev.push(null); }
    });

    const series = [
      { name: "累計 EBITDA% (" + curYear + ")", type: "bar", yAxisIndex: 1, data: ebNow,
        itemStyle: { color: C.ebitdaNow, borderRadius: [3, 3, 0, 0] }, barGap: "0%", barCategoryGap: "38%",
        label: { show: true, position: "top", formatter: function (p) { return pct(p.value); },
                 color: C.ink, fontWeight: 600, fontSize: 11 } },
      { name: "累計 EBITDA% (" + prevYear + ")", type: "bar", yAxisIndex: 1, data: ebPrev,
        itemStyle: { color: C.ebitdaPrev, borderRadius: [3, 3, 0, 0] } },
      { name: "收入", type: "line", data: rev, smooth: false, symbol: "circle", symbolSize: 5,
        lineStyle: { width: 3, color: C.revenue }, itemStyle: { color: C.revenue },
        label: { show: true, position: "top", formatter: function (p) { return money(p.value); },
                 color: C.revenue, fontSize: 10, fontWeight: 600 } },
      { name: "成本", type: "line", data: cogs, symbol: "none",
        lineStyle: { width: 2, color: C.cogs }, itemStyle: { color: C.cogs } },
      { name: "毛利", type: "line", data: gp, symbol: "none",
        lineStyle: { width: 2.5, color: C.gp, type: "dashed" }, itemStyle: { color: C.gp } },
      { name: "費用", type: "line", data: exp, symbol: "none",
        lineStyle: { width: 2, color: C.expense }, itemStyle: { color: C.expense } },
    ];

    return {
      title: { text: curYear + " 損益概況 — " + segLabel, left: 8, top: 6,
               textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 70, right: 62, top: 74, bottom: 40 },
      legend: { top: 34, left: 8, itemGap: 14, textStyle: { color: C.muted, fontSize: 12 } },
      tooltip: { trigger: "axis",
        valueFormatter: undefined,
        formatter: function (ps) {
          let s = ps[0].axisValue + "<br/>";
          ps.forEach(function (p) {
            const v = (p.seriesName.indexOf("EBITDA%") >= 0) ? pct(p.value) : money(p.value);
            s += p.marker + p.seriesName + "：<b>" + v + "</b><br/>";
          });
          return s;
        } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, fontWeight: 600 } },
      yAxis: [
        { type: "value", name: "金額", nameTextStyle: { color: C.muted },
          axisLabel: { color: C.muted, formatter: function (v) { return (v / 1e6) + "M"; } },
          splitLine: { lineStyle: { color: C.grid } } },
        { type: "value", name: "EBITDA %", nameTextStyle: { color: C.muted },
          axisLabel: { color: C.muted, formatter: "{value}%" }, splitLine: { show: false } },
      ],
      series: series,
    };
  }

  /* ================================================================
   *  圖二：收入 / 成本 / 訂單（2B、2C）
   *  收入＝堆疊面積；成本＝Top6 堆疊柱；訂單＝右軸折線
   * ================================================================ */
  function revCostOption(d, segLabel, hasOrders) {
    const x = d.months.map(function (m) { return m.label; });
    const series = [];

    // 收入（堆疊面積，柔和色）
    d.incomeItems.forEach(function (it, i) {
      series.push({
        name: it.name, type: "line", stack: "rev", areaStyle: { opacity: 0.55 },
        symbol: "none", lineStyle: { width: 0 },
        itemStyle: { color: CATSOFT[i % CATSOFT.length] }, data: it.values, z: 1,
      });
    });

    // 成本（Top6 堆疊柱，飽和色）
    const costs = topN(d.cogsItems, d.months.length, CONFIG.TOP_N);
    costs.forEach(function (it, i) {
      series.push({
        name: it.name, type: "bar", stack: "cost", barWidth: "55%",
        itemStyle: { color: it.name === "Others" ? OTHERS : CAT[i % CAT.length] },
        data: it.values, z: 2,
      });
    });

    // 訂單（右軸折線，2B 才有）
    const yAxes = [{ type: "value", name: "金額", nameTextStyle: { color: C.muted },
                     axisLabel: { color: C.muted, formatter: function (v) { return (v / 1e6) + "M"; } },
                     splitLine: { lineStyle: { color: C.grid } } }];
    if (hasOrders && d.orders) {
      yAxes.push({ type: "value", name: "訂單數", nameTextStyle: { color: C.muted },
                   axisLabel: { color: C.muted }, splitLine: { show: false } });
      series.push({ name: "訂單數", type: "line", yAxisIndex: 1, data: d.orders.values,
                    symbol: "circle", symbolSize: 6, lineStyle: { width: 3, color: C.ink },
                    itemStyle: { color: C.ink }, z: 3 });
    }

    return {
      title: { text: "收入 / 成本概況 — " + segLabel, left: 8, top: 6,
               textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 70, right: hasOrders ? 62 : 24, top: 90, bottom: 60 },
      legend: { top: 34, left: 8, width: "92%", itemGap: 10, type: "scroll",
                textStyle: { color: C.muted, fontSize: 11 } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
        formatter: function (ps) {
          let s = ps[0].axisValue + "<br/>";
          ps.forEach(function (p) {
            const v = (p.seriesName === "訂單數") ? money(p.value) + " 筆" : money(p.value);
            s += p.marker + p.seriesName + "：<b>" + v + "</b><br/>";
          });
          return s;
        } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 40, fontSize: 11 } },
      yAxis: yAxes,
      series: series,
    };
  }

  /* ================================================================
   *  圖三：毛利 / 費用（2B、2C）
   *  費用＝Top6 堆疊柱；毛利＝紅色描邊（面積線）
   * ================================================================ */
  function gpExpOption(d, segLabel) {
    const x = d.months.map(function (m) { return m.label; });
    const series = [];

    const exps = topN(d.opexItems.filter(function (it) { return !excludedExpense(it.name); }),
                      d.months.length, CONFIG.TOP_N);
    exps.forEach(function (it, i) {
      series.push({
        name: it.name, type: "bar", stack: "exp", barWidth: "55%",
        itemStyle: { color: it.name === "Others" ? OTHERS : CAT[i % CAT.length] },
        data: it.values, z: 2,
      });
    });

    if (d.gp) {
      series.push({
        name: "毛利", type: "line", data: d.gp.values, symbol: "none", z: 3,
        lineStyle: { width: 3, color: C.gpLine },
        areaStyle: { color: C.gpLine, opacity: 0.10 },
      });
    }

    return {
      title: { text: "毛利 / 費用概況 — " + segLabel, left: 8, top: 6,
               textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 70, right: 24, top: 90, bottom: 60 },
      legend: { top: 34, left: 8, width: "92%", itemGap: 10, type: "scroll",
                textStyle: { color: C.muted, fontSize: 11 } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
        valueFormatter: function (v) { return money(v); } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 40, fontSize: 11 } },
      yAxis: { type: "value", name: "金額", nameTextStyle: { color: C.muted },
               axisLabel: { color: C.muted, formatter: function (v) { return (v / 1e6) + "M"; } },
               splitLine: { lineStyle: { color: C.grid } } },
      series: series,
    };
  }

  /* ================================================================
   *  進階圖表（財務分析）
   * ================================================================ */

  // 共用：百分比折線圖骨架
  function baseLinePct(title, x, lines) {
    return {
      title: { text: title, left: 8, top: 6, textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 56, right: 24, top: 64, bottom: 54 },
      legend: { top: 34, left: 8, textStyle: { color: C.muted, fontSize: 12 } },
      tooltip: { trigger: "axis", valueFormatter: function (v) { return v == null ? "-" : v + "%"; } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 40, fontSize: 11 } },
      yAxis: { type: "value", axisLabel: { color: C.muted, formatter: "{value}%" },
               splitLine: { lineStyle: { color: C.grid } } },
      series: lines.map(function (l) {
        return { name: l.name, type: "line", data: l.data, symbol: "circle", symbolSize: 4, connectNulls: true,
                 lineStyle: { width: 2.5, color: l.color, type: l.dash ? "dashed" : "solid" }, itemStyle: { color: l.color } };
      }),
    };
  }

  // (1) 三率趨勢：毛利率 / 營業利益率 / EBITDA 率
  function ratesOption(d, segLabel) {
    const x = d.months.map(function (m) { return m.label; });
    const rev = d.revenue ? d.revenue.values : [];
    const gp = d.gp ? d.gp.values : [];
    const op = d.opex ? d.opex.values : [];
    const eb = d.ebitda ? d.ebitda.values : null;
    const gpM = [];
    const opM = [];
    const ebM = [];
    d.months.forEach(function (m, i) {
      const r = rev[i] || 0;
      gpM.push(r ? +((gp[i] || 0) / r * 100).toFixed(1) : null);
      opM.push(r ? +(((gp[i] || 0) - (op[i] || 0)) / r * 100).toFixed(1) : null);
      ebM.push((eb && r) ? +(eb[i] / r * 100).toFixed(1) : null);
    });
    return baseLinePct("三率趨勢 — " + segLabel, x, [
      { name: "毛利率", data: gpM, color: C.gp },
      { name: "營業利益率", data: opM, color: C.ebitdaNow },
      { name: "EBITDA 率", data: ebM, color: C.ink },
    ]);
  }

  // 依名稱在明細清單中找某一項的逐月值（找不到回全 0）
  function itemValues(items, re, len) {
    const it = items.filter(function (x) { return re.test(x.name); })[0];
    return it ? it.values : new Array(len).fill(0);
  }

  // (2) 每單經濟效益（僅 2B）：收入/單、成本/單、毛利/單
  //     收入排除 Waaship + Other Rental；成本排除 Costs - Waaship
  function perOrderOption(d, segLabel) {
    const len = d.months.length;
    const waaRev = itemValues(d.incomeItems, /waaship/i, len);
    const otherRent = itemValues(d.incomeItems, /other\s*rental/i, len);
    const waaCost = itemValues(d.cogsItems, /waaship/i, len);
    const idxs = [];
    d.months.forEach(function (m, i) { if (d.orders && d.orders.values[i] > 0) idxs.push(i); });
    const x = idxs.map(function (i) { return d.months[i].label; });
    function adjRev(i) { return (d.revenue ? d.revenue.values[i] || 0 : 0) - (waaRev[i] || 0) - (otherRent[i] || 0); }
    function adjCost(i) { return (d.cogs ? d.cogs.values[i] || 0 : 0) - (waaCost[i] || 0); }
    const rev = idxs.map(function (i) { const o = d.orders.values[i]; return o ? Math.round(adjRev(i) / o) : null; });
    const cost = idxs.map(function (i) { const o = d.orders.values[i]; return o ? Math.round(adjCost(i) / o) : null; });
    const gp = idxs.map(function (i) { const o = d.orders.values[i]; return o ? Math.round((adjRev(i) - adjCost(i)) / o) : null; });
    return {
      title: { text: "每單經濟效益 — " + segLabel + "（金額 / 訂單，不含 Waaship・Other Rental）", left: 8, top: 6,
               textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 64, right: 24, top: 64, bottom: 54 },
      legend: { top: 34, left: 8, textStyle: { color: C.muted, fontSize: 12 } },
      tooltip: { trigger: "axis", valueFormatter: function (v) { return money(v) + " / 單"; } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 40, fontSize: 11 } },
      yAxis: { type: "value", axisLabel: { color: C.muted, formatter: function (v) { return money(v); } },
               splitLine: { lineStyle: { color: C.grid } } },
      series: [
        { name: "收入/單", type: "line", data: rev, symbol: "circle", symbolSize: 4,
          lineStyle: { width: 3, color: C.revenue }, itemStyle: { color: C.revenue } },
        { name: "成本/單", type: "line", data: cost, symbol: "none",
          lineStyle: { width: 2, color: C.cogs }, itemStyle: { color: C.cogs } },
        { name: "毛利/單", type: "line", data: gp, symbol: "circle", symbolSize: 4,
          lineStyle: { width: 3, color: C.ebitdaNow }, itemStyle: { color: C.ebitdaNow } },
      ],
    };
  }

  // (2b) Waaship 專項檢視：收入(Waaship)、成本(Costs - Waaship)、毛利
  function waashipOption(d, segLabel) {
    const len = d.months.length;
    const x = d.months.map(function (m) { return m.label; });
    const rev = itemValues(d.incomeItems, /waaship/i, len);
    const cost = itemValues(d.cogsItems, /waaship/i, len);
    const gp = x.map(function (_, i) { return (rev[i] || 0) - (cost[i] || 0); });
    return {
      title: { text: "Waaship 收入 / 成本 / 毛利 — " + segLabel, left: 8, top: 6,
               textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 64, right: 24, top: 64, bottom: 54 },
      legend: { top: 34, left: 8, textStyle: { color: C.muted, fontSize: 12 } },
      tooltip: { trigger: "axis", valueFormatter: function (v) { return money(v); } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 40, fontSize: 11 } },
      yAxis: { type: "value", axisLabel: { color: C.muted, formatter: function (v) { return money(v); } },
               splitLine: { lineStyle: { color: C.grid } } },
      series: [
        { name: "收入", type: "line", data: rev, symbol: "circle", symbolSize: 4,
          lineStyle: { width: 3, color: C.revenue }, itemStyle: { color: C.revenue } },
        { name: "成本", type: "line", data: cost, symbol: "none",
          lineStyle: { width: 2, color: C.cogs }, itemStyle: { color: C.cogs } },
        { name: "毛利", type: "line", data: gp, symbol: "circle", symbolSize: 4,
          lineStyle: { width: 3, color: C.ebitdaNow }, areaStyle: { color: C.ebitdaNow, opacity: 0.10 },
          itemStyle: { color: C.ebitdaNow } },
      ],
    };
  }

  // (4) 費用率趨勢：費用金額(柱) + 費用/收入(線, 右軸)
  function expenseRatioOption(d, segLabel) {
    const x = d.months.map(function (m) { return m.label; });
    const rev = d.revenue ? d.revenue.values : [];
    const op = d.opex ? d.opex.values : [];
    const ratio = d.months.map(function (m, i) { return rev[i] ? +((op[i] || 0) / rev[i] * 100).toFixed(1) : null; });
    return {
      title: { text: "費用率趨勢 — " + segLabel, left: 8, top: 6,
               textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 64, right: 58, top: 64, bottom: 54 },
      legend: { top: 34, left: 8, textStyle: { color: C.muted, fontSize: 12 } },
      tooltip: { trigger: "axis",
        formatter: function (ps) {
          let s = ps[0].axisValue + "<br/>";
          ps.forEach(function (p) {
            const v = p.seriesName === "費用率" ? (p.value == null ? "-" : p.value + "%") : money(p.value);
            s += p.marker + p.seriesName + "：<b>" + v + "</b><br/>";
          });
          return s;
        } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 40, fontSize: 11 } },
      yAxis: [
        { type: "value", name: "費用金額", nameTextStyle: { color: C.muted },
          axisLabel: { color: C.muted, formatter: function (v) { return (v / 1e6) + "M"; } },
          splitLine: { lineStyle: { color: C.grid } } },
        { type: "value", name: "費用率", nameTextStyle: { color: C.muted },
          axisLabel: { color: C.muted, formatter: "{value}%" }, splitLine: { show: false } },
      ],
      series: [
        { name: "費用金額", type: "bar", data: op, barWidth: "50%",
          itemStyle: { color: "#DCE6E4", borderRadius: [3, 3, 0, 0] } },
        { name: "費用率", type: "line", yAxisIndex: 1, data: ratio, symbol: "circle", symbolSize: 5,
          lineStyle: { width: 3, color: C.expense }, itemStyle: { color: C.expense } },
      ],
    };
  }

  // (5) 成本結構 100% 堆疊（Top6 + Others 的每月佔比）
  function costMix100Option(d, segLabel) {
    const x = d.months.map(function (m) { return m.label; });
    const items = topN(d.cogsItems, d.months.length, CONFIG.TOP_N);
    const totals = d.months.map(function (m, i) {
      return items.reduce(function (a, it) { return a + (it.values[i] || 0); }, 0);
    });
    const series = items.map(function (it, k) {
      return {
        name: it.name, type: "bar", stack: "mix", barWidth: "60%",
        itemStyle: { color: it.name === "Others" ? OTHERS : CAT[k % CAT.length] },
        data: it.values.map(function (v, i) { return totals[i] ? +(v / totals[i] * 100).toFixed(1) : 0; }),
      };
    });
    return {
      title: { text: "成本結構（佔比）— " + segLabel, left: 8, top: 6,
               textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 48, right: 24, top: 90, bottom: 54 },
      legend: { top: 34, left: 8, width: "92%", type: "scroll", itemGap: 10,
                textStyle: { color: C.muted, fontSize: 11 } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
        valueFormatter: function (v) { return v + "%"; } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 40, fontSize: 11 } },
      yAxis: { type: "value", max: 100, axisLabel: { color: C.muted, formatter: "{value}%" },
               splitLine: { lineStyle: { color: C.grid } } },
      series: series,
    };
  }

  // (6) EBITDA 變化橋接（去年 YTD → 今年 YTD，逐項拆解）
  function ebitdaBridgeOption(d, segLabel) {
    const months = d.months;
    const curYear = Math.max.apply(null, months.map(function (m) { return m.year; }));
    const prevYear = curYear - 1;
    const curMon = Math.max.apply(null, months.filter(function (m) { return m.year === curYear; })
                                              .map(function (m) { return m.month; }));
    function ytd(vals, year) { return sumUpTo(vals, months, year, curMon); }
    const rev = d.revenue ? d.revenue.values : [];
    const cogs = d.cogs ? d.cogs.values : [];
    const op = d.opex ? d.opex.values : [];
    const eb = d.ebitda ? d.ebitda.values : [];
    // 折舊逐月加總 → 營業費用(不含折舊)
    const dep = months.map(function (m, i) {
      return d.opexItems.reduce(function (a, it) { return a + (excludedExpense(it.name) ? (it.values[i] || 0) : 0); }, 0);
    });
    const opX = months.map(function (m, i) { return (op[i] || 0) - dep[i]; });

    const prevE = ytd(eb, prevYear);
    const curE = ytd(eb, curYear);
    const dRev = ytd(rev, curYear) - ytd(rev, prevYear);
    const dCOGS = ytd(cogs, curYear) - ytd(cogs, prevYear);
    const dOpX = ytd(opX, curYear) - ytd(opX, prevYear);
    const residual = (curE - prevE) - (dRev - dCOGS - dOpX);

    const steps = [
      { name: prevYear + " YTD", type: "total", val: prevE },
      { name: "Δ收入", val: dRev },
      { name: "Δ成本", val: -dCOGS },
      { name: "Δ費用(不含折舊)", val: -dOpX },
      { name: "其他", val: residual },
      { name: curYear + " YTD", type: "total", val: curE },
    ];
    const cats = [];
    const ph = [];
    const inc = [];
    const dec = [];
    const tot = [];
    let running = 0;
    steps.forEach(function (s) {
      cats.push(s.name);
      if (s.type === "total") { ph.push(0); inc.push(null); dec.push(null); tot.push(Math.round(s.val)); running = s.val; }
      else if (s.val >= 0) { ph.push(Math.round(running)); inc.push(Math.round(s.val)); dec.push(null); tot.push(null); running += s.val; }
      else { running += s.val; ph.push(Math.round(running)); inc.push(null); dec.push(Math.round(-s.val)); tot.push(null); }
    });

    return {
      title: { text: "EBITDA 變化橋接 — " + segLabel + "（" + prevYear + " YTD → " + curYear + " YTD）",
               left: 8, top: 6, textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 64, right: 24, top: 56, bottom: 54 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
        formatter: function (ps) {
          const p = ps.find(function (q) { return q.value != null && q.seriesName !== "基準"; }) ||
                    ps.find(function (q) { return q.seriesName === "基準" && q.value != null; });
          return ps[0].axisValue + "：<b>" + (p ? money(p.value) : "-") + "</b>";
        } },
      xAxis: { type: "category", data: cats, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 20, fontSize: 11, interval: 0 } },
      yAxis: { type: "value", axisLabel: { color: C.muted, formatter: function (v) { return (v / 1e6) + "M"; } },
               splitLine: { lineStyle: { color: C.grid } } },
      series: [
        { name: "基準", type: "bar", stack: "wf", data: ph, itemStyle: { color: "transparent" }, silent: true },
        { name: "改善", type: "bar", stack: "wf", data: inc, itemStyle: { color: C.expense, borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: "top", color: C.expense, fontSize: 10, formatter: function (p) { return p.value ? "+" + money(p.value) : ""; } } },
        { name: "惡化", type: "bar", stack: "wf", data: dec, itemStyle: { color: C.revenue, borderRadius: [0, 0, 3, 3] },
          label: { show: true, position: "bottom", color: C.revenue, fontSize: 10, formatter: function (p) { return p.value ? "−" + money(p.value) : ""; } } },
        { name: "YTD", type: "bar", stack: "wf", data: tot, itemStyle: { color: "#8892A0", borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: "top", color: C.ink, fontSize: 10, fontWeight: 700, formatter: function (p) { return p.value ? money(p.value) : ""; } } },
      ],
    };
  }

  // (3) 2B vs 2C 貢獻對比（放在「合計」分頁）
  function contributionOption(DATA) {
    const t = DATA.total;
    const b = DATA.b2b;
    const c = DATA.b2c;
    const x = t.months.map(function (m) { return m.label; });
    function mapBy(seg, metricKey) {
      const o = {};
      if (!seg[metricKey]) return o;
      seg.months.forEach(function (m, i) { o[m.label] = seg[metricKey].values[i]; });
      return o;
    }
    const rB = mapBy(b, "revenue");
    const rC = mapBy(c, "revenue");
    const gB = mapBy(b, "gp");
    const gC = mapBy(c, "gp");
    const revShareB = [];
    const revShareC = [];
    const gpContribB = [];
    x.forEach(function (lb) {
      const rb = rB[lb] || 0;
      const rc = rC[lb] || 0;
      const rt = rb + rc;
      revShareB.push(rt ? +(rb / rt * 100).toFixed(1) : null);
      revShareC.push(rt ? +(rc / rt * 100).toFixed(1) : null);
      const gb = gB[lb] || 0;
      const gc = gC[lb] || 0;
      const gt = gb + gc;
      gpContribB.push(gt ? +(gb / gt * 100).toFixed(1) : null);
    });
    return {
      title: { text: "2B vs 2C 貢獻對比（收入佔比 & 毛利貢獻）", left: 8, top: 6,
               textStyle: { fontSize: 15, fontWeight: 700, color: C.ink } },
      grid: { left: 48, right: 24, top: 64, bottom: 54 },
      legend: { top: 34, left: 8, textStyle: { color: C.muted, fontSize: 12 } },
      tooltip: { trigger: "axis", valueFormatter: function (v) { return v == null ? "-" : v + "%"; } },
      xAxis: { type: "category", data: x, axisLine: { lineStyle: { color: "#C7CFD2" } },
               axisLabel: { color: C.muted, rotate: 40, fontSize: 11 } },
      yAxis: { type: "value", max: 100, axisLabel: { color: C.muted, formatter: "{value}%" },
               splitLine: { lineStyle: { color: C.grid } } },
      series: [
        { name: "2B 收入佔比", type: "bar", stack: "rev", data: revShareB, barWidth: "55%", itemStyle: { color: "#4C78C9" } },
        { name: "2C 收入佔比", type: "bar", stack: "rev", data: revShareC, itemStyle: { color: "#CDE0F5" } },
        { name: "2B 毛利貢獻佔比", type: "line", data: gpContribB, symbol: "circle", symbolSize: 5,
          lineStyle: { width: 3, color: C.ebitdaNow }, itemStyle: { color: C.ebitdaNow } },
      ],
    };
  }

  /* ================================================================
   *  異常偵測：掃各科目在當年度各月是否偏離近期基準（給「需說明」清單）
   * ================================================================ */
  function median(arr) {
    const a = arr.filter(function (x) { return x != null; }).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function anomalies(d) {
    const cfg = (window.CONFIG && CONFIG.ANOMALY) || {};
    const rel = cfg.relThreshold || 0.4;
    const floor = cfg.absFloor || 30000;
    const win = cfg.baselineWindow || 6;
    const topN = cfg.topN || 8;
    const months = d.months;
    if (!months.length) return [];
    const curYear = Math.max.apply(null, months.map(function (m) { return m.year; }));

    const groups = [];
    if (d.revenue) groups.push({ name: "收入（合計）", values: d.revenue.values });
    if (d.gp) groups.push({ name: "毛利（合計）", values: d.gp.values });
    d.cogsItems.forEach(function (it) { groups.push({ name: it.name, values: it.values }); });
    d.opexItems.forEach(function (it) { groups.push({ name: it.name, values: it.values }); });

    const flags = [];
    groups.forEach(function (g) {
      months.forEach(function (mo, i) {
        if (mo.year !== curYear) return;               // 只標當年度
        const v = g.values[i];
        if (v == null) return;
        const hist = [];
        for (let j = Math.max(0, i - win); j < i; j++) if (g.values[j] != null) hist.push(g.values[j]);
        if (hist.length < 2) return;
        const base = median(hist);
        const dev = v - base;
        const signFlip = (base > 0 && v < 0);
        let note;
        let dir;
        let relStr;
        if (signFlip) {
          note = "數值轉為負值，疑似計提沖回／重分類"; dir = "flip"; relStr = "轉負";
        } else if (base === 0) {
          if (Math.abs(v) < floor) return;
          note = "由 0 出現（新增或重分類）"; dir = "up"; relStr = "—";
        } else {
          const r = dev / Math.abs(base);
          if (Math.abs(dev) < floor || Math.abs(r) < rel) return;
          if (r < 0) { note = "異常偏低（較近期基準 " + Math.round(r * 100) + "%）"; dir = "down"; }
          else { note = "異常偏高（+" + Math.round(r * 100) + "%）"; dir = "up"; }
          relStr = (r >= 0 ? "+" : "") + Math.round(r * 100) + "%";
        }
        flags.push({ month: mo.label, name: g.name, value: v, base: base, dir: dir, rel: relStr, note: note, mat: Math.abs(dev) });
      });
    });
    flags.sort(function (a, b) { return b.mat - a.mat; });   // 先依金額取最重要的前 N 項
    const top = flags.slice(0, topN);
    function monthKey(lb) { const p = String(lb).split("/"); return (+p[0]) * 100 + (+p[1] || 0); }
    top.sort(function (a, b) { return monthKey(b.month) - monthKey(a.month) || b.mat - a.mat; }); // 再依月份新→舊
    return top;
  }

  /* ================================================================
   *  重點摘要（規則式自動產生）
   * ================================================================ */
  function pctChange(cur, prev) {
    if (cur == null || prev == null || prev === 0) return null;
    return (cur - prev) / Math.abs(prev) * 100;
  }
  function signMoney(n) { return (n >= 0 ? "+" : "−") + money(Math.abs(n)); }
  function signPctStr(n) { return n == null ? "—" : (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "%"; }
  function signPt(n) { return n == null ? "—" : (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "pt"; }
  function biggestMover(items, li, pi) {
    let best = null;
    items.forEach(function (it) {
      const c = it.values[li] || 0;
      const p = it.values[pi] || 0;
      const dd = c - p;
      if (best == null || Math.abs(dd) > Math.abs(best.delta)) best = { name: it.name, delta: dd, cur: c, prev: p };
    });
    if (!best) return null;
    best.pct = pctChange(best.cur, best.prev);
    return best;
  }

  function summary(d, seg) {
    const months = d.months;
    const out = [];
    if (!months.length) return out;
    const n = months.length;
    const li = n - 1;
    const pi = n - 2;
    const latest = months[li];
    const curYear = latest.year;
    const curMon = latest.month;
    let yi = -1;
    months.forEach(function (m, i) { if (m.year === curYear - 1 && m.month === curMon) yi = i; });
    const v = function (metric, i) { return (metric && metric.values && i >= 0) ? metric.values[i] : null; };

    // 收入 月增 / 年增
    const revL = v(d.revenue, li);
    const revP = v(d.revenue, pi);
    const revY = v(d.revenue, yi);
    if (revL != null) {
      const mom = pctChange(revL, revP);
      const yoy = pctChange(revL, revY);
      out.push(latest.label + " 收入 <b>" + money(revL) + "</b>" +
        (mom != null ? "，較上月 <b>" + signPctStr(mom) + "</b>" : "") +
        (yoy != null ? "、較去年同月 <b>" + signPctStr(yoy) + "</b>" : "") + "。");
    }
    // 毛利率
    const gpL = v(d.gp, li);
    const gpP = v(d.gp, pi);
    if (gpL != null && revL) {
      const mL = gpL / revL * 100;
      const mP = (gpP != null && revP) ? gpP / revP * 100 : null;
      out.push("毛利率 <b>" + mL.toFixed(1) + "%</b>" +
        (mP != null ? "（較上月 " + signPt(mL - mP) + "）" : "") + "，本月毛利 " + money(gpL) + "。");
    }
    // 累計 EBITDA% vs 去年同期
    if (d.ebitda && d.revenue) {
      let ce = 0;
      let cr = 0;
      let cey = 0;
      let cry = 0;
      months.forEach(function (m, i) {
        if (m.year === curYear && m.month <= curMon) { ce += d.ebitda.values[i]; cr += d.revenue.values[i]; }
        if (m.year === curYear - 1 && m.month <= curMon) { cey += d.ebitda.values[i]; cry += d.revenue.values[i]; }
      });
      const eN = cr ? ce / cr * 100 : null;
      const eP = cry ? cey / cry * 100 : null;
      if (eN != null) out.push(curYear + " 年初至今累計 EBITDA% <b>" + eN.toFixed(1) + "%</b>" +
        (eP != null ? "（去年同期 " + eP.toFixed(1) + "%，" + signPt(eN - eP) + "）" : "") + "。");
    }
    // 營業轉虧警示（毛利 - 費用）
    const opexL = v(d.opex, li);
    if (gpL != null && opexL != null && (gpL - opexL) < 0) {
      out.push("⚠️ " + latest.label + " 營業損益為負：毛利 " + money(gpL) + " 未能覆蓋費用 " + money(opexL) +
        "（約 " + money(gpL - opexL) + "）。");
    }
    // 成本變化最大科目
    const cm = biggestMover(d.cogsItems, li, pi);
    if (cm && cm.delta !== 0) out.push("成本變動最大：<b>" + cm.name + "</b> " + signMoney(cm.delta) +
      (cm.pct != null ? "（較上月 " + signPctStr(cm.pct) + "）" : "") + "。");
    // 費用變化最大科目（排除折舊）
    const expItems = d.opexItems.filter(function (it) { return !excludedExpense(it.name); });
    const em = biggestMover(expItems, li, pi);
    if (em && em.delta !== 0) out.push("費用變動最大：<b>" + em.name + "</b> " + signMoney(em.delta) +
      (em.pct != null ? "（較上月 " + signPctStr(em.pct) + "）" : "") + "。");
    // 最大成本佔比
    const totC = v(d.cogs, li);
    if (totC && d.cogsItems.length) {
      const top = d.cogsItems.slice().sort(function (a, b) { return b.values[li] - a.values[li]; })[0];
      if (top) out.push("最大成本項為 <b>" + top.name + "</b>，佔本月總成本 " +
        (top.values[li] / totC * 100).toFixed(0) + "%。");
    }
    return out;
  }

  return {
    money: money, pct: pct, summary: summary, anomalies: anomalies,
    pnlOption: pnlOption, revCostOption: revCostOption, gpExpOption: gpExpOption,
    ratesOption: ratesOption, perOrderOption: perOrderOption, waashipOption: waashipOption, expenseRatioOption: expenseRatioOption,
    costMix100Option: costMix100Option, ebitdaBridgeOption: ebitdaBridgeOption, contributionOption: contributionOption,
  };
})();
