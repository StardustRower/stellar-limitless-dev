/**
 * 测绘员的跨层记忆：第二张约束表。
 *
 * Demo 3 证明角色是一张表。下行 `newRun(seed + "-down")` 会扔掉这一局的
 * JS 对象，所以灰岩会忘事——除非有人把旗标记在别处。
 *
 * 别处不是大模型的提示词。模型没有账本，会开始发明「我们好像说过……」。
 * 别处是这个极小的本地 API：只准四个字段。失败就当失忆，游戏继续。
 */
var Memory = (function () {
  var DEFAULT_URL = "http://127.0.0.1:8765";
  var TIMEOUT_MS = 800;
  var status = "unknown";
  var lastFlags = null;
  var pending = null;

  function blank() {
    return { met: false, traded: false, warned: false, last_state: "idle" };
  }

  /**
   * 同一条测线：种子后面叠多少个 "-down" 都不换人。
   * 「换一颗种子」才会换一条测线。
   */
  function lineKey(seed) {
    var s = String(seed == null ? "" : seed).trim();
    while (s.length >= 5 && s.slice(-5) === "-down") {
      s = s.slice(0, -5);
    }
    return s || "stardust";
  }

  function apiBase() {
    try {
      if (typeof location !== "undefined" && location.port === "8765") {
        return location.origin;
      }
    } catch (e) { /* file:// 没有 origin 也没关系 */ }
    return DEFAULT_URL;
  }

  function setStatus(next) {
    status = next;
    syncHud();
  }

  function syncHud() {
    var el = document.getElementById("ledger-hint");
    if (!el) return;
    el.classList.remove("is-on", "is-off");
    if (status === "online") {
      el.textContent = "账本 · 记得";
      el.classList.add("is-on");
      el.title = "本地旗标账本在线。灰岩只记得 met / traded / warned / last_state，没有聊天记录。";
    } else if (status === "amnesia") {
      el.textContent = "账本 · 本局失忆";
      el.classList.add("is-off");
      el.title = "账本没开，或浏览器拦住了请求。游戏照常玩；下楼后他会当第一次见你。";
    } else {
      el.textContent = "账本 · …";
      el.title = "正在探测本地账本（127.0.0.1:8765）。";
    }
  }

  function snapshot(npc) {
    var flags = blank();
    if (!npc) return flags;
    flags.met = !!(npc.met || (npc.state && npc.state !== "idle"));
    flags.traded = !!npc.traded;
    flags.warned = !!npc.warned;
    flags.last_state = npc.state || npc.last_state || "idle";
    return flags;
  }

  function apply(npc, flags) {
    if (!npc || !flags) return;
    // 旗标只增不减：这一局已经换过油，不能被一张空账本擦掉。
    // 下行时 place() 会先把旗标清零，再从账本 OR 回来。
    npc.met = !!(npc.met || flags.met);
    npc.traded = !!(npc.traded || flags.traded);
    npc.warned = !!(npc.warned || flags.warned);
    if (!npc.last_state || npc.last_state === "idle") {
      npc.last_state = flags.last_state || "idle";
    }
    if (typeof Events !== "undefined") {
      Events.warned = !!(Events.warned || flags.warned);
    }
  }

  function fetchJson(path, opts) {
    opts = opts || {};
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, TIMEOUT_MS);
    return fetch(apiBase() + path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error("ledger " + res.status);
      return res.json();
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  async function load(seed) {
    try {
      var key = encodeURIComponent(lineKey(seed));
      var data = await fetchJson("/memory?line=" + key);
      var flags = data && data.flags ? data.flags : blank();
      lastFlags = {
        met: !!flags.met,
        traded: !!flags.traded,
        warned: !!flags.warned,
        last_state: flags.last_state || "idle"
      };
      setStatus("online");
      return lastFlags;
    } catch (err) {
      lastFlags = blank();
      setStatus("amnesia");
      return lastFlags;
    }
  }

  async function save(seed, npc) {
    var flags = snapshot(npc);
    flags.line = lineKey(seed);
    try {
      var data = await fetchJson("/memory", { method: "POST", body: flags });
      var stored = data && data.flags ? data.flags : flags;
      lastFlags = {
        met: !!stored.met,
        traded: !!stored.traded,
        warned: !!stored.warned,
        last_state: stored.last_state || flags.last_state
      };
      setStatus("online");
      return lastFlags;
    } catch (err) {
      setStatus("amnesia");
      return null;
    }
  }

  async function hydrate(npc, seed) {
    var flags = await load(seed);
    if (status === "amnesia") {
      // 账本没开：不要用空白表覆盖这一局已经发生的交易/警告。
      return snapshot(npc);
    }
    apply(npc, flags);
    return flags;
  }

  function rememberLater(seed, npc) {
    save(seed, npc).catch(function () { /* 失忆时游戏继续 */ });
  }

  function resetStatus() {
    status = "unknown";
    lastFlags = null;
    pending = null;
    syncHud();
  }

  return {
    lineKey: lineKey,
    blank: blank,
    snapshot: snapshot,
    apply: apply,
    load: load,
    save: save,
    hydrate: hydrate,
    rememberLater: rememberLater,
    resetStatus: resetStatus,
    syncHud: syncHud,
    getStatus: function () { return status; },
    lastFlags: function () { return lastFlags ? Object.assign({}, lastFlags) : blank(); },
    get pending() { return pending; },
    set pending(p) { pending = p; }
  };
})();
