/**
 * LLM 适配器：同一套「给我一段地牢叙事」接口，底下可换引擎。
 *
 * 本地规则引擎（默认）：模板 + 词库组合，离线、瞬时、可复现。
 * HTTP API：OpenAI 兼容的 /chat/completions；失败立刻回退本地，不让游戏卡住。
 *
 * 密钥只进 localStorage，绝不写进代码。这是演示级安全底线。
 */
var LLM = (function () {
  var STORAGE = "stellar-dungeon-llm-v1";
  var DEFAULTS = {
    mode: "local",
    lang: "zh",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini"
  };

  var cache = {};
  var inflight = {};

  var SMELL = {
    zh: ["湿石灰的冷气", "熄灭火把的焦糊", "铁锈与旧血", "地下河的霉味", "树脂和松烟", "干枯香料", "刚切开的岩石粉尘", "硫磺的刺鼻边味"],
    en: ["cold wet lime", "snuffed-torch soot", "rust and old blood", "river-mold", "resin and pine smoke", "dried spice", "fresh rock dust", "a sulfur edge"]
  };
  var SOUND = {
    zh: ["水滴敲在铁架上", "很远的碎石滑动", "风穿过窄缝的哨音", "自己的心跳", "甲壳类东西刮过墙", "一声没人应答的回音", "灯油将尽的噼啪"],
    en: ["drips hitting iron", "distant gravel sliding", "wind whistling a crack", "your own pulse", "chitin scraping stone", "an echo that nobody answers", "oil-lamp crackle"]
  };
  var SIGHT = {
    zh: ["墙面上的凿痕还留着工具齿印", "地砖缝里嵌着一枚失去光泽的铜钉", "穹顶裂开一线，像地质图上的断层", "角落堆着被潮解的卷轴", "石柱被盐霜爬满", "地面有一圈被擦掉的符文"],
    en: ["chisel-teeth still bite the wall", "a dull copper nail sits in a tile joint", "the vault is split like a mapped fault", "damp scrolls slump in a corner", "salt frost climbs the pillar", "a scuffed ring of runes on the floor"]
  };
  var FEEL = {
    zh: ["后颈发凉", "空气变薄了一拍", "靴底突然更粘", "耳压轻轻一沉", "像有人在地图另一侧同时停下"],
    en: ["the nape goes cold", "the air thins for a beat", "soles stick a little", "ear-pressure dips", "as if someone paused on the far side of the map"]
  };
  var LOOT = {
    zh: ["一枚压扁的星徽铜币", "半页测线记录，墨水遇潮发花", "一截还带着岩屑的测绳", "一只没有指针的罗盘", "一颗冷得过分的石榴石", "一卷标着未知岩层代号的布条", "一颗熄灭的磷光虫茧", "一枚齿痕整齐的铅封"],
    en: ["a flattened star-crest coin", "a survey note bloomed by damp ink", "a measuring cord still gritty with cuttings", "a compass with no needle", "a garnet too cold for its size", "a cloth tag naming an unknown stratum", "a dark glow-worm cocoon", "a lead seal with neat tooth-marks"]
  };
  var HAZARD = {
    zh: ["顶板在滴一种发亮的凝结水", "脚下的板岩层理突然变陡", "空气里氧味发甜——这往往不是好兆头", "你看见自己的脚印在回头，但你没走回去", "一段走廊的宽度在视觉上对不齐"],
    en: ["the roof drips a luminous condensate", "slate bedding underfoot steepens without warning", "the air tastes sweetly of oxygen — rarely a mercy", "your prints turn back though you did not", "the corridor width refuses to add up"]
  };

  function loadSettings() {
    var s = Object.assign({}, DEFAULTS);
    try {
      var raw = localStorage.getItem(STORAGE);
      if (raw) {
        var parsed = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) {
          if (parsed[k] != null) s[k] = parsed[k];
        });
      }
    } catch (e) { /* 隐私模式或损坏数据时用默认值 */ }
    if (s.mode !== "api") s.mode = "local";
    if (s.lang !== "en" && s.lang !== "mix") s.lang = "zh";
    return s;
  }

  function saveSettings(partial) {
    var s = Object.assign(loadSettings(), partial || {});
    try {
      localStorage.setItem(STORAGE, JSON.stringify(s));
    } catch (e) { /* 忽略配额错误 */ }
    return s;
  }

  function cacheKey(ctx) {
    var gm = ctx.gmEvent && ctx.gmEvent.id ? ctx.gmEvent.id : "";
    var npc = ctx.trigger === "npc_talk"
      ? (ctx.npcState || "") + ":" + (ctx.npcOption || "")
      : "";
    return [ctx.seed, ctx.lang, ctx.trigger, ctx.roomId, ctx.kind, ctx.x, ctx.y, gm, npc].join("|");
  }

  function localDescribe(ctx, rng) {
    var lang = ctx.lang || "zh";
    var smell = rng.pick(SMELL[lang === "en" ? "en" : "zh"]);
    var sound = rng.pick(SOUND[lang === "en" ? "en" : "zh"]);
    var sight = rng.pick(SIGHT[lang === "en" ? "en" : "zh"]);
    var feel = rng.pick(FEEL[lang === "en" ? "en" : "zh"]);
    var loot = rng.pick(LOOT[lang === "en" ? "en" : "zh"]);
    var hazard = rng.pick(HAZARD[lang === "en" ? "en" : "zh"]);
    var name = lang === "en" ? ctx.nameEn : ctx.nameZh;
    if (lang === "mix") name = ctx.nameZh + " / " + ctx.nameEn;

    var zhRoom = {
      enter_room: name + "。空气里是" + smell + "。你听见" + sound + "。" + sight + "。" + feel + "。",
      item: "你在" + name + "的尘土里拣起" + loot + "。它比看起来更沉，像把一段没写完的地层史压进了掌心。",
      event: name + "里的地面微微一颤。" + hazard + "。你停住，让灯焰自己决定先照哪一面墙。",
      corridor: "走廊收窄。壁上的凿痕改变了方向，像一次匆忙改道的掘进。" + feel + "。" + sight + "。",
      exit: "阶梯向下折进更深的黑。" + name + "把最后一点余温留在你背后。种子还是这颗，但下一层会是另一张图。",
      start: "你站在入口。种子「" + ctx.seed + "」已经把整座地牢冻成了这一次。火把只照亮脚下——其余要靠走。",
      fallback: "石壁沉默。你只能听见自己的呼吸。"
    };
    var enRoom = {
      enter_room: name + ". The air carries " + rng.pick(SMELL.en) + ". You hear " + rng.pick(SOUND.en) + ". " + rng.pick(SIGHT.en) + ". " + rng.pick(FEEL.en) + ".",
      item: "From the dust of the " + name + " you lift " + rng.pick(LOOT.en) + ". Heavier than it looks, as if a half-written stratum were folded into your palm.",
      event: "The floor in the " + name + " ticks once. " + rng.pick(HAZARD.en) + ". You let the flame choose which wall to trust.",
      corridor: "The passage pinches. Chisel-marks change heading, like a drive that was rerouted in a hurry. " + rng.pick(FEEL.en) + ".",
      exit: "Stairs fold down into a deeper black. The " + name + " keeps its last warmth at your back. Same seed, next map.",
      start: "You stand at the entrance. Seed \"" + ctx.seed + "\" has already frozen this dungeon into this one life. The torch only buys the tile underfoot.",
      fallback: "The stone stays silent. Breath is the only moving thing."
    };

    if (lang === "mix") {
      var a = localDescribe(Object.assign({}, ctx, { lang: "zh" }), rng);
      var b = localDescribe(Object.assign({}, ctx, { lang: "en" }), rng);
      return a + "\n" + b;
    }
    if (ctx.trigger === "gm_event" && ctx.gmEvent) {
      var bank = lang === "en" ? ctx.gmEvent.narrateEn : ctx.gmEvent.narrateZh;
      if (bank && bank.length) return rng.pick(bank);
    }
    if (ctx.trigger === "npc_talk" && typeof NPC !== "undefined" && NPC.localLine) {
      return NPC.localLine(ctx);
    }
    if (ctx.trigger === "game_over") {
      return lang === "en"
        ? "The flame pinches out. The last thing you map is the tile underfoot. Seed stays; the body does not. Regen, or take another seed."
        : "灯焰收成一点，随即灭了。你最后测到的，是脚下这一格。种子还在，人先停在这里。点重生，或换一颗种子。";
    }

    var pack = lang === "en" ? enRoom : zhRoom;
    return pack[ctx.trigger] || pack.fallback;
  }

  /**
   * 给真实 LLM 的提示草稿：短、具体、禁止它自我介绍。
   * 把「可复现」交给 temperature 偏低 + 同一 seed 写进 prompt。
   */
  function buildNpcMessages(ctx) {
    var langLine = {
      zh: "用简体中文写 2～3 句台词。你就是这个人在说话，不要旁白腔，不要自称 AI。",
      en: "Write 2–3 sentences of in-character dialogue in English. Do not narrate from outside. Do not mention being an AI.",
      mix: "先写 2 句简体中文台词，再写 2 句英文台词。同一意思，不要互译腔。"
    };
    var sys = "You are " + (ctx.npcNameEn || "Huiyan") + " / " + (ctx.npcNameZh || "灰岩");
    sys += ", a former geological surveyor still standing in this one dungeon room. ";
    sys += langLine[ctx.lang] || langLine.zh;
    sys += " Speak ONLY as this NPC in the current dialogue state. Never invent HP, damage, gold, or items.";
    sys += " Never change numbers. Never skip to another state. Do not give the player objects that are not already in the engine table.";
    if (ctx.npcState === "trade") {
      sys += " The engine already swapped a survey page for lamp oil and applied the table's heal. Imply warmth; never say +HP or a digit.";
    }
    if (ctx.npcState === "warn") {
      sys += " You warn about a marked omen tile ahead. Do not invent monsters, new rooms, or loot.";
    }
    var user = [
      "state=" + ctx.npcState,
      "state_name=" + (ctx.npcStateZh || "") + " / " + (ctx.npcStateEn || ""),
      "player_option=" + (ctx.npcOption || "open"),
      "option_label=" + (ctx.npcOptionLabel || ""),
      "hp=" + ctx.hp + "/" + ctx.maxHp + " (never state the number; you may imply fatigue or relief)",
      ctx.inventory && ctx.inventory.length ? "carrying=" + ctx.inventory.join(", ") : "carrying=nothing",
      "room=" + ctx.nameZh + " / " + ctx.nameEn,
      "traded=" + (ctx.npcTraded ? "yes" : "no"),
      "warned=" + (ctx.npcWarned ? "yes" : "no"),
      "seed=" + ctx.seed
    ];
    return [
      { role: "system", content: sys },
      { role: "user", content: user.join("\n") }
    ];
  }

  function buildMessages(ctx) {
    if (ctx.trigger === "npc_talk") return buildNpcMessages(ctx);
    var langLine = {
      zh: "用简体中文写 2～4 句。像地质师走进地下工程：具体感官，不要游戏数值，不要自称 AI。",
      en: "Write 2–4 sentences in English. Sensory, specific, no stats, do not mention being an AI.",
      mix: "先写 2 句简体中文，再写 2 句英文。两者描述同一瞬间，不要互译腔。"
    };
    var sys = "You narrate a roguelike dungeon. " + (langLine[ctx.lang] || langLine.zh);
    sys += " Never invent HP, damage numbers, gold, or item stats. Numbers belong to the game engine.";
    if (ctx.gmEvent) {
      sys += " A constrained GM already chose the event. Narrate that event only; do not pick a different one; do not mention numbers.";
    }
    var user = [
      "seed=" + ctx.seed,
      "trigger=" + ctx.trigger,
      "room=" + ctx.nameZh + " / " + ctx.nameEn,
      "kind=" + ctx.kind,
      "size=" + ctx.w + "x" + ctx.h,
      "xy=" + ctx.x + "," + ctx.y,
      ctx.inventory && ctx.inventory.length ? "carrying=" + ctx.inventory.join(", ") : "carrying=nothing"
    ];
    if (ctx.gmEvent) {
      user.push("chosen_event=" + ctx.gmEvent.id);
      user.push("event_name=" + ctx.gmEvent.nameZh + " / " + ctx.gmEvent.nameEn);
      user.push("mechanical_intent=" + (ctx.gmIntent || "unknown") + " (imply it in prose; never quantify)");
    }
    return [
      { role: "system", content: sys },
      { role: "user", content: user.join("\n") }
    ];
  }

  function localRngFor(ctx) {
    var npc = ctx.trigger === "npc_talk"
      ? "|" + (ctx.npcState || "") + "|" + (ctx.npcOption || "")
      : "";
    return RNG.fromSeed(ctx.seed + "|" + ctx.trigger + "|" + ctx.roomId + "|" + ctx.x + "," + ctx.y + npc);
  }

  /**
   * 共用的 /chat/completions 调用。GM 选选项时走 complete；叙事仍走 describe。
   */
  async function complete(messages, settings, opts) {
    opts = opts || {};
    var base = String(settings.baseUrl || "").replace(/\/+$/, "");
    if (!base) throw new Error("缺少 API 地址");
    if (!settings.apiKey) throw new Error("缺少 API 密钥");
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, 8000);
    var res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.apiKey
      },
      body: JSON.stringify({
        model: settings.model || "gpt-4o-mini",
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        max_tokens: opts.maxTokens || 220,
        messages: messages
      }),
      signal: ctrl ? ctrl.signal : undefined
    });
    clearTimeout(timer);
    if (!res.ok) {
      var errText = "";
      try { errText = await res.text(); } catch (e) { /* ignore */ }
      throw new Error("API " + res.status + (errText ? ": " + errText.slice(0, 80) : ""));
    }
    var data = await res.json();
    var text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text || !String(text).trim()) throw new Error("API 返回空文本");
    return String(text).trim();
  }

  async function callApi(ctx, settings) {
    return complete(buildMessages(ctx), settings, { temperature: 0.7, maxTokens: 220 });
  }

  async function describe(ctx) {
    var settings = loadSettings();
    ctx = Object.assign({ lang: settings.lang, trigger: "enter_room", roomId: -1, x: 0, y: 0, kind: "hall", nameZh: "石厅", nameEn: "Hall", w: 0, h: 0, seed: "stardust" }, ctx);
    ctx.lang = settings.lang;
    var key = cacheKey(ctx);
    if (cache[key]) return { text: cache[key], source: "cache", ok: true };

    if (inflight[key]) return inflight[key];

    var job = (async function () {
      if (settings.mode === "api") {
        try {
          var apiText = await callApi(ctx, settings);
          cache[key] = apiText;
          return { text: apiText, source: "api", ok: true };
        } catch (err) {
          var fallback = localDescribe(ctx, localRngFor(ctx));
          cache[key] = fallback;
          return { text: fallback, source: "local-fallback", ok: false, error: String(err.message || err) };
        }
      }
      var localText = localDescribe(ctx, localRngFor(ctx));
      cache[key] = localText;
      return { text: localText, source: "local", ok: true };
    })();

    inflight[key] = job;
    try {
      return await job;
    } finally {
      delete inflight[key];
    }
  }

  function prefetch(list) {
    list.forEach(function (ctx) {
      describe(ctx).catch(function () { /* 预取失败静默 */ });
    });
  }

  function clearCache() {
    cache = {};
    inflight = {};
  }

  return {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    describe: describe,
    complete: complete,
    prefetch: prefetch,
    clearCache: clearCache,
    buildMessages: buildMessages
  };
})();
