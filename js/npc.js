/**
 * 地牢里的测绘员：把共享状态表（js/npc-table.js）接到格子、走近、地图标记上。
 *
 * 表本身不在本文件。Demo 5 的视觉小说读同一份 NpcTable，
 * 改 next / heal，地牢和立绘一起变。本文件只做地牢壳。
 *
 * 请分开记：
 * - 表（js/npc-table.js）：状态、选项、下一跳、交易给哪件物品、治疗几点。
 * - LLM（js/llm.js）：只把「当前状态 + 玩家点了哪一项」写成句子。
 * - 账本（js/memory.js + 可选的 FastAPI）：只记 met / traded / warned / last_state。
 *   下行会扔掉这一局的 JS 对象；旗标若还在账本里，他仍认得你换过油。
 *   失败就失忆。绝不把聊天记录塞进下一层的提示词。
 *
 * 测绘员是叠加层：生成地牢时不掷骰、不改格子。
 * 所以同一颗种子仍是同一张图，只是哨所（或圣所）多站了一个人。
 */
var NPC = (function () {
  var TABLE = NpcTable.TABLE;
  var LINES = NpcTable.LINES;
  var OIL_ZH = NpcTable.OIL_ZH;
  var TRADE_HEAL = NpcTable.TRADE_HEAL;

  var panel = null;
  var lineEl = null;
  var optEl = null;
  var whoEl = null;
  var stateEl = null;
  var open = false;
  var waiting = false;
  var wasAdjacent = false;

  var stateById = NpcTable.stateById;
  var hasSurvey = NpcTable.hasSurvey;
  var findOption = NpcTable.findOption;
  var canUseOption = NpcTable.canUseOption;
  var visibleOptions = NpcTable.visibleOptions;

  /**
   * 落点：优先哨所，其次残破圣所，再退到非入口、非出口的第一间房。
   * 不调用地牢那把 RNG，只扫已经生成好的房间列表——布局不变。
   */
  function pickRoom(map) {
    var watch = null;
    var shrine = null;
    var i;
    for (i = 0; i < map.rooms.length; i++) {
      var r = map.rooms[i];
      if (r.kind === "watch" && !watch) watch = r;
      if (r.kind === "shrine" && !shrine) shrine = r;
    }
    if (watch) return watch;
    if (shrine) return shrine;
    var exitRoom = Dungeon.roomContaining(map, map.exit.x, map.exit.y);
    var exitId = exitRoom ? exitRoom.id : -1;
    for (i = 0; i < map.rooms.length; i++) {
      if (map.rooms[i].id === 0) continue;
      if (map.rooms[i].id === exitId) continue;
      return map.rooms[i];
    }
    return map.rooms[0];
  }

  function pickCell(map, room) {
    var best = null;
    var bestD = 1e9;
    var y;
    var x;
    for (y = room.y; y < room.y + room.h; y++) {
      for (x = room.x; x < room.x + room.w; x++) {
        if (map.grid[y][x] !== TILE.FLOOR) continue;
        var d = Math.abs(x - room.cx) + Math.abs(y - room.cy);
        if (d < bestD) {
          bestD = d;
          best = { x: x, y: y };
        }
      }
    }
    if (best) return best;
    for (y = room.y; y < room.y + room.h; y++) {
      for (x = room.x; x < room.x + room.w; x++) {
        if (Dungeon.walkable(map, x, y)) {
          if (x === map.entrance.x && y === map.entrance.y) continue;
          if (x === map.exit.x && y === map.exit.y) continue;
          return { x: x, y: y };
        }
      }
    }
    return { x: room.cx, y: room.cy };
  }

  function place(map) {
    if (!map || !map.rooms || !map.rooms.length) {
      map.npc = null;
      return null;
    }
    var room = pickRoom(map);
    var cell = pickCell(map, room);
    map.npc = NpcTable.makeNpc({
      x: cell.x,
      y: cell.y,
      roomId: room.id,
      kind: room.kind,
      roomNameZh: room.nameZh,
      roomNameEn: room.nameEn
    });
    return map.npc;
  }

  function resetRuntime() {
    open = false;
    waiting = false;
    wasAdjacent = false;
    if (panel) panel.hidden = true;
    if (optEl) optEl.innerHTML = "";
    if (typeof Game !== "undefined") Game.talking = false;
  }

  function isAdjacent(game) {
    if (!game || !game.map || !game.map.npc) return false;
    var n = game.map.npc;
    var dx = Math.abs(game.player.x - n.x);
    var dy = Math.abs(game.player.y - n.y);
    return Math.max(dx, dy) <= 1;
  }

  function isVisible(game) {
    if (!game || !game.map || !game.map.npc) return false;
    if (typeof game._isVisible !== "function") return true;
    return game._isVisible(game.map.npc.x, game.map.npc.y);
  }

  function bind() {
    panel = document.getElementById("talk-panel");
    lineEl = document.getElementById("talk-line");
    optEl = document.getElementById("talk-options");
    whoEl = document.getElementById("talk-who");
    stateEl = document.getElementById("talk-state");
  }

  function setTalking(on) {
    if (typeof Game !== "undefined") Game.talking = !!on;
  }

  var localLine = NpcTable.localLine;

  function applyEffect(npc, stateObj, game) {
    var outcome = NpcTable.applyWorldEffect(npc, stateObj, Events);
    if (outcome && outcome.type === "warn" && !outcome.skipped && !outcome.error) {
      Events.warned = true;
      var mark = markNearestEvent(game);
      Events.warnedEvent = mark;
      outcome.marked = mark;
    }
    return outcome;
  }

  function markNearestEvent(game) {
    if (!game || !game.map || !game.map.events) return null;
    var best = null;
    var bestD = 1e9;
    var px = game.player.x;
    var py = game.player.y;
    for (var i = 0; i < game.map.events.length; i++) {
      var e = game.map.events[i];
      if (game.map.grid[e.y][e.x] !== TILE.EVENT) continue;
      var d = Math.abs(e.x - px) + Math.abs(e.y - py);
      if (e.corridor) d -= 2;
      if (d < bestD) {
        bestD = d;
        best = { x: e.x, y: e.y, corridor: !!e.corridor };
      }
    }
    if (best) {
      for (var j = 0; j < game.map.events.length; j++) {
        if (game.map.events[j].x === best.x && game.map.events[j].y === best.y) {
          game.map.events[j].warned = true;
        }
      }
    }
    return best;
  }

  var mechanicLine = NpcTable.mechanicLine;

  function syncWho(npc) {
    if (whoEl && npc) {
      whoEl.textContent = npc.nameZh + " · " + npc.titleZh;
    }
    if (stateEl && npc) {
      var st = stateById(npc.state);
      stateEl.textContent = st ? st.nameZh : npc.state;
    }
  }

  function renderOptions(game, npc) {
    if (!optEl) return;
    optEl.innerHTML = "";
    var lang = LLM.loadSettings().lang;
    var opts = visibleOptions(npc, Events.inventory);
    if (npc.state === "done") {
      var doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.textContent = lang === "en" ? "Leave" : "离开";
      doneBtn.addEventListener("click", function () { closeTalk(); });
      optEl.appendChild(doneBtn);
      return;
    }
    for (var i = 0; i < opts.length; i++) {
      (function (row) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "talk-opt";
        if (!row.enabled) {
          btn.disabled = true;
          btn.title = lang === "en"
            ? "You need a survey page (omen or loot)."
            : "需要测线残页（异兆换物或拾获里可能出现）。";
        }
        var label = lang === "en" ? row.labelEn : row.labelZh;
        if (lang === "mix") label = row.labelZh + " / " + row.labelEn;
        btn.textContent = label;
        btn.addEventListener("click", function () {
          if (waiting || btn.disabled) return;
          pick(game, row.id);
        });
        optEl.appendChild(btn);
      })(opts[i]);
    }
  }

  async function speak(game, npc, optionId, optionLabel) {
    var st = stateById(npc.state);
    var ctx = Events.contextFrom(game, {
      trigger: "npc_talk",
      room: Dungeon.roomContaining(game.map, npc.x, npc.y),
      x: npc.x,
      y: npc.y,
      more: {
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
        hp: Events.hp,
        maxHp: Events.maxHp
      }
    });
    var result = await LLM.describe(ctx);
    var title = npc.nameZh + " · " + (st ? st.nameZh : npc.state);
    Events.applyResult(title, result, "对话");
    if (lineEl) lineEl.textContent = result.text;
    return result;
  }

  async function enterState(game, npc, nextId, viaOption) {
    var next = stateById(nextId);
    if (!next) return { ok: false, error: "未知状态" };
    if (nextId === "done") {
      npc.state = "done";
      persistFlags(game, npc);
      closeTalk();
      return { ok: true };
    }
    var prev = npc.state;
    npc.state = nextId;
    var outcome = applyEffect(npc, next, game);
    if (outcome && outcome.error) {
      npc.state = prev;
      if (lineEl) lineEl.textContent = outcome.error;
      renderOptions(game, npc);
      return { ok: false, error: outcome.error };
    }
    Events.syncHud(next.nameZh);
    if (typeof Game !== "undefined") Game.draw();
    syncWho(npc);
    if (lineEl) lineEl.textContent = "……";
    if (optEl) optEl.innerHTML = "";
    await speak(game, npc, viaOption ? viaOption.id : "open", viaOption ? viaOption.labelZh : "走近");
    if (outcome) {
      var mech = mechanicLine(outcome);
      if (mech && Events.statusEl) {
        Events.refreshStatus(npc.roomNameZh || "哨所");
      }
      if (mech) {
        var last = Events.logEl && Events.logEl.firstChild;
        if (last) {
          var meta = last.querySelector(".log-meta");
          if (meta) meta.textContent = (meta.textContent ? meta.textContent + " · " : "") + mech;
        }
      }
    }
    renderOptions(game, npc);
    persistFlags(game, npc);
    return { ok: true, outcome: outcome };
  }

  function persistFlags(game, npc) {
    if (!npc) return;
    if (npc.state && npc.state !== "idle") npc.met = true;
    npc.last_state = npc.state || npc.last_state || "idle";
    if (typeof Memory === "undefined" || !Memory.rememberLater) return;
    var seed = game && game.map ? game.map.seed : "";
    Memory.rememberLater(seed, npc);
  }

  async function pick(game, optionId) {
    if (waiting) return;
    var npc = game.map && game.map.npc;
    if (!npc) return;
    var opt = findOption(npc.state, optionId);
    if (!opt) {
      if (lineEl) lineEl.textContent = "这一跳不在表里。他不接。";
      return;
    }
    if (!canUseOption(opt, npc, Events.inventory)) {
      if (lineEl) {
        lineEl.textContent = opt.needSurvey
          ? "没有测线残页，交易这一栏是空的。他等你从异兆或尘土里带来那半页。"
          : "这一跳此刻不准。";
      }
      renderOptions(game, npc);
      return;
    }
    waiting = true;
    setTalking(true);
    try {
      await enterState(game, npc, opt.next, opt);
    } finally {
      waiting = false;
    }
  }

  async function openTalk(game, fromKey) {
    if (!game || !game.map || !game.map.npc) return;
    bind();
    var npc = game.map.npc;
    if (typeof Memory !== "undefined" && Memory.hydrate) {
      try {
        await Memory.hydrate(npc, game.map.seed);
      } catch (err) { /* 失忆：用这一局还记得的旗标继续 */ }
    }
    open = true;
    setTalking(true);
    if (panel) panel.hidden = false;
    syncWho(npc);
    if (npc.state === "done") {
      npc.state = "done";
      syncWho(npc);
      if (lineEl) lineEl.textContent = "……";
      waiting = true;
      try {
        await speak(game, npc, "reopen", "再看一眼");
      } finally {
        waiting = false;
      }
      renderOptions(game, npc);
      persistFlags(game, npc);
      return;
    }
    if (npc.state === "idle") {
      waiting = true;
      try {
        await enterState(game, npc, "greet", findOption("idle", "open"));
      } finally {
        waiting = false;
      }
      return;
    }
    if (lineEl && !lineEl.textContent) lineEl.textContent = "……";
    renderOptions(game, npc);
  }

  function closeTalk() {
    open = false;
    waiting = false;
    if (panel) panel.hidden = true;
    if (optEl) optEl.innerHTML = "";
    setTalking(false);
    var npc = typeof Game !== "undefined" && Game.map ? Game.map.npc : null;
    if (npc && npc.state === "greet") {
      npc.state = "idle";
    }
    if (npc && typeof Game !== "undefined") persistFlags(Game, npc);
    if (typeof Game !== "undefined") Game.draw();
  }

  function cancelIfGreeting() {
    var npc = typeof Game !== "undefined" && Game.map ? Game.map.npc : null;
    if (!open) return false;
    if (waiting) return true;
    if (npc && npc.state === "greet") {
      closeTalk();
      return true;
    }
    return open;
  }

  function afterMove(game) {
    var adj = isAdjacent(game);
    var became = adj && !wasAdjacent;
    wasAdjacent = adj;
    if (!became) return;
    if (!game.map || !game.map.npc) return;
    if (open) return;
    if (game.over || Events.dead) return;
    if (game.map.npc.state === "done") return;
    openTalk(game, "approach");
  }

  function tryKeyTalk(game) {
    if (!isAdjacent(game)) return false;
    if (open) return true;
    openTalk(game, "key");
    return true;
  }

  function hintText(game) {
    if (!game || !game.map || !game.map.npc) return "";
    var npc = game.map.npc;
    var vis = !game.fovOn || (typeof game._isVisible === "function" && game._isVisible(npc.x, npc.y));
    if (vis) {
      if (isAdjacent(game)) {
        return open ? "正在交谈 · Esc 仅问候时可先离开" : "测绘员就在身旁 · 按 E 交谈";
      }
      return "火把里有人 · 走近或按 E";
    }
    if (typeof game._isExplored === "function" && game._isExplored(npc.x, npc.y)) {
      return "记得这里站过一个人";
    }
    return "";
  }

  return {
    TABLE: TABLE,
    LINES: LINES,
    TRADE_HEAL: TRADE_HEAL,
    OIL_ZH: OIL_ZH,
    place: place,
    resetRuntime: resetRuntime,
    bind: bind,
    isAdjacent: isAdjacent,
    isVisible: isVisible,
    isOpen: function () { return open; },
    isWaiting: function () { return waiting; },
    hasSurvey: hasSurvey,
    findOption: findOption,
    canUseOption: canUseOption,
    visibleOptions: visibleOptions,
    localLine: localLine,
    openTalk: openTalk,
    closeTalk: closeTalk,
    cancelIfGreeting: cancelIfGreeting,
    afterMove: afterMove,
    tryKeyTalk: tryKeyTalk,
    pick: pick,
    hintText: hintText,
    stateById: stateById
  };
})();
