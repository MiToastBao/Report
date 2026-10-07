/* 單元測試（只用虛構資料）：node --test tests/unit.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
const JSZip = require('../vendor/jszip.min.js');
const D = require('../js/docread.js');
const X = require('../js/extract.js');
const Co = require('../js/core.js');
const CH = require('../js/chart.js');
const M = require('../js/moenv.js');

function tbl(rows, caption, sheet) { return { caption: caption || '', rows: rows, sheet: sheet }; }

test('民國日期判讀', () => {
  assert.equal(X.parseDate('114.10.28~29').iso, '2025-10-28');
  assert.equal(X.parseDate('114.10.28~29').label, '114.10.28~29');
  assert.equal(X.parseDate('111/09/05~06 施工前').rest, '施工前');
  assert.equal(X.parseDate('115年05月11日09時12分').iso, '2026-05-11');
  assert.equal(X.parseDate('2024-03-01').iso, '2024-03-01');
  assert.equal(X.parseDate('0.019'), null);
  assert.equal(X.parseDate('7.0~8.5'), null);
  assert.equal(X.parseDate('115.13.01'), null);
});

test('數值判讀：ND、<x、科學記號、空白', () => {
  assert.equal(X.parseVal('ND').kind, 'nd');
  assert.equal(X.parseVal('< 0.10').kind, 'lt');
  assert.equal(X.parseVal('1.2×105').num, 120000);
  assert.equal(X.parseVal('1,940').num, 1940);
  assert.equal(X.parseVal('－').kind, 'blank');
  assert.equal(X.parseVal('*').kind, 'blank');
  assert.equal(X.parseVal('西北').kind, 'text');
  assert.equal(X.parseVal('69.8*').num, 69.8);
});

test('標準值文字 → 畫線數值', () => {
  assert.deepEqual(X.stdLines('6.0 ∣ 9.0'), [6, 9]);
  assert.deepEqual(X.stdLines('6.0-9.0'), [6, 9]);
  assert.deepEqual(X.stdLines('≤6.0'), [6]);
  assert.deepEqual(X.stdLines('35/38'), [35, 38]);
  assert.deepEqual(X.stdLines('—'), []);
  assert.deepEqual(X.stdLines('5~9月38度，10~4月35度'), []);
});

test('一般結果表：測站欄、兩層表頭、單位、各站標準列', () => {
  const t = tbl([
    ['測站', '監測日期', '均能音量dB(A)', '均能音量dB(A)', '振動dB'],
    ['測站', '監測日期', 'L日 (6～20)', 'L夜 (22～翌日6)', 'LV10日'],
    ['甲站', '114.01.24~25', '63.9', '56.0', '33.2'],
    ['甲站', '114.02.25~26', '65.7', 'ND', '32.4'],
    ['第二類管制區標準', '第二類管制區標準', '74.0', '67.0', '65'],
    ['乙站', '114.01.24~25', '49.0', '36.7', '30.5'],
    ['第一類管制區標準', '第一類管制區標準', '71.0', '63.0', '65']
  ], '表2-2 環境噪音振動監測結果');
  const ds = X.extractTable(t, {});
  assert.equal(ds.engine, 'rows');
  assert.equal(ds.cat, '噪音振動');
  assert.deepEqual(ds.stations, ['甲站', '乙站']);
  const items = [...new Set(ds.recs.map(r => r.item))];
  assert.deepEqual(items, ['L日', 'L夜', 'LV10日']);
  assert.equal(ds.recs.find(r => r.item === 'L日').unit, 'dB(A)');
  assert.equal(ds.recs.find(r => r.st === '甲站' && r.item === 'L夜' && r.iso === '2025-02-25').raw, 'ND');
  const sA = ds.stds.find(s => s.st === '甲站' && s.item === 'L日'), sB = ds.stds.find(s => s.st === '乙站' && s.item === 'L日');
  assert.deepEqual(sA.lines, [74]); assert.deepEqual(sB.lines, [71]);
});

test('沒有測站欄時，從表名取得測站；施工前／平日假日當備註', () => {
  const t = tbl([
    ['管制區域類別', '管制區域類別', '管制區域類別', '均能音量dB(A)', '均能音量dB(A)'],
    ['第三類', '第三類', '第三類', '日間 (7-20)', '夜間 (23~翌日7)'],
    ['施工前', '111/09/11', '假日', '67.1', '60.8'],
    ['施工中', '112/03/17', '平日', '69.6', '62.4'],
    ['管制標準', '管制標準', '管制標準', '76', '72']
  ], '表2.2-4 虛構社區環境噪音監測結果分析');
  const ds = X.extractTable(t, {});
  assert.deepEqual(ds.stations, ['虛構社區']);
  assert.equal(ds.recs[0].note, '施工前 假日');
  assert.deepEqual([...new Set(ds.recs.map(r => r.item))], ['日間', '夜間']);
  assert.equal(ds.stds.length, 2);
});

test('同一測站有新舊兩列標準 → 各自帶適用期間', () => {
  const t = tbl([
    ['測站', '日期', 'PM10 (μg/m3)', 'PM2.5 (μg/m3)'],
    ['測站', '日期', '日平均值', '24小時值'],
    ['A站', '112/03/29~30', '51', '35'],
    ['A站', '113/02/29~113/03/01', '51', '31'],
    ['113年9月30日前適用之空氣品質標準', '113年9月30日前適用之空氣品質標準', '100', '35'],
    ['113年9月30日後適用之空氣品質標準', '113年9月30日後適用之空氣品質標準', '75', '30']
  ], '表2.1-1 空氣品質監測結果分析');
  const ds = X.extractTable(t, {});
  assert.deepEqual(ds.stations, ['A站']);
  assert.equal(ds.recs.length, 4);
  const pm = ds.stds.filter(s => s.item === 'PM10 日平均值');
  assert.equal(pm.length, 2);
  assert.deepEqual(pm.find(s => s.to === '2024-09-29').lines, [100]);
  assert.deepEqual(pm.find(s => s.from === '2024-09-30').lines, [75]);
  assert.equal(ds.recs[2].iso, '2024-02-29');
});

test('日期橫排（轉置）的海域表：測站＝各欄表頭，標準欄（上下限）', () => {
  const t = tbl([
    ['監測時間', '114.03.20', '114.03.20', '漲潮', '漲潮', '上限值', '下限值'],
    ['檢測項目', '單位', '偵測極限', 'P1', 'P2', '上限值', '下限值'],
    ['銅', 'mg/kg', '0.70', '8.49', '8.82', '157', '50.0'],
    ['鎘', 'mg/kg', '0.06', 'ND', '0.07', '2.49', '0.65']
  ], '表2.6-2 海域底質監測結果分析');
  const ds = X.extractTable(t, {});
  assert.equal(ds.engine, 'transposed');
  assert.equal(ds.cat, '海域底質');
  assert.deepEqual(ds.stations, ['P1', 'P2']);
  assert.equal(ds.recs.find(r => r.st === 'P1' && r.item === '銅').raw, '8.49');
  assert.equal(ds.recs[0].note, '漲潮');
  assert.equal(ds.recs[0].unit, 'mg/kg');
  assert.deepEqual(ds.stds.find(s => s.item === '銅').lines, [157, 50]);
});

test('單次檢驗報告（直式清單）：採樣地點、採樣時間、檢測值、法規值', () => {
  const t = tbl([
    ['水質檢測報告', '', '', '', ''],
    ['報告日期：', '115年05月29日', '', '', ''],
    ['採樣地點：', '虛構放流口', '', '', ''],
    ['採樣時間：', '115年04月21日09時12分', '', '', ''],
    ['樣品編號 檢驗項目', 'XX1150413-01', '偵測極限', '單位', '法規值'],
    ['樣品編號 檢驗項目', '檢測值', '偵測極限', '單位', '法規值'],
    ['水溫', '30.1', '--', '℃', '--'],
    ['pH值', '7.7', '--', '', '6.0~9.0'],
    ['懸浮固體', 'ND', '1.3', 'mg/L', '30'],
    ['以下空白', '', '', '', '']
  ], '01', '01');
  const ds = X.extractTable(t, { sheetBook: true });
  assert.equal(ds.engine, 'form');
  assert.deepEqual(ds.stations, ['虛構放流口']);
  assert.equal(ds.recs[0].iso, '2026-04-21');
  assert.deepEqual(ds.recs.map(r => r.item), ['水溫', 'pH值', '懸浮固體']);
  assert.equal(ds.recs[2].raw, 'ND');
  assert.deepEqual(ds.stds.find(s => s.item === 'pH值').lines, [6, 9]);
});

test('單次檢驗報告（橫式）：跳過逐時列，取統計列與標準列', () => {
  const t = tbl([
    ['空氣品質檢測報告', '', '', ''],
    ['監測地點：虛構國小', '', '', ''],
    ['監測日期：115.05.11', '', '', ''],
    ['監測項目', '', 'SO2', 'CO'],
    ['日期', '小時', 'ppm', 'ppm'],
    ['', '11 ~ 12', '0.002', '0.3'],
    ['', '12 ~ 13', '0.003', '0.4'],
    ['日平均值', '日平均值', '0.002', '0.3'],
    ['最大小時平均值', '最大小時平均值', '0.003', '0.4'],
    ['空氣品質標準', '小時平均值', '0.065', '31']
  ], '虛構(01)', '虛構(01)');
  const ds = X.extractTable(t, { sheetBook: true });
  assert.equal(ds.engine, 'form');
  assert.deepEqual(ds.stations, ['虛構國小']);
  const items = ds.recs.map(r => r.item);
  assert.ok(items.includes('SO2 日平均值') && items.includes('CO 最大小時平均值'));
  assert.ok(!ds.recs.some(r => r.raw === '0.4' && r.item === 'CO 日平均值'));
  assert.deepEqual(ds.stds.find(s => s.item === 'CO 最大小時平均值').lines, [31]);
  assert.ok(!ds.stds.some(s => s.item === 'CO 日平均值'));
});

test('Word 報告裡的方法、品保表（沒有日期）不當成監測結果', () => {
  const t = tbl([['分析項目', '檢測方法', '單位', '偵測極限'], ['懸浮固體', 'NIEA W210', 'mg/L', '0.5'], ['化學需氧量', 'NIEA W516', 'mg/L', '5.7']], '表1.5.4-3 水質分析方法');
  assert.equal(X.extractTable(t, {}), null);
});

test('.docx 表格：水平與垂直合併儲存格展開', async () => {
  const cell = (t, extra) => '<w:tc><w:tcPr>' + (extra || '') + '</w:tcPr><w:p><w:r><w:t>' + t + '</w:t></w:r></w:p></w:tc>';
  const xml = '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>表2-1 本月測試監測結果</w:t></w:r></w:p><w:tbl>' +
    '<w:tr>' + cell('測站', '<w:vMerge w:val="restart"/>') + cell('項目', '<w:gridSpan w:val="2"/>') + '</w:tr>' +
    '<w:tr>' + cell('', '<w:vMerge/>') + cell('A') + cell('B') + '</w:tr>' +
    '<w:tr>' + cell('甲') + cell('1') + cell('2') + '</w:tr></w:tbl><w:p/></w:body></w:document>';
  const zip = new JSZip(); zip.file('word/document.xml', xml);
  const buf = await zip.generateAsync({ type: 'uint8array' });
  const r = await D.readFile('x.docx', buf, { XLSX, JSZip });
  assert.equal(r.kind, 'docx');
  assert.deepEqual(r.tables[0].rows, [['測站', '項目', '項目'], ['測站', 'A', 'B'], ['甲', '1', '2']]);
  assert.equal(r.tables[0].caption, '表2-1 本月測試監測結果');
});

test('.xlsx 工作表：合併儲存格展開', async () => {
  const ws = XLSX.utils.aoa_to_sheet([['測站', '日期', 'Leq'], ['甲', '114.01.08', 60.7], ['', '114.01.24', 58.9]]);
  ws['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '甲');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const r = await D.readFile('x.xlsx', buf, { XLSX, JSZip });
  assert.deepEqual(r.tables[0].rows[2], ['甲', '114.01.24', '58.9']);
  const buf2 = XLSX.write(wb, { type: 'array', bookType: 'xls' });
  const r2 = await D.readFile('x.xls', buf2, { XLSX, JSZip });
  assert.equal(r2.kind, 'xls');
  assert.equal(r2.tables[0].rows[1][2], '60.7');
});

test('不支援的檔案給出原因', async () => {
  await assert.rejects(D.readFile('a.pdf', new Uint8Array([37, 80, 68, 70]), { XLSX, JSZip }), /只支援/);
});

const REC = (st, iso, item, raw, extra) => Object.assign({ pid: 'p', cat: '噪音振動', st, iso, dl: Co.rocDate(iso), note: '', item, unit: 'dB(A)', raw, k: [st, iso, item].join('|') }, extra || {});

test('趨勢圖規格：期間篩選、ND 不畫、每站每測項／各站並列', () => {
  const recs = [REC('甲', '2025-01-10', 'L日', '60'), REC('甲', '2025-02-10', 'L日', 'ND'), REC('乙', '2025-01-12', 'L日', '65'), REC('甲', '2025-05-10', 'L日', '61')];
  const stds = [{ cat: '噪音振動', st: '*', item: 'L日', lines: [74], text: '74' }, { cat: '噪音振動', st: '乙', item: 'L日', lines: [71], text: '71' }];
  const o = { cat: '噪音振動', period: { from: '2025-01', to: '2025-03' }, stations: ['甲', '乙'], items: ['L日'], mode: 'station', xmode: 'orig' };
  const c = Co.buildCharts(recs, stds, o);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].cats, ['114.01.10', '114.02.10']);
  assert.equal(c[0].series[0].values[1].num, null);
  assert.equal(c[0].stdLines[0].v, 74); assert.equal(c[1].stdLines[0].v, 71);
  const c2 = Co.buildCharts(recs, stds, Object.assign({}, o, { mode: 'item', xmode: 'month' }));
  assert.equal(c2.length, 1);
  assert.deepEqual(c2[0].cats, ['114.01', '114.02']);
  assert.equal(c2[0].series.length, 2);
  assert.equal(c2[0].stdLines.length, 2);
});

test('同站同月多筆（月份軸）→ 加序號，不會互相覆蓋', () => {
  const recs = [REC('甲', '2025-01-08', 'Leq', '60'), REC('甲', '2025-01-24', 'Leq', '58')];
  const c = Co.buildCharts(recs, [], { cat: '噪音振動', stations: ['甲'], items: ['Leq'], mode: 'item', xmode: 'month' });
  assert.deepEqual(c[0].cats, ['114.01-1', '114.01-2']);
});

test('報告表格：依季分頁、標準值列', () => {
  const recs = [REC('甲', '2025-01-10', 'L日', '60.0'), REC('甲', '2025-04-10', 'L日', '61.5')];
  const t = Co.reportTables(recs, [{ cat: '噪音振動', st: '*', item: 'L日', lines: [74], text: '74' }], { cat: '噪音振動', stations: ['甲'], items: ['L日'], split: 'quarter' });
  assert.deepEqual(t.map(x => x.name), ['114Q1', '114Q2']);
  assert.equal(t[0].blocks[0].rows[0].vals['L日'], '60.0');
  assert.equal(t[0].blocks[0].std['L日'], '74');
});

test('異常檢查：文字數值、異常高值、名稱相近、單位不一致、數值衝突', () => {
  const recs = [];
  ['01', '02', '03', '04', '05', '06', '07'].forEach((m, i) => recs.push(REC('甲站', '2025-' + m + '-10', 'L日', String(60 + (i % 3)))));
  recs.push(REC('甲站', '2025-08-10', 'L日', '600'));
  recs.push(REC('甲站', '2025-09-10', 'L日', '6O.1'));
  recs.push(REC('甲站外', '2025-01-10', 'L日', '60', { unit: 'dB' }));
  recs.push(REC('P1', '2025-01-10', 'L日', '60')); recs.push(REC('P2', '2025-01-10', 'L日', '60'));
  const an = Co.anomalies(recs, [], { conflicts: [{ k: recs[0].k, cat: '噪音振動', old: '59', raw: '60' }] });
  const types = an.map(a => a.type);
  assert.ok(types.includes('text'));
  assert.ok(an.some(a => a.type === 'outlier' && a.rec.raw === '600'));
  assert.ok(!an.some(a => a.type === 'outlier' && a.rec.raw === '62'));
  assert.ok(an.some(a => a.type === 'similar' && a.names.includes('甲站外')));
  assert.ok(!an.some(a => a.type === 'similar' && a.names.includes('P1')));
  assert.ok(types.includes('unit'));
  assert.ok(types.includes('conflict'));
  const ok = {}; an.forEach(a => { ok[a.id] = 1; });
  assert.equal(Co.anomalies(recs, [], { ok, conflicts: [{ k: recs[0].k, cat: '噪音振動', old: '59', raw: '60' }] }).length, 0);
});

test('Excel 長條圖 XML：標準線引用儲存格、ND 不給數值', () => {
  const spec = { kind: 'station', station: '甲', title: 'Leq', unit: 'dB(A)', cats: ['a', 'b'], series: [{ name: '甲', values: [{ raw: '60', num: 60 }, { raw: 'ND', num: null }] }], stdLines: [{ v: 67 }] };
  const xml = CH.barChartXml({ spec, catRef: "'s'!$A$2:$A$3", series: [{ nameRef: "'s'!$B$1", valRef: "'s'!$B$2:$B$3" }], stdSeries: [{ name: '標準值 67 dB(A)', vals: [67, null], nameRef: "'s'!$Z$4", valRef: "'s'!$AA$4:$AB$4" }, { name: '', spare: true, vals: [null, null], nameRef: "'s'!$Z$5", valRef: "'s'!$AA$5:$AB$5" }] });
  assert.ok(xml.includes("<c:f>'s'!$AA$4:$AB$4</c:f>"));
  assert.ok(xml.includes('<c:legendEntry><c:idx val="2"/><c:delete val="1"/>'), '預留的標準值不放圖例');
  assert.ok(!xml.includes('<c:trendline>'), '有期間的標準線不可用趨勢線延伸到期間外');
  assert.ok(!/<c:pt idx="1"><c:v>0<\/c:v>/.test(xml.split('<c:lineChart>')[0]));
});

test('環境部 API 網址與整理', () => {
  const u = M.url('aqx_p_08', ['siteid,EQ,33', 'monitormonth,GR,202401'], 1000);
  assert.ok(u.includes('offset=1000') && u.includes('%7C') && u.includes('siteid%2CEQ%2C33'));
  assert.equal(M.ymAdd('2025-12', 1), '2026-01');
  const pv = M.pivotAir([{ siteid: '1', sitename: '甲', itemname: '懸浮微粒', itemengname: 'PM10', itemunit: 'μg/m3', monitormonth: '202501', concentration: '30' }, { siteid: '1', sitename: '甲', itemname: '懸浮微粒', itemengname: 'PM10', itemunit: 'μg/m3', monitormonth: '202502', concentration: '40' }]);
  assert.equal(pv.rows.length, 2);
  const q = M.quarterAvg(pv);
  assert.equal(q[0].vals['懸浮微粒(PM10)'], 35); assert.equal(q[0].months, 2); assert.equal(q[0].period, '114Q1');
  assert.ok(M.toCsv([{ a: '1,2', b: 'x' }]).includes('"1,2"'));
});

test('季節性標準（水溫 35/38）與判定方式', () => {
  const v = X.stdSeason('35/38', '水溫');
  assert.deepEqual(v.map(x => [x.text, x.m1, x.m2]), [['38', 5, 9], ['35', 10, 4]]);
  assert.equal(X.stdSeason('35/38', '懸浮固體'), null);
  assert.equal(X.stdMode('6~9'), 'range'); assert.equal(X.stdMode('2以上'), 'min'); assert.equal(X.stdMode('75'), 'max');
  const stds = v.map(x => Object.assign({ cat: '放流水', st: '*', item: '水溫', mode: 'max' }, x));
  assert.equal(Co.stdFor(stds, '放流水', '甲', '水溫', '2026-01-13').text, '35');
  assert.equal(Co.stdFor(stds, '放流水', '甲', '水溫', '2026-07-01').text, '38');
  assert.equal(Co.stdJudge(23.8, Co.stdFor(stds, '放流水', '甲', '水溫', '2026-01-13')), false);
  assert.equal(Co.stdJudge(36, Co.stdFor(stds, '放流水', '甲', '水溫', '2026-01-13')), true);
  assert.equal(Co.stdJudge(36, Co.stdFor(stds, '放流水', '甲', '水溫', '2026-07-13')), false);
  assert.equal(Co.stdJudge(1.5, { lines: [2], mode: 'min' }), true);
  assert.equal(Co.stdJudge(9.5, { lines: [6, 9], text: '6~9' }), true);
  assert.equal(Co.stdJudge(30, { lines: [35, 38], text: '35/38' }), false); // 未指定時不當成範圍
  assert.equal(Co.monthNote({ m1: 10, m2: 4 }), '10～翌年4月');
  // 異常檢查：冬天 23.8℃ 不算超標
  const recs = [3, 4, 5, 8, 11].map(m => ({ pid: 'p', cat: '放流水', st: '甲', iso: '2026-' + String(m).padStart(2, '0') + '-10', dl: '', note: '', item: '水溫', unit: '℃', raw: m === 8 ? '39' : '23.8', k: 'k' + m }));
  const an = Co.anomalies(recs, stds, { ok: {} }).filter(a => a.type === 'over');
  assert.equal(an.length, 1); assert.match(an[0].msg, /38/);
  // 趨勢圖：季節性標準分段畫，各段只在自己的月份
  const c = Co.buildCharts(recs, stds, { cat: '放流水', stations: ['甲'], items: ['水溫'], mode: 'station', xmode: 'orig' });
  const segs = c[0].stdLines.map(l => [l.v, l.i0, l.i1, l.lead]);
  assert.deepEqual(segs, [[38, 2, 3, true], [35, 0, 1, true], [35, 4, 4, false]]);
});

/* ---------- v1.0.6：水質分類與同名測站（虛構資料） ---------- */
function riverTable(caption) {
  return tbl([
    ['位置', '時間', '水溫', 'pH', '溶氧量', '懸浮固體'],
    ['單位', '單位', '℃', '－', 'mg/L', 'mg/L'],
    ['上游', '115.08.03', '29.0', '7.8', '4.7', '159'],
    ['下游', '115.08.03', '29.2', '7.7', '5.0', '128'],
    ['丁類陸域地面水體水質標準', '丁類陸域地面水體水質標準', '－', '6.0 ∣ 9.0', '>2.0', '100']
  ], caption);
}

