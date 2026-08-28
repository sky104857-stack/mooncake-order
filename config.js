// 前端設定 — 部署完 Apps Script Web App 後把網址填進來,再 push 到 GitHub。
window.APP_CONFIG = {
  // Apps Script 部署後的「網頁應用程式」網址,結尾是 /exec
  GAS_URL: "https://script.google.com/macros/s/AKfycbxYYOnAxLgpePSEc3ApO1IrF7Y3dPsD2BAfhkPJFpP3A-ZHQ9MtaCSel5Euxfov4_xo/exec",

  // Cloudflare Turnstile 的 Site Key(公開網站防機器人用)。
  // 到 https://dash.cloudflare.com → Turnstile → 新增網站,網域填 sky104857-stack.github.io
  // 把 Site Key 貼這裡,Secret Key 設進 Apps Script 的 Script Property「TURNSTILE_SECRET」。
  // 留空則不顯示驗證碼(仍有蜜罐 / 填表時間 / 頻率限制等其他防護)。
  TURNSTILE_SITE_KEY: "",

  // 取貨時段選項(可自行增減 / 改文字)
  PICKUP_SLOTS: [
    "上午 09:00–12:00",
    "下午 13:00–17:00",
    "晚上 18:00–20:00",
  ],

  // 最早可預約的取貨日(相對今天的天數,例如 2 = 後天起)
  LEAD_DAYS: 2,
};
