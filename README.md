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

## 一、後端（Google Sheets）

程式碼在 `gas/程式碼.js`。用 `sky104857@gmail.com` 這個 Google 帳號。

### 已經做好的部分

- 已建立試算表：<https://docs.google.com/spreadsheets/d/1Mbx4nTImhpsnWYtxZbunk-AbpKXsGMDDJc4OB6c8Ilc/edit>
- 已建立綁定的 Apps Script 專案並 `clasp push` 上去。
- 編輯器：<https://script.google.com/d/16UOMjuzkxmJeJSIuyUyp9iuwonoRWh0MVbGb_bPSEtjvjxrf4XHHXB8L/edit>

### 你要在瀏覽器手動完成（授權需要你本人點）

1. 開上面的**編輯器**連結。
2. 把 `setup()` 裡的 `ADMIN_KEY` 改成自己的金鑰；要用 Turnstile 的話一起把 `TURNSTILE_SECRET` 那行取消註解填入；要寄通知信就填 `NOTIFY_EMAIL`。存檔。
3. 函式選 `setup` → **執行** → 跳授權視窗，全部允許（會建立「訂單明細」分頁、寫入參數）。
4. 右上「部署」→「**管理部署作業**」（clasp 已建了一個）→ 編輯（鉛筆）：
   - 執行身分：**我（sky104857@gmail.com）**
   - 誰可以存取：**任何人**
   - 版本：**新版本** → 部署
   （或直接「新增部署作業」建一個乾淨的，類型「網頁應用程式」，設定同上。）
5. 複製 Web App 網址（結尾 `/exec`）。

> 之後改了 `gas/程式碼.js`：`cd gas && npx @google/clasp@latest push` → 回「管理部署作業」→ 編輯 → 版本「新版本」→ 部署。網址不變。

---

## 二、前端設定

編輯 `config.js`：

```js
window.APP_CONFIG = {
  GAS_URL: "貼上剛剛的 /exec 網址",
  PICKUP_SLOTS: [ "上午 09:00–12:00", "下午 13:00–17:00", "晚上 18:00–20:00" ],
  LEAD_DAYS: 2,
};
```

`admin.html` 的金鑰就是 `setup()` 裡設定的 `ADMIN_KEY`，載入時輸入即可（會存在瀏覽器本機）。

---

## 三、上架 GitHub Pages

```bash
cd ~/Projects/月餅訂購
git add -A && git commit -m "更新設定"
git push
```

GitHub → repo → **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**。
約一分鐘後：

- 訂購頁：`https://sky104857-stack.github.io/mooncake-order/`
- 彙總頁：`https://sky104857-stack.github.io/mooncake-order/admin.html`

---

## 四、Netlify（9/6 額度重置後，選用）

前端不用改。直接把這個 repo 連到 Netlify，發佈目錄設為根目錄即可；`GAS_URL` 一樣走 `config.js`。

---

## 資料表結構（分頁「訂單明細」）

一列 = 一個品項。一張訂單如果點多個組合會拆成多列，共用同一個「訂單編號」。

| 時間戳記 | 訂單編號 | 訂購人 | 電話 | 取貨日期 | 取貨時段 | 內餡 | 加料 | 顆數 | 盒數 | 總顆數 | 備註 |
|---|---|---|---|---|---|---|---|---|---|---|---|

要自己在試算表拉樞紐分析也可以：列＝內餡＋加料，欄＝顆數，值＝加總盒數。
