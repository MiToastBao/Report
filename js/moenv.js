/* 監測報告趨勢圖產生器 — 環境部資料查詢（不分計畫）
 * ★ 給維護者（含 AI）：環境部改網址、改資料集代碼或金鑰失效而查不到時，只要改下面的 CONFIG。
 *   - 空品月值：資料集 AQX_P_08「空氣品質監測月值」https://data.moenv.gov.tw/dataset/detail/aqx_p_08
 *   - 空品測站：資料集 AQX_P_07「空氣品質監測站基本資料」
 *   - 河川水質：資料集 WQX_P_01「河川水質監測資料」https://data.moenv.gov.tw/dataset/detail/WQX_P_01
 *   - 河川測點：資料集 WQX_P_06「河川水質測點基本資料」
 *   API 格式：https://data.moenv.gov.tw/api/v2/{資料集}?format=json&limit=1000&offset=0&api_key={金鑰}&filters=欄位,GR,值|欄位,LT,值
 *   （filters 的 GR 是「大於等於」、LT 是「小於」；多個條件用 | 連接，送出時編成 %7C）
 *   金鑰：目前用環境部「透過API下載歷史資料操作手冊」裡的範例金鑰；若失效，可到環境部開放平臺免費申請後換掉 KEY。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTMoenv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CONFIG = {
    BASE: 'https://data.moenv.gov.tw/api/v2/',
    KEY: '540e2ca4-41e1-4186-8497-fdd67024ac44',
    AIR_MONTH: 'aqx_p_08',
    AIR_SITES: 'aqx_p_07',
    RIVER: 'wqx_p_01',
    RIVER_SITES: 'wqx_p_06',
    PAGE: 1000,
    DELAY_MS: 400 // 每次請求間隔，避免被環境部暫時封鎖
  };
  function url(ds, filters, offset) {
    var u = CONFIG.BASE + ds + '?format=json&limit=' + CONFIG.PAGE + '&offset=' + (offset || 0) + '&api_key=' + encodeURIComponent(CONFIG.KEY);
    if (filters && filters.length) u += '&filters=' + filters.map(function (f) { return encodeURIComponent(f); }).join('%7C');
    return u;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function asRecords(j) {
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.records)) return j.records;
    if (j && j.result && Array.isArray(j.result.records)) return j.result.records;
    throw new Error('環境部回傳的格式看不懂（可能是網址或金鑰變了）');
  }
  // fetchJson(url) → Promise<json>；onPage(已取得筆數)
  function fetchAll(fetchJson, ds, filters, onPage, maxPages) {
    var out = [], page = 0;
    function next() {
      return fetchJson(url(ds, filters, page * CONFIG.PAGE)).then(function (j) {
        var a = asRecords(j);
        out = out.concat(a);
        page++;
        if (onPage) onPage(out.length);
        if (a.length < CONFIG.PAGE || page >= (maxPages || 50)) return out;
        return sleep(CONFIG.DELAY_MS).then(next);
      });
    }
    return next();
  }
  function ymAdd(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + (m < 9 ? '0' : '') + (m + 1); }

  function airSites(fetchJson) {
    return fetchAll(fetchJson, CONFIG.AIR_SITES, [], null, 2).then(function (a) {
      return a.map(function (r) { return { id: String(r.siteid), name: r.sitename, county: r.county || '', type: r.sitetype || '' }; })
        .filter(function (s) { return s.id && s.name; });
    });
  }
  function riverSites(fetchJson) {
    return fetchAll(fetchJson, CONFIG.RIVER_SITES, [], null, 10).then(function (a) {
      return a.map(function (r) { return { id: String(r.siteid), name: r.sitename, county: r.county || '', township: r.township || '', river: r.river || '', basin: r.basin || '', status: r.statusofuse || '' }; })
        .filter(function (s) { return s.id && s.name; });
    });
  }
  // 空品月值：from/to 為 'YYYY-MM'
  function airMonthly(fetchJson, siteIds, from, to, onProgress) {
    var all = [], i = 0;
    function one() {
      if (i >= siteIds.length) return Promise.resolve(all);
      var id = siteIds[i++];
      var f = ['siteid,EQ,' + id, 'monitormonth,GR,' + from.replace('-', ''), 'monitormonth,LT,' + ymAdd(to, 1).replace('-', '')];
      return fetchAll(fetchJson, CONFIG.AIR_MONTH, f).then(function (a) {
        a.forEach(function (r) { if (String(r.siteid) === String(id)) all.push(r); });
        if (onProgress) onProgress(i, siteIds.length, all.length);
        return sleep(CONFIG.DELAY_MS).then(one);
      });
    }
    return one();
  }
  function riverData(fetchJson, siteIds, from, to, onProgress) {
    var all = [], i = 0;
    function one() {
      if (i >= siteIds.length) return Promise.resolve(all);
      var id = siteIds[i++];
      var f = ['siteid,EQ,' + id, 'sampledate,GR,' + from + '-01', 'sampledate,LT,' + ymAdd(to, 1) + '-01'];
      return fetchAll(fetchJson, CONFIG.RIVER, f).then(function (a) {
        a.forEach(function (r) { if (String(r.siteid) === String(id)) all.push(r); });
        if (onProgress) onProgress(i, siteIds.length, all.length);
        return sleep(CONFIG.DELAY_MS).then(one);
      });
    }
    return one();
  }

  /* ---------- 整理成表 ---------- */
  function num(v) { var s = String(v == null ? '' : v).trim(); return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? +s : null; }
  function pivotAir(rows) {
    var items = [], units = {}, keys = [], map = {};
    rows.forEach(function (r) {
      var it = r.itemname + (r.itemengname ? '(' + r.itemengname + ')' : '');
      if (items.indexOf(it) < 0) { items.push(it); units[it] = r.itemunit || ''; }
      var m = String(r.monitormonth);
      var k = r.sitename + '|' + m;
      if (!map[k]) { map[k] = { st: r.sitename, id: r.siteid, period: m.slice(0, 4) + '-' + m.slice(4, 6), vals: {} }; keys.push(k); }
      map[k].vals[it] = r.concentration;
    });
    var out = keys.map(function (k) { return map[k]; }).sort(function (a, b) { return a.st < b.st ? -1 : a.st > b.st ? 1 : a.period < b.period ? -1 : 1; });
    return { items: items, units: units, rows: out };
  }
  function quarterAvg(pv) {
    var map = {}, keys = [];
    pv.rows.forEach(function (r) {
      var y = +r.period.slice(0, 4), q = Math.floor((+r.period.slice(5, 7) - 1) / 3) + 1;
      var k = r.st + '|' + y + 'Q' + q;
      if (!map[k]) { map[k] = { st: r.st, period: (y - 1911) + 'Q' + q, months: [], sums: {}, cnt: {} }; keys.push(k); }
      var g = map[k]; g.months.push(r.period);
      pv.items.forEach(function (it) { var v = num(r.vals[it]); if (v != null) { g.sums[it] = (g.sums[it] || 0) + v; g.cnt[it] = (g.cnt[it] || 0) + 1; } });
    });
    return keys.map(function (k) {
      var g = map[k], vals = {};
      pv.items.forEach(function (it) { if (g.cnt[it]) vals[it] = Math.round(g.sums[it] / g.cnt[it] * 1000) / 1000; });
      return { st: g.st, period: g.period, months: g.months.length, vals: vals };
    });
  }
  function pivotRiver(rows) {
    var items = [], units = {}, keys = [], map = {};
    rows.forEach(function (r) {
      var it = r.itemname + (r.itemengabbreviation ? '(' + r.itemengabbreviation + ')' : '');
      if (items.indexOf(it) < 0) { items.push(it); units[it] = r.itemunit || ''; }
      var d = String(r.sampledate || '');
      var k = r.sitename + '|' + d;
      if (!map[k]) { map[k] = { st: r.sitename, id: r.siteid, river: r.river || '', county: r.county || '', period: d, vals: {} }; keys.push(k); }
      map[k].vals[it] = r.itemvalue;
    });
    var out = keys.map(function (k) { return map[k]; }).sort(function (a, b) { return a.st < b.st ? -1 : a.st > b.st ? 1 : a.period < b.period ? -1 : 1; });
    return { items: items, units: units, rows: out };
  }
  function toCsv(rows) {
    if (!rows.length) return '';
    var cols = Object.keys(rows[0]);
    rows.forEach(function (r) { Object.keys(r).forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
    function q(v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    return '﻿' + [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); })).join('\r\n');
  }
  function buildWorkbook(ExcelJS, o) {
    // o: {kind:'air'|'river', raw:[], pivot, quarters?, info:[]}
    var wb = new ExcelJS.Workbook();
    var F = { name: 'Microsoft JhengHei', size: 11 };
    var ws = wb.addWorksheet(o.kind === 'air' ? '月值整理表' : '水質整理表');
    var head = o.kind === 'air' ? ['測站', '月份'] : ['測站', '河川', '縣市', '採樣時間'];
    var hr = ws.addRow(head.concat(o.pivot.items));
    var ur = ws.addRow(head.map(function (h, i) { return i === head.length - 1 ? '單位' : ''; }).concat(o.pivot.items.map(function (it) { return o.pivot.units[it] || ''; })));
    [hr, ur].forEach(function (r) { r.eachCell(function (c) { c.font = Object.assign({}, F, { bold: true }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF6' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; }); });
    o.pivot.rows.forEach(function (r) {
      var base = o.kind === 'air' ? [r.st, r.period] : [r.st, r.river, r.county, r.period];
      var row = ws.addRow(base.concat(o.pivot.items.map(function (it) { var v = r.vals[it]; var n = num(v); return n != null ? n : (v == null ? '' : v); })));
      row.eachCell(function (c) { c.font = F; c.alignment = { horizontal: 'center' }; });
    });
    ws.views = [{ state: 'frozen', xSplit: head.length, ySplit: 2 }];
    ws.getColumn(1).width = 14; for (var i = 2; i <= head.length; i++) ws.getColumn(i).width = o.kind === 'air' ? 10 : 20;
    for (var j = 0; j < o.pivot.items.length; j++) ws.getColumn(head.length + 1 + j).width = 14;
    if (o.quarters && o.quarters.length) {
      var qs = wb.addWorksheet('季平均（由月值計算）');
      var h2 = qs.addRow(['測站', '季別', '月數'].concat(o.pivot.items));
      h2.eachCell(function (c) { c.font = Object.assign({}, F, { bold: true }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF6' } }; c.alignment = { horizontal: 'center', wrapText: true }; });
      o.quarters.forEach(function (q) { var row = qs.addRow([q.st, q.period, q.months].concat(o.pivot.items.map(function (it) { return q.vals[it] != null ? q.vals[it] : ''; }))); row.eachCell(function (c) { c.font = F; c.alignment = { horizontal: 'center' }; }); });
      qs.addRow([]);
      qs.addRow(['註：季平均是把該季有資料的月值做算術平均（月數欄為實際採用的月份數），不是環境部公告的季值，僅供參考。']).getCell(1).font = Object.assign({}, F, { size: 10, color: { argb: 'FF5B6477' } });
      qs.getColumn(1).width = 14; qs.getColumn(2).width = 10;
    }
    var raw = wb.addWorksheet('原始資料');
    if (o.raw.length) {
      var cols = Object.keys(o.raw[0]);
      raw.addRow(cols).eachCell(function (c) { c.font = Object.assign({}, F, { bold: true }); });
      o.raw.forEach(function (r) { raw.addRow(cols.map(function (c) { return r[c]; })); });
    }
    var ex = wb.addWorksheet('說明');
    (o.info || []).forEach(function (t) { ex.addRow([t]).getCell(1).font = F; });
    ex.getColumn(1).width = 110;
    return wb.xlsx.writeBuffer();
  }

  return { CONFIG: CONFIG, url: url, fetchAll: fetchAll, airSites: airSites, riverSites: riverSites, airMonthly: airMonthly, riverData: riverData, pivotAir: pivotAir, pivotRiver: pivotRiver, quarterAvg: quarterAvg, toCsv: toCsv, buildWorkbook: buildWorkbook, ymAdd: ymAdd };
});
