// 月餅訂購 — Google Sheets 後端 (Google Apps Script Web App)
// ---------------------------------------------------------------------------
// 綁定的試算表會自動建立一個工作表(分頁)叫「訂單明細」,一列 = 一個品項,欄位依序:
//   時間戳記 | 訂單編號 | 訂購人 | 電話 | 取貨日期 | 取貨時段 |
//   內餡 | 加料 | 顆數 | 盒數 | 總顆數 | 備註
// 一張訂單如果點了多個組合,就會拆成多列,共用同一個「訂單編號」。
//
// 防機器人 / 防灌單(公開網站):
//   1) Cloudflare Turnstile 驗證碼(主力,免費) — 需設 Script Property TURNSTILE_SECRET
//   2) 蜜罐欄位 website — 有填 = 機器人
//   3) 填表時間 elapsedMs — 少於 3 秒 = 機器人
//   4) 同電話 30 秒內只能送一次;完全相同的訂單 10 分鐘內視為重複
//   5) 全站每分鐘上限 + 每日總量上限(超過就擋,避免爆量)
//   6) 可設 NOTIFY_EMAIL,每筆成功訂單寄信通知
//
// 部署步驟見專案 README.md。
// ---------------------------------------------------------------------------

const SHEET_NAME = "訂單明細";
const HEADERS = [
  "時間戳記", "訂單編號", "訂購人", "電話", "取貨日期", "取貨時段",
  "內餡", "加料", "顆數", "盒數", "總顆數", "備註",
];

const FILLINGS = ["紅豆", "芋頭", "綠豆"];
const TOPPINGS = ["原味", "鹹蛋黃", "麻薯"];
const PACK_SIZES = [6, 12];

// 防灌單參數(可自行調整)
const MIN_FILL_MS = 3000;          // 填表至少要 3 秒
const PER_PHONE_COOLDOWN_S = 30;   // 同一支電話兩筆訂單間隔
const DUP_WINDOW_S = 600;          // 相同內容訂單去重視窗(10 分鐘)
const GLOBAL_PER_MIN = 20;         // 全站每分鐘最多幾筆(超過視為攻擊)
const DAILY_CAP_DEFAULT = 500;     // 每日總筆數上限
const MAX_ITEMS = 30;              // 一張訂單最多幾個品項
const MAX_BOXES_PER_LINE = 200;    // 單一品項最多盒數

// ---------------------------------------------------------------------------

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function makeOrderId_() {
  const stamp = Utilities.formatDate(new Date(), "Asia/Taipei", "yyMMdd-HHmmss");
  return "M" + stamp + "-" + Math.floor(Math.random() * 900 + 100);
}

function digitsOnly_(s) {
  return String(s || "").replace(/[^0-9]/g, "");
}

// ---- Turnstile 驗證 ------------------------------------------------------

function verifyTurnstile_(token) {
  const secret = PropertiesService.getScriptProperties().getProperty("TURNSTILE_SECRET");
  if (!secret) return { ok: true, skipped: true }; // 沒設 secret 就跳過(建議一定要設)
  if (!token) return { ok: false, error: "請完成人機驗證" };
  try {
    const resp = UrlFetchApp.fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "post",
        payload: { secret: secret, response: token },
        muteHttpExceptions: true,
      }
    );
    const body = JSON.parse(resp.getContentText() || "{}");
    return body.success ? { ok: true } : { ok: false, error: "人機驗證未通過,請重試" };
  } catch (err) {
    return { ok: false, error: "人機驗證服務異常,請稍後再試" };
  }
}

