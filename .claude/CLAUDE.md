# CLAUDE.md

本檔提供給後續在此 repo 工作的 Claude Code（claude.ai/code）作為快速上手指南。

## 這是什麼

一份**純瀏覽器端的靜態儀表板**：登入後以使用者的 Google OAuth 權杖直接讀取 BOXFUL 損益 Google Sheet，即時渲染 KPI、規則式中文重點摘要、異常清單，以及約 10 張 ECharts 圖表。**沒有後端、沒有建置流程、沒有套件管理、沒有測試**。所有 UI 文字、程式碼註解與設定皆為繁體中文（zh-Hant）。

## 如何啟動

因為使用 Google Identity Services（GIS）並在瀏覽器端呼叫 Sheets API，**必須從一個已加入 OAuth 白名單的 HTTP 來源提供服務**，`file://` 不會運作。

```bash
python3 -m http.server 8000   # 然後開啟 http://localhost:8000
```

正式部署（例如 GitHub Pages）時，該來源網址必須被加到 GCP OAuth 用戶端的「已授權的 JavaScript 來源」。

在能載入資料前，還必須：`config.js` 內填入真實的 `OAUTH_CLIENT_ID`（預設值只是佔位字串）、登入的 Google 帳號有這份試算表的檢視權限、GCP 專案已啟用 Google Sheets API。這些前置條件與修正方式在 `app.js` 的 `showError` 面板已經對使用者呈現，新增錯誤路徑時請比照該面板的用詞。

## 架構

四個 JS 檔以 `<script>` 標籤在 `index.html` 依序載入，各自掛一個全域物件；**沒有模組系統**：

| 檔案 | 全域 | 職責 |
|---|---|---|
| `config.js` | `window.CONFIG` | 唯一需要手動維護的設定：試算表 ID、OAuth 用戶端 ID、Top-N、分頁清單、異常門檻。 |
| `sheets.js` | `window.Sheets` | 帶 OAuth 權杖呼叫 Sheets API v4，並解析回傳資料。 |
| `charts.js` | `window.Charts` | 所有 ECharts option 產生器、規則式重點摘要、異常偵測。 |
| `app.js` | （IIFE） | 登入、載入、分頁切換、KPI 渲染，以及決定各分頁顯示哪些卡片。 |

外部 runtime 依賴由 `index.html` 直接透過 CDN 載入：ECharts 5.5.0 與 Google Identity Services。

### 試算表 → 資料模型（重要）

`sheets.js` 刻意**不寫死任何列號或欄號**，源試算表插入或搬動列都不能弄壞儀表板。`parseSheet` 分三步走：

1. **月份列**：掃描前 20 列，取「可解析為日期的儲存格最多」的那一列（`toYearMonth` 支援 Sheets 序列數字、ISO 字串、M/D/YYYY、Date 物件），得到 `months: [{col, year, month, label}]`。
2. **關鍵指標列**（`metricRow`）：以正則比對「科目名稱」欄（依序看 C/B/D/A 欄，見 `label()`）。目前下游依賴以下正則作為錨點：
   - `/^total income$/i` → `revenue`
   - `/^total cost of sales$/i` → `cogs`
   - `/^gross profit$/i` → `gp`
   - `/^total operating expenses$/i` → `opex`
   - `/ebi.?t?da/i` 並排除 `margin|%` → `ebitda`（容忍 `EBIDA` 這種拼錯）
   - `/^\s*orders?\b/i` 且要求有資料 → `orders`（只有 B2B 分頁會有）
3. **區段明細清單**（`sectionItems`）：擷取兩個標籤列「之間」且全年不為 0 的列，用來取得 `incomeItems`、`cogsItems`、`opexItems`。

**如果源試算表的錨點標籤被改名，就必須同步更新這裡的正則**——它們就是這個系統的 schema。Sheets API 是以 `valueRenderOption=UNFORMATTED_VALUE` 呼叫的，日期會回傳成序列數字，調整 `toYearMonth` 時請留意。

### 分頁 ↔ 試算表工作表

`CONFIG.SEGMENTS`（`total`、`b2b`、`b2c`）綁定的是試算表的**工作表順序**，不是名稱。`Sheets.fetchAll` 會依 `properties.index` 排序，取前三個工作表，並依陣列位置對映。如果日後新增一個分頁，需要同時擴充 `SEGMENTS` **並且**放寬 `sheets.js` 內的 `.slice(0, 3)`。

### 渲染流程

