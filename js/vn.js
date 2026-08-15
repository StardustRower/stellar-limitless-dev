/**
 * 视觉小说壳：同一张 NpcTable，没有走路，没有地牢格子。
 *
 * 左侧立绘、右侧选项。能发生的事仍只来自表。
 * 模型只写 2～3 句。数字和旗标由 applyWorldEffect 裁决。
 */
var VN = {
  seed: "stardust-7",
  npc: null,
  world: null,
  waiting: false,
  time: 0,
  canvas: null,
  ctx: null,
  lastOutcome: "",

  SURVEY_ITEM: "半页测线记录，墨水遇潮发花",
  START_HP: 7,

  boot: function () {
    VN.canvas = document.getElementById("vn-figure");
    VN.ctx = VN.canvas.getContext("2d");
    VN._bindUi();
    VN._fitCanvas();
    window.addEventListener("resize", function () {
      VN._fitCanvas();
      VN.draw();
    });
    var seed = VN._readSeed() || "stardust-7";
    document.getElementById("seed").value = seed;
    VN.startScene(seed);
    requestAnimationFrame(VN._tick);
  },

  _readSeed: function () {
    try {
      var q = new URLSearchParams(location.search).get("seed");
      if (q) return q;
    } catch (e) { /* file:// 下部分浏览器仍可用 */ }
    return "";
  },

  blankWorld: function () {
    return {
      hp: VN.START_HP,
      maxHp: 10,
      inventory: [VN.SURVEY_ITEM],
      warned: false
    };
  },

  startScene: function (seedText) {
    LLM.clearCache();
    if (typeof Memory !== "undefined") Memory.resetStatus();
    VN.seed = String(seedText || "stardust-7").trim() || "stardust-7";
    VN.world = VN.blankWorld();
    VN.npc = NpcTable.makeNpc();
    VN.waiting = false;
    VN.lastOutcome = "";
    document.getElementById("seed").value = VN.seed;
    document.getElementById("seed-echo").textContent = VN.seed;
    VN.syncHud();
    VN.renderOptions();
    var lineEl = document.getElementById("talk-line");
    if (lineEl) lineEl.textContent = "……";
    VN.waiting = true;
    var mem = (typeof Memory !== "undefined" && Memory.hydrate)
      ? Memory.hydrate(VN.npc, VN.seed)
      : Promise.resolve();
    mem.then(function () {
      return VN.openTalk();
    }).catch(function () {
      return VN.openTalk();
    }).finally(function () {
      VN.waiting = false;
      VN.syncHud();
      if (typeof Memory !== "undefined") Memory.syncHud();
    });
  },

  persist: function () {
    if (!VN.npc) return;
    if (VN.npc.state && VN.npc.state !== "idle") VN.npc.met = true;
    VN.npc.last_state = VN.npc.state || VN.npc.last_state || "idle";
    if (typeof Memory !== "undefined" && Memory.rememberLater) {
      Memory.rememberLater(VN.seed, VN.npc);
    }
  },

  openTalk: async function () {
    var npc = VN.npc;
    VN.syncWho();
    if (npc.state === "done") {
      await VN.speak(npc, "reopen", "再看一眼");
      VN.renderOptions();
      VN.persist();
      return;
    }
    if (npc.state === "idle") {
      await VN.enterState("greet", NpcTable.findOption("idle", "open"));
      return;
    }
    VN.renderOptions();
  },

  enterState: async function (nextId, viaOption) {
    var npc = VN.npc;
    var next = NpcTable.stateById(nextId);
    if (!next) return { ok: false, error: "未知状态" };
    var prev = npc.state;
    npc.state = nextId;
    var outcome = NpcTable.applyWorldEffect(npc, next, VN.world);
    if (outcome && outcome.error) {
      npc.state = prev;
      document.getElementById("talk-line").textContent = outcome.error;
      VN.lastOutcome = outcome.error;
      VN.renderOptions();
      VN.syncHud();
      return { ok: false, error: outcome.error };
    }
    VN.syncWho();
    VN.syncHud();
    document.getElementById("talk-line").textContent = "……";
    document.getElementById("talk-options").innerHTML = "";
    await VN.speak(npc, viaOption ? viaOption.id : "open", viaOption ? viaOption.labelZh : "走近");
    if (outcome) {
      VN.lastOutcome = NpcTable.mechanicLine(outcome);
    } else {
      VN.lastOutcome = "";
    }
    VN.syncHud();
    VN.renderOptions();
    VN.persist();
    return { ok: true, outcome: outcome };
  },

  speak: async function (npc, optionId, optionLabel) {
    var st = NpcTable.stateById(npc.state);
    var ctx = {
      seed: VN.seed,
      lang: LLM.loadSettings().lang,
      trigger: "npc_talk",
      roomId: 0,
      kind: "watch",
      nameZh: "哨所",
      nameEn: "Watch post",
      w: 1,
      h: 1,
      x: 0,
      y: 0,
      inventory: VN.world.inventory.slice(),
      npcState: npc.state,
      npcStateZh: st ? st.nameZh : npc.state,
      npcStateEn: st ? st.nameEn : npc.state,
      npcOption: optionId,
      npcOptionLabel: optionLabel || optionId,
      npcNameZh: npc.nameZh,
      npcNameEn: npc.nameEn,
      npcMet: !!npc.met,
      npcTraded: npc.traded,
      npcWarned: npc.warned,
      npcLastState: npc.last_state || "idle",
      hp: VN.world.hp,
      maxHp: VN.world.maxHp
    };
    var result = await LLM.describe(ctx);
    document.getElementById("talk-line").textContent = result.text;
    var src = document.getElementById("line-source");
    if (src) {
      var tag = result.source === "api" ? "API"
        : result.source === "cache" ? "缓存"
          : result.source === "local-fallback" ? "本地回退" : "本地规则";
      if (result.error) tag += " · " + result.error;
      src.textContent = tag;
    }
    return result;
  },

  pick: async function (optionId) {
    if (VN.waiting) return;
    var npc = VN.npc;
    var opt = NpcTable.findOption(npc.state, optionId);
    var lineEl = document.getElementById("talk-line");
    if (!opt) {
      lineEl.textContent = "这一跳不在表里。他不接。";
      return;
    }
    if (!NpcTable.canUseOption(opt, npc, VN.world.inventory)) {
      lineEl.textContent = opt.needSurvey
        ? "没有测线残页，交易这一栏是空的。表拒绝了，不是他在即兴。"
        : "这一跳此刻不准。";
      VN.renderOptions();
      return;
    }
    VN.waiting = true;
    try {
      await VN.enterState(opt.next, opt);
    } finally {
      VN.waiting = false;
    }
  },

  renderOptions: function () {
    var optEl = document.getElementById("talk-options");
    if (!optEl || !VN.npc) return;
    optEl.innerHTML = "";
    var lang = LLM.loadSettings().lang;
    var npc = VN.npc;
    if (npc.state === "done") {
      var again = document.createElement("button");
      again.type = "button";
      again.textContent = lang === "en" ? "Replay this scene" : "重开这一幕";
      again.addEventListener("click", function () { VN.startScene(VN.seed); });
      optEl.appendChild(again);
      return;
    }
    var opts = NpcTable.visibleOptions(npc, VN.world.inventory);
    for (var i = 0; i < opts.length; i++) {
      (function (row) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "talk-opt";
        if (!row.enabled) {
          btn.disabled = true;
          btn.title = lang === "en"
            ? "You need a survey page."
            : "需要测线残页。点「放下残页」可看见表如何拒绝交易。";
        }
        var label = lang === "en" ? row.labelEn : row.labelZh;
        if (lang === "mix") label = row.labelZh + " / " + row.labelEn;
        btn.textContent = label;
        btn.addEventListener("click", function () {
          if (VN.waiting || btn.disabled) return;
          VN.pick(row.id);
        });
        optEl.appendChild(btn);
      })(opts[i]);
    }
  },

  syncWho: function () {
    var npc = VN.npc;
    var whoEl = document.getElementById("talk-who");
    var stateEl = document.getElementById("talk-state");
    if (whoEl && npc) whoEl.textContent = npc.nameZh + " · " + npc.titleZh;
    if (stateEl && npc) {
      var st = NpcTable.stateById(npc.state);
      stateEl.textContent = st ? st.nameZh : npc.state;
    }
  },

  syncHud: function () {
    var w = VN.world;
    var npc = VN.npc;
    var hpEl = document.getElementById("hp-num");
    var fill = document.getElementById("hp-fill");
    if (hpEl && w) hpEl.textContent = String(w.hp);
    if (fill && w) {
      var pct = Math.max(0, Math.min(100, (w.hp / w.maxHp) * 100));
      fill.style.width = pct + "%";
      fill.classList.toggle("is-low", w.hp <= 3);
      fill.classList.toggle("is-ok", w.hp >= 7);
    }
    var bag = document.getElementById("vn-bag");
    if (bag && w) {
      bag.textContent = w.inventory.length ? w.inventory.join(" · ") : "空";
    }
    var flags = document.getElementById("vn-flags");
    if (flags && npc) {
      var bits = [];
      bits.push(npc.met ? "见过面" : "初见");
      bits.push(npc.traded ? "换过油" : "未交易");
      bits.push(npc.warned ? "听过警告" : "未警告");
      bits.push("上次 " + (npc.last_state || "idle"));
      flags.textContent = bits.join(" · ");
    }
    var mech = document.getElementById("vn-mechanic");
    if (mech) mech.textContent = VN.lastOutcome || "数字只来自表，不来自句子。";
    var pageBtn = document.getElementById("toggle-page");
    if (pageBtn && w) {
      var has = NpcTable.hasSurvey(w.inventory);
      pageBtn.textContent = has ? "放下残页" : "捡起残页";
      pageBtn.disabled = !!(npc && npc.traded);
      pageBtn.title = npc && npc.traded
        ? "已经换过油：残页在他那边，这一幕不再发明第二页。"
        : (has ? "放下后，交易按钮会变灰——那是表在拒绝。" : "捡起半页测线记录，交易这一栏才有字。");
    }
    VN.syncWho();
  },

  togglePage: function () {
    if (!VN.world || !VN.npc || VN.npc.traded) return;
    if (NpcTable.hasSurvey(VN.world.inventory)) {
      NpcTable.takeSurvey(VN.world.inventory);
    } else {
      VN.world.inventory.push(VN.SURVEY_ITEM);
    }
    VN.syncHud();
    VN.renderOptions();
  },

  _bindUi: function () {
    document.getElementById("regen").addEventListener("click", function () {
      VN.startScene(document.getElementById("seed").value);
    });
    var modeBtns = document.querySelectorAll("[data-mode]");
    function syncMode() {
      var s = LLM.loadSettings();
      modeBtns.forEach(function (btn) {
        btn.classList.toggle("is-on", btn.getAttribute("data-mode") === s.mode);
      });
      document.getElementById("api-panel").hidden = s.mode !== "api";
      document.getElementById("engine-label").textContent = s.mode === "api" ? "HTTP API" : "本地规则";
    }
    modeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        LLM.saveSettings({ mode: btn.getAttribute("data-mode") });
        LLM.clearCache();
        syncMode();
      });
    });
    document.getElementById("lang").value = LLM.loadSettings().lang;
    document.getElementById("lang").addEventListener("change", function (ev) {
      LLM.saveSettings({ lang: ev.target.value });
      LLM.clearCache();
      VN.renderOptions();
    });
    var s = LLM.loadSettings();
    document.getElementById("api-url").value = s.baseUrl;
    document.getElementById("api-key").value = s.apiKey;
    document.getElementById("api-model").value = s.model;
    document.getElementById("save-api").addEventListener("click", function () {
      LLM.saveSettings({
        baseUrl: document.getElementById("api-url").value.trim(),
        apiKey: document.getElementById("api-key").value.trim(),
        model: document.getElementById("api-model").value.trim() || "gpt-4o-mini"
      });
      document.getElementById("api-saved").textContent = "已保存到本机（不会进仓库）";
      setTimeout(function () { document.getElementById("api-saved").textContent = ""; }, 2200);
    });
    document.getElementById("toggle-api").addEventListener("click", function () {
      var panel = document.getElementById("api-panel");
      panel.hidden = !panel.hidden;
    });
    document.getElementById("toggle-page").addEventListener("click", VN.togglePage);
    document.getElementById("seed").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        VN.startScene(ev.target.value);
      }
    });
    syncMode();
  },

  _fitCanvas: function () {
    if (!VN.canvas) return;
    var wrap = VN.canvas.parentElement;
    var cssW = Math.max(280, wrap.clientWidth);
    var cssH = Math.max(360, wrap.clientHeight);
    var dpr = window.devicePixelRatio || 1;
    VN.canvas.width = Math.floor(cssW * dpr);
    VN.canvas.height = Math.floor(cssH * dpr);
    VN.canvas.style.width = cssW + "px";
    VN.canvas.style.height = cssH + "px";
    VN.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  _tick: function (t) {
    VN.time = t;
    VN.draw();
    requestAnimationFrame(VN._tick);
  },

  draw: function () {
    if (!VN.ctx || !VN.canvas) return;
    var ctx = VN.ctx;
    var w = VN.canvas.clientWidth;
    var h = VN.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    VN._drawCave(ctx, w, h);
    VN._drawOmen(ctx, w, h);
    VN._drawSurveyor(ctx, w, h);
  },

  _drawCave: function (ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1a1614");
    g.addColorStop(0.45, "#12100e");
    g.addColorStop(1, "#0a0908");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    var i;
    for (i = 0; i < 7; i++) {
      var y = h * (0.12 + i * 0.11);
      ctx.strokeStyle = "rgba(58, 49, 38," + (0.35 + (i % 2) * 0.12) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + Math.sin(i * 1.7) * 8);
      ctx.lineTo(w, y + Math.cos(i * 1.3) * 6);
      ctx.stroke();
    }
    var flicker = 0.18 + 0.04 * Math.sin(VN.time / 180);
    var lamp = ctx.createRadialGradient(w * 0.46, h * 0.38, 8, w * 0.42, h * 0.55, w * 0.55);
    lamp.addColorStop(0, "rgba(201, 164, 92," + flicker + ")");
    lamp.addColorStop(1, "rgba(201, 164, 92, 0)");
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, w, h);
  },

  _drawOmen: function (ctx, w, h) {
    if (!VN.npc || !VN.npc.warned) return;
    var pulse = 0.35 + 0.2 * Math.sin(VN.time / 260);
    var cx = w * 0.78;
    var cy = h * 0.42;
    ctx.strokeStyle = "rgba(220, 140, 70," + pulse + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy + 12);
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.stroke();
    ctx.fillStyle = "rgba(220, 140, 70," + (0.25 + 0.15 * Math.sin(VN.time / 200)) + ")";
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.78, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    var drip = (VN.time / 18) % 40;
    ctx.fillStyle = "rgba(220, 140, 70, 0.7)";
    ctx.beginPath();
    ctx.arc(cx, cy + 22 + drip, 2.2, 0, Math.PI * 2);
    ctx.fill();
  },

  _drawSurveyor: function (ctx, w, h) {
    var state = VN.npc ? VN.npc.state : "idle";
    var breath = Math.sin(VN.time / 420) * 3;
    var cx = w * 0.42;
    var feet = h * 0.86;
    var headY = h * 0.28 + breath;
    if (state === "farewell" || state === "done") headY += 6;
    ctx.save();
    ctx.translate(cx, 0);

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, feet + 8, 54, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#3d4f4c";
    ctx.beginPath();
    ctx.moveTo(-36, feet);
    ctx.lineTo(-18, h * 0.52 + breath);
    ctx.lineTo(22, h * 0.52 + breath);
    ctx.lineTo(32, feet);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#7ea8a4";
    ctx.beginPath();
    ctx.moveTo(-28, h * 0.54 + breath);
    ctx.lineTo(-22, h * 0.36 + breath);
    ctx.lineTo(20, h * 0.35 + breath);
    ctx.lineTo(26, h * 0.54 + breath);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#c5ddd8";
    ctx.beginPath();
    ctx.arc(0, headY, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a2118";
    ctx.fillRect(-20, headY - 18, 40, 10);
    ctx.fillStyle = "#1a1612";
    ctx.beginPath();
    ctx.arc(-7, headY + 2, 3, 0, Math.PI * 2);
    ctx.arc(8, headY + 2, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#d7b56a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    var hammerX = state === "warn" ? 48 : 34;
    var hammerY = state === "warn" ? h * 0.40 : h * 0.48;
    ctx.beginPath();
    ctx.moveTo(18, h * 0.50 + breath);
    ctx.lineTo(hammerX, hammerY + breath);
    ctx.stroke();
    ctx.fillStyle = "#8a6d32";
    ctx.save();
    ctx.translate(hammerX, hammerY + breath);
    ctx.rotate(state === "warn" ? -0.6 : 0.2);
    ctx.fillRect(-8, -6, 18, 10);
    ctx.restore();

    ctx.fillStyle = "#2a2116";
    ctx.fillRect(-8, h * 0.48 + breath, 16, 12);
    ctx.strokeStyle = "#c9a45c";
    ctx.lineWidth = 1;
    ctx.strokeRect(-8, h * 0.48 + breath, 16, 12);

    if (VN.npc && VN.npc.traded) {
      ctx.fillStyle = "#c9a45c";
      ctx.beginPath();
      ctx.arc(-40, h * 0.56 + breath, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#eadcc6";
      ctx.fillRect(-43, h * 0.50 + breath, 6, 8);
    }

    ctx.restore();
  }
};

window.addEventListener("DOMContentLoaded", VN.boot);
