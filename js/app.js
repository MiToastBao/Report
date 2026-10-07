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
    if (sec === 'import') renderLog();
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
    if (!pid) { st.recs = []; st.stds = []; st.meta = {}; renderHeader(); renderLog(); return Promise.resolve(); }
    return Promise.all([S.recs(pid), S.stds(pid), S.getMeta(pid, 'm', {})]).then(function (a) {
      st.recs = a[0]; st.stds = a[1]; st.meta = a[2] || {};
      return migrateStds().then(function () {
      ['stAlias', 'itemAlias', 'itemIgnore', 'itemPicked', 'ok', 'units', 'chartForm'].forEach(function (k) { if (!st.meta[k]) st.meta[k] = {}; });
      if (!st.meta.conflicts) st.meta.conflicts = [];
      if (!st.meta.merges) st.meta.merges = [];
      if (!st.meta.log) st.meta.log = [];
      renderHeader();
      renderLog();
      updateBadge();
      });
    });
  }
  // 舊資料補上判定方式；報告帶入的水溫「35/38」拆成季節性兩筆（5～9 月、10～翌年 4 月）
  function migrateStds() {
    var put = [], del = [];
    st.stds.forEach(function (s) {
      if (s.by === 'auto' && !s.m1) {
        var v = X.stdSeason(s.text, s.item);
        if (v) {
          del.push(s.k);
          v.forEach(function (x) { var o = Object.assign({}, s, { text: x.text, lines: x.lines, m1: x.m1, m2: x.m2, mode: 'max' }); o.k = S.stdKey(o); put.push(o); });
          return;
        }
      }
      var md = X.stdMode(s.text || '', s.item);
      // v1.0.6：報告帶入的「>2.0」以前被判成上限（已經標過 modeFixed 的也要再修一次）
      var gtFix = s.by === 'auto' && md === 'min' && s.mode === 'max' && /^\s*[>＞]/.test(s.text || '') && s.modeFixed !== 2;
      if (!s.mode || gtFix || (s.by === 'auto' && s.mode !== md && !s.modeFixed)) { s.mode = md; s.modeFixed = gtFix ? 2 : 1; put.push(s); }
    });
    if (!put.length && !del.length) return Promise.resolve();
    return S.putStds(put, del).then(function () { return S.stds(st.pid); }).then(function (a) { st.stds = a; });
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
  function pendingOnly(cat, name) { return !st.recs.some(function (r) { return r.cat === cat && nk(r.item) === nk(name); }); }
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
    // 報告沒寫測站時的預設名稱也套用測站歸類（例：「工區放流水」已歸入「北岸工區」）（v1.0.7）
    var defSt = function () { var d = defaultStation(cat), al = (st.meta.stAlias || {})[cat] || {}; return al[d] || d; };
    ds.stations.forEach(function (s) { ds.stMap[s] = s ? mapName(cat, 'st', s) : (ds.stMap[s] || defSt()); });
    if (!ds.stations.length) ds.stMap[''] = ds.stMap[''] || defSt();
    ds.items.forEach(function (it) {
      ds.itemCat[it] = ds.itemCat[it] || cat;
      if (/營建/.test(cat) && /低頻/.test(it)) ds.itemCat[it] = '營建低頻噪音';
      else if (cat === '營建低頻噪音' && /營建噪音|Lmax|振動|Lv/i.test(it) && !/低頻/.test(it)) ds.itemCat[it] = '營建噪音振動';
      var ic = ds.itemCat[it];
      ds.itemMap[it] = mapName(ic, 'item', it);
      // 預設不勾選；只有以前匯入時勾選過（或計畫裡已有）的測項才自動勾選，取消過的保持不勾
      var ign = (st.meta.itemIgnore[ic] || {})[it];
      var picked = (st.meta.itemPicked[ic] || {})[it] || !!knownNames(ic, 'item')[nk(ds.itemMap[it])] && !pendingOnly(ic, ds.itemMap[it]);
      ds.itemOn[it] = !ign && !!picked;
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
  // v1.0.6：月報寫「假日」、季報同一筆寫「施工期間 假日」——備註只差施工階段、數值相同，是同一筆資料，
  // 不可以變成兩筆（趨勢圖會在同一天畫出兩根一樣的長條）。只比對時去掉施工階段字樣，不改變已存的資料。
  var RE_PHASE = /施工前|施工期間|施工中|施工後|營運前|營運期間|營運中|營運後/g;
  function phaseKey(r) { return [r.cat, r.st, r.iso, r.item, String(r.note || '').replace(RE_PHASE, '').replace(/\s+/g, '')].join('|'); }
  function phaseIndex() { var m = {}; st.recs.forEach(function (r) { var pk = phaseKey(r); if (!(pk in m)) m[pk] = r.raw; }); return m; }
  function phaseDup(r, idx, pidx) { return !idx[r.k] && pidx[phaseKey(r)] === r.raw; }
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
  function counts(list, idx, pidx) {
    var c = { n: 0, same: 0, diff: 0 };
    list.forEach(function (r) { var e = idx[r.k]; if (pidx && phaseDup(r, idx, pidx)) c.same++; else if (!e) c.n++; else if (e.raw === r.raw) c.same++; else c.diff++; });
    return c;
  }
  function catSelect(v, attrs) {
    return '<select ' + attrs + '>' + (v ? '' : '<option value="">（請選擇類別）</option>') + allCats().map(function (c) { return opt(c, c, c === v); }).join('') + '<option value="__new">＋ 新增類別…</option></select>';
  }
  function renderImport() {
    var area = $('importArea'), idx = existingIndex(), pidx = phaseIndex();
    if (!pending.length) { area.innerHTML = ''; $('importBar').hidden = true; return; }
    var tot = { n: 0, same: 0, diff: 0, tables: 0 }, seenAll = {};
    area.innerHTML = pending.map(function (f, fi) {
      var head = '<div class="file-head"><div class="file-icon ' + esc(f.ext) + '">' + esc((f.ext || '?').toUpperCase()) + '</div><div><div class="file-name">' + esc(f.name) + '</div><div class="file-sub">' +
        (f.error ? '' : '找到 ' + f.datasets.length + ' 張監測結果表' + (f.tableCount ? '（檔案共 ' + f.tableCount + ' 張表格／工作表）' : '')) + '</div></div><span class="spacer"></span><button class="btn small" data-rmfile="' + fi + '">移除</button></div>';
      if (f.error) return '<div class="file-card">' + head + '<div class="ds"><div class="err-box">' + esc(f.error) + '</div></div></div>';
      return '<div class="file-card">' + head + f.datasets.map(function (ds, di) {
        var list = ds.sel ? dsRecords(ds, f.name) : [];
        var c = counts(list, idx, pidx);
        if (ds.sel) {
          tot.tables++;
          list.forEach(function (r) {
            var e = idx[r.k], prev = seenAll[r.k];
            if (prev && prev === r.raw) return;
            if (!e && !prev && phaseDup(r, idx, pidx)) { tot.same++; seenAll[r.k] = r.raw; return; }
            if (!e && !prev) tot.n++; else if (e && e.raw === r.raw && !prev) tot.same++; else tot.diff++;
            seenAll[r.k] = r.raw; var pk0 = phaseKey(r); if (!(pk0 in pidx)) pidx[pk0] = r.raw;
          });
        }
        var isos = ds.recs.map(function (r) { return r.iso; }).filter(Boolean).sort();
        var range = isos.length ? Co.rocDate(isos[0]) + (isos[isos.length - 1] !== isos[0] ? '～' + Co.rocDate(isos[isos.length - 1]) : '') : '（無日期）';
        var eng = { rows: '結果表', transposed: '結果表（日期橫排）', form: '單次檢測報告' }[ds.engine] || '';
        var warn = [];
        if (!ds.cat) warn.push('無法判斷監測類別，請選擇類別後才會匯入（如果不是監測結果，不用勾選）');
        if (ds.noDate && !ds.dateText) warn.push('找不到監測日期，請在下方填寫採樣日期（例：115.05.11）');
        if (ds.sel && !ds.items.some(function (it) { return ds.itemOn[it]; })) warn.push('還沒有勾選任何測項，請勾選要匯入的測項（可按「全選」）');
        var noSt = ds.stations.length === 0 || ds.stations.some(function (s) { return !s; });
        return '<div class="ds' + (ds.sel ? '' : ' off') + '" data-f="' + fi + '" data-d="' + di + '">' +
          '<div class="ds-head"><label class="chk"><input type="checkbox" data-k="sel"' + (ds.sel ? ' checked' : '') + '> 匯入</label>' +
          '<div class="ds-title">' + esc(ds.caption || ds.sheet || '表格 ' + (ds.index + 1)) + '<small>' + esc(eng) + '・' + ds.recs.length + ' 個數值・' + range + '</small></div>' +
          catSelect(ds.cat, 'data-k="cat"') + '<div class="ds-counts">' + (ds.sel ? '<span class="pill new">新增 ' + c.n + '</span><span class="pill same">相同 ' + c.same + '</span>' + (c.diff ? '<span class="pill diff">數值不同將覆蓋 ' + c.diff + '</span>' : '') : '') + '</div></div>' +
          '<div class="ds-body">' + warn.map(function (w) { return '<div class="warn-box">⚠ ' + esc(w) + '</div>'; }).join('') +
          (ds.noDate ? '<div class="map-row" style="max-width:420px"><span class="from">採樣日期</span><input data-k="date" value="' + esc(ds.dateText) + '" placeholder="例：115.05.11"></div>' : '') +
          '<div class="sec-label">測站名稱（左邊是報告上的寫法，右邊可以改成計畫統一的名稱）</div><div class="map-grid">' +
          (ds.stations.length ? ds.stations : ['']).map(function (s) { return '<div class="map-row"><span class="from" title="' + esc(s) + '">' + esc(s || '（報告沒寫測站）') + '</span><textarea class="name-box" rows="' + Math.max(1, Math.ceil(String(ds.stMap[s] || '').length / 14)) + '" data-k="st" data-v="' + esc(s) + '"' + (s ? '' : ' placeholder="請填測站名稱"') + '>' + esc(ds.stMap[s] || '') + '</textarea></div>'; }).join('') + '</div>' +
          (noSt && ds.stations.length ? '' : '') +
          '<div class="sec-label">測項（勾選要匯入的測項；勾選或不勾選的結果會記住，下次同名測項自動套用）　<button class="btn small" data-allon="1">全選</button> <button class="btn small" data-allon="0">全不選</button></div><div class="map-grid">' +
          ds.items.map(function (it) {
            return '<div class="map-row"><input type="checkbox" data-k="on" data-v="' + esc(it) + '"' + (ds.itemOn[it] ? ' checked' : '') + '><span class="from" title="' + esc(it) + '">' + esc(it) + (ds.textItems[it] ? ' <span class="pill info">文字</span>' : '') + '</span><textarea class="name-box" rows="' + Math.max(1, Math.ceil(String(ds.itemMap[it]).length / 12)) + '" data-k="item" data-v="' + esc(it) + '">' + esc(ds.itemMap[it]) + '</textarea>' +
              (ds.itemCat[it] !== ds.cat ? catSelect(ds.itemCat[it], 'data-k="icat" data-v="' + esc(it) + '"') : '') + '</div>';
          }).join('') + '</div>' +
          (ds.stds.length ? '<div class="sec-label">報告上的標準值（匯入後可在「測項與標準值」修改）</div><div class="small muted">' + ds.stds.slice(0, 12).map(function (s) { return esc((s.st === '*' ? '' : (ds.stMap[s.st] || s.st) + '：') + (ds.itemMap[s.item] || s.item) + ' ' + s.text); }).join('；') + (ds.stds.length > 12 ? '…' : '') + '</div>' : '') +
          '<details class="preview" data-pv="1"><summary>預覽判讀結果</summary><div class="pv-body"></div></details>' +
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
    if (b) { pending.splice(+b.getAttribute('data-rmfile'), 1); renderImport(); return; }
    var a = e.target.closest('[data-allon]');
    if (a) {
      var box = a.closest('.ds'), ds = pending[+box.getAttribute('data-f')].datasets[+box.getAttribute('data-d')];
      var on = a.getAttribute('data-allon') === '1';
      ds.items.forEach(function (it) { ds.itemOn[it] = on; });
      renderImport();
    }
  });
  // 預覽表格打開時才產生（表格多的時候畫面才不會變慢）
  $('importArea').addEventListener('toggle', function (e) {
    var d = e.target; if (!d.open || !d.hasAttribute('data-pv')) return;
    var box = d.closest('.ds'), ds = pending[+box.getAttribute('data-f')].datasets[+box.getAttribute('data-d')];
    d.querySelector('.pv-body').innerHTML = previewTable(ds);
  }, true);
  $('importArea').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList.contains('name-box')) { e.preventDefault(); e.target.blur(); } });
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
    var idx = existingIndex(), pidx = phaseIndex(), put = [], conflicts = [], stdsPut = [], seen = {};
    var twUpd = {}, pTwin = {}; st.recs.forEach(function (r) { var pk = phaseKey(r); if (!pTwin[pk]) pTwin[pk] = Object.assign({}, r); });
    var bid = 'b' + Date.now(), prev = {}, prevStd = {}, perFile = {};
    var stdIdx = {}; st.stds.forEach(function (s) { stdIdx[s.k] = s; });
    pending.forEach(function (f) {
      f.datasets.forEach(function (ds) {
        if (!ds.sel) return;
        dsRecords(ds, f.name).forEach(function (r) {
          var e = idx[r.k];
          if (e && e.raw === r.raw) return;
          if (seen[r.k] && seen[r.k].raw === r.raw) return;
          // 同一次匯入的兩個檔案數值不同（例：月報與季報）：後面的檔為準，列入異常（v1.0.7）
          if (seen[r.k] && !e) conflicts.push({ k: r.k, cat: r.cat, old: seen[r.k].raw, oldSrc: seen[r.k].src, raw: r.raw, src: r.src, at: Date.now(), bid: bid });
          if (phaseDup(r, idx, pidx) && !seen[r.k]) {          // 同一筆，只差施工階段備註（v1.0.6）
            // 記下這份報告也有這筆，刪除另一份報告的資料時不會跟著不見（v1.0.7）
            var tw = pTwin[phaseKey(r)];
            if (tw && tw.src !== r.src) { tw.alsoSrc = (tw.alsoSrc || []).filter(function (x) { return x !== r.src; }).concat([r.src]); if (!seen[tw.k]) twUpd[tw.k] = tw; }
            return;
          }
          var pk1 = phaseKey(r); if (!(pk1 in pidx)) pidx[pk1] = r.raw;
          if (!pTwin[pk1]) pTwin[pk1] = r;
          if (e) { conflicts.push({ k: r.k, cat: r.cat, old: e.raw, oldSrc: e.src, raw: r.raw, src: r.src, at: Date.now(), bid: bid }); r.excl = e.excl; if (!prev[r.k]) prev[r.k] = e; }
          r.bid = bid; seen[r.k] = r; put.push(r);
        });
        // 別名、略過的測項
        ds.stations.forEach(function (s) { if (s && ds.stMap[s] && ds.stMap[s] !== s) { (st.meta.stAlias[ds.cat] = st.meta.stAlias[ds.cat] || {})[s] = ds.stMap[s]; } });
        ds.items.forEach(function (it) {
          var ic = ds.itemCat[it] || ds.cat; if (!ic) return;
          if (ds.itemMap[it] && ds.itemMap[it] !== it) (st.meta.itemAlias[ic] = st.meta.itemAlias[ic] || {})[it] = ds.itemMap[it];
          var ig = st.meta.itemIgnore[ic] = st.meta.itemIgnore[ic] || {};
          var pk = st.meta.itemPicked[ic] = st.meta.itemPicked[ic] || {};
          if (!ds.itemOn[it]) { ig[it] = 1; delete pk[it]; } else { delete ig[it]; pk[it] = 1; }
        });
        // 標準值（使用者改過的不覆蓋）
        // 報告上的「全部測站」只代表這張表裡的測站（不同表可能是不同海域分類、管制區），所以逐站存
        var dsSts = [];
        dsRecords(ds, f.name).forEach(function (r) { if (dsSts.indexOf(r.st) < 0) dsSts.push(r.st); });
        ds.stds.forEach(function (s) {
          if (!ds.itemOn[s.item]) return;
          var ic = ds.itemCat[s.item] || ds.cat; if (!ic) return;
          var targets = s.st === '*' ? dsSts : [ds.stMap[s.st] || s.st];
          var itName = ds.itemMap[s.item] || s.item;
          var variants = X.stdSeason(s.text, itName) || [{ text: s.text, lines: s.lines }];
          targets.forEach(function (stn) {
            variants.forEach(function (vv) {
              var o = { pid: st.pid, cat: ic, st: stn, item: itName, text: vv.text, lines: vv.lines, mode: X.stdMode(vv.text, itName), m1: vv.m1 || 0, m2: vv.m2 || 0, label: s.label || '', by: 'auto', from: s.from || '', to: s.to || '' };
              o.k = S.stdKey(o);
              var ex = stdIdx[o.k];
              if (ex && ex.by === 'user') return;
              if (ex && ex.bid !== bid && !prevStd[o.k]) prevStd[o.k] = ex;
              o.bid = bid; stdIdx[o.k] = o; stdsPut.push(o);
            });
          });
        });
      });
    });
    var byK = {}; put.forEach(function (r) { byK[r.k] = r; }); put = Object.keys(byK).map(function (k) { return byK[k]; });
    st.meta.conflicts = st.meta.conflicts.concat(conflicts).slice(-1000);
    put.forEach(function (r) { perFile[r.src] = (perFile[r.src] || 0) + 1; });
    st.meta.log.push({ id: bid, at: Date.now(), files: pending.map(function (f) { return f.name; }), n: put.length, conflicts: conflicts.length, perFile: perFile });
    // 復原資料只留最近 30 次匯入
    var withUndo = st.meta.log.filter(function (l) { return l.id && !l.noUndo; }), drop = withUndo.slice(0, Math.max(0, withUndo.length - 30));
    drop.forEach(function (l) { l.noUndo = 1; });
    var n = put.length;
    Promise.all([S.putRecs(put.concat(Object.keys(twUpd).filter(function (k) { return !byK[k]; }).map(function (k) { return twUpd[k]; }))), S.putStds(stdsPut), S.setMeta(st.pid, 'undo|' + bid, { prev: prev, prevStd: prevStd }), drop.length ? S.delMeta(st.pid, drop.map(function (l) { return 'undo|' + l.id; })) : null, saveMeta()]).then(function () { return loadProject(st.pid); }).then(function () {
      pending = []; renderImport(); renderLog();
      $('importArea').innerHTML = '<div class="ok-box">✔ 已匯入 ' + n + ' 筆數值' + (conflicts.length ? '，其中 ' + conflicts.length + ' 筆與既有資料數值不同、已改用新檔（已列入「資料異常檢查」）' : '') + '。可以到「資料異常檢查」確認，或直接到「趨勢圖與報告表格」產生圖表。</div>';
      toast('匯入完成');
    }).catch(function (e) { toast('匯入失敗：' + e.message, true); });
  });

  /* ================= 匯入紀錄：整批復原、刪除某個檔案的資料 ================= */
  function fmtTime(t) { var d = new Date(t); return d.getFullYear() - 1911 + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function renderLog() {
    var card = $('logCard'); if (!card) return;
    var log = (st.pid && st.meta.log) || [];
    card.hidden = !log.length;
    if (!log.length) return;
    var bySrc = {}, byBid = {};
    st.recs.forEach(function (r) { bySrc[r.src] = (bySrc[r.src] || 0) + 1; if (r.bid) byBid[r.bid] = (byBid[r.bid] || 0) + 1; });
    $('logList').innerHTML = log.slice().reverse().slice(0, 60).map(function (l) {
      var li = log.indexOf(l);
      var files = uniqArr(l.files || []);
      var left = l.id ? (byBid[l.id] || 0) : null;
      var btn = l.undone ? '<span class="tag">已復原（' + esc(fmtTime(l.undone)) + '）</span>'
        : l.id && left ? '<button class="btn small danger" data-undo="' + li + '">復原這次匯入（' + left + ' 筆）</button>'
        : l.id ? '<span class="muted small">這次匯入的資料已經都被刪除或被後來的檔案取代</span>' : '<span class="muted small">舊版紀錄，無法整批復原，可逐檔刪除</span>';
      return '<div class="log-item"><div class="log-head"><b>' + esc(fmtTime(l.at)) + '</b><span class="muted small">匯入 ' + (l.n || 0) + ' 筆' + (l.conflicts ? '（其中 ' + l.conflicts + ' 筆蓋掉舊值）' : '') + '</span><span class="spacer"></span>' + btn + '</div>' +
        '<div class="log-files">' + files.map(function (f) {
          var c = bySrc[f] || 0;
          return '<div class="log-file"><span class="fname">' + esc(f) + '</span><span class="muted small">目前 ' + c + ' 筆</span>' + (c && !l.undone ? '<button class="btn small" data-delsrc="' + esc(f) + '">刪除這個檔案的資料</button>' : '') + '</div>';
        }).join('') + '</div></div>';
    }).join('');
  }
  function uniqArr(a) { var o = {}; return a.filter(function (x) { if (o[x]) return false; o[x] = 1; return true; }); }
  // 把資料「退回」：那筆若在匯入時蓋掉舊值，就放回舊值；否則刪除
  function revertRecs(list) {
    var bids = uniqArr(list.map(function (r) { return r.bid; }).filter(Boolean));
    return Promise.all(bids.map(function (b) { return S.getMeta(st.pid, 'undo|' + b, null); })).then(function (us) {
      var U = {}; bids.forEach(function (b, i) { U[b] = us[i] || { prev: {}, prevStd: {} }; });
      var put = [], del = [], restored = 0, gone = {};
      (st.meta.log || []).forEach(function (l) { if (l.undone && l.id) gone[l.id] = 1; });
      list.forEach(function (r) {
        var p = r.bid && U[r.bid] && U[r.bid].prev[r.k];
        if (p && p.bid && gone[p.bid]) p = null; // 舊值來自已經復原的那次匯入，不再放回
        if (p) {   // 舊值的測站之後被歸入別站：放回歸入後的測站（v1.0.7）
          var al = (st.meta.stAlias || {})[p.cat] || {};
          if (al[p.st] && al[p.st] !== p.st) { p = Object.assign({}, p, { st: al[p.st] }); p.k = S.recKey(p); if (p.k !== r.k) del.push(r.k); }
          put.push(p); restored++;
        } else del.push(r.k);
      });
      return S.putRecs(put, del).then(function () { return { del: del.length, restored: restored, U: U }; });
    });
  }
  $('logList').addEventListener('click', function (e) {
    var u = e.target.closest('[data-undo]'), d = e.target.closest('[data-delsrc]');
    if (u) {
      var l = st.meta.log[+u.getAttribute('data-undo')]; if (!l) return;
      var recs = st.recs.filter(function (r) { return r.bid === l.id; });
      if (!confirm('復原 ' + fmtTime(l.at) + ' 的匯入？\n\n這次匯入的 ' + recs.length + ' 筆資料會刪除；若當時蓋掉了舊值，會把舊值放回去。這次匯入帶進來的標準值也會一併復原（自行修改過的不動）。匯入後在「資料檢視」手動改過的數值也會一起移除。')) return;
      var stds = st.stds.filter(function (s) { return s.bid === l.id && s.by !== 'user'; });
      // 其他資料上「這份報告也有」的註記一併拿掉（同一檔案在別次匯入還在的不動）（v1.0.7）
      var other = {}; st.meta.log.forEach(function (x) { if (x !== l && !x.undone) (x.files || []).forEach(function (f) { other[f] = 1; }); });
      var strip = (l.files || []).filter(function (f) { return !other[f]; }), alsoFix = [];
      if (strip.length) st.recs.forEach(function (r) { if (r.bid !== l.id && r.alsoSrc && r.alsoSrc.some(function (f) { return strip.indexOf(f) >= 0; })) { var o = Object.assign({}, r); o.alsoSrc = r.alsoSrc.filter(function (f) { return strip.indexOf(f) < 0; }); alsoFix.push(o); } });
      (alsoFix.length ? S.putRecs(alsoFix) : Promise.resolve()).then(function () { return revertRecs(recs); }).then(function (res) {
        return S.getMeta(st.pid, 'undo|' + l.id, null).then(function (ud) {
          var ps = (ud && ud.prevStd) || {}, sPut = [], sDel = [];
          stds.forEach(function (s) { if (ps[s.k]) sPut.push(ps[s.k]); else sDel.push(s.k); });
          l.undone = Date.now();
          st.meta.conflicts = st.meta.conflicts.filter(function (c) { return c.bid !== l.id; });
          return Promise.all([S.putStds(sPut, sDel), saveMeta()]).then(function () { return res; });
        });
      }).then(function (res) { return loadProject(st.pid).then(function () { renderLog(); toast('已復原：刪除 ' + res.del + ' 筆' + (res.restored ? '、放回舊值 ' + res.restored + ' 筆' : '')); }); })
        .catch(function (err) { toast('復原失敗：' + err.message, true); });
    } else if (d) {
      var name = d.getAttribute('data-delsrc');
      // 另一份報告也有的資料（測站歸入合成一筆、月報與季報只差施工階段）：改記在另一份報告，不刪（v1.0.7）
      var keep = [];
      st.recs.forEach(function (r) {
        var also = r.alsoSrc || [];
        if (r.src === name && also.length) { var o = Object.assign({}, r, { src: also[0] }); o.alsoSrc = also.slice(1); keep.push(o); }
        else if (also.indexOf(name) >= 0) { var o2 = Object.assign({}, r); o2.alsoSrc = also.filter(function (x) { return x !== name; }); keep.push(o2); }
      });
      var list = st.recs.filter(function (r) { return r.src === name && !(r.alsoSrc && r.alsoSrc.length); });
      if (!confirm('刪除「' + name + '」匯入的 ' + list.length + ' 筆資料？\n\n若匯入時蓋掉了舊值，會把舊值放回去。標準值不會刪除（可到「測項與標準值」修改）。' + (keep.length ? '\n另有 ' + keep.length + ' 筆其他報告（例如季報）也有同一筆，會保留，只拿掉「' + name + '」的來源註記。' : ''))) return;
      (keep.length ? S.putRecs(keep) : Promise.resolve()).then(function () { return revertRecs(list); }).then(function (res) {
        st.meta.conflicts = st.meta.conflicts.filter(function (c) { return c.src !== name; });
        return saveMeta().then(function () { return loadProject(st.pid); }).then(function () { renderLog(); toast('已刪除 ' + res.del + ' 筆' + (res.restored ? '、放回舊值 ' + res.restored + ' 筆' : '')); });
      }).catch(function (err) { toast('刪除失敗：' + err.message, true); });
    }
  });

  /* ================= 資料檢視 ================= */
  var dPage = 0, dFiltered = [];
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
    var stv = $('dSt').value, itv = $('dItem').value, pv = $('dPeriod').value, srcv = $('dSrc').value;
    var srcs = uniqArr(st.recs.map(function (r) { return r.src || ''; })).sort();
    if (srcv && srcs.indexOf(srcv) < 0) srcv = '';
    $('dSrc').innerHTML = opt('', '全部檔案', !srcv) + srcs.map(function (s) { return opt(s, s || '（未記錄）', s === srcv); }).join('');
    if (srcv) list = list.filter(function (r) { return (r.src || '') === srcv; });
    var sts = [], its = [];
    list.forEach(function (r) { if (sts.indexOf(r.st) < 0) sts.push(r.st); if (its.indexOf(r.item) < 0) its.push(r.item); });
    $('dSt').innerHTML = opt('', '全部測站', !stv) + sts.map(function (s) { return opt(s, s, s === stv); }).join('');
    $('dItem').innerHTML = opt('', '全部測項', !itv) + its.map(function (s) { return opt(s, s, s === itv); }).join('');
    $('dPeriod').innerHTML = periodOptions(pv);
    var p = periodOf(pv), q = $('dQ').value.trim();
    list = list.filter(function (r) { return (!stv || r.st === stv) && (!itv || r.item === itv) && Co.inPeriod(r.iso, p) && (!q || (r.raw + ' ' + r.src + ' ' + r.note + ' ' + r.dl + ' ' + Co.rocDate(r.iso)).indexOf(q) >= 0); });
    list.sort(function (a, b) { return a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : a.st < b.st ? -1 : a.st > b.st ? 1 : a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : a.item < b.item ? -1 : 1; });
    var per = 400, pages = Math.max(1, Math.ceil(list.length / per));
    if (dPage >= pages) dPage = 0;
    dFiltered = list;
    var show = list.slice(dPage * per, dPage * per + per);
    $('dCount').innerHTML = '共 ' + list.length + ' 筆' + (pages > 1 ? '・第 <select id="dPg">' + Array.apply(null, Array(pages)).map(function (x, i) { return opt(i, (i + 1) + '／' + pages, i === dPage); }).join('') + '</select> 頁' : '') + '　<span class="small">（數值可直接點一下修改，按 Enter 或移開就會儲存）</span>';
    $('dTable').innerHTML = show.length ? '<table class="t"><thead><tr><th><input type="checkbox" id="dChkAll"></th><th>類別</th><th>測站</th><th>採樣日期</th><th>備註</th><th>測項</th><th>數值</th><th>單位</th><th>來源檔案</th></tr></thead><tbody>' +
      show.map(function (r) {
        return '<tr' + (r.excl ? ' class="excl"' : '') + '><td><input type="checkbox" data-k="' + esc(r.k) + '"></td><td>' + esc(r.cat) + '</td><td>' + esc(r.st) + '</td><td>' + esc(r.dl) + '</td><td>' + esc(r.note) + '</td><td>' + esc(r.item) + '</td><td class="num"><input class="cell" data-edit="' + esc(r.k) + '" value="' + esc(r.raw) + '"></td><td>' + esc(r.unit) + '</td><td class="small muted">' + esc(r.src || '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">沒有符合條件的資料</div>';
  }
  ['dCat', 'dSt', 'dItem', 'dPeriod', 'dSrc'].forEach(function (id) { $(id).addEventListener('change', function () { if (id === 'dCat') { $('dSt').value = ''; $('dItem').value = ''; } dPage = 0; renderData(); }); });
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
  $('dDelAll').addEventListener('click', function () {
    var ks = dFiltered.map(function (r) { return r.k; }); if (!ks.length) { toast('目前篩選沒有資料', true); return; }
    var all = ks.length === st.recs.length;
    if (!confirm((all ? '目前沒有篩選，這會刪除這個計畫的全部 ' : '刪除目前篩選出的全部 ') + ks.length + ' 筆資料（不只這一頁）？無法復原。\n\n若只是某次匯入錯了，建議改用「匯入報告」頁下方的「匯入紀錄」復原，會把被蓋掉的舊值放回去。')) return;
    S.delRecs(ks).then(function () { return loadProject(st.pid); }).then(function () { renderData(); toast('已刪除 ' + ks.length + ' 筆'); });
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
  var TYPE_LABEL = { text: '判讀不出的數值', outlier: '異常高低值', conflict: '兩份檔案數值不同', missing: '缺測項', similar: '名稱很像的測站', sameval: '數值完全一樣的測站', unit: '單位不一致', over: '超過標準值（提示）' };
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
      if (a.type === 'sameval') act = '<button class="btn small" data-merge="' + i + '" data-to="0">同一站，歸入「' + esc(a.names[0]) + '」</button><button class="btn small" data-merge="' + i + '" data-to="1">同一站，歸入「' + esc(a.names[1]) + '」</button><button class="btn small" data-look="' + i + '">到資料檢視核對</button><button class="btn small" data-notsame="' + i + '">不是同一站，數值無誤</button>';
      if (a.type === 'similar') act = '<button class="btn small" data-merge="' + i + '" data-to="0">歸入「' + esc(a.names[0]) + '」</button><button class="btn small" data-merge="' + i + '" data-to="1">歸入「' + esc(a.names[1]) + '」</button><button class="btn small" data-notsame="' + i + '">不是同一站</button>';
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
    var lk = e.target.closest('[data-look]');
    if (lk) {   // 列出兩站在那一天的資料（v1.0.8）
      var la = lastAnoms.filter(function (x) { return !cFilter || x.type === cFilter; })[+lk.getAttribute('data-look')]; if (!la) return;
      go('data'); $('dCat').value = la.cat; renderData();
      $('dSt').value = ''; $('dItem').value = ''; $('dSrc').value = ''; $('dPeriod').value = ''; $('dQ').value = la.days[0] || '';
      renderData(); toast('列出 ' + (la.days[0] || '') + ' 這一天的資料' + (la.days.length > 1 ? '（共 ' + la.days.length + ' 天，可在搜尋欄改日期）' : '') + '，請對照報告核對兩站數值');
      return;
    }
    var ns = e.target.closest('[data-notsame]');
    if (ns) {
      var sa = lastAnoms.filter(function (x) { return !cFilter || x.type === cFilter; })[+ns.getAttribute('data-notsame')]; if (!sa) return;
      st.meta.ok[sa.id] = Date.now();
      saveMeta().then(function () { renderCheck(); toast('已記住「' + sa.names[0] + '」與「' + sa.names[1] + '」不是同一站，不再提醒'); });
      return;
    }
    var b = e.target.closest('[data-merge]'); if (!b) return;

    var shown = lastAnoms.filter(function (x) { return !cFilter || x.type === cFilter; });
    var an = shown[+b.getAttribute('data-merge')]; if (!an) return;
    var to = an.names[+b.getAttribute('data-to')], from = an.names[1 - +b.getAttribute('data-to')];
    if (!confirm('把「' + from + '」的資料全部歸入測站「' + to + '」？之後匯入「' + from + '」也會自動歸入。\n（可以在「測項與標準值」頁的「測站名稱與歸類」取消歸入）')) return;
    mergeStation(an.cat, from, to).then(function (r) { renderCheck(); toast(mergeMsg(r, from, to)); });
  });
  // 測站歸入／改名（v1.0.7）：把 from 的資料、標準值改到 to；之後匯入 from 自動改成 to；可以取消歸入還原
  // 同一天同一測項兩站都有值：一樣就合成一筆；不一樣保留 to 的值，列入異常檢查（季報來自月報，不同一定要查）
  function mergeStation(cat, from, to) {
    var idx = {}; st.recs.forEach(function (r) { idx[r.k] = r; });
    var mid = 'm' + Date.now(), now = Date.now();
    var put = [], del = [], moved = [], confs = [], same = 0, tOrig = {}, tPut = {};
    st.recs.forEach(function (r) {
      if (r.cat !== cat || r.st !== from) return;
      del.push(r.k); moved.push(r);
      var o = Object.assign({}, r, { st: to }); o.k = S.recKey(o);
      var e = idx[o.k];
      if (e) {
        if (e.raw === o.raw) {   // 合成一筆，來源報告記在目標那筆上（取消歸入時還原）
          same++;
          if (!tOrig[e.k]) tOrig[e.k] = Object.assign({}, e);
          var t = tPut[e.k] = tPut[e.k] || Object.assign({}, e);
          t.alsoSrc = (t.alsoSrc || []).concat([o.src].concat(o.alsoSrc || [])).filter(function (x, i, a) { return x && x !== t.src && a.indexOf(x) === i; });
          return;
        }
        confs.push({ k: o.k, cat: cat, old: o.raw, oldSrc: o.src, raw: e.raw, src: e.src, at: now, mid: mid, how: 'merge', from: from, to: to });
        return;
      }
      put.push(o);
    });
    var sPut = [], sDel = [], sMoved = [], sDrop = 0;
    var hasTo = {}; st.stds.forEach(function (x) { if (x.cat === cat && x.st === to) hasTo[x.item] = 1; });
    st.stds.forEach(function (x) {
      if (x.cat !== cat || x.st !== from) return;
      sDel.push(x.k); sMoved.push(x);
      if (hasTo[x.item]) { sDrop++; return; }
      var o = Object.assign({}, x, { st: to }); o.k = S.stdKey(o); sPut.push(o);
    });
    var al = st.meta.stAlias[cat] = st.meta.stAlias[cat] || {};
    var alPrev = {}; Object.keys(al).forEach(function (k) { alPrev[k] = al[k]; });
    al[from] = to; Object.keys(al).forEach(function (k) { if (al[k] === from) al[k] = to; });
    delete al[to];
    // 異常檢查「名稱很像」與舊的衝突紀錄改到新測站
    st.meta.conflicts.forEach(function (c) { if (c.cat === cat && c.k && c.k.split('|')[2] === from) { var a = c.k.split('|'); a[2] = to; (c.mk = c.mk || {})[mid] = c.k; c.k = a.join('|'); } });
    st.meta.conflicts = st.meta.conflicts.concat(confs).slice(-1000);
    st.meta.merges.push({ id: mid, cat: cat, from: from, to: to, at: now, n: moved.length, same: same, conf: confs.length, sDrop: sDrop });
    var undo = { put: put.map(function (r) { return r.k; }), moved: moved, sPut: sPut.map(function (x) { return x.k; }), sMoved: sMoved, alPrev: alPrev, tOrig: Object.keys(tOrig).map(function (k) { return tOrig[k]; }) };
    put = put.concat(Object.keys(tPut).map(function (k) { return tPut[k]; }));
    return Promise.all([S.putRecs(put, del), S.putStds(sPut, sDel), S.setMeta(st.pid, 'merge|' + mid, undo), saveMeta()])
      .then(function () { return loadProject(st.pid); })
      .then(function () { return { n: moved.length, same: same, conf: confs.length, sDrop: sDrop }; });
  }
  function mergeBlocked(m) {   // 歸入之後 to 又被歸入別站，要先取消後面那次
    var later = st.meta.merges.filter(function (x) { return x.at > m.at && x.cat === m.cat && (x.from === m.to || x.to === m.from || x.from === m.from); });
    return later.length ? later[later.length - 1] : null;
  }
  function unmergeStation(id) {
    var m = st.meta.merges.filter(function (x) { return x.id === id; })[0]; if (!m) return Promise.resolve();
    return S.getMeta(st.pid, 'merge|' + id, null).then(function (u) {
      if (!u) throw new Error('找不到還原資料');
      var cur = {}; st.recs.forEach(function (r) { cur[r.k] = r; });
      // 歸入後又在目標測站修改過的值，跟著還原
      var moved = u.moved.map(function (r) {
        var o = Object.assign({}, r, { st: m.to }); o.k = S.recKey(o);
        var c = cur[o.k];
        if (c && u.put.indexOf(o.k) >= 0) { var b = Object.assign({}, r); b.raw = c.raw; b.excl = c.excl; return b; }
        return r;
      });
      var delK = u.put.filter(function (k) { return cur[k]; });
      var al = st.meta.stAlias[m.cat] = st.meta.stAlias[m.cat] || {};
      var ap = u.alPrev || {};
      // 只還原這次歸入改過的別名，其他測站之後的歸類不動
      if (ap[m.from] != null) al[m.from] = ap[m.from]; else delete al[m.from];
      Object.keys(ap).forEach(function (k) { if (ap[k] === m.from && al[k] === m.to) al[k] = m.from; });
      if (ap[m.to] != null && al[m.to] == null) al[m.to] = ap[m.to];
      st.meta.conflicts = st.meta.conflicts.filter(function (c) { return c.mid !== id; });
      st.meta.conflicts.forEach(function (c) { if (c.mk && c.mk[id]) { c.k = c.mk[id]; delete c.mk[id]; } });   // 歸入時改到新測站的舊衝突紀錄改回來
      st.meta.merges = st.meta.merges.filter(function (x) { return x.id !== id; });
      var restoreT = (u.tOrig || []).filter(function (r) { return cur[r.k]; }).map(function (r) { var c = cur[r.k], o = Object.assign({}, c); if (r.alsoSrc) o.alsoSrc = r.alsoSrc; else delete o.alsoSrc; return o; });
      return Promise.all([S.putRecs(moved.concat(restoreT), delK), S.putStds(u.sMoved, u.sPut), S.delMeta(st.pid, ['merge|' + id]), saveMeta()]);
    }).then(function () { return loadProject(st.pid); });
  }
  function mergeMsg(r, from, to) {
    return '已把「' + from + '」的 ' + r.n + ' 筆資料歸入「' + to + '」' + (r.same ? '（其中 ' + r.same + ' 筆兩站數值相同，合成一筆）' : '') + (r.conf ? '；' + r.conf + ' 筆同一天數值不同，保留「' + to + '」的值並列入資料異常檢查' : '') + (r.sDrop ? '；' + r.sDrop + ' 筆標準值「' + to + '」已有，沿用「' + to + '」的' : '');
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
    if (!st.pid) { $('sAddForm').hidden = true; $('sTable').innerHTML = '<div class="empty">請先建立或選擇計畫</div>'; $('iTable').innerHTML = ''; return; }
    var cats = catsInData(), cat = $('sCat').value;
    if (!cat || cats.indexOf(cat) < 0) cat = cats[0] || '';
    $('sCat').innerHTML = cats.map(function (c) { return opt(c, c, c === cat); }).join('') || '<option value="">（還沒有資料）</option>';
    var cg = Co.catalog(st.recs.filter(function (r) { return true; }), cat, null);
    var list = st.stds.filter(function (s) { return s.cat === cat; });
    var groups = {}, order = [];
    list.forEach(function (s) {
      var g = s.item + '\u0001' + (s.from || '') + '\u0001' + (s.to || '') + '\u0001' + (s.m1 || '') + '-' + (s.m2 || '') + '\u0001' + (s.mode || '') + '\u0001' + s.text + '\u0001' + (s.label || '');   // v1.0.6：說明不同（例如丁類、乙類）不合併成一列
      if (!groups[g]) { groups[g] = { item: s.item, text: s.text, lines: s.lines, label: s.label, by: s.by, from: s.from || '', to: s.to || '', m1: s.m1 || 0, m2: s.m2 || 0, mode: s.mode || X.stdMode(s.text || '', s.item), keys: [], sts: [] }; order.push(g); }
      groups[g].keys.push(s.k); groups[g].sts.push(s.st === '*' ? '全部測站' : s.st);
      if (s.by === 'user') groups[g].by = 'user';
    });
    order.sort(function (a, b) { return a < b ? -1 : 1; });
    stdGroups = order.map(function (g) { return groups[g]; });
    // 篩選：測項、測站（含「全部測站」的標準）、搜尋
    var allSts = cg.stations.slice().sort(zhSort), allIts = cg.items.filter(function (it) { return !cg.textItems[it]; });
    stdGroups.forEach(function (g) { if (allIts.indexOf(g.item) < 0) allIts.push(g.item); });
    var fIt = $('sfItem').value, fSt = $('sfSt').value, fQ = $('sfQ').value.trim();
    if (fIt && allIts.indexOf(fIt) < 0) fIt = ''; if (fSt && allSts.indexOf(fSt) < 0) fSt = '';
    $('sfItem').innerHTML = opt('', '全部測項', !fIt) + allIts.map(function (x) { return opt(x, x, x === fIt); }).join('');
    $('sfSt').innerHTML = opt('', '全部測站', !fSt) + allSts.map(function (x) { return opt(x, x, x === fSt); }).join('');
    $('sfMissWrap').hidden = sView !== 'grid';
    Array.prototype.forEach.call($('sView').querySelectorAll('[data-sview]'), function (b) { b.classList.toggle('on', b.getAttribute('data-sview') === sView); });
    if (sView === 'grid') { renderStdGrid(cat, allSts, allIts, fSt, fIt, fQ); renderItemTable(cat, cg); return; }
    var nAll = stdGroups.length;
    stdGroups = stdGroups.filter(function (g) {
      if (fIt && g.item !== fIt) return false;
      if (fSt && g.sts.indexOf(fSt) < 0 && g.sts.indexOf('全部測站') < 0) return false;
      if (fQ && (g.text + ' ' + (g.label || '') + ' ' + g.sts.join(' ') + ' ' + g.item).indexOf(fQ) < 0) return false;
      return true;
    });
    $('sfCount').textContent = (fIt || fSt || fQ) ? '符合 ' + stdGroups.length + '／' + nAll + ' 筆' : '共 ' + nAll + ' 筆';
    $('sBack').hidden = !st.stdFromChart;
    var af = $('sAddForm');
    if (!af.hidden && (af.dataset.cat !== cat || af.dataset.pid !== st.pid)) { $('sCat').value = cat; openAddForm(false); }
    $('sTable').innerHTML = stdGroups.length ? '<table class="t std-t"><thead><tr><th>測項</th><th>標準值</th><th>判定方式</th><th>適用月份<br><span class="small muted">格式 5-9、10-4<br>空白＝全年</span></th><th>適用期間 起<br><span class="small muted">格式 112.01.01<br>空白＝不限</span></th><th>適用期間 迄<br><span class="small muted">格式 112.12.31<br>空白＝不限</span></th><th>畫線<br>數值</th><th>適用測站</th><th>說明／來源</th><th></th></tr></thead><tbody>' + stdGroups.map(function (g, i) {
      return '<tr><td>' + esc(g.item) + '</td><td><input class="cell" style="width:100px;text-align:left" data-sg="' + i + '" value="' + esc(g.text) + '"></td>' +
        '<td><select class="cell" data-sgm="' + i + '">' + MODE_OPTS.map(function (m) { return opt(m[0], m[1], m[0] === g.mode); }).join('') + '</select></td>' +
        '<td><input class="cell" style="width:92px;text-align:left" list="monthPresets" data-sgmo="' + i + '" value="' + esc(g.m1 ? g.m1 + '-' + g.m2 : '') + '" placeholder="全年" title="格式：5-9（5～9 月）、10-4（10 月～翌年 4 月）；空白＝全年"><div class="small muted">' + esc(Co.monthNote(g)) + '</div></td>' +
        '<td><input class="cell" style="width:105px;text-align:left" data-sgf="' + i + '" value="' + esc(g.from ? Co.rocDate(g.from) : '') + '" placeholder="不限" title="格式：112.01.01；空白＝不限"></td><td><input class="cell" style="width:105px;text-align:left" data-sgt="' + i + '" value="' + esc(g.to ? Co.rocDate(g.to) : '') + '" placeholder="不限" title="格式：112.12.31；空白＝不限"></td>' +
        '<td>' + esc(g.lines.join('、')) + '</td><td class="st-cell">' + esc(g.sts.join('、')) + '</td><td class="note-cell">' + (g.label ? esc(g.label) + '<br>' : '') + '<span class="small muted">' + (g.by === 'user' ? '自行設定' : '報告帶入') + '</span></td><td><button class="btn small danger" data-sgdel="' + i + '">刪除</button></td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty">這個類別還沒有標準值，按「＋ 新增一筆標準值」設定</div>';
    renderItemTable(cat, cg);
    renderStationTable(cat);
  }
  // 測站名稱與歸類（v1.0.7）
  function renderStationTable(cat) {
    var by = {};
    st.recs.forEach(function (r) {
      if (r.cat !== cat) return;
      var b = by[r.st] = by[r.st] || { n: 0, d1: r.iso, d2: r.iso, src: {} };
      b.n++; if (r.iso < b.d1) b.d1 = r.iso; if (r.iso > b.d2) b.d2 = r.iso; if (r.src) b.src[r.src] = 1; (r.alsoSrc || []).forEach(function (x) { b.src[x] = 1; });
    });
    var sts = Object.keys(by).sort(function (a, b) { return by[a].d1 < by[b].d1 ? -1 : by[a].d1 > by[b].d1 ? 1 : zhSort(a, b); });
    $('stTable').innerHTML = sts.length ? '<table class="t st-t"><thead><tr><th>測站</th><th>筆數</th><th>監測期間</th><th>來源報告</th><th>歸入其他測站／改名</th></tr></thead><tbody>' + sts.map(function (s) {
      var b = by[s], srcs = Object.keys(b.src).sort(zhSort);
      return '<tr><td>' + esc(s) + '</td><td class="num">' + b.n + '</td><td class="nowrap">' + esc(Co.rocDate(b.d1)) + (b.d2 !== b.d1 ? '～' + esc(Co.rocDate(b.d2)) : '') + '</td><td class="small">' + esc(srcs.slice(0, 4).join('、')) + (srcs.length > 4 ? ' 等 ' + srcs.length + ' 份' : '') + '</td>' +
        '<td><select class="cell" data-mto="' + esc(s) + '"><option value="">維持獨立</option>' + sts.filter(function (x) { return x !== s; }).map(function (x) { return '<option value="' + esc(x) + '">歸入「' + esc(x) + '」</option>'; }).join('') + '<option value="__new">改成其他名稱…</option></select>' +
        '<span class="mnew" hidden><input class="cell" style="width:160px;text-align:left" data-mname="' + esc(s) + '" placeholder="新名稱"><button class="btn small" data-mgo="' + esc(s) + '">確定</button></span></td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty">這個類別還沒有資料</div>';
    var ms = st.meta.merges.filter(function (m) { return m.cat === cat; });
    $('mergeList').innerHTML = ms.length ? '<h4 class="mt">已歸入的測站</h4><table class="t"><thead><tr><th>原測站</th><th></th><th>歸入</th><th>時間</th><th>說明</th><th></th></tr></thead><tbody>' + ms.slice().reverse().map(function (m) {
      var bl = mergeBlocked(m);
      return '<tr><td>' + esc(m.from) + '</td><td>→</td><td>' + esc(m.to) + '</td><td class="nowrap small">' + esc(fmtTime(m.at)) + '</td><td class="small">' + m.n + ' 筆' + (m.same ? '（' + m.same + ' 筆數值相同，合成一筆）' : '') + (m.conf ? '；' + m.conf + ' 筆數值不同' : '') + '</td><td>' +
        (bl ? '<span class="small muted">要先取消「' + esc(bl.from) + ' → ' + esc(bl.to) + '」</span>' : '<button class="btn small" data-unmerge="' + esc(m.id) + '">取消歸入</button>') + '</td></tr>';
    }).join('') + '</tbody></table>' : '';
  }
  function doMerge(cat, from, to) {
    var exists = st.recs.some(function (r) { return r.cat === cat && r.st === to; });
    var q = exists ? '把「' + from + '」的資料全部歸入「' + to + '」？\n趨勢圖會畫成同一站；之後匯入「' + from + '」也會自動歸入。\n同一天同一測項兩站數值不同時，保留「' + to + '」的值並列入資料異常檢查。\n歸錯可以在「已歸入的測站」取消。'
      : '把測站「' + from + '」改名為「' + to + '」？之後匯入「' + from + '」也會自動改名。\n改錯可以在「已歸入的測站」取消。';
    if (!confirm(q)) { renderStd(); return; }
    mergeStation(cat, from, to).then(function (r) { renderStd(); updateBadge(); toast(exists ? mergeMsg(r, from, to) : '已把「' + from + '」改名為「' + to + '」'); }).catch(function (e) { toast('失敗：' + e.message, true); });
  }
  $('stTable').addEventListener('change', function (e) {
    var from = e.target.getAttribute('data-mto'); if (from == null) return;
    var v = e.target.value, box = e.target.parentNode.querySelector('.mnew');
    box.hidden = v !== '__new';
    if (v === '__new') { box.querySelector('input').focus(); return; }
    if (v) doMerge($('sCat').value, from, v);
  });
  function goNewName(from) {
    var inp = $('stTable').querySelector('input[data-mname="' + (window.CSS && CSS.escape ? CSS.escape(from) : from) + '"]'), to = inp ? inp.value.trim() : '';
    if (!to) return toast('請輸入新名稱', true);
    if (to === from) return;
    doMerge($('sCat').value, from, to);
  }
  $('stTable').addEventListener('click', function (e) { var b = e.target.closest('[data-mgo]'); if (b) goNewName(b.getAttribute('data-mgo')); });
  $('stTable').addEventListener('keydown', function (e) { var n = e.target.getAttribute('data-mname'); if (n != null && e.key === 'Enter') { e.preventDefault(); goNewName(n); } });
  $('mergeList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-unmerge]'); if (!b) return;
    var m = st.meta.merges.filter(function (x) { return x.id === b.getAttribute('data-unmerge'); })[0]; if (!m) return;
    if (!confirm('取消「' + m.from + ' → ' + m.to + '」？\n「' + m.from + '」的資料與標準值會還原成獨立測站，之後匯入也不再自動歸入。')) return;
    unmergeStation(m.id).then(function () { renderStd(); updateBadge(); toast('已取消歸入，「' + m.from + '」還原成獨立測站'); }).catch(function (e2) { toast('失敗：' + e2.message, true); });
  });
  function renderItemTable(cat, cg) {
    var units = st.meta.units[cat] || {};
    $('iTable').innerHTML = cg.items.length ? '<table class="t"><thead><tr><th>測項名稱</th><th>改名為</th><th>單位</th><th>筆數</th></tr></thead><tbody>' + cg.items.map(function (it) {
      var n = st.recs.filter(function (r) { return r.cat === cat && r.item === it; }).length;
      return '<tr><td>' + esc(it) + (cg.textItems[it] ? ' <span class="pill info">文字，不畫圖</span>' : '') + '</td><td><input class="cell" style="width:180px;text-align:left" data-ren="' + esc(it) + '" value="' + esc(it) + '"></td><td><input class="cell" style="width:120px;text-align:left" data-unit="' + esc(it) + '" value="' + esc(units[it] || cg.units[it] || '') + '"></td><td class="num">' + n + '</td></tr>';
    }).join('') + '</tbody></table>' : '';
  }
  $('sCat').addEventListener('change', renderStd);
  var stdGroups = [], sView = 'list';
  function zhSort(a, b) { return String(a).localeCompare(String(b), 'zh-Hant-TW'); }
  // 對照表：每個測站 × 每個測項實際會用的標準值（測站自己的優先，沒有才用「全部測站」），一眼看出漏設或設錯
  function renderStdGrid(cat, sts, its, fSt, fIt, fQ) {
    var rows = fSt ? [fSt] : sts, cols = fIt ? [fIt] : its, miss = $('sfMiss').checked, nMiss = 0, shown = 0;
    var cell = function (stn, it) {
      var own = st.stds.filter(function (x) { return x.cat === cat && x.item === it && x.st === stn && x.lines && x.lines.length; });
      var list = own.length ? own : st.stds.filter(function (x) { return x.cat === cat && x.item === it && x.st === '*' && x.lines && x.lines.length; });
      return { list: list, own: !!own.length };
    };
    var body = rows.map(function (stn) {
      var tds = cols.map(function (it) {
        var c = cell(stn, it);
        if (!c.list.length) nMiss++;
        var txt = c.list.map(function (x) { return Co.stdLabel(x) + (x.mode === 'min' ? '（下限）' : x.mode === 'range' ? '（範圍）' : ''); });
        var hit = !fQ || (txt.join(' ') + ' ' + c.list.map(function (x) { return x.label || ''; }).join(' ')).indexOf(fQ) >= 0;
        if ((miss && c.list.length) || !hit) return '<td class="g-skip"></td>';
        shown++;
        var da = ' data-gst="' + esc(stn) + '" data-git="' + esc(it) + '"';
        if (!c.list.length) return '<td class="g-miss"' + da + ' title="這個測站的「' + esc(it) + '」沒有標準值；點一下新增">沒有</td>';
        return '<td class="' + (c.own ? 'g-own' : 'g-all') + '"' + da + ' title="' + esc((c.own ? '這個測站自己的標準' : '套用「全部測站」的標準') + (c.list[0].label ? '：' + c.list[0].label : '') + '；點一下到清單修改') + '">' + txt.map(esc).join('<br>') + '</td>';
      }).join('');
      return '<tr><th class="g-st">' + esc(stn) + '</th>' + tds + '</tr>';
    }).join('');
    $('sTable').innerHTML = rows.length && cols.length ? '<table class="t std-grid"><thead><tr><th class="g-st">測站＼測項</th>' + cols.map(function (it) { return '<th>' + esc(it) + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="g-legend"><span class="g-own">測站自己的標準</span><span class="g-all">套用「全部測站」</span><span class="g-miss">沒有標準值</span>　點格子：有標準值的會切到清單只列那一項；「沒有」的會開新增表單並帶好測站與測項。</div>' : '<div class="empty">這個類別還沒有資料</div>';
    $('sfCount').textContent = rows.length * cols.length + ' 格，其中 ' + nMiss + ' 格沒有標準值';
  }
  $('sTable').addEventListener('click', function (e) {
    var td = e.target.closest('[data-gst]'); if (!td) return;
    var stn = td.getAttribute('data-gst'), it = td.getAttribute('data-git');
    if (td.classList.contains('g-miss')) {
      openAddForm(true); $('saItem').value = it; $('saSt').value = stn; $('saMode').value = X.stdMode('', it);
      $('sAddForm').scrollIntoView({ block: 'center' }); $('saText').focus(); return;
    }
    sView = 'list'; renderStd(); $('sfItem').value = it; $('sfSt').value = stn; renderStd();
  });
  $('sView').addEventListener('click', function (e) { var b = e.target.closest('[data-sview]'); if (!b) return; sView = b.getAttribute('data-sview'); renderStd(); });
  ['sfItem', 'sfSt', 'sfMiss'].forEach(function (id) { $(id).addEventListener('change', renderStd); });
  $('sfQ').addEventListener('input', function () { clearTimeout(renderStd._t); renderStd._t = setTimeout(renderStd, 200); });
  $('sTable').addEventListener('change', function (e) {
    var el = e.target, i = el.getAttribute('data-sg'), fi = el.getAttribute('data-sgf'), ti = el.getAttribute('data-sgt'), mi = el.getAttribute('data-sgm'), moi = el.getAttribute('data-sgmo');
    var idx = [i, fi, ti, mi, moi].filter(function (x) { return x != null; })[0]; if (idx == null) return;
    var g = stdGroups[+idx], val = el.value.trim();
    var ch = st.stds.filter(function (x) { return g.keys.indexOf(x.k) >= 0; });
    if (mi != null) {
      ch.forEach(function (x) { x.mode = val; x.by = 'user'; });
      S.putStds(ch).then(function () { renderStd(); toast('已更新判定方式'); });
      return;
    }
    if (moi != null) {
      var mm = parseMonths(val);
      if (mm === false) { toast('月份看不懂，請寫「5-9」或「10-4」（10 月到翌年 4 月），空白＝全年', true); el.value = g.m1 ? g.m1 + '-' + g.m2 : ''; return; }
      var delM = ch.map(function (x) { return x.k; });
      ch.forEach(function (x) { x.m1 = mm ? mm[0] : 0; x.m2 = mm ? mm[1] : 0; x.by = 'user'; x.k = S.stdKey(x); });
      S.putStds(ch, delM).then(function () { return loadProject(st.pid); }).then(function () { renderStd(); toast('已更新適用月份'); });
      return;
    }
    if (fi != null || ti != null) {
      var d = val ? X.parseDate(val) : null;
      if (val && !d) { toast('日期看不懂，請用 113.09.30 這種寫法（空白＝不限）', true); el.value = ''; return; }
      var del = ch.map(function (x) { return x.k; });
      ch.forEach(function (x) { if (fi != null) x.from = d ? d.iso : ''; else x.to = d ? d.iso : ''; x.by = 'user'; x.k = S.stdKey(x); });
      if (ch.some(function (x) { return x.from && x.to && x.from > x.to; })) { toast('起日不能晚於迄日', true); return loadProject(st.pid).then(renderStd); }
      S.putStds(ch, del).then(function () { return loadProject(st.pid); }).then(function () { renderStd(); toast('已更新適用期間'); });
      return;
    }
    ch.forEach(function (x) { x.text = val; x.lines = X.stdLines(val); x.by = 'user'; x.mode = X.stdMode(val, x.item); });
    S.putStds(ch).then(function () { renderStd(); toast('已更新 ' + ch.length + ' 個測站的標準值'); });
  });
  $('sTable').addEventListener('click', function (e) {
    var i = e.target.getAttribute('data-sgdel'); if (i == null) return;
    var ks = stdGroups[+i].keys;
    S.putStds([], ks).then(function () { st.stds = st.stds.filter(function (s) { return ks.indexOf(s.k) < 0; }); renderStd(); });
  });
  var MODE_OPTS = [['max', '上限（不可超過）'], ['min', '下限（不可低於）'], ['range', '範圍（兩值之間）']];
  function parseMonths(t) {
    t = String(t || '').trim(); if (!t || t === '全年') return null;
    var m = /^(\d{1,2})\s*月?\s*[-~～至到－]\s*(?:翌年)?\s*(\d{1,2})\s*月?$/.exec(t);
    if (!m) return false;
    var a = +m[1], b = +m[2]; if (a < 1 || a > 12 || b < 1 || b > 12) return false;
    return [a, b];
  }
  // 新增標準值表單：依目前類別產生；表單開著時切換類別會自動換成新類別的測項與測站
  function openAddForm(focus) {
    var cat = $('sCat').value, f = $('sAddForm'); if (!cat) { f.hidden = true; return; }
    var cg = Co.catalog(st.recs, cat, null);
    f.hidden = false; f.dataset.cat = cat; f.dataset.pid = st.pid;
    f.innerHTML = '<div class="filters wrap">' +
      '<label>測項<select id="saItem">' + cg.items.map(function (it) { return opt(it, it); }).join('') + '</select></label>' +
      '<label>適用測站<select id="saSt">' + opt('*', '全部測站') + cg.stations.map(function (x) { return opt(x, x); }).join('') + '</select></label>' +
      '<label>標準值<input id="saText" style="width:110px" placeholder="75"></label>' +
      '<label>判定方式<select id="saMode">' + MODE_OPTS.map(function (m) { return opt(m[0], m[1]); }).join('') + '</select></label>' +
      '<label>適用月份（空白＝全年）<input id="saMon" list="monthPresets" style="width:120px" placeholder="5-9"></label>' +
      '<label>適用期間 起（空白＝不限）<input id="saFrom" style="width:130px" placeholder="112.01.01"></label>' +
      '<label>適用期間 迄（空白＝不限）<input id="saTo" style="width:130px" placeholder="112.12.31"></label>' +
      '<label class="grow">說明（選填）<input id="saNote" placeholder="例：法規名稱、管制區類別"></label>' +
      '</div><div class="actions"><button class="btn primary" id="saGo" type="button">新增</button><button class="btn" id="saCancel" type="button">取消</button><span class="muted small">季節性標準（例如水溫）請新增兩筆，各填不同的適用月份。</span></div>';
    $('saText').addEventListener('input', function () { $('saMode').value = X.stdMode(this.value, $('saItem').value); });
    if (focus) $('saText').focus();
  }
  $('sAdd').addEventListener('click', function () {
    if (!$('sCat').value) return toast('請先匯入資料', true);
    openAddForm(true);
  });
  $('sAddForm').addEventListener('click', function (e) {
    if (e.target.id === 'saCancel') { $('sAddForm').hidden = true; return; }
    if (e.target.id !== 'saGo') return;
    var cat = $('sCat').value, text = $('saText').value.trim();
    if (!text || !X.stdLines(text).length) return toast('請填標準值數字（例：38 或 6~9）', true);
    var mm = parseMonths($('saMon').value); if (mm === false) return toast('月份看不懂，請寫「5-9」或「10-4」，空白＝全年', true);
    var fv = $('saFrom').value.trim(), tv = $('saTo').value.trim();
    var fd = fv ? X.parseDate(fv) : null, td = tv ? X.parseDate(tv) : null;
    if ((fv && !fd) || (tv && !td)) return toast('日期看不懂，請用 112.01.01 這種寫法（空白＝不限）', true);
    if (fd && td && fd.iso > td.iso) return toast('起日不能晚於迄日', true);
    var o = { pid: st.pid, cat: cat, st: $('saSt').value, item: $('saItem').value, text: text, lines: X.stdLines(text), mode: $('saMode').value, m1: mm ? mm[0] : 0, m2: mm ? mm[1] : 0, label: $('saNote').value.trim(), by: 'user', from: fd ? fd.iso : '', to: td ? td.iso : '' };
    o.k = S.stdKey(o);
    S.putStds([o]).then(function () { return loadProject(st.pid); }).then(function () {
      renderStd(); toast('已新增：' + o.item + ' ' + Co.stdLabel(o));
      $('saText').value = ''; $('saMon').value = ''; $('saText').focus();
    });
  });
  $('sBack').addEventListener('click', function () { st.stdFromChart = false; go('chart'); });
  $('gStdEdit').addEventListener('click', function () {
    if (!needProject()) return;
    st.stdFromChart = true; go('std');
    var c = $('gCat').value; if (c) { $('sCat').value = c; renderStd(); }
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
    var nStd = st.stds.filter(function (x) { return x.cat === cat; }).length;
    $('gStdPeek').textContent = nStd ? '這個類別有 ' + nStd + ' 筆標準值（可設季節性、分期）' : '這個類別還沒有標準值';
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
    updatePlan();
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
    if (box.id === 'gSts' || box.id === 'gItems') { saveForm(); updatePlan(); }
  });
  ['gSts', 'gItems'].forEach(function (id) { $(id).addEventListener('change', function () { saveForm(); updatePlan(); }); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name=gMode]'), function (r) { r.addEventListener('change', updatePlan); });
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
    figOff = {};
    if (!charts.length) { $('gFilter').hidden = true; out.innerHTML = '<div class="card empty">這個期間、測站與測項沒有可以畫的資料</div>'; $('gXlsx').disabled = true; $('gPngAll').disabled = true; return; }
    out.innerHTML = charts.map(function (c, i) {
      var nd = 0; c.series.forEach(function (s) { s.values.forEach(function (v) { if (v && v.num == null) nd++; }); });
      var title = (c.kind === 'station' ? c.station + '｜' : '') + c.title;
      return '<div class="fig" data-fi="' + i + '"><div class="fig-head"><label class="chk fig-pick" title="取消勾選：下載全部圖檔與 Excel 時不包含這張"><input type="checkbox" data-fpick="' + i + '" checked> </label><span class="t">' + esc(title) + '</span><button class="btn small" data-png="' + i + '">下載高解析圖</button></div><canvas data-i="' + i + '"></canvas>' +
        '<div class="note">' + c.cats.length + ' 次採樣' + (nd ? '・' + nd + ' 筆為 ND／&lt;x 等非數值，未畫長條' : '') + (c.stdLines.length ? '' : '・沒有標準值（可在「測項與標準值」設定）') + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(out.querySelectorAll('canvas'), function (cv) { CH.draw(cv, charts[+cv.getAttribute('data-i')], drawOpts(Math.min(2, window.devicePixelRatio || 1))); });
    $('gXlsx').disabled = false; $('gPngAll').disabled = false;
    $('gMsg').textContent = '共 ' + charts.length + ' 張圖';
    renderFigFilter();
  });
  /* 產生後的篩選：依測站、測項顯示／隱藏；每張圖可取消勾選。下載全部圖檔與 Excel 圖表只包含「顯示中且勾選」的圖 */
  /* 產生後的篩選列：直接切換要畫的測站、測項與圖的樣式（等於改上面的勾選並重畫）；每張圖左上角可取消勾選，下載全部圖檔與 Excel 圖表時不含 */
  var figOff = {};
  function pickedCharts() { return (lastCharts || []).filter(function (c, i) { return !figOff[i]; }); }
  function boxVals(id) { return Array.prototype.map.call($(id).querySelectorAll('input[type=checkbox]'), function (c) { return { v: c.value, on: c.checked, text: c.closest('label') && /（文字）/.test(c.closest('label').textContent) }; }); }
  function renderFigFilter() {
    var cs = lastCharts || [], md = lastChartOpts && lastChartOpts.mode;
    var el = $('gFilter'); el.hidden = !cs.length;
    var chip = function (kind, o) { return '<button type="button" class="fchip' + (o.on ? ' on' : '') + '" data-fk="' + kind + '" data-fv="' + esc(o.v) + '">' + esc(o.v) + '</button>'; };
    var sts = boxVals('gSts'), its = boxVals('gItems').filter(function (o) { return !o.text; });
    el.innerHTML = '<div class="ff-title">只看部分的圖：點一下切換，圖會立刻重畫（和上面的勾選同步）</div>' +
      '<div class="ff-row"><span class="ff-lab">圖的樣式</span><span class="seg"><button type="button" data-fmode="station" class="' + (md === 'station' ? 'on' : '') + '">每個測站、每個測項各一張</button><button type="button" data-fmode="item" class="' + (md === 'item' ? 'on' : '') + '">每個測項一張，各測站並列</button></span></div>' +
      '<div class="ff-row"><span class="ff-lab">測站</span>' + (sts.length > 1 ? '<button type="button" class="mini-btn" data-fall="gSts">全選</button><button type="button" class="mini-btn" data-fonly="gSts">只選一個…</button>' : '') + sts.map(function (o) { return chip('gSts', o); }).join('') + '</div>' +
      '<div class="ff-row"><span class="ff-lab">測項</span>' + (its.length > 1 ? '<button type="button" class="mini-btn" data-fall="gItems">全選</button><button type="button" class="mini-btn" data-fonly="gItems">只選一個…</button>' : '') + its.map(function (o) { return chip('gItems', o); }).join('') + '</div>' +
      '<div class="ff-sum" id="gFSum"></div>';
    applyFigFilter();
  }
  var fOnly = null; // 「只選一個」模式：下一個點的標籤變成唯一勾選
  function applyFigFilter() {
    var cs = lastCharts || [];
    Array.prototype.forEach.call($('gOut').querySelectorAll('.fig[data-fi]'), function (f) { f.classList.toggle('off', !!figOff[+f.getAttribute('data-fi')]); });
    var n = pickedCharts().length;
    if ($('gFSum')) $('gFSum').innerHTML = (fOnly ? '<b class="warn-text">請點一個' + (fOnly === 'gSts' ? '測站' : '測項') + '，只畫它</b>　' : '') + '共 <b>' + cs.length + '</b> 張圖；下載全部圖檔與 Excel 會包含 <b>' + n + '</b> 張（圖左上角有勾選的）。';
    $('gPngAll').disabled = !n; $('gXlsx').disabled = !n;
    $('gMsg').textContent = '共 ' + cs.length + ' 張圖' + (n < cs.length ? '，已選 ' + n + ' 張' : '');
  }
  function setBox(id, v, on, only) {
    Array.prototype.forEach.call($(id).querySelectorAll('input[type=checkbox]'), function (c) { if (only) c.checked = c.value === v; else if (v == null) c.checked = on && !/（文字）/.test(c.closest('label').textContent); else if (c.value === v) c.checked = on; });
  }
  $('gFilter').addEventListener('click', function (e) {
    var mb = e.target.closest('[data-fmode]');
    if (mb) { if (mb.classList.contains('on')) return; setRadio('gMode', mb.getAttribute('data-fmode')); updatePlan(); $('gGo').click(); return; }
    var b = e.target.closest('[data-fk],[data-fall],[data-fonly]'); if (!b) return;
    if (b.hasAttribute('data-fonly')) { fOnly = fOnly === b.getAttribute('data-fonly') ? null : b.getAttribute('data-fonly'); applyFigFilter(); return; }
    if (b.hasAttribute('data-fall')) { setBox(b.getAttribute('data-fall'), null, true); fOnly = null; }
    else {
      var id = b.getAttribute('data-fk'), v = b.getAttribute('data-fv');
      if (fOnly === id) { setBox(id, v, true, true); fOnly = null; }
      else {
        var on = !b.classList.contains('on');
        if (!on && boxVals(id).filter(function (o) { return o.on; }).length <= 1) return toast('至少要留一個' + (id === 'gSts' ? '測站' : '測項'), true);
        setBox(id, v, on);
      }
    }
    saveForm(); updatePlan(); $('gGo').click();
  });
  $('gOut').addEventListener('change', function (e) {
    var i = e.target.getAttribute('data-fpick'); if (i == null) return;
    if (e.target.checked) delete figOff[+i]; else figOff[+i] = 1;
    applyFigFilter();
  });
  function updatePlan() {
    var ns = checkedVals('gSts').length, ni = checkedVals('gItems').length;
    $('gPlan').textContent = ns && ni ? '目前勾選 ' + ns + ' 個測站、' + ni + ' 個測項' + (radio('gMode') === 'item' ? '，最多 ' + ni + ' 張圖' : '，最多 ' + ns * ni + ' 張圖') : '還沒有勾選測站或測項';
  }
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
    var pk = pickedCharts();
    pk.forEach(function (c) {
      chain = chain.then(function () { return pngBlob(c); }).then(function (bl) {
        var n = pngName(c); if (names[n]) { names[n]++; n = n.replace(/\.png$/, '_' + names[n] + '.png'); } else names[n] = 1;
        zip.file(n, bl);
      });
    });
    chain.then(function () { return zip.generateAsync({ type: 'blob' }); }).then(function (bl) {
      download(safeName(fileBase() + '_趨勢圖') + '.zip', bl); $('gMsg').textContent = '已下載 ' + pk.length + ' 張圖';
    });
  });
  function fileBase() { var p = cur(); return (p && p.code ? p.code + '_' : '') + lastChartOpts.cat + '_' + periodText(lastChartOpts.period).replace(/～/g, '-'); }
  $('gXlsx').addEventListener('click', function () {
    if (!lastCharts) return;
    var o = lastChartOpts, p = cur();
    var tables = Co.reportTables(st.recs, st.stds, { cat: o.cat, period: o.period, stations: o.stations, items: o.tableItems, split: radio('gSplit') });
    $('gMsg').textContent = '產生 Excel 中…';
    XO.build(window.ExcelJS, window.JSZip, { project: p ? (p.code ? p.code + ' ' : '') + p.name : '', cat: o.cat, periodText: periodText(o.period), tables: tables, charts: pickedCharts(), mode: o.mode, std: $('gStd').checked, zero: $('gZero').checked })
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
      if (c && c.list && Date.now() - c.at < 30 * 864e5 && (k !== 'air' || !c.list.length || 'area' in c.list[0])) return c.list;
      return (k === 'air' ? M.airSites(apiJson) : M.riverSites(apiJson)).then(function (list) { S.setMeta('_', cacheKey, { at: Date.now(), list: list }); return list; });
    }).then(function (list) { mSites[k] = list; renderSites(); })
      .catch(function (e) { $('mSites').innerHTML = '<div class="err-box">無法取得測站清單：' + esc(e.message) + '。請確認網路連線；若一直失敗，可能是環境部網址或金鑰變更，請找 AI 協助修改 js/moenv.js。</div>'; });
  }
  /* 測站選擇：仿環境部查詢網的階層下拉（空品：空品區→縣市→測站；河川：縣市→河川→測站），加上快速搜尋與勾選清單。已選測站存在 mSel。 */
  var mSel = { air: [], river: [] }, mComboIdx = -1, mComboHits = [];
  var L_ALL = '';
  function siteExtra(k, s) { return k === 'air' ? [s.county, s.type].filter(Boolean).join('・') : [s.county, s.river].filter(Boolean).join('・') + (s.status === '停用' ? '・停用' : ''); }
  function lv(k, s) { return k === 'air' ? [s.area || '（未分區）', s.county || '（未註明）'] : [s.county || '（未註明）', s.river || '（未註明）']; }
  function siteList(k) {
    var list = mSites[k] || [];
    if (k === 'river' && $('mActive').checked) list = list.filter(function (s) { return s.status !== '停用'; });
    return list;
  }
  function uniq(arr) { var o = {}, r = []; arr.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r.sort(zhSort); }
  function filtered(k, upto) {
    var v1 = $('mL1').value, v2 = $('mL2').value;
    return siteList(k).filter(function (s) { var l = lv(k, s); return (!v1 || l[0] === v1) && (upto < 2 || !v2 || l[1] === v2); });
  }
  function renderSites() {
    var k = mKind(), list = siteList(k);
    $('mL1Lab').textContent = k === 'air' ? '空品區' : '縣市';
    $('mL2Lab').textContent = k === 'air' ? '縣市' : '河川';
    $('mActWrap').style.display = k === 'river' ? '' : 'none';
    var v1 = $('mL1').value, v2 = $('mL2').value;
    var l1 = uniq(list.map(function (s) { return lv(k, s)[0]; }));
    if (v1 && l1.indexOf(v1) < 0) v1 = '';
    $('mL1').innerHTML = opt(L_ALL, k === 'air' ? '全部空品區' : '全部縣市', !v1) + l1.map(function (c) { return opt(c, c, c === v1); }).join('');
    var l2 = uniq(filtered(k, 1).map(function (s) { return lv(k, s)[1]; }));
    if (v2 && l2.indexOf(v2) < 0) v2 = '';
    $('mL2').innerHTML = opt(L_ALL, k === 'air' ? '全部縣市' : '全部河川', !v2) + l2.map(function (c) { return opt(c, c, c === v2); }).join('');
    var show = filtered(k, 2), sel = {}; mSel[k].forEach(function (id) { sel[id] = 1; });
    // 測站下拉：依第二層分組
    var groups = {}; show.forEach(function (s) { var g = lv(k, s)[1]; (groups[g] = groups[g] || []).push(s); });
    $('mL3').innerHTML = '<option value="">— 選擇測站（' + show.length + ' 站）—</option>' + Object.keys(groups).sort(zhSort).map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].sort(function (a, b) { return (a.status === '停用') - (b.status === '停用') || zhSort(a.name, b.name); }).map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.name + (s.status === '停用' ? '（停用）' : '') + (sel[s.id] ? '　✓已選' : '')) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    $('mPickHint').textContent = '共 ' + list.length + ' 站；一次最多查 30 站';
    $('mSites').innerHTML = show.length ? show.slice(0, 800).map(function (s) {
      return '<label class="chk"><input type="checkbox" value="' + esc(s.id) + '"' + (sel[s.id] ? ' checked' : '') + '> ' + esc(s.name) + '<span class="muted small">（' + esc(siteExtra(k, s)) + '）</span></label>';
    }).join('') + (show.length > 800 ? '<div class="muted small">只列前 800 個，請用上面的下拉選單縮小範圍</div>' : '') : '<span class="muted">沒有符合的測站</span>';
    renderChips();
  }
  function siteById(k, id) { return (mSites[k] || []).filter(function (s) { return s.id === id; })[0]; }
  function renderChips() {
    var k = mKind(), ids = mSel[k];
    $('mSelN').textContent = ids.length ? ids.length + ' 站' + (ids.length > 30 ? '（超過 30 站，請移除一些）' : '') : '';
    $('mSelN').className = ids.length > 30 ? 'small err-text' : 'muted small';
    $('mClr').hidden = !ids.length;
    $('mChips').innerHTML = ids.length ? ids.map(function (id) {
      var s = siteById(k, id) || { name: id };
      return '<span class="schip">' + esc(s.name) + ' <span class="sub">' + esc(siteExtra(k, s)) + '</span><button type="button" data-rm="' + esc(id) + '" title="移除" aria-label="移除 ' + esc(s.name) + '">×</button></span>';
    }).join('') : '<span class="muted small">尚未選擇，請用上面的下拉選單或搜尋加入。</span>';
  }
  function addSites(ids) {
    var k = mKind(), n0 = mSel[k].length;
    ids.forEach(function (id) { if (id && mSel[k].indexOf(id) < 0) mSel[k].push(id); });
    var added = mSel[k].length - n0;
    if (mSel[k].length > 30) toast('已選 ' + mSel[k].length + ' 站，一次最多查 30 站，請移除一些', true);
    else if (ids.length > 1) toast(added ? '加入 ' + added + ' 站' : '這些測站都已經加入了');
    renderSites();
  }
  function rmSite(id) { var k = mKind(); mSel[k] = mSel[k].filter(function (x) { return x !== id; }); renderSites(); }
  $('mL1').addEventListener('change', function () { $('mL2').value = ''; renderSites(); });
  $('mL2').addEventListener('change', renderSites);
  $('mActive').addEventListener('change', renderSites);
  $('mL3').addEventListener('change', function () { if (this.value) { addSites([this.value]); } });
  $('mAdd').addEventListener('click', function () { if (!$('mL3').value) return toast('請先在「測站」下拉選單選一個測站', true); addSites([$('mL3').value]); });
  $('mAddAll').addEventListener('click', function () {
    var show = filtered(mKind(), 2);
    if (!$('mL1').value && !$('mL2').value) return toast('請先用前兩個下拉選單縮小範圍，再加入全部', true);
    addSites(show.map(function (s) { return s.id; }));
  });
  $('mClr').addEventListener('click', function () { mSel[mKind()] = []; renderSites(); });
  $('mChips').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) rmSite(b.getAttribute('data-rm')); });
  $('mSites').addEventListener('change', function (e) {
    var c = e.target; if (!c || c.type !== 'checkbox') return;
    if (c.checked) addSites([c.value]); else rmSite(c.value);
  });
  // 快速搜尋（下拉建議）
  function hl(t, q) { var i = q ? t.indexOf(q) : -1; return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(q) + '</mark>' + esc(t.slice(i + q.length)); }
  function comboRender() {
    var k = mKind(), q = $('mQ').value.trim(), box = $('mQList');
    if (!q) { box.hidden = true; mComboHits = []; return; }
    var words = q.split(/\s+/);
    mComboHits = siteList(k).map(function (s) {
      var hay = [s.name, s.river, s.basin, s.county, s.township, s.area, s.type].join(' ');
      if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return null;
      var sc = s.name.indexOf(words[0]) === 0 ? 0 : s.name.indexOf(words[0]) > 0 ? 1 : 2;
      return { s: s, sc: sc + (s.status === '停用' ? 3 : 0) };
    }).filter(Boolean).sort(function (a, b) { return a.sc - b.sc || zhSort(a.s.name, b.s.name); }).slice(0, 60).map(function (h) { return h.s; });
    if (mComboIdx >= mComboHits.length) mComboIdx = mComboHits.length - 1;
    var sel = {}; mSel[k].forEach(function (id) { sel[id] = 1; });
    box.innerHTML = mComboHits.length ? mComboHits.map(function (s, i) {
      return '<div class="combo-item' + (i === mComboIdx ? ' act' : '') + (sel[s.id] ? ' on' : '') + '" data-i="' + i + '"><span>' + hl(s.name, words[0]) + (sel[s.id] ? '　✓已選' : '') + '</span><span class="sub">' + hl(siteExtra(k, s) + (s.township ? '・' + s.township : ''), words[0]) + '</span></div>';
    }).join('') : '<div class="combo-empty">找不到符合「' + esc(q) + '」的測站</div>';
    box.hidden = false;
    var act = box.querySelector('.act'); if (act) act.scrollIntoView({ block: 'nearest' });
  }
  function comboPick(i) { var s = mComboHits[i]; if (!s) return; addSites([s.id]); $('mQ').value = ''; mComboIdx = -1; comboRender(); $('mQ').focus(); }
  $('mQ').addEventListener('input', function () { mComboIdx = 0; comboRender(); });
  $('mQ').addEventListener('focus', comboRender);
  $('mQ').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); mComboIdx = Math.min(mComboIdx + 1, mComboHits.length - 1); comboRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mComboIdx = Math.max(mComboIdx - 1, 0); comboRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); comboPick(mComboIdx < 0 ? 0 : mComboIdx); }
    else if (e.key === 'Escape') { $('mQList').hidden = true; }
  });
  $('mQList').addEventListener('mousedown', function (e) { var it = e.target.closest('[data-i]'); if (it) { e.preventDefault(); comboPick(+it.getAttribute('data-i')); } });
  $('mQ').addEventListener('blur', function () { setTimeout(function () { $('mQList').hidden = true; }, 150); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name=mKind]'), function (r) { r.addEventListener('change', function () { $('mL1').value = ''; $('mL2').value = ''; $('mQ').value = ''; $('mQList').hidden = true; mResult = null; $('mXlsx').disabled = true; $('mCsv').disabled = true; $('mPreview').innerHTML = ''; loadSites(false); }); });
  $('mLoad').addEventListener('click', function () { loadSites(true); });
  $('mGo').addEventListener('click', function () {
    var k = mKind(), ids = mSel[k].slice();
    var from = $('mFrom').value, to = $('mTo').value;
    if (!ids.length) return toast('請至少選擇一個測站', true);
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
      $('mPreview').innerHTML = raw.length ? '<table class="t mv-t"><thead><tr><th>測站</th><th>' + (k === 'air' ? '月份' : '採樣時間') + '</th>' + pv.items.map(function (i) { return '<th>' + esc(i) + '<br><span class="small muted">' + esc(pv.units[i] || '') + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
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
