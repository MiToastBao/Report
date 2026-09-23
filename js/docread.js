/* 監測報告趨勢圖產生器 — 文件讀取：.docx / .doc / .xlsx / .xls → 表格清單
 * 輸出：{ kind, tables:[{caption, ctx, rows:[[string]], sheet?}] }
 * - rows 為「展開後」的格線：水平合併（gridSpan）與垂直合併（vMerge）的格子都填入同一段文字。
 * - .doc 由 Word 97-2003 二進位格式直接解析（片段表 piece table ＋ 段落屬性 PAPX），不需要轉檔。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTDoc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Symbol 字型私用區（F0xx）→ 對應字元（μ、≤、≥ 等）
  var SYM = { a: 'α', b: 'β', c: 'χ', d: 'δ', e: 'ε', f: 'φ', g: 'γ', h: 'η', i: 'ι', k: 'κ', l: 'λ', m: 'μ', n: 'ν', o: 'ο', p: 'π', q: 'θ', r: 'ρ', s: 'σ', t: 'τ', u: 'υ', w: 'ω', x: 'ξ', y: 'ψ', z: 'ζ', D: 'Δ', W: 'Ω', S: 'Σ', F: 'Φ', G: 'Γ', L: 'Λ', P: 'Π', Q: 'Θ' };
  var SYMX = { 0xB0: '°', 0xA3: '≤', 0xB3: '≥', 0xB1: '±', 0xB4: '×', 0xB8: '÷', 0xAE: '→', 0xB7: '•', 0xA5: '∞', 0xB9: '≠', 0xBB: '≈', 0x2D: '−', 0x7E: '∼' };
  function symChar(code) {
    var c = code & 0xFF;
    if (SYMX[c]) return SYMX[c];
    var ch = String.fromCharCode(c);
    if (SYM[ch]) return SYM[ch];
    if (c >= 0x20 && c < 0x7F) return ch;
    return '';
  }
  function fixPua(s) {
    return s.replace(/[\uF020-\uF0FF]/g, function (m) { return symChar(m.charCodeAt(0)); });
  }
  function cleanCell(s) {
    return fixPua(String(s == null ? '' : s))
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .replace(/\u00A0|\u3000/g, ' ')
      .replace(/\r\n?|\n/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* ---------------- 共用：最後處理 ---------------- */
  function finishTable(rows) {
    var w = 0;
    rows.forEach(function (r) { if (r.length > w) w = r.length; });
    var out = rows.map(function (r) {
      var a = r.map(cleanCell);
      while (a.length < w) a.push('');
      return a;
    }).filter(function (r) { return r.some(function (x) { return x !== ''; }); });
    return out;
  }
  function captionOf(paras) {
    // 取表格前最近的「表x-x」段落，否則取最後一段
    for (var i = paras.length - 1; i >= Math.max(0, paras.length - 3); i--) {
      if (/^表\s*[\dA-Za-z一二三四五六七八九十]/.test(paras[i])) return paras[i];
    }
    return paras.length ? paras[paras.length - 1] : '';
  }

  /* ---------------- .docx ---------------- */
  function decodeXml(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(+d); })
      .replace(/&amp;/g, '&');
  }
  function attr(tag, name) {
    var m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag);
    return m ? m[1] : null;
  }
  // 以標籤流解析 document.xml（不依賴 DOMParser，node 測試也能跑）
  function parseDocxXml(xml) {
    var re = /<(\/?)([A-Za-z0-9_]+:[A-Za-z0-9_]+|[A-Za-z0-9_]+)([^>]*?)(\/?)>|([^<]+)/g;
    var m, tables = [], paras = [], stack = []; // stack of table contexts
    var skip = 0; // 在 txbxContent / Fallback / delText 內
    var skipTags = { 'w:txbxContent': 1, 'mc:Fallback': 1, 'w:delText': 1, 'w:instrText': 1 };
    var para = null; // 目前段落文字（表格外）
    var inT = false;
    var fld = 0; // 功能變數代碼層級（fldChar begin→separate 之間略過）
    var fldStack = [];
    function curCell() {
      var t = stack[stack.length - 1];
      return t && t.cell;
    }
    function emit(txt) {
      if (skip || !txt) return;
      if (fldStack.length && fldStack[fldStack.length - 1] === 'code') return;
      if (stack.length) {
        var c = curCell();
        if (c) c.text += txt;
      } else if (para !== null) para += txt;
    }
    while ((m = re.exec(xml))) {
      if (m[5] !== undefined) {
        if (inT) emit(decodeXml(m[5]));
        continue;
      }
      var close = m[1] === '/', name = m[2], rest = m[3], selfc = m[4] === '/';
      if (skipTags[name]) {
        if (close) skip--; else if (!selfc) skip++;
        continue;
      }
      if (skip) continue;
      switch (name) {
        case 'w:t':
          inT = !close && !selfc;
          break;
        case 'w:tab': if (!close) emit(' '); break;
        case 'w:br': case 'w:cr': if (!close) emit(' '); break;
        case 'w:sym':
          if (!close) {
            var ch = attr(rest, 'w:char');
            if (ch) emit(symChar(parseInt(ch, 16)));
          }
          break;
        case 'w:fldChar':
          var ft = attr(rest, 'w:fldCharType');
          if (ft === 'begin') fldStack.push('code');
          else if (ft === 'separate') { if (fldStack.length) fldStack[fldStack.length - 1] = 'result'; }
          else if (ft === 'end') fldStack.pop();
          break;
        case 'w:p':
          if (stack.length) {
            var c2 = curCell();
            if (close && c2) c2.text += '\n';
          } else if (!close && !selfc) para = '';
          else if (close) {
            var t = cleanCell(para || '');
            if (t) { paras.push(t); if (paras.length > 6) paras.shift(); }
            para = null;
          }
          break;
        case 'w:tbl':
          if (!close) {
            var outer = stack[stack.length - 1];
            stack.push({ rows: [], row: null, cell: null, caption: captionOf(paras), ctx: paras.slice(-3), parentCell: outer ? outer.cell : null });
          } else {
            var tb = stack.pop();
            if (stack.length) {
              // 巢狀表格：內容併回外層格子
              var pc = curCell();
              if (pc) pc.text += ' ' + tb.rows.map(function (r) { return r.map(function (c) { return c.text; }).join(' '); }).join(' ');
            } else tables.push(tb);
          }
          break;
        case 'w:tr':
          if (!stack.length) break;
          var T = stack[stack.length - 1];
          if (!close && !selfc) { T.row = []; T.rows.push(T.row); }
          else if (close) T.row = null;
          break;
        case 'w:tc':
          if (!stack.length) break;
          var T2 = stack[stack.length - 1];
          if (!close && !selfc) { T2.cell = { text: '', span: 1, vm: null }; if (T2.row) T2.row.push(T2.cell); }
          else if (close) T2.cell = null;
          break;
        case 'w:gridSpan':
          if (stack.length && !close) { var c3 = curCell(); if (c3) c3.span = +attr(rest, 'w:val') || 1; }
          break;
        case 'w:vMerge':
          if (stack.length && !close) { var c4 = curCell(); if (c4) c4.vm = attr(rest, 'w:val') || 'continue'; }
          break;
        case 'w:gridBefore':
          if (stack.length && !close) {
            var T3 = stack[stack.length - 1];
            var n = +attr(rest, 'w:val') || 0;
            if (T3.row) for (var k = 0; k < n; k++) T3.row.push({ text: '', span: 1, vm: null, pad: 1 });
          }
          break;
      }
    }
    return tables.map(function (tb) {
      var grid = [];
      tb.rows.forEach(function (r, ri) {
        var g = [];
        r.forEach(function (c) {
          for (var s = 0; s < c.span; s++) {
            var col = g.length;
            var txt = c.text;
            if (c.vm === 'continue' && ri > 0 && grid[ri - 1] && grid[ri - 1][col] != null) txt = grid[ri - 1][col];
            g.push(txt);
          }
        });
        grid.push(g);
      });
      return { caption: tb.caption, ctx: tb.ctx, rows: finishTable(grid) };
    });
  }
  async function readDocx(buf, JSZip) {
    var zip = await JSZip.loadAsync(buf);
    var f = zip.file('word/document.xml');
    if (!f) throw new Error('這個 .docx 裡找不到 word/document.xml，可能不是 Word 檔');
    var xml = await f.async('string');
    return { kind: 'docx', tables: parseDocxXml(xml) };
  }

  /* ---------------- .doc（Word 97-2003） ---------------- */
  var CP1252 = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };
  function u8(x) { return x instanceof Uint8Array ? x : new Uint8Array(x); }
  function sprmLen(sprm, b, p) {
    // 回傳 operand 長度（不含 sprm 本身 2 bytes）
    var spra = (sprm >> 13) & 7;
    switch (spra) {
      case 0: case 1: return 1;
      case 2: case 4: case 5: return 2;
      case 3: return 4;
      case 7: return 3;
      case 6:
        if (sprm === 0xD608 || sprm === 0xD606) return 2 + ((b[p] | (b[p + 1] << 8)) - 1);
        if (sprm === 0xC615) { var cb = b[p]; return cb === 255 ? 1 + 1 + b[p + 1] * 4 + 1 + b[p + 2 + b[p + 1] * 4] * 3 : 1 + cb; }
        return 1 + b[p];
    }
    return 1;
  }
  function parseGrpprl(b, start, end) {
    var out = [], p = start;
    while (p + 2 <= end) {
      var sprm = b[p] | (b[p + 1] << 8);
      p += 2;
      var len = sprmLen(sprm, b, p);
      out.push({ sprm: sprm, p: p, len: len });
      p += len;
    }
    return out;
  }
  function readFkps(wd, tbl, fcPlc, lcbPlc, kind) {
    // kind 'pap' | 'chp'：回傳 [{fcS, fcE, b, grp:[start,end]}]
    var runs = [];
    if (!lcbPlc) return runs;
    var dv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
    var n = (lcbPlc - 4) / 8;
    for (var i = 0; i < n; i++) {
      var pn = dv.getUint32(fcPlc + (n + 1) * 4 + i * 4, true) & 0x3FFFFF;
      var off = pn * 512;
      if (off + 512 > wd.length) continue;
      var dw = new DataView(wd.buffer, wd.byteOffset + off, 512);
      var crun = wd[off + 511];
      for (var k = 0; k < crun; k++) {
        var fcS = dw.getUint32(k * 4, true), fcE = dw.getUint32((k + 1) * 4, true);
        var s = -1, e = -1;
        if (kind === 'pap') {
          var bo = wd[off + (crun + 1) * 4 + k * 13];
          if (bo) {
            var q = off + bo * 2, cb = wd[q];
            if (cb) { s = q + 1; e = q + 1 + 2 * cb - 1; }
            else { cb = wd[q + 1]; s = q + 2; e = q + 2 + 2 * cb; }
            s += 2; // 跳過 istd
          }
        } else {
          var bo2 = wd[off + (crun + 1) * 4 + k];
          if (bo2) { var q2 = off + bo2 * 2, cb2 = wd[q2]; s = q2 + 1; e = q2 + 1 + cb2; }
        }
        runs.push({ fcS: fcS, fcE: fcE, s: s, e: e });
      }
    }
    runs.sort(function (a, b) { return a.fcS - b.fcS; });
    return runs;
  }
  function findRun(runs, fc) {
    var lo = 0, hi = runs.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, r = runs[mid];
      if (fc < r.fcS) hi = mid - 1;
      else if (fc >= r.fcE) lo = mid + 1;
      else return r;
    }
    return null;
  }
  function readDoc(buf, XLSX) {
    var data = u8(buf);
    var cfb = XLSX.CFB.read(data, { type: 'array' });
    function stream(name) {
      var e = XLSX.CFB.find(cfb, name);
      return e && e.content ? u8(e.content) : null;
    }
    var wd = stream('WordDocument');
    if (!wd) throw new Error('這個 .doc 檔裡找不到 WordDocument，可能不是 Word 97-2003 檔');
    var dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (dv.getUint16(0, true) !== 0xA5EC) throw new Error('.doc 檔頭不正確（不是 Word 97-2003 格式）');
    var flags = dv.getUint16(0x0A, true);
    if (flags & 0x0100) throw new Error('這個 .doc 有設定密碼保護，請先在 Word 取消密碼後再匯入');
    var tbl = stream((flags & 0x0200) ? '1Table' : '0Table');
    if (!tbl) throw new Error('.doc 缺少 Table 資料流');
    var csw = dv.getUint16(32, true);
    var pLw = 34 + csw * 2;
    var cslw = dv.getUint16(pLw, true);
    var ccpText = dv.getInt32(pLw + 2 + 3 * 4, true);
    var pFc = pLw + 2 + cslw * 4 + 2;
    function fcl(i) { return [dv.getUint32(pFc + i * 8, true), dv.getUint32(pFc + i * 8 + 4, true)]; }
    var clx = fcl(33), bteP = fcl(13), bteC = fcl(12);
    // 片段表
    var tdv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
    var p = clx[0], end = clx[0] + clx[1], pieces = null;
    while (p < end) {
      var t = tbl[p];
      if (t === 1) { p += 3 + tdv.getUint16(p + 1, true); }
      else if (t === 2) {
        var lcb = tdv.getUint32(p + 1, true), base = p + 5, n = (lcb - 4) / 12;
        pieces = [];
        for (var i = 0; i < n; i++) {
          var cpS = tdv.getUint32(base + i * 4, true), cpE = tdv.getUint32(base + (i + 1) * 4, true);
          var fcv = tdv.getUint32(base + (n + 1) * 4 + i * 8 + 2, true);
          var comp = !!(fcv & 0x40000000);
          var fc = comp ? (fcv & 0x3FFFFFFF) / 2 : fcv;
          pieces.push({ cpS: cpS, cpE: cpE, fc: fc, comp: comp });
        }
        break;
      } else break;
    }
    if (!pieces) throw new Error('.doc 片段表讀取失敗');
    var dataSt = stream('Data');
    var papRuns = readFkps(wd, tbl, bteP[0], bteP[1], 'pap');
    var chpRuns = readFkps(wd, tbl, bteC[0], bteC[1], 'chp');
    // 逐字取出本文（含 fc，供段落屬性查詢）
    var chars = []; // [char, fc]
    pieces.forEach(function (pc) {
      var s = pc.cpS, e = Math.min(pc.cpE, ccpText + 1);
      for (var cp = s; cp < e; cp++) {
        var fcx = pc.comp ? pc.fc + (cp - pc.cpS) : pc.fc + (cp - pc.cpS) * 2;
        var code;
        if (pc.comp) { code = wd[fcx]; if (CP1252[code]) code = CP1252[code]; }
        else code = wd[fcx] | (wd[fcx + 1] << 8);
        chars.push([code, fcx]);
      }
    });
    // 符號字元（sprmCSymbol 0x6A09）
    var symCache = new Map();
    function symAt(fc) {
      var r = findRun(chpRuns, fc);
      if (!r || r.s < 0) return null;
      if (symCache.has(r)) return symCache.get(r);
      var v = null;
      parseGrpprl(wd, r.s, r.e).forEach(function (g) {
        if (g.sprm === 0x6A09) v = symChar(wd[g.p + 2] | (wd[g.p + 3] << 8));
      });
      symCache.set(r, v);
      return v;
    }
    function papOf(fc) {
      var r = findRun(papRuns, fc), o = { inTable: false, ttp: false, itap: 0, innerTtp: false, tdef: null, vm: {} };
      if (!r || r.s < 0) return o;
      if (r.cache) return r.cache;
      var list = parseGrpprl(wd, r.s, r.e).map(function (g) { g.b = wd; return g; });
      // sprmPHugePapx（0x6646）：段落屬性太大時放在 Data 資料流
      list.slice().forEach(function (g) {
        if (g.sprm === 0x6646 && dataSt) {
          var off = wd[g.p] | (wd[g.p + 1] << 8) | (wd[g.p + 2] << 16) | (wd[g.p + 3] << 24);
          if (off >= 0 && off + 2 <= dataSt.length) {
            var cb = dataSt[off] | (dataSt[off + 1] << 8);
            parseGrpprl(dataSt, off + 2, Math.min(dataSt.length, off + 2 + cb)).forEach(function (h) { h.b = dataSt; list.push(h); });
          }
        }
      });
      list.forEach(function (g) {
        var wd = g.b;
        var v = wd[g.p];
        switch (g.sprm) {
          case 0x2416: o.inTable = !!v; if (v && !o.itap) o.itap = 1; break;
          case 0x2417: o.ttp = !!v; break;
          case 0x6649: o.itap = wd[g.p] | (wd[g.p + 1] << 8) | (wd[g.p + 2] << 16); if (o.itap) o.inTable = true; break;
          case 0x244C: o.innerTtp = !!v; break;
          case 0xD608: {
            var q = g.p + 2, itc = wd[q], cen = [];
            for (var i = 0; i <= itc; i++) { var x = wd[q + 1 + i * 2] | (wd[q + 2 + i * 2] << 8); if (x & 0x8000) x -= 0x10000; cen.push(x); }
            var tcs = [], tp = q + 1 + (itc + 1) * 2, lim = g.p + g.len;
            for (var j = 0; j < itc && tp + 20 <= lim; j++, tp += 20) {
              var grf = wd[tp] | (wd[tp + 1] << 8);
              tcs.push({ hm: grf & 3, vm: (grf >> 5) & 3 });
            }
            o.tdef = { cen: cen, tcs: tcs };
            break;
          }
          case 0xD62B: { // sprmTVertMerge
            o.vm[wd[g.p + 1]] = wd[g.p + 2];
            break;
          }
        }
      });
      r.cache = o;
      return o;
    }
    // 功能變數：\x13 代碼 \x14 結果 \x15
    var tables = [], paras = [], rows = null, row = null, cell = '', cellsMeta = null;
    var fstack = [], cur = '', tableCaption = '', tableCtx = [];
    function pushPara(txt) {
      var t = cleanCell(txt);
      if (t) { paras.push(t); if (paras.length > 6) paras.shift(); }
    }
    function endTable() {
      if (rows && rows.length) tables.push(buildDocGrid(rows, tableCaption, tableCtx));
      rows = null;
    }
    for (var ci = 0; ci < chars.length; ci++) {
      var code = chars[ci][0], fcc = chars[ci][1];
      if (code === 0x13) { fstack.push('code'); continue; }
      if (code === 0x14) { if (fstack.length) fstack[fstack.length - 1] = 'res'; continue; }
      if (code === 0x15) { fstack.pop(); continue; }
      if (fstack.length && fstack[fstack.length - 1] === 'code') continue;
      if (code === 0x0D || code === 0x07) {
        var pp = papOf(fcc);
        if (!pp.inTable) {
          endTable();
          pushPara(cur); cur = '';
          continue;
        }
        if (!rows) { rows = []; row = []; tableCaption = captionOf(paras); tableCtx = paras.slice(-3); }
        if (pp.itap > 1) { // 巢狀表格內容併入外層格
          cur += ' ';
          continue;
        }
        if (code === 0x07) {
          if (pp.ttp) { // 列結束
            rows.push({ cells: row, tdef: pp.tdef, vm: pp.vm });
            row = [];
          } else { row.push(cur); }
          cur = '';
        } else cur += '\n';
        continue;
      }
      if (rows && !(papOf(fcc).inTable)) { /* 表格後的第一個字 */ }
      var chs;
      if (code === 0x28 || (code >= 0xF000 && code <= 0xF0FF)) {
        var sy = symAt(fcc);
        chs = sy != null ? sy : (code >= 0xF000 ? symChar(code) : '(');
      } else if (code === 0x0B || code === 0x09 || code === 0x0C || code === 0x0E) chs = ' ';
      else if (code === 0x1E) chs = '-';
      else if (code === 0x1F || code < 0x09 || (code > 0x0D && code < 0x20)) chs = '';
      else chs = String.fromCharCode(code);
      cur += chs;
    }
    endTable();
    return { kind: 'doc', tables: tables };
  }
  function buildDocGrid(rows, caption, ctx) {
    // 依各列 rgdxaCenter 建立統一欄界，展開水平／垂直合併
    var edges = [];
    rows.forEach(function (r) { if (r.tdef) r.tdef.cen.forEach(function (x) { edges.push(x); }); });
    edges.sort(function (a, b) { return a - b; });
    var uniq = [];
    edges.forEach(function (x) { if (!uniq.length || x - uniq[uniq.length - 1] > 30) uniq.push(x); });
    function idx(x) {
      var best = 0, bd = Infinity;
      for (var i = 0; i < uniq.length; i++) { var d = Math.abs(uniq[i] - x); if (d < bd) { bd = d; best = i; } }
      return best;
    }
    var grid = [];
    rows.forEach(function (r, ri) {
      var g = [];
      var cen = r.tdef && r.tdef.cen.length === r.cells.length + 1 ? r.tdef.cen : null;
      r.cells.forEach(function (txt, k) {
        var a, b;
        if (cen && uniq.length > 1) { a = idx(cen[k]); b = idx(cen[k + 1]); if (b <= a) b = a + 1; }
        else { a = g.length; b = a + 1; }
        var tc = r.tdef && r.tdef.tcs[k];
        var vm = r.vm[k] != null ? r.vm[k] : (tc ? tc.vm : 0);
        var cont = vm === 1 || vm === 2; // 1＝與上一格合併（續）
        if (tc && tc.hm === 2 && g.length) { // 舊式水平合併：併入前一格
          for (var hx = a; hx < b; hx++) g[hx] = g[a - 1] != null ? g[a - 1] : '';
          return;
        }
        for (var c = a; c < b; c++) {
          var v = txt;
          if (cont && ri > 0 && grid[ri - 1][c] != null) v = grid[ri - 1][c];
          while (g.length < c) g.push('');
          g[c] = v;
        }
      });
      grid.push(g);
    });
    return { caption: caption, ctx: ctx, rows: finishTable(grid) };
  }

  /* ---------------- .xlsx / .xls ---------------- */
  function readSheetBook(buf, XLSX, kind) {
    var wb = XLSX.read(u8(buf), { type: 'array', cellDates: false, cellStyles: false, sheetStubs: false });
    var tables = [];
    wb.SheetNames.forEach(function (name) {
      var ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) return;
      var rg = XLSX.utils.decode_range(ws['!ref']);
      var maxR = Math.min(rg.e.r, rg.s.r + 3000), maxC = Math.min(rg.e.c, rg.s.c + 80);
      var grid = [];
      for (var r = rg.s.r; r <= maxR; r++) {
        var row = [];
        for (var c = rg.s.c; c <= maxC; c++) {
          var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
          var v = '';
          if (cell) {
            if (cell.t === 'n' && cell.w != null) v = cell.w;
            else if (cell.w != null) v = cell.w;
            else if (cell.v != null) v = String(cell.v);
          }
          row.push(v);
        }
        grid.push(row);
      }
      (ws['!merges'] || []).forEach(function (m) {
        var r0 = m.s.r - rg.s.r, c0 = m.s.c - rg.s.c;
        if (r0 < 0 || c0 < 0 || r0 >= grid.length) return;
        var v = grid[r0][c0];
        for (var r2 = m.s.r; r2 <= m.e.r; r2++) for (var c2 = m.s.c; c2 <= m.e.c; c2++) {
          var rr = r2 - rg.s.r, cc = c2 - rg.s.c;
          if (rr < grid.length && cc < grid[rr].length) grid[rr][cc] = v;
        }
      });
      // 去掉尾端全空欄
      var rows = finishTable(grid);
      var w = 0;
      rows.forEach(function (r) { for (var i = r.length - 1; i >= 0; i--) if (r[i] !== '') { if (i + 1 > w) w = i + 1; break; } });
      rows = rows.map(function (r) { return r.slice(0, w); });
      if (rows.length) tables.push({ caption: name, ctx: [], rows: rows, sheet: name });
    });
    return { kind: kind, tables: tables };
  }

  /* ---------------- 入口 ---------------- */
  function sniff(u) {
    if (u[0] === 0x50 && u[1] === 0x4B) return 'zip';
    if (u[0] === 0xD0 && u[1] === 0xCF && u[2] === 0x11 && u[3] === 0xE0) return 'cfb';
    return '';
  }
  async function readFile(name, buf, libs) {
    var u = u8(buf), s = sniff(u), ext = (String(name).match(/\.([A-Za-z0-9]+)$/) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    if (s === 'zip') {
      var zip = await libs.JSZip.loadAsync(u);
      if (zip.file('word/document.xml')) return readDocx(u, libs.JSZip);
      if (zip.file('xl/workbook.xml')) return readSheetBook(u, libs.XLSX, 'xlsx');
      throw new Error('無法辨認的檔案內容（不是 Word 或 Excel）');
    }
    if (s === 'cfb') {
      var cfb = libs.XLSX.CFB.read(u, { type: 'array' });
      if (libs.XLSX.CFB.find(cfb, 'WordDocument')) return readDoc(u, libs.XLSX);
      if (libs.XLSX.CFB.find(cfb, 'Workbook') || libs.XLSX.CFB.find(cfb, 'Book')) return readSheetBook(u, libs.XLSX, 'xls');
      if (libs.XLSX.CFB.find(cfb, 'EncryptionInfo')) throw new Error('這個檔案有設定密碼保護，請先取消密碼後再匯入');
      throw new Error('無法辨認的舊版 Office 檔（不是 Word 或 Excel）');
    }
    if (ext === 'csv') return readSheetBook(u, libs.XLSX, 'csv');
    throw new Error('只支援 .docx、.doc、.xlsx、.xls（' + (ext ? '這個檔是 .' + ext : '無副檔名') + '）');
  }

  return { readFile: readFile, readDocx: readDocx, readDoc: readDoc, readSheetBook: readSheetBook, parseDocxXml: parseDocxXml, cleanCell: cleanCell, symChar: symChar };
});
