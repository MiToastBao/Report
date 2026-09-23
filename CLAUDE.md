# 監測報告趨勢圖產生器：給 AI 維護者的說明

請先讀 `README.md` 的「給維護者（含 AI）：常見維護事項」。

- 環境部資料查詢（⑦ 分頁）查不到、網址或金鑰變更：只改 `js/moenv.js` 的 `CONFIG`（空品月值 AQX_P_08、空品測站 AQX_P_07、河川水質 WQX_P_01、河川測點 WQX_P_06）。
- 報告判讀規則在 `js/extract.js`；不要寫死某家公司的欄位位置，改完用虛構資料補測試。
- 每次修改：跑 `node --test tests/unit.test.js`；更新 `js/version.js`、`CHANGELOG.md`、`使用說明.html` 頁尾，以及 `index.html` 所有 `?v=` 參數。
- 使用者是中文使用者；不要把真實監測資料放進 repository。
