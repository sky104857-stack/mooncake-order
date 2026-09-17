// 月餅訂購 — Google Sheets 後端 (Google Apps Script Web App)
// ---------------------------------------------------------------------------
// 綁定的試算表會自動建立一個工作表(分頁)叫「訂單明細」,一列 = 一個品項,欄位依序:
//   時間戳記 | 訂單編號 | 訂購人 | 電話 | 取貨日期 | 取貨時段 |
//   內餡 | 加料 | 顆數 | 盒數 | 總顆數 | 備註 | 單顆價格 | 小計金額 | 已收款
// 一張訂單如果點了多個組合,就會拆成多列,共用同一個「訂單編號」。
// (單顆價格／小計金額／已收款是後來加的欄位,刻意放最後面,
//  這樣舊資料列的既有欄位索引不會被打亂,只是新欄位在舊資料列上是空的。
//  已收款是整張訂單共用的狀態,同一個訂單編號的每一列都會同步寫。)
//
// 定價規則(見下方 PRICE 相關常數):
//   手工月餅(自用,只有六顆裝):任何內餡同價;原味每顆 50 元,
//   鹹蛋黃／麻薯／肉鬆每顆 +5 元(=55 元);單純顆數單價 × 6。
//   蛋黃酥禮盒(送禮用)才是固定盒價:六入 $360、十二入 $760;
//   可在備註要求把內容換成其他口味,但計價方式固定不變(見下方 EGG_BOX_PRICE)。
//
// 防機器人 / 防灌單(公開網站):
//   1) Cloudflare Turnstile 驗證碼(主力,免費) — 需設 Script Property TURNSTILE_SECRET
//   2) 蜜罐欄位 website — 有填 = 機器人
//   3) 填表時間 elapsedMs — 少於 3 秒 = 機器人
//   4) 同電話 30 秒內只能送一次;完全相同的訂單 10 分鐘內視為重複
//   5) 全站每分鐘上限 + 每日總量上限(超過就擋,避免爆量)
//   6) 可設 NOTIFY_EMAIL,每筆成功訂單寄信通知
//
// 公休 / 額滿日期:存在 Script Property BLOCKED_DATES(admin.html 管理)。
//   doGet?action=blockedDates 公開讀取(訂購頁用來提示、擋選);
//   doPost 帶 action:"admin_setBlockedDates" + adminKey 才能整批覆寫。
//
// 訂單管理(admin.html,都要 adminKey):
//   doPost action:"admin_setPaid"    {orderId, paid}  — 標記/取消整張訂單已收款
//   doPost action:"admin_deleteOrder" {orderId}        — 刪除整張訂單(所有品項列),不可復原
//
// 部署步驟見專案 README.md。
// ---------------------------------------------------------------------------

const SHEET_NAME = "訂單明細";
const HEADERS = [
  "時間戳記", "訂單編號", "訂購人", "電話", "取貨日期", "取貨時段",
  "內餡", "加料", "顆數", "盒數", "總顆數", "備註", "單顆價格", "小計金額", "已收款",
];

const FILLINGS = ["紅豆", "芋頭", "綠豆", "巧克力"];
const TOPPINGS = ["原味", "鹹蛋黃", "麻薯", "肉鬆"];
const PACK_SIZES = [6]; // 手工月餅(自用)只剩六顆裝;十二顆裝已移除,禮盒改走蛋黃酥禮盒那條線

// ---- 定價:手工月餅,自用,只有六顆裝(任何內餡同價,只看加料;顆數單價 × 6) --
const BASE_UNIT_PRICE = 50;                       // 每顆基本價(原味)
const TOPPING_SURCHARGE = { "原味": 0, "鹹蛋黃": 5, "麻薯": 5, "肉鬆": 5 }; // 每顆加收

function unitPrice_(topping) {
  return BASE_UNIT_PRICE + (TOPPING_SURCHARGE[topping] || 0);
}
function boxPrice_(topping, packSize) {
  return unitPrice_(topping) * packSize;
}

// ---- 定價:蛋黃酥禮盒(固定盒價,不是算顆的;內含密封袋+乾燥劑) --------
const EGG_PRODUCT_NAME = "蛋黃酥禮盒";
const EGG_BOX_PRICE = { 6: 360, 12: 760 };          // 六入 $360(不含提袋)、十二入 $760(含提袋)
const EGG_BAG_LABEL = { 6: "不含提袋", 12: "含提袋" };

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
  } else if (sheet.getLastColumn() < HEADERS.length) {
    // 舊表格結構(例如加價格欄位前建立的):補上新欄位的標題,不動既有資料
    const from = sheet.getLastColumn();
    sheet.getRange(1, from + 1, 1, HEADERS.length - from)
      .setValues([HEADERS.slice(from)]);
  }
  // 電話、取貨日期存純文字,避免試算表把 "0912..." 轉成數字吃掉開頭 0
  sheet.getRange("D:E").setNumberFormat("@");
  return sheet;
}

