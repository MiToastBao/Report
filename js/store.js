/* 監測報告趨勢圖產生器 — 瀏覽器內儲存（IndexedDB）
 * 資料只存在這台電腦的這個瀏覽器，不會上傳到 GitHub。
 * 資料庫 rtg-v1：
 *   projects : {id, code, name, created}
 *   recs     : key k = pid|cat|st|iso|note|item → {k, pid, cat, st, iso, dl, note, item, unit, raw, src, at, excl?}
 *   stds     : key k = pid|cat|st|item（st 為 * 代表全部測站）→ {k, pid, cat, st, item, text, lines, label, by:'auto'|'user'}
 *   meta     : key k = pid|名稱 → {k, v}（別名對照、略過的測項、已確認的異常、匯入紀錄；pid 為 _ 代表不分計畫）
 */
(function (root) {
  'use strict';
  var NAME = 'rtg-v1', VER = 1, db = null;
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('這個瀏覽器不支援 IndexedDB，無法保存資料。')); return; }
      var req = root.indexedDB.open(NAME, VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('recs')) d.createObjectStore('recs', { keyPath: 'k' }).createIndex('pid', 'pid');
        if (!d.objectStoreNames.contains('stds')) d.createObjectStore('stds', { keyPath: 'k' }).createIndex('pid', 'pid');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = function () { db = req.result; db.onversionchange = function () { db.close(); db = null; }; resolve(db); };
      req.onerror = function () { reject(req.error || new Error('無法開啟瀏覽器資料庫')); };
      req.onblocked = function () { reject(new Error('資料庫被本網站的其他分頁占用，請關閉其他分頁後重新整理。')); };
    });
  }
  function tx(stores, mode, fn) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(stores, mode), out;
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error || new Error('資料庫寫入失敗')); };
        t.onabort = function () { reject(t.error || new Error('資料庫寫入被中止（可能是儲存空間不足）')); };
        out = fn(t);
      });
    });
  }
  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function all(store) { return open().then(function (d) { return reqP(d.transaction(store).objectStore(store).getAll()); }); }
  function byPid(store, pid) {
    return open().then(function (d) { return reqP(d.transaction(store).objectStore(store).index('pid').getAll(pid)); });
  }
  var S = {
    open: open,
    recKey: function (r) { return [r.pid, r.cat, r.st, r.iso, r.note || '', r.item].join('|'); },
    stdKey: function (s) { return [s.pid, s.cat, s.st || '*', s.item].join('|') + (s.from || s.to ? '|' + (s.from || '') + '~' + (s.to || '') : '') + (s.m1 ? '|m' + s.m1 + '-' + s.m2 : ''); },
    projects: function () { return all('projects').then(function (a) { return a.sort(function (x, y) { return x.created - y.created; }); }); },
    putProject: function (p) { return tx(['projects'], 'readwrite', function (t) { t.objectStore('projects').put(p); }); },
    deleteProject: function (pid) {
      return Promise.all([byPid('recs', pid), byPid('stds', pid), all('meta')]).then(function (a) {
        return tx(['projects', 'recs', 'stds', 'meta'], 'readwrite', function (t) {
          t.objectStore('projects').delete(pid);
          a[0].forEach(function (r) { t.objectStore('recs').delete(r.k); });
          a[1].forEach(function (r) { t.objectStore('stds').delete(r.k); });
          a[2].forEach(function (m) { if (m.k.indexOf(pid + '|') === 0) t.objectStore('meta').delete(m.k); });
        });
      });
    },
    recs: function (pid) { return byPid('recs', pid); },
    stds: function (pid) { return byPid('stds', pid); },
    putRecs: function (list, delKeys) {
      return tx(['recs'], 'readwrite', function (t) {
        var o = t.objectStore('recs');
        (delKeys || []).forEach(function (k) { o.delete(k); });
        list.forEach(function (r) { o.put(r); });
      });
    },
    delRecs: function (keys) { return tx(['recs'], 'readwrite', function (t) { var o = t.objectStore('recs'); keys.forEach(function (k) { o.delete(k); }); }); },
    putStds: function (list, delKeys) {
      return tx(['stds'], 'readwrite', function (t) {
        var o = t.objectStore('stds');
        (delKeys || []).forEach(function (k) { o.delete(k); });
        list.forEach(function (r) { o.put(r); });
      });
    },
    getMeta: function (pid, name, def) {
      return open().then(function (d) { return reqP(d.transaction('meta').objectStore('meta').get(pid + '|' + name)); })
        .then(function (m) { return m ? m.v : def; });
    },
    setMeta: function (pid, name, v) { return tx(['meta'], 'readwrite', function (t) { t.objectStore('meta').put({ k: pid + '|' + name, v: v }); }); },
    allMeta: function () { return all('meta'); },
    delMeta: function (pid, names) { return tx(['meta'], 'readwrite', function (t) { names.forEach(function (n) { t.objectStore('meta').delete(pid + '|' + n); }); }); },
    exportAll: function (pid) {
      return Promise.all([S.projects(), all('recs'), all('stds'), all('meta')]).then(function (a) {
        var ps = pid ? a[0].filter(function (p) { return p.id === pid; }) : a[0];
        var ids = ps.map(function (p) { return p.id; });
        function mine(x) { return ids.indexOf(x.pid) >= 0; }
        return {
          app: '監測報告趨勢圖產生器', format: 1, exported: new Date().toISOString(),
          projects: ps, recs: a[1].filter(mine), stds: a[2].filter(mine),
          meta: a[3].filter(function (m) { return ids.indexOf(m.k.split('|')[0]) >= 0 || (!pid && m.k.indexOf('_|') === 0); })
        };
      });
    },
    importAll: function (data) {
      if (!data || data.app !== '監測報告趨勢圖產生器') return Promise.reject(new Error('這不是本程式的備份檔'));
      return tx(['projects', 'recs', 'stds', 'meta'], 'readwrite', function (t) {
        (data.projects || []).forEach(function (p) { t.objectStore('projects').put(p); });
        (data.recs || []).forEach(function (r) { t.objectStore('recs').put(r); });
        (data.stds || []).forEach(function (r) { t.objectStore('stds').put(r); });
        (data.meta || []).forEach(function (r) { t.objectStore('meta').put(r); });
      });
    },
    wipe: function () {
      if (db) { db.close(); db = null; }
      return new Promise(function (res, rej) { var r = root.indexedDB.deleteDatabase(NAME); r.onsuccess = function () { res(); }; r.onerror = function () { rej(r.error); }; r.onblocked = function () { res(); }; });
    }
  };
  root.RTStore = S;
})(typeof self !== 'undefined' ? self : this);
