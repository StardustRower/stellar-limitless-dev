/**
 * BSP 地牢生成（Binary Space Partitioning，二叉空间分割）
 *
 * 大白话：先把整张地图当成一块大石头，反复切成两半，
 * 直到碎块够小，再在每块里掏一个房间，最后沿切割线挖走廊连起来。
 *
 * 为什么选 BSP，而不是醉汉漫步（drunkard-walk）挖洞穴？
 * 1. 房间边界清晰——玩家「走进一间房」这件事很好检测，方便触发叙事。
 * 2. 走廊是一等公民，入口/出口/事件格有地方放。
 * 3. 只要 RNG 相同，切割点就相同，地图可复现。
 *
 * 连通性保证：按分割树把兄弟区域连起来，整张图一定连通，不会出现孤岛。
 */
var TILE = {
  WALL: 0,
  FLOOR: 1,
  CORRIDOR: 2,
  ENTRANCE: 3,
  EXIT: 4,
  ITEM: 5,
  EVENT: 6
};

var TILE_WALKABLE = {};
TILE_WALKABLE[TILE.FLOOR] = true;
TILE_WALKABLE[TILE.CORRIDOR] = true;
TILE_WALKABLE[TILE.ENTRANCE] = true;
TILE_WALKABLE[TILE.EXIT] = true;
TILE_WALKABLE[TILE.ITEM] = true;
TILE_WALKABLE[TILE.EVENT] = true;

var ROOM_KINDS = [
  { id: "crypt", zh: "墓室", en: "Crypt" },
  { id: "hall", zh: "石厅", en: "Hall" },
  { id: "shrine", zh: "残破圣所", en: "Shrine" },
  { id: "store", zh: "储藏室", en: "Storeroom" },
  { id: "library", zh: "塌半边的藏书室", en: "Ruined Library" },
  { id: "armory", zh: "武器库", en: "Armory" },
  { id: "cistern", zh: "蓄水厅", en: "Cistern" },
  { id: "fissure", zh: "裂隙厅", en: "Fissure Chamber" },
  { id: "altar", zh: "祭坛", en: "Altar" },
  { id: "watch", zh: "哨所", en: "Watch Post" },
  { id: "fungal", zh: "真菌洞", en: "Fungal Hollow" },
  { id: "starchart", zh: "星图密室", en: "Star-chart Vault" },
  { id: "vein", zh: "矿脉厅", en: "Ore Vein Hall" },
  { id: "core", zh: "岩芯室", en: "Core Sample Vault" },
  { id: "fault", zh: "断层廊厅", en: "Fault Gallery" }
];