// 清空所有訂單(只留標題列)。上線前清測試資料用,平時別執行。
function resetOrders() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  PropertiesService.getScriptProperties().deleteProperty(
    "cnt_" + Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd")
  );
  Logger.log("已清空訂單明細");
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

// ---- 公休 / 額滿日期 -------------------------------------------------
// 存在 Script Property "BLOCKED_DATES",格式:[{date:"yyyy-MM-dd", reason:"公休"}, ...]
// 公開給訂購頁讀取(不含任何個資,只有日期跟原因),管理頁才能新增/移除。

function getBlockedDates_() {
  const raw = PropertiesService.getScriptProperties().getProperty("BLOCKED_DATES");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function setBlockedDates_(list) {
  PropertiesService.getScriptProperties().setProperty("BLOCKED_DATES", JSON.stringify(list));
}

// 管理頁呼叫:整批覆寫公休/額滿日期清單(需要 ADMIN_KEY)
function handleSetBlockedDates_(body) {
  const key = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (!key || body.adminKey !== key) {
    return jsonResponse_({ ok: false, error: "unauthorized" });
  }
  const input = Array.isArray(body.dates) ? body.dates : [];
  const seen = {};
  const cleaned = [];
  for (let i = 0; i < input.length; i++) {
    const d = String((input[i] || {}).date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || seen[d]) continue;
    seen[d] = true;
    cleaned.push({
      date: d,
      reason: String((input[i] || {}).reason || "").trim().slice(0, 40) || "暫停預訂",
    });
  }
  cleaned.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  setBlockedDates_(cleaned);
  return jsonResponse_({ ok: true, dates: cleaned });
}

// 管理頁呼叫:整張訂單(所有品項列)標記/取消已收款(需要 ADMIN_KEY)
function handleSetPaid_(body) {
  const key = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (!key || body.adminKey !== key) {
    return jsonResponse_({ ok: false, error: "unauthorized" });
  }
  const orderId = String(body.orderId || "").trim();
  if (!orderId) return jsonResponse_({ ok: false, error: "缺少訂單編號" });
  const paid = !!body.paid;

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse_({ ok: true, updated: 0 });

  const paidCol = HEADERS.indexOf("已收款") + 1; // 1-based
  const orderIds = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // 訂單編號欄
  let updated = 0;
  for (let r = 0; r < orderIds.length; r++) {
    if (String(orderIds[r][0]) === orderId) {
      sheet.getRange(r + 2, paidCol).setValue(paid ? "TRUE" : "");
      updated++;
    }
  }
  return jsonResponse_({ ok: true, updated: updated, paid: paid });
}

// 管理頁呼叫:刪除整張訂單(所有品項列),不可復原(需要 ADMIN_KEY)
function handleDeleteOrder_(body) {
  const key = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (!key || body.adminKey !== key) {
    return jsonResponse_({ ok: false, error: "unauthorized" });
  }
  const orderId = String(body.orderId || "").trim();
  if (!orderId) return jsonResponse_({ ok: false, error: "缺少訂單編號" });

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse_({ ok: true, deleted: 0 });

  const orderIds = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // 訂單編號欄
  let deleted = 0;
  // 從最下面往上刪,避免刪除後其餘列的列號往上移導致對不上
  for (let r = orderIds.length - 1; r >= 0; r--) {
    if (String(orderIds[r][0]) === orderId) {
      sheet.deleteRow(r + 2);
      deleted++;
    }
  }
  if (deleted === 0) return jsonResponse_({ ok: false, error: "找不到這張訂單" });
  return jsonResponse_({ ok: true, deleted: deleted });
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

    // 0) 管理動作,跟一般訂單分開處理,不算防灌單那一套
    if (body.action === "admin_setBlockedDates") {
      return handleSetBlockedDates_(body);
    }
    if (body.action === "admin_setPaid") {
      return handleSetPaid_(body);
    }
    if (body.action === "admin_deleteOrder") {
      return handleDeleteOrder_(body);
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
    const blockedHit = getBlockedDates_().find(function (b) { return b.date === pickupDate; });
    if (blockedHit)
      return jsonResponse_({ ok: false, error: "這天" + (blockedHit.reason || "暫停預訂") + ",請選其他日期。" });
    if (!pickupSlot) return jsonResponse_({ ok: false, error: "請選取貨時段" });
    if (!items.length) return jsonResponse_({ ok: false, error: "請至少新增一個品項" });
    if (items.length > MAX_ITEMS)
      return jsonResponse_({ ok: false, error: "品項數量異常" });

    const rows = [];
    let totalBoxes = 0;
    let totalPieces = 0;
    let totalPrice = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const filling = String(it.filling || "").trim();
      const packSize = parseInt(it.packSize, 10);
      const boxes = parseInt(it.boxes, 10);
      if (!(boxes >= 1 && boxes <= MAX_BOXES_PER_LINE))
        return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項盒數不正確" });

      let topping, unit, lineAmount;
      if (filling === EGG_PRODUCT_NAME) {
        // 蛋黃酥禮盒:固定盒價,加料欄位借來記「含/不含提袋」,由後端依規格決定,不吃客戶端傳的值
        if (EGG_BOX_PRICE[packSize] === undefined)
          return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項規格不正確" });
        topping = EGG_BAG_LABEL[packSize];
        unit = EGG_BOX_PRICE[packSize] / packSize;
        lineAmount = EGG_BOX_PRICE[packSize] * boxes;
      } else {
        topping = String(it.topping || "").trim();
        if (FILLINGS.indexOf(filling) === -1)
          return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項內餡不正確" });
        if (TOPPINGS.indexOf(topping) === -1)
          return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項加料不正確" });
        if (PACK_SIZES.indexOf(packSize) === -1)
          return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項顆數不正確" });
        unit = unitPrice_(topping);
        lineAmount = boxPrice_(topping, packSize) * boxes;
      }

      const linePieces = packSize * boxes;
      totalBoxes += boxes;
      totalPieces += linePieces;
      totalPrice += lineAmount;
      rows.push([filling, topping, packSize, boxes, linePieces, unit, lineAmount]);
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
        r[0], r[1], r[2], r[3], r[4], note, r[5], r[6], ""]; // 已收款預設空白(未收款)
    });
    sheet
      .getRange(sheet.getLastRow() + 1, 1, fullRows.length, HEADERS.length)
      .setValues(fullRows);

    // 更新計數器
    cache.put(phoneKey, "1", PER_PHONE_COOLDOWN_S);
    cache.put(dupKey, "1", DUP_WINDOW_S);
    cache.put(minuteKey, String(minuteCount), 120);
    props.setProperty(dayKey, String(dayCount + 1));

    notify_(orderId, customer, phoneRaw, pickupDate, pickupSlot, totalBoxes, totalPieces, totalPrice);

    return jsonResponse_({
      ok: true,
      orderId: orderId,
      lineCount: fullRows.length,
      totalBoxes: totalBoxes,
      totalPieces: totalPieces,
      totalPrice: totalPrice,
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: "系統忙碌,請稍後再試" });
  } finally {
    lock.releaseLock();
  }
}

