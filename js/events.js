/**
 * 事件层：把「踩到格子」翻译成「该生成哪段叙事」。
 *
 * 队列/缓存的目的：叙事必须感觉是立刻出现的。
 * 本地引擎本身就快；API 模式则提前为相邻房间预取。
 * 同一 seed + 同一房间，描述应稳定，所以钥匙交给 LLM 缓存。
 */
var Events = {
  logEl: null,
  statusEl: null,
  inventory: [],
  visitedRooms: {},
  steps: 0,
  lastRoomId: null,
  sourceTag: "local",

  bind: function (logEl, statusEl) {
    Events.logEl = logEl;
    Events.statusEl = statusEl;
  },

  reset: function () {
    Events.inventory = [];
    Events.visitedRooms = {};
    Events.steps = 0;
    Events.lastRoomId = null;
    Events.sourceTag = "local";
    if (Events.logEl) Events.logEl.innerHTML = "";
  },

  pushLog: function (title, body, meta) {
    if (!Events.logEl) return;
    var art = document.createElement("article");
    art.className = "log-entry";
    var h = document.createElement("header");
    var t = document.createElement("strong");
    t.textContent = title;
    var m = document.createElement("span");
    m.className = "log-meta";
    m.textContent = meta || "";
    h.appendChild(t);
    h.appendChild(m);
    var p = document.createElement("p");
    p.textContent = body;
    art.appendChild(h);
    art.appendChild(p);
    Events.logEl.insertBefore(art, Events.logEl.firstChild);
    while (Events.logEl.children.length > 24) {
      Events.logEl.removeChild(Events.logEl.lastChild);
    }
  },

  contextFrom: function (game, extra) {
    var room = extra.room || null;
    return Object.assign({
      seed: game.map.seed,
      lang: LLM.loadSettings().lang,
      trigger: extra.trigger,
      roomId: room ? room.id : extra.roomId != null ? extra.roomId : -1,
      kind: room ? room.kind : extra.kind || "corridor",
      nameZh: room ? room.nameZh : extra.nameZh || "走廊",
      nameEn: room ? room.nameEn : extra.nameEn || "Corridor",
      w: room ? room.w : 1,
      h: room ? room.h : 1,
      x: extra.x,
      y: extra.y,
      inventory: Events.inventory.slice()
    }, extra.more || {});
  },

  prefetchNeighbors: function (game) {
    var map = game.map;
    var seen = {};
    var list = [];
    for (var i = 0; i < map.rooms.length; i++) {
      var r = map.rooms[i];
      if (Events.visitedRooms[r.id]) continue;
      var d = Math.abs(r.cx - game.player.x) + Math.abs(r.cy - game.player.y);
      if (d < 18) {
        seen[r.id] = true;
        list.push(Events.contextFrom(game, {
          trigger: "enter_room",
          room: r,
          x: r.cx,
          y: r.cy
        }));
      }
    }
    LLM.prefetch(list.slice(0, 4));
  },

  applyResult: function (title, result) {
    Events.sourceTag = result.source;
    var meta = result.source === "api" ? "API"
      : result.source === "cache" ? "缓存"
        : result.source === "local-fallback" ? "本地回退" : "本地规则";
    if (result.error) meta += " · " + result.error;
    Events.pushLog(title, result.text, meta);
    Events.refreshStatus(title);
    return result;
  },

  refreshStatus: function (roomTitle) {
    if (!Events.statusEl) return;
    var bag = Events.inventory.length ? Events.inventory.join(" · ") : "空";
    Events.statusEl.textContent = roomTitle + "  ·  步数 " + Events.steps + "  ·  背包 " + bag;
  },

  onStart: async function (game) {
    var room = Dungeon.roomContaining(game.map, game.player.x, game.player.y);
    Events.lastRoomId = room ? room.id : null;
    if (room) Events.visitedRooms[room.id] = true;
    var result = await LLM.describe(Events.contextFrom(game, {
      trigger: "start",
      room: room,
      x: game.player.x,
      y: game.player.y
    }));
    var title = room ? room.nameZh : "入口";
    Events.applyResult(title, result);
    Events.prefetchNeighbors(game);
  },

  onMove: async function (game, x, y, tile) {
    Events.steps += 1;
    var room = Dungeon.roomContaining(game.map, x, y);
    var roomChanged = room && room.id !== Events.lastRoomId;
    if (room) Events.lastRoomId = room.id;
    else Events.lastRoomId = null;

    if (tile === TILE.ITEM) {
      game.map.grid[y][x] = TILE.FLOOR;
      var result = await LLM.describe(Events.contextFrom(game, {
        trigger: "item",
        room: room,
        x: x,
        y: y
      }));
      var itemName = Events._lootName(result.text);
      Events.inventory.push(itemName);
      Events.applyResult("拾获", result);
      Events.prefetchNeighbors(game);
      return "item";
    }

    if (tile === TILE.EVENT) {
      game.map.grid[y][x] = room ? TILE.FLOOR : TILE.CORRIDOR;
      var ev = await LLM.describe(Events.contextFrom(game, {
        trigger: room ? "event" : "corridor",
        room: room,
        kind: room ? room.kind : "corridor",
        nameZh: room ? room.nameZh : "走廊",
        nameEn: room ? room.nameEn : "Corridor",
        x: x,
        y: y
      }));
      Events.applyResult(room ? "异兆 · " + room.nameZh : "走廊异兆", ev);
      return "event";
    }

    if (tile === TILE.EXIT) {
      var ex = await LLM.describe(Events.contextFrom(game, {
        trigger: "exit",
        room: room,
        x: x,
        y: y
      }));
      Events.applyResult("更深一层", ex);
      return "exit";
    }

    if (roomChanged && !Events.visitedRooms[room.id]) {
      Events.visitedRooms[room.id] = true;
      var enter = await LLM.describe(Events.contextFrom(game, {
        trigger: "enter_room",
        room: room,
        x: x,
        y: y
      }));
      Events.applyResult(room.nameZh, enter);
      Events.prefetchNeighbors(game);
      return "room";
    }

    if (room) Events.refreshStatus(room.nameZh);
    else Events.refreshStatus("走廊");
    return "move";
  },

  _lootName: function (text) {
    var zh = text.match(/拣起([^。]+)/);
    if (zh) return zh[1].replace(/^了/, "").slice(0, 16);
    var en = text.match(/you lift ([^.]+)/i);
    if (en) return en[1].slice(0, 24);
    return "不明物件";
  }
};
