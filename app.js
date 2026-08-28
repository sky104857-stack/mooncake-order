(function () {
  "use strict";

  var CFG = window.APP_CONFIG || {};
  var pageLoadedAt = Date.now();
  var form = document.getElementById("orderForm");
  var itemList = document.getElementById("itemList");
  var tpl = document.getElementById("itemTemplate");
  var summaryEl = document.getElementById("summary");
  var errorEl = document.getElementById("formError");
  var submitBtn = document.getElementById("submitBtn");

  // ---- 初始化取貨日期 / 時段 -------------------------------------------
  var slotSelect = form.pickupSlot;
  (CFG.PICKUP_SLOTS || ["上午", "下午", "晚上"]).forEach(function (s) {
    var o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    slotSelect.appendChild(o);
  });

  var lead = Number(CFG.LEAD_DAYS || 0);
  var min = new Date();
  min.setDate(min.getDate() + lead);
  form.pickupDate.min = min.toISOString().slice(0, 10);

  // ---- Cloudflare Turnstile 人機驗證(選用) --------------------------
  var turnstileToken = "";
  var turnstileWidgetId = null;
  if (CFG.TURNSTILE_SITE_KEY) {
    var renderTurnstile = function () {
      if (!window.turnstile || typeof window.turnstile.render !== "function") {
        return window.setTimeout(renderTurnstile, 200);
      }
      turnstileWidgetId = window.turnstile.render("#ts-widget", {
        sitekey: CFG.TURNSTILE_SITE_KEY,
        callback: function (token) { turnstileToken = token; },
        "expired-callback": function () { turnstileToken = ""; },
        "error-callback": function () { turnstileToken = ""; },
      });
    };
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    s.onload = renderTurnstile;
    document.head.appendChild(s);
  }
  function resetTurnstile() {
    turnstileToken = "";
    if (turnstileWidgetId !== null && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId);
    }
  }

  // ---- 品項卡片 -------------------------------------------------------
  function renumber() {
    var cards = itemList.querySelectorAll(".item-card");
    cards.forEach(function (card, i) {
      card.querySelector(".item-title").textContent = "品項 " + (i + 1);
      var rm = card.querySelector(".remove-item");
      rm.style.display = cards.length > 1 ? "" : "none";
    });
  }

  function lineValues(card) {
    var f = card.querySelector('input[name="filling"]:checked');
    var t = card.querySelector('input[name="topping"]:checked');
    var p = card.querySelector('input[name="packSize"]:checked');
    var b = parseInt(card.querySelector('input[name="boxes"]').value, 10);
    return {
      filling: f ? f.value : "",
      topping: t ? t.value : "",
      packSize: p ? parseInt(p.value, 10) : 0,
      boxes: b >= 1 ? b : 0,
    };
  }

  function addCard() {
    var node = tpl.content.firstElementChild.cloneNode(true);
    itemList.appendChild(node);
    renumber();
    updateSummary();
  }

  itemList.addEventListener("click", function (e) {
    var card = e.target.closest(".item-card");
    if (!card) return;

    if (e.target.classList.contains("remove-item")) {
      if (itemList.querySelectorAll(".item-card").length > 1) {
        card.remove();
        renumber();
        updateSummary();
      }
      return;
    }
    if (e.target.classList.contains("step-up") || e.target.classList.contains("step-down")) {
      var input = card.querySelector('input[name="boxes"]');
      var v = parseInt(input.value, 10) || 1;
      v += e.target.classList.contains("step-up") ? 1 : -1;
      if (v < 1) v = 1;
      if (v > 999) v = 999;
      input.value = v;
      updateSummary();
    }
  });

  itemList.addEventListener("change", updateSummary);
  itemList.addEventListener("input", updateSummary);
  document.getElementById("addItemBtn").addEventListener("click", addCard);

  // ---- 即時摘要 ------------------------------------------------------
  function updateSummary() {
    var cards = itemList.querySelectorAll(".item-card");
    var totalBoxes = 0, totalPieces = 0;
    var byFilling = {};

    cards.forEach(function (card) {
      var v = lineValues(card);
      var lineEl = card.querySelector(".item-line-summary");
      if (v.filling && v.topping && v.packSize && v.boxes) {
        var pieces = v.packSize * v.boxes;
        totalBoxes += v.boxes;
        totalPieces += pieces;
        byFilling[v.filling] = (byFilling[v.filling] || 0) + v.boxes;
        lineEl.textContent =
          v.filling + "・" + v.topping + "・" + v.packSize + "顆 × " +
          v.boxes + " 盒 ＝ " + pieces + " 顆";
      } else {
        lineEl.textContent = "尚未選完";
      }
    });

    if (totalBoxes === 0) {
      summaryEl.innerHTML = '<p class="text-brand-500">尚未有完整品項</p>';
      return;
    }
    var parts = Object.keys(byFilling).map(function (k) {
      return k + " " + byFilling[k] + " 盒";
    });
    summaryEl.innerHTML =
      '<p class="font-semibold text-base">共 ' + totalBoxes + " 盒 ・ " + totalPieces + ' 顆</p>' +
      '<p class="text-brand-600">內餡分佈：' + parts.join("、") + "</p>";
  }

  // ---- 送出 ---------------------------------------------------------
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
    errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function clearError() {
    errorEl.classList.add("hidden");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearError();

    if (!CFG.GAS_URL) {
      showError("系統尚未設定後端網址（config.js 的 GAS_URL），暫時無法送出。");
      return;
    }

    var items = [];
    var bad = false;
    itemList.querySelectorAll(".item-card").forEach(function (card, i) {
      var v = lineValues(card);
      if (!v.filling || !v.topping || !v.packSize || !v.boxes) {
        bad = true;
        showError("品項 " + (i + 1) + " 尚未選完（內餡 / 加料 / 顆數 / 盒數）");
      }
      items.push(v);
    });
    if (bad) return;

    if (CFG.TURNSTILE_SITE_KEY && !turnstileToken) {
      showError("請先完成下方的人機驗證。");
      return;
    }

    var payload = {
      customer: form.customer.value.trim(),
      phone: form.phone.value.trim(),
      pickupDate: form.pickupDate.value,
      pickupSlot: form.pickupSlot.value,
      note: form.note.value.trim(),
      items: items,
      website: form.website.value,          // 蜜罐,正常為空
      elapsedMs: Date.now() - pageLoadedAt,  // 填表耗時
      turnstileToken: turnstileToken,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";

    fetch(CFG.GAS_URL, {
      method: "POST",
      // text/plain 避免 CORS preflight;GAS 端用 JSON.parse 解析
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok) {
          showSuccess(data, payload);
        } else {
          showError((data && data.error) || "送出失敗，請稍後再試。");
          resetTurnstile();
          resetSubmit();
        }
      })
      .catch(function () {
        // 讀不到回應(CORS)時,退而求其次:視為已送出
        showSuccess({ orderId: "（待確認）" }, payload);
      });
  });

  function resetSubmit() {
    submitBtn.disabled = false;
    submitBtn.textContent = "送出預訂";
  }

  function showSuccess(data, payload) {
    document.getElementById("orderForm").classList.add("hidden");
    var view = document.getElementById("successView");
    view.classList.remove("hidden");
    document.getElementById("successOrderId").textContent = data.orderId || "";

    var lines = payload.items.map(function (v) {
      return "・" + v.filling + "／" + v.topping + "／" + v.packSize + "顆 × " + v.boxes + " 盒";
    });
    document.getElementById("successSummary").innerHTML =
      "<p><b>訂購人：</b>" + esc(payload.customer) + "（" + esc(payload.phone) + "）</p>" +
      "<p><b>取貨：</b>" + esc(payload.pickupDate) + " " + esc(payload.pickupSlot) + "</p>" +
      "<p><b>品項：</b></p><p>" + lines.map(esc).join("<br>") + "</p>" +
      (payload.note ? "<p><b>備註：</b>" + esc(payload.note) + "</p>" : "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  document.getElementById("newOrderBtn").addEventListener("click", function () {
    window.location.reload();
  });

  // ---- 起始 ---------------------------------------------------------
  addCard();
})();
