/* 監測報告趨勢圖產生器 — 計算核心（不碰畫面，node 測試可直接呼叫）
 * - 期間篩選、民國年格式、季別
 * - 依類別整理成報告表格（每月／每季／整段期間）
 * - 產生趨勢圖規格（每站每測項一張／每測項一張各站並列）
 * - 資料異常檢查
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./extract.js'));
  else root.RTCore = factory(root.RTX);
})(typeof self !== 'undefined' ? self : this, function (X) {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function rocY(iso) { return +iso.slice(0, 4) - 1911; }
  function rocDate(iso) { return iso ? rocY(iso) + '.' + iso.slice(5, 7) + '.' + iso.slice(8, 10) : ''; }
  function rocMonth(iso) { return iso ? rocY(iso) + '.' + iso.slice(5, 7) : ''; }
  function quarterOf(iso) { return rocY(iso) + 'Q' + (Math.floor((+iso.slice(5, 7) - 1) / 3) + 1); }
  function ymOf(iso) { return iso.slice(0, 7); }
  // 期間：{from:'YYYY-MM', to:'YYYY-MM'}（含頭尾月）
  function inPeriod(iso, p) {
    if (!p) return true;
    var ym = iso.slice(0, 7);
    return (!p.from || ym >= p.from) && (!p.to || ym <= p.to);
  }
  function valOf(raw) { return X.parseVal(raw); }
  function isTextItem(recs) {
    var n = 0, t = 0;
    recs.forEach(function (r) { var k = valOf(r.raw).kind; if (k === 'text') t++; else if (k !== 'blank') n++; });
    return t > n;
  }
  function uniq(a) { var o = [], s = {}; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function sortRecs(a) {
    return a.sort(function (x, y) { return x.iso < y.iso ? -1 : x.iso > y.iso ? 1 : (x.note || '') < (y.note || '') ? -1 : (x.note || '') > (y.note || '') ? 1 : 0; });
  }

  /* ---------- 標準值 ---------- */
  // 某測站某測項的標準值（可有多筆不同適用期間）；有指定測站的優先於「全部測站」
  // 適用期間（起訖日）＋適用月份（m1～m2，可跨年，例如 10～4 月）
  function inMonths(iso, s) {
    if (!s.m1 || !s.m2 || !iso) return true;
    var m = +iso.slice(5, 7);
    return s.m1 <= s.m2 ? m >= s.m1 && m <= s.m2 : m >= s.m1 || m <= s.m2;
  }
  function inRange(iso, s) { return (!s.from || iso >= s.from) && (!s.to || iso <= s.to) && inMonths(iso, s); }
  function monthNote(s) { return s.m1 && s.m2 ? s.m1 + '～' + (s.m2 < s.m1 ? '翌年' : '') + s.m2 + '月' : ''; }
  function stdJudge(v, s) {
    var ls = (s.lines || []).slice().sort(function (a, b) { return a - b; });
    if (!ls.length || v == null) return false;
    var mode = s.mode || (ls.length >= 2 && /[~～至]/.test(s.text || '') ? 'range' : 'max');
    if (mode === 'range') return v < ls[0] || v > ls[ls.length - 1];
    if (mode === 'min') return v < ls[0];
    return v > ls[ls.length - 1];
  }
  function stdLabel(s) { var p = periodNote(s); return (s.text || (s.lines || []).join('~')) + (p ? '（' + p + '）' : ''); }
  function stdsFor(stds, cat, st, item, iso) {
    var a = [], b = [];
    for (var i = 0; i < stds.length; i++) {
      var s = stds[i];
      if (s.cat !== cat || s.item !== item || !s.lines || !s.lines.length) continue;
      if (s.st === st) a.push(s); else if (s.st === '*') b.push(s);
    }
    var list = a.length ? a : b;
    return iso ? list.filter(function (s) { return inRange(iso, s); }) : list;
  }
  function stdFor(stds, cat, st, item, iso) { return stdsFor(stds, cat, st, item, iso)[0] || null; }
  function periodNote(s) {
    if (!s.from && !s.to) return monthNote(s);
    return periodNote0(s) + (monthNote(s) ? '，' + monthNote(s) : '');
  }
  function periodNote0(s) {
    if (s.from && s.to) return rocDate(s.from) + '～' + rocDate(s.to);
    return s.from ? rocDate(s.from) + '起' : '至' + rocDate(s.to);
  }

  /* ---------- 期間內的測站、測項 ---------- */
  function catalog(recs, cat, period) {
    var sts = [], items = [], units = {}, textItems = {};
    var list = recs.filter(function (r) { return r.cat === cat && !r.excl && inPeriod(r.iso, period); });
    var byItem = {};
    list.forEach(function (r) {
      if (sts.indexOf(r.st) < 0) sts.push(r.st);
      if (items.indexOf(r.item) < 0) items.push(r.item);
      if (r.unit && !units[r.item]) units[r.item] = r.unit;
      (byItem[r.item] = byItem[r.item] || []).push(r);
    });
    Object.keys(byItem).forEach(function (k) { if (isTextItem(byItem[k])) textItems[k] = 1; });
    return { stations: sts, items: items, units: units, textItems: textItems, recs: list };
  }

  /* ---------- X 軸分類標籤 ---------- */
  // xmode: 'orig'（報告原樣日期）| 'date'（YYY.MM.DD）| 'month'（YYY.MM）
  function labelOf(r, xmode) {
    if (xmode === 'month') return rocMonth(r.iso);
    if (xmode === 'date') return rocDate(r.iso);
    return r.dl || rocDate(r.iso);
  }

  /* ---------- 趨勢圖規格 ---------- */
  function buildCharts(recs, stds, o) {
    // o: {cat, period, stations[], items[], mode:'station'|'item', xmode, noteInLabel:'auto'|'yes'|'no'}
    var cat = o.cat;
    var list = recs.filter(function (r) { return r.cat === cat && !r.excl && inPeriod(r.iso, o.period) && o.stations.indexOf(r.st) >= 0 && o.items.indexOf(r.item) >= 0; });
    sortRecs(list);
    var units = {};
    list.forEach(function (r) { if (r.unit && !units[r.item]) units[r.item] = r.unit; });
    var charts = [];
    function mkLabel(r, notesVary) {
      var l = labelOf(r, o.xmode);
      var withNote = o.noteInLabel === 'yes' || (o.noteInLabel !== 'no' && notesVary);
      return withNote && r.note ? l + '(' + r.note + ')' : l;
    }
    function stdLinesOf(st, item) {
      var out = [];
      stdsFor(stds, cat, st, item).forEach(function (s) {
        s.lines.forEach(function (v) { out.push({ v: v, label: s.label || '標準值', text: s.text, from: s.from || '', to: s.to || '', m1: s.m1 || 0, m2: s.m2 || 0, period: s.from || s.to ? periodNote0(s) : '' }); }); // 圖上文字不寫適用月份（線的位置就代表月份）
      });
      return out;
    }
    // 標準線的範圍：只涵蓋適用期間內的採樣（i0～i1）；完全不在期間內就不畫
    // 有適用月份（季節性）時可能分成好幾段：每段一個物件，同一標準共用 grp，只有最長的那段標文字（lead）
    var grpSeq = 0;
    function spanOf(ln, isos) {
      var segs = [], cur = null;
      isos.forEach(function (iso, i) {
        var ok = iso ? inRange(iso, ln) : !!cur; // 沒有日期的分類沿用前一個
        if (ok) { if (!cur) { cur = { i0: i, i1: i }; segs.push(cur); } else cur.i1 = i; } else cur = null;
      });
      if (!segs.length) return [];
      var g = ++grpSeq, best = 0;
      segs.forEach(function (sg, k) { if (sg.i1 - sg.i0 > segs[best].i1 - segs[best].i0) best = k; });
      return segs.map(function (sg, k) {
        return Object.assign({}, ln, { i0: sg.i0, i1: sg.i1, grp: g, lead: k === best, first: k === 0, full: segs.length === 1 && sg.i0 === 0 && sg.i1 === isos.length - 1 });
      });
    }
    function spans(lines, isos) { var out = []; lines.forEach(function (ln) { out = out.concat(spanOf(ln, isos)); }); return out; }
    if (o.mode === 'item') {
      o.items.forEach(function (item) {
        var rs = list.filter(function (r) { return r.item === item; });
        if (!rs.length) return;
        var notesVary = uniq(rs.map(function (r) { return r.note || ''; })).length > 1;
        // 分類：依標籤排序（同一站同一標籤多筆時加序號 -1、-2）
        var tot = {}, seq = {}, catsIso = {};
        rs.forEach(function (r) { var kk = r.st + '|' + mkLabel(r, notesVary); tot[kk] = (tot[kk] || 0) + 1; });
        var pts = rs.map(function (r) {
          var base = mkLabel(r, notesVary), kk = r.st + '|' + base;
          seq[kk] = (seq[kk] || 0) + 1;
          var lab = tot[kk] > 1 ? base + '-' + seq[kk] : base;
          if (!catsIso[lab] || r.iso < catsIso[lab]) catsIso[lab] = r.iso;
          return { r: r, lab: lab };
        });
        var cats = Object.keys(catsIso).sort(function (a, b) { return catsIso[a] < catsIso[b] ? -1 : catsIso[a] > catsIso[b] ? 1 : a < b ? -1 : 1; });
        var series = o.stations.filter(function (st) { return rs.some(function (r) { return r.st === st; }); }).map(function (st) {
          var vals = cats.map(function () { return null; });
          pts.forEach(function (p) { if (p.r.st === st) vals[cats.indexOf(p.lab)] = { raw: p.r.raw, num: valOf(p.r.raw).num, kind: valOf(p.r.raw).kind, iso: p.r.iso }; });
          return { name: st, values: vals };
        });
        // 標準線：各站相同才畫一條；不同時每個值各一條並標明測站
        var lines = [], seen = {};
        series.forEach(function (s) {
          stdLinesOf(s.name, item).forEach(function (ln) {
            var key = ln.v + '|' + ln.from + '|' + ln.to + '|' + ln.m1 + '-' + ln.m2;
            if (!seen[key]) { seen[key] = Object.assign({}, ln, { sts: [] }); lines.push(seen[key]); }
            seen[key].sts.push(s.name);
          });
        });
        lines.forEach(function (ln) { if (ln.sts.length < series.length && series.length > 1) ln.suffix = '（' + ln.sts.join('、') + '）'; });
        var catIsos = cats.map(function (c) { return catsIso[c]; });
        lines = spans(lines, catIsos);
        charts.push({ kind: 'item', title: item, item: item, unit: units[item] || '', cats: cats, series: series, stdLines: lines, cat: cat });
      });
    } else {
      o.stations.forEach(function (st) {
        o.items.forEach(function (item) {
          var rs = list.filter(function (r) { return r.st === st && r.item === item; });
          if (!rs.length) return;
          var notesVary = uniq(rs.map(function (r) { return r.note || ''; })).length > 1;
          var cats = [], vals = [], cnt = {};
          rs.forEach(function (r) {
            var lab = mkLabel(r, notesVary);
            cnt[lab] = (cnt[lab] || 0) + 1;
            if (cnt[lab] > 1) lab += '-' + cnt[lab];
            cats.push(lab);
            var pv = valOf(r.raw);
            vals.push({ raw: r.raw, num: pv.num, kind: pv.kind, iso: r.iso });
          });
          var isos = vals.map(function (v) { return v.iso; });
          var sl = spans(stdLinesOf(st, item), isos);
          charts.push({ kind: 'station', title: item, station: st, item: item, unit: units[item] || '', cats: cats, series: [{ name: st, values: vals }], stdLines: sl, cat: cat });
        });
      });
    }
    return charts;
  }

  /* ---------- 報告表格（給季報、年報直接填寫） ---------- */
  // split: 'all' | 'quarter' | 'month'
  function reportTables(recs, stds, o) {
    var cat = o.cat;
    var list = recs.filter(function (r) { return r.cat === cat && !r.excl && inPeriod(r.iso, o.period) && o.stations.indexOf(r.st) >= 0 && o.items.indexOf(r.item) >= 0; });
    sortRecs(list);
    var units = {};
    list.forEach(function (r) { if (r.unit && !units[r.item]) units[r.item] = r.unit; });
    var groups = {}, order = [];
    list.forEach(function (r) {
      var g = o.split === 'quarter' ? quarterOf(r.iso) : o.split === 'month' ? rocY(r.iso) + '年' + (+r.iso.slice(5, 7)) + '月' : '全部';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(r);
    });
    return order.map(function (g) {
      var rs = groups[g];
      var items = o.items.filter(function (it) { return rs.some(function (r) { return r.item === it; }); });
      var blocks = [];
      o.stations.forEach(function (st) {
        var srs = rs.filter(function (r) { return r.st === st; });
        if (!srs.length) return;
        var rows = [], idx = {};
        srs.forEach(function (r) {
          var key = r.iso + '|' + (r.note || '');
          if (idx[key] == null) { idx[key] = rows.length; rows.push({ iso: r.iso, dl: r.dl || rocDate(r.iso), note: r.note || '', vals: {} }); }
          rows[idx[key]].vals[r.item] = r.raw;
        });
        var std = {};
        var isos = rows.map(function (r) { return r.iso; });
        items.forEach(function (it) {
          var list = stdsFor(stds, cat, st, it).filter(function (s) { return isos.some(function (iso) { return inRange(iso, s); }); });
          if (!list.length) return;
          std[it] = list.length === 1 ? (list[0].text || list[0].lines.join('~')) : list.map(function (s) { return (s.text || s.lines.join('~')) + '（' + periodNote(s) + '）'; }).join('／');
        });
        blocks.push({ st: st, rows: rows, std: std });
      });
      return { name: g, items: items, units: units, blocks: blocks };
    });
  }

  /* ---------- 資料異常檢查 ---------- */
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    var pos = (sorted.length - 1) * q, b = Math.floor(pos), r = pos - b;
    return sorted[b + 1] !== undefined ? sorted[b] + r * (sorted[b + 1] - sorted[b]) : sorted[b];
  }
  function nameKey(s) { return String(s).replace(/[\s()（）\[\]【】「」、,，.。\-－_]/g, '').replace(/外$|側$|附近$/, '').toLowerCase(); }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    var d = [];
    for (var i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (var j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function anomalies(recs, stds, o) {
    o = o || {};
    var ok = o.ok || {}, conflicts = o.conflicts || [];
    var out = [];
    function add(a) { if (!ok[a.id]) out.push(a); }
    var byCat = {};
    recs.forEach(function (r) { (byCat[r.cat] = byCat[r.cat] || []).push(r); });
    Object.keys(byCat).forEach(function (cat) {
      var rs = byCat[cat];
      var byItem = {};
      rs.forEach(function (r) { (byItem[r.item] = byItem[r.item] || []).push(r); });
      var textItems = {};
      Object.keys(byItem).forEach(function (it) { if (isTextItem(byItem[it])) textItems[it] = 1; });
      // 1. 判讀不出的數值
      rs.forEach(function (r) {
        if (r.excl || textItems[r.item]) return;
        var k = valOf(r.raw).kind;
        if (k === 'text') add({ id: 'txt|' + r.k, type: 'text', level: 'err', cat: cat, k: r.k, rec: r, msg: '數值「' + r.raw + '」不是數字、ND 或 <x，無法畫圖' });
      });
      // 2. 異常高低值（同站同測項 ≥6 筆，超過四分位距 3 倍）
      var bySI = {};
      rs.forEach(function (r) { if (!r.excl && !textItems[r.item]) (bySI[r.st + '|' + r.item] = bySI[r.st + '|' + r.item] || []).push(r); });
      Object.keys(bySI).forEach(function (key) {
        var g = bySI[key];
        var nums = g.map(function (r) { return valOf(r.raw).num; }).filter(function (v) { return v != null; });
        if (nums.length < 6) return;
        var s = nums.slice().sort(function (a, b) { return a - b; });
        var q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1, med = quantile(s, 0.5);
        if (!(iqr > 0)) return;
        // 範圍至少放寬到中位數的 ±50%，避免噪音這類變化很小的資料被過度提醒
        var wid = Math.max(3 * iqr, Math.abs(med) * 0.5);
        var lo = q1 - wid, hi = q3 + wid;
        g.forEach(function (r) {
          var v = valOf(r.raw).num;
          if (v == null) return;
          if (v > hi || v < lo) add({ id: 'out|' + r.k + '|' + r.raw, type: 'outlier', level: 'warn', cat: cat, k: r.k, rec: r, msg: '與此站歷次數值差異很大（中位數 ' + (+med.toPrecision(4)) + '，一般範圍約 ' + (+Math.max(nums[0] >= 0 ? 0 : -Infinity, lo).toPrecision(3)) + '～' + (+hi.toPrecision(3)) + '），請確認是否打錯或單位不同' });
        });
      });
      // 3. 缺測項（該站其他採樣都有、這次沒有）
      var bySD = {}, stItems = {};
      rs.forEach(function (r) {
        var k2 = r.st + '|' + r.iso + '|' + (r.note || '');
        (bySD[k2] = bySD[k2] || { st: r.st, iso: r.iso, note: r.note, dl: r.dl, items: {} }).items[r.item] = 1;
        (stItems[r.st] = stItems[r.st] || {})[r.item] = (stItems[r.st][r.item] || 0) + 1;
      });
      Object.keys(bySD).forEach(function (k2) {
        var d = bySD[k2], cnts = stItems[d.st];
        var total = Object.keys(bySD).filter(function (x) { return bySD[x].st === d.st; }).length;
        if (total < 3) return;
        var miss = Object.keys(cnts).filter(function (it) { return !d.items[it] && cnts[it] >= Math.max(2, total * 0.6); });
        if (miss.length) add({ id: 'miss|' + cat + '|' + k2 + '|' + miss.join(','), type: 'missing', level: 'warn', cat: cat, st: d.st, iso: d.iso, note: d.note, dl: d.dl, items: miss, msg: '這次採樣少了 ' + miss.length + ' 個測項：' + miss.join('、') + '（此站其他採樣大多有）' });
      });
      // 3b. 兩站在相同日期的數值全部一樣（v1.0.8）：可能是同一站名稱不同，也可能是數值誤植（複製貼上），讓使用者確認
      var sts = uniq(rs.map(function (r) { return r.st; }));
      var vmap = {};   // 測站 → 日期|測項 → 數值（同一天多筆，例如平日／假日，排序後合併）
      rs.forEach(function (r) {
        if (r.excl || textItems[r.item]) return;
        var m = vmap[r.st] = vmap[r.st] || {}, kk = r.iso + '|' + r.item;
        (m[kk] = m[kk] || []).push(String(r.raw).trim());
      });
      var sameVal = {};
      for (var p = 0; p < sts.length; p++) for (var q = p + 1; q < sts.length; q++) {
        var A = vmap[sts[p]] || {}, B = vmap[sts[q]] || {}, common = 0, numEq = 0, diff = false, days = {};
        Object.keys(A).forEach(function (kk) {
          if (diff || !B[kk]) return;
          common++;
          if (A[kk].slice().sort().join('\u0001') !== B[kk].slice().sort().join('\u0001')) { diff = true; return; }
          A[kk].forEach(function (v) { if (valOf(v).kind === 'num') numEq++; });
          days[kk.split('|')[0]] = 1;
        });
        if (diff || numEq < 3) continue;
        var dl = Object.keys(days).sort().map(rocDate);
        sameVal[sts[p] + '\u0001' + sts[q]] = 1;
        add({ id: 'same|' + cat + '|' + sts[p] + '|' + sts[q], type: 'sameval', level: 'warn', cat: cat, names: [sts[p], sts[q]], days: dl, msg: '測站「' + sts[p] + '」與「' + sts[q] + '」在相同日期的 ' + common + ' 個數值完全一樣（' + dl.slice(0, 6).join('、') + (dl.length > 6 ? ' 等 ' + dl.length + ' 天' : '') + '）。若是同一站名稱不同，請歸入其中一站；若不是同一站，可能是數值誤植（複製貼上），請到資料檢視核對報告。' });
      }
      // 4. 名稱很像的測站（數值全部一樣的已在上面提醒，不重複）
      for (var i = 0; i < sts.length; i++) for (var j = i + 1; j < sts.length; j++) {
        var a = nameKey(sts[i]), b = nameKey(sts[j]);
        if (!a || !b) continue;
        var digitsA = a.replace(/\D/g, ''), digitsB = b.replace(/\D/g, '');
        if (digitsA !== digitsB) continue; // 只差編號（第1點、第2點）是不同測站
        // 只差方位字（上游／下游、北岸／南岸、東側／西側）是同一處的不同測站，不提醒（v1.0.6）
        var DIR = /[上中下左右東西南北前後內外]/g;
        if (a !== b && a.length === b.length && a.replace(DIR, '') === b.replace(DIR, '')) continue;
        if (sameVal[sts[i] + '\u0001' + sts[j]]) continue;
        if (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0 || (Math.min(a.length, b.length) >= 4 && lev(a, b) <= 1)) {
          add({ id: 'sim|' + cat + '|' + sts[i] + '|' + sts[j], type: 'similar', level: 'warn', cat: cat, names: [sts[i], sts[j]], msg: '測站「' + sts[i] + '」與「' + sts[j] + '」名稱很像，可能是同一站' });
        }
      }
      // 5. 同測項單位不一致
      Object.keys(byItem).forEach(function (it) {
        var us = uniq(byItem[it].map(function (r) { return r.unit || ''; }).filter(Boolean));
        if (us.length > 1) add({ id: 'unit|' + cat + '|' + it + '|' + us.join(','), type: 'unit', level: 'warn', cat: cat, item: it, units: us, msg: '測項「' + it + '」出現不同單位：' + us.join('、') });
      });
      // 6. 超過標準值（提示）
      rs.forEach(function (r) {
        if (r.excl || textItems[r.item]) return;
        var v = valOf(r.raw).num, s = stdFor(stds, cat, r.st, r.item, r.iso);
        if (v == null || !s || !s.lines || !s.lines.length) return;
        if (stdJudge(v, s)) add({ id: 'std|' + r.k + '|' + r.raw, type: 'over', level: 'info', cat: cat, k: r.k, rec: r, msg: ((s.mode === 'min') ? '低於標準值 ' : (s.mode === 'range' || (!s.mode && s.lines.length >= 2)) ? '超出標準範圍 ' : '超過標準值 ') + stdLabel(s) });
      });
    });
    // 7. 匯入時數值不同而被覆蓋
    conflicts.forEach(function (c) {
      add({ id: 'conf|' + c.k + '|' + c.old + '|' + c.raw, type: 'conflict', level: 'warn', cat: c.cat, k: c.k, rec: recs.filter(function (r) { return r.k === c.k; })[0] || null, msg: c.how === 'merge' ? '測站「' + c.from + '」歸入「' + c.to + '」時同一天數值不同：「' + c.from + '」為「' + c.old + '」（' + (c.oldSrc || '') + '），「' + c.to + '」為「' + c.raw + '」（' + (c.src || '') + '），目前用「' + c.to + '」的值' : '兩份檔案數值不同：原本「' + c.old + '」（' + (c.oldSrc || '') + '），已改為「' + c.raw + '」（' + (c.src || '') + '）' });
    });
    return out;
  }

  return { rocDate: rocDate, rocMonth: rocMonth, rocY: rocY, quarterOf: quarterOf, inPeriod: inPeriod, stdFor: stdFor, stdsFor: stdsFor, periodNote: periodNote, monthNote: monthNote, inRange: inRange, stdJudge: stdJudge, stdLabel: stdLabel, catalog: catalog, buildCharts: buildCharts, reportTables: reportTables, anomalies: anomalies, isTextItem: isTextItem, labelOf: labelOf, nameKey: nameKey };
});
