/**
 * 本地地下城主持人（Dungeon GM）。
 *
 * Demo 1 的 LLM 是「文案机」：房间已经在那里了，它只负责写气味和回声。
 * Demo 2 的 GM 先做规则裁决，再把「选中的这一条」交给 LLM 去写旁白。
 *
 * 分工（务必分开记）：
 * - GM：看 HP、背包、房间类型、已探房间数，从约束表里挑下一格异兆，并给出伤害/治疗/换物的数字。
 * - LLM：只描写这一格发生了什么。禁止它发明 HP。
 *
 * 为什么数字不能让模型自由说？因为模型没有「这局还剩几滴血」的权威账本，
 * 它可能写「你失去 40 点生命」而游戏里总共只有 10。规则表才是物理，旁白只是地质手记。
 */
var GM = (function () {
  /**
   * 约束表：每条都是「已裁决的事件」。
   * amount 写在表里，运行时只读，不让旁白改。
   */
  var TABLE = [
    {
      id: "cave_in",
      nameZh: "塌方",
      nameEn: "Cave-in",
      preferKinds: ["fault", "fissure", "crypt", "hall"],
      effect: { type: "damage", amount: 2 },
      narrateZh: [
        "顶板一声脆响，薄层砂岩沿层理剥落。碎石砸在肩上，尘雾吞掉灯焰半拍。你还站着，但硐室已经提醒你：岩石会累。",
        "头顶的裂隙突然咬合又张开，一块角砾砸在靴边再弹到小腿。粉尘有新切开的气味。你把重心压低，等顶板再决定一次。"
      ],
      narrateEn: [
        "The roof ticks; a sandstone lamina peels along bedding and hits your shoulder. Dust eats half a heartbeat of flame. The chamber is still standing. So are you.",
        "A fissure in the ceiling bites, then opens. Breccia kisses your shin. The air smells newly cut. You drop your weight and wait for the rock to choose again."
      ]
    },
    {
      id: "lamp",
      nameZh: "矿灯余油",
      nameEn: "Lamp oil",
      preferKinds: ["watch", "store", "armory"],
      effect: { type: "heal", amount: 3 },
      narrateZh: [
        "墙龛里一盏被人忘了的矿灯，玻璃罩结着煤烟。你把余油倒进自己的壶，暖意从指节爬回小臂。黑暗没有变少，但你更扛得住它。",
        "铁钩上挂着半壶灯油，盖子用地质锤敲过。油脂味盖过霉味。喝不下去，但擦过手腕时，冷意退了一寸。"
      ],
      narrateEn: [
        "A forgotten lamp sits in a niche, glass filmed with soot. You pour the last oil into your own flask. The dark does not shrink. You do.",
        "Half a tin of oil hangs from an iron hook, lid scarred by a hammer. Grease drowns the mold-smell. You cannot drink it, but warmth returns one inch up the wrist."
      ]
    },
    {
      id: "torn_page",
      nameZh: "测线残页",
      nameEn: "Torn survey page",
      preferKinds: ["library", "starchart", "core", "watch"],
      effect: { type: "swap", itemZh: "半页测线记录", itemEn: "a torn survey sheet" },
      narrateZh: [
        "潮解的纸页贴在岩芯箱盖上，墨水遇湿发花，却还能读出一条测线号。你把它揭下来，掌心那件旧物只好让位。纸比石头轻，责任不一定。",
        "风从通风孔里送进来一角残页，上面是手绘的断层产状。你把它夹进背包最干的一层，换出一件已经失去用处的东西。"
      ],
      narrateEn: [
        "Damp paper clings to a core-box lid. The ink has bloomed, but a survey line-number survives. You peel it free; whatever you carried must make room.",
        "A scrap rides the vent: a hand-drawn fault attitude. You slide it into the driest fold of the pack and let one older thing go."
      ]
    },
    {
      id: "fault_seepage",
      nameZh: "断层渗水",
      nameEn: "Fault seepage",
      preferKinds: ["fault", "fissure", "cistern"],
      effect: { type: "damage", amount: 1 },
      narrateZh: [
        "断层面上的方解石脉正在出汗。水是凉的，带着铁的味道，顺着袖口爬进伤口。你甩了甩手，灯焰嘶地缩了一下。",
        "岩壁一条擦痕在滴水，滴点不在你脚前，而在领口。渗水沿着旧断层走，人只是碰巧站在它的路径上。"
      ],
      narrateEn: [
        "Calcite along the fault plane is sweating. The water is cold, iron-tasting, and finds a cut inside your cuff. The flame hisses smaller.",
        "A slickenside drips, not at your boots but at your collar. Seepage follows the old fault. You merely stood in its way."
      ]
    },
    {
      id: "ore_glint",
      nameZh: "矿脉微光",
      nameEn: "Ore glint",
      preferKinds: ["vein", "core", "armory"],
      effect: { type: "item", itemZh: "一颗冷石榴石", itemEn: "a cold garnet" },
      narrateZh: [
        "矿脉里一粒石榴石被灯焰咬亮，冷得不像刚从围岩里解放。你用锤柄撬下来，装进布袋。它不发热，像一枚不肯讲完的深度。",
        "墙里一线铬铁矿的反光，短得像信号。你顺着层理抠出一颗晶体，棱角割手，却让背包有了重量。"
      ],
      narrateEn: [
        "A garnet in the vein catches the flame and stays too cold. You lever it free with the hammer haft. It will not warm. It will not finish telling its depth.",
        "A blink of chromite. You work a crystal out along the bedding. The edges cut. The pack finally has a weight it did not have."
      ]
    },
    {
      id: "bad_air",
      nameZh: "沼气甜味",
      nameEn: "Sweet gas",
      preferKinds: ["fungal", "cistern", "crypt"],
      effect: { type: "damage", amount: 2 },
      narrateZh: [
        "空气忽然发甜，像过熟的水果——井下这往往不是好兆头。你改成浅呼吸，太阳穴跳了一拍。灯焰变得又圆又懒。",
        "低洼处积着一层看不见的气体。踏进去时喉头发痒，眼圈发热。你退回高处，把领巾捂上口鼻，继续走。"
      ],
      narrateEn: [
        "The air turns sweet, like fruit left too long — underground, that is rarely mercy. You shallow the breath. The flame goes round and lazy.",
        "An invisible layer waits in the hollow. Your throat itches, your eyes heat. You step back to higher ground, cloth to mouth, and keep moving."
      ]
    },
    {
      id: "spring",
      nameZh: "裂隙泉",
      nameEn: "Fissure spring",
      preferKinds: ["cistern", "fungal", "fissure"],
      effect: { type: "heal", amount: 2 },
      narrateZh: [
        "裂隙底部一汪浅泉，水面有钟乳的碎屑。你掬一口，冷得牙齿发响，随后胸口那块发紧的地方松了。水不一定干净，但比干渴诚实。",
        "滴石柱下积着可饮的一层。矿物味很重，像把整条含水层浓缩进舌面。你喝得很慢，让身体自己决定留多少。"
      ],
      narrateEn: [
        "A thin spring at the fissure floor, littered with soda-straw shards. One sip rings in the teeth; the tightness in the chest lets go. The water may not be clean. It is honest.",
        "A drinkable film under the dripstone. The mineral taste is a whole aquifer on the tongue. You drink slowly and let the body keep what it will."
      ]
    },
    {
      id: "salt_cut",
      nameZh: "盐霜割手",
      nameEn: "Salt frost",
      preferKinds: ["shrine", "altar", "crypt"],
      effect: { type: "damage", amount: 1 },
      narrateZh: [
        "石柱上的盐霜看起来像雪。你扶了一把，晶体割开指腹。咸味进了伤口，比疼更清醒。墙仍旧白着，像什么被蒸发后剩下的骨架。",
        "祭坛边缘长满盐华。手掌撑上去时，细刺扎进皮里。你甩开手，盐粒落回黑暗，叮一声，轻得不像警告。"
      ],
      narrateEn: [
        "Salt frost on the pillar looks like snow. You brace against it and the crystals open a fingertip. Salt in the cut is clearer than pain.",
        "Efflorescence along the altar edge. Palms down, needles in. You shake the hand; grains fall with a sound too small to be a warning."
      ]
    },
    {
      id: "survey_cache",
      nameZh: "前人补给匣",
      nameEn: "Survey cache",
      preferKinds: ["watch", "store", "armory"],
      effect: { type: "heal", amount: 4 },
      narrateZh: [
        "角落一只镀锌匣，盖上用黄漆写着测区代号。里面是干粮和一卷干净绷带。你吃得很小心，像在接受一位从未见面的同事的交接。",
        "木箱被岩粉埋到一半。撬开后是压缩饼干和一瓶还封着的电解质粉。苦，但肩膀重新听指挥了。"
      ],
      narrateEn: [
        "A galvanized box in the corner, a survey code in yellow paint. Inside: dry ration, a clean roll of bandage. You eat as if taking handover from a colleague you will never meet.",
        "A crate half-buried in rock flour. Compressed biscuit, a still-sealed tin of salts. Bitter. The shoulders take orders again."
      ]
    },
    {
      id: "core_drop",
      nameZh: "岩芯滚落",
      nameEn: "Loose core",
      preferKinds: ["core", "vein", "library"],
      effect: { type: "item", itemZh: "一截编号岩芯", itemEn: "a numbered core stub" },
      narrateZh: [
        "木箱塌了一角，一截编过号的岩芯滚到脚边。断面能看见粒度变化，像把一次沉积史缩成手掌长。你捡起来，编号被磨到只剩半截。",
        "架子上的岩芯滑出一截。你接住了，掌心全是岩粉。标签写着一个你没见过的层位代号——也许正因为没见过，才该带走。"
      ],
      narrateEn: [
        "A crate slumps. A numbered core stub rolls to your boot. Grain-size changes across the break, a depositional story the length of a palm.",
        "A core slips the rack. You catch it; palms go white with flour. The tag names a horizon you have never seen. That is why you keep it."
      ]
    },
    {
      id: "loose_scree",
      nameZh: "碎石坡",
      nameEn: "Scree",
      preferKinds: ["corridor", "watch", "fissure"],
      effect: { type: "damage", amount: 1 },
      narrateZh: [
        "走廊被一片碎石坡堵住半边。你踏上去，棱角隔着靴底找脚踝。有一粒正好踢中旧伤。坡还在缓慢向下蠕动，像一条不肯停的小滑坡。",
        "角砾在脚底重新排列。你滑了半步，手去扶墙，墙也是松的。碎石的语言很简单：这里的内摩擦角已经不够。"
      ],
      narrateEn: [
        "Scree takes half the corridor. Edges find the ankle through the boot; one grain knows an old bruise. The slope keeps creeping, a landslide that refused to finish.",
        "Breccia rearranges underfoot. You slip half a step and reach for wall; the wall is loose too. The stones are plain: the friction angle has already lost."
      ]
    },
    {
      id: "lantern_oil",
      nameZh: "灯油罐",
      nameEn: "Oil can",
      preferKinds: ["store", "hall", "watch"],
      effect: { type: "heal", amount: 2 },
      narrateZh: [
        "一罐没有标签的灯油，盖子用铁丝绞死。你打开时油味冲得眼睛发热，随后指节不再那么僵。火不会因此更大，人却能再走一段。",
        "罐底还剩两指高的油。你倒进备用壶，金属壁上传来白天的温度——错觉。但错觉有时够用。"
      ],
      narrateEn: [
        "An unlabeled oil can, lid wired shut. The smell stings the eyes; the knuckles unstiffen. The flame does not grow. You can walk farther.",
        "Two fingers of oil remain. You pour it into the spare flask. The metal pretends it remembers daylight. Sometimes a pretence is enough."
      ]
    }
  ];

  function tableById(id) {
    for (var i = 0; i < TABLE.length; i++) {
      if (TABLE[i].id === id) return TABLE[i];
    }
    return null;
  }

  function visitedCount(eventsObj) {
    return Object.keys(eventsObj.visitedRooms || {}).length;
  }

  function snapshot(game, extra) {
    extra = extra || {};
    var room = extra.room || null;
    return {
      hp: extra.hp != null ? extra.hp : (typeof Events !== "undefined" ? Events.hp : 10),
      maxHp: extra.maxHp != null ? extra.maxHp : (typeof Events !== "undefined" ? Events.maxHp : 10),
      inventory: extra.inventory || (typeof Events !== "undefined" ? Events.inventory.slice() : []),
      kind: room ? room.kind : (extra.kind || "corridor"),
      visited: extra.visited != null ? extra.visited : (typeof Events !== "undefined" ? visitedCount(Events) : 0),
      seed: game && game.map ? game.map.seed : "stardust",
      x: extra.x || 0,
      y: extra.y || 0
    };
  }

  /**
   * 按状态打分。低血偏向治疗，高探索偏向伤害——主持人在「照顾你」和「加压」之间拉锯。
   * 血极低时把伤害条的权重打到 0：不是永远不死，而是不在这一格故意秒杀。
   */
  function score(ev, state) {
    var w = 3;
    if (ev.preferKinds && ev.preferKinds.indexOf(state.kind) !== -1) w += 5;
    var t = ev.effect.type;
    if (t === "heal") {
      if (state.hp <= 3) w += 10;
      else if (state.hp <= 6) w += 4;
      else w -= 2;
    }
    if (t === "damage") {
      if (state.hp <= 2) return 0;
      if (state.hp <= 4) w -= 2;
      if (state.visited >= 6) w += 2;
    }
    if (t === "item" && state.inventory.length >= 5) w -= 2;
    if (t === "swap" && state.inventory.length === 0) w += 1;
    return Math.max(0, w);
  }

  function localPick(state, rng) {
    var weights = [];
    var total = 0;
    var i;
    for (i = 0; i < TABLE.length; i++) {
      var w = score(TABLE[i], state);
      weights.push(w);
      total += w;
    }
    if (total <= 0) {
      for (i = 0; i < TABLE.length; i++) {
        if (TABLE[i].effect.type === "heal") return TABLE[i];
      }
      return TABLE[0];
    }
    var roll = rng.next() * total;
    var acc = 0;
    for (i = 0; i < TABLE.length; i++) {
      acc += weights[i];
      if (roll < acc) return TABLE[i];
    }
    return TABLE[TABLE.length - 1];
  }

  function optionIds() {
    return TABLE.map(function (e) { return e.id; });
  }

  async function apiPick(state, settings) {
    var ids = optionIds();
    var lines = [
      "hp=" + state.hp + "/" + state.maxHp,
      "inventory=" + (state.inventory.length ? state.inventory.join(", ") : "empty"),
      "room_kind=" + state.kind,
      "visited_rooms=" + state.visited,
      "If hp is 1 or 2, prefer a heal id.",
      "Reply with exactly one option id from the list. No punctuation, no narration, no numbers.",
      "options:",
      ids.join("\n")
    ].join("\n");
    var raw = await LLM.complete([
      {
        role: "system",
        content: "You are a constrained dungeon GM. You may ONLY pick one id from the provided options. Never invent HP, damage, or new events."
      },
      { role: "user", content: lines }
    ], settings, { temperature: 0, maxTokens: 24 });
    var token = String(raw || "").trim().split(/\s+/)[0].replace(/[^a-z_]/gi, "").toLowerCase();
    var hit = tableById(token);
    if (!hit) throw new Error("模型未返回合法选项：" + String(raw).slice(0, 40));
    return hit;
  }

  async function choose(game, extra) {
    var state = snapshot(game, extra);
    var rng = RNG.fromSeed(
      state.seed + "|gm|" + state.x + "," + state.y +
      "|hp" + state.hp + "|v" + state.visited + "|i" + state.inventory.join(",")
    );
    var settings = LLM.loadSettings();
    if (settings.mode === "api") {
      try {
        var apiEvent = await apiPick(state, settings);
        return { event: apiEvent, source: "api", state: state };
      } catch (err) {
        return {
          event: localPick(state, rng),
          source: "local-fallback",
          state: state,
          error: String(err.message || err)
        };
      }
    }
    return { event: localPick(state, rng), source: "local", state: state };
  }

  /**
   * 只根据表里的 effect 改数字。旁白函数不准调用这个之外的扣血途径。
   */
  function apply(eventsObj, event) {
    var beforeHp = eventsObj.hp;
    var gained = null;
    var lost = null;
    var fx = event.effect;
    if (fx.type === "damage") {
      eventsObj.hp = Math.max(0, eventsObj.hp - fx.amount);
    } else if (fx.type === "heal") {
      eventsObj.hp = Math.min(eventsObj.maxHp, eventsObj.hp + fx.amount);
    } else if (fx.type === "item") {
      gained = fx.itemZh;
      eventsObj.inventory.push(fx.itemZh);
    } else if (fx.type === "swap") {
      if (eventsObj.inventory.length) lost = eventsObj.inventory.pop();
      gained = fx.itemZh;
      eventsObj.inventory.push(fx.itemZh);
    }
    var dead = eventsObj.hp <= 0;
    if (dead) eventsObj.dead = true;
    return {
      beforeHp: beforeHp,
      afterHp: eventsObj.hp,
      deltaHp: eventsObj.hp - beforeHp,
      gained: gained,
      lost: lost,
      dead: dead,
      amount: fx.amount || 0,
      type: fx.type
    };
  }

  function effectHint(event) {
    var t = event.effect.type;
    if (t === "damage") return "hurt";
    if (t === "heal") return "healed";
    if (t === "swap") return "item-swapped";
    if (t === "item") return "item-found";
    return t;
  }

  return {
    TABLE: TABLE,
    tableById: tableById,
    snapshot: snapshot,
    score: score,
    localPick: localPick,
    choose: choose,
    apply: apply,
    effectHint: effectHint,
    optionIds: optionIds
  };
})();
