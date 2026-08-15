/**
 * 可播种随机数（seedable RNG）
 *
 * 为什么不用 Math.random()？
 * 因为它每次都不同，无法复现。Roguelike 的核心承诺是：
 * 「同一个种子 = 同一张地牢」。调试、分享、对照实验都靠这个。
 *
 * 用法：const rng = RNG.fromSeed("stardust"); rng.next(); rng.int(1, 6);
 */
var RNG = {
  /**
   * 把任意字符串压成 32 位整数。
   * 种子是给人看的（"火山-7"），算法内部只认数字。
   */
  hashString: function (str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  /**
   * Mulberry32：短小、够均匀、结果完全由种子决定。
   * 每次调用返回 [0, 1) 的小数，和 Math.random() 接口类似。
   */
  mulberry32: function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  fromSeed: function (seedText) {
    var text = String(seedText == null ? "" : seedText).trim() || "stardust";
    var numeric = RNG.hashString(text);
    var next = RNG.mulberry32(numeric);
    return {
      seedText: text,
      seedNumeric: numeric,
      next: next,
      /** 返回 [min, max] 闭区间的整数 */
      int: function (min, max) {
        if (max < min) {
          var tmp = min;
          min = max;
          max = tmp;
        }
        return min + Math.floor(next() * (max - min + 1));
      },
      pick: function (list) {
        if (!list || !list.length) return undefined;
        return list[Math.floor(next() * list.length)];
      },
      chance: function (p) {
        return next() < p;
      },
      shuffle: function (list) {
        var arr = list.slice();
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var t = arr[i];
          arr[i] = arr[j];
          arr[j] = t;
        }
        return arr;
      }
    };
  }
};