`app.js` 的 `render()` 依照目前分頁決定哪些卡片顯示：

- 所有分頁都顯示：`chart-pnl`、`chart-rates`、`chart-expratio`、`chart-costmix`。
- 只有非合計（`b2b`/`b2c`）顯示：`chart-revcost`、`chart-gpexp`。
- 只有 B2B（有訂單數）顯示：`chart-perorder`；另外只有當某個 income item 名稱符合 `/waaship/i` 時才顯示 `chart-waaship`。
- 只有合計顯示：`chart-contrib`（2B vs 2C 比較，會同時讀三個分頁的解析結果）。

每張圖對應 `index.html` 內一個 `<section class="hidden">` 卡片，由 `show(cardId, chartId, visible, optionFn)` 切換可見度並呼叫對應的 `Charts.*Option` builder。**新增一張圖表**需要三步：(1) 在 `index.html` 新增 `<section>`、(2) 在 `charts.js` 新增 option builder、(3) 在 `render()` 內新增 `show()` 呼叫。

ECharts 實例快取於 `app.js` 的 `instances` 物件，透過 `setOption(..., true)` 重複使用；並且會在 window resize 時、以及每次 render 後延遲 30ms 統一 resize 一次。

### 登入流程

直接使用 **Google Identity Services**（`google.accounts.oauth2.initTokenClient`），不使用 `gapi.client`。權杖只放在記憶體中的 `gtoken`，每次呼叫 Sheets API 時透過 `Authorization: Bearer` 帶入。`Sheets.apiGet` 遇到 401 視為權杖過期並丟出 `{code: 401}`，由 `app.js` 攔截後交給 `handleAuthError()` 決定續發或重新登入（見下）。scope 為 `openid email https://www.googleapis.com/auth/spreadsheets.readonly` — 後兩者分別用來拿使用者 email（做應用層白名單）與唯讀讀取試算表。

### 重整頁面不掉線（Token 快取 + 7 天視窗）

Google 給的 access token 本身只活約 1 小時。為了讓使用者「重整頁面不用重新登入」，實作採**兩層機制**：

**主機制：`TOKEN_KEY` — access token 快取（`localStorage`）**

- 存 `{ token, expiresAt }` 到 `localStorage["boxful_gtoken"]`。
- `initAuth()` 頁面載入時**優先讀快取**：只要 token 未過期（有 30 秒 skew 緩衝）就直接用，**根本不打 Google**。這是重整不掉線的核心 —— 不依賴任何瀏覽器策略、不用第三方 Cookie、不用使用者手勢。
- 為什麼可以存 token：本站為純靜態頁、無使用者輸入、無第三方腳本，XSS 面幾乎為零；scope 只有唯讀 Sheets + 使用者 email，實務風險可接受。

**加碼機制：`SESSION_KEY` — 7 天視窗戳（`localStorage`）**

- `SESSION_KEY = "boxful_authz_expires_at"`，`SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000`。只存過期時間戳，不存 token 本身。
- Token 過期（或首次進站沒有快取）時，如果 7 天視窗還有效，就試 GIS 的靜默續發（`requestAccessToken({ prompt: "" })`）取新 token；靜默續發失敗才 fallback 到手動登入畫面。
- 靜默續發只是**加碼**、不是必要路徑：現代瀏覽器封鎖第三方 Cookie、或頁面自動呼叫缺乏使用者手勢時，靜默續發常常會失敗。所以絕對不能只靠它。

**流程**

- `initAuth()` 建完 `tokenClient` 後，依序：**有效 token 快取** → 直接用；否則 **`sessionValid()`** → 試靜默續發；再否則 → `showLogin()`。
- Token callback 成功時同時 `writeCachedToken()` 與 `markSession()`，把兩層都更新。
- `handleAuthError()` 是 401 的統一處理：先 `clearCachedToken()`，再看 `sessionValid()` 決定靜默續發或 `showLogin`。`load()` 與 `authorizeAndLoad()` 的兩個 `catch` 都走這條路徑，不會直接 `showLogin`。
- `error_callback` 觸發時只 `clearCachedToken()`；**不動 session 視窗**，避免「一次靜默續發失敗就把 7 天視窗砍掉、之後每次重整都要重登」的迴圈。
- `showUnauthorized` 的「改用其他帳號登入」按鈕會 `clearCachedToken() + clearSession()`，並用 `prompt: "consent"` 強制彈選帳號視窗。
- `localStorage` 被瀏覽器禁用時（隱私模式的某些設定），各 setter 的 `try/catch` 會靜默吞掉例外 — 只是退化為單次登入，其他流程照跑。