function notify_(orderId, customer, phone, date, slot, boxes, pieces, price) {
  try {
    const to = PropertiesService.getScriptProperties().getProperty("NOTIFY_EMAIL");
    if (!to) return;
    MailApp.sendEmail(
      to,
      "【月餅訂單】" + customer + " " + boxes + " 盒 / " + date,
      "訂單編號:" + orderId +
        "\n訂購人:" + customer + " (" + phone + ")" +
        "\n取貨:" + date + " " + slot +
        "\n合計:" + boxes + " 盒 / " + pieces + " 顆 / NT$" + price
    );
  } catch (err) {
    // 通知失敗不影響訂單
  }
}

// ---- 讀取訂單 (給 admin.html 統計用) -----------------------------------

function doGet(e) {
  try {
    // 公休/額滿日期給訂購頁公開讀取,不含個資,不需要管理金鑰
    if (e.parameter.action === "blockedDates") {
      return jsonResponse_({ ok: true, dates: getBlockedDates_() });
    }

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
          // 舊訂單(加價格欄位前)這兩格是空的,退回用目前定價規則現算
          unitPrice: Number(v[12]) || unitPrice_(String(v[7])),
          amount: Number(v[13]) || boxPrice_(String(v[7]), Number(v[8]) || 0) * (Number(v[9]) || 0),
          paid: String(v[14]).toUpperCase() === "TRUE",
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
// 這個 repo 是公開的,真正的金鑰不寫在程式碼裡,而是存在 Script Properties。
// 第一次執行 setup() 會建立分頁,並在「該參數還沒設定過」時填入下面的預設值;
// 已經設定過的值不會被蓋掉。要換金鑰請直接到
//   專案設定 → Script Properties 手動改,或用 setProp_(key, value, true)。
function setProp_(key, value, force) {
  const props = PropertiesService.getScriptProperties();
  if (force || !props.getProperty(key)) props.setProperty(key, value);
}

function setup() {
  getSheet_();
  setProp_("ADMIN_KEY", "請改成一組隨機字串");          // admin.html 讀取用
  setProp_("NOTIFY_EMAIL", "");                          // 填信箱則每筆訂單寄通知
  // setProp_("TURNSTILE_SECRET", "0x4AAAAAAA...");      // Cloudflare Turnstile Secret
  // setProp_("DAILY_CAP", "500");                       // 每日訂單筆數上限
  Logger.log("完成:分頁已建立,未設定過的參數已填入預設值");
}
