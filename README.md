# 🥮 月餅訂購

手工月餅線上預訂頁面。純靜態前端（GitHub Pages）＋ Google Apps Script / Google Sheets 後端。

- **訂購頁**：`index.html` — 客人選內餡、加料、顆數、盒數、取貨日期時段，可一次點多個組合。
- **彙總 / 製作單**：`admin.html` — 輸入管理金鑰後，依取貨日期把所有訂單彙總，依「內餡 × 加料 × 顆數」統計盒數與顆數，方便備料製作，可列印。

選項：
| 內餡 | 加料 | 顆數/盒 |
|---|---|---|
| 紅豆、芋頭、綠豆 | 原味、鹹蛋黃、麻薯 | 六顆、十二顆 |

> 目前版本不含價格計算。

---

## 一、後端（Google Sheets）

程式碼在 `gas/程式碼.js`。用 `sky104857@gmail.com` 這個 Google 帳號。

### 用 clasp 推送

```bash
cd ~/Projects/月餅訂購/gas
npx @google/clasp@latest create --type sheets --title "月餅訂購"
npx @google/clasp@latest push
```

`create` 會建立一份新的 Google 試算表 + 綁定的 Apps Script 專案。

### 首次授權 + 部署為 Web App

1. `npx @google/clasp@latest open` 開啟 Apps Script 編輯器。
2. 先把 `setup()` 裡的 `ADMIN_KEY` 字串改成自己的金鑰，存檔。
3. 選 `setup` 函式 → 執行一次 → 跳出授權視窗，全部允許（會建立「訂單明細」分頁並寫入金鑰）。
4. 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」：
   - 說明：隨意
   - 執行身分：**我（sky104857@gmail.com）**
   - 誰可以存取：**任何人**
5. 複製產生的 Web App 網址（結尾 `/exec`）。

> 之後改了 `gas/程式碼.js`：`clasp push` 後，到「部署」→「管理部署作業」→ 編輯（鉛筆）→ 版本選「新版本」→ 部署。網址不變。

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