### 應用層權限白名單（重要）

除了 Google Sheet 本身的分享權限之外，儀表板還有第二層 email 白名單，用於「試算表分享權限開得比較寬（例如整個公司網域可讀），但只有名單上的人可以看到儀表板」的情境。

- 白名單來源：試算表內一張分頁，分頁名由 `CONFIG.AUTHZ_SHEET_TITLE`（預設 `"權限管理"`）指定。`Sheets.fetchAllowedEmails()` 讀進這張 sheet 的所有儲存格，用 email 正則（`/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/`）抽出所有 email 組成 `Set` — 也就是說 email 放在哪一欄、要不要 header 都沒關係。
- 比對時機：`app.js` 的 `authorizeAndLoad()` 在拿到 OAuth token 之後、`load()` 之前執行。以 `Promise.all([fetchUserEmail(), fetchAllowedEmails()])` 平行取得使用者 email 與白名單，`email` 不在 `Set` 內就走 `showUnauthorized(email)` 分支、不進主資料抓取。
- 若 `AUTHZ_SHEET_TITLE` 是空字串或該分頁不存在：前者代表停用白名單（`fetchAllowedEmails` 回 `null`，一律放行）；後者 API 會回 400，`fetchAllowedEmails` 轉成 `{code: "AUTHZ_SHEET_MISSING"}` 的錯誤讓 `showError` 呈現。
- `fetchAll` 的三張主表（`total`/`b2b`/`b2c`）取用時會自動把名為 `AUTHZ_SHEET_TITLE` 的分頁**過濾掉**，所以「權限管理」sheet 放在試算表的第幾個位置都不影響主資料的抓取順序。
- Refresh 按鈕綁的是 `authorizeAndLoad` 而不是 `load`，讓 owner 修改白名單後使用者按重新整理可以立刻套用最新名單。

### Top-N / Others 慣例

`Charts.topN(items, monthsLen, n)` 依年度加總排序取前 N 項，其餘全部併入名為「Others」的桶子。呼叫端需要**檢查 `name === "Others"`** 並套用中性灰色（`OTHERS`）而不是分類色盤（`CAT`）。這個模式在 `revCostOption`、`gpExpOption`、`costMix100Option` 都有——新增堆疊圖時請沿用。

### 折舊/攤銷從費用圖表中排除

`CONFIG.EXCLUDE_EXPENSE_PREFIX`（預設 `["Depreciation", "Amortization"]`）驅動 `excludedExpense(name)` 過濾器，被 `gpExpOption`、`summary` 內的「費用最大變動」`biggestMover`，以及 EBITDA bridge 使用。這是刻意的：以 EBITDA 為視角的圖表不該把 D&A 的波動一起帶進來。新增費用相關圖表時，請明確決定是否要套用這個過濾器。

### 異常偵測

`Charts.anomalies(d)` 掃描收入、毛利，以及所有成本/費用明細，只針對**當年度**每個月，看是否偏離「前 `CONFIG.ANOMALY.baselineWindow` 個月的中位數」達到相對門檻（`relThreshold`）**且**絕對門檻（`absFloor`）。此外會把「基準為正、當月變負」偵測為符號翻轉，標成 `dir: "flip"` 並註記「疑似計提沖回/重分類」。結果先依金額變動排序取前 N 項，再重新依月份新→舊排序後回傳。

## 修改慣例

- **UI 文案為繁體中文。** 新增對使用者呈現的字串時，語氣與用詞請對齊既有字串（例如 `重點摘要`、`本期需說明`、`資料檢核`）。
- **變數宣告一律使用 `const` / `let`，不要使用 `var`。** 預設用 `const`；只有需要重新指派才用 `let`。既有程式碼中殘留的 `var` 屬於歷史包袱，新增或修改到的區塊請一併換成 `const` / `let`。
- **維持無模組、無 build 的檔案骨架。** 保留 IIFE + `window.*` 全域的載入方式，不要引入 ES modules 或打包工具（這是為了讓 `index.html` 可以直接以 `<script>` 依序載入）。
- **設定優先（Config-first）。** 只要是業務端可能想要調整的參數（門檻、色盤區段、要排除的科目前綴），一律放到 `config.js`，不要散落在圖表程式碼內。
- **不要寫死列號或欄號。** 需要新的欄位就在 `sheets.js` 的 `metricRow` / `sectionItems` 內新增一條正則，讓解析器去定位。
