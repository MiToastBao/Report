# 監測報告趨勢圖產生器

靜態網站（GitHub Pages）。把環境監測的月報、季報、年報（Word .doc／.docx）與檢驗室報告（Excel .xls／.xlsx）匯入，自動判讀各監測類別的數值，整理成報告表格並畫出指定期間的趨勢長條圖（高解析 PNG＋可編輯 Excel）。另有不分計畫的「環境部資料查詢」（空品月值、河川水質）。

- 資料只存在使用者電腦的瀏覽器（IndexedDB），不會上傳。
- 不需要安裝、不需要伺服器：把整個資料夾上傳到 GitHub repository，開啟 GitHub Pages 即可。

## 檔案結構

| 檔案 | 用途 |
|---|---|
| `index.html`、`css/app.css` | 畫面 |
| `js/docread.js` | 讀檔：.docx（XML）、.doc（Word 97-2003 二進位：片段表＋段落屬性，含 sprmPHugePapx）、.xlsx／.xls（SheetJS）→ 表格格線（合併儲存格展開） |
| `js/extract.js` | 表格判讀：日期欄（一般）／日期列（轉置，例如海域）／單次檢驗報告（表單）三種方式；測站、日期、測項、單位、標準值（含適用期間） |
| `js/core.js` | 期間篩選、報告表格、趨勢圖規格、資料異常檢查 |
| `js/chart.js` | 畫布長條圖（文字先量尺寸再排版，不重疊、不裁切）、Excel 原生長條圖 XML、把圖塞進活頁簿 |
| `js/xlsxout.js` | 輸出 Excel：說明、報告表格（每季／每月／整段）、圖表工作表（資料＋標準值設定表＋原生圖） |
| `js/moenv.js` | 環境部開放資料 API |
| `js/store.js` | IndexedDB（資料庫 `rtg-v1`） |
| `js/app.js` | 畫面邏輯 |
| `js/version.js` | 版本紀錄（唯一來源） |
| `vendor/` | ExcelJS 4.4.0、JSZip 3.10.1、SheetJS xlsx 0.20.3（官方版，授權檔在同資料夾） |
| `tests/unit.test.js` | 單元測試（只用虛構資料）：`node --test tests/unit.test.js` |
| `tests/charts.html` | 圖表排版目視檢查頁（長標籤、多測站、分期標準線等） |

## 給維護者（含 AI）：常見維護事項

1. **環境部查不到資料**（網址、資料集代碼、金鑰變更）：只改 `js/moenv.js` 最上面的 `CONFIG`。
   - 空品月值 `AQX_P_08`：https://data.moenv.gov.tw/dataset/detail/aqx_p_08
   - 空品測站 `AQX_P_07`；河川水質 `WQX_P_01`：https://data.moenv.gov.tw/dataset/detail/WQX_P_01 ；河川測點 `WQX_P_06`
   - API：`https://data.moenv.gov.tw/api/v2/{資料集}?format=json&limit=1000&offset=0&api_key={KEY}&filters=欄位,GR,值|欄位,LT,值`（GR＝大於等於、LT＝小於，`|` 送出時編成 `%7C`）
   - 金鑰是環境部操作手冊的範例金鑰；失效時到環境部開放平臺申請後換掉 `CONFIG.KEY`。
   - 一次查太多會被環境部暫時封鎖（HTTP 429／500），`CONFIG.DELAY_MS` 控制請求間隔；畫面限制一次最多 30 站。
2. **某家檢驗室的報告判讀不出來**：先用 `tests/` 的方式把那張表的格線（`RTDoc.readFile` 的輸出）做成虛構資料測試，再改 `js/extract.js`。判讀規則都寫在程式註解裡；不要為單一公司寫死欄位位置。
3. **同義測項**（例如 BOD＝生化需氧量）：`js/app.js` 的 `SYN`。匯入時若計畫裡已有同義名稱，會自動對到既有名稱。
4. **每次修改**：跑 `node --test tests/unit.test.js`；更新 `js/version.js`、`CHANGELOG.md`、`使用說明.html` 頁尾，以及 `index.html` 所有 `?v=` 參數。
5. **不要把真實監測資料放進 repository**（測試一律用虛構資料）。

## 資料模型（IndexedDB `rtg-v1`）

- `projects`：`{id, code, name, created}`
- `recs`：鍵 `pid|類別|測站|日期|備註|測項` → `{raw（報告原樣文字，例如 ND、<0.005）, dl（報告上的日期寫法）, unit, src（來源檔名）, excl（不採用）}`；同鍵重複匯入＝覆蓋，數值不同會記入 `meta.conflicts` 供異常檢查。
- `stds`：鍵 `pid|類別|測站|測項[|起~迄]` → `{text, lines（畫線數值）, from, to（適用期間，空＝不限）, by: auto（報告帶入）|user（自行設定，之後匯入不覆蓋）}`
- `meta`：`pid|m` → 測站／測項別名、略過的測項、已確認的異常、單位、圖表設定、匯入紀錄；`_|airSites`、`_|riverSites` 為環境部測站清單快取（30 天）。

## 第三方元件注意

- SheetJS `xlsx` 0.20.3（官方最新版，2026-09 確認）。SheetJS 已不在 npm 發布新版，官方來源是 https://cdn.sheetjs.com/ ；本檔與官方 `xlsx-0.20.3/package/dist/xlsx.full.min.js` 的 SHA-256 相同：`cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`。**不可以降回 npm 上的 0.18.5**（有原型污染與 ReDoS 弱點）。
- 日後升級：從官方 CDN 下載新版 `xlsx.full.min.js` 取代 `vendor/` 裡的檔案，跑單元測試即可，介面相同。
