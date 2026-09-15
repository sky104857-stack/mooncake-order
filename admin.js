(function () {
  "use strict";

  var CFG = window.APP_CONFIG || {};
  var FILLINGS = ["紅豆", "芋頭", "綠豆", "巧克力"];
  var TOPPINGS = ["原味", "鹹蛋黃", "麻薯"];
  var PACKS = [6, 12];
  var EGG_PRODUCT_NAME = "蛋黃酥禮盒";
  var EGG_TOPPINGS = ["不含提袋", "含提袋"]; // 分別對應六入/十二入

  var keyInput = document.getElementById("keyInput");
  var dateInput = document.getElementById("dateInput");
  var msg = document.getElementById("msg");
  var report = document.getElementById("report");

  // 記住金鑰(僅存本機瀏覽器)
  try {
    var saved = localStorage.getItem("mooncakeAdminKey");
    if (saved) keyInput.value = saved;
  } catch (e) {}

  document.getElementById("printBtn").addEventListener("click", function () {
    window.print();
  });

  document.getElementById("loadBtn").addEventListener("click", load);

  // ---- 公休 / 額滿日期管理 ---------------------------------------------
  var blockedListEl = document.getElementById("blockedList");
  var blockDateInput = document.getElementById("blockDateInput");
  var blockReasonInput = document.getElementById("blockReasonInput");
  var blockMsg = document.getElementById("blockMsg");
  var currentBlocked = []; // [{date, reason}]

  function loadBlockedDates() {
    if (!CFG.GAS_URL) return;
    fetch(CFG.GAS_URL + "?action=blockedDates")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        currentBlocked = (data && data.ok && data.dates) || [];
        renderBlockedList();
      })
      .catch(function () {});
  }

  function renderBlockedList() {
    if (!blockedListEl) return;
    if (!currentBlocked.length) {
      blockedListEl.innerHTML = '<span class="text-xs text-stone-400">目前沒有封鎖任何日期</span>';
      return;
    }
    blockedListEl.innerHTML = currentBlocked
      .map(function (b) {
        return (
          "<span class='inline-flex items-center gap-1.5 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-1 text-sm'>" +
          esc(b.date) + "（" + esc(b.reason) + "）" +
          "<button type='button' data-date='" + esc(b.date) + "' class='removeBlockBtn text-red-400 hover:text-red-700 font-bold'>×</button>" +
          "</span>"
        );
      })
      .join("");
    blockedListEl.querySelectorAll(".removeBlockBtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        saveBlockedDates(currentBlocked.filter(function (b) { return b.date !== btn.dataset.date; }));
      });
    });
  }

  function saveBlockedDates(list) {
    var key = keyInput.value.trim();
    if (!key) {
      blockMsg.textContent = "請先在上面輸入管理金鑰。";
      return;
    }
    if (!CFG.GAS_URL) {
      blockMsg.textContent = "config.js 尚未設定 GAS_URL。";
      return;
    }
    blockMsg.textContent = "處理中…";
    fetch(CFG.GAS_URL, {
      method: "POST",
      // text/plain 避免 CORS preflight;GAS 端用 JSON.parse 解析
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "admin_setBlockedDates", adminKey: key, dates: list }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          blockMsg.textContent = "失敗：" + ((data && data.error) || "未知錯誤");
          return;
        }
        currentBlocked = data.dates || [];
        renderBlockedList();
        blockMsg.textContent = "已更新。";
        blockDateInput.value = "";
        blockReasonInput.value = "";
      })
      .catch(function (err) {
        blockMsg.textContent = "失敗（可能是網路或 CORS）：" + err;
      });
  }

  document.getElementById("addBlockBtn").addEventListener("click", function () {
    var d = blockDateInput.value;
    if (!d) {
      blockMsg.textContent = "請先選日期。";
      return;
    }
    var reason = blockReasonInput.value.trim() || "暫停預訂";
    var next = currentBlocked.filter(function (b) { return b.date !== d; });
    next.push({ date: d, reason: reason });
    saveBlockedDates(next);
  });

  loadBlockedDates();

  function load() {
    var key = keyInput.value.trim();
    if (!key) {
      msg.textContent = "請輸入管理金鑰。";
      return;
    }
    if (!CFG.GAS_URL) {
      msg.textContent = "config.js 尚未設定 GAS_URL。";
      return;
    }
    try {
      localStorage.setItem("mooncakeAdminKey", key);
    } catch (e) {}

    var date = dateInput.value;
    var url =
      CFG.GAS_URL +
      "?key=" + encodeURIComponent(key) +
      (date ? "&date=" + encodeURIComponent(date) : "");

    msg.textContent = "載入中…";
    report.classList.add("hidden");

    fetch(url, { method: "GET" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          msg.textContent =
            data && data.error === "unauthorized"
              ? "金鑰錯誤。"
              : "載入失敗：" + ((data && data.error) || "未知錯誤");
          return;
        }
        render(data.rows || [], date);
      })
      .catch(function (err) {
        msg.textContent = "載入失敗（可能是網路或 CORS）：" + err;
      });
  }

  function render(rows, date) {
    if (!rows.length) {
      msg.textContent = date
        ? "取貨日期 " + date + " 沒有訂單。"
        : "目前沒有任何訂單。";
      report.classList.add("hidden");
      return;
    }
    msg.textContent = "";
    report.classList.remove("hidden");
    document.getElementById("reportScope").textContent =
      (date ? "取貨日期：" + date : "全部取貨日期") +
      "　|　共 " + rows.length + " 個品項列";

    renderMatrix(rows);
    renderBy("fillingTable", rows, "filling", FILLINGS.concat([EGG_PRODUCT_NAME]));
    renderBy("toppingTable", rows, "topping", TOPPINGS);
    renderPack(rows);
    renderOrders(rows);
    renderRevenue(rows);
  }

  function money(n) {
    return "NT$" + Math.round(n).toLocaleString("zh-Hant-TW");
  }

  // ---- 製作彙總:內餡 × 加料,細分 6/12 顆 -----------------------------
  function renderMatrix(rows) {
    var cell = {}; // key: filling|topping|pack => {boxes, amount}
    rows.forEach(function (r) {
      var k = r.filling + "|" + r.topping + "|" + r.packSize;
      if (!cell[k]) cell[k] = { boxes: 0, amount: 0 };
      cell[k].boxes += r.boxes;
      cell[k].amount += r.amount || 0;
    });

    var html =
      "<thead><tr class='text-left border-b-2 border-stone-300'>" +
      "<th class='py-2 pr-3'>內餡</th><th class='py-2 pr-3'>加料</th>" +
      "<th class='py-2 px-3 text-right'>六顆·盒</th>" +
      "<th class='py-2 px-3 text-right'>十二顆·盒</th>" +
      "<th class='py-2 px-3 text-right'>總盒數</th>" +
      "<th class='py-2 px-3 text-right'>總顆數</th>" +
      "<th class='py-2 pl-3 text-right'>金額</th></tr></thead><tbody>";

    var gBox = 0, gPiece = 0, gAmount = 0;

    function addRow(f, t) {
      var c6 = cell[f + "|" + t + "|6"] || { boxes: 0, amount: 0 };
      var c12 = cell[f + "|" + t + "|12"] || { boxes: 0, amount: 0 };
      var boxes = c6.boxes + c12.boxes;
      var pieces = c6.boxes * 6 + c12.boxes * 12;
      var amount = c6.amount + c12.amount;
      if (boxes === 0) return;
      gBox += boxes;
      gPiece += pieces;
      gAmount += amount;
      html +=
        "<tr class='border-b border-stone-100'>" +
        "<td class='py-1.5 pr-3 font-medium'>" + f + "</td>" +
        "<td class='py-1.5 pr-3'>" + t + "</td>" +
        "<td class='py-1.5 px-3 text-right'>" + (c6.boxes || "") + "</td>" +
        "<td class='py-1.5 px-3 text-right'>" + (c12.boxes || "") + "</td>" +
        "<td class='py-1.5 px-3 text-right font-semibold'>" + boxes + "</td>" +
        "<td class='py-1.5 px-3 text-right'>" + pieces + "</td>" +
        "<td class='py-1.5 pl-3 text-right'>" + money(amount) + "</td></tr>";
    }

    FILLINGS.forEach(function (f) {
      TOPPINGS.forEach(function (t) { addRow(f, t); });
    });
    // 蛋黃酥禮盒不是內餡×加料矩陣,是固定規格;借同一個表格多加兩列
    // (不含提袋只會有六入、含提袋只會有十二入,天然不會混在一起)
    EGG_TOPPINGS.forEach(function (t) { addRow(EGG_PRODUCT_NAME, t); });

    html +=
      "</tbody><tfoot><tr class='border-t-2 border-stone-300 font-bold'>" +
      "<td class='py-2 pr-3' colspan='4'>總計</td>" +
      "<td class='py-2 px-3 text-right'>" + gBox + "</td>" +
      "<td class='py-2 px-3 text-right'>" + gPiece + "</td>" +
      "<td class='py-2 pl-3 text-right'>" + money(gAmount) + "</td></tr></tfoot>";

    document.getElementById("matrixTable").innerHTML = html;
  }

  // ---- 總營收 ----------------------------------------------------------
  function renderRevenue(rows) {
    var total = rows.reduce(function (s, r) { return s + (r.amount || 0); }, 0);
    var el = document.getElementById("revenueTotal");
    if (el) el.textContent = money(total);
  }

  // ---- 依單一分類(內餡 / 加料) --------------------------------------
  function renderBy(tableId, rows, field, order) {
    var box = {}, piece = {};
    rows.forEach(function (r) {
      box[r[field]] = (box[r[field]] || 0) + r.boxes;
      piece[r[field]] = (piece[r[field]] || 0) + r.pieces;
    });
    var html =
      "<tr class='text-left border-b border-stone-200 text-xs text-stone-500'>" +
      "<th class='py-1'>類別</th><th class='py-1 text-right'>盒</th><th class='py-1 text-right'>顆</th></tr>";
    order.forEach(function (k) {
      html +=
        "<tr class='border-b border-stone-50'>" +
        "<td class='py-1'>" + k + "</td>" +
        "<td class='py-1 text-right font-semibold'>" + (box[k] || 0) + "</td>" +
        "<td class='py-1 text-right'>" + (piece[k] || 0) + "</td></tr>";
    });
    document.getElementById(tableId).innerHTML = html;
  }

  function renderPack(rows) {
    var box = {}, piece = {};
    rows.forEach(function (r) {
      box[r.packSize] = (box[r.packSize] || 0) + r.boxes;
      piece[r.packSize] = (piece[r.packSize] || 0) + r.pieces;
    });
    var html =
      "<tr class='text-left border-b border-stone-200 text-xs text-stone-500'>" +
      "<th class='py-1'>規格</th><th class='py-1 text-right'>盒</th><th class='py-1 text-right'>顆</th></tr>";
    PACKS.forEach(function (p) {
      html +=
        "<tr class='border-b border-stone-50'>" +
        "<td class='py-1'>" + p + " 顆 / 盒</td>" +
        "<td class='py-1 text-right font-semibold'>" + (box[p] || 0) + "</td>" +
        "<td class='py-1 text-right'>" + (piece[p] || 0) + "</td></tr>";
    });
    document.getElementById("packTable").innerHTML = html;
  }

  // ---- 訂單清單(依訂單編號分組) ------------------------------------
  function renderOrders(rows) {
    var orders = {};
    rows.forEach(function (r) {
      if (!orders[r.orderId]) {
        orders[r.orderId] = {
          orderId: r.orderId,
          customer: r.customer,
          phone: r.phone,
          pickupDate: r.pickupDate,
          pickupSlot: r.pickupSlot,
          note: r.note,
          time: r.time,
          items: [],
        };
      }
      orders[r.orderId].items.push(r);
    });

    var list = Object.keys(orders)
      .map(function (k) { return orders[k]; })
      .sort(function (a, b) {
        if (a.pickupDate !== b.pickupDate) return a.pickupDate < b.pickupDate ? -1 : 1;
        return a.time < b.time ? -1 : 1;
      });

    document.getElementById("orderCount").textContent = list.length;

    document.getElementById("orderList").innerHTML = list
      .map(function (o) {
        var totBox = 0, totPiece = 0, totAmount = 0;
        var items = o.items
          .map(function (it) {
            totBox += it.boxes;
            totPiece += it.pieces;
            totAmount += it.amount || 0;
            return "<li>" + it.filling + "／" + it.topping + "／" + it.packSize +
              "顆 × " + it.boxes + " 盒（" + it.pieces + " 顆）・" + money(it.amount || 0) + "</li>";
          })
          .join("");
        return (
          "<div class='rounded-lg ring-1 ring-stone-200 p-4'>" +
          "<div class='flex flex-wrap justify-between gap-2 text-sm'>" +
          "<span class='font-bold'>" + esc(o.customer) + "　<span class='font-normal text-stone-500'>" + esc(o.phone) + "</span></span>" +
          "<span class='text-stone-500 font-mono text-xs'>" + esc(o.orderId) + "</span></div>" +
          "<div class='text-sm text-amber-800 mt-1'>取貨：" + esc(o.pickupDate) + "　" + esc(o.pickupSlot) + "</div>" +
          "<ul class='mt-2 text-sm list-disc list-inside text-stone-700'>" + items + "</ul>" +
          "<div class='mt-2 text-xs text-stone-500'>小計 " + totBox + " 盒 ・ " + totPiece + " 顆 ・ <b class='text-stone-700'>" + money(totAmount) + "</b>" +
          (o.note ? "　|　備註：" + esc(o.note) : "") + "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
})();
