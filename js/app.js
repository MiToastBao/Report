/* 監測報告趨勢圖產生器 — 畫面 */
(function () {
  'use strict';
  var S = window.RTStore, X = window.RTX, D = window.RTDoc, Co = window.RTCore, CH = window.RTChart, XO = window.RTXlsx, M = window.RTMoenv;
  var LIBS = { XLSX: window.XLSX, JSZip: window.JSZip };
  var CATS = X.CATS.slice();
  var st = { projects: [], pid: null, recs: [], stds: [], meta: {}, sec: 'projects' };
  var SEC_TITLE = { projects: ['計畫與匯入', '計畫管理'], import: ['計畫與匯入', '匯入報告'], data: ['資料', '資料檢視'], check: ['資料', '資料異常檢查'], std: ['資料', '測項與標準值'], chart: ['輸出', '趨勢圖與報告表格'], moenv: ['不分計畫', '環境部資料查詢'], backup: ['不分計畫', '備份與還原'] };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, err) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, err ? 7000 : 3500);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function cur() { return st.projects.filter(function (p) { return p.id === st.pid; })[0] || null; }
  function needProject() { if (!st.pid) { toast('請先在「計畫管理」建立或選擇一個計畫', true); go('projects'); return false; } return true; }
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function safeName(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80); }
  function catsInData() { var o = []; st.recs.forEach(function (r) { if (o.indexOf(r.cat) < 0) o.push(r.cat); }); return CATS.filter(function (c) { return o.indexOf(c) >= 0; }).concat(o.filter(function (c) { return CATS.indexOf(c) < 0; })); }
  function allCats() { var o = CATS.slice(); catsInData().forEach(function (c) { if (o.indexOf(c) < 0) o.push(c); }); (st.meta.customCats || []).forEach(function (c) { if (o.indexOf(c) < 0) o.push(c); }); return o; }
  function nk(s) { return String(s || '').replace(/\s+/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')').toLowerCase(); }
  function opt(v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t == null ? v : t) + '</option>'; }

  /* ================= 導覽 ================= */
  function go(sec) {
    st.sec = sec;
    Array.prototype.forEach.call(document.querySelectorAll('.sec'), function (s) { s.hidden = s.id !== 'sec-' + sec; });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item[data-sec]'), function (b) { b.classList.toggle('on', b.getAttribute('data-sec') === sec); });
    $('crumb').textContent = SEC_TITLE[sec][0]; $('secTitle').textContent = SEC_TITLE[sec][1];
    $('importBar').hidden = !(sec === 'import' && pending.length);
    if (sec === 'data') renderData();
    if (sec === 'check') renderCheck();
    if (sec === 'std') renderStd();
    if (sec === 'chart') renderChartForm();
    if (sec === 'moenv') initMoenv();
    if (sec === 'backup') renderBackup();
    window.scrollTo(0, 0);
  }
  document.getElementById('nav').addEventListener('click', function (e) {
    var b = e.target.closest('.nav-item[data-sec]');
    if (b) go(b.getAttribute('data-sec'));
  });

  /* ================= 計畫 ================= */
  function loadProject(pid) {
    st.pid = pid;
    try { localStorage.setItem('rtg.pid', pid || ''); } catch (e) { /* 私密模式 */ }
    if (!pid) { st.recs = []; st.stds = []; st.meta = {}; renderHeader(); return Promise.resolve(); }
    return Promise.all([S.recs(pid), S.stds(pid), S.getMeta(pid, 'm', {})]).then(function (a) {
      st.recs = a[0]; st.stds = a[1]; st.meta = a[2] || {};
      ['stAlias', 'itemAlias', 'itemIgnore', 'ok', 'units', 'chartForm'].forEach(function (k) { if (!st.meta[k]) st.meta[k] = {}; });
      if (!st.meta.conflicts) st.meta.conflicts = [];
      if (!st.meta.log) st.meta.log = [];
      renderHeader();
      updateBadge();
    });
  }
  function saveMeta() { return S.setMeta(st.pid, 'm', st.meta); }
  function renderHeader() {
    var p = cur();
    $('projSel').innerHTML = st.projects.length > 1 ? '<option value="">切換到其他計畫…</option>' + st.projects.filter(function (x) { return x.id !== st.pid; }).map(function (x) { return opt(x.id, (x.code ? x.code + '・' : '') + x.name); }).join('') : '<option value="">' + (st.projects.length ? '（只有一個計畫）' : '（尚未建立計畫）') + '</option>';
    $('projSel').disabled = st.projects.length < 2;
    $('projCur').innerHTML = p ? (p.code ? '<span class="code">' + esc(p.code) + '</span>' : '') + esc(p.name) : '尚未建立計畫';
    $('projMeta').textContent = p ? st.recs.length + ' 筆資料・' + catsInData().length + ' 個類別' : '請先建立計畫';
    $('topProj').innerHTML = p ? '目前計畫：<b>' + esc((p.code ? p.code + ' ' : '') + p.name) + '</b>' : '尚未選擇計畫';
    renderProjects();
  }
  function renderProjects() {
    var el = $('projList');
    if (!st.projects.length) { el.innerHTML = '<div class="empty">還沒有計畫。<b>先在上方建立一個計畫</b>，再到「匯入報告」匯入檔案。</div>'; return; }
    el.innerHTML = st.projects.map(function (p) {
      var isCur = p.id === st.pid;
      return '<div class="proj-row' + (isCur ? ' cur' : '') + '"><div class="proj-code">' + esc(p.code || '—') + '</div><div class="proj-name"><div class="n">' + esc(p.name) + '</div><div class="s">建立於 ' + new Date(p.created).toLocaleDateString('zh-TW') + (isCur ? '・' + st.recs.length + ' 筆資料' : '') + '</div></div>' +
        (isCur ? '<span class="tag">目前計畫</span>' : '<button class="btn small" data-switch="' + p.id + '">切換到這個</button>') +
        '<button class="btn small" data-rename="' + p.id + '">改名</button><button class="btn small danger" data-del="' + p.id + '">刪除</button></div>';
    }).join('');
  }
  $('projList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = b.getAttribute('data-switch') || b.getAttribute('data-rename') || b.getAttribute('data-del');
    var p = st.projects.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    if (b.hasAttribute('data-switch')) { loadProject(id).then(function () { toast('已切換到「' + p.name + '」'); }); }
    else if (b.hasAttribute('data-rename')) {
      var code = prompt('計畫編號', p.code || ''); if (code === null) return;
      var name = prompt('計畫名稱', p.name); if (name === null || !name.trim()) return;
      p.code = code.trim(); p.name = name.trim();
      S.putProject(p).then(renderHeader);
    } else {
      if (!confirm('確定要刪除計畫「' + p.name + '」？\n這個計畫匯入的所有資料、標準值與設定都會一起刪除，無法復原。\n（建議先到「備份與還原」下載備份）')) return;
      S.deleteProject(id).then(function () {
        st.projects = st.projects.filter(function (x) { return x.id !== id; });
        return loadProject(st.projects.length ? st.projects[0].id : null);
      }).then(function () { toast('已刪除'); });
    }
  });
  $('projSel').addEventListener('change', function () { if (!this.value) return; loadProject(this.value).then(function () { if (st.sec !== 'projects' && st.sec !== 'moenv' && st.sec !== 'backup') go(st.sec); }); });
  ['pCode', 'pName'].forEach(function (id) { $(id).addEventListener('focus', function () { this.select(); }); });
  $('pAdd').addEventListener('click', function () {
    var name = $('pName').value.trim(), code = $('pCode').value.trim();
    if (!name) { toast('請輸入計畫名稱', true); $('pName').focus(); return; }
    var p = { id: uid(), code: code, name: name, created: Date.now() };
    S.putProject(p).then(function () {
      st.projects.push(p); $('pName').value = ''; $('pCode').value = '';
      return loadProject(p.id);
    }).then(function () { toast('已建立「' + name + '」，接著可以到「匯入報告」匯入檔案'); });
  });

  /* ================= 匯入 ================= */
  var pending = []; // [{name, ext, status, error, datasets:[]}]
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  $('fileInput').addEventListener('change', function () { handleFiles(this.files); this.value = ''; });

  function knownNames(cat, kind) {
    var o = {};
    st.recs.forEach(function (r) { if (r.cat === cat) o[nk(kind === 'st' ? r.st : r.item)] = kind === 'st' ? r.st : r.item; });
    // 同一批待匯入的檔案裡，前面檔案已經決定的名稱也算
    pending.forEach(function (f) {
      f.datasets.forEach(function (ds) {
        if (kind === 'st') { if (ds.cat === cat) Object.keys(ds.stMap).forEach(function (k) { var v = ds.stMap[k]; if (v && !o[nk(v)]) o[nk(v)] = v; }); }
        else Object.keys(ds.itemMap).forEach(function (k) { var v = ds.itemMap[k]; if (v && (ds.itemCat[k] || ds.cat) === cat && !o[nk(v)]) o[nk(v)] = v; });
      });
    });
    return o;
  }
  // 常見同義測項（報告寫英文縮寫、檢驗報告寫中文）：自動對到計畫裡已經有的寫法
  var SYN = [
    ['bod', 'bod5', '生化需氧量'], ['cod', '化學需氧量'], ['do', '溶氧', '溶氧量', '溶解氧'], ['ss', '懸浮固體', '懸浮固體物'],
    ['ph', 'ph值', '酸鹼值', '氫離子濃度指數'], ['nh3-n', 'nh3n', '氨氮'], ['tp', '總磷'], ['ec', '導電度'], ['no3-n', '硝酸鹽氮'],
    ['大腸桿菌群', '大腸菌群'], ['油脂', '油脂(正己烷抽出物)'], ['so2', '二氧化硫'], ['no2', '二氧化氮'], ['co', '一氧化碳'], ['o3', '臭氧'],
    ['nox', '氮氧化物'], ['no', '一氧化氮'], ['tsp', '總懸浮微粒'], ['pm10', '懸浮微粒'], ['pm2.5', '細懸浮微粒'],
    ['小時平均值', '最大小時平均值', '最大小時平均', '小時值'], ['8小時平均值', '最大8小時平均值', '8小時平均', '最大8小時平均'], ['日平均值', '日平均', '24小時平均值']
  ];
  var SYN_MAP = {};
  SYN.forEach(function (g, i) { g.forEach(function (w) { SYN_MAP[w] = '§' + i; }); });
  function canon(name) {
    return String(name || '').toLowerCase().replace(/\s*[(（]([a-z0-9.\-]+)[)）]/g, ' $1').split(/\s+/).filter(Boolean).map(function (t) { return SYN_MAP[t] || t.replace(/[（]/g, '(').replace(/[）]/g, ')'); }).join(' ');
  }
  function mapName(cat, kind, name) {
    var al = (kind === 'st' ? st.meta.stAlias : st.meta.itemAlias)[cat] || {};
    if (al[name]) return al[name];
    var known = knownNames(cat, kind);
    var kn = known[nk(name)];
    if (kn) return kn;
    if (kind === 'item') {
      var c = canon(name);
      var hit = Object.keys(known).map(function (k) { return known[k]; }).filter(function (n) { return canon(n) === c; });
      if (hit.length === 1) return hit[0];
    }
    return name;
  }
  function prepDataset(ds, fileName) {
    ds.sel = !!ds.cat && ds.likely !== false;
    if (!ds.cat) ds.cat = '';
    ds.stMap = {}; ds.itemMap = {}; ds.itemOn = {}; ds.itemCat = {};
    ds.items = [];
    ds.recs.forEach(function (r) { if (ds.items.indexOf(r.item) < 0) ds.items.push(r.item); });
    ds.textItems = {};
    ds.items.forEach(function (it) { if (Co.isTextItem(ds.recs.filter(function (r) { return r.item === it; }))) ds.textItems[it] = 1; });
    ds.noDate = ds.recs.some(function (r) { return !r.iso; });
    ds.dateText = '';
    applyNames(ds);
    return ds;
  }
  function defaultStation(cat) {
    var sts = {};
    st.recs.forEach(function (r) { if (r.cat === cat) sts[r.st] = 1; });
    var k = Object.keys(sts);
    return k.length === 1 ? k[0] : cat || '';
  }
  function applyNames(ds) {
    var cat = ds.cat;
    ds.stations.forEach(function (s) { ds.stMap[s] = s ? mapName(cat, 'st', s) : (ds.stMap[s] || defaultStation(cat)); });
    if (!ds.stations.length) ds.stMap[''] = ds.stMap[''] || defaultStation(cat);
    ds.items.forEach(function (it) {
      ds.itemCat[it] = ds.itemCat[it] || cat;
      if (/營建/.test(cat) && /低頻/.test(it)) ds.itemCat[it] = '營建低頻噪音';
      else if (cat === '營建低頻噪音' && /營建噪音|Lmax|振動|Lv/i.test(it) && !/低頻/.test(it)) ds.itemCat[it] = '營建噪音振動';
      var ic = ds.itemCat[it];
      ds.itemMap[it] = mapName(ic, 'item', it);
      var ign = (st.meta.itemIgnore[ic] || {})[it];
      ds.itemOn[it] = !ign;
    });
  }
  function handleFiles(files) {
    if (!needProject()) return;
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    go('import');
    var area = $('importArea');
    var prog = document.createElement('div'); prog.className = 'card';
    prog.innerHTML = '<b>讀取中…</b> <span id="rdMsg"></span><div class="progress"><i id="rdBar"></i></div>';
    area.insertBefore(prog, area.firstChild);
    var i = 0;
    function next() {
      if (i >= files.length) { prog.remove(); renderImport(); return; }
      var f = files[i++];
      $('rdMsg').textContent = '（' + i + '／' + files.length + '）' + f.name;
      $('rdBar').style.width = Math.round((i - 1) / files.length * 100) + '%';
      var ext = (f.name.match(/\.([^.]+)$/) || [])[1]; ext = ext ? ext.toLowerCase() : '';
      var item = { name: f.name, ext: ext, datasets: [], error: '' };
      if (/\.pdf$/i.test(f.name)) { item.error = 'PDF 檔無法判讀（掃描檔沒有文字）。請改用 Word 或 Excel 電子檔。'; pending.push(item); setTimeout(next, 0); return; }
      f.arrayBuffer().then(function (buf) {
        return new Promise(function (r) { setTimeout(r, 30); }).then(function () { return D.readFile(f.name, buf, LIBS); });
      }).then(function (doc) {
        item.kind = doc.kind;
        item.tableCount = doc.tables.length;
        var dss = X.extractAll(doc, { fileName: f.name, sheetBook: /xls|csv/.test(doc.kind) });
        item.datasets = dss.map(function (ds) { return prepDataset(ds, f.name); });
        if (!item.datasets.length) item.error = '讀到 ' + doc.tables.length + ' 張表格，但沒有找到含日期與數值的監測結果表。';
      }).catch(function (e) {
        item.error = '無法讀取：' + (e && e.message ? e.message : e) + '。若檔案可以用 Word／Excel 正常開啟，可以另存成 .docx／.xlsx 後再試一次。';
      }).then(function () { pending.push(item); setTimeout(next, 0); });
    }
    next();
  }
  function existingIndex() { var m = {}; st.recs.forEach(function (r) { m[r.k] = r; }); return m; }
  function dsRecords(ds, fileName) {
    var out = [];
    var dOverride = ds.dateText ? X.parseDate(ds.dateText) : null;
    ds.recs.forEach(function (r) {
      if (!ds.itemOn[r.item]) return;
      var cat = ds.itemCat[r.item] || ds.cat;
      if (!cat) return;
      var iso = r.iso, dl = r.dl;
      if (!iso && dOverride) { iso = dOverride.iso; dl = dOverride.label; }
      if (!iso) return;
      var stn = (ds.stMap[r.st] != null ? ds.stMap[r.st] : r.st) || ds.stMap[''] || '';
      stn = String(stn).trim();
      if (!stn) return;
      var o = { pid: st.pid, cat: cat, st: stn, iso: iso, dl: dl || Co.rocDate(iso), note: r.note || '', item: String(ds.itemMap[r.item] || r.item).trim(), unit: (st.meta.units[cat] || {})[ds.itemMap[r.item]] || r.unit || '', raw: String(r.raw).trim(), src: fileName, at: Date.now() };
      o.k = S.recKey(o);
      out.push(o);
    });
    return out;
  }
  function counts(list, idx) {
    var c = { n: 0, same: 0, diff: 0 };
    list.forEach(function (r) { var e = idx[r.k]; if (!e) c.n++; else if (e.raw === r.raw) c.same++; else c.diff++; });
    return c;
  }
  function catSelect(v, attrs) {
    return '<select ' + attrs + '>' + (v ? '' : '<option value="">（請選擇類別）</option>') + allCats().map(function (c) { return opt(c, c, c === v); }).join('') + '<option value="__new">＋ 新增類別…</option></select>';
  }
  function renderImport() {
    var area = $('importArea'), idx = existingIndex();
    if (!pending.length) { area.innerHTML = ''; $('importBar').hidden = true; return; }
    var tot = { n: 0, same: 0, diff: 0, tables: 0 }, seenAll = {};
    area.innerHTML = pending.map(function (f, fi) {
      var head = '<div class="file-head"><div class="file-icon ' + esc(f.ext) + '">' + esc((f.ext || '?').toUpperCase()) + '</div><div><div class="file-name">' + esc(f.name) + '</div><div class="file-sub">' +
        (f.error ? '' : '找到 ' + f.datasets.length + ' 張監測結果表' + (f.tableCount ? '（檔案共 ' + f.tableCount + ' 張表格／工作表）' : '')) + '</div></div><span class="spacer"></span><button class="btn small" data-rmfile="' + fi + '">移除</button></div>';
      if (f.error) return '<div class="file-card">' + head + '<div class="ds"><div class="err-box">' + esc(f.error) + '</div></div></div>';
      return '<div class="file-card">' + head + f.datasets.map(function (ds, di) {
        var list = ds.sel ? dsRecords(ds, f.name) : [];
        var c = counts(list, idx);
        if (ds.sel) {
          tot.tables++;
          list.forEach(function (r) {
            var e = idx[r.k], prev = seenAll[r.k];
            if (prev && prev === r.raw) return;
            if (!e && !prev) tot.n++; else if (e && e.raw === r.raw && !prev) tot.same++; else tot.diff++;
            seenAll[r.k] = r.raw;
          });
        }
        var isos = ds.recs.map(function (r) { return r.iso; }).filter(Boolean).sort();
        var range = isos.length ? Co.rocDate(isos[0]) + (isos[isos.length - 1] !== isos[0] ? '～' + Co.rocDate(isos[isos.length - 1]) : '') : '（無日期）';
        var eng = { rows: '結果表', transposed: '結果表（日期橫排）', form: '單次檢測報告' }[ds.engine] || '';
        var warn = [];
        if (!ds.cat) warn.push('無法判斷監測類別，請選擇類別後才會匯入（如果不是監測結果，不用勾選）');
        if (ds.noDate && !ds.dateText) warn.push('找不到監測日期，請在下方填寫採樣日期（例：115.05.11）');
        var noSt = ds.stations.length === 0 || ds.stations.some(function (s) { return !s; });
        return '<div class="ds' + (ds.sel ? '' : ' off') + '" data-f="' + fi + '" data-d="' + di + '">' +
          '<div class="ds-head"><label class="chk"><input type="checkbox" data-k="sel"' + (ds.sel ? ' checked' : '') + '> 匯入</label>' +
          '<div class="ds-title">' + esc(ds.caption || ds.sheet || '表格 ' + (ds.index + 1)) + '<small>' + esc(eng) + '・' + ds.recs.length + ' 個數值・' + range + '</small></div>' +
          catSelect(ds.cat, 'data-k="cat"') + '<div class="ds-counts">' + (ds.sel ? '<span class="pill new">新增 ' + c.n + '</span><span class="pill same">相同 ' + c.same + '</span>' + (c.diff ? '<span class="pill diff">數值不同將覆蓋 ' + c.diff + '</span>' : '') : '') + '</div></div>' +
          '<div class="ds-body">' + warn.map(function (w) { return '<div class="warn-box">⚠ ' + esc(w) + '</div>'; }).join('') +
          (ds.noDate ? '<div class="map-row" style="max-width:420px"><span class="from">採樣日期</span><input data-k="date" value="' + esc(ds.dateText) + '" placeholder="例：115.05.11"></div>' : '') +
          '<div class="sec-label">測站名稱（左邊是報告上的寫法，右邊可以改成計畫統一的名稱）</div><div class="map-grid">' +
          (ds.stations.length ? ds.stations : ['']).map(function (s) { return '<div class="map-row"><span class="from" title="' + esc(s) + '">' + esc(s || '（報告沒寫測站）') + '</span><input data-k="st" data-v="' + esc(s) + '" value="' + esc(ds.stMap[s] || '') + '"' + (s ? '' : ' placeholder="請填測站名稱"') + '></div>'; }).join('') + '</div>' +
          (noSt && ds.stations.length ? '' : '') +
          '<div class="sec-label">測項（取消勾選的測項不匯入，下次同名測項會自動略過）</div><div class="map-grid">' +
          ds.items.map(function (it) {
            return '<div class="map-row"><input type="checkbox" data-k="on" data-v="' + esc(it) + '"' + (ds.itemOn[it] ? ' checked' : '') + '><span class="from" title="' + esc(it) + '">' + esc(it) + (ds.textItems[it] ? ' <span class="pill info">文字</span>' : '') + '</span><input data-k="item" data-v="' + esc(it) + '" value="' + esc(ds.itemMap[it]) + '">' +
              (ds.itemCat[it] !== ds.cat ? catSelect(ds.itemCat[it], 'data-k="icat" data-v="' + esc(it) + '"') : '') + '</div>';
          }).join('') + '</div>' +
          (ds.stds.length ? '<div class="sec-label">報告上的標準值（匯入後可在「測項與標準值」修改）</div><div class="small muted">' + ds.stds.slice(0, 12).map(function (s) { return esc((s.st === '*' ? '' : (ds.stMap[s.st] || s.st) + '：') + (ds.itemMap[s.item] || s.item) + ' ' + s.text); }).join('；') + (ds.stds.length > 12 ? '…' : '') + '</div>' : '') +
          '<details class="preview"><summary>預覽判讀結果</summary>' + previewTable(ds) + '</details>' +
          '</div></div>';
      }).join('') + '</div>';
    }).join('');
    $('importBar').hidden = st.sec !== 'import';
    $('importSum').innerHTML = '已勾選 <b>' + tot.tables + '</b> 張表：<span class="pill new">新增 ' + tot.n + '</span><span class="pill same">與既有資料相同（不重複存） ' + tot.same + '</span>' + (tot.diff ? '<span class="pill diff">數值不同、將以後面的檔案為準 ' + tot.diff + '（會列入資料異常檢查）</span>' : '');
    $('importGo').disabled = !(tot.n + tot.diff);
  }
  function previewTable(ds) {
    var rows = {}, order = [];
    ds.recs.forEach(function (r) {
      var k = r.st + '|' + r.iso + '|' + r.note;
      if (!rows[k]) { rows[k] = { st: r.st, dl: r.dl, note: r.note, v: {} }; order.push(k); }
      rows[k].v[r.item] = r.raw;
    });
    var items = ds.items;
    return '<div class="prev-table"><table class="t"><thead><tr><th>測站</th><th>日期</th><th>備註</th>' + items.map(function (i) { return '<th>' + esc(i) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      order.slice(0, 200).map(function (k) { var r = rows[k]; return '<tr><td>' + esc(ds.stMap[r.st] || r.st) + '</td><td>' + esc(r.dl) + '</td><td>' + esc(r.note) + '</td>' + items.map(function (i) { return '<td class="num">' + esc(r.v[i] == null ? '' : r.v[i]) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' + (order.length > 200 ? '<div class="small muted">只顯示前 200 列</div>' : '');
  }
  $('importArea').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rmfile]');
    if (b) { pending.splice(+b.getAttribute('data-rmfile'), 1); renderImport(); }
  });
  $('importArea').addEventListener('change', function (e) {
    var el = e.target, box = el.closest('.ds'); if (!box) return;
    var ds = pending[+box.getAttribute('data-f')].datasets[+box.getAttribute('data-d')];
    var k = el.getAttribute('data-k'), v = el.getAttribute('data-v');
    if (k === 'sel') ds.sel = el.checked;
    else if (k === 'cat' || k === 'icat') {
      var val = el.value;
      if (val === '__new') {
        val = (prompt('新類別名稱（例：交通量、室內空氣品質）') || '').trim();
        if (!val) { renderImport(); return; }
        st.meta.customCats = (st.meta.customCats || []).concat([val]); saveMeta();
      }
      if (k === 'cat') {
        var old = ds.cat; ds.cat = val;
        ds.items.forEach(function (it) { if (!ds.itemCat[it] || ds.itemCat[it] === old) ds.itemCat[it] = val; });
        if (val) ds.sel = true;
        applyNames(ds);
      } else ds.itemCat[v] = val;
    }
    else if (k === 'st') ds.stMap[v] = el.value.trim();
    else if (k === 'item') ds.itemMap[v] = el.value.trim();
    else if (k === 'on') ds.itemOn[v] = el.checked;
    else if (k === 'date') ds.dateText = el.value.trim();
    renderImport();
  });
  $('importClear').addEventListener('click', function () { if (confirm('清除這批尚未匯入的檔案？')) { pending = []; renderImport(); } });
  $('importGo').addEventListener('click', function () {
    var idx = existingIndex(), put = [], conflicts = [], stdsPut = [], seen = {};
    var stdIdx = {}; st.stds.forEach(function (s) { stdIdx[s.k] = s; });
    pending.forEach(function (f) {
      f.datasets.forEach(function (ds) {
        if (!ds.sel) return;
        dsRecords(ds, f.name).forEach(function (r) {
          var e = idx[r.k];
          if (e && e.raw === r.raw) return;
          if (seen[r.k] && seen[r.k].raw === r.raw) return;
          if (e) { conflicts.push({ k: r.k, cat: r.cat, old: e.raw, oldSrc: e.src, raw: r.raw, src: r.src, at: Date.now() }); r.excl = e.excl; }
          seen[r.k] = r; put.push(r);
        });
        // 別名、略過的測項
        ds.stations.forEach(function (s) { if (s && ds.stMap[s] && ds.stMap[s] !== s) { (st.meta.stAlias[ds.cat] = st.meta.stAlias[ds.cat] || {})[s] = ds.stMap[s]; } });
        ds.items.forEach(function (it) {
          var ic = ds.itemCat[it] || ds.cat; if (!ic) return;
          if (ds.itemMap[it] && ds.itemMap[it] !== it) (st.meta.itemAlias[ic] = st.meta.itemAlias[ic] || {})[it] = ds.itemMap[it];
          var ig = st.meta.itemIgnore[ic] = st.meta.itemIgnore[ic] || {};
          if (!ds.itemOn[it]) ig[it] = 1; else delete ig[it];
        });
        // 標準值（使用者改過的不覆蓋）
        // 報告上的「全部測站」只代表這張表裡的測站（不同表可能是不同海域分類、管制區），所以逐站存
        var dsSts = [];
        dsRecords(ds, f.name).forEach(function (r) { if (dsSts.indexOf(r.st) < 0) dsSts.push(r.st); });
        ds.stds.forEach(function (s) {
          if (!ds.itemOn[s.item]) return;
          var ic = ds.itemCat[s.item] || ds.cat; if (!ic) return;
          var targets = s.st === '*' ? dsSts : [ds.stMap[s.st] || s.st];
          targets.forEach(function (stn) {
            var o = { pid: st.pid, cat: ic, st: stn, item: ds.itemMap[s.item] || s.item, text: s.text, lines: s.lines, label: s.label || '', by: 'auto', from: s.from || '', to: s.to || '' };
            o.k = S.stdKey(o);
            var ex = stdIdx[o.k];
            if (ex && ex.by === 'user') return;
            stdIdx[o.k] = o; stdsPut.push(o);
          });
        });
      });
    });
    var byK = {}; put.forEach(function (r) { byK[r.k] = r; }); put = Object.keys(byK).map(function (k) { return byK[k]; });
    st.meta.conflicts = st.meta.conflicts.concat(conflicts).slice(-1000);
    st.meta.log.push({ at: Date.now(), files: pending.map(function (f) { return f.name; }), n: put.length, conflicts: conflicts.length });
    var n = put.length;
    Promise.all([S.putRecs(put), S.putStds(stdsPut), saveMeta()]).then(function () { return loadProject(st.pid); }).then(function () {
      pending = []; renderImport();
      $('importArea').innerHTML = '<div class="ok-box">✔ 已匯入 ' + n + ' 筆數值' + (conflicts.length ? '，其中 ' + conflicts.length + ' 筆與既有資料數值不同、已改用新檔（已列入「資料異常檢查」）' : '') + '。可以到「資料異常檢查」確認，或直接到「趨勢圖與報告表格」產生圖表。</div>';
      toast('匯入完成');
    }).catch(function (e) { toast('匯入失敗：' + e.message, true); });
  });

  /* ================= 資料檢視 ================= */
  var dPage = 0;
  function periodOptions(sel) {
    var qs = {}, ys = {};
    st.recs.forEach(function (r) { qs[Co.quarterOf(r.iso)] = 1; ys[Co.rocY(r.iso)] = 1; });
    return opt('', '全部期間', !sel) + Object.keys(ys).sort().reverse().map(function (y) { return opt('y' + y, y + ' 年', sel === 'y' + y); }).join('') + Object.keys(qs).sort().reverse().map(function (q) { return opt('q' + q, q, sel === 'q' + q); }).join('');
  }
  function periodOf(code) {
    if (!code) return null;
    if (code[0] === 'y') { var y = +code.slice(1) + 1911; return { from: y + '-01', to: y + '-12' }; }
    var m = /q(\d+)Q(\d)/.exec(code); var yy = +m[1] + 1911, q = +m[2];
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return { from: yy + '-' + p2(q * 3 - 2), to: yy + '-' + p2(q * 3) };
  }
  function renderData() {
    if (!st.pid) { $('dTable').innerHTML = '<div class="empty">請先建立或選擇計畫</div>'; return; }
    var cat = $('dCat').value, cats = catsInData();
    $('dCat').innerHTML = opt('', '全部類別', !cat) + cats.map(function (c) { return opt(c, c, c === cat); }).join('');
    var list = st.recs.filter(function (r) { return !cat || r.cat === cat; });
    var stv = $('dSt').value, itv = $('dItem').value, pv = $('dPeriod').value;
    var sts = [], its = [];
    list.forEach(function (r) { if (sts.indexOf(r.st) < 0) sts.push(r.st); if (its.indexOf(r.item) < 0) its.push(r.item); });
    $('dSt').innerHTML = opt('', '全部測站', !stv) + sts.map(function (s) { return opt(s, s, s === stv); }).join('');
    $('dItem').innerHTML = opt('', '全部測項', !itv) + its.map(function (s) { return opt(s, s, s === itv); }).join('');
    $('dPeriod').innerHTML = periodOptions(pv);
    var p = periodOf(pv), q = $('dQ').value.trim();
    list = list.filter(function (r) { return (!stv || r.st === stv) && (!itv || r.item === itv) && Co.inPeriod(r.iso, p) && (!q || (r.raw + ' ' + r.src + ' ' + r.note + ' ' + r.dl).indexOf(q) >= 0); });
    list.sort(function (a, b) { return a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : a.st < b.st ? -1 : a.st > b.st ? 1 : a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : a.item < b.item ? -1 : 1; });
    var per = 400, pages = Math.max(1, Math.ceil(list.length / per));
    if (dPage >= pages) dPage = 0;
    var show = list.slice(dPage * per, dPage * per + per);
    $('dCount').innerHTML = '共 ' + list.length + ' 筆' + (pages > 1 ? '・第 <select id="dPg">' + Array.apply(null, Array(pages)).map(function (x, i) { return opt(i, (i + 1) + '／' + pages, i === dPage); }).join('') + '</select> 頁' : '') + '　<span class="small">（數值可直接點一下修改，按 Enter 或移開就會儲存）</span>';
    $('dTable').innerHTML = show.length ? '<table class="t"><thead><tr><th><input type="checkbox" id="dChkAll"></th><th>類別</th><th>測站</th><th>採樣日期</th><th>備註</th><th>測項</th><th>數值</th><th>單位</th><th>來源檔案</th></tr></thead><tbody>' +
      show.map(function (r) {
        return '<tr' + (r.excl ? ' class="excl"' : '') + '><td><input type="checkbox" data-k="' + esc(r.k) + '"></td><td>' + esc(r.cat) + '</td><td>' + esc(r.st) + '</td><td>' + esc(r.dl) + '</td><td>' + esc(r.note) + '</td><td>' + esc(r.item) + '</td><td class="num"><input class="cell" data-edit="' + esc(r.k) + '" value="' + esc(r.raw) + '"></td><td>' + esc(r.unit) + '</td><td class="small muted">' + esc(r.src || '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">沒有符合條件的資料</div>';
  }
  ['dCat', 'dSt', 'dItem', 'dPeriod'].forEach(function (id) { $(id).addEventListener('change', function () { if (id === 'dCat') { $('dSt').value = ''; $('dItem').value = ''; } dPage = 0; renderData(); }); });
  $('dQ').addEventListener('input', function () { dPage = 0; clearTimeout(renderData._t); renderData._t = setTimeout(renderData, 250); });
  $('dCount').addEventListener('change', function (e) { if (e.target.id === 'dPg') { dPage = +e.target.value; renderData(); } });
  $('dTable').addEventListener('change', function (e) {
    if (e.target.id === 'dChkAll') { Array.prototype.forEach.call($('dTable').querySelectorAll('input[data-k]'), function (c) { c.checked = e.target.checked; }); return; }
    var k = e.target.getAttribute('data-edit'); if (!k) return;
    editValue(k, e.target.value).then(function () { e.target.classList.add('changed'); });
  });
  $('dTable').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList.contains('cell')) e.target.blur(); });
  function editValue(k, val) {
    var r = st.recs.filter(function (x) { return x.k === k; })[0]; if (!r) return Promise.resolve();
    val = String(val).trim();
    if (val === r.raw) return Promise.resolve();
    if (!val) { toast('數值不可空白；若要移除請用「刪除勾選的」', true); return Promise.resolve(); }
    r.raw = val; r.edited = Date.now();
    return S.putRecs([r]).then(function () { toast('已修改：' + r.st + ' ' + r.dl + ' ' + r.item + ' → ' + val); });
  }
  function checkedKeys(root) { return Array.prototype.map.call(root.querySelectorAll('input[data-k]:checked'), function (c) { return c.getAttribute('data-k'); }); }
  $('dDel').addEventListener('click', function () {
    var ks = checkedKeys($('dTable')); if (!ks.length) { toast('請先勾選要刪除的資料', true); return; }
    if (!confirm('刪除勾選的 ' + ks.length + ' 筆資料？無法復原。')) return;
    S.delRecs(ks).then(function () { return loadProject(st.pid); }).then(renderData);
  });
  function setExcl(ks, v) {
    var set = {}; ks.forEach(function (k) { set[k] = 1; });
    var ch = st.recs.filter(function (r) { return set[r.k]; });
    ch.forEach(function (r) { if (v) r.excl = 1; else delete r.excl; });
    return S.putRecs(ch);
  }
  $('dExcl').addEventListener('click', function () { var ks = checkedKeys($('dTable')); if (!ks.length) return toast('請先勾選', true); setExcl(ks, true).then(renderData); });
  $('dIncl').addEventListener('click', function () { var ks = checkedKeys($('dTable')); if (!ks.length) return toast('請先勾選', true); setExcl(ks, false).then(renderData); });
  $('dAdd').addEventListener('click', function () {
    if (!needProject()) return;
    var f = $('dAddForm'); f.hidden = !f.hidden; if (f.hidden) return;
    f.innerHTML = '<div class="form-row"><label>類別' + catSelect($('dCat').value || catsInData()[0] || '', 'id="aCat"') + '</label><label>測站<input id="aSt"></label><label>採樣日期<input id="aDate" placeholder="115.05.11"></label><label>備註<input id="aNote" placeholder="例：平日"></label><label>測項<input id="aItem"></label><label>數值<input id="aVal" placeholder="例：12.3、ND"></label><label>單位<input id="aUnit"></label><button class="btn primary" id="aSave">新增</button></div>';
    $('aSave').onclick = function () {
      var d = X.parseDate($('aDate').value), cat = $('aCat').value;
      if (!cat || cat === '__new' || !$('aSt').value.trim() || !d || !$('aItem').value.trim() || !$('aVal').value.trim()) { toast('類別、測站、日期、測項、數值都要填（日期例：115.05.11）', true); return; }
      var o = { pid: st.pid, cat: cat, st: $('aSt').value.trim(), iso: d.iso, dl: d.label, note: $('aNote').value.trim(), item: $('aItem').value.trim(), unit: $('aUnit').value.trim(), raw: $('aVal').value.trim(), src: '手動新增', at: Date.now() };
      o.k = S.recKey(o);
      S.putRecs([o]).then(function () { return loadProject(st.pid); }).then(function () { toast('已新增'); renderData(); });
    };
  });

  /* ================= 異常檢查 ================= */
  var cFilter = '', cShowOk = false, lastAnoms = [];
  var TYPE_LABEL = { text: '判讀不出的數值', outlier: '異常高低值', conflict: '兩份檔案數值不同', missing: '缺測項', similar: '名稱很像的測站', unit: '單位不一致', over: '超過標準值（提示）' };
  function runCheck() { lastAnoms = Co.anomalies(st.recs, st.stds, { ok: cShowOk ? {} : st.meta.ok, conflicts: st.meta.conflicts }); updateBadge(); return lastAnoms; }
  function updateBadge() {
    var n = st.pid ? Co.anomalies(st.recs, st.stds, { ok: st.meta.ok, conflicts: st.meta.conflicts }).filter(function (a) { return a.level !== 'info'; }).length : 0;
    var b = $('checkBadge'); b.hidden = !n; b.textContent = n;
  }
  function renderCheck() {
    if (!st.pid) { $('cList').innerHTML = '<div class="empty">請先建立或選擇計畫</div>'; return; }
    var an = runCheck();
    var cnt = {}; an.forEach(function (a) { cnt[a.type] = (cnt[a.type] || 0) + 1; });
    $('cChips').innerHTML = '<span class="chip' + (!cFilter ? ' on' : '') + '" data-t="">全部<b>' + an.length + '</b></span>' + Object.keys(TYPE_LABEL).filter(function (t) { return cnt[t]; }).map(function (t) { return '<span class="chip' + (cFilter === t ? ' on' : '') + '" data-t="' + t + '">' + TYPE_LABEL[t] + '<b>' + cnt[t] + '</b></span>'; }).join('');
    var list = an.filter(function (a) { return !cFilter || a.type === cFilter; });
    if (!st.recs.length) { $('cList').innerHTML = '<div class="empty">還沒有資料</div>'; return; }
    if (!list.length) { $('cList').innerHTML = '<div class="ok-box">✔ 目前沒有需要確認的項目。</div>'; return; }
    $('cList').innerHTML = list.slice(0, 600).map(function (a, i) {
      var where = a.rec ? a.cat + '｜' + a.rec.st + '｜' + a.rec.dl + (a.rec.note ? '（' + a.rec.note + '）' : '') + '｜' + a.rec.item : a.type === 'missing' ? a.cat + '｜' + a.st + '｜' + a.dl : a.cat;
      var act = '';
      if (a.rec) act = '<input class="cell" data-edit="' + esc(a.rec.k) + '" value="' + esc(a.rec.raw) + '" title="直接修改數值">' + (a.rec.excl ? '<span class="pill same">已不採用</span>' : '');
      if (a.type === 'similar') act = '<button class="btn small" data-merge="' + i + '" data-to="0">合併為「' + esc(a.names[0]) + '」</button><button class="btn small" data-merge="' + i + '" data-to="1">合併為「' + esc(a.names[1]) + '」</button>';
      return '<div class="anom ' + a.level + '"><input type="checkbox" data-id="' + esc(a.id) + '" data-rk="' + esc(a.rec ? a.rec.k : '') + '"><div class="a-main"><div class="a-where">' + esc(TYPE_LABEL[a.type]) + '・' + esc(where) + (a.rec && a.rec.src ? '・' + esc(a.rec.src) : '') + '</div><div class="a-msg">' + esc(a.msg) + '</div></div><div class="a-act">' + act + '</div></div>';
    }).join('') + (list.length > 600 ? '<div class="muted small">只顯示前 600 項</div>' : '');
    $('cAll').checked = false;
  }
  $('cChips').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (!c) return; cFilter = c.getAttribute('data-t'); renderCheck(); });
  $('cRun').addEventListener('click', function () { renderCheck(); toast('檢查完成'); });
  $('cAll').addEventListener('change', function () { var v = this.checked; Array.prototype.forEach.call($('cList').querySelectorAll('input[data-id]'), function (c) { c.checked = v; }); });
  $('cList').addEventListener('change', function (e) { var k = e.target.getAttribute('data-edit'); if (k) editValue(k, e.target.value).then(function () { e.target.classList.add('changed'); }); });
  $('cList').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList.contains('cell')) e.target.blur(); });
  $('cList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-merge]'); if (!b) return;
    var a = runCheck().filter(function (x) { return x.type === 'similar'; });
    var shown = lastAnoms.filter(function (x) { return !cFilter || x.type === cFilter; });
    var an = shown[+b.getAttribute('data-merge')]; if (!an) return;
    var to = an.names[+b.getAttribute('data-to')], from = an.names[1 - +b.getAttribute('data-to')];
    if (!confirm('把「' + from + '」的資料全部改成測站「' + to + '」？之後匯入「' + from + '」也會自動改名。')) return;
    renameStation(an.cat, from, to).then(renderCheck);
  });
  function renameStation(cat, from, to) {
    var ch = [], del = [];
    st.recs.forEach(function (r) { if (r.cat === cat && r.st === from) { del.push(r.k); var o = Object.assign({}, r, { st: to }); o.k = S.recKey(o); ch.push(o); } });
    var sch = [], sdel = [];
    st.stds.forEach(function (s) { if (s.cat === cat && s.st === from) { sdel.push(s.k); var o = Object.assign({}, s, { st: to }); o.k = S.stdKey(o); sch.push(o); } });
    var al = st.meta.stAlias[cat] = st.meta.stAlias[cat] || {};
    al[from] = to; Object.keys(al).forEach(function (k) { if (al[k] === from) al[k] = to; });
    return Promise.all([S.putRecs(ch, del), S.putStds(sch, sdel), saveMeta()]).then(function () { return loadProject(st.pid); }).then(function () { toast('已合併測站'); });
  }
  $('cOk').addEventListener('click', function () {
    var ids = Array.prototype.map.call($('cList').querySelectorAll('input[data-id]:checked'), function (c) { return c.getAttribute('data-id'); });
    if (!ids.length) return toast('請先勾選', true);
    ids.forEach(function (id) { st.meta.ok[id] = Date.now(); });
    saveMeta().then(function () { renderCheck(); toast('已確認 ' + ids.length + ' 項'); });
  });
  $('cExcl').addEventListener('click', function () {
    var ks = Array.prototype.map.call($('cList').querySelectorAll('input[data-id]:checked'), function (c) { return c.getAttribute('data-rk'); }).filter(Boolean);
    if (!ks.length) return toast('請勾選有數值的項目', true);
    setExcl(ks, true).then(function () { renderCheck(); toast(ks.length + ' 筆設為不採用（在資料檢視可恢復）'); });
  });
  $('cReset').addEventListener('click', function () { cShowOk = !cShowOk; this.textContent = cShowOk ? '隱藏已確認的項目' : '重新顯示已確認的項目'; renderCheck(); });

  /* ================= 標準值 ================= */
  function renderStd() {
    if (!st.pid) { $('sTable').innerHTML = '<div class="empty">請先建立或選擇計畫</div>'; $('iTable').innerHTML = ''; return; }
    var cats = catsInData(), cat = $('sCat').value;
    if (!cat || cats.indexOf(cat) < 0) cat = cats[0] || '';
    $('sCat').innerHTML = cats.map(function (c) { return opt(c, c, c === cat); }).join('') || '<option value="">（還沒有資料）</option>';
    var cg = Co.catalog(st.recs.filter(function (r) { return true; }), cat, null);
    var list = st.stds.filter(function (s) { return s.cat === cat; });
    var groups = {}, order = [];
    list.forEach(function (s) {
      var g = s.item + '\u0001' + (s.from || '') + '\u0001' + (s.to || '') + '\u0001' + s.text;
      if (!groups[g]) { groups[g] = { item: s.item, text: s.text, lines: s.lines, label: s.label, by: s.by, from: s.from || '', to: s.to || '', keys: [], sts: [] }; order.push(g); }
      groups[g].keys.push(s.k); groups[g].sts.push(s.st === '*' ? '全部測站' : s.st);
      if (s.by === 'user') groups[g].by = 'user';
    });
    order.sort(function (a, b) { return a < b ? -1 : 1; });
    stdGroups = order.map(function (g) { return groups[g]; });
    $('sTable').innerHTML = stdGroups.length ? '<table class="t"><thead><tr><th>測項</th><th>標準值</th><th>適用期間 起</th><th>適用期間 迄</th><th>畫線數值</th><th>適用測站</th><th>說明</th><th>來源</th><th></th></tr></thead><tbody>' + stdGroups.map(function (g, i) {
      return '<tr><td>' + esc(g.item) + '</td><td><input class="cell" style="width:110px;text-align:left" data-sg="' + i + '" value="' + esc(g.text) + '"></td>' +
        '<td><input class="cell" style="width:105px;text-align:left" data-sgf="' + i + '" value="' + esc(g.from ? Co.rocDate(g.from) : '') + '" placeholder="不限"></td><td><input class="cell" style="width:105px;text-align:left" data-sgt="' + i + '" value="' + esc(g.to ? Co.rocDate(g.to) : '') + '" placeholder="不限"></td>' +
        '<td>' + esc(g.lines.join('、')) + '</td><td style="white-space:normal;max-width:420px">' + esc(g.sts.join('、')) + '</td><td class="small muted" style="white-space:normal;max-width:220px">' + esc(g.label || '') + '</td><td class="small muted">' + (g.by === 'user' ? '自行設定' : '報告帶入') + '</td><td><button class="btn small danger" data-sgdel="' + i + '">刪除</button></td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty">這個類別還沒有標準值</div>';
    var units = st.meta.units[cat] || {};
    $('iTable').innerHTML = cg.items.length ? '<table class="t"><thead><tr><th>測項名稱</th><th>改名為</th><th>單位</th><th>筆數</th></tr></thead><tbody>' + cg.items.map(function (it) {
      var n = st.recs.filter(function (r) { return r.cat === cat && r.item === it; }).length;
      return '<tr><td>' + esc(it) + (cg.textItems[it] ? ' <span class="pill info">文字，不畫圖</span>' : '') + '</td><td><input class="cell" style="width:180px;text-align:left" data-ren="' + esc(it) + '" value="' + esc(it) + '"></td><td><input class="cell" style="width:120px;text-align:left" data-unit="' + esc(it) + '" value="' + esc(units[it] || cg.units[it] || '') + '"></td><td class="num">' + n + '</td></tr>';
    }).join('') + '</tbody></table>' : '';
  }
  $('sCat').addEventListener('change', renderStd);
  var stdGroups = [];
  $('sTable').addEventListener('change', function (e) {
    var el = e.target, i = el.getAttribute('data-sg'), fi = el.getAttribute('data-sgf'), ti = el.getAttribute('data-sgt');
    var idx = i != null ? i : fi != null ? fi : ti; if (idx == null) return;
    var g = stdGroups[+idx], val = el.value.trim();
    var ch = st.stds.filter(function (x) { return g.keys.indexOf(x.k) >= 0; });
    if (fi != null || ti != null) {
      var d = val ? X.parseDate(val) : null;
      if (val && !d) { toast('日期看不懂，請用 113.09.30 這種寫法（空白＝不限）', true); el.value = ''; return; }
      var del = ch.map(function (x) { return x.k; });
      ch.forEach(function (x) { if (fi != null) x.from = d ? d.iso : ''; else x.to = d ? d.iso : ''; x.by = 'user'; x.k = S.stdKey(x); });
      if (ch.some(function (x) { return x.from && x.to && x.from > x.to; })) { toast('起日不能晚於迄日', true); return loadProject(st.pid).then(renderStd); }
      S.putStds(ch, del).then(function () { return loadProject(st.pid); }).then(function () { renderStd(); toast('已更新適用期間'); });
      return;
    }
    ch.forEach(function (x) { x.text = val; x.lines = X.stdLines(val); x.by = 'user'; });
    S.putStds(ch).then(function () { renderStd(); toast('已更新 ' + ch.length + ' 個測站的標準值'); });
  });
  $('sTable').addEventListener('click', function (e) {
    var i = e.target.getAttribute('data-sgdel'); if (i == null) return;
    var ks = stdGroups[+i].keys;
    S.putStds([], ks).then(function () { st.stds = st.stds.filter(function (s) { return ks.indexOf(s.k) < 0; }); renderStd(); });
  });
  $('sAdd').addEventListener('click', function () {
    var cat = $('sCat').value; if (!cat) return toast('請先匯入資料', true);
    var cg = Co.catalog(st.recs, cat, null);
    var item = prompt('測項名稱（要和資料裡的測項完全相同）\n可用：' + cg.items.join('、'), cg.items[0] || ''); if (!item) return;
    var stn = prompt('適用測站（留空＝全部測站）\n可用：' + cg.stations.join('、'), ''); if (stn === null) return;
    var text = prompt('標準值（例：75、6~9）', ''); if (!text) return;
    var f = prompt('適用期間「起」（例：112.01.01；留空＝不限）', ''); if (f === null) return;
    var t = prompt('適用期間「迄」（例：112.12.31；留空＝不限）', ''); if (t === null) return;
    var fd = f.trim() ? X.parseDate(f) : null, td = t.trim() ? X.parseDate(t) : null;
    if ((f.trim() && !fd) || (t.trim() && !td)) return toast('日期看不懂，請用 112.01.01 這種寫法', true);
    var o = { pid: st.pid, cat: cat, st: stn.trim() || '*', item: item.trim(), text: text.trim(), lines: X.stdLines(text), label: '', by: 'user', from: fd ? fd.iso : '', to: td ? td.iso : '' };
    o.k = S.stdKey(o);
    S.putStds([o]).then(function () { return loadProject(st.pid); }).then(renderStd);
  });
  $('iTable').addEventListener('change', function (e) {
    var cat = $('sCat').value, from = e.target.getAttribute('data-ren'), uit = e.target.getAttribute('data-unit');
    if (uit != null) {
      var u = e.target.value.trim();
      (st.meta.units[cat] = st.meta.units[cat] || {})[uit] = u;
      var ch = st.recs.filter(function (r) { return r.cat === cat && r.item === uit; });
      ch.forEach(function (r) { r.unit = u; });
      Promise.all([S.putRecs(ch), saveMeta()]).then(function () { toast('已更新單位'); });
      return;
    }
    if (!from) return;
    var to = e.target.value.trim(); if (!to || to === from) return;
    if (!confirm('把類別「' + cat + '」的測項「' + from + '」全部改名為「' + to + '」？')) { e.target.value = from; return; }
    var chg = [], del = [];
    st.recs.forEach(function (r) { if (r.cat === cat && r.item === from) { del.push(r.k); var o = Object.assign({}, r, { item: to }); o.k = S.recKey(o); chg.push(o); } });
    var sch = [], sdel = [];
    st.stds.forEach(function (s) { if (s.cat === cat && s.item === from) { sdel.push(s.k); var o = Object.assign({}, s, { item: to }); o.k = S.stdKey(o); sch.push(o); } });
    var al = st.meta.itemAlias[cat] = st.meta.itemAlias[cat] || {};
    al[from] = to; Object.keys(al).forEach(function (k) { if (al[k] === from) al[k] = to; });
    Promise.all([S.putRecs(chg, del), S.putStds(sch, sdel), saveMeta()]).then(function () { return loadProject(st.pid); }).then(function () { renderStd(); toast('已改名'); });
  });

  /* ================= 趨勢圖 ================= */
  var lastCharts = null, lastChartOpts = null, formInitPid = null;
  function yearsInData() { var y = {}; st.recs.forEach(function (r) { y[Co.rocY(r.iso)] = 1; }); return Object.keys(y).map(Number).sort(); }
  function radio(name) { var el = document.querySelector('input[name=' + name + ']:checked'); return el ? el.value : ''; }
  function setRadio(name, v) { var el = document.querySelector('input[name=' + name + '][value="' + v + '"]'); if (el) el.checked = true; }
  function renderChartForm() {
    if (!st.pid) { $('gOut').innerHTML = '<div class="card empty">請先建立或選擇計畫</div>'; return; }
    var cats = catsInData(), f = st.meta.chartForm || {};
    var cat = $('gCat').value || f.cat;
    if (cats.indexOf(cat) < 0) cat = cats[0] || '';
    $('gCat').innerHTML = cats.map(function (c) { return opt(c, c, c === cat); }).join('') || '<option value="">（還沒有資料）</option>';
    var ys = yearsInData();
    if (!ys.length) { $('gOut').innerHTML = '<div class="card empty">這個計畫還沒有資料，請先到「匯入報告」匯入檔案</div>'; return; }
    var yOpts = function (sel) { var a = []; for (var y = ys[0] - 1; y <= ys[ys.length - 1] + 1; y++) a.push(opt(y, y + ' 年', y === sel)); return a.join(''); };
    var mOpts = function (sel) { var a = []; for (var m = 1; m <= 12; m++) a.push(opt(m, m + ' 月', m === sel)); return a.join(''); };
    var recsCat = st.recs.filter(function (r) { return r.cat === cat; });
    var isos = recsCat.map(function (r) { return r.iso; }).sort();
    var lastIso = isos[isos.length - 1] || st.recs[0].iso;
    var fy = f.fromY || Co.rocY(isos[0] || lastIso), fm = f.fromM || +String(isos[0] || lastIso).slice(5, 7);
    var ty = f.toY || Co.rocY(lastIso), tm = f.toM || +lastIso.slice(5, 7);
    if (!$('gFromY').options.length || $('gFromY').dataset.pid !== st.pid) {
      $('gFromY').innerHTML = yOpts(fy); $('gFromM').innerHTML = mOpts(fm); $('gToY').innerHTML = yOpts(ty); $('gToM').innerHTML = mOpts(tm);
      $('gFromY').dataset.pid = st.pid;
    }
    if (formInitPid !== st.pid) {
      formInitPid = st.pid;
      if (f.mode) setRadio('gMode', f.mode); if (f.x) setRadio('gX', f.x); if (f.split) setRadio('gSplit', f.split);
      ['gStd', 'gZero', 'gND', 'gStTitle', 'gStdAxis'].forEach(function (id) { if (f[id] != null) $(id).checked = f[id]; });
    }
    var qs = {}; recsCat.forEach(function (r) { qs[Co.quarterOf(r.iso)] = 1; });
    var yy = {}; recsCat.forEach(function (r) { yy[Co.rocY(r.iso)] = 1; });
    $('gQuick').innerHTML = opt('', '（選季別或年度）', true) + opt('all', '全部期間') + Object.keys(yy).sort().reverse().map(function (y) { return opt('y' + y, y + ' 年度'); }).join('') + Object.keys(qs).sort().reverse().map(function (q) { return opt('q' + q, q); }).join('');
    var cg = Co.catalog(st.recs, cat, periodSel());
    var prevSts = f.cat === cat && f.sts ? f.sts : null, prevItems = f.cat === cat && f.items ? f.items : null;
    $('gSts').innerHTML = cg.stations.length ? cg.stations.map(function (s) { return '<label class="chk"><input type="checkbox" value="' + esc(s) + '"' + (!prevSts || prevSts.indexOf(s) >= 0 ? ' checked' : '') + '> ' + esc(s) + '</label>'; }).join('') : '<span class="muted">此期間沒有資料</span>';
    $('gItems').innerHTML = cg.items.length ? cg.items.map(function (s) { var t = cg.textItems[s]; return '<label class="chk"' + (t ? ' title="文字資料（例如風向）不畫圖，只列在報告表格"' : '') + '><input type="checkbox" value="' + esc(s) + '"' + ((!prevItems ? !t : prevItems.indexOf(s) >= 0) ? ' checked' : '') + '> ' + esc(s) + (t ? '（文字）' : '') + '</label>'; }).join('') : '<span class="muted">此期間沒有資料</span>';
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function periodSel() {
    var fy = +$('gFromY').value, fm = +$('gFromM').value, ty = +$('gToY').value, tm = +$('gToM').value;
    if (!fy) return null;
    var a = (fy + 1911) + '-' + p2(fm), b = (ty + 1911) + '-' + p2(tm);
    if (a > b) { var t = a; a = b; b = t; }
    return { from: a, to: b };
  }
  function periodText(p) { function r(ym) { return (+ym.slice(0, 4) - 1911) + '.' + ym.slice(5, 7); } return p ? r(p.from) + '～' + r(p.to) : ''; }
  $('gCat').addEventListener('change', function () { st.meta.chartForm.sts = null; st.meta.chartForm.items = null; $('gFromY').dataset.pid = ''; st.meta.chartForm.fromY = null; st.meta.chartForm.toY = null; st.meta.chartForm.fromM = null; st.meta.chartForm.toM = null; st.meta.chartForm.cat = this.value; renderChartForm(); });
  ['gFromY', 'gFromM', 'gToY', 'gToM'].forEach(function (id) { $(id).addEventListener('change', function () { saveForm(); renderChartForm(); }); });
  $('gQuick').addEventListener('change', function () {
    var v = this.value; if (!v) return;
    var cat = $('gCat').value, isos = st.recs.filter(function (r) { return r.cat === cat; }).map(function (r) { return r.iso; }).sort();
    var p;
    if (v === 'all') p = { from: isos[0].slice(0, 7), to: isos[isos.length - 1].slice(0, 7) };
    else p = periodOf(v);
    $('gFromY').value = +p.from.slice(0, 4) - 1911; $('gFromM').value = +p.from.slice(5, 7);
    $('gToY').value = +p.to.slice(0, 4) - 1911; $('gToM').value = +p.to.slice(5, 7);
    saveForm(); renderChartForm();
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-all],[data-none]'); if (!a) return;
    e.preventDefault();
    var box = $(a.getAttribute('data-all') || a.getAttribute('data-none')), v = a.hasAttribute('data-all');
    Array.prototype.forEach.call(box.querySelectorAll('input[type=checkbox]'), function (c) { c.checked = v; });
    if (box.id === 'gSts' || box.id === 'gItems') saveForm();
  });
  ['gSts', 'gItems'].forEach(function (id) { $(id).addEventListener('change', saveForm); });
  // 各站並列時，各站採樣日不一定同一天，預設改用「年月」當 X 軸
  Array.prototype.forEach.call(document.querySelectorAll('input[name=gMode]'), function (r) {
    r.addEventListener('change', function () { if (this.value === 'item' && radio('gX') === 'orig') setRadio('gX', 'month'); saveForm(); });
  });
  function checkedVals(id) { return Array.prototype.map.call($(id).querySelectorAll('input:checked'), function (c) { return c.value; }); }
  function saveForm() {
    if (!st.pid) return;
    st.meta.chartForm = { cat: $('gCat').value, fromY: +$('gFromY').value, fromM: +$('gFromM').value, toY: +$('gToY').value, toM: +$('gToM').value, mode: radio('gMode'), x: radio('gX'), split: radio('gSplit'), sts: checkedVals('gSts'), items: checkedVals('gItems'), gStd: $('gStd').checked, gZero: $('gZero').checked, gND: $('gND').checked, gStTitle: $('gStTitle').checked, gStdAxis: $('gStdAxis').checked };
    saveMeta();
  }
  function drawOpts(scale) { return { scale: scale, std: $('gStd').checked, stdAxis: $('gStdAxis').checked, zero: $('gZero').checked, markND: $('gND').checked, stationInTitle: $('gStTitle').checked }; }
  $('gGo').addEventListener('click', function () {
    if (!needProject()) return;
    saveForm();
    var cat = $('gCat').value, sts = checkedVals('gSts'), items = checkedVals('gItems');
    if (!cat) return toast('請先匯入資料', true);
    if (!sts.length || !items.length) return toast('請至少勾選一個測站與一個測項', true);
    var cg = Co.catalog(st.recs, cat, periodSel());
    var chartItems = items.filter(function (i) { return !cg.textItems[i]; });
    var o = { cat: cat, period: periodSel(), stations: sts, items: chartItems, mode: radio('gMode'), xmode: radio('gX'), noteInLabel: 'auto' };
    var charts = Co.buildCharts(st.recs, st.stds, o);
    lastCharts = charts; lastChartOpts = Object.assign({}, o, { tableItems: items });
    var out = $('gOut');
    if (!charts.length) { out.innerHTML = '<div class="card empty">這個期間、測站與測項沒有可以畫的資料</div>'; $('gXlsx').disabled = true; $('gPngAll').disabled = true; return; }
    out.innerHTML = charts.map(function (c, i) {
      var nd = 0; c.series.forEach(function (s) { s.values.forEach(function (v) { if (v && v.num == null) nd++; }); });
      var title = (c.kind === 'station' ? c.station + '｜' : '') + c.title;
      return '<div class="fig"><div class="fig-head"><span class="t">' + esc(title) + '</span><button class="btn small" data-png="' + i + '">下載高解析圖</button></div><canvas data-i="' + i + '"></canvas>' +
        '<div class="note">' + c.cats.length + ' 次採樣' + (nd ? '・' + nd + ' 筆為 ND／&lt;x 等非數值，未畫長條' : '') + (c.stdLines.length ? '' : '・沒有標準值（可在「測項與標準值」設定）') + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(out.querySelectorAll('canvas'), function (cv) { CH.draw(cv, charts[+cv.getAttribute('data-i')], drawOpts(Math.min(2, window.devicePixelRatio || 1))); });
    $('gXlsx').disabled = false; $('gPngAll').disabled = false;
    $('gMsg').textContent = '共 ' + charts.length + ' 張圖';
  });
  function pngName(c) { return safeName((c.kind === 'station' ? c.station + '_' : '') + c.title) + '.png'; }
  function pngBlob(c) {
    var cv = document.createElement('canvas');
    CH.draw(cv, c, drawOpts(3));
    return new Promise(function (res) { cv.toBlob(res, 'image/png'); });
  }
  $('gOut').addEventListener('click', function (e) {
    var b = e.target.closest('[data-png]'); if (!b) return;
    var c = lastCharts[+b.getAttribute('data-png')];
    pngBlob(c).then(function (bl) { download(pngName(c), bl); });
  });
  $('gPngAll').addEventListener('click', function () {
    if (!lastCharts) return;
    var zip = new window.JSZip(), names = {};
    $('gMsg').textContent = '產生圖檔中…';
    var chain = Promise.resolve();
    lastCharts.forEach(function (c) {
      chain = chain.then(function () { return pngBlob(c); }).then(function (bl) {
        var n = pngName(c); if (names[n]) { names[n]++; n = n.replace(/\.png$/, '_' + names[n] + '.png'); } else names[n] = 1;
        zip.file(n, bl);
      });
    });
    chain.then(function () { return zip.generateAsync({ type: 'blob' }); }).then(function (bl) {
      download(safeName(fileBase() + '_趨勢圖') + '.zip', bl); $('gMsg').textContent = '已下載 ' + lastCharts.length + ' 張圖';
    });
  });
  function fileBase() { var p = cur(); return (p && p.code ? p.code + '_' : '') + lastChartOpts.cat + '_' + periodText(lastChartOpts.period).replace(/～/g, '-'); }
  $('gXlsx').addEventListener('click', function () {
    if (!lastCharts) return;
    var o = lastChartOpts, p = cur();
    var tables = Co.reportTables(st.recs, st.stds, { cat: o.cat, period: o.period, stations: o.stations, items: o.tableItems, split: radio('gSplit') });
    $('gMsg').textContent = '產生 Excel 中…';
    XO.build(window.ExcelJS, window.JSZip, { project: p ? (p.code ? p.code + ' ' : '') + p.name : '', cat: o.cat, periodText: periodText(o.period), tables: tables, charts: lastCharts, mode: o.mode, std: $('gStd').checked, zero: $('gZero').checked })
      .then(function (buf) { download(safeName(fileBase()) + '.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); $('gMsg').textContent = '已下載 Excel'; })
      .catch(function (e) { $('gMsg').textContent = ''; toast('Excel 產生失敗：' + e.message, true); });
  });

  /* ================= 環境部 ================= */
  var mSites = { air: null, river: null }, mResult = null;
  function mKind() { return radio('mKind'); }
  function apiJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('環境部回應 HTTP ' + r.status + (r.status === 429 || r.status >= 500 ? '（可能是查詢太頻繁，請稍等一分鐘再試）' : ''));
      return r.json();
    });
  }
  function initMoenv() {
    if (!$('mFrom').value) {
      var d = new Date(); var y = d.getFullYear(), m = d.getMonth() + 1;
      $('mTo').value = y + '-' + p2(m); $('mFrom').value = (y - 1) + '-' + p2(m);
    }
    loadSites(false);
  }
  function loadSites(force) {
    var k = mKind();
    $('mQWrap').style.display = k === 'air' ? '' : 'none';
    if (mSites[k] && !force) { renderSites(); return; }
    var cacheKey = k === 'air' ? 'airSites' : 'riverSites';
    var p = force ? Promise.resolve(null) : S.getMeta('_', cacheKey, null);
    $('mSites').innerHTML = '<span class="muted">載入測站清單中…</span>';
    p.then(function (c) {
      if (c && c.list && Date.now() - c.at < 30 * 864e5) return c.list;
      return (k === 'air' ? M.airSites(apiJson) : M.riverSites(apiJson)).then(function (list) { S.setMeta('_', cacheKey, { at: Date.now(), list: list }); return list; });
    }).then(function (list) { mSites[k] = list; renderSites(); })
      .catch(function (e) { $('mSites').innerHTML = '<div class="err-box">無法取得測站清單：' + esc(e.message) + '。請確認網路連線；若一直失敗，可能是環境部網址或金鑰變更，請找 AI 協助修改 js/moenv.js。</div>'; });
  }
  function renderSites() {
    var k = mKind(), list = mSites[k] || [];
    var cty = $('mCounty').value, q = $('mQ').value.trim();
    var counties = []; list.forEach(function (s) { if (s.county && counties.indexOf(s.county) < 0) counties.push(s.county); });
    $('mCounty').innerHTML = opt('', '全部縣市', !cty) + counties.sort().map(function (c) { return opt(c, c, c === cty); }).join('');
    var sel = {}; Array.prototype.forEach.call($('mSites').querySelectorAll('input:checked'), function (c) { sel[c.value] = 1; });
    var show = list.filter(function (s) { return (!cty || s.county === cty) && (!q || (s.name + s.river + s.county + s.township).indexOf(q) >= 0); });
    $('mSites').innerHTML = show.length ? show.slice(0, 800).map(function (s) {
      var extra = k === 'air' ? (s.type ? '・' + s.type : '') : (s.river ? '・' + s.river : '') + (s.status === '停用' ? '・停用' : '');
      return '<label class="chk"><input type="checkbox" value="' + esc(s.id) + '"' + (sel[s.id] ? ' checked' : '') + '> ' + esc(s.name) + '<span class="muted small">' + esc((s.county ? '（' + s.county : '（') + extra + '）') + '</span></label>';
    }).join('') + (show.length > 800 ? '<div class="muted small">只列前 800 個，請用縣市或搜尋縮小範圍</div>' : '') : '<span class="muted">沒有符合的測站</span>';
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name=mKind]'), function (r) { r.addEventListener('change', function () { $('mCounty').value = ''; mResult = null; $('mXlsx').disabled = true; $('mCsv').disabled = true; $('mPreview').innerHTML = ''; loadSites(false); }); });
  $('mCounty').addEventListener('change', renderSites);
  $('mQ').addEventListener('input', function () { clearTimeout(renderSites._t); renderSites._t = setTimeout(renderSites, 200); });
  $('mLoad').addEventListener('click', function () { loadSites(true); });
  $('mGo').addEventListener('click', function () {
    var k = mKind(), ids = Array.prototype.map.call($('mSites').querySelectorAll('input:checked'), function (c) { return c.value; });
    var from = $('mFrom').value, to = $('mTo').value;
    if (!ids.length) return toast('請至少勾選一個測站', true);
    if (!from || !to) return toast('請選擇起訖年月', true);
    if (from > to) { var t = from; from = to; to = t; }
    if (ids.length > 30) return toast('一次最多 30 個測站，避免環境部暫時封鎖查詢', true);
    var btn = this; btn.disabled = true;
    $('mMsg').textContent = '查詢中…';
    var fn = k === 'air' ? M.airMonthly : M.riverData;
    fn(apiJson, ids, from, to, function (i, n, cnt) { $('mMsg').textContent = '查詢中…（' + i + '／' + n + ' 站，已取得 ' + cnt + ' 筆）'; }).then(function (raw) {
      var pv = k === 'air' ? M.pivotAir(raw) : M.pivotRiver(raw);
      mResult = { kind: k, raw: raw, pivot: pv, from: from, to: to };
      $('mMsg').textContent = '完成：' + raw.length + ' 筆原始資料、' + pv.rows.length + ' 列整理資料';
      $('mXlsx').disabled = !raw.length; $('mCsv').disabled = !raw.length;
      $('mPreview').innerHTML = raw.length ? '<table class="t"><thead><tr><th>測站</th><th>' + (k === 'air' ? '月份' : '採樣時間') + '</th>' + pv.items.map(function (i) { return '<th>' + esc(i) + '<br><span class="small muted">' + esc(pv.units[i] || '') + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
        pv.rows.slice(0, 120).map(function (r) { return '<tr><td>' + esc(r.st) + '</td><td>' + esc(r.period) + '</td>' + pv.items.map(function (i) { return '<td class="num">' + esc(r.vals[i] == null ? '' : r.vals[i]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' : '<div class="empty">這段期間沒有資料</div>';
    }).catch(function (e) { $('mMsg').textContent = ''; toast('查詢失敗：' + e.message, true); }).then(function () { btn.disabled = false; });
  });
  function mInfo() {
    var r = mResult;
    return ['資料來源：環境部環境資料開放平臺　' + (r.kind === 'air' ? '空氣品質監測月值（AQX_P_08）' : '河川水質監測資料（WQX_P_01）'),
      '查詢期間：' + r.from + '～' + r.to, '下載時間：' + new Date().toLocaleString('zh-TW'),
      r.kind === 'air' ? '月值為環境部公告的各測站月平均。季平均工作表是本程式把月值做算術平均，不是環境部公告值。' : '河川水質每月約採樣一次；「-」表示該次未檢測。數值依環境部原樣列出。'];
  }
  $('mXlsx').addEventListener('click', function () {
    var r = mResult; if (!r) return;
    M.buildWorkbook(window.ExcelJS, { kind: r.kind, raw: r.raw, pivot: r.pivot, quarters: r.kind === 'air' && $('mQuarter').checked ? M.quarterAvg(r.pivot) : null, info: mInfo() }).then(function (buf) {
      download('環境部_' + (r.kind === 'air' ? '空品月值' : '河川水質') + '_' + r.from + '_' + r.to + '.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });
  });
  $('mCsv').addEventListener('click', function () {
    var r = mResult; if (!r) return;
    download('環境部_' + (r.kind === 'air' ? '空品月值' : '河川水質') + '_' + r.from + '_' + r.to + '.csv', M.toCsv(r.raw), 'text/csv;charset=utf-8');
  });

  /* ================= 備份 ================= */
  function renderBackup() {
    var el = $('bUsage');
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) { el.textContent = '本網站目前使用約 ' + (e.usage / 1048576).toFixed(1) + ' MB（瀏覽器允許上限約 ' + (e.quota / 1073741824).toFixed(1) + ' GB）'; });
    else el.textContent = '這個瀏覽器無法顯示用量';
    $('verList').innerHTML = (window.RT_HISTORY || []).map(function (h) { return '<div><b>v' + esc(h.v) + '</b>（' + esc(h.d) + '）' + esc(h.t) + '</div>'; }).join('');
  }
  $('bOne').addEventListener('click', function () {
    if (!needProject()) return;
    S.exportAll(st.pid).then(function (d) { var p = cur(); download(safeName('趨勢圖產生器備份_' + (p.code || '') + p.name + '_' + new Date().toISOString().slice(0, 10)) + '.json', JSON.stringify(d), 'application/json'); });
  });
  $('bAll').addEventListener('click', function () { S.exportAll(null).then(function (d) { download('趨勢圖產生器備份_全部計畫_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(d), 'application/json'); }); });
  $('bIn').addEventListener('change', function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    f.text().then(function (t) { var d = JSON.parse(t); if (!confirm('還原備份：' + (d.projects || []).map(function (p) { return p.name; }).join('、') + '\n同一計畫的同一筆資料會以備份檔為準。確定還原？')) return; return S.importAll(d).then(init).then(function () { $('bMsg').textContent = '已還原 ' + (d.projects || []).length + ' 個計畫、' + (d.recs || []).length + ' 筆資料'; }); })
      .catch(function (e) { toast('還原失敗：' + e.message, true); });
  });
  $('bPersist').addEventListener('click', function () {
    if (!navigator.storage || !navigator.storage.persist) return toast('這個瀏覽器不支援', true);
    navigator.storage.persist().then(function (ok) { toast(ok ? '已申請持久保存，瀏覽器不會自動清除本網站資料' : '瀏覽器沒有同意（通常要常用這個網站或加入書籤後才會同意）', !ok); });
  });
  $('bWipe').addEventListener('click', function () {
    if (!confirm('清除這台電腦上本程式的全部資料（所有計畫）？無法復原，建議先下載備份。')) return;
    if (!confirm('再確認一次：真的要全部清除？')) return;
    S.wipe().then(function () { location.reload(); });
  });

  /* ================= 啟動 ================= */
  function init() {
    $('verPill').textContent = 'v' + (window.RT_VERSION || '');
    return S.projects().then(function (ps) {
      st.projects = ps;
      var saved = null; try { saved = localStorage.getItem('rtg.pid'); } catch (e) { /* 無 */ }
      var pid = ps.some(function (p) { return p.id === saved; }) ? saved : (ps[0] ? ps[0].id : null);
      return loadProject(pid);
    }).then(function () { go(st.pid ? (st.recs.length ? 'chart' : 'import') : 'projects'); })
      .catch(function (e) { toast('啟動失敗：' + e.message, true); });
  }
  window.addEventListener('beforeunload', function (e) { if (pending.length) { e.preventDefault(); e.returnValue = ''; } });
  init();
})();