var Dungeon = {
  WIDTH: 53,
  HEIGHT: 37,
  MAX_DEPTH: 4,
  MIN_LEAF: 10,

  generate: function (seedText) {
    var rng = RNG.fromSeed(seedText);
    var w = Dungeon.WIDTH;
    var h = Dungeon.HEIGHT;
    var grid = Dungeon._filled(w, h, TILE.WALL);
    var root = { x: 1, y: 1, w: w - 2, h: h - 2, left: null, right: null, room: null };

    Dungeon._split(root, Dungeon.MAX_DEPTH, rng);
    Dungeon._placeRooms(root, rng);
    Dungeon._connectTree(root, grid, rng);

    var rooms = [];
    Dungeon._collectRooms(root, rooms);
    if (rooms.length === 0) {
      return Dungeon.generate(seedText + "-retry");
    }

    Dungeon._carveRooms(grid, rooms);
    Dungeon._extraLoops(grid, rooms, rng);

    var roomAt = Dungeon._filled(w, h, -1);
    for (var i = 0; i < rooms.length; i++) {
      Dungeon._stampRoomLookup(roomAt, rooms[i]);
    }

    var startRoom = rooms[0];
    var exitRoom = Dungeon._farthestRoom(rooms, startRoom);
    var entrance = { x: startRoom.cx, y: startRoom.cy };
    var exit = { x: exitRoom.cx, y: exitRoom.cy };
    grid[entrance.y][entrance.x] = TILE.ENTRANCE;
    if (exit.x !== entrance.x || exit.y !== entrance.y) {
      grid[exit.y][exit.x] = TILE.EXIT;
    }

    var items = Dungeon._scatter(grid, rooms, rng, TILE.ITEM, rng.int(4, 7), entrance, exit);
    var events = Dungeon._scatter(grid, rooms, rng, TILE.EVENT, rng.int(3, 5), entrance, exit);
    Dungeon._maybeCorridorEvents(grid, roomAt, rng, events, 2);

    return {
      seed: rng.seedText,
      width: w,
      height: h,
      grid: grid,
      rooms: rooms,
      roomAt: roomAt,
      entrance: entrance,
      exit: exit,
      items: items,
      events: events
    };
  },

  walkable: function (map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    return !!TILE_WALKABLE[map.grid[y][x]];
  },

  roomContaining: function (map, x, y) {
    var id = map.roomAt[y] && map.roomAt[y][x];
    if (id == null || id < 0) return null;
    return map.rooms[id] || null;
  },

  serializeGrid: function (map) {
    return map.grid.map(function (row) { return row.join(""); }).join("\n");
  },

  _filled: function (w, h, value) {
    var g = [];
    for (var y = 0; y < h; y++) {
      g[y] = [];
      for (var x = 0; x < w; x++) g[y][x] = value;
    }
    return g;
  },

  /**
   * 递归切分。优先切开更长的边，房间才不会又瘦又长、像走廊。
   * 切点避开边缘，否则会出现「一条缝宽的废区域」。
   */
  _split: function (node, depth, rng) {
    if (depth <= 0) return;
    var min = Dungeon.MIN_LEAF;
    var canV = node.w >= min * 2;
    var canH = node.h >= min * 2;
    if (!canV && !canH) return;

    var dir;
    if (canV && canH) {
      if (node.w > node.h * 1.2) dir = "v";
      else if (node.h > node.w * 1.2) dir = "h";
      else dir = rng.chance(0.5) ? "v" : "h";
    } else {
      dir = canV ? "v" : "h";
    }

    if (dir === "v") {
      var splitX = rng.int(node.x + min, node.x + node.w - min);
      node.left = { x: node.x, y: node.y, w: splitX - node.x, h: node.h, left: null, right: null, room: null };
      node.right = { x: splitX, y: node.y, w: node.x + node.w - splitX, h: node.h, left: null, right: null, room: null };
    } else {
      var splitY = rng.int(node.y + min, node.y + node.h - min);
      node.left = { x: node.x, y: node.y, w: node.w, h: splitY - node.y, left: null, right: null, room: null };
      node.right = { x: node.x, y: splitY, w: node.w, h: node.y + node.h - splitY, left: null, right: null, room: null };
    }
    Dungeon._split(node.left, depth - 1, rng);
    Dungeon._split(node.right, depth - 1, rng);
  },

  _placeRooms: function (node, rng) {
    if (node.left && node.right) {
      Dungeon._placeRooms(node.left, rng);
      Dungeon._placeRooms(node.right, rng);
      return;
    }
    var pad = 1;
    var maxW = node.w - pad * 2;
    var maxH = node.h - pad * 2;
    if (maxW < 4 || maxH < 4) return;
    var rw = rng.int(4, maxW);
    var rh = rng.int(4, maxH);
    var rx = node.x + pad + rng.int(0, maxW - rw);
    var ry = node.y + pad + rng.int(0, maxH - rh);
    var kind = rng.pick(ROOM_KINDS);
    node.room = {
      id: -1,
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      cx: rx + Math.floor(rw / 2),
      cy: ry + Math.floor(rh / 2),
      kind: kind.id,
      nameZh: kind.zh,
      nameEn: kind.en
    };
  },

  _collectRooms: function (node, out) {
    if (node.room) {
      node.room.id = out.length;
      out.push(node.room);
      return;
    }
    if (node.left) Dungeon._collectRooms(node.left, out);
    if (node.right) Dungeon._collectRooms(node.right, out);
  },

  _carveRooms: function (grid, rooms) {
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      for (var y = r.y; y < r.y + r.h; y++) {
        for (var x = r.x; x < r.x + r.w; x++) {
          grid[y][x] = TILE.FLOOR;
        }
      }
    }
  },

  _carveCell: function (grid, x, y) {
    if (y < 1 || x < 1 || y >= grid.length - 1 || x >= grid[0].length - 1) return;
    if (grid[y][x] === TILE.WALL) grid[y][x] = TILE.CORRIDOR;
  },

  _carveH: function (grid, x1, x2, y) {
    var a = Math.min(x1, x2);
    var b = Math.max(x1, x2);
    for (var x = a; x <= b; x++) Dungeon._carveCell(grid, x, y);
  },

  _carveV: function (grid, y1, y2, x) {
    var a = Math.min(y1, y2);
    var b = Math.max(y1, y2);
    for (var y = a; y <= b; y++) Dungeon._carveCell(grid, x, y);
  },

  /** L 形走廊：先横后竖或先竖后横，由 RNG 决定，避免所有路都一个拐法。 */
  _carveCorridor: function (grid, x1, y1, x2, y2, rng) {
    if (rng.chance(0.5)) {
      Dungeon._carveH(grid, x1, x2, y1);
      Dungeon._carveV(grid, y1, y2, x2);
    } else {
      Dungeon._carveV(grid, y1, y2, x1);
      Dungeon._carveH(grid, x1, x2, y2);
    }
  },

  _anyRoom: function (node) {
    if (node.room) return node.room;
    if (node.left) {
      var r = Dungeon._anyRoom(node.left);
      if (r) return r;
    }
    if (node.right) return Dungeon._anyRoom(node.right);
    return null;
  },

  _connectTree: function (node, grid, rng) {
    if (!node.left || !node.right) return;
    Dungeon._connectTree(node.left, grid, rng);
    Dungeon._connectTree(node.right, grid, rng);
    var a = Dungeon._anyRoom(node.left);
    var b = Dungeon._anyRoom(node.right);
    if (a && b) Dungeon._carveCorridor(grid, a.cx, a.cy, b.cx, b.cy, rng);
  },

  /**
   * BSP 默认是一棵树：没有环，原路返回很多。
   * 偶尔在邻近房间之间再挖一条走廊，探索更舒服，仍由种子决定挖不挖。
   */
  _extraLoops: function (grid, rooms, rng) {
    var extra = Math.min(2, Math.floor(rooms.length / 4));
    for (var n = 0; n < extra; n++) {
      if (rooms.length < 2) break;
      var a = rng.pick(rooms);
      var best = null;
      var bestD = 1e9;
      for (var i = 0; i < rooms.length; i++) {
        var b = rooms[i];
        if (b.id === a.id) continue;
        var d = Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
        if (d < bestD && d > 6) {
          bestD = d;
          best = b;
        }
      }
      if (best) Dungeon._carveCorridor(grid, a.cx, a.cy, best.cx, best.cy, rng);
    }
  },

  _stampRoomLookup: function (roomAt, room) {
    for (var y = room.y; y < room.y + room.h; y++) {
      for (var x = room.x; x < room.x + room.w; x++) {
        roomAt[y][x] = room.id;
      }
    }
  },

  _farthestRoom: function (rooms, from) {
    var best = from;
    var bestD = -1;
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      var d = Math.abs(r.cx - from.cx) + Math.abs(r.cy - from.cy);
      if (d > bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  },

  _scatter: function (grid, rooms, rng, tile, count, entrance, exit) {
    var placed = [];
    var tries = 0;
    while (placed.length < count && tries < 80) {
      tries++;
      var room = rng.pick(rooms);
      var x = rng.int(room.x + 1, room.x + room.w - 2);
      var y = rng.int(room.y + 1, room.y + room.h - 2);
      if (grid[y][x] !== TILE.FLOOR) continue;
      if (x === entrance.x && y === entrance.y) continue;
      if (x === exit.x && y === exit.y) continue;
      grid[y][x] = tile;
      placed.push({ x: x, y: y, roomId: room.id, taken: false });
    }
    return placed;
  },

  _maybeCorridorEvents: function (grid, roomAt, rng, events, want) {
    var h = grid.length;
    var w = grid[0].length;
    var added = 0;
    var tries = 0;
    while (added < want && tries < 60) {
      tries++;
      var x = rng.int(2, w - 3);
      var y = rng.int(2, h - 3);
      if (grid[y][x] !== TILE.CORRIDOR) continue;
      grid[y][x] = TILE.EVENT;
      events.push({ x: x, y: y, roomId: -1, taken: false, corridor: true });
      added++;
    }
  }
};