test('#1 類別以表名為準：表名寫河川水，前後文提到工區放流水也不可以分到放流水', () => {
  const t = riverTable('表2-5 本季(7~9月)虛構溪河川水監測結果');
  t.ctx = ['本季工區放流水各監測項目皆符合標準，河川水超標項目應非受本工程影響'];
  const ds = X.extractTable(t, {});
  assert.equal(ds.cat, '河川水');
  // 表名本身沒有類別線索時，才看前後文
  const t2 = tbl(riverTable('').rows, '表2-4 北岸工區監測結果');
  t2.ctx = ['本月至工區放流口執行放流水採樣監測'];
  assert.equal(X.extractTable(t2, {}).cat, '工區放流水');
});

test('#2 上游／下游這類通用測站名，前面加上表名的河川名，不同河川不會混在一起', () => {
  const a = X.extractTable(riverTable('表2-5 本季(7~9月)虛構溪河川水監測結果'), {});
  const b = X.extractTable(riverTable('表2.5-2 假想溪歷次河川水監測結果'), {});
  assert.deepEqual(a.stations, ['虛構溪上游', '虛構溪下游']);
  assert.deepEqual(b.stations, ['假想溪上游', '假想溪下游']);
  assert.ok(a.recs.every(r => /^虛構溪/.test(r.st)));
  // 標準值仍是整張表共用（之後匯入時逐站存，所以兩條河的標準各自分開）
  assert.ok(a.stds.every(s => s.st === '*' || /^虛構溪/.test(s.st)));
  // 一般測站名不加
  const c = X.extractTable(tbl([
    ['位置', '時間', '水溫', 'pH'], ['單位', '單位', '℃', '－'],
    ['北岸工區', '115.08.03', '29.0', '7.8'], ['北岸工區', '115.09.03', '28.0', '7.6']
  ], '表2-4 虛構溪河川水監測結果'), {});
  assert.deepEqual(c.stations, ['北岸工區']);
});

