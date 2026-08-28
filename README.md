# 🥮 月餅訂購

手工月餅線上預訂頁面。純靜態前端（GitHub Pages）＋ Google Apps Script / Google Sheets 後端。

- **訂購頁**：`index.html` — 客人選內餡、加料、顆數、盒數、取貨日期時段，可一次點多個組合。
- **彙總 / 製作單**：`admin.html` — 輸入管理金鑰後，依取貨日期把所有訂單彙總，依「內餡 × 加料 × 顆數」統計盒數與顆數，方便備料製作，可列印。

選項：
| 內餡 | 加料 | 顆數/盒 |
|---|---|---|
| 紅豆、芋頭、綠豆 | 原味、鹹蛋黃、麻薯 | 六顆、十二顆 |

> 目前版本不含價格計算。

## 防機器人 / 防灌單

公開網站，已內建多層防護（`gas/程式碼.js`）：

| 層 | 作用 | 需設定 |
|---|---|---|
| Cloudflare Turnstile 驗證碼 | 主力，擋自動化腳本 | Site Key（`config.js`）+ Secret（Script Property `TURNSTILE_SECRET`） |
| 蜜罐欄位 `website` | 機器人會填、真人看不到 | 免 |
| 填表時間 < 3 秒即擋 | 擋秒送腳本 | 免 |
| 同電話 30 秒冷卻 | 擋連續灌單 | 免 |
| 相同內容訂單 10 分鐘去重 | 擋重複送出 | 免 |
| 全站每分鐘 20 筆上限 | 攻擊時自動節流 | 免（可改參數） |
| 每日總量上限（預設 500） | 爆量保險絲 | 可改 Script Property `DAILY_CAP` |
| 每筆訂單寄信通知 | 即時察覺異常 | Script Property `NOTIFY_EMAIL` |

**Turnstile 設定（建議做）：**
1. <https://dash.cloudflare.com> → Turnstile → Add site，網域填 `sky104857-stack.github.io`。
2. Site Key 貼進 `config.js` 的 `TURNSTILE_SITE_KEY`。
3. Secret Key 設進 Apps Script：`setup()` 裡取消 `TURNSTILE_SECRET` 那行的註解並填入，或到 專案設定 → Script Properties 手動加。
4. `clasp push` + 重新部署新版本、`git push`。

> 沒設 Turnstile 也能運作，其餘各層仍有效，只是少了最強的一道。

---

## 一、後端（Google Sheets）— ✅ 已部署完成

程式碼在 `gas/程式碼.js`。

- 試算表：<https://docs.google.com/spreadsheets/d/1Mbx4nTImhpsnWYtxZbunk-AbpKXsGMDDJc4OB6c8Ilc/edit>
- Apps Script 編輯器：<https://script.google.com/d/16UOMjuzkxmJeJSIuyUyp9iuwonoRWh0MVbGb_bPSEtjvjxrf4XHHXB8L/edit>
- Web App 已部署（執行身分＝我、存取＝任何人），網址已填進 `config.js`。
- `setup()` 已執行：「訂單明細」分頁已建立，`ADMIN_KEY`、`NOTIFY_EMAIL` 已寫入 Script Properties。
- **金鑰不放在這個公開 repo**，存在 Apps Script 的 Script Properties 裡。
  要查或改：編輯器 → 左下齒輪「專案設定」→ 指令碼屬性。

### 之後改了 `gas/程式碼.js` 要怎麼更新

```bash
cd ~/Projects/月餅訂購/gas && npx @google/clasp@latest push
```

再到編輯器：部署 → 管理部署作業 → 編輯（鉛筆）→ 版本「建立新版本」→ 部署。**網址不變**。

### 加上 Cloudflare Turnstile（建議）

1. <https://dash.cloudflare.com> → Turnstile → Add site，網域 `sky104857-stack.github.io`。
2. Site Key → 填 `config.js` 的 `TURNSTILE_SITE_KEY`，`git push`。
3. Secret Key → 編輯器 → 專案設定 → 指令碼屬性 → 新增 `TURNSTILE_SECRET`。

---

## 二、前端設定 — ✅ 已設定

`config.js` 的 `GAS_URL` 已填好。`admin.html` 載入時要輸入的金鑰＝ Script Property `ADMIN_KEY`（存在瀏覽器本機，不用每次打）。

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