// ---- 送出訂單 -----------------------------------------------------------

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);

    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonResponse_({ ok: false, error: "格式錯誤" });
    }

    // 1) 蜜罐:正常使用者看不到 website 欄位
    if (String(body.website || "").trim() !== "") {
      return jsonResponse_({ ok: false, error: "送出失敗" });
    }

    // 2) 填表時間過快
    const elapsed = Number(body.elapsedMs || 0);
    if (!(elapsed >= MIN_FILL_MS)) {
      return jsonResponse_({ ok: false, error: "請確認資料後再送出" });
    }

    // 3) Turnstile 人機驗證
    const ts = verifyTurnstile_(body.turnstileToken);
    if (!ts.ok) return jsonResponse_({ ok: false, error: ts.error });

    // ---- 基本欄位 ----
    const customer = String(body.customer || "").trim().slice(0, 40);
    const phoneRaw = String(body.phone || "").trim().slice(0, 30);
    const phone = digitsOnly_(phoneRaw);
    const pickupDate = String(body.pickupDate || "").trim().slice(0, 20);
    const pickupSlot = String(body.pickupSlot || "").trim().slice(0, 40);
    const note = String(body.note || "").trim().slice(0, 300);
    const items = Array.isArray(body.items) ? body.items : [];

    if (!customer) return jsonResponse_({ ok: false, error: "請填訂購人姓名" });
    if (phone.length < 8) return jsonResponse_({ ok: false, error: "請填正確的聯絡電話" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate))
      return jsonResponse_({ ok: false, error: "請選取貨日期" });
    if (!pickupSlot) return jsonResponse_({ ok: false, error: "請選取貨時段" });
    if (!items.length) return jsonResponse_({ ok: false, error: "請至少新增一個品項" });
    if (items.length > MAX_ITEMS)
      return jsonResponse_({ ok: false, error: "品項數量異常" });

    const rows = [];
    let totalBoxes = 0;
    let totalPieces = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const filling = String(it.filling || "").trim();
      const topping = String(it.topping || "").trim();
      const packSize = parseInt(it.packSize, 10);
      const boxes = parseInt(it.boxes, 10);
      if (FILLINGS.indexOf(filling) === -1)
        return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項內餡不正確" });
      if (TOPPINGS.indexOf(topping) === -1)
        return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項加料不正確" });
      if (PACK_SIZES.indexOf(packSize) === -1)
        return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項顆數不正確" });
      if (!(boxes >= 1 && boxes <= MAX_BOXES_PER_LINE))
        return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項盒數不正確" });
      const linePieces = packSize * boxes;
      totalBoxes += boxes;
      totalPieces += linePieces;
      rows.push([filling, topping, packSize, boxes, linePieces]);
    }

    // ---- 頻率 / 重複 / 總量控管 ----
    const cache = CacheService.getScriptCache();
    const props = PropertiesService.getScriptProperties();

    // 4a) 同電話冷卻
    const phoneKey = "rl_p_" + phone;
    if (cache.get(phoneKey)) {
      return jsonResponse_({ ok: false, error: "剛剛已送出過訂單,請稍候再試,或直接與我們聯絡。" });
    }

    // 4b) 完全相同的訂單去重
    const sig = Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5,
        phone + "|" + pickupDate + "|" + pickupSlot + "|" + JSON.stringify(rows)
      )
    );
    const dupKey = "dup_" + sig;
    if (cache.get(dupKey)) {
      return jsonResponse_({ ok: false, error: "這筆訂單剛剛已經送出了,請勿重複送出。" });
    }

    // 5a) 全站每分鐘節流
    const minuteKey = "gl_" + Math.floor(Date.now() / 60000);
    const minuteCount = Number(cache.get(minuteKey) || 0) + 1;
    if (minuteCount > GLOBAL_PER_MIN) {
      return jsonResponse_({ ok: false, error: "系統忙碌中,請稍後再送出。" });
    }

    // 5b) 每日總量上限
    const today = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
    const dayKey = "cnt_" + today;
    const dailyCap = Number(props.getProperty("DAILY_CAP") || DAILY_CAP_DEFAULT);
    const dayCount = Number(props.getProperty(dayKey) || 0);
    if (dayCount >= dailyCap) {
      return jsonResponse_({ ok: false, error: "今日預訂已額滿,請改日或與我們聯絡。" });
    }

    // ---- 寫入 ----
    const orderId = makeOrderId_();
    const now = new Date();
    const sheet = getSheet_();
    const fullRows = rows.map(function (r) {
      return [now, orderId, customer, phoneRaw, pickupDate, pickupSlot,
        r[0], r[1], r[2], r[3], r[4], note];
    });
    sheet
      .getRange(sheet.getLastRow() + 1, 1, fullRows.length, HEADERS.length)
      .setValues(fullRows);

    // 更新計數器
    cache.put(phoneKey, "1", PER_PHONE_COOLDOWN_S);
    cache.put(dupKey, "1", DUP_WINDOW_S);
    cache.put(minuteKey, String(minuteCount), 120);
    props.setProperty(dayKey, String(dayCount + 1));

    notify_(orderId, customer, phoneRaw, pickupDate, pickupSlot, totalBoxes, totalPieces);

    return jsonResponse_({
      ok: true,
      orderId: orderId,
      lineCount: fullRows.length,
      totalBoxes: totalBoxes,
      totalPieces: totalPieces,
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: "系統忙碌,請稍後再試" });
  } finally {
    lock.releaseLock();
  }
}