test('#3 水質類別：地下水、飲用水、海域各自分類', () => {
  assert.equal(X.guessCat('表2-7 監測井地下水監測結果'), '地下水');
  assert.equal(X.guessCat('表2-8 飲用水水質檢測結果'), '飲用水');
  assert.equal(X.guessCat('表2-9 自來水水質檢驗結果'), '飲用水');
  assert.ok(X.CATS.indexOf('飲用水') >= 0);
});

test('#5 標準值寫「>2.0」「＞5.5」是下限（溶氧量），「<」「＜」是上限', () => {
  assert.equal(X.stdMode('>2.0', '溶氧量'), 'min');
  assert.equal(X.stdMode('＞5.5', '溶氧量'), 'min');
  assert.equal(X.stdMode('> 2', '溶氧量'), 'min');
  assert.equal(X.stdMode('<100', '懸浮固體'), 'max');
  assert.equal(X.stdMode('＜25', '懸浮固體'), 'max');
  assert.deepEqual(X.stdLines('>2.0'), [2]);
});

test('#6 只差上／下游、南／北岸的測站不列為「名稱很像」', () => {
  const mk = (st, iso, v) => ({ pid: 'p', cat: '河川水', st, iso, dl: iso, note: '', item: 'pH', unit: '', raw: v, src: 'x', k: st + iso });
  const recs = [mk('大安溪上游', '2026-01-01', '7.1'), mk('大安溪下游', '2026-01-01', '7.2'), mk('北岸工區', '2026-01-01', '7.0'), mk('南岸工區', '2026-01-01', '7.3'), mk('甲測站', '2026-01-01', '7'), mk('甲測站A', '2026-01-01', '7')];
  const sim = Co.anomalies(recs, [], {}).filter(a => a.type === 'similar').map(a => a.names.join('/'));
  assert.ok(!sim.includes('大安溪上游/大安溪下游'), sim.join(','));
  assert.ok(!sim.includes('北岸工區/南岸工區'), sim.join(','));
  assert.ok(sim.includes('甲測站/甲測站A'), '真的很像的仍要提醒：' + sim.join(','));
});

