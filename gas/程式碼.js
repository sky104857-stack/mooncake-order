// 月餅訂購 — Google Sheets 後端 (Google Apps Script Web App)
// ---------------------------------------------------------------------------
// 綁定的試算表會自動建立一個工作表(分頁)叫「訂單明細」,一列 = 一個品項,欄位依序:
//   時間戳記 | 訂單編號 | 訂購人 | 電話 | 取貨日期 | 取貨時段 |
//   內餡 | 加料 | 顆數 | 盒數 | 總顆數 | 備註
// 一張訂單如果點了多個組合,就會拆成多列,共用同一個「訂單編號」,
// 這樣在 Google 試算表用樞紐分析(或 admin.html)依種類統計會很好算。
//
// 部署步驟(personal 帳號 sky104857@gmail.com):
//   1. clasp push 之後,開啟試算表 > 擴充功能 > Apps Script
//   2. 執行一次 setup() 函式 → 會跳授權,允許存取試算表;同時寫入管理金鑰
//   3. 部署 > 新增部署作業 > 類型「網頁應用程式」
//        - 執行身分:我 (sky104857@gmail.com)
//        - 誰可以存取:任何人
//   4. 複製 /exec 網址,貼進前端 config.js 的 GAS_URL
// ---------------------------------------------------------------------------

const SHEET_NAME = "訂單明細";
const HEADERS = [
  "時間戳記", "訂單編號", "訂購人", "電話", "取貨日期", "取貨時段",
  "內餡", "加料", "顆數", "盒數", "總顆數", "備註",
];

const FILLINGS = ["紅豆", "芋頭", "綠豆"];       // 內餡
const TOPPINGS = ["原味", "鹹蛋黃", "麻薯"];     // 加料
const PACK_SIZES = [6, 12];                      // 顆數 / 盒

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
  const now = new Date();
  const stamp = Utilities.formatDate(now, "Asia/Taipei", "yyMMdd-HHmmss");
  const rand = Math.floor(Math.random() * 900 + 100);
  return "M" + stamp + "-" + rand;
}

// ---- 送出訂單 -------------------------------------------------------------

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    const body = JSON.parse(e.postData.contents);

    const customer = String(body.customer || "").trim();
    const phone = String(body.phone || "").trim();
    const pickupDate = String(body.pickupDate || "").trim();
    const pickupSlot = String(body.pickupSlot || "").trim();
    const note = String(body.note || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!customer) return jsonResponse_({ ok: false, error: "請填訂購人姓名" });
    if (!phone) return jsonResponse_({ ok: false, error: "請填聯絡電話" });
    if (!pickupDate) return jsonResponse_({ ok: false, error: "請選取貨日期" });
    if (!pickupSlot) return jsonResponse_({ ok: false, error: "請選取貨時段" });
    if (!items.length) return jsonResponse_({ ok: false, error: "請至少新增一個品項" });

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
      if (!(boxes >= 1))
        return jsonResponse_({ ok: false, error: "第 " + (i + 1) + " 項盒數要 ≥ 1" });

      const linePieces = packSize * boxes;
      totalBoxes += boxes;
      totalPieces += linePieces;
      rows.push([filling, topping, packSize, boxes, linePieces]);
    }

    const orderId = makeOrderId_();
    const now = new Date();
    const sheet = getSheet_();

    const fullRows = rows.map(function (r) {
      return [now, orderId, customer, phone, pickupDate, pickupSlot,
        r[0], r[1], r[2], r[3], r[4], note];
    });
    sheet
      .getRange(sheet.getLastRow() + 1, 1, fullRows.length, HEADERS.length)
      .setValues(fullRows);

    return jsonResponse_({
      ok: true,
      orderId: orderId,
      lineCount: fullRows.length,
      totalBoxes: totalBoxes,
      totalPieces: totalPieces,
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- 讀取訂單 (給 admin.html 統計用) -------------------------------------

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

// ---- 初始化:建立分頁 + 設定管理金鑰 ------------------------------------
// 第一次部署前執行一次。之後要換金鑰,改下面字串再執行一次,
// 同時更新 admin.html 用的網址參數 ?key=
function setup() {
  getSheet_();
  const props = PropertiesService.getScriptProperties();
  props.setProperty("ADMIN_KEY", "換成你自己的管理金鑰字串");
  Logger.log("完成:分頁已建立,ADMIN_KEY 已寫入 Script Properties");
}