function notify_(orderId, customer, phone, date, slot, boxes, pieces) {
  try {
    const to = PropertiesService.getScriptProperties().getProperty("NOTIFY_EMAIL");
    if (!to) return;
    MailApp.sendEmail(
      to,
      "【月餅訂單】" + customer + " " + boxes + " 盒 / " + date,
      "訂單編號:" + orderId +
        "\n訂購人:" + customer + " (" + phone + ")" +
        "\n取貨:" + date + " " + slot +
        "\n合計:" + boxes + " 盒 / " + pieces + " 顆"
    );
  } catch (err) {
    // 通知失敗不影響訂單
  }
}

// ---- 讀取訂單 (給 admin.html 統計用) -----------------------------------

function doGet(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty("ADMIN_KEY");
    if (!key || (e.parameter.key || "") !== key) {
      return jsonResponse_({ ok: false, error: "unauthorized" });
    }

    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonResponse_({ ok: true, rows: [] });

    const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    const dateFilter = String(e.parameter.date || "").trim();

    const rows = values
      .map(function (v) {
        return {
          time: v[0] instanceof Date ? v[0].toISOString() : String(v[0]),
          orderId: String(v[1]),
          customer: String(v[2]),
          phone: String(v[3]),
          pickupDate: v[4] instanceof Date
            ? Utilities.formatDate(v[4], "Asia/Taipei", "yyyy-MM-dd")
            : String(v[4]),
          pickupSlot: String(v[5]),
          filling: String(v[6]),
          topping: String(v[7]),
          packSize: Number(v[8]) || 0,
          boxes: Number(v[9]) || 0,
          pieces: Number(v[10]) || 0,
          note: String(v[11]),
        };
      })
      .filter(function (r) {
        return !dateFilter || r.pickupDate === dateFilter;
      });

    return jsonResponse_({ ok: true, rows: rows });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

// ---- 初始化:建立分頁 + 設定金鑰 / 參數 -------------------------------
// 第一次部署前執行一次。改完字串再執行一次即可覆蓋。
function setup() {
  getSheet_();
  const props = PropertiesService.getScriptProperties();
  props.setProperty("ADMIN_KEY", "換成你自己的管理金鑰字串");

  // 選填:Cloudflare Turnstile 的 Secret Key(強烈建議設,主力防機器人)
  // props.setProperty("TURNSTILE_SECRET", "0x4AAAAAAA...");

  // 選填:每筆訂單寄通知信到這個信箱
  // props.setProperty("NOTIFY_EMAIL", "sky104857@gmail.com");

  // 選填:每日訂單筆數上限(預設 500)
  // props.setProperty("DAILY_CAP", "500");

  Logger.log("完成:分頁已建立,參數已寫入 Script Properties");
}