test('#7 「<2.0 (1.1)」＝低於定量極限 2.0（括號是實測參考值）', () => {
  assert.equal(X.parseVal('<2.0 (1.1)').kind, 'lt');
  assert.equal(X.parseVal('＜2.0（1.1）').kind, 'lt');
});

test('#9 測站歸入時同一天數值不同：異常檢查寫出兩站的值與保留哪一個', () => {
  const r = { pid: 'p', cat: '工區放流水', st: '甲站', iso: '2026-01-01', dl: '115.01.01', note: '', item: 'pH', unit: '', raw: '7.0', src: '季報', k: 'p|工區放流水|甲站|2026-01-01||pH' };
  const c = { k: r.k, cat: r.cat, old: '7.5', oldSrc: '月報', raw: '7.0', src: '季報', how: 'merge', from: '乙站', to: '甲站' };
  const a = Co.anomalies([r], [], { conflicts: [c] }).filter(x => x.type === 'conflict');
  assert.equal(a.length, 1);
  assert.match(a[0].msg, /「乙站」歸入「甲站」/);
  assert.match(a[0].msg, /目前用「甲站」的值/);
});

test('#17 兩站在相同日期的數值全部一樣：列入「數值完全一樣的測站」，不再重複列「名稱很像」', () => {
  const mk = (st, iso, item, v) => ({ pid: 'p', cat: '營建噪音振動', st, iso, dl: iso, note: '', item, unit: '', raw: v, src: 'x', k: st + iso + item });
  const recs = [];
  [['2026-09-01', '60.1', '73.2', '36.3'], ['2026-09-21', '60.3', '71.2', '35.2']].forEach(([d, a, b, c]) => {
    ['北岸工區周界', '工區周界(北岸)'].forEach(st => { recs.push(mk(st, d, 'Leq', a), mk(st, d, 'Lmax', b), mk(st, d, 'Lveq10', c)); });
  });
  recs.push(mk('工區周界', '2026-09-01', 'Leq', '60.1'), mk('工區周界', '2026-09-01', 'Lmax', '70'), mk('工區周界', '2026-09-01', 'Lveq10', '36.3'));
  const an = Co.anomalies(recs, [], {});
  const same = an.filter(a => a.type === 'sameval').map(a => a.names.join('/'));
  assert.deepEqual(same, ['北岸工區周界/工區周界(北岸)']);
  assert.match(an.find(a => a.type === 'sameval').msg, /115\.09\.01、115\.09\.21/);
  assert.ok(!an.some(a => a.type === 'similar' && a.names.join('/') === '北岸工區周界/工區周界(北岸)'));
  // 只有 1、2 個數值一樣不提醒（避免巧合）
  const few = [mk('甲', '2026-01-01', 'pH', '7.0'), mk('乙', '2026-01-01', 'pH', '7.0'), mk('甲', '2026-01-01', 'SS', 'ND'), mk('乙', '2026-01-01', 'SS', 'ND')];
  assert.equal(Co.anomalies(few, [], {}).filter(a => a.type === 'sameval').length, 0);
});

