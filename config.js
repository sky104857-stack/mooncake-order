// 前端設定 — 部署完 Apps Script Web App 後把網址填進來,再 push 到 GitHub。
window.APP_CONFIG = {
  // Apps Script 部署後的「網頁應用程式」網址,結尾是 /exec
  GAS_URL: "",

  // 取貨時段選項(可自行增減 / 改文字)
  PICKUP_SLOTS: [
    "上午 09:00–12:00",
    "下午 13:00–17:00",
    "晚上 18:00–20:00",
  ],

  // 最早可預約的取貨日(相對今天的天數,例如 2 = 後天起)
  LEAD_DAYS: 2,
};
