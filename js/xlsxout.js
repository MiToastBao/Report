/* 監測報告趨勢圖產生器 — 可編輯 Excel（報告表格＋圖表資料＋原生長條圖）
 * 報告表格：依類別整理成季報／年報的表格樣式（測站、採樣日期、各測項、單位、標準值），可直接複製貼上。
 * 圖表工作表：每張圖的資料與 Excel 原生長條圖；標準線引用儲存格，改標準值圖會跟著變。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chart.js'), require('./extract.js'));
  else root.RTXlsx = factory(root.RTChart, root.RTX);
})(typeof self !== 'undefined' ? self : this, function (C, X) {
  'use strict';
  var FONT = { name: 'Microsoft JhengHei', size: 11 };
  function inMon(iso, l) { if (!l.m1 || !l.m2) return true; var m = +iso.slice(5, 7); return l.m1 <= l.m2 ? m >= l.m1 && m <= l.m2 : m >= l.m1 || m <= l.m2; }
  var BORDER = { top: { style: 'thin', color: { argb: 'FF8A93A6' } }, left: { style: 'thin', color: { argb: 'FF8A93A6' } }, bottom: { style: 'thin', color: { argb: 'FF8A93A6' } }, right: { style: 'thin', color: { argb: 'FF8A93A6' } } };
  var HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF6' } };

  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function qs(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
  function sheetNamer() {
    var used = {};
    return function (name) {
      var base = String(name).replace(/[\[\]:*?\/\\]/g, '_').slice(0, 28) || '工作表';
      var nm = base, i = 2;
      while (used[nm.toLowerCase()]) { nm = base.slice(0, 26) + '_' + i; i++; }
      used[nm.toLowerCase()] = 1;
      return nm;
    };
  }
  function cellVal(raw) {
    var p = X.parseVal(raw);
    if (p.kind === 'num' && /^[+-]?\d+(\.\d+)?$/.test(String(raw).trim())) {
      var dec = (String(raw).trim().split('.')[1] || '').length;
      return { v: p.num, fmt: dec ? '0.' + new Array(dec + 1).join('0') : '0' };
    }
    if (p.kind === 'num') return { v: p.num, fmt: 'General' };
    return { v: String(raw == null ? '' : raw), fmt: '@' };
  }
  function styleCell(cell, o) {
    cell.font = Object.assign({}, FONT, o && o.bold ? { bold: true } : {}, o && o.color ? { color: { argb: o.color } } : {});
    cell.alignment = { vertical: 'middle', horizontal: o && o.left ? 'left' : 'center', wrapText: true };
    if (!(o && o.noBorder)) cell.border = BORDER;
    if (o && o.head) cell.fill = HEAD;
  }

  /* 報告表格 */
  function addReportSheet(wb, name, cat, t, info) {
    var ws = wb.addWorksheet(name, { pageSetup: PAGE });
    var hasNote = t.blocks.some(function (b) { return b.rows.some(function (r) { return r.note; }); });
    var c0 = hasNote ? 3 : 2; // 測項從第幾欄開始（0 起算）
    var W = c0 + t.items.length;
    ws.getCell(1, 1).value = cat + '監測結果' + (t.name && t.name !== '全部' ? '（' + t.name + '）' : '') + (info.periodText ? '　' + info.periodText : '');
    ws.getCell(1, 1).font = Object.assign({}, FONT, { bold: true, size: 13 });
    var hr = 2;
    var heads = ['測站', '採樣日期'].concat(hasNote ? ['備註'] : []).concat(t.items);
    heads.forEach(function (h, i) { var c = ws.getCell(hr, i + 1); c.value = h; styleCell(c, { bold: true, head: true }); });
    var ur = hr + 1;
    for (var i = 0; i < W; i++) {
      var c = ws.getCell(ur, i + 1);
      c.value = i < c0 ? (i === c0 - 1 ? '單位' : '') : (t.units[t.items[i - c0]] || '－');
      styleCell(c, { head: true });
    }
    ws.mergeCells(hr, 1, ur, 1); ws.mergeCells(hr, 2, ur - (hasNote ? 0 : 0), 2);
    // 標準值：各站相同只列一次（放最後）；不同則每站一列
    var stdSig = t.blocks.map(function (b) { return JSON.stringify(t.items.map(function (it) { return b.std[it] || ''; })); });
    var allSame = stdSig.every(function (s) { return s === stdSig[0]; });
    var hasStd = stdSig.some(function (s) { return s !== JSON.stringify(t.items.map(function () { return ''; })); });
    var r = ur + 1;
    function stdRow(b) {
      var c1 = ws.getCell(r, 1); c1.value = '標準值'; styleCell(c1, { bold: true, head: true });
      ws.mergeCells(r, 1, r, c0);
      t.items.forEach(function (it, j) { var cc = ws.getCell(r, c0 + j + 1); cc.value = b.std[it] || '－'; styleCell(cc, { head: true }); });
      r++;
    }
    t.blocks.forEach(function (b) {
      var r0 = r;
      b.rows.forEach(function (row) {
        ws.getCell(r, 1).value = b.st; styleCell(ws.getCell(r, 1));
        ws.getCell(r, 2).value = row.dl; styleCell(ws.getCell(r, 2));
        if (hasNote) { ws.getCell(r, 3).value = row.note; styleCell(ws.getCell(r, 3)); }
        t.items.forEach(function (it, j) {
          var cc = ws.getCell(r, c0 + j + 1), raw = row.vals[it];
          if (raw == null || raw === '') { cc.value = ''; }
          else { var cv = cellVal(raw); cc.value = cv.v; cc.numFmt = cv.fmt; }
          styleCell(cc);
        });
        r++;
      });
      if (r - 1 > r0) ws.mergeCells(r0, 1, r - 1, 1);
      if (hasStd && !allSame) stdRow(b);
    });
    if (hasStd && allSame && t.blocks.length) stdRow(t.blocks[0]);
    ws.getColumn(1).width = 22; ws.getColumn(2).width = 15; if (hasNote) ws.getColumn(3).width = 12;
    for (var j = 0; j < t.items.length; j++) ws.getColumn(c0 + j + 1).width = Math.max(10, Math.min(18, t.items[j].length * 1.6 + 2));
    ws.views = [{ state: 'frozen', xSplit: c0, ySplit: ur }];
    r += 1;
    ws.getCell(r, 1).value = '註：ND 表示低於方法偵測極限；「<x」表示低於定量極限，均依報告原樣呈現。數值儲存格保留報告的小數位數。';
    ws.getCell(r, 1).font = Object.assign({}, FONT, { size: 10, color: { argb: 'FF5B6477' } });
    return ws;
  }

  // 為了讓每張圖和它的資料表對齊，先算好每張表的起始列再寫入
  var PAGE = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  function chartSheet(wb, name, group, info) {
    var ws = wb.addWorksheet(name, { pageSetup: PAGE });
    var plan = { sheet: name, charts: [] };
    ws.getCell(1, 1).value = group.title; ws.getCell(1, 1).font = Object.assign({}, FONT, { bold: true, size: 13 });
    var r = 3, maxCols = 2;
    group.charts.forEach(function (s) { maxCols = Math.max(maxCols, s.series.length + 2); });
    var col0 = Math.max(maxCols + 1, info.std !== false ? 8 : 5); // 標準值設定表用到 A～F 欄，圖放在它右邊
    group.charts.forEach(function (spec) {
      var hr = r, n = spec.cats.length;
      var hc = ws.getCell(hr, 1); hc.value = spec.kind === 'item' ? '採樣日期／測站' : '採樣日期'; styleCell(hc, { bold: true, head: true });
      spec.series.forEach(function (s, j) {
        var c = ws.getCell(hr, j + 2); c.value = spec.kind === 'item' ? s.name : spec.title + (spec.unit ? ' (' + spec.unit + ')' : ''); styleCell(c, { bold: true, head: true });
      });
      spec.cats.forEach(function (lab, i) {
        var c = ws.getCell(hr + 1 + i, 1); c.value = lab; styleCell(c);
        spec.series.forEach(function (s, j) {
          var v = s.values[i], cc = ws.getCell(hr + 1 + i, j + 2);
          if (v && v.raw != null && v.raw !== '') { var cv = cellVal(v.raw); cc.value = cv.v; cc.numFmt = cv.fmt; }
          styleCell(cc);
        });
      });
      var last = hr + n;
      var catRef = qs(name) + '!$A$' + (hr + 1) + ':$A$' + last;
      var series = spec.series.map(function (s, j) { var col = colName(j + 1); return { nameRef: qs(name) + '!$' + col + '$' + hr, valRef: qs(name) + '!$' + col + '$' + (hr + 1) + ':$' + col + '$' + last }; });
      // 比對用的採樣日期（標準值依期間套用）
      var dc = spec.series.length + 2;
      var dh = ws.getCell(hr, dc); dh.value = '採樣日期（西元，比對標準值用）'; styleCell(dh, { bold: true, head: true });
      var catIso = spec.cats.map(function (c, i) { var iso = ''; spec.series.forEach(function (s) { var v = s.values[i]; if (!iso && v && v.iso) iso = v.iso; }); return iso; });
      catIso.forEach(function (iso, i) {
        var cc = ws.getCell(hr + 1 + i, dc);
        if (iso) { cc.value = new Date(iso + 'T00:00:00Z'); cc.numFmt = 'yyyy/mm/dd'; }
        styleCell(cc, { color: 'FF6B7489' });
      });
      var stdSeries = [];
      var lines = info.std !== false ? (spec.stdLines || []) : [];
      var endRow = last + 1;
      if (info.std !== false) {
        // 標準值設定表：一列一個標準值（起日、迄日可空白＝不限），預留兩列可自行新增
        var sr = last + 2;
        ['標準值起日（西元，空白＝不限）', '標準值迄日（西元，空白＝不限）', '標準值' + (spec.unit ? '（' + spec.unit + '）' : ''), '適用月份 起（1～12，空白＝全年）', '適用月份 迄（可跨年，例如 10→4）', '說明'].forEach(function (h, k) { var c = ws.getCell(sr, k + 1); c.value = h; styleCell(c, { bold: true, head: true }); });
        // 同一標準分成多段（季節性）時只列一次；月份條件寫在表裡，Excel 會自己斷開
        var slots = lines.filter(function (ln) { return ln.first !== false; }).concat([null, null]);
        var helperCol = col0 + (spec.kind === 'item' ? 14 : 12);
        slots.forEach(function (ln, k) {
          var row = sr + 1 + k;
          var a = ws.getCell(row, 1), b = ws.getCell(row, 2), cv = ws.getCell(row, 3), m1c = ws.getCell(row, 4), m2c = ws.getCell(row, 5), dsc = ws.getCell(row, 6);
          if (ln) {
            if (ln.from) a.value = new Date(ln.from + 'T00:00:00Z');
            if (ln.to) b.value = new Date(ln.to + 'T00:00:00Z');
            cv.value = ln.v;
            if (ln.m1 && ln.m2) { m1c.value = ln.m1; m2c.value = ln.m2; }
            dsc.value = ln.label && ln.label !== '標準值' ? ln.label : '';
          }
          a.numFmt = 'yyyy/mm/dd'; b.numFmt = 'yyyy/mm/dd';
          styleCell(a); styleCell(b); styleCell(cv, { color: 'FFE03131', bold: true }); styleCell(m1c); styleCell(m2c); styleCell(dsc, { left: true });
          // 隱藏的繪圖用儲存格：名稱與每個採樣日期的標準值（不在期間內＝#N/A，不畫線）
          var unitTxt = spec.unit ? ' ' + spec.unit.replace(/"/g, '""') : '';
          var txt = ln ? C.stdText(ln, spec.unit) : '';
          var nameCell = ws.getCell(row, helperCol);
          var A = '$A$' + row, B = '$B$' + row;
          function roc(X) { return '(YEAR(' + X + ')-1911)&TEXT(' + X + ',".mm.dd")'; }
          var Dm = '$D$' + row, Em = '$E$' + row, noM = 'OR(' + Dm + '="",' + Em + '="")', noD = 'AND(' + A + '="",' + B + '="")';
          var core = 'IF(' + noD + ',"",IF(' + A + '="","至"&' + roc(B) + ',IF(' + B + '="",' + roc(A) + '&"起",' + roc(A) + '&"～"&' + roc(B) + ')))';
          var mon = 'IF(' + noM + ',"",IF(' + noD + ',"","，")&' + Dm + '&"～"&IF(' + Em + '<' + Dm + ',"翌年","")&' + Em + '&"月")';
          var per = 'IF(AND(' + noD + ',' + noM + '),"","（"&' + core + '&' + mon + '&"）")';
          nameCell.value = { formula: 'IF($C$' + row + '="","","標準值 "&$C$' + row + '&"' + unitTxt + '"&' + per + ')', result: txt };
          var vals = [];
          for (var i = 0; i < n; i++) {
            var h = ws.getCell(row, helperCol + 1 + i), dref = '$' + colName(dc - 1) + '$' + (hr + 1 + i);
            var inr = ln && catIso[i] && (!ln.from || catIso[i] >= ln.from) && (!ln.to || catIso[i] <= ln.to) && inMon(catIso[i], ln);
            var mOk = 'OR(' + Dm + '="",' + Em + '="",IF(' + Dm + '<=' + Em + ',AND(MONTH(' + dref + ')>=' + Dm + ',MONTH(' + dref + ')<=' + Em + '),OR(MONTH(' + dref + ')>=' + Dm + ',MONTH(' + dref + ')<=' + Em + ')))';
            h.value = { formula: 'IF(AND($C$' + row + '<>"",' + dref + '<>"",OR($A$' + row + '="",' + dref + '>=$A$' + row + '),OR($B$' + row + '="",' + dref + '<=$B$' + row + '),' + mOk + '),$C$' + row + ',NA())', result: inr ? ln.v : { error: '#N/A' } };
            vals.push(inr ? ln.v : null);
          }
          stdSeries.push({ name: txt, spare: !ln, vals: vals, nameRef: qs(name) + '!$' + colName(helperCol - 1) + '$' + row, valRef: qs(name) + '!$' + colName(helperCol) + '$' + row + ':$' + colName(helperCol - 1 + n) + '$' + row });
        });
        for (var hcI = 0; hcI <= n; hcI++) ws.getColumn(helperCol + hcI).hidden = true;
        endRow = sr + slots.length + 1;
        var note = ws.getCell(endRow, 1);
        note.value = '↑ 標準值可修改數值、適用期間與適用月份（季節性標準，例如水溫 5～9 月 38、10～翌年 4 月 35）；有新的標準值（例如每年加嚴）就填在空白列，圖上會自動多一條只畫在該期間的紅色虛線。';
        note.font = Object.assign({}, FONT, { size: 9, color: { argb: 'FF5B6477' } });
        ws.mergeCells(endRow, 1, endRow, 6); note.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(endRow).height = 30; // 不要延伸到圖的下面
        endRow++;
      }
      var chartRows = spec.kind === 'item' ? 22 : 18;
      plan.charts.push({ xml: C.barChartXml({ spec: spec, catRef: catRef, series: series, stdSeries: stdSeries, zero: info.zero }), col: col0, row: hr - 1, cols: spec.kind === 'item' ? 12 : 10, rows: chartRows });
      r = Math.max(endRow, hr + chartRows) + 2;
    });
    ws.getColumn(1).width = 22; ws.getColumn(2).width = 22; ws.getColumn(3).width = 16; ws.getColumn(4).width = 16;
    for (var j = 5; j <= maxCols; j++) ws.getColumn(j).width = 14;
    if (info.std !== false) { ws.getColumn(4).width = Math.max(ws.getColumn(4).width || 0, 17); ws.getColumn(5).width = Math.max(ws.getColumn(5).width || 0, 17); ws.getColumn(6).width = Math.max(ws.getColumn(6).width || 0, 18); }
    return plan;
  }

  function build(ExcelJS, JSZip, o) {
    // o: {project, cat, periodText, tables:[reportTables], charts:[spec], mode, split, notes:[]}
    var wb = new ExcelJS.Workbook();
    wb.creator = '監測報告趨勢圖產生器';
    var nm = sheetNamer();
    var ex = wb.addWorksheet(nm('說明'));
    [
      ['監測報告趨勢圖產生器　輸出檔'],
      ['計畫', o.project || ''],
      ['監測類別', o.cat],
      ['期間', o.periodText || ''],
      ['產生時間', new Date().toLocaleString('zh-TW')],
      [''],
      ['工作表說明'],
      ['報告表格', '依季報／年報的表格樣式整理：測站、採樣日期、各測項、單位與標準值，可直接複製貼到報告。'],
      ['圖_…', '每張趨勢圖的資料與 Excel 原生長條圖。數值、標準值都可以直接修改，圖會跟著更新。'],
      [''],
      ['ND、<x 等數值', '依報告原樣列出，圖上不畫長條。'],
      ['紅色虛線', '標準值。修改「標準值」那一格的數字，虛線與標籤會跟著變。']
    ].concat((o.notes || []).map(function (t) { return ['備註', t]; })).forEach(function (row) { ex.addRow(row); });
    ex.getColumn(1).width = 16; ex.getColumn(2).width = 100;
    ex.getCell(1, 1).font = Object.assign({}, FONT, { bold: true, size: 14 });
    ex.eachRow(function (row, i) { if (i > 1) row.eachCell(function (c) { c.font = FONT; c.alignment = { vertical: 'top', wrapText: true }; }); });
    (o.tables || []).forEach(function (t) {
      addReportSheet(wb, nm(o.tables.length > 1 ? '報告表格_' + t.name : '報告表格'), o.cat, t, { periodText: o.periodText });
    });
    var plans = [];
    var groups = [];
    if (o.mode === 'item') {
      o.charts.forEach(function (c) { groups.push({ name: '圖_' + c.title, title: c.title + (c.unit ? ' (' + c.unit + ')' : '') + '　各測站趨勢', charts: [c] }); });
    } else {
      var byStation = {};
      o.charts.forEach(function (c) {
        if (!byStation[c.station]) { byStation[c.station] = { name: '圖_' + c.station, title: c.station + '　趨勢圖資料', charts: [] }; groups.push(byStation[c.station]); }
        byStation[c.station].charts.push(c);
      });
    }
    groups.forEach(function (g) { plans.push(chartSheet(wb, nm(g.name), g, { std: o.std, zero: o.zero })); });
    return wb.xlsx.writeBuffer().then(function (buf) { return C.inject(JSZip, buf, plans); });
  }

  return { build: build, cellVal: cellVal, colName: colName };
});
