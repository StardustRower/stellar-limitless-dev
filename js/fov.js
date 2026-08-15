/**
 * 视野（FOV）与战争迷雾。
 *
 * 为什么游戏不该让你看见整张图？
 * 因为 Roguelike 的紧张感来自「信息隐藏」：你不知道走廊尽头是阶梯还是塌方。
 * 若开局就俯视全图，探索变成填色游戏，决策变少。
 *
 * 本文件做两件事，请分开记：
 * 1. 圆形半径：火把只够照亮这么远（距离）。
 * 2. 视线遮挡：岩壁挡住后面的格子（阴影）。这里用直线探测（Bresenham），
 *    格子少、步骤能在纸上画出来。工业界地图很大时会改用「递归阴影投射」
 *    （shadowcasting，按 8 个八分角扫光线），道理相同，只是算得更快。
 *
 * FOV / 迷雾是运行时状态，绝不参与 js/dungeon.js 的生成。
 * 所以同一颗种子仍然是同一张地牢，只是你暂时看不见全貌。
 */
var FOV = {
  /** 火把半径（格子数）。拧这个数字就能感到「胆子变大/变小」。 */
  RADIUS: 5,

  blank: function (w, h, value) {
    var g = [];
    var v = value ? true : false;
    for (var y = 0; y < h; y++) {
      g[y] = [];
      for (var x = 0; x < w; x++) g[y][x] = v;
    }
    return g;
  },

  opaque: function (map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
    return map.grid[y][x] === TILE.WALL;
  },

  inRadius: function (px, py, x, y, radius) {
    var dx = x - px;
    var dy = y - py;
    return dx * dx + dy * dy <= radius * radius;
  },

  /**
   * 从 (x0,y0) 走到 (x1,y1)。途中若先撞上岩壁，就看不见目标。
   * 目标自己可以是岩壁：你看得见挡路的那面墙，看不见墙后的厅。
   */
  hasLos: function (map, x0, y0, x1, y1) {
    var dx = Math.abs(x1 - x0);
    var dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1;
    var sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var x = x0;
    var y = y0;
    while (x !== x1 || y !== y1) {
      var e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x1 && y === y1) return true;
      if (FOV.opaque(map, x, y)) return false;
    }
    return true;
  },

  /**
   * 计算当前可见格子，并把它们记入 explored（记忆）。
   * 返回 vis[y][x] === true 表示这一帧火把照到了。
   */
  compute: function (map, px, py, radius, explored) {
    var vis = FOV.blank(map.width, map.height, false);
    if (px < 0 || py < 0 || px >= map.width || py >= map.height) return vis;
    vis[py][px] = true;
    if (explored) explored[py][px] = true;

    var r = radius == null ? FOV.RADIUS : radius;
    for (var y = py - r; y <= py + r; y++) {
      if (y < 0 || y >= map.height) continue;
      for (var x = px - r; x <= px + r; x++) {
        if (x < 0 || x >= map.width) continue;
        if (x === px && y === py) continue;
        if (!FOV.inRadius(px, py, x, y, r)) continue;
        if (!FOV.hasLos(map, px, py, x, y)) continue;
        vis[y][x] = true;
        if (explored) explored[y][x] = true;
      }
    }
    return vis;
  }
};
