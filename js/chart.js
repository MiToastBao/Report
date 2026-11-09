/* 監測報告趨勢圖產生器 — 趨勢長條圖（畫面／高解析 PNG）與 Excel 原生圖表 XML
 * spec = { title, unit, cats:[標籤], series:[{name, values:[{raw,num,kind}|null]}], stdLines:[{v,label}], kind:'station'|'item', station? }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTChart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FONT = '"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans CJK TC","Noto Sans TC",sans-serif';
  // v1.0.16（#58）24 色不重複：前 12 色不變；後 12 色避開標準值的紅（#E03131）與藍（#1238A6）
  var PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E', '#636363', '#997300', '#255E91', '#43682B',
    '#E377C2', '#8E44AD', '#16A085', '#17BECF', '#BCBD22', '#C2185B', '#C5B0D5', '#C49C94', '#98DF8A', '#1B1B1B', '#FFBB78', '#7B68EE'];
  var SINGLE = '#5B9BD5', STD = '#E03131', STD_LO = '#1238A6';
  /* v1.0.16（#52）上下標：PM10／PM2.5 的數字、化學式（SO2、NO2、O3、NH3…）的數字、NOx 的 x 用下標；單位 m3、m2 用上標。
     plain：不套用的文字（測站名稱，例如「B2測站」不要變下標）。回傳 [{t, m:'n'|'sub'|'sup'}] */
  var ELEM = ' H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Ag Cd Sn Sb I Ba Pt Au Hg Tl Pb Bi ';
  var SINGLE_F = { O3: 1, O2: 1, N2: 1, H2: 1, Cl2: 1 };
  function richSegs(text, plain) {
    text = String(text == null ? '' : text);
    var m = [], i, k, r;
    for (i = 0; i < text.length; i++) m.push('n');
    var mark = function (a, b, v) { for (var j = a; j < b; j++) m[j] = v; };
    var re = /PM(\d+(?:\.\d+)?)/g;
    while ((r = re.exec(text))) { if (!/[A-Za-z]/.test(text.charAt(r.index + r[0].length))) mark(r.index + 2, r.index + r[0].length, 'sub'); }
    re = /NOx(?![A-Za-z0-9])/g;
    while ((r = re.exec(text))) mark(r.index + 2, r.index + 3, 'sub');
    re = /(^|[^A-Za-z0-9])((?:[A-Z][a-z]?\d*)+)(?![A-Za-z0-9])/g;
    while ((r = re.exec(text))) {
      var tok = r[2], st = r.index + r[1].length, parts = tok.match(/[A-Z][a-z]?\d*/g) || [];
      if (!/\d/.test(tok) || /^PM/.test(tok)) continue;
      if (!parts.every(function (p) { return ELEM.indexOf(' ' + p.replace(/\d+$/, '') + ' ') >= 0; })) continue;
      if (parts.length < 2 && !SINGLE_F[tok]) continue;
      var pos = st; parts.forEach(function (p) { var sym = p.replace(/\d+$/, ''); mark(pos + sym.length, pos + p.length, 'sub'); pos += p.length; });
    }
    // v1.0.17（#60）離子：化學式後面接 +／-（後面不是字母，所以 NO3-N 的 -N 不算）＝電荷上標。
    //   多原子離子最後一組數字兩位以上時最後一位是電荷（SO42- → SO₄²⁻、PO43- → PO₄³⁻），一位時是下標（NO3- → NO₃⁻、NH4+ → NH₄⁺）；
    //   單一元素的數字是電荷（Ca2+ → Ca²⁺、Fe3+ → Fe³⁺、Cl- → Cl⁻）；化學式後空一格再寫電荷（SO4 2-）也可以
    re = /(^|[^A-Za-z0-9])((?:[A-Z][a-z]?\d*)+)(\s?)(\d?[+\-])(?![A-Za-z0-9])/g;
    while ((r = re.exec(text))) {
      var itok = r[2], ist = r.index + r[1].length, iparts = itok.match(/[A-Z][a-z]?\d*/g) || [], sp = r[3], chg = r[4];
      if (!iparts.every(function (p) { return ELEM.indexOf(' ' + p.replace(/\d+$/, '') + ' ') >= 0; })) continue;
      if (/^PM/.test(itok)) continue;
      var lastDig = (iparts[iparts.length - 1].match(/\d+$/) || [''])[0], body = itok, chargeNum = '';
      if (!sp && chg.length === 1 && lastDig) {
        if (iparts.length === 1) { chargeNum = lastDig; body = itok.slice(0, itok.length - lastDig.length); }
        else if (lastDig.length >= 2) { chargeNum = lastDig.slice(-1); body = itok.slice(0, -1); }
      }
      var ipos = ist, bparts = body.match(/[A-Z][a-z]?\d*/g) || [];
      for (k = ist; k < ist + itok.length; k++) m[k] = 'n';
      bparts.forEach(function (p) { var sym = p.replace(/\d+$/, ''); mark(ipos + sym.length, ipos + p.length, 'sub'); ipos += p.length; });
      var cs = ist + body.length; // 空格也縮成上標大小，看起來不會分開
      mark(cs, ist + itok.length + sp.length + chg.length, 'sup');
    }
    // v1.0.16（#55）噪音：Leq、Lmax、LAeq 等下標；L日／L晚／L夜 的日晚夜下標；Lx（L10、L50、L90）數字下標；振動 LV10 的 V10 下標；水質 BOD5 的 5 下標
    re = /(^|[^A-Za-z])L(A?eq|A?max|A?min)(?![A-Za-z])/g;
    while ((r = re.exec(text))) { k = r.index + r[1].length + 1; mark(k, k + r[2].length, 'sub'); }
    re = /(^|[^A-Za-z])L([日晚夜])/g;
    while ((r = re.exec(text))) { k = r.index + r[1].length + 1; mark(k, k + 1, 'sub'); }
    re = /(^|[^A-Za-z])L([Vv]\d+)(?![0-9])/g;
    while ((r = re.exec(text))) { k = r.index + r[1].length + 1; mark(k, k + r[2].length, 'sub'); }
    re = /(^|[^A-Za-z])L(\d{1,2})(?![0-9.])/g;
    while ((r = re.exec(text))) { k = r.index + r[1].length + 1; mark(k, k + r[2].length, 'sub'); }
    re = /(^|[^A-Za-z])BOD(5)(?![0-9])/g;
    while ((r = re.exec(text))) { k = r.index + r[1].length + 3; mark(k, k + 1, 'sub'); }
    re = /(^|[\/\s(（μuckNd])m([23])(?![0-9.])/g;
    while ((r = re.exec(text))) { k = r.index + r[1].length + 1; mark(k, k + 1, 'sup'); }
    (plain || []).forEach(function (pl) { if (!pl) return; var at = text.indexOf(pl); while (at >= 0) { mark(at, at + pl.length, 'n'); at = text.indexOf(pl, at + 1); } });
    var out = [];
    for (i = 0; i < text.length; i++) { if (out.length && out[out.length - 1].m === m[i]) out[out.length - 1].t += text.charAt(i); else out.push({ t: text.charAt(i), m: m[i] }); }
    return out.length ? out : [{ t: '', m: 'n' }];
  }
  /* 依 ctx 目前的 textAlign／textBaseline 畫出含上下標的文字（sz 字級、bold 粗體） */
  function richText(ctx, text, x, y, sz, bold, plain) {
    var segs = richSegs(text, plain);
    if (segs.length === 1 && segs[0].m === 'n') { ctx.fillText(text, x, y); return; }
    var f = function (z) { return (bold ? 'bold ' : '') + z + 'px ' + FONT; };
    var ws = segs.map(function (g) { ctx.font = f(g.m === 'n' ? sz : sz * 0.7); return ctx.measureText(g.t).width; });
    var tot = ws.reduce(function (a, b) { return a + b; }, 0), al = ctx.textAlign;
    var x0 = al === 'center' ? x - tot / 2 : (al === 'right' || al === 'end') ? x - tot : x;
    ctx.save(); ctx.textAlign = 'left';
    segs.forEach(function (g, i) { ctx.font = f(g.m === 'n' ? sz : sz * 0.7); ctx.fillText(g.t, x0, y + (g.m === 'sub' ? sz * 0.28 : g.m === 'sup' ? -sz * 0.36 : 0)); x0 += ws[i]; });
    ctx.restore(); ctx.font = f(sz);
  }
  // v1.0.16（#49）每個測站固定顏色：series.ci＝在全部測站中的順序（某測項少一站時後面的顏色不會往前移）
  // v1.0.16（#59）折線圖：前 12 站實線、顏色＋標記符號區分；第 13 站起短虛線、第 19 站起點線（標準值維持紅／藍粗虛線、沒有標記）
  var MARKERS = ['circle', 'square', 'triangle', 'diamond', 'x', 'plus'];
  var XL_MARK = { circle: 'circle', square: 'square', triangle: 'triangle', diamond: 'diamond', x: 'x', plus: 'plus' };
  function lineStyle(s, si, multi) {
    var k = (s && s.ci != null) ? s.ci : (si || 0);
    return { color: multi ? PALETTE[k % PALETTE.length] : SINGLE, marker: MARKERS[k % MARKERS.length], dash: k % 24 < 12 ? [] : k % 24 < 18 ? [7, 4] : [2, 3], xlDash: k % 24 < 12 ? 'solid' : k % 24 < 18 ? 'sysDash' : 'sysDot' };
  }
  function drawMarker(ctx, shape, x, y, r, color) {
    ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === 'square') ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
    else if (shape === 'triangle') { ctx.moveTo(x, y - r * 1.1); ctx.lineTo(x + r * 1.05, y + r * 0.8); ctx.lineTo(x - r * 1.05, y + r * 0.8); ctx.closePath(); }
    else if (shape === 'diamond') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath(); }
    if (shape === 'x' || shape === 'plus') {
      ctx.restore(); ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.setLineDash([]); ctx.beginPath();
      if (shape === 'x') { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); }
      else { ctx.moveTo(x - r * 1.15, y); ctx.lineTo(x + r * 1.15, y); ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x, y + r * 1.15); }
      ctx.stroke(); ctx.restore(); return;
    }
    ctx.fill(); ctx.stroke(); ctx.restore();
  }
  // 圖例色塊：長條圖＝方塊；折線圖＝一小段線＋標記
  function swatch(ctx, type, st, x, y, sq) {
    if (type !== 'line') { ctx.fillStyle = st.color; ctx.fillRect(x, y - sq * 3 / 7, sq, sq * 6 / 7); return; }
    var w = sq * 1.8;
    ctx.save(); ctx.strokeStyle = st.color; ctx.lineWidth = 2; ctx.setLineDash(st.dash); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke(); ctx.restore();
    drawMarker(ctx, st.marker, x + w / 2, y, sq * 0.32, st.color);
  }
  function colorOf(s, si) { return PALETTE[((s && s.ci != null) ? s.ci : si) % PALETTE.length]; }
  function stdColor(ln) { return ln && ln.bound === 'lo' ? STD_LO : STD; }

  function niceScale(min, max, want) {
    want = want || 6;
    if (!(isFinite(min) && isFinite(max))) return { min: 0, max: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
    if (min === max) { var d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
    var raw = (max - min) / Math.max(1, want - 1), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    var a = Math.floor(min / step + 1e-9) * step, b = Math.ceil(max / step - 1e-9) * step, ticks = [];
    for (var t = a; t <= b + step * 1e-6; t += step) ticks.push(Math.round(t / step) * step);
    return { min: a, max: b, step: step, ticks: ticks };
  }
  function decOf(step) { var d = 0; while (d < 5 && Math.abs(Math.round(step * Math.pow(10, d)) - step * Math.pow(10, d)) > 1e-7) d++; return d; }
  function fmt(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function uniqStd(a) { var seen = {}; return a.filter(function (l) { var k = l.v + '|' + (l.period || ''); if (seen[k]) return false; seen[k] = 1; return true; }); }
  function fmtStd(v) { return String(+v.toPrecision(6)); }
  function yTitleOf(spec) { return spec.unit ? spec.title + ' (' + spec.unit + ')' : spec.title; }
  // sites：要不要在後面寫適用測站（v1.0.16 #56：網頁預設不寫；沒傳時照舊寫）
  function stdText(ln, unit, sites) { return '標準值 ' + fmtStd(ln.v) + (unit ? ' ' + unit : '') + (ln.period ? '（' + ln.period + '）' : '') + (sites !== false && ln.sts && ln.suffix ? ln.suffix : ''); }

  // 使用者自訂的 Y 軸上下限（依測項；v1.0.13）。不合理（下限 ≥ 上限）就不用
  function userRange(spec, o) {
    var yr = o.yRange && o.yRange[spec.item];
    if (!yr) return null;
    var a = yr.min != null && isFinite(yr.min) ? +yr.min : null, b = yr.max != null && isFinite(yr.max) ? +yr.max : null;
    if (a == null && b == null) return null;
    if (a != null && b != null && a >= b) return null;
    return { min: a, max: b };
  }
  // 固定上下限的刻度：中間用整齊的間距，兩端一定標出設定值（太靠近兩端的整齊刻度拿掉）
  function fixedScale(lo, hi, want) {
    var raw = (hi - lo) / Math.max(1, (want || 6) - 1), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag, ticks = [lo];
    // 優先用能把上下限平均切成 3～8 格的整齊間距（例：0～14 → 每 2 一格），刻度才會等距
    var cands = [];
    [-1, 0, 1].forEach(function (e) { [1, 2, 2.5, 5].forEach(function (m) { cands.push(m * mag * Math.pow(10, e)); }); });
    var even = cands.filter(function (st) { var k = (hi - lo) / st; return Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) >= 3 && Math.round(k) <= 8 && Math.abs(lo / st - Math.round(lo / st)) < 1e-6; })
      .sort(function (x, y) { return Math.abs((hi - lo) / x - 6) - Math.abs((hi - lo) / y - 6); });
    if (even.length) step = even[0];
    for (var t = Math.ceil(lo / step - 1e-9) * step; t < hi - 1e-9; t += step) {
      var v = Math.round(t / step) * step;
      if (v - lo > step * 0.4 && hi - v > step * 0.4) ticks.push(v);
    }
    ticks.push(hi);
    return { min: lo, max: hi, step: step, ticks: ticks, fixed: true };
  }
  function range(spec, o) {
    var ur = userRange(spec, o);
    var lo = Infinity, hi = -Infinity;
    spec.series.forEach(function (s) { s.values.forEach(function (v) { if (v && v.num != null) { lo = Math.min(lo, v.num); hi = Math.max(hi, v.num); } }); });
    if (o.std !== false && o.stdAxis !== false) (spec.stdLines || []).forEach(function (l) { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (o.zero !== false && lo >= 0) lo = 0;
    var auto = niceScale(lo, hi + (hi - lo) * 0.08, 6);
    if (!ur) return auto;
    var a = ur.min != null ? ur.min : auto.min, b = ur.max != null ? ur.max : auto.max;
    if (a >= b) { if (ur.max == null) b = niceScale(a, a + Math.abs(a || 1), 6).max; else a = niceScale(b - Math.abs(b || 1), b, 6).min; }
    return fixedScale(a, b, 6);
  }
  function decOfScale(sc) {
    var d = decOf(sc.step);
    if (sc.fixed) [sc.min, sc.max].forEach(function (v) { d = Math.max(d, decOf(v)); });
    return Math.min(d, 5);
  }

  /* ---------- 畫布 ---------- */
  // 所有文字先量尺寸再排版：標題、Y 軸標題太長會換行；X 標籤放不下會斜 45° 或直排；
  // 標準值標籤會找不壓到長條的位置，找不到就放到圖上方的說明列，不會重疊、裁切或截斷。
  function wrapText(ctx, text, maxW, byChar) {
    if (ctx.measureText(text).width <= maxW) return [text];
    var lines = [], cur = '';
    var parts = text.split(/(\s+)/).filter(function (x) { return x !== ''; });
    if (parts.length === 1 || byChar) parts = text.split('');
    parts.forEach(function (w) {
      var t = cur + w;
      if (cur && ctx.measureText(t).width > maxW) { lines.push(cur.trim()); cur = w.trim() ? w : ''; }
      else cur = t;
    });
    if (cur.trim()) lines.push(cur.trim());
    // 單一詞比寬度還長時逐字切
    var out = [];
    lines.forEach(function (l) {
      if (ctx.measureText(l).width <= maxW) { out.push(l); return; }
      var c = '';
      l.split('').forEach(function (ch) { if (c && ctx.measureText(c + ch).width > maxW) { out.push(c); c = ch; } else c += ch; });
      if (c) out.push(c);
    });
    // v1.0.15：「）」「，」等不放在行首（併回上一行），避免只剩一個括號自成一行
    for (var i = 1; i < out.length; i++) {
      while (out[i] && /^[）)」』】〉》，、。：；！？%％]/.test(out[i])) { out[i - 1] += out[i].charAt(0); out[i] = out[i].slice(1); }
    }
    return out.filter(function (l) { return l !== ''; });
  }
  function draw(canvas, spec, o) {
    o = o || {};
    var scale = o.scale || 1;
    var W = o.width || 980, H0 = o.height || 520;
    var ctx = canvas.getContext('2d');
    var multi = spec.series.length > 1 || spec.kind === 'item';
    var isLine = o.chartType === 'line';
    var hide = o.hide || {}; // v1.0.16（#46）拼圖可隱藏：title 每格標題、yTitle Y 軸標題、yTicks Y 軸刻度、xTicks X 軸標籤、legend 圖例
    // v1.0.16：文字倍率（0.5／1／1.2／1.4；預設 1）。所有版面間距都由字的大小算出，任何倍率都不重疊、不出界
    var fk = o.fontScale || 1;
    var fs = { title: 21 * fk, axis: 16 * fk, tick: 14 * fk, legend: 14 * fk, std: 14 * fk };
    function font(sz, bold) { return (bold ? 'bold ' : '') + sz + 'px ' + FONT; }
    var sc = range(spec, o), dec = decOfScale(sc);
    var n = spec.cats.length, ns = spec.series.length;
    // 超出自訂範圍的數值：長條截在邊界，標出實際數值（▲ 超過上限、▼ 低於下限）
    var clipUp = [], clipDn = [];
    if (sc.fixed) spec.series.forEach(function (s, si) { s.values.forEach(function (v, i) { if (!v || v.num == null) return; if (v.num > sc.max) clipUp.push({ si: si, i: i, t: '▲' + v.raw }); else if (v.num < sc.min) clipDn.push({ si: si, i: i, t: '▼' + v.raw }); }); });
    // 標準值超出自訂範圍：不畫線，在圖上方註明
    var outStd = sc.fixed && o.std !== false && !(o.hide || {}).stdText ? uniqStd((spec.stdLines || []).filter(function (l) { return l.v < sc.min || l.v > sc.max; })) : [];
    // v1.0.16（#51）標題＝［測站名稱］＋［測項名稱］，兩個都可以不顯示；都不顯示就沒有標題
    var tParts = [];
    if (spec.kind === 'station' && o.stationInTitle) tParts.push(spec.station);
    if (!(o.hide || {}).title) tParts.push(spec.title);
    var titleText = tParts.join('　');
    // v1.0.19（#64）取消「Y 軸範圍包含標準值」時，超出資料範圍的標準值不畫線；勾選 stdOutText 時只寫「標準值 XX」（沒有虛線記號）
    var outTxt = !sc.fixed && o.std !== false && o.stdAxis === false && o.stdOutText && !(o.hide || {}).stdText
      ? uniqStd((spec.stdLines || []).filter(function (l) { return l.v < sc.min || l.v > sc.max; })) : [];
    ctx.save();
    ctx.font = font(fs.title, true);
    var titleLines = titleText ? wrapText(ctx, titleText, W - 60) : [];
    ctx.font = font(fs.tick);
    var tickW = hide.yTicks ? 0 : Math.max.apply(null, sc.ticks.map(function (t) { return ctx.measureText(fmt(t, dec)).width; }));
    var stdList = o.std !== false ? (spec.stdLines || []).filter(function (l) { return l.v >= sc.min && l.v <= sc.max; }) : [];
    var band = []; // 放不進圖內的標準值標籤
    // v1.0.16（#53）沒有標準值的測項標示「無標準值」：先放繪圖區左上角，會被長條擋住就放到圖上方說明列
    var NOSTD = '無標準值', noStd = o.std !== false && o.noStdText && !hide.stdText && !(spec.stdLines || []).length, noStdBand = false;
    var L, L0 = null;
    for (var pass = 0; pass < 3; pass++) {
      // v1.0.16（#44）上方說明列的標準值文字太長時換行（以前不換行，超出圖寬被切掉）
      ctx.font = font(fs.std, true);
      // 逐字換行（中文說明在空白處斷開會把「標準值 60」和「dB」拆開）
      L = { bandRows: band.map(function (ln) { return wrapText(ctx, stdText(ln, spec.unit, o.stdSites), W - 20 - 38, true); }),
        outRows: outStd.map(function (ln) { return wrapText(ctx, '※ ' + stdText(ln, spec.unit, o.stdSites) + ' 超出 Y 軸範圍，未畫線', W - 20, true); }),
        txtRows: outTxt.map(function (ln) { return wrapText(ctx, stdText(ln, spec.unit, o.stdSites), W - 20, true); }) };
      var nBand = noStdBand ? 1 : 0; L.bandRows.concat(L.outRows, L.txtRows).forEach(function (r) { nBand += r.length; });
      var topBand = nBand ? nBand * (fs.std + 8) + 6 : 0;
      ctx.font = font(fs.tick, true);
      L.clipW = Math.max.apply(null, clipUp.map(function (c) { return ctx.measureText(c.t).width; }).concat([0]));
      L.clipH = clipUp.length ? fs.tick + 8 : 0; // 先假設橫寫，下面算出長條寬度後再決定要不要直寫
      if (pass > 0 && L0 && L0.clipVert) L.clipH = L.clipW + 8;
      var titleH = titleLines.length ? titleLines.length * (fs.title + 6) : 0;
      L.top = 14 + titleH + (titleH ? 10 : 4) + topBand + L.clipH;
      L.bandTop = 14 + titleH + (titleH ? 6 : 0);
      ctx.font = font(fs.axis);
      var yLinesTry = [yTitleOf(spec)];
      L.right = 26;
      // Y 軸標題可能要兩行
      L.yLines = yLinesTry;
      L.left = 18 + (hide.yTitle ? 0 : fs.axis + 12) + (hide.yTicks ? 0 : tickW + 10);
      L.plotW = W - L.left - L.right;
      L.slot = L.plotW / Math.max(1, n);
      ctx.font = font(fs.tick);
      var maxLab = Math.max.apply(null, spec.cats.map(function (c) { return ctx.measureText(c).width; }).concat([0]));
      L.rot = maxLab + 10 > L.slot ? (fs.tick * 1.45 > L.slot * 0.72 ? 90 : 45) : 0;
      if (L.rot === 45 && (fs.tick + 4) * 1.42 > L.slot) L.rot = 90;
      L.labH = L.rot === 0 ? fs.tick + 6 : L.rot === 45 ? maxLab * 0.71 + fs.tick * 0.9 + 4 : maxLab + 8;
      // 拼圖時同一張大圖的 X 軸寫法一致（o.minRot＝其他格用到最斜的角度）
      if (o.minRot && L.rot < o.minRot && !hide.xTicks) { L.rot = o.minRot; L.labH = L.rot === 45 ? maxLab * 0.71 + fs.tick * 0.9 + 4 : maxLab + 8; }
      if (hide.xTicks) { L.rot = 0; L.labH = 0; }
      // 45° 時第一個標籤往左下延伸，左邊界要夠
      if (L.rot === 45) { var need = maxLab * 0.71 - L.slot / 2 + 6; if (need > L.left - 10) { L.left = need + 10; L.plotW = W - L.left - L.right; L.slot = L.plotW / Math.max(1, n); } }
      L.legRows = 0;
      if (multi && !hide.legend) {
        ctx.font = font(fs.legend);
        var sw = isLine ? fs.legend * 1.8 + 6 : fs.legend + 6; // 色塊（折線圖：一小段線）＋間距
        L.cellW = Math.min(W - 40, Math.max.apply(null, spec.series.map(function (s) { return ctx.measureText(s.name).width; })) + sw + 18);
        L.perRow = Math.max(1, Math.floor((W - 40) / L.cellW));
        L.legRows = Math.ceil(ns / L.perRow);
        // 名稱比一格寬（字放大或格子窄）時換行，不超出圖
        L.legLines = spec.series.map(function (s) { return wrapText(ctx, s.name, L.cellW - sw - 8); });
        L.legRowH = []; for (var rr = 0; rr < L.legRows; rr++) { var mx = 1; for (var q = rr * L.perRow; q < Math.min(ns, (rr + 1) * L.perRow); q++) mx = Math.max(mx, L.legLines[q].length); L.legRowH.push(mx * (fs.legend + 4) + 6); }
      }
      L.legH = L.legRows ? L.legRowH.reduce(function (a, b) { return a + b; }, 0) + 10 : 0;
      // v1.0.18（#63）X 軸標題（o.xTitle 有字才畫），放在 X 軸標籤下方、圖例上方
      ctx.font = font(fs.axis);
      L.xtLines = o.xTitle ? wrapText(ctx, String(o.xTitle), W - 20) : [];
      L.xtH = L.xtLines.length ? L.xtLines.length * (fs.axis + 4) + 6 : 0;
      L.bottom = 10 + L.labH + 8 + L.xtH + L.legH + 6;
      L.plotH = Math.max(220, H0 - L.top - L.bottom);
      ctx.font = font(fs.axis);
      L.yLines = hide.yTitle ? [] : wrapText(ctx, yTitleOf(spec), L.plotH - 10);
      if (L.yLines.length > 1) { L.left += (L.yLines.length - 1) * (fs.axis + 4); L.plotW = W - L.left - L.right; L.slot = L.plotW / Math.max(1, n); }
      // v1.0.16（#45）直寫後標籤仍比每個間距寬（長條非常密）：縮小 X 軸標籤字（最小 8px）；還是放不下才隔幾個標一個
      L.xfs = fs.tick; L.xstep = 1;
      if (L.rot === 90 && !hide.xTicks && fs.tick * 1.2 > L.slot) {
        L.xfs = Math.max(Math.min(8, fs.tick), Math.floor(L.slot / 1.2));
        if (L.xfs * 1.2 > L.slot) L.xstep = Math.ceil(L.xfs * 1.2 / L.slot);
        ctx.font = font(L.xfs);
        var maxLab2 = Math.max.apply(null, spec.cats.map(function (c) { return ctx.measureText(c).width; }).concat([0]));
        L.bottom += (maxLab2 + 8) - L.labH; L.labH = maxLab2 + 8;
      }
      L.H = L.top + L.plotH + L.bottom;
      L.y = function (v) { return L.top + L.plotH - (v - sc.min) / (sc.max - sc.min) * L.plotH; };
      // 長條位置
      L.barW = Math.max(2, Math.min(multi ? 34 : 56, L.slot * 0.72 / ns));
      L.groupW = L.barW * ns;
      L.clipVert = clipUp.length && L.clipW + 4 > L.slot / ns;
      L.bars = [];
      if (isLine) {
        // 折線圖：點在每個間距中央；L.bars 放「點與線段」的範圍，給標準值文字、無標準值判斷碰撞用（不畫）
        L.mr = Math.max(3, 4.5 * fk); L.pts = [];
        spec.series.forEach(function (s, si) {
          var prev = null;
          s.values.forEach(function (v, i) {
            if (!v || v.num == null) { prev = null; return; }
            var px = L.left + L.slot * i + L.slot / 2, py = L.y(Math.max(sc.min, Math.min(sc.max, v.num)));
            L.pts.push({ x: px, y: py, si: si, i: i });
            var m = L.mr + 2;
            L.bars.push({ x: px - m, y: py - m, w: m * 2, h: m * 2, si: si, hit: 1 });
            if (prev) { var d = Math.hypot(px - prev.x, py - prev.y), nstep = Math.max(1, Math.ceil(d / 6)); for (var q = 1; q < nstep; q++) { var qx = prev.x + (px - prev.x) * q / nstep, qy = prev.y + (py - prev.y) * q / nstep; L.bars.push({ x: qx - 2, y: qy - 2, w: 4, h: 4, si: si, hit: 1 }); } }
            prev = { x: px, y: py };
          });
        });
      } else spec.series.forEach(function (s, si) {
        s.values.forEach(function (v, i) {
          if (!v || v.num == null) return;
          var x0 = L.left + L.slot * i + (L.slot - L.groupW) / 2 + L.barW * si;
          var y1 = L.y(Math.max(sc.min, Math.min(sc.max, v.num))), y0 = L.y(Math.max(sc.min, 0));
          L.bars.push({ x: x0, y: Math.min(y0, y1), w: L.barW, h: Math.abs(y0 - y1), si: si });
        });
      });
      // 標準值標籤位置
      ctx.font = font(fs.std, true);
      L.labels = [];
      var newBand = [], needNoStd = false;
      if (noStd && !noStdBand) {
        ctx.font = font(fs.std, true);
        var nr = { x: L.left + 4, y: L.top + 2, w: ctx.measureText(NOSTD).width + 8, h: fs.std + 6 };
        if (L.bars.some(function (b) { return nr.x < b.x + b.w && nr.x + nr.w > b.x && nr.y < b.y + b.h && nr.y + nr.h > b.y; })) { noStdBand = true; needNoStd = true; }
        else L.noStdAt = nr;
      }
      if (!hide.stdText) stdList.forEach(function (ln) {
        if (band.indexOf(ln) >= 0 || ln.lead === false) return; // 季節性標準分成多段時，只在最長的一段標文字
        // 圖內標籤不寫期間（線的位置就代表期間）；放到上方說明列時才寫完整期間
        var txt = stdText({ v: ln.v, sts: ln.sts, suffix: ln.suffix }, spec.unit, o.stdSites), tw = ctx.measureText(txt).width, th = fs.std + 2;
        var y = L.y(ln.v);
        var sx0 = L.left + L.slot * (ln.i0 != null ? ln.i0 : 0), sx1 = L.left + L.slot * (ln.i1 != null ? ln.i1 + 1 : n);
        var cands = [];
        if (sx1 - sx0 - 12 >= tw) {
          [y - 5 - th, y + 5].forEach(function (ty) {
            for (var k = 0; k <= 20; k++) {
              var tx = sx0 + 6 + (sx1 - sx0 - 12 - tw) * (k / 20);
              cands.push({ x: tx, y: ty });
            }
          });
        }
        var ok = null;
        for (var c = 0; c < cands.length && !ok; c++) {
          var r = { x: cands[c].x - 3, y: cands[c].y - 1, w: tw + 6, h: th + 2 };
          if (r.y < L.top + 1 || r.y + r.h > L.top + L.plotH - 1) continue;
          var hit = L.bars.some(function (b) { return r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y; }) ||
            stdList.some(function (o2) { // 不可壓到其他標準線
              if (o2 === ln) return false;
              var yy = L.y(o2.v), ox0 = L.left + L.slot * (o2.i0 != null ? o2.i0 : 0), ox1 = L.left + L.slot * (o2.i1 != null ? o2.i1 + 1 : n);
              return yy >= r.y - 1 && yy <= r.y + r.h + 1 && r.x < ox1 && r.x + r.w > ox0;
            }) ||
            L.labels.some(function (q) { return r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y; });
          if (!hit) ok = { x: r.x, y: r.y, w: r.w, h: r.h, tx: cands[c].x, ty: cands[c].y, txt: txt, color: stdColor(ln) };
        }
        if (ok) L.labels.push(ok); else newBand.push(ln);
      });
      var vertChanged = L.clipVert && L.clipH < L.clipW + 8;
      L0 = L;
      if (!newBand.length && !vertChanged && !needNoStd) break;
      if (!newBand.length) continue;
      // 只要有一條放不進圖內，就全部放到上方說明列，比較整齊
      band = stdList.filter(function (l) { return l.lead !== false; }).sort(function (a, b) { return b.v - a.v; });
    }
    var H = L.H;
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    // 標題
    ctx.fillStyle = '#1b2233'; ctx.font = font(fs.title, true); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    var plainSt = [spec.station].concat(spec.series.map(function (x) { return x.name; }));
    titleLines.forEach(function (t, i) { richText(ctx, t, W / 2, 14 + fs.title + i * (fs.title + 6), fs.title, true, plainSt); });
    // 格線與刻度
    ctx.font = font(fs.tick); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    sc.ticks.forEach(function (t) {
      var y = Math.round(L.y(t)) + 0.5;
      ctx.strokeStyle = t === sc.min ? '#8a93a6' : '#e3e7ee'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L.left, y); ctx.lineTo(L.left + L.plotW, y); ctx.stroke();
      if (!hide.yTicks) { ctx.fillStyle = '#3b4456'; ctx.fillText(fmt(t, dec), L.left - 8, y); }
    });
    // Y 軸標題
    ctx.save();
    ctx.font = font(fs.axis); ctx.fillStyle = '#1b2233'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var yx0 = L.left - (hide.yTicks ? 0 : 10 + tickW) - 12 - (L.yLines.length - 1) * (fs.axis + 4) - fs.axis / 2;
    L.yLines.forEach(function (t, i) {
      ctx.save(); ctx.translate(yx0 + i * (fs.axis + 4), L.top + L.plotH / 2); ctx.rotate(-Math.PI / 2); richText(ctx, t, 0, 0, fs.axis, false, plainSt); ctx.restore();
    });
    ctx.restore();
    // 長條
    if (isLine) {
      // 線：沒有數值的那一次斷開
      spec.series.forEach(function (s, si) {
        var stl = lineStyle(s, si, multi);
        ctx.save(); ctx.strokeStyle = stl.color; ctx.lineWidth = 2.2; ctx.setLineDash(stl.dash); ctx.lineJoin = 'round';
        ctx.beginPath(); var open = false;
        s.values.forEach(function (v, i) {
          if (!v || v.num == null) { open = false; return; }
          var px = L.left + L.slot * i + L.slot / 2, py = L.y(Math.max(sc.min, Math.min(sc.max, v.num)));
          if (open) ctx.lineTo(px, py); else { ctx.moveTo(px, py); open = true; }
        });
        ctx.stroke(); ctx.restore();
      });
      L.pts.forEach(function (pt) { var stl = lineStyle(spec.series[pt.si], pt.si, multi); drawMarker(ctx, stl.marker, pt.x, pt.y, L.mr, stl.color); });
    } else L.bars.forEach(function (b) {
      ctx.fillStyle = multi ? colorOf(spec.series[b.si], b.si) : (o.color || SINGLE);
      ctx.fillRect(b.x + (ns > 1 ? 0.5 : 0), b.y, b.w - (ns > 1 ? 1 : 0), b.h);
    });
    // 沒有數值的格子：依種類決定要不要在圖上標出文字（v1.0.9）
    var mk = o.marks || (o.markND ? { nd: 1, lt: 1 } : {});
    function markOf(v) {
      if (!v || v.num != null) return '';
      if (v.kind === 'nd') return mk.nd ? 'ND' : '';
      if (v.kind === 'lt' || v.kind === 'gt') return mk.lt ? String(v.raw).replace(/\s+/g, '') : '';
      if (v.kind === 'blank' && v.cls === 'na') return mk.na ? String(v.raw).replace(/\s+/g, '') : '';
      if (v.kind === 'blank' && v.cls === 'ph') return mk.ph ? String(v.raw).replace(/\s+/g, '') : '';
      return '';
    }
    if (mk.nd || mk.lt || mk.na || mk.ph) {
      ctx.font = font(fs.tick + 1, true); ctx.fillStyle = '#3d4555'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      var mOff = {}; // 折線圖：同一次有好幾站沒有數值時往上疊，不互相重疊
      if (isLine) spec.series.forEach(function (s, si) {
        s.values.forEach(function (v, i) {
          var t = markOf(v); if (!t) return;
          var cx = L.left + L.slot * i + L.slot / 2, base = L.y(Math.max(sc.min, 0)) - 3 - (mOff[i] || 0), tw = ctx.measureText(t).width;
          ctx.save(); ctx.translate(cx, base); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.fillStyle = lineStyle(s, si, multi).color;
          if (tw > L.slot - 2) { ctx.rotate(-Math.PI / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.strokeText(t, 0, 0); ctx.fillText(t, 0, 0); mOff[i] = (mOff[i] || 0) + tw + 4; }
          else { ctx.strokeText(t, 0, 0); ctx.fillText(t, 0, 0); mOff[i] = (mOff[i] || 0) + fs.tick + 4; }
          ctx.restore();
        });
      });
      else spec.series.forEach(function (s, si) {
        s.values.forEach(function (v, i) {
          if (!markOf(v)) return;
          var x0 = L.left + L.slot * i + (L.slot - L.groupW) / 2 + L.barW * si;
          var t = markOf(v);
          ctx.save(); ctx.translate(x0 + L.barW / 2, L.y(Math.max(sc.min, 0)) - 3);
          if (ctx.measureText(t).width > L.barW + 2) { ctx.rotate(-Math.PI / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, 0, 0); }
          else ctx.fillText(t, 0, 0);
          ctx.restore();
        });
      });
    }
    // 超出自訂範圍的長條：標出實際數值
    if (clipUp.length || clipDn.length) {
      ctx.font = font(fs.tick, true); ctx.fillStyle = '#b3261e';
      var lab = function (c, up) {
        var x = isLine ? L.left + L.slot * c.i + L.slot / 2 : L.left + L.slot * c.i + (L.slot - L.groupW) / 2 + L.barW * c.si + L.barW / 2;
        var w = ctx.measureText(c.t).width, vert = w + 4 > (isLine ? L.slot : L.slot / ns);
        ctx.save();
        if (up) {
          ctx.translate(x, L.top - 3);
          if (vert) { ctx.rotate(-Math.PI / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; } else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; }
        } else {
          ctx.translate(x, L.top + L.plotH - 3);
          if (vert) { ctx.rotate(-Math.PI / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; } else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; }
        }
        ctx.fillText(c.t, 0, 0); ctx.restore();
      };
      clipUp.forEach(function (c) { lab(c, true); });
      clipDn.forEach(function (c) { lab(c, false); });
    }
    // 標準線
    stdList.forEach(function (ln) {
      var y = Math.round(L.y(ln.v)) + 0.5;
      var x0 = L.left + L.slot * (ln.i0 != null ? ln.i0 : 0), x1 = L.left + L.slot * (ln.i1 != null ? ln.i1 + 1 : n);
      // 先畫白色描邊，虛線經過同色長條（例：藍色長條上的藍色下限線）也看得見（v1.0.14）
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.strokeStyle = stdColor(ln); ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.restore();
    });
    ctx.font = font(fs.std, true); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = STD;
    L.labels.forEach(function (lb) { ctx.fillStyle = lb.color || STD; richText(ctx, lb.txt, lb.tx, lb.ty, fs.std, true, plainSt); });
    // 放不進圖內的標準值 → 圖上方說明列
    var rowI = 0;
    band.forEach(function (ln, i) {
      var rows = L.bandRows[i] || [stdText(ln, spec.unit, o.stdSites)];
      var tw = Math.max.apply(null, rows.map(function (t) { return ctx.measureText(t).width; }));
      var x = L.left + Math.max(0, (L.plotW - tw - 40) / 2);
      if (x + 38 + tw > W - 10) x = Math.max(10, W - 10 - 38 - tw);
      var y = L.bandTop + rowI * (fs.std + 8) + fs.std / 2 + 2;
      ctx.fillStyle = stdColor(ln);
      ctx.save(); ctx.strokeStyle = stdColor(ln); ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + 30, y + 0.5); ctx.stroke(); ctx.restore();
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      rows.forEach(function (t, j) { richText(ctx, t, x + 38, y + j * (fs.std + 8), fs.std, true, plainSt); });
      rowI += rows.length;
    });
    // 超出自訂 Y 軸範圍、沒畫的標準值
    outStd.forEach(function (ln, k) {
      var rows = L.outRows[k] || [];
      var tw = Math.max.apply(null, rows.map(function (t) { return ctx.measureText(t).width; }).concat([0]));
      var x = L.left + Math.max(0, (L.plotW - tw) / 2); if (x + tw > W - 10) x = Math.max(10, W - 10 - tw);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = stdColor(ln);
      rows.forEach(function (t) { richText(ctx, t, x, L.bandTop + rowI * (fs.std + 8) + fs.std / 2 + 2, fs.std, true, plainSt); rowI++; });
    });
    outTxt.forEach(function (ln, k) {
      var rows = L.txtRows[k] || [];
      ctx.font = font(fs.std, true);
      var tw = Math.max.apply(null, rows.map(function (t) { return ctx.measureText(t).width; }).concat([0]));
      var x = L.left + Math.max(0, (L.plotW - tw) / 2); if (x + tw > W - 10) x = Math.max(10, W - 10 - tw);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = stdColor(ln);
      rows.forEach(function (t) { richText(ctx, t, x, L.bandTop + rowI * (fs.std + 8) + fs.std / 2 + 2, fs.std, true, plainSt); rowI++; });
    });
    if (noStd) {
      ctx.font = font(fs.std, true); ctx.fillStyle = '#1b2233'; ctx.textAlign = 'left';
      if (noStdBand) { ctx.textBaseline = 'middle'; ctx.fillText(NOSTD, L.left + 6, L.bandTop + rowI * (fs.std + 8) + fs.std / 2 + 2); }
      else if (L.noStdAt) { ctx.textBaseline = 'top'; ctx.fillText(NOSTD, L.noStdAt.x + 4, L.noStdAt.y + 3); }
    }
    // 外框
    ctx.strokeStyle = '#8a93a6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L.left + 0.5, L.top); ctx.lineTo(L.left + 0.5, L.top + L.plotH + 0.5); ctx.stroke();
    // X 標籤
    ctx.font = font(L.xfs || fs.tick); ctx.fillStyle = '#3b4456';
    if (!hide.xTicks) spec.cats.forEach(function (c, i) {
      if (L.xstep > 1 && i % L.xstep) return;
      var x = L.left + L.slot * i + L.slot / 2, y = L.top + L.plotH + 8;
      if (L.rot === 0) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(c, x, y); }
      else {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-L.rot * Math.PI / 180);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(c, 0, 0); ctx.restore();
      }
    });
    if (L.xtLines.length) {
      ctx.save(); ctx.font = font(fs.axis); ctx.fillStyle = '#1b2233'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var xtx = Math.min(W - 10, Math.max(10, L.left + L.plotW / 2)), xty = L.top + L.plotH + 8 + L.labH + 6;
      L.xtLines.forEach(function (t, i) { var tw = ctx.measureText(t).width, cx = Math.min(W - 10 - tw / 2, Math.max(10 + tw / 2, xtx)); richText(ctx, t, cx, xty + i * (fs.axis + 4), fs.axis, false); });
      ctx.restore();
    }
    // 圖例
    if (L.legRows) {
      ctx.font = font(fs.legend); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      var totalW = Math.min(ns, L.perRow) * L.cellW;
      var lx0 = (W - totalW) / 2, ly0 = L.top + L.plotH + 10 + L.labH + 10 + L.xtH, sq = fs.legend;
      spec.series.forEach(function (s, si) {
        var row = Math.floor(si / L.perRow), col = si % L.perRow, rowY = 0;
        for (var r2 = 0; r2 < row; r2++) rowY += L.legRowH[r2];
        var x = lx0 + col * L.cellW, y = ly0 + rowY + fs.legend / 2;
        swatch(ctx, isLine ? 'line' : 'bar', { color: colorOf(s, si), marker: lineStyle(s, si, true).marker, dash: lineStyle(s, si, true).dash }, x, y, sq);
        ctx.fillStyle = '#1b2233';
        L.legLines[si].forEach(function (t, j) { ctx.fillText(t, x + (isLine ? sq * 1.8 : sq) + 6, y + j * (fs.legend + 4)); });
      });
    }
    ctx.restore();
    return { width: W, height: H, scale: sc, layout: L, band: band.length };
  }

  /* ---------- Excel 原生圖表 XML ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function txPr(sz, bold, color) {
    return '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="' + (bold ? 1 : 0) + '"><a:solidFill><a:srgbClr val="' + (color || '1B2233') + '"/></a:solidFill><a:latin typeface="Microsoft JhengHei"/><a:ea typeface="Microsoft JhengHei"/></a:defRPr></a:pPr><a:endParaRPr lang="zh-TW"/></a:p></c:txPr>';
  }
  function richTitle(text, sz, bold, rot, plain) {
    // v1.0.16（#52）Excel 圖表標題一樣用上下標（baseline：下標 -25%、上標 +30%）
    var runs = richSegs(text, plain).map(function (g) {
      return '<a:r><a:rPr lang="zh-TW" sz="' + sz + '" b="' + (bold ? 1 : 0) + '"' + (g.m === 'sub' ? ' baseline="-25000"' : g.m === 'sup' ? ' baseline="30000"' : '') + '><a:solidFill><a:srgbClr val="1B2233"/></a:solidFill><a:latin typeface="Microsoft JhengHei"/><a:ea typeface="Microsoft JhengHei"/></a:rPr><a:t>' + esc(g.t) + '</a:t></a:r>';
    }).join('');
    return '<c:title><c:tx><c:rich><a:bodyPr' + (rot ? ' rot="-5400000" vert="horz"' : '') + '/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="' + (bold ? 1 : 0) + '"/></a:pPr>' + runs + '</a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
  }
  function strRef(ref, vals) {
    return '<c:strRef><c:f>' + esc(ref) + '</c:f><c:strCache><c:ptCount val="' + vals.length + '"/>' + vals.map(function (v, i) { return '<c:pt idx="' + i + '"><c:v>' + esc(v) + '</c:v></c:pt>'; }).join('') + '</c:strCache></c:strRef>';
  }
  function numRef(ref, vals) {
    return '<c:numRef><c:f>' + esc(ref) + '</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="' + vals.length + '"/>' + vals.map(function (v, i) { return v == null ? '' : '<c:pt idx="' + i + '"><c:v>' + v + '</c:v></c:pt>'; }).join('') + '</c:numCache></c:numRef>';
  }
  /* x = { spec, catRef, series:[{nameRef, valRef}], stdSeries:[{nameRef, name, valRef, v}], zero } */
  function barChartXml(x) {
    var spec = x.spec, multi = spec.series.length > 1 || spec.kind === 'item';
    var n = spec.cats.length;
    var isLine = x.type === 'line';
    var ser = spec.series.map(function (s, i) {
      var color = (multi ? colorOf(s, i) : SINGLE).slice(1);
      if (isLine) {
        // v1.0.16（#59）折線：和網頁圖同樣的顏色、標記、線型；沒有數值斷開（dispBlanksAs gap）
        var stl = lineStyle(s, i, multi);
        return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/><c:tx>' + strRef(x.series[i].nameRef, [s.name]) + '</c:tx>' +
          '<c:spPr><a:ln w="25400" cap="rnd"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:prstDash val="' + stl.xlDash + '"/><a:round/></a:ln></c:spPr>' +
          '<c:marker><c:symbol val="' + XL_MARK[stl.marker] + '"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="' + (stl.marker === 'x' || stl.marker === 'plus' ? color : 'FFFFFF') + '"/></a:solidFill></a:ln></c:spPr></c:marker>' +
          '<c:cat>' + strRef(x.catRef, spec.cats) + '</c:cat><c:val>' + numRef(x.series[i].valRef, s.values.map(function (v) { return v && v.num != null ? v.num : null; })) + '</c:val><c:smooth val="0"/></c:ser>';
      }
      return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/><c:tx>' + strRef(x.series[i].nameRef, [s.name]) + '</c:tx>' +
        '<c:spPr><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>' +
        '<c:cat>' + strRef(x.catRef, spec.cats) + '</c:cat><c:val>' + numRef(x.series[i].valRef, s.values.map(function (v) { return v && v.num != null ? v.num : null; })) + '</c:val></c:ser>';
    }).join('');
    var k0 = spec.series.length;
    var lines = (x.stdSeries || []).map(function (s, j) {
      var col = s.color || 'E03131';   // v1.0.14：上限紅、下限藍
      return '<c:ser><c:idx val="' + (k0 + j) + '"/><c:order val="' + (k0 + j) + '"/><c:tx>' + strRef(s.nameRef, [s.name]) + '</c:tx>' +
        '<c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="' + col + '"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>' +
        '<c:marker><c:symbol val="dash"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="' + col + '"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="' + col + '"/></a:solidFill></a:ln></c:spPr></c:marker>' +
        '<c:cat>' + strRef(x.catRef, spec.cats) + '</c:cat><c:val>' + numRef(s.valRef, s.vals) + '</c:val><c:smooth val="0"/></c:ser>';
    }).join('');
    var axFont = txPr(1000, 0);
    // v1.0.13：使用者自訂的 Y 軸上下限一起套用（Excel 裡仍可自行修改）；順序須為 orientation → max → min
    var ur = userRange(x.spec, { yRange: x.yRange }), yMin = ur && ur.min != null ? ur.min : (x.zero !== false ? 0 : null);
    var scaling = '<c:scaling><c:orientation val="minMax"/>' + (ur && ur.max != null ? '<c:max val="' + ur.max + '"/>' : '') + (yMin != null ? '<c:min val="' + yMin + '"/>' : '') + '</c:scaling>';
    var nStd = (x.stdSeries || []).length;
    var noLegend = !multi && !nStd;
    // 每站一張：圖例只放標準值（放在上方）；各站並列：圖例放下方（測站＋標準值）
    var nShown = (x.stdSeries || []).filter(function (s) { return !s.spare; }).length;
    noLegend = !multi && !nShown;
    // 預留（空白）的標準值數列不放進圖例
    var legend = noLegend ? '' : '<c:legend><c:legendPos val="' + (multi ? 'b' : 't') + '"/>' + (multi ? '' : '<c:legendEntry><c:idx val="0"/><c:delete val="1"/></c:legendEntry>') + (x.stdSeries || []).map(function (s, j) { return '<c:legendEntry><c:idx val="' + (k0 + j) + '"/>' + (s.spare ? '<c:delete val="1"/>' : txPr(1050, 1, s.color || 'E03131')) + '</c:legendEntry>'; }).join('') + '<c:overlay val="0"/>' + txPr(1000, 0) + '</c:legend>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:lang val="zh-TW"/><c:roundedCorners val="0"/><c:chart>' + richTitle(spec.kind === 'station' && x.stationInTitle ? spec.station + '　' + spec.title : spec.title, 1400, 1, false, [spec.station]) + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
      (isLine ? '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + ser + '<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>'
        : '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' + ser + '<c:gapWidth val="' + (multi ? 80 : 150) + '"/><c:overlap val="0"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>') +
      (lines ? '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + lines + '<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>' : '') +
      '<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="8A93A6"/></a:solidFill></a:ln></c:spPr>' + axFont + '<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
      '<c:valAx><c:axId val="5002"/>' + scaling + '<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E3E7EE"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' + richTitle(yTitleOf(spec), 1100, 0, true, [spec.station]) + '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="8A93A6"/></a:solidFill></a:ln></c:spPr>' + axFont + '<c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
      '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>' +
      legend +
      '<c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/><c:extLst><c:ext uri="{56B9EC1D-385E-4148-901F-78D8002777C0}" xmlns:c16r3="http://schemas.microsoft.com/office/drawing/2017/03/chart"><c16r3:dataDisplayOptions16><c16r3:dispNaAsBlank val="1"/></c16r3:dataDisplayOptions16></c:ext></c:extLst></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D0D5DE"/></a:solidFill></a:ln></c:spPr>' +
      '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr><a:latin typeface="Microsoft JhengHei"/><a:ea typeface="Microsoft JhengHei"/></a:defRPr></a:pPr><a:endParaRPr lang="zh-TW"/></a:p></c:txPr></c:chartSpace>';
  }

  /* ---------- 把圖表塞進 ExcelJS 產生的活頁簿 ---------- */
  // plan: [{sheet, charts:[{xml, col, row, cols, rows}]}]
  function inject(JSZip, buf, plan) {
    return JSZip.loadAsync(buf).then(function (zip) {
      return Promise.all([zip.file('xl/workbook.xml').async('string'), zip.file('xl/_rels/workbook.xml.rels').async('string'), zip.file('[Content_Types].xml').async('string')]).then(function (a) {
        var wbx = a[0], rels = a[1], ct = a[2];
        var rid = {}; rels.replace(/<Relationship\b[^>]*>/g, function (t) { var i = /Id="([^"]+)"/.exec(t), g = /Target="([^"]+)"/.exec(t); if (i && g) rid[i[1]] = g[1].replace(/^\/?xl\//, ''); return t; });
        var sheetFile = {};
        wbx.replace(/<sheet\b[^>]*>/g, function (t) {
          var nm = /name="([^"]+)"/.exec(t)[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
          sheetFile[nm] = rid[/r:id="([^"]+)"/.exec(t)[1]]; return t;
        });
        var k = 0, jobs = [];
        plan.forEach(function (p, di) {
          if (!p.charts.length) return;
          var d = di + 1, anchors = '', drels = '';
          p.charts.forEach(function (c, ci) {
            k++;
            zip.file('xl/charts/chart' + k + '.xml', c.xml);
            ct = ct.replace('</Types>', '<Override PartName="/xl/charts/chart' + k + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>');
            anchors += '<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>' + c.col + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + c.row + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>' + (c.col + c.cols) + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + (c.row + c.rows) + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
              '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (ci + 2) + '" name="趨勢圖 ' + (ci + 1) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId' + (ci + 1) + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
            drels += '<Relationship Id="rId' + (ci + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + k + '.xml"/>';
          });
          zip.file('xl/drawings/drawing' + d + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + anchors + '</xdr:wsDr>');
          zip.file('xl/drawings/_rels/drawing' + d + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + drels + '</Relationships>');
          ct = ct.replace('</Types>', '<Override PartName="/xl/drawings/drawing' + d + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
          var sf = 'xl/' + sheetFile[p.sheet];
          if (!sheetFile[p.sheet]) throw new Error('找不到工作表：' + p.sheet);
          var sr = sf.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels');
          jobs.push(zip.file(sf).async('string').then(function (x) {
            var rp = zip.file(sr) ? zip.file(sr).async('string') : Promise.resolve('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
            return rp.then(function (rx) {
              rx = rx.replace('</Relationships>', '<Relationship Id="rIdChart' + d + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + d + '.xml"/></Relationships>');
              if (x.indexOf('xmlns:r=') < 0) x = x.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
              var tag = '<drawing r:id="rIdChart' + d + '"/>', at = x.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
              x = at >= 0 ? x.slice(0, at) + tag + x.slice(at) : x.replace('</worksheet>', tag + '</worksheet>');
              zip.file(sf, x); zip.file(sr, rx);
            });
          }));
        });
        return Promise.all(jobs).then(function () {
          zip.file('[Content_Types].xml', ct);
          return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
        });
      });
    });
  }

  /* v1.0.15（#39、#40）拼圖：把多張單張圖依「欄 × 列」排成一張大圖（像報告的圖 2.1-1：一個測站 8 個測項 2 欄 × 4 列）。
     specs：這一張大圖要放的單張圖（依序由左到右、由上到下）；格子比圖多時留白。
     o：同 draw 的選項，另加 cols、rows、cellW、cellH、title（空白＝不印標題）、makeCanvas（測試用）。 */
  var GRID_CELL = { w: 600, h: 380 }, GRID_GAP = 10, GRID_PAD = 14;
  function compose(canvas, specs, o) {
    o = o || {};
    var scale = o.scale || 1, cols = Math.max(1, o.cols || 2), rows = Math.max(1, o.rows || 1);
    var cw = o.cellW || GRID_CELL.w, chh = o.cellH || GRID_CELL.h;
    var mk = o.makeCanvas || function () { return document.createElement('canvas'); };
    // v1.0.16（#47）圖例：each 每格各一份、shared 整張大圖共用一份（畫在最下方）、none 圖上不放（另外下載圖例圖）
    var legMode = o.legend || 'each', cellHide = Object.assign({}, o.hide || {});
    if (legMode !== 'each') cellHide.legend = true;
    var dopt = function (h) { return Object.assign({}, o, { scale: scale, width: cw, height: h, stationInTitle: false, hide: cellHide }); };
    var cells = specs.slice(0, cols * rows).map(function (sp) {
      var cv = mk();
      var r = draw(cv, sp, dopt(chh));
      return { cv: cv, h: r.height, sp: sp, rot: r.layout.rot };
    });
    // X 軸寫法統一成最斜的那格（同一張大圖有斜寫又有直寫不好看）
    var maxRot = Math.max.apply(null, cells.map(function (c) { return c.rot; }).concat([0]));
    var dopt0 = dopt; dopt = function (h) { return Object.assign(dopt0(h), { minRot: maxRot }); };
    cells.forEach(function (c) { if (c.rot < maxRot) { var r = draw(c.cv, c.sp, dopt(chh)); c.h = r.height; c.rot = r.layout.rot; } });
    // 每格高度不一（X 軸標籤斜寫、圖例多列）時，全部用最高的那格重畫，格子大小一致、標題對齊
    var boxH = Math.max.apply(null, cells.map(function (c) { return c.h; }).concat([chh]));
    cells.forEach(function (c) { if (c.h < boxH) c.h = draw(c.cv, c.sp, dopt(boxH)).height; });
    boxH = Math.max.apply(null, cells.map(function (c) { return c.h; }).concat([boxH]));
    var fk = o.fontScale || 1, fsT = 24 * fk, titleH = 0, tLines = [];
    var W = GRID_PAD * 2 + cols * cw + (cols - 1) * GRID_GAP;
    var ctx = canvas.getContext('2d');
    if (o.title) {
      ctx.font = 'bold ' + fsT + 'px ' + FONT;
      tLines = wrapText(ctx, o.title, W - 40);
      titleH = tLines.length * (fsT + 8) + 10;
    }
    var legItems = legMode === 'shared' ? legendItems(specs.slice(0, cols * rows)) : [];
    var legLay = legItems.length ? legendLayout(ctx, legItems, W - 40, fk, o.chartType) : null;
    var legH = legLay ? legLay.h + 12 : 0;
    var H = GRID_PAD * 2 + titleH + rows * boxH + (rows - 1) * GRID_GAP + legH;
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    if (tLines.length) {
      ctx.fillStyle = '#1b2233'; ctx.font = 'bold ' + fsT + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      var plainG = []; specs.forEach(function (sp) { plainG.push(sp.station); sp.series.forEach(function (x) { plainG.push(x.name); }); });
      tLines.forEach(function (t, i) { richText(ctx, t, W / 2, GRID_PAD + fsT + i * (fsT + 8), fsT, true, plainG); });
    }
    cells.forEach(function (c, i) {
      var x = GRID_PAD + (i % cols) * (cw + GRID_GAP), y = GRID_PAD + titleH + Math.floor(i / cols) * (boxH + GRID_GAP);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(c.cv, Math.round(x * scale), Math.round((y + (boxH - c.h) / 2) * scale));
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.strokeStyle = '#c9ced8'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, boxH - 1);
    });
    if (legLay) paintLegend(ctx, legItems, legLay, (W - legLay.w) / 2, H - GRID_PAD - legLay.h);
    return { width: W, height: H, cells: cells.length, legend: legItems };
  }
  /* 圖例：多張「各測站並列」的圖用到的測站（依固定顏色順序） */
  function legendItems(specs) {
    var seen = {}, out = [];
    specs.forEach(function (sp) { if (sp.kind !== 'item' && sp.series.length < 2) return; sp.series.forEach(function (s, si) { if (seen[s.name]) return; seen[s.name] = 1; out.push({ name: s.name, ci: s.ci != null ? s.ci : si }); }); });
    return out.sort(function (a, b) { return a.ci - b.ci; });
  }
  function legendLayout(ctx, items, maxW, fk, type) {
    var f = 14 * (fk || 1), sw = (type === 'line' ? f * 1.8 : f) + 6, lh = f + 4;
    ctx.font = f + 'px ' + FONT;
    var cellW = Math.min(maxW, Math.max.apply(null, items.map(function (it) { return ctx.measureText(it.name).width; })) + sw + 18);
    var perRow = Math.max(1, Math.floor(maxW / cellW)), rows = Math.ceil(items.length / perRow);
    var lines = items.map(function (it) { return wrapText(ctx, it.name, cellW - sw - 8); }), rowH = [];
    for (var r = 0; r < rows; r++) { var mx = 1; for (var q = r * perRow; q < Math.min(items.length, (r + 1) * perRow); q++) mx = Math.max(mx, lines[q].length); rowH.push(mx * lh + 6); }
    return { type: type, f: f, sw: sw, lh: lh, cellW: cellW, perRow: perRow, lines: lines, rowH: rowH, w: Math.min(items.length, perRow) * cellW, h: rowH.reduce(function (a, b) { return a + b; }, 0) };
  }
  function paintLegend(ctx, items, lay, x0, y0) {
    ctx.save(); ctx.font = lay.f + 'px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    items.forEach(function (it, i) {
      var row = Math.floor(i / lay.perRow), ry = 0; for (var r = 0; r < row; r++) ry += lay.rowH[r];
      var x = x0 + (i % lay.perRow) * lay.cellW, y = y0 + ry + lay.f / 2 + 3;
      var stl = lineStyle({ ci: it.ci }, it.ci, true);
      swatch(ctx, lay.type, stl, x, y, lay.f);
      ctx.fillStyle = '#1b2233'; lay.lines[i].forEach(function (t, j) { ctx.fillText(t, x + lay.sw, y + j * lay.lh); });
    });
    ctx.restore();
  }
  /* 單獨的圖例圖（放簡報用）：items 由 legendItems 取得；o.maxW 一列最寬（預設 1200） */
  function drawLegend(canvas, items, o) {
    o = o || {}; var scale = o.scale || 1, ctx = canvas.getContext('2d');
    var lay = legendLayout(ctx, items, o.maxW || 1200, o.fontScale, o.chartType), pad = 12;
    var W = lay.w + pad * 2, H = lay.h + pad * 2;
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    paintLegend(ctx, items, lay, pad, pad - 2);
    return { width: W, height: H };
  }
  /* 依排法把單張圖分頁：每頁 cols×rows 格。groupKey 相同的放在同一組（第 3 種＝同測站；第 4 種＝全部同一組）。 */
  function gridPages(specs, cols, rows, groupKey) {
    var per = Math.max(1, cols * rows), groups = [], idx = {};
    specs.forEach(function (sp, i) {
      var k = groupKey ? groupKey(sp) : '';
      if (!(k in idx)) { idx[k] = groups.length; groups.push({ key: k, items: [] }); }
      groups[idx[k]].items.push(i);
    });
    var pages = [];
    groups.forEach(function (g) {
      var n = Math.ceil(g.items.length / per);
      for (var p = 0; p < n; p++) pages.push({ key: g.key, page: p + 1, pages: n, idx: g.items.slice(p * per, (p + 1) * per) });
    });
    return pages;
  }

  return { lineStyleOf: lineStyle, richSegs: richSegs, draw: draw, compose: compose, gridPages: gridPages, legendItems: legendItems, drawLegend: drawLegend, barChartXml: barChartXml, inject: inject, niceScale: niceScale, range: range, PALETTE: PALETTE, stdText: stdText, yTitleOf: yTitleOf, stdColor: stdColor };
});
