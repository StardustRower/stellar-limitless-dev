/**
 * 游戏主循环：输入 → 移动 → 事件 → 绘制。
 * 格子移动没有物理引擎：玩家每次只走一格，撞墙就停。
 */
var Game = {
  canvas: null,
  ctx: null,
  map: null,
  player: { x: 0, y: 0 },
  tile: 16,
  origin: { x: 0, y: 0 },
  time: 0,
  busy: false,
  reachedExit: false,
  over: false,
  fovOn: true,
  explored: null,
  visible: null,

  boot: function () {
    Game.canvas = document.getElementById("dungeon");
    Game.ctx = Game.canvas.getContext("2d");
    Events.bind(document.getElementById("log"), document.getElementById("status"));
    Game._bindUi();
    Game._bindKeys();
    window.addEventListener("resize", function () { Game._fitCanvas(); Game.draw(); });
    var seed = Game._readSeed() || "stardust-7";
    document.getElementById("seed").value = seed;
    Game.newRun(seed);
    requestAnimationFrame(Game._tick);
  },

  _readSeed: function () {
    try {
      var q = new URLSearchParams(location.search).get("seed");
      if (q) return q;
    } catch (e) { /* file:// 下部分浏览器仍可用 */ }
    return "";
  },

  newRun: function (seedText) {
    LLM.clearCache();
    Events.reset();
    Game.reachedExit = false;
    Game.over = false;
    Game.map = Dungeon.generate(seedText);
    Game.player.x = Game.map.entrance.x;
    Game.player.y = Game.map.entrance.y;
    Game.explored = FOV.blank(Game.map.width, Game.map.height, false);
    Game._refreshFov();
    document.getElementById("seed").value = Game.map.seed;
    document.getElementById("seed-echo").textContent = Game.map.seed;
    document.getElementById("room-count").textContent = String(Game.map.rooms.length);
    Game._fitCanvas();
    Game.draw();
    Game.busy = true;
    Events.onStart(Game).finally(function () {
      Game.busy = false;
      Game.draw();
    });
  },

  _refreshFov: function () {
    if (!Game.map) return;
    Game.visible = FOV.compute(Game.map, Game.player.x, Game.player.y, FOV.RADIUS, Game.explored);
  },

  _isVisible: function (x, y) {
    return Game.visible && Game.visible[y] && Game.visible[y][x];
  },

  _isExplored: function (x, y) {
    return Game.explored && Game.explored[y] && Game.explored[y][x];
  },

  _fitCanvas: function () {
    var wrap = Game.canvas.parentElement;
    var maxW = Math.max(320, wrap.clientWidth - 8);
    var maxH = Math.max(280, wrap.clientHeight - 8);
    var tw = Math.floor(maxW / Game.map.width);
    var th = Math.floor(maxH / Game.map.height);
    Game.tile = Math.max(10, Math.min(22, tw, th));
    var cssW = Game.map.width * Game.tile;
    var cssH = Game.map.height * Game.tile;
    var dpr = window.devicePixelRatio || 1;
    Game.canvas.width = Math.floor(cssW * dpr);
    Game.canvas.height = Math.floor(cssH * dpr);
    Game.canvas.style.width = cssW + "px";
    Game.canvas.style.height = cssH + "px";
    Game.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Game.origin.x = 0;
    Game.origin.y = 0;
  },

  tryMove: function (dx, dy) {
    if (Game.busy || Game.over || Events.dead) return;
    var x = Game.player.x + dx;
    var y = Game.player.y + dy;
    if (!Dungeon.walkable(Game.map, x, y)) return;
    var tile = Game.map.grid[y][x];
    Game.player.x = x;
    Game.player.y = y;
    Game._refreshFov();
    Game.draw();
    Events.onMove(Game, x, y, tile).then(function (kind) {
      if (kind === "exit") Game.reachedExit = true;
      if (kind === "dead") Game.over = true;
      Game._refreshFov();
      Game.draw();
    });
  },

  _bindKeys: function () {
    var map = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0],
      W: [0, -1], A: [-1, 0], S: [0, 1], D: [1, 0]
    };
    document.addEventListener("keydown", function (ev) {
      if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT" || ev.target.tagName === "TEXTAREA")) {
        if (ev.key === "Enter" && ev.target.id === "seed") {
          ev.preventDefault();
          Game.newRun(ev.target.value);
        }
        return;
      }
      if (ev.key === "Enter" && Game.reachedExit && !Game.over) {
        ev.preventDefault();
        Game.newRun(Game.map.seed + "-down");
        return;
      }
      if (ev.key === "f" || ev.key === "F") {
        ev.preventDefault();
        Game._setFovOn(!Game.fovOn);
        return;
      }
      var d = map[ev.key];
      if (!d) return;
      ev.preventDefault();
      Game.tryMove(d[0], d[1]);
    });
  },

  _bindUi: function () {
    document.getElementById("regen").addEventListener("click", function () {
      Game.newRun(document.getElementById("seed").value);
    });
    document.getElementById("random-seed").addEventListener("click", function () {
      var s = "vein-" + Math.floor(Math.random() * 9000 + 1000);
      document.getElementById("seed").value = s;
      Game.newRun(s);
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
    var fovBtn = document.getElementById("toggle-fov");
    if (fovBtn) {
      fovBtn.addEventListener("click", function () {
        Game._setFovOn(!Game.fovOn);
      });
    }
    Game._syncFovButton();
    syncMode();
  },

  _setFovOn: function (on) {
    Game.fovOn = !!on;
    Game._syncFovButton();
    Game.draw();
  },

  _syncFovButton: function () {
    var btn = document.getElementById("toggle-fov");
    if (!btn) return;
    btn.classList.toggle("is-on", Game.fovOn);
    btn.textContent = Game.fovOn ? "火把视野" : "全图（学习）";
    btn.title = Game.fovOn
      ? "默认：只看见火把半径。点此显示全图（学习/调试，不会把全图记成已探索）。"
      : "正在显示全图。点此回到火把视野。";
  },

  _hash: function (x, y) {
    var n = (x * 73856093) ^ (y * 19349663) ^ Game.map.seed.length * 83492791;
    n = Math.imul(n ^ (n >>> 16), 2246822507);
    return (n >>> 0) / 4294967296;
  },

  _tick: function (t) {
    Game.time = t;
    Game.draw();
    requestAnimationFrame(Game._tick);
  },

  draw: function () {
    if (!Game.map) return;
    var ctx = Game.ctx;
    var t = Game.tile;
    var w = Game.map.width;
    var h = Game.map.height;
    ctx.clearRect(0, 0, w * t, h * t);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w * t, h * t);

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var vis = !Game.fovOn || Game._isVisible(x, y);
        var mem = Game.fovOn && !vis && Game._isExplored(x, y);
        if (Game.fovOn && !vis && !mem) continue;
        Game._drawTile(x, y, mem);
        if (vis && Game.fovOn) Game._drawFalloff(x, y);
      }
    }
    Game._drawPlayer();
    if (!Game.fovOn) Game._drawVignette();
  },

  _drawFalloff: function (x, y) {
    var dx = x - Game.player.x;
    var dy = y - Game.player.y;
    var fall = Math.sqrt(dx * dx + dy * dy) / FOV.RADIUS;
    if (fall <= 0) return;
    var a = Math.min(0.62, fall * fall * 0.72);
    Game.ctx.fillStyle = "rgba(0,0,0," + a + ")";
    Game.ctx.fillRect(x * Game.tile, y * Game.tile, Game.tile, Game.tile);
  },

  _drawTile: function (x, y, memory) {
    var ctx = Game.ctx;
    var t = Game.tile;
    var px = x * t;
    var py = y * t;
    var kind = Game.map.grid[y][x];
    var n = Game._hash(x, y);
    var room = Game.map.roomAt[y][x];

    ctx.save();
    if (memory) ctx.globalAlpha = 0.4;

    if (kind === TILE.WALL) {
      var shade = 18 + Math.floor(n * 14);
      ctx.fillStyle = "rgb(" + shade + "," + (shade - 3) + "," + (shade - 6) + ")";
      ctx.fillRect(px, py, t, t);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(px, py, t, 1);
      ctx.restore();
      if (memory) {
        ctx.fillStyle = "rgba(8, 10, 16, 0.45)";
        ctx.fillRect(px, py, t, t);
      }
      return;
    }

    if (kind === TILE.CORRIDOR) {
      var c = 42 + Math.floor(n * 12);
      ctx.fillStyle = "rgb(" + c + "," + (c - 4) + "," + (c - 10) + ")";
    } else {
      var warm = room >= 0 ? 58 + Math.floor(n * 16) : 50;
      ctx.fillStyle = "rgb(" + (warm + 8) + "," + (warm - 2) + "," + (warm - 18) + ")";
    }
    ctx.fillRect(px, py, t, t);
    if (n > 0.82) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(px + 2, py + 2, 2, 2);
    }

    if (kind === TILE.ENTRANCE) Game._stairs(px, py, t, "#d7b56a");
    if (kind === TILE.EXIT) Game._stairs(px, py, t, "#7ec8c4");
    if (kind === TILE.ITEM) Game._gem(px, py, t, "#e2b84a", memory);
    if (kind === TILE.EVENT) Game._rune(px, py, t, memory);
    ctx.restore();
    if (memory) {
      ctx.fillStyle = "rgba(8, 12, 20, 0.5)";
      ctx.fillRect(px, py, t, t);
    }
  },

  _stairs: function (px, py, t, color) {
    var ctx = Game.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (var i = 1; i <= 3; i++) {
      var inset = 3 + i * 2;
      ctx.strokeRect(px + inset, py + inset, t - inset * 2, t - inset * 2);
    }
  },

  _gem: function (px, py, t, color, memory) {
    var ctx = Game.ctx;
    var cx = px + t / 2;
    var cy = py + t / 2;
    var r = Math.max(2.5, t * 0.18);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    if (!memory) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
    }
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  },

  _rune: function (px, py, t, memory) {
    var ctx = Game.ctx;
    var cx = px + t / 2;
    var cy = py + t / 2;
    var pulse = memory ? 0.28 : 0.45 + 0.25 * Math.sin(Game.time / 280 + px);
    ctx.strokeStyle = "rgba(186, 132, 232," + pulse + ")";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - t * 0.16);
    ctx.lineTo(cx, cy + t * 0.16);
    ctx.stroke();
  },

  _drawPlayer: function () {
    var ctx = Game.ctx;
    var t = Game.tile;
    var cx = Game.player.x * t + t / 2;
    var cy = Game.player.y * t + t / 2;
    var flicker = 0.55 + 0.15 * Math.sin(Game.time / 140);
    if (Game.over) flicker = 0.15;
    var glowR = Game.fovOn ? t * 3.2 : t * 2.4;
    var g = ctx.createRadialGradient(cx, cy, 2, cx, cy, glowR);
    g.addColorStop(0, "rgba(232, 176, 84," + (0.28 * flicker) + ")");
    g.addColorStop(1, "rgba(232, 176, 84, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = Game.over ? "#6a5340" : "#f3d7a0";
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, t * 0.28), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a1c0e";
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.2, t * 0.1), 0, Math.PI * 2);
    ctx.fill();
  },

  _drawVignette: function () {
    var ctx = Game.ctx;
    var w = Game.map.width * Game.tile;
    var h = Game.map.height * Game.tile;
    var g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.25, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
};

window.addEventListener("DOMContentLoaded", Game.boot);
