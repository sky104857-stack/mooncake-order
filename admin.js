(function () {
  "use strict";

  var CFG = window.APP_CONFIG || {};
  var FILLINGS = ["紅豆", "芋頭", "綠豆"];
  var TOPPINGS = ["原味", "鹹蛋黃", "麻薯"];
  var PACKS = [6, 12];

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
    renderBy("fillingTable", rows, "filling", FILLINGS);
    renderBy("toppingTable", rows, "topping", TOPPINGS);
    renderPack(rows);
    renderOrders(rows);
  }

  // ---- 製作彙總:內餡 × 加料,細分 6/12 顆 -----------------------------
  function renderMatrix(rows) {
    var cell = {}; // key: filling|topping|pack => boxes
    rows.forEach(function (r) {
      var k = r.filling + "|" + r.topping + "|" + r.packSize;
      cell[k] = (cell[k] || 0) + r.boxes;
    });

    var html =
      "<thead><tr class='text-left border-b-2 border-stone-300'>" +
      "<th class='py-2 pr-3'>內餡</th><th class='py-2 pr-3'>加料</th>" +
      "<th class='py-2 px-3 text-right'>六顆·盒</th>" +
      "<th class='py-2 px-3 text-right'>十二顆·盒</th>" +
      "<th class='py-2 px-3 text-right'>總盒數</th>" +
      "<th class='py-2 pl-3 text-right'>總顆數</th></tr></thead><tbody>";

    var gBox = 0, gPiece = 0;

    FILLINGS.forEach(function (f) {
      TOPPINGS.forEach(function (t) {
        var b6 = cell[f + "|" + t + "|6"] || 0;
        var b12 = cell[f + "|" + t + "|12"] || 0;
        var boxes = b6 + b12;
        var pieces = b6 * 6 + b12 * 12;
        if (boxes === 0) return;
        gBox += boxes;
        gPiece += pieces;
        html +=
          "<tr class='border-b border-stone-100'>" +
          "<td class='py-1.5 pr-3 font-medium'>" + f + "</td>" +
          "<td class='py-1.5 pr-3'>" + t + "</td>" +
          "<td class='py-1.5 px-3 text-right'>" + (b6 || "") + "</td>" +
          "<td class='py-1.5 px-3 text-right'>" + (b12 || "") + "</td>" +
          "<td class='py-1.5 px-3 text-right font-semibold'>" + boxes + "</td>" +
          "<td class='py-1.5 pl-3 text-right'>" + pieces + "</td></tr>";
      });
    });

    html +=
      "</tbody><tfoot><tr class='border-t-2 border-stone-300 font-bold'>" +
      "<td class='py-2 pr-3' colspan='4'>總計</td>" +
      "<td class='py-2 px-3 text-right'>" + gBox + "</td>" +
      "<td class='py-2 pl-3 text-right'>" + gPiece + "</td></tr></tfoot>";

    document.getElementById("matrixTable").innerHTML = html;
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
        var totBox = 0, totPiece = 0;
        var items = o.items
          .map(function (it) {
            totBox += it.boxes;
            totPiece += it.pieces;
            return "<li>" + it.filling + "／" + it.topping + "／" + it.packSize +
              "顆 × " + it.boxes + " 盒（" + it.pieces + " 顆）</li>";
          })
          .join("");
        return (
          "<div class='rounded-lg ring-1 ring-stone-200 p-4'>" +
          "<div class='flex flex-wrap justify-between gap-2 text-sm'>" +
          "<span class='font-bold'>" + esc(o.customer) + "　<span class='font-normal text-stone-500'>" + esc(o.phone) + "</span></span>" +
          "<span class='text-stone-500 font-mono text-xs'>" + esc(o.orderId) + "</span></div>" +
          "<div class='text-sm text-amber-800 mt-1'>取貨：" + esc(o.pickupDate) + "　" + esc(o.pickupSlot) + "</div>" +
          "<ul class='mt-2 text-sm list-disc list-inside text-stone-700'>" + items + "</ul>" +
          "<div class='mt-2 text-xs text-stone-500'>小計 " + totBox + " 盒 ・ " + totPiece + " 顆" +
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
