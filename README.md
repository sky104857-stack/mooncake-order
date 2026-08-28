# 🥮 月餅訂購

手工月餅線上預訂頁面。純靜態前端（GitHub Pages）＋ Google Apps Script / Google Sheets 後端。

- **訂購頁**：`index.html` — 客人選內餡、加料、顆數、盒數、取貨日期時段，可一次點多個組合。
- **彙總 / 製作單**：`admin.html` — 輸入管理金鑰後，依取貨日期把所有訂單彙總，依「內餡 × 加料 × 顆數」統計盒數與顆數，方便備料製作，可列印。

選項：
| 內餡 | 加料 | 顆數/盒 |
|---|---|---|
| 紅豆、芋頭、綠豆 | 原味、鹹蛋黃、麻薯 | 六顆、十二顆 |

> 目前版本不含價格計算。

## 防機器人 / 防灌單 — ✅ 全部生效

公開網站，多層防護（`gas/程式碼.js`），已端對端測過：

| 層 | 作用 | 狀態 |
|---|---|---|
| Cloudflare Turnstile 驗證碼 | 主力，擋自動化腳本 | ✅ 已啟用（Managed 模式，前端 + 後端都驗） |
| 蜜罐欄位 `website` | 機器人會填、真人看不到 | ✅ |
| 填表時間 < 3 秒即擋 | 擋秒送腳本 | ✅ |
| 同電話 30 秒冷卻 | 擋連續灌單 | ✅ |
| 相同內容訂單 10 分鐘去重 | 擋重複送出 | ✅ |
| 全站每分鐘 20 筆上限 | 攻擊時自動節流 | ✅（`GLOBAL_PER_MIN` 可改） |
| 每日總量上限（預設 500） | 爆量保險絲 | ✅（Script Property `DAILY_CAP` 可改） |
| 每筆訂單寄信通知 | 即時察覺異常 | ✅（寄到 `NOTIFY_EMAIL`） |

Turnstile widget：Site Key 在 `config.js` 的 `TURNSTILE_SITE_KEY`，Secret 在 Apps Script → 專案設定 → 指令碼屬性 `TURNSTILE_SECRET`。
> ⚠️ 驗證碼容器的 `id` 是 `ts-widget`，**不要**改回 `turnstile`（會跟 `window.turnstile` 撞名，widget 就不會出現）。

---

## 一、後端（Google Sheets）— ✅ 已部署完成

程式碼在 `gas/程式碼.js`。

- 試算表：<https://docs.google.com/spreadsheets/d/1Mbx4nTImhpsnWYtxZbunk-AbpKXsGMDDJc4OB6c8Ilc/edit>
- Apps Script 編輯器：<https://script.google.com/d/16UOMjuzkxmJeJSIuyUyp9iuwonoRWh0MVbGb_bPSEtjvjxrf4XHHXB8L/edit>
- Web App 已部署（執行身分＝我、存取＝任何人），網址已填進 `config.js`。
- `setup()` 已執行：「訂單明細」分頁已建立，`ADMIN_KEY`、`NOTIFY_EMAIL`、`TURNSTILE_SECRET` 已寫入 Script Properties。

### 管理金鑰（`ADMIN_KEY`）

- 用途：開 `admin.html` 彙總 / 製作單頁時要輸入的密碼（會存在瀏覽器本機，不用每次打）。
- **這是一個公開 repo，金鑰的實際值不寫在程式碼或這份說明裡**，只存在 Apps Script 的 Script Properties。
- 查看目前的值 / 更改：
  編輯器 → 左下角齒輪「**專案設定**」→ 捲到「**指令碼屬性**」→ 編輯 `ADMIN_KEY` → 儲存。
  改完**立即生效**（後端即時讀取，不用重新部署）；正在用舊金鑰登入過的瀏覽器要重新輸入新的。
- ⚠️ 彙總頁網址是公開的，金鑰請用**夠長、難猜**的字串（純數字很快會被試出來）。

### 之後改了 `gas/程式碼.js` 要怎麼更新

```bash
cd ~/Projects/月餅訂購/gas && npx @google/clasp@latest push
```

再到編輯器：部署 → 管理部署作業 → 編輯（鉛筆）→ 版本「建立新版本」→ 部署。**網址不變**。

---

## 二、前端設定 — ✅ 已設定

`config.js` 的 `GAS_URL`、`TURNSTILE_SITE_KEY` 已填好。`admin.html` 要輸入的管理金鑰見上面〈管理金鑰〉一節。

要改取貨時段 / 最早可預約天數，改 `config.js` 的 `PICKUP_SLOTS`、`LEAD_DAYS` 再 `git push`。

---

## 三、GitHub Pages — ✅ 已上線

- 訂購頁：<https://sky104857-stack.github.io/mooncake-order/>
- 彙總頁：<https://sky104857-stack.github.io/mooncake-order/admin.html>

改完程式碼後 `git push` 就會自動重新發佈（約 1 分鐘）。

---

## 四、Netlify（9/6 額度重置後，選用）

前端不用改。直接把這個 repo 連到 Netlify，發佈目錄設為根目錄即可；`GAS_URL` 一樣走 `config.js`。

---

## 資料表結構（分頁「訂單明細」）

一列 = 一個品項。一張訂單如果點多個組合會拆成多列，共用同一個「訂單編號」。

| 時間戳記 | 訂單編號 | 訂購人 | 電話 | 取貨日期 | 取貨時段 | 內餡 | 加料 | 顆數 | 盒數 | 總顆數 | 備註 |
|---|---|---|---|---|---|---|---|---|---|---|---|

要自己在試算表拉樞紐分析也可以：列＝內餡＋加料，欄＝顆數，值＝加總盒數。
