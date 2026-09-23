/* 版本紀錄（唯一來源）。每次修改：更新這裡、CHANGELOG.md、使用說明.html 頁尾與 index.html 所有 ?v= 參數。 */
(function (root) {
  root.RT_VERSION = '1.0.1';
  root.RT_HISTORY = [
    { v: '1.0.1', d: '2026-09-23', t: '讀 .xls 的 SheetJS 由 0.18.5 升級為官方最新版 0.20.3（修正已知的原型污染與 ReDoS 安全弱點）；判讀結果與前一版完全相同。' },
    { v: '1.0.0', d: '2026-09-23', t: '第一版：計畫管理、匯入 Word（.doc／.docx）與 Excel（.xls／.xlsx）報告並確認、資料檢視、資料異常檢查、測項與標準值、趨勢長條圖（高解析 PNG 與可編輯 Excel，含報告表格）、環境部空品月值與河川水質查詢下載、備份還原。' }
  ];
})(typeof self !== 'undefined' ? self : this);
