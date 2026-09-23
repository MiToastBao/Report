/* 監測報告趨勢圖產生器 — 趨勢長條圖（畫面／高解析 PNG）與 Excel 原生圖表 XML
 * spec = { title, unit, cats:[標籤], series:[{name, values:[{raw,num,kind}|null]}], stdLines:[{v,label}], kind:'station'|'item', station? }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTChart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FONT = '"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans CJK TC","Noto Sans TC",sans-serif';
  var PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E', '#636363', '#997300', '#255E91', '#43682B', '#7F6000', '#8E44AD', '#16A085', '#C0392B'];
  var SINGLE = '#5B9BD5', STD = '#E03131';

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
  function fmtStd(v) { return String(+v.toPrecision(6)); }
  function yTitleOf(spec) { return spec.unit ? spec.title + ' (' + spec.unit + ')' : spec.title; }
  function stdText(ln, unit) { return '標準值 ' + fmtStd(ln.v) + (unit ? ' ' + unit : '') + (ln.period ? '（' + ln.period + '）' : '') + (ln.sts && ln.suffix ? ln.suffix : ''); }

  function range(spec, o) {
    var lo = Infinity, hi = -Infinity;
    spec.series.forEach(function (s) { s.values.forEach(function (v) { if (v && v.num != null) { lo = Math.min(lo, v.num); hi = Math.max(hi, v.num); } }); });
    if (o.std !== false && o.stdAxis !== false) (spec.stdLines || []).forEach(function (l) { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (o.zero !== false && lo >= 0) lo = 0;
    return niceScale(lo, hi + (hi - lo) * 0.08, 6);
  }

  /* ---------- 畫布 ---------- */
  // 所有文字先量尺寸再排版：標題、Y 軸標題太長會換行；X 標籤放不下會斜 45° 或直排；
  // 標準值標籤會找不壓到長條的位置，找不到就放到圖上方的說明列，不會重疊、裁切或截斷。
  function wrapText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return [text];
    var lines = [], cur = '';
    var parts = text.split(/(\s+)/).filter(function (x) { return x !== ''; });
    if (parts.length === 1) parts = text.split('');
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
    return out;
  }
  function draw(canvas, spec, o) {
    o = o || {};
    var scale = o.scale || 1;
    var W = o.width || 980, H0 = o.height || 520;
    var ctx = canvas.getContext('2d');
    var multi = spec.series.length > 1 || spec.kind === 'item';
    var fs = { title: 21, axis: 16, tick: 14, legend: 14, std: 14 };
    function font(sz, bold) { return (bold ? 'bold ' : '') + sz + 'px ' + FONT; }
    var sc = range(spec, o), dec = decOf(sc.step);
    var n = spec.cats.length, ns = spec.series.length;
    var titleText = spec.kind === 'station' && o.stationInTitle ? spec.station + '　' + spec.title : spec.title;
    ctx.save();
    ctx.font = font(fs.title, true);
    var titleLines = wrapText(ctx, titleText, W - 60);
    ctx.font = font(fs.tick);
    var tickW = Math.max.apply(null, sc.ticks.map(function (t) { return ctx.measureText(fmt(t, dec)).width; }));
    var stdList = o.std !== false ? (spec.stdLines || []).filter(function (l) { return l.v >= sc.min && l.v <= sc.max; }) : [];
    var band = []; // 放不進圖內的標準值標籤
    var L;
    for (var pass = 0; pass < 3; pass++) {
      L = {};
      var topBand = band.length ? band.length * (fs.std + 8) + 6 : 0;
      L.top = 14 + titleLines.length * (fs.title + 6) + 10 + topBand;
      L.bandTop = 14 + titleLines.length * (fs.title + 6) + 6;
      ctx.font = font(fs.axis);
      var yLinesTry = [yTitleOf(spec)];
      L.right = 26;
      // Y 軸標題可能要兩行
      L.yLines = yLinesTry;
      L.left = 18 + fs.axis + 12 + tickW + 10;
      L.plotW = W - L.left - L.right;
      L.slot = L.plotW / Math.max(1, n);
      ctx.font = font(fs.tick);
      var maxLab = Math.max.apply(null, spec.cats.map(function (c) { return ctx.measureText(c).width; }).concat([0]));
      L.rot = maxLab + 10 > L.slot ? (fs.tick * 1.45 > L.slot * 0.72 ? 90 : 45) : 0;
      if (L.rot === 45 && (fs.tick + 4) * 1.42 > L.slot) L.rot = 90;
      L.labH = L.rot === 0 ? fs.tick + 6 : L.rot === 45 ? maxLab * 0.71 + fs.tick * 0.9 + 4 : maxLab + 8;
      // 45° 時第一個標籤往左下延伸，左邊界要夠
      if (L.rot === 45) { var need = maxLab * 0.71 - L.slot / 2 + 6; if (need > L.left - 10) { L.left = need + 10; L.plotW = W - L.left - L.right; L.slot = L.plotW / Math.max(1, n); } }
      L.legRows = 0;
      if (multi) {
        ctx.font = font(fs.legend);
        L.cellW = Math.min(W - 40, Math.max.apply(null, spec.series.map(function (s) { return ctx.measureText(s.name).width; })) + 38);
        L.perRow = Math.max(1, Math.floor((W - 40) / L.cellW));
        L.legRows = Math.ceil(ns / L.perRow);
      }
      L.legH = L.legRows ? L.legRows * (fs.legend + 10) + 10 : 0;
      L.bottom = 10 + L.labH + 8 + L.legH + 6;
      L.plotH = Math.max(220, H0 - L.top - L.bottom);
      ctx.font = font(fs.axis);
      L.yLines = wrapText(ctx, yTitleOf(spec), L.plotH - 10);
      if (L.yLines.length > 1) { L.left += (L.yLines.length - 1) * (fs.axis + 4); L.plotW = W - L.left - L.right; L.slot = L.plotW / Math.max(1, n); }
      L.H = L.top + L.plotH + L.bottom;
      L.y = function (v) { return L.top + L.plotH - (v - sc.min) / (sc.max - sc.min) * L.plotH; };
      // 長條位置
      L.barW = Math.max(2, Math.min(multi ? 34 : 56, L.slot * 0.72 / ns));
      L.groupW = L.barW * ns;
      L.bars = [];
      spec.series.forEach(function (s, si) {
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
      var newBand = [];
      stdList.forEach(function (ln) {
        if (band.indexOf(ln) >= 0) return;
        // 圖內標籤不寫期間（線的位置就代表期間）；放到上方說明列時才寫完整期間
        var txt = stdText({ v: ln.v, sts: ln.sts, suffix: ln.suffix }, spec.unit), tw = ctx.measureText(txt).width, th = fs.std + 2;
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
          if (!hit) ok = { x: r.x, y: r.y, w: r.w, h: r.h, tx: cands[c].x, ty: cands[c].y, txt: txt };
        }
        if (ok) L.labels.push(ok); else newBand.push(ln);
      });
      if (!newBand.length) break;
      // 只要有一條放不進圖內，就全部放到上方說明列，比較整齊
      band = stdList.slice().sort(function (a, b) { return b.v - a.v; });
    }
    var H = L.H;
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    // 標題
    ctx.fillStyle = '#1b2233'; ctx.font = font(fs.title, true); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    titleLines.forEach(function (t, i) { ctx.fillText(t, W / 2, 14 + fs.title + i * (fs.title + 6)); });
    // 格線與刻度
    ctx.font = font(fs.tick); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    sc.ticks.forEach(function (t) {
      var y = Math.round(L.y(t)) + 0.5;
      ctx.strokeStyle = t === sc.min ? '#8a93a6' : '#e3e7ee'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L.left, y); ctx.lineTo(L.left + L.plotW, y); ctx.stroke();
      ctx.fillStyle = '#3b4456'; ctx.fillText(fmt(t, dec), L.left - 8, y);
    });
    // Y 軸標題
    ctx.save();
    ctx.font = font(fs.axis); ctx.fillStyle = '#1b2233'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var yx0 = L.left - 10 - tickW - 12 - (L.yLines.length - 1) * (fs.axis + 4) - fs.axis / 2;
    L.yLines.forEach(function (t, i) {
      ctx.save(); ctx.translate(yx0 + i * (fs.axis + 4), L.top + L.plotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(t, 0, 0); ctx.restore();
    });
    ctx.restore();
    // 長條
    L.bars.forEach(function (b) {
      ctx.fillStyle = multi ? PALETTE[b.si % PALETTE.length] : (o.color || SINGLE);
      ctx.fillRect(b.x + (ns > 1 ? 0.5 : 0), b.y, b.w - (ns > 1 ? 1 : 0), b.h);
    });
    if (o.markND) {
      ctx.font = font(11); ctx.fillStyle = '#6b7385'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      spec.series.forEach(function (s, si) {
        s.values.forEach(function (v, i) {
          if (!v || v.num != null || v.kind === 'blank') return;
          var x0 = L.left + L.slot * i + (L.slot - L.groupW) / 2 + L.barW * si;
          var t = v.kind === 'nd' ? 'ND' : String(v.raw).replace(/\s+/g, '');
          ctx.save(); ctx.translate(x0 + L.barW / 2, L.y(Math.max(sc.min, 0)) - 3);
          if (ctx.measureText(t).width > L.barW + 2) { ctx.rotate(-Math.PI / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, 0, 0); }
          else ctx.fillText(t, 0, 0);
          ctx.restore();
        });
      });
    }
    // 標準線
    stdList.forEach(function (ln) {
      var y = Math.round(L.y(ln.v)) + 0.5;
      var x0 = L.left + L.slot * (ln.i0 != null ? ln.i0 : 0), x1 = L.left + L.slot * (ln.i1 != null ? ln.i1 + 1 : n);
      ctx.save(); ctx.strokeStyle = STD; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.restore();
    });
    ctx.font = font(fs.std, true); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = STD;
    L.labels.forEach(function (lb) { ctx.fillText(lb.txt, lb.tx, lb.ty); });
    // 放不進圖內的標準值 → 圖上方說明列
    band.forEach(function (ln, i) {
      var y = L.bandTop + i * (fs.std + 8) + fs.std / 2 + 2;
      var txt = stdText(ln, spec.unit), tw = ctx.measureText(txt).width;
      var x = L.left + Math.max(0, (L.plotW - tw - 40) / 2);
      ctx.save(); ctx.strokeStyle = STD; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + 30, y + 0.5); ctx.stroke(); ctx.restore();
      ctx.textBaseline = 'middle'; ctx.fillText(txt, x + 38, y);
    });
    // 外框
    ctx.strokeStyle = '#8a93a6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L.left + 0.5, L.top); ctx.lineTo(L.left + 0.5, L.top + L.plotH + 0.5); ctx.stroke();
    // X 標籤
    ctx.font = font(fs.tick); ctx.fillStyle = '#3b4456';
    spec.cats.forEach(function (c, i) {
      var x = L.left + L.slot * i + L.slot / 2, y = L.top + L.plotH + 8;
      if (L.rot === 0) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(c, x, y); }
      else {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-L.rot * Math.PI / 180);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(c, 0, 0); ctx.restore();
      }
    });
    // 圖例
    if (L.legRows) {
      ctx.font = font(fs.legend); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      var totalW = Math.min(ns, L.perRow) * L.cellW;
      var lx0 = (W - totalW) / 2, ly0 = L.top + L.plotH + 10 + L.labH + 10;
      spec.series.forEach(function (s, si) {
        var row = Math.floor(si / L.perRow), col = si % L.perRow;
        var x = lx0 + col * L.cellW, y = ly0 + row * (fs.legend + 10) + fs.legend / 2;
        ctx.fillStyle = PALETTE[si % PALETTE.length]; ctx.fillRect(x, y - 6, 14, 12);
        ctx.fillStyle = '#1b2233';
        var nm = s.name;
        ctx.fillText(nm, x + 20, y);
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
  function richTitle(text, sz, bold, rot) {
    return '<c:title><c:tx><c:rich><a:bodyPr' + (rot ? ' rot="-5400000" vert="horz"' : '') + '/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="' + (bold ? 1 : 0) + '"/></a:pPr><a:r><a:rPr lang="zh-TW" sz="' + sz + '" b="' + (bold ? 1 : 0) + '"><a:solidFill><a:srgbClr val="1B2233"/></a:solidFill><a:latin typeface="Microsoft JhengHei"/><a:ea typeface="Microsoft JhengHei"/></a:rPr><a:t>' + esc(text) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
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
    var ser = spec.series.map(function (s, i) {
      var color = (multi ? PALETTE[i % PALETTE.length] : SINGLE).slice(1);
      return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/><c:tx>' + strRef(x.series[i].nameRef, [s.name]) + '</c:tx>' +
        '<c:spPr><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>' +
        '<c:cat>' + strRef(x.catRef, spec.cats) + '</c:cat><c:val>' + numRef(x.series[i].valRef, s.values.map(function (v) { return v && v.num != null ? v.num : null; })) + '</c:val></c:ser>';
    }).join('');
    var k0 = spec.series.length;
    var lines = (x.stdSeries || []).map(function (s, j) {
      return '<c:ser><c:idx val="' + (k0 + j) + '"/><c:order val="' + (k0 + j) + '"/><c:tx>' + strRef(s.nameRef, [s.name]) + '</c:tx>' +
        '<c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="E03131"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>' +
        '<c:marker><c:symbol val="dash"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="E03131"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="E03131"/></a:solidFill></a:ln></c:spPr></c:marker>' +
        '<c:cat>' + strRef(x.catRef, spec.cats) + '</c:cat><c:val>' + numRef(s.valRef, s.vals) + '</c:val><c:smooth val="0"/></c:ser>';
    }).join('');
    var axFont = txPr(1000, 0);
    var scaling = '<c:scaling><c:orientation val="minMax"/>' + (x.zero !== false ? '<c:min val="0"/>' : '') + '</c:scaling>';
    var nStd = (x.stdSeries || []).length;
    var noLegend = !multi && !nStd;
    // 每站一張：圖例只放標準值（放在上方）；各站並列：圖例放下方（測站＋標準值）
    var nShown = (x.stdSeries || []).filter(function (s) { return !s.spare; }).length;
    noLegend = !multi && !nShown;
    // 預留（空白）的標準值數列不放進圖例
    var legend = noLegend ? '' : '<c:legend><c:legendPos val="' + (multi ? 'b' : 't') + '"/>' + (multi ? '' : '<c:legendEntry><c:idx val="0"/><c:delete val="1"/></c:legendEntry>') + (x.stdSeries || []).map(function (s, j) { return '<c:legendEntry><c:idx val="' + (k0 + j) + '"/>' + (s.spare ? '<c:delete val="1"/>' : txPr(1050, 1, 'E03131')) + '</c:legendEntry>'; }).join('') + '<c:overlay val="0"/>' + txPr(1000, 0) + '</c:legend>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:lang val="zh-TW"/><c:roundedCorners val="0"/><c:chart>' + richTitle(spec.kind === 'station' && x.stationInTitle ? spec.station + '　' + spec.title : spec.title, 1400, 1) + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' + ser + '<c:gapWidth val="' + (multi ? 80 : 150) + '"/><c:overlap val="0"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>' +
      (lines ? '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + lines + '<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>' : '') +
      '<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="8A93A6"/></a:solidFill></a:ln></c:spPr>' + axFont + '<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
      '<c:valAx><c:axId val="5002"/>' + scaling + '<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E3E7EE"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' + richTitle(yTitleOf(spec), 1100, 0, true) + '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="8A93A6"/></a:solidFill></a:ln></c:spPr>' + axFont + '<c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
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

  return { draw: draw, barChartXml: barChartXml, inject: inject, niceScale: niceScale, PALETTE: PALETTE, stdText: stdText, yTitleOf: yTitleOf };
});