test('#18 沒有數值的格子：佔位文字與無測值分類、ND 同站同測項合成一則、等待補上不算異常', () => {
  ['－', '-', '—', '－－', '–'].forEach(s => assert.equal(X.parseVal(s).sym, '破折號', s));
  assert.equal(X.parseVal('/').cls, 'ph'); assert.equal(X.parseVal('＊').sym, '＊'); assert.equal(X.parseVal('無').cls, 'ph');
  assert.equal(X.parseVal('分析中').cls, 'ph'); assert.equal(X.parseVal('待補').cls, 'ph');
  assert.equal(X.parseVal('NA').cls, 'na'); assert.equal(X.parseVal('N/A').sym, 'NA'); assert.equal(X.parseVal('未檢測').sym, '未檢測');
  assert.equal(X.parseVal('ND').kind, 'nd'); assert.equal(X.parseVal('').cls, undefined);
  const mk = (st, iso, item, v, extra) => Object.assign({ pid: 'p', cat: '河川水', st, iso, dl: iso, note: '', item, unit: '', raw: v, src: 'x', k: [st, iso, item].join('|') }, extra || {});
  const recs = [mk('甲', '2026-07-01', 'SS', '分析中'), mk('甲', '2026-07-01', 'pH', 'NA'), mk('甲', '2026-07-01', '氨氮', 'ND'), mk('甲', '2026-08-01', '氨氮', 'ND'), mk('甲', '2026-08-01', 'SS', '/', { pending: 1 }), mk('甲', '2026-08-01', 'pH', '7.1')];
  const an = Co.anomalies(recs, [], {});
  assert.deepEqual(an.filter(a => a.type === 'ph').map(a => a.sym), ['分析中']);
  assert.deepEqual(an.filter(a => a.type === 'na').map(a => a.sym).sort(), ['NA', 'ND']);
  assert.equal(an.find(a => a.sym === 'ND').recs.length, 2);
  const p = an.filter(a => a.type === 'pending'); assert.equal(p.length, 1); assert.equal(p[0].level, 'info');
  const ok = {}; ok[an.find(a => a.sym === 'ND').id] = 1;
  const an2 = Co.anomalies(recs.concat([mk('甲', '2026-09-01', '氨氮', 'ND')]), [], { ok });
  assert.ok(!an2.some(a => a.sym === 'ND'), '確認一次後這站這測項之後的 ND 不再提醒');
});

test('#19 「備註」欄不是監測項目，不匯入', () => {
  const t = tbl([['位置', '時間', 'pH', '懸浮固體', '備註'], ['上游', '115.07.10', '7.8', '12', '－'], ['下游', '115.07.10', '7.7', '15', '雨天'], ['上游', '115.08.10', '7.6', '10', '－']], '表2-5 大安溪河川水監測結果');
  const ds = X.extractTable(t, {});
  assert.ok(ds);
  assert.ok(!ds.recs.some(r => r.item === '備註'), ds.recs.map(r => r.item).join(','));
  assert.equal(ds.recs.length, 6);
});
