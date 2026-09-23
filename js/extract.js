/* 監測報告趨勢圖產生器 — 表格判讀
 * 不依賴特定公司的格式：掃描表格內容，自動找出「日期」「測站」「測項」「數值」「標準值」。
 * 兩種判讀方式：
 *   1. 有日期的結果表（季報、年報、月報、彙整表）：日期在同一欄往下排（一般），或在同一列往右排（轉置，例如海域水質）。
 *   2. 沒有日期欄的單次檢測報告（檢驗室報告）：從「採樣地點／監測日期」等欄位取得測站與日期，再找測項與數值區塊。
 * 輸出一律是 dataset：{ engine, cat, caption, recs:[{st,iso,dl,note,item,unit,raw}], stds:[{st,item,text,lines,label}], warn:[] }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DBG = { on: false, log: function () { if (typeof console !== 'undefined') console.log.apply(console, arguments); } };

  var CJK = '\\u3400-\\u9fff\\uff08\\uff09\\uff1a\\u3001';
  var RE_SP_CJK = new RegExp('\\s+(?=[' + CJK + '])|(?<=[' + CJK + '])\\s+', 'g');
  function norm(s) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48); })
      .replace(/．/g, '.');
    return s.replace(RE_SP_CJK, '');
  }

  /* ---------- 日期 ---------- */
  var RE_DATE = /(^|[^\d.])(\d{2,4})\s*([.\/\-年])\s*(\d{1,2})\s*[.\/\-月]\s*(\d{1,2})\s*日?/;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parseDate(s) {
    s = norm(s);
    var m = RE_DATE.exec(s);
    if (!m) return null;
    var y = +m[2], mo = +m[4], d = +m[5];
    if (m[2].length <= 3) y += 1911;
    if (y < 1980 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var after = s.slice(m.index + m[0].length);
    // 範圍：~25、~113/03/01、至115年5月12日、–06
    var rng = /^\s*(?:[~～\-－–至到]\s*(?:\d{2,4}\s*[.\/\-年]\s*)?(?:\d{1,2}\s*[.\/\-月]\s*)?\d{1,2}\s*日?)?/.exec(after);
    var used = rng ? rng[0] : '';
    var label = norm(s.slice(m.index + m[1].length, m.index + m[0].length) + used);
    var rest = norm(s.slice(0, m.index + m[1].length) + ' ' + after.slice(used.length))
      .replace(/^\s*\d{1,2}\s*時\s*\d{0,2}\s*分?/, '').replace(/^[\s,，;；()（）]+|[\s,，;；]+$/g, '');
    rest = rest.replace(/^[(（](.*)[)）]$/, '$1').replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim();
    return { iso: y + '-' + pad(mo) + '-' + pad(d), label: label, rest: rest };
  }
  function isDateCell(s) {
    var d = parseDate(s);
    return !!(d && d.rest.length <= 10 && !/[\d.]{3,}/.test(d.rest));
  }

  /* ---------- 數值 ---------- */
  var RE_BLANK = /^(?:|[-－—–―]+|\*+|＊+|\/|NA|N\/A|n\.a\.|※|…|\.\.\.|－－|無)$/i;
  function parseVal(raw) {
    var s = norm(raw).replace(/\s+/g, '');
    if (RE_BLANK.test(s)) return { kind: 'blank', num: null };
    s = s.replace(/[*＊#]+$/, '');
    if (/^N\.?D\.?(?:[<(（].*)?$/i.test(s) || s === '未檢出' || s === '未檢測出') return { kind: 'nd', num: null };
    if (/^[<＜≦≤][\d.]+$/.test(s)) return { kind: 'lt', num: null };
    if (/^[>＞≧≥][\d.]+$/.test(s)) return { kind: 'gt', num: null };
    var sci = /^([+-]?\d*\.?\d+)[×xX\*]10\^?([+-]?\d{1,2})$/.exec(s);
    if (sci) return { kind: 'num', num: +sci[1] * Math.pow(10, +sci[2]) };
    if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return { kind: 'num', num: +s.replace(/,/g, '') };
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return { kind: 'num', num: +s };
    return { kind: 'text', num: null };
  }
  function isValueLike(s) { var k = parseVal(s).kind; return k === 'num' || k === 'nd' || k === 'lt' || k === 'gt'; }
  function isBlank(s) { return parseVal(s).kind === 'blank'; }
  function stdLines(text) {
    var s = norm(text);
    if (!s || RE_BLANK.test(s.replace(/\s/g, ''))) return [];
    var out = [];
    var re = /\d*\.?\d+/g, m;
    while ((m = re.exec(s))) {
      var v = +m[0], pre = s.charAt(m.index - 1), pre2 = s.charAt(m.index - 2);
      if (pre === '-' && !/[\d.]/.test(pre2)) v = -v;
      if (isFinite(v)) out.push(v);
    }
    // 「5~9月38度」這類說明文字不是標準值
    if (/月/.test(s) && out.length > 2) return [];
    var seen = {};
    return out.filter(function (v) { if (seen[v]) return false; seen[v] = 1; return true; }).slice(0, 3);
  }

  /* ---------- 單位與名稱 ---------- */
  var RE_UNIT = /(dB\s*\(\s*[AC]\s*\)|μg\/m[3³]|µg\/m[3³]|ug\/m[3³]|mg\/m[3³]|mg\/L|mg\/l|mg\/kg|μg\/L|ppm|ppb|℃|°C|μmho\/cm(?:25℃)?|μS\/cm|mS\/cm|CFU\/100\s*mL|MPN\/100\s*mL|NTU|psu|公噸重?\/平方公里\/月|克\/[(（]?平方公尺[.．]?30天[)）]?|g\/m2\/30天|公噸\/km2\/月|m3\/min|m\/sec|m\/s|hPa|dB|％|%)/;
  var RE_UNIT_ONLY = new RegExp('^[(（]?\\s*' + RE_UNIT.source + '\\s*[)）]?$|^(?:－|-|—|無單位|單位)$');
  function splitUnit(s) {
    s = norm(s);
    var m = RE_UNIT.exec(s), unit = '';
    if (m) {
      unit = m[1].replace(/\s+/g, '').replace('ug/', 'μg/').replace('µg/', 'μg/').replace('°C', '℃').replace('％', '%');
      s = (s.slice(0, m.index) + s.slice(m.index + m[0].length));
    }
    s = s.replace(/[(（]\s*[)）]/g, '').replace(/\s+/g, ' ').trim();
    return { name: s, unit: unit };
  }
  var RE_TIME_PAREN = /\s*[(（]\s*(?:\d{1,2}\s*[:：]?\s*\d{0,2}\s*)?[~～\-－–至]\s*(?:翌日)?\s*\d{1,2}\s*[:：]?\s*\d{0,2}\s*(?:時)?\s*[)）]/g;
  function cleanItem(s) {
    return norm(s).replace(RE_TIME_PAREN, '').replace(/[(（]\s*註\s*\d*\s*[)）]/g, '').replace(/[:：]$/, '').replace(/\s+/g, ' ').trim();
  }
  var RE_NOTE = /^(施工前|施工中|施工後|施工期間|營運前|營運中|營運期間|營運後|平日|假日|平常日|例假日|非假日|漲潮|退潮|滿潮|乾潮|上午|下午|白天|夜間|第\s*\d+\s*次|背景值?|對照)$/;
  var RE_STD = /標準|基準|限值|法規|管制值|規範值|參考值|閾值/;
  var RE_STAT = /^(?:最大|最小|最高|最低)?(?:\d+\s*小時|日|月|年|季)?(?:平均值?|值|總量|累積值?|最大值?|最小值?)$|^(?:最大|最小)(?:小時|日)?(?:平均值?|值)$|^(?:平均值?|最大值?|最小值?)$/;
  var RE_HOUR = /^\d{1,2}\s*[:：]?\s*\d{0,2}\s*[~～\-－–至]\s*\d{1,2}\s*[:：]?\s*\d{0,2}$/;

  /* ---------- 類別 ---------- */
  var CATS = ['空氣品質', '噪音振動', '營建噪音振動', '營建低頻噪音', '工區放流水', '河川水', '地下水', '土壤', '海域水質', '海域底質'];
  var CAT_RULES = [
    [/低頻/, '營建低頻噪音'],
    [/營建.{0,6}(噪音|振動)|(噪音|振動).{0,6}營建|固定音源|工區周界/, '營建噪音振動'],
    [/底質|底泥/, '海域底質'],
    [/海域|海水/, '海域水質'],
    [/放流水|放流口/, '工區放流水'],
    [/河川|溪|排水路|橋.{0,3}水質/, '河川水'],
    [/地下水|監測井/, '地下水'],
    [/土壤/, '土壤'],
    [/噪音|振動|音量|L日|Leq|Lmax|Lv10/i, '噪音振動'],
    [/空氣|空品|TSP|PM10|PM2\.5|懸浮微粒|落塵/, '空氣品質']
  ];
  function guessCat(text) {
    for (var i = 0; i < CAT_RULES.length; i++) if (CAT_RULES[i][0].test(text)) return CAT_RULES[i][1];
    return '';
  }

  /* ---------- 從標題取得測站 ---------- */
  var GENERIC_ST = /^(本季|本年度|本年|本月|本期|歷次|歷季|各測站|各測點|各站|施工期間|施工前|施工中|營運期間|工區|環境|監測|全部|彙整|附表|附錄)+$/;
  function captionStation(cap) {
    var c = norm(cap).replace(/^表\s*[\dA-Za-z一二三四五六七八九十.\-－–]+\s*/, '')
      .replace(/[(（]\s*\d+\s*\/\s*\d+\s*[)）]/g, '').replace(/[(（]續[)）]/g, '');
    var m = /^(.{2,24}?)(環境噪音|環境振動|噪音|振動|空氣品質|空品|河川|水質|放流水|地下水|土壤|海域|底質|監測|檢測|測定)/.exec(c);
    if (!m) return '';
    var st = m[1].replace(/^\d{2,4}\s*年(度)?(第?[一二三四1-4]季)?/, '').replace(/^(本季|本年度|本年|本月|歷次|施工期間|各)+/, '').replace(/(之|的|處)$/, '');
    if (!st || GENERIC_ST.test(st) || st.length < 2) return '';
    return st;
  }

  function colOf(rows, c) { return rows.map(function (r) { return r[c] || ''; }); }
  function uniqPush(arr, s) { if (s && arr.indexOf(s) < 0) arr.push(s); }

  /* ================= 1. 有日期的結果表 ================= */
  function extractDated(t, hint) {
    var R = t.rows.map(function (r) { return r.map(norm); });
    var H = R.length, W = H ? R[0].length : 0;
    if (H < 2 || W < 2) return null;
    var isD = R.map(function (r) {
      return r.map(function (v, c) {
        if (!isDateCell(v) || /[:：]/.test(v)) return false;
        // 「報告日期：115.05.04」這類表頭欄位的日期不是資料
        for (var k = c - 1; k >= 0 && k >= c - 3; k--) {
          var L = r[k];
          if (!L || L === v) continue;
          if (/[:：]$/.test(L) || /報告|收樣|列印|簽署|核發/.test(L)) return false;
          break;
        }
        return true;
      });
    });
    var cntC = [], cntR = [];
    for (var c = 0; c < W; c++) { var n = 0; for (var r = 0; r < H; r++) if (isD[r][c]) n++; cntC.push(n); }
    for (var r2 = 0; r2 < H; r2++) cntR.push(isD[r2].filter(Boolean).length);
    var colBest = Math.max.apply(null, cntC), rowBest = Math.max.apply(null, cntR);
    if (!colBest) return null;
    var transposed = rowBest > colBest;
    if (rowBest === colBest && rowBest === 1) {
      var dr = cntR.indexOf(1), dc = isD[dr].indexOf(true);
      var below = 0, right = 0;
      for (var rr = dr + 1; rr < H; rr++) if (isValueLike(R[rr][dc])) below++;
      for (var cc = dc + 1; cc < W; cc++) if (isValueLike(R[dr][cc])) right++;
      transposed = below > right;
    }
    return transposed ? extractTransposed(R, isD, cntR, t, hint) : extractRows(R, isD, cntC, t, hint);
  }

  function extractRows(R, isD, cntC, t, hint) {
    var H = R.length, W = R[0].length;
    var dc = cntC.indexOf(Math.max.apply(null, cntC));
    var dataRows = [];
    for (var r = 0; r < H; r++) if (isD[r][dc]) dataRows.push(r);
    var r0 = dataRows[0];
    // 欄位分類
    var valCols = [], textCols = [];
    for (var c = 0; c < W; c++) {
      if (c === dc) continue;
      var nv = 0, nt = 0, nn = 0;
      dataRows.forEach(function (r) {
        var v = R[r][c];
        if (!v) return;
        nn++;
        if (isValueLike(v) || isBlank(v)) nv++; else nt++;
      });
      if (!nn) continue;
      if (nv / dataRows.length >= 0.5 && nv >= nt) valCols.push(c);
      else textCols.push(c);
    }
    if (!valCols.length) return null;
    var firstVal = valCols[0];
    var labelCols = textCols.filter(function (c) { return c < firstVal; });
    var textItems = textCols.filter(function (c) { return c > firstVal; });
    var noteCols = [], stCols = [];
    labelCols.forEach(function (c) {
      var vals = dataRows.map(function (r) { return R[r][c]; }).filter(Boolean);
      if (vals.length && vals.every(function (v) { return RE_NOTE.test(v) || RE_STD.test(v); })) noteCols.push(c);
      else stCols.push(c);
    });
    // 表頭列（資料列上方，最多 4 列；整列同一段文字的是表內標題）
    var hdr = [], innerTitle = '';
    for (var h = Math.max(0, r0 - 4); h < r0; h++) {
      var ne = R[h].filter(Boolean);
      if (ne.length && ne.every(function (x) { return x === ne[0]; }) && W > 2) { innerTitle = ne[0]; continue; }
      hdr.push(h);
    }
    var unitRow = -1;
    hdr.forEach(function (h) {
      var cells = valCols.map(function (c) { return R[h][c]; }).filter(Boolean);
      if (/^單位$/.test(R[h][dc]) || labelCols.some(function (c) { return /^單位$/.test(R[h][c]); }) ||
        (cells.length && cells.filter(function (x) { return RE_UNIT_ONLY.test(x); }).length / cells.length >= 0.6)) unitRow = h;
    });
    var cornerTexts = {};
    hdr.forEach(function (h) { [dc].concat(labelCols).forEach(function (c) { if (R[h][c]) cornerTexts[R[h][c]] = 1; }); });
    var cols = valCols.concat(textItems).sort(function (a, b) { return a - b; });
    var colInfo = cols.map(function (c) {
      var parts = [], unit = '';
      hdr.forEach(function (h) {
        var v = R[h][c];
        if (!v || cornerTexts[v]) return;
        if (h === unitRow) { if (!unit) unit = splitUnit(v).unit || (v !== '－' && v !== '-' ? v : ''); return; }
        var su = splitUnit(v);
        if (su.unit && !unit) unit = su.unit;
        uniqPush(parts, cleanItem(su.name));
      });
      parts = parts.filter(Boolean);
      if (unit && parts.some(function (p) { return norm(p).toLowerCase() === norm(unit).toLowerCase(); })) unit = ''; // 單位列寫「pH」等於測項名
      return { c: c, parts: parts, unit: unit, text: textItems.indexOf(c) >= 0 };
    });
    nameCols(colInfo);
    // 表格測站（沒有測站欄時）
    var tableSt = captionStation(t.caption) || captionStation(innerTitle) || (t.sheet && !/^(工作表|sheet)\s*\d*$/i.test(t.sheet) ? norm(t.sheet) : '');
    var recs = [], stds = [], warn = [];
    var curSt = '', groupSts = [], lastStdRow = -1, lastTargets = null;
    function rowLab(r) { return [dc].concat(labelCols).map(function (c) { return R[r][c]; }).join(' '); }
    for (var r = r0; r < H; r++) {
      if (isD[r][dc] && !RE_STD.test(rowLab(r))) {
        var d = parseDate(R[r][dc]);
        var st = stCols.map(function (c) { return R[r][c]; }).filter(function (x) { return x && !RE_NOTE.test(x); }).join(' ');
        if (!st && stCols.length) st = curSt;
        if (!st) st = tableSt;
        curSt = st;
        uniqPush(groupSts, st);
        var notes = [];
        noteCols.forEach(function (c) { uniqPush(notes, R[r][c]); });
        stCols.forEach(function (c) { if (RE_NOTE.test(R[r][c])) uniqPush(notes, R[r][c]); });
        if (d.rest) uniqPush(notes, d.rest);
        colInfo.forEach(function (ci) {
          var raw = R[r][ci.c];
          if (raw === '') return;
          recs.push({ st: st, iso: d.iso, dl: d.label, note: notes.join(' '), item: ci.name, unit: ci.unit, raw: raw, text: ci.text });
        });
      } else {
        var lab = rowLab(r);
        var hasNum = valCols.some(function (c) { return stdLines(R[r][c]).length; });
        if (RE_STD.test(lab) && hasNum) {
          var targets = stCols.length ? (groupSts.length ? groupSts.slice() : (lastTargets || ['*'])) : ['*'];
          lastTargets = targets;
          colInfo.forEach(function (ci) {
            if (ci.text) return;
            var txt = R[r][ci.c], ln = stdLines(txt);
            if (!ln.length) return;
            var per = stdPeriod(lab);
            targets.forEach(function (st) { stds.push({ st: st, item: ci.name, text: txt, lines: ln, label: norm(lab.split(' ')[0]), from: per.from, to: per.to }); });
          });
          groupSts = [];
          lastStdRow = r;
        }
      }
    }
    if (!tableSt && !stCols.length) warn.push('找不到測站名稱，請在下方填寫');
    return {
      engine: 'rows', recs: recs, stds: dedupeStd(stds, uniqList(recs.map(function (x) { return x.st; }))), warn: warn,
      stations: uniqList(recs.map(function (x) { return x.st; })),
      catText: [t.caption, innerTitle].concat(hdr.map(function (h) { return R[h].join(' '); })).join(' ')
    };
  }
  // 標準列的適用期間：「113年9月30日前適用」→ 到 113/9/29；「113年9月30日後（起）適用」→ 從 113/9/30
  function stdPeriod(label) {
    var d = parseDate(label);
    if (!d) return {};
    var rest = d.rest || '';
    if (/^(以前|之前|前)/.test(rest)) {
      var t = new Date(d.iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1);
      return { to: t.toISOString().slice(0, 10) };
    }
    if (/^(以後|之後|後|起)/.test(rest)) return { from: d.iso };
    return {};
  }
  function uniqList(a) { var o = []; a.forEach(function (x) { uniqPush(o, x); }); return o; }
  function dedupeStd(stds, stations) {
    var m = {};
    stds.forEach(function (s) { m[s.st + '|' + s.item + '|' + (s.from || '') + '|' + (s.to || '')] = s; }); // 同站同測項同期間以最後一列為準
    var list = Object.keys(m).map(function (k) { return m[k]; });
    // 表內每一站同一測項的標準都相同 → 合併成「全部測站」
    if (stations && stations.length > 1) {
      var byItem = {};
      list.forEach(function (s) { (byItem[s.item] = byItem[s.item] || []).push(s); });
      list = [];
      Object.keys(byItem).forEach(function (it) {
        var g = byItem[it];
        var sts = g.map(function (s) { return s.st; });
        var same = g.every(function (s) { return s.text === g[0].text && !s.from && !s.to; }) && stations.every(function (st) { return sts.indexOf(st) >= 0 || sts.indexOf('*') >= 0; });
        if (same) list.push({ st: '*', item: it, text: g[0].text, lines: g[0].lines, label: g[0].label });
        else list = list.concat(g);
      });
    }
    return list;
  }
  function nameCols(colInfo) {
    // 先用最下層表頭；重複時改用完整路徑
    colInfo.forEach(function (ci) { ci.name = ci.parts.length ? ci.parts[ci.parts.length - 1] : ''; });
    var cnt = {};
    colInfo.forEach(function (ci) { cnt[ci.name] = (cnt[ci.name] || 0) + 1; });
    var fullGroup = {};
    colInfo.forEach(function (ci) {
      if (ci.parts.length > 1 && (cnt[ci.name] > 1 || RE_STAT.test(ci.name))) fullGroup[ci.parts.slice(0, -1).join('|')] = 1;
    });
    colInfo.forEach(function (ci) {
      if (!ci.name || cnt[ci.name] > 1 || fullGroup[ci.parts.slice(0, -1).join('|')]) ci.name = ci.parts.join(' ');
    });
    var cnt2 = {};
    colInfo.forEach(function (ci) {
      if (!ci.name) ci.name = '第' + (ci.c + 1) + '欄';
      cnt2[ci.name] = (cnt2[ci.name] || 0) + 1;
      if (cnt2[ci.name] > 1) ci.name += '（' + cnt2[ci.name] + '）';
    });
  }

  function extractTransposed(R, isD, cntR, t, hint) {
    var H = R.length, W = R[0].length;
    var dr = cntR.indexOf(Math.max.apply(null, cntR));
    // 測項欄：日期列下方文字最多的欄
    var ic = -1, best = 0;
    for (var c = 0; c < W; c++) {
      var n = 0;
      for (var r = dr + 1; r < H; r++) { var v = R[r][c]; if (v && !isValueLike(v) && !isBlank(v) && !RE_UNIT_ONLY.test(v)) n++; }
      if (n > best) { best = n; ic = c; }
      if (best >= 2 && c > 2) break;
    }
    if (ic < 0) return null;
    // 資料列：測項欄為文字，且右方有數值
    var dataRows = [];
    for (var r3 = dr + 1; r3 < H; r3++) {
      var lab = R[r3][ic];
      if (!lab || isValueLike(lab) || /[:：]$/.test(lab)) continue;
      var nv = 0;
      for (var c3 = ic + 1; c3 < W; c3++) if (isValueLike(R[r3][c3])) nv++;
      if (nv) dataRows.push(r3);
    }
    if (!dataRows.length) return null;
    var hdrRows = [];
    for (var h = 0; h < dataRows[0]; h++) hdrRows.push(h);
    function hdrText(c) { return hdrRows.map(function (h) { return R[h][c]; }).join(' '); }
    var unitCol = -1, stdCols = [], valCols = [];
    for (var c4 = ic + 1; c4 < W; c4++) {
      var ht = hdrText(c4);
      var vals = dataRows.map(function (r) { return R[r][c4]; });
      if (/單位/.test(ht) || vals.filter(Boolean).every(function (v) { return RE_UNIT_ONLY.test(v); })) { if (unitCol < 0) unitCol = c4; continue; }
      if (/偵測極限|MDL|定量極限|檢測方法|方法/.test(ht)) continue;
      if (RE_STD.test(ht) || /上限值|下限值/.test(ht)) { stdCols.push(c4); continue; }
      var nv2 = vals.filter(function (v) { return isValueLike(v) || isBlank(v); }).length;
      if (nv2 / dataRows.length >= 0.5) valCols.push(c4);
    }
    if (!valCols.length) return null;
    var hdrLabels = {};
    hdrRows.forEach(function (h) { for (var c = 0; c <= ic; c++) if (R[h][c]) hdrLabels[R[h][c]] = 1; });
    var tableSt = captionStation(t.caption);
    var recs = [], stds = [], stations = [];
    valCols.forEach(function (c) {
      var d = null, parts = [], notes = [];
      hdrRows.forEach(function (h) {
        var v = R[h][c];
        if (!v || hdrLabels[v]) return;
        if (isDateCell(v)) { if (!d) d = parseDate(v); return; }
        if (RE_NOTE.test(v)) { uniqPush(notes, v); return; }
        uniqPush(parts, v);
      });
      if (!d) { for (var cl = c; cl >= 0 && !d; cl--) if (isD[dr][cl]) d = parseDate(R[dr][cl]); }
      if (!d) return;
      if (d.rest) uniqPush(notes, d.rest);
      var st = parts.join(' ') || tableSt;
      uniqPush(stations, st);
      dataRows.forEach(function (r) {
        var raw = R[r][c];
        if (raw === '') return;
        var su = splitUnit(R[r][ic]);
        recs.push({ st: st, iso: d.iso, dl: d.label, note: notes.join(' '), item: cleanItem(su.name), unit: unitCol >= 0 ? (splitUnit(R[r][unitCol]).unit || (RE_UNIT_ONLY.test(R[r][unitCol]) ? '' : R[r][unitCol])) : su.unit, raw: raw });
      });
    });
    stdCols.forEach(function (c) {
      var lab = norm(hdrRows.map(function (h) { return R[h][c]; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join(' '));
      dataRows.forEach(function (r) {
        var ln = stdLines(R[r][c]);
        if (!ln.length) return;
        stds.push({ st: '*', item: cleanItem(splitUnit(R[r][ic]).name), text: R[r][c], lines: ln, label: lab, col: c });
      });
    });
    // 同測項多個標準欄（上限值、下限值）→ 合併成多條線
    var merged = {};
    stds.forEach(function (s) {
      var k = s.item;
      if (!merged[k]) merged[k] = { st: '*', item: s.item, text: s.text, lines: s.lines.slice(), label: s.label };
      else if (merged[k].label !== s.label) {
        merged[k].text += '；' + s.text; merged[k].label += '／' + s.label;
        s.lines.forEach(function (v) { if (merged[k].lines.indexOf(v) < 0) merged[k].lines.push(v); });
      }
    });
    return {
      engine: 'transposed', recs: recs, stds: Object.keys(merged).map(function (k) { return merged[k]; }), warn: tableSt || stations.some(Boolean) ? [] : ['找不到測站名稱，請在下方填寫'],
      stations: stations, catText: t.caption + ' ' + hdrRows.map(function (h) { return R[h].join(' '); }).join(' ')
    };
  }

  /* ================= 2. 單次檢測報告（沒有日期欄） ================= */
  var RE_META_ITEM = /次數|日期|時間|座標|高度|距離|編號|人員|天氣|氣壓|壓力|降雨|儀器|校正|頁次|電話|傳真|地址|^晴|^陰|^雨|多雲|營造業|採樣行程|樣品|客戶|檢驗室/;
  var RE_ST_LABEL = /^(採樣地點|監測地點|檢測地點|採樣位置|監測位置|測站名稱|測點名稱|測點位置|測站|樣品名稱|監測點|調查地點)\s*[:：]?\s*(.*)$/;
  var RE_DATE_LABEL = /^(監測日期|採樣日期|採樣時間|檢測日期|測定日期|調查日期|監測時間|採樣期間|監測期間|測定時間|日期)[^:：]{0,8}[:：]?\s*(.*)$/;
  var RE_VHDR_VAL = /檢測值|檢驗值|測值|檢測結果|分析結果|結果|濃度|數值/;
  var RE_ROLE_SKIP = /單位|極限|MDL|定量|方法|備註|說明|頁|編號$/;
  function metaOf(R) {
    var st = '', d = null, title = '', notes = [];
    function right(r, c) {
      for (var k = c + 1; k < Math.min(R[r].length, c + 8); k++) {
        var v = R[r][k];
        if (v && v !== R[r][c]) return v;
      }
      return '';
    }
    for (var r = 0; r < R.length; r++) for (var c = 0; c < R[r].length; c++) {
      var v = R[r][c];
      if (!v || (c > 0 && R[r][c - 1] === v)) continue;
      if (!title && /報告|紀錄|記錄/.test(v) && v.length <= 30) title = v;
      if (/^樣品特性/.test(v)) title += ' ' + (v.replace(/^樣品特性\s*[:：]?/, '') || right(r, c));
      var m;
      if (!st && (m = RE_ST_LABEL.exec(v))) { st = m[2] || right(r, c); }
      if (!d && (m = RE_DATE_LABEL.exec(v)) && !/收樣|報告|分析|列印/.test(v)) {
        var dd = parseDate(m[2]) || parseDate(right(r, c));
        if (dd) { d = dd; if (dd.rest) uniqPush(notes, dd.rest); var lbn = /[(（](平日|假日)[)）]/.exec(v); if (lbn) uniqPush(notes, lbn[1]); }
      }
    }
    if (!d) { // 日期拆在一欄裡直排（例：115／年／5／月／11／日）
      for (var c2 = 0; c2 < (R[0] || []).length && !d; c2++) {
        var s = R.map(function (row) { return row[c2]; }).filter(function (x, i, a) { return x && a[i - 1] !== x; }).join('');
        var dd2 = parseDate(s);
        if (dd2 && /年.*月.*日/.test(s)) d = dd2;
      }
    }
    return { st: norm(st), d: d, title: title, notes: notes };
  }
  function extractForm(t, hint) {
    var R = t.rows.map(function (r) { return r.map(norm); });
    var H = R.length;
    if (H < 2) return null;
    var meta = metaOf(R);
    // 列分類
    function segOf(row, from) {
      var lc = -1, lab = '';
      for (var c = from; c < row.length; c++) {
        var v = row[c];
        if (!v) continue;
        if (!isValueLike(v) && !isBlank(v)) { lc = c; lab = v; break; }
        if (isValueLike(v)) break;
      }
      var vals = [], next = row.length;
      if (lc >= 0) {
        var started = false;
        for (var c2 = lc + 1; c2 < row.length; c2++) {
          var v2 = row[c2];
          if (!v2 || v2 === lab) continue;
          if (isValueLike(v2)) { vals.push(c2); started = true; }
          else if (!isBlank(v2)) {
            if (!started && c2 - lc <= 2 && !/[:：]/.test(v2) && v2.length <= 12) continue; // 標籤旁的副標（例：空氣品質標準｜小時平均值）或單位
            if (v2.length <= 4 && !/[:：]/.test(v2)) {
              if (started) {
                var nx = '';
                for (var c3 = c2 + 1; c3 < row.length; c3++) if (row[c3] && row[c3] !== v2) { nx = row[c3]; break; }
                if (!nx || isValueLike(nx) || isBlank(nx)) { vals.push(c2); continue; } // 風向等短文字數值
              }
            }
            next = c2; // 碰到下一個文字區塊（另一組標籤）
            break;
          }
        }
      }
      return { lc: lc, lab: lab, vals: vals, next: next };
    }
    var info = R.map(function (row) {
      var segs = [], from = 0, guard = 0;
      while (from < row.length && guard++ < 12) {
        var sg = segOf(row, from);
        if (sg.lc < 0) break;
        segs.push(sg);
        if (sg.next >= row.length) break;
        from = sg.next;
      }
      var first = segs[0] || { lc: -1, lab: '', vals: [] };
      var firsts = row.filter(Boolean).slice(0, 3);
      var hourly = RE_HOUR.test(first.lab) || firsts.some(function (x) { return RE_HOUR.test(x) || /^\S{1,3}\s*[~～]\s*\S{1,3}$/.test(x); });
      return { lc: first.lc, lab: first.lab, vals: first.vals, segs: segs, hourly: hourly, texts: row.map(function (v) { return v && !isValueLike(v) && !isBlank(v); }) };
    });
    function isHdrCandidate(r, cols) {
      var i = info[r];
      if (i.hourly) return false;
      var hit = cols.filter(function (c) { return i.texts[c] || (c > 0 && R[r][c] === '' && false); }).length;
      return hit >= Math.max(1, Math.ceil(cols.length * 0.5));
    }
    function hits(h, cols) { return cols.filter(function (c) { return info[h].texts[c]; }).length; }
    function headerRows(r, cols) {
      var out = [], weak = 0;
      for (var h = r - 1; h >= 0 && r - h <= 40; h--) {
        var i = info[h];
        if (!out.length) {
          if (!R[h].some(Boolean) || i.hourly) continue;
          if (i.vals.length && !isHdrCandidate(h, cols)) continue; // 其他數值列
          if (isHdrCandidate(h, cols)) out.unshift(h);
          continue;
        }
        if (!R[h].some(Boolean) || i.hourly || i.vals.length > cols.length / 2) break;
        if (cols.some(function (c) { var v = R[h][c] || ''; return v.length > 24 || /[:：]/.test(v); })) break; // 長句／表單標籤列
        if (isHdrCandidate(h, cols)) { out.unshift(h); weak = 0; }
        else if (hits(h, cols) && weak < 1 && cols.every(function (c) { return (R[h][c] || '').length <= 12; })) { out.unshift(h); weak++; }
        else break;
        if (out.length >= 4) break;
      }
      while (out.length && !isHdrCandidate(out[0], cols)) out.shift();
      return out;
    }
    var recs = [], stds = [], used = {};
    var st = meta.st || captionStation(t.caption) || '', d = meta.d;
    var noteStr = meta.notes.join(' ');
    if (!noteStr && t.sheet) { var sn = /[(（](平|假)[)）]/.exec(t.sheet); if (sn) noteStr = sn[1] === '平' ? '平日' : '假日'; }
    // --- 直式清單（測項往下排）
    for (var r = 0; r < H; r++) {
      if (used[r] || info[r].lc < 0) continue;
      var h0 = r - 1;
      while (h0 >= 0 && !R[h0].some(Boolean)) h0--;
      if (h0 < 0) continue;
      var hdr = [h0];
      if (h0 > 0 && R[h0 - 1].some(Boolean) && !info[h0 - 1].vals.length) hdr.unshift(h0 - 1);
      var lc = info[r].lc;
      var hc = R[h0].map(function (x, c) { var ps = []; hdr.forEach(function (h) { uniqPush(ps, R[h][c]); }); return ps.join(' '); });
      if (!/^(?:樣品編號\s*)?(?:檢驗|檢測|分析|測定|監測|測試|水質|試驗)?(?:項目|參數)(?:名稱)?$|^(?:Parameter|Item|Analyte)s?$/i.test(norm(hc[lc] || '').replace(/[\/／].*$/, ''))) continue;
      var roles = hc.map(function (x, c) {
        if (c <= lc || !x) return '';
        if (/單位/.test(x)) return 'unit';
        if (RE_STD.test(x)) return 'std';
        if (RE_ROLE_SKIP.test(x) && !RE_VHDR_VAL.test(x)) return 'skip';
        return 'val';
      });
      var vcols = [];
      roles.forEach(function (ro, c) { if (ro === 'val') vcols.push(c); });
      // 直式清單的數值欄表頭必須是「檢測值／結果」或樣品編號，否則是橫式表頭（測項名稱在表頭）
      vcols = vcols.filter(function (c) { return RE_VHDR_VAL.test(hc[c]) || /[A-Za-z].*\d{3,}|\d{3,}.*[A-Za-z]/.test(hc[c]); });
      if (!vcols.length) continue;
      var block = [];
      for (var rr = r; rr < H; rr++) {
        var lab = R[rr][lc];
        if (!lab) { if (block.length && !R[rr].some(Boolean)) break; continue; }
        if (/以下空白|備註|註[:：]|^註|^※/.test(lab) || lab.length > 30) break;
        if (isValueLike(lab)) break;
        block.push(rr);
      }
      if (block.length < 2) continue;
      var unitC = roles.indexOf('unit'), stdC = roles.indexOf('std');
      var valCols = vcols.filter(function (c) { return block.some(function (rr) { return isValueLike(R[rr][c]); }); });
      if (!valCols.length) continue;
      block.forEach(function (rr) {
        used[rr] = 1;
        var su = splitUnit(R[rr][lc]);
        var item = cleanItem(su.name);
        var unit = unitC >= 0 ? (splitUnit(R[rr][unitC]).unit || (RE_UNIT_ONLY.test(R[rr][unitC]) ? '' : R[rr][unitC])) : su.unit;
        valCols.forEach(function (c) {
          var raw = R[rr][c];
          if (raw === '' ) return;
          var s2 = valCols.length > 1 ? norm(hc[c]).replace(RE_VHDR_VAL, '').trim() || st : st;
          recs.push({ st: s2, iso: d ? d.iso : '', dl: d ? d.label : '', note: noteStr, item: item, unit: unit, raw: raw });
        });
        if (stdC >= 0) { var ln = stdLines(R[rr][stdC]); if (ln.length) stds.push({ st: '*', item: item, text: R[rr][stdC], lines: ln, label: hc[stdC] }); }
      });
      r = block[block.length - 1];
    }
    // --- 橫式區塊（測項在表頭、數值往右排）
    var blocks = {};
    var segList = [];
    info.forEach(function (x, r) { x.segs.forEach(function (sg) { segList.push({ r: r, sg: sg }); }); });
    for (var si = 0; si < segList.length; si++) {
      var r2 = segList[si].r, I = segList[si].sg;
      if (used[r2] || info[r2].hourly || !I.vals.length || I.lc < 0) continue;
      if (isDateCell(I.lab) || /[:：]$/.test(I.lab) || /^[※＊*]|^註/.test(I.lab)) continue;
      var hdr2 = headerRows(r2, I.vals);
      if (!hdr2.length) continue;
      // 表頭格不可是「欄位名稱：」這類表單標籤或長句
      if (I.vals.some(function (c) { return hdr2.some(function (h) { var v = R[h][c]; return v && (/[:：]/.test(v) || v.length > 24); }); })) continue;
      var hh = hdr2[hdr2.length - 1];
      var hdrItems = I.vals.filter(function (c) { return info[hh].texts[c]; }).length;
      var nHdrTexts = info[hh].texts.filter(Boolean).length;
      if (I.vals.length < 2 && nHdrTexts < 3) continue; // 單一數值的「欄位：值」不是結果表
      if (!hdrItems) continue;
      var isStd = RE_STD.test(I.lab);
      if (!isStd) {
        for (var k = Math.max(0, r2 - 5); k < r2 && !isStd; k++) {
          for (var c5 = Math.max(0, I.lc - 1); c5 <= I.vals[I.vals.length - 1]; c5++) if (/^(?:適用)?(?:法規值|法規標準|法規|管制標準|標準值|限值|管制值)[:：]?$/.test(R[k][c5] || '')) { isStd = true; break; }
        }
      }
      var key = hh + '|' + I.lc;
      if (!blocks[key]) blocks[key] = { hdr: hdr2, lc: I.lc, rows: [], stdRows: [], seg: {} };
      blocks[key].seg[r2] = I;
      if (hdr2.length > blocks[key].hdr.length) blocks[key].hdr = hdr2;
      (isStd ? blocks[key].stdRows : blocks[key].rows).push(r2);
    }
    if (DBG.on) DBG.log('blocks', JSON.stringify(blocks), 'info', JSON.stringify(info.map(function (x, i) { return i + ':' + x.lc + ':' + x.lab.slice(0, 8) + ':' + x.vals.join(',') + (x.hourly ? 'H' : ''); })));
    Object.keys(blocks).forEach(function (k) {
      var B = blocks[k];
      var S = function (r) { return B.seg[r]; };
      var unitRow = -1;
      var cols = {};
      B.rows.concat(B.stdRows).forEach(function (r) { S(r).vals.forEach(function (c) { cols[c] = 1; }); });
      var cl = Object.keys(cols).map(Number).sort(function (a, b) { return a - b; });
      B.hdr.forEach(function (h) {
        var cells = cl.map(function (c) { return R[h][c]; }).filter(Boolean);
        if (cells.length && cells.filter(function (x) { return RE_UNIT_ONLY.test(x); }).length / cells.length >= 0.6) unitRow = h;
      });
      var labelHdr = {};
      B.hdr.forEach(function (h) { for (var c = 0; c <= B.lc; c++) if (R[h][c]) labelHdr[R[h][c]] = 1; });
      var ci = [];
      cl.forEach(function (c) {
        var parts = [], unit = '';
        B.hdr.forEach(function (h) {
          var v = R[h][c];
          if (!v || labelHdr[v]) return;
          if (h === unitRow) { unit = unit || splitUnit(v).unit; return; }
          var su = splitUnit(v);
          if (su.unit && !unit) unit = su.unit;
          uniqPush(parts, cleanItem(su.name));
        });
        parts = parts.filter(Boolean);
        var prev = ci[ci.length - 1];
        // 合併儲存格造成的重複欄
        if (prev && prev.parts.join('|') === parts.join('|') && B.rows.concat(B.stdRows).every(function (r) { return R[r][c] === R[r][prev.c] || R[r][c] === ''; })) return;
        if (!parts.length) return;
        ci.push({ c: c, parts: parts, unit: unit });
      });
      if (ci.length < 2 && B.rows.length < 2) return; // 單一數值的欄位：值 不是結果表
      nameCols(ci);
      // 垂直合併造成的重複列（例：日平均值或／最頻風向）→ 合成一列
      // 與標準列同名的列（合併儲存格重複）也是標準列
      var stdLabs = B.stdRows.map(function (r) { return S(r).lab; });
      B.rows = B.rows.filter(function (r) { if (stdLabs.indexOf(S(r).lab) >= 0) { B.stdRows.push(r); return false; } return true; });
      var merged = [], labOf = {};
      B.rows.forEach(function (r) {
        var prev = merged[merged.length - 1];
        var same = prev != null && r === prev + 1 && S(r).vals.join(',') === S(prev).vals.join(',') && S(r).vals.every(function (c) { return R[r][c] === R[prev][c]; });
        if (same) { if (labOf[prev].indexOf(S(r).lab) < 0) labOf[prev] += S(r).lab; }
        else { merged.push(r); labOf[r] = S(r).lab; }
      });
      B.rows = merged;
      B.rows.forEach(function (r) { S(r).lab = labOf[r]; });
      var multi = B.rows.length > 1;
      function rowName(lab, colName) {
        var rl = cleanItem(lab);
        if (rl.indexOf('或') > 0) { // 「日平均值或最頻風向」：依欄位挑一個
          var alts = rl.split('或');
          var wd = /風向/.test(colName);
          rl = alts.filter(function (a) { return /風向/.test(a) === wd; })[0] || alts[0];
        }
        return rl;
      }
      var stdCi = ci.filter(function (x) { return RE_STD.test(x.name); });
      ci = ci.filter(function (x) { return !RE_STD.test(x.name); });
      B.rows.forEach(function (r) {
        ci.forEach(function (x) {
          var raw = R[r][x.c];
          if (raw === '' || !isValueLike(raw) && isBlank(raw)) return;
          var rl = rowName(S(r).lab, x.name);
          var nm = multi ? x.name + ' ' + rl : x.name;
          recs.push({ st: st, iso: d ? d.iso : '', dl: d ? d.label : '', note: noteStr, item: nm, base: x.name, rowLab: rl, unit: x.unit, raw: raw });
          stdCi.forEach(function (sc) { var ln = stdLines(R[r][sc.c]); if (ln.length) stds.push({ st: '*', item: nm, text: R[r][sc.c], lines: ln, label: sc.name }); });
        });
      });
      B.stdRows.forEach(function (r) {
        var sub = R[r].slice(B.lc + 1, S(r).vals[0]).filter(function (x) { return x && !isBlank(x) && x !== S(r).lab; }).join(' ');
        ci.forEach(function (x) {
          var ln = stdLines(R[r][x.c]);
          if (!ln.length) return;
          var targets = multi ? B.rows.map(function (rr) { return x.name + ' ' + rowName(S(rr).lab, x.name); }) : [x.name];
          if (sub && multi) {
            var subN = cleanItem(sub);
            var hit = targets.filter(function (n) {
              var i2 = n.indexOf(subN);
              if (i2 < 0) return false;
              var rem = (n.slice(0, i2) + n.slice(i2 + subN.length)).replace(x.name, '').trim();
              return /^(最大|最高)?$/.test(rem);
            });
            targets = hit; // 副標對不到任何測項就不套用，避免套錯
          }
          targets.forEach(function (n) { stds.push({ st: '*', item: n, text: R[r][x.c], lines: ln, label: cleanItem(S(r).lab) + (sub ? ' ' + sub : '') }); });
        });
      });
    });
    // 「Lv日(Lv10)= 37.6」這類「名稱＝數值」的寫法
    var inlineSeen = {};
    for (var r4 = 0; r4 < H; r4++) {
      for (var c4 = 0; c4 < R[r4].length; c4++) {
        var v4 = R[r4][c4], m4 = /^(.{1,24}?)\s*[=＝]$/.exec(v4 || '');
        if (!m4 || (c4 > 0 && R[r4][c4 - 1] === v4)) continue;
        for (var k4 = c4 + 1; k4 < Math.min(R[r4].length, c4 + 4); k4++) {
          var nv4 = R[r4][k4];
          if (!nv4 || nv4 === v4) continue;
          if (isValueLike(nv4)) {
            var nm4 = cleanItem(m4[1]);
            if (!inlineSeen[nm4] && !recs.some(function (x) { return x.item === nm4; })) {
              inlineSeen[nm4] = 1;
              recs.push({ st: st, iso: d ? d.iso : '', dl: d ? d.label : '', note: noteStr, item: nm4, unit: '', raw: nv4 });
            }
          }
          break;
        }
      }
    }
    // 橫式標準區塊的測項名稱若與結果不同（例：Leq(日) 對 Leq）→ 以去掉括號後的名稱比對
    var itemNames = uniqList(recs.map(function (x) { return x.item; }));
    stds = stds.map(function (s) {
      if (itemNames.indexOf(s.item) >= 0) return [s];
      var key = s.item.replace(/[(（][^)）]*[)）]/g, '').trim();
      var hit = recs.filter(function (x) { return (x.base || x.item).replace(/[(（][^)）]*[)）]/g, '').trim() === key; }).map(function (x) { return x.item; });
      return uniqList(hit).map(function (n) { return { st: s.st, item: n, text: s.text, lines: s.lines, label: s.label }; });
    }).reduce(function (a, b) { return a.concat(b); }, []);
    recs = recs.filter(function (x) { return !RE_META_ITEM.test(x.item); });
    if (!recs.length) return null;
    var warn = [];
    if (!st) warn.push('找不到測站（採樣地點），請在下方填寫');
    if (!d) warn.push('找不到監測日期，請在下方填寫');
    recs.forEach(function (x) { if (!x.st) x.st = st; });
    return { engine: 'form', recs: recs, stds: dedupeStd(stds), warn: warn, stations: uniqList(recs.map(function (x) { return x.st; })), catText: t.caption + ' ' + meta.title, meta: meta };
  }

  /* ================= 入口 ================= */
  function datedOk(ds) {
    if (!ds || !ds.recs.length) return false;
    if (ds.stations.some(function (x) { return /[:：]/.test(x) || x.length > 40; })) return false;
    var items = uniqList(ds.recs.map(function (x) { return x.item; }));
    var bad = items.filter(function (n) { return /^第\d+欄/.test(n) || isValueLike(n) || /[:：]/.test(n); }).length;
    if (bad / items.length > 0.3) return false;
    var dates = uniqList(ds.recs.map(function (x) { return x.iso; }));
    var numeric = ds.recs.filter(function (x) { return !x.text && isValueLike(x.raw); }).length;
    return numeric >= 2 && (dates.length >= 2 || items.length - bad >= 2);
  }
  function extractTable(t, hint) {
    var ds = null;
    try { ds = extractDated(t, hint); } catch (e) { ds = null; }
    if (!datedOk(ds)) ds = null;
    if (!ds || !ds.recs.length) {
      try { ds = extractForm(t, hint); } catch (e2) { ds = null; }
      // 報告書（Word）裡沒有日期的表格多半是方法、品保、座標等說明表，不當成監測結果
      if (ds && !ds.meta.d && !(hint && hint.sheetBook && ds.meta.st)) ds = null;
    }
    if (!ds || !ds.recs.length) return null;
    var numeric = ds.recs.filter(function (x) { return !x.text && isValueLike(x.raw); }).length;
    if (numeric < 2) return null;
    ds.caption = t.caption || '';
    ds.sheet = t.sheet || '';
    ds.cat = guessCat([ds.catText, t.caption, (t.ctx || []).join(' '), hint && hint.fileName].join(' ')) || '';
    ds.likely = /結果|成果|監測值|檢測值|測值|報告/.test(ds.caption + (ds.meta ? ds.meta.title : '')) || ds.engine === 'form';
    return ds;
  }
  function extractAll(doc, hint) {
    var out = [];
    doc.tables.forEach(function (t, i) {
      var ds = extractTable(t, hint);
      if (ds) { ds.index = i; out.push(ds); }
    });
    return out;
  }

  return {
    norm: norm, parseDate: parseDate, isDateCell: isDateCell, parseVal: parseVal, isValueLike: isValueLike, stdLines: stdLines,
    splitUnit: splitUnit, cleanItem: cleanItem, stdPeriod: stdPeriod, captionStation: captionStation, guessCat: guessCat, CATS: CATS,
    extractTable: extractTable, extractAll: extractAll, DBG: DBG
  };
});
