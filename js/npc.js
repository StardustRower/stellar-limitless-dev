/**
 * 一间房里的 NPC + 极小对话状态机。
 *
 * Demo 2 的 GM 先从约束表里挑异兆，再让 LLM 写旁白。
 * Demo 3 把同一约束用在「说话」上：测绘员只能处于表里的几个状态，
 * 玩家只能点当前状态列出的选项，模型只写 2～3 句台词。
 *
 * 请分开记：
 * - 表（本文件）：状态、选项、下一跳、交易给哪件物品、治疗几点。
 * - LLM（js/llm.js）：只把「当前状态 + 玩家点了哪一项」写成句子。
 * - 账本（js/memory.js + 可选的 FastAPI）：只记 met / traded / warned / last_state。
 *   下行会扔掉这一局的 JS 对象；旗标若还在账本里，他仍认得你换过油。
 *   失败就失忆。绝不把聊天记录塞进下一层的提示词。
 *
 * 测绘员是叠加层：生成地牢时不掷骰、不改格子。
 * 所以同一颗种子仍是同一张图，只是哨所（或圣所）多站了一个人。
 */
var NPC = (function () {
  var SURVEY_RE = /测线|survey/i;
  var OIL_ZH = "一小壶灯油";
  var OIL_EN = "a vial of lamp oil";
  /** 交易回血点数写在表里，运行时只读。 */
  var TRADE_HEAL = 3;

  /**
   * 状态表。和 GM.TABLE 同构：能发生的事必须先写在这里。
   *
   * 图（不能从问候直接跳到告别——那一跳不在表里）：
   *   idle → greet → ask / trade / warn → … → farewell → done
   * 打听之后仍可交易或警告；交易与警告互相不锁死，只是各做一次。
   */
  var TABLE = {
    idle: {
      id: "idle",
      nameZh: "未交谈",
      nameEn: "Idle",
      options: [
        { id: "open", hidden: true, next: "greet" }
      ]
    },
    greet: {
      id: "greet",
      nameZh: "问候",
      nameEn: "Greet",
      options: [
        { id: "ask", labelZh: "你在测什么？", labelEn: "What were you surveying?", next: "ask" },
        { id: "trade", labelZh: "用测线残页换灯油", labelEn: "Trade a survey page for oil", next: "trade", needSurvey: true },
        { id: "warn", labelZh: "前面的路怎样？", labelEn: "What's the way ahead?", next: "warn" }
      ]
    },
    ask: {
      id: "ask",
      nameZh: "打听",
      nameEn: "Ask",
      options: [
        { id: "trade_after_ask", labelZh: "用残页换灯油", labelEn: "Trade a survey page for oil", next: "trade", needSurvey: true },
        { id: "warn_after_ask", labelZh: "那前面危险吗？", labelEn: "Is the way ahead dangerous?", next: "warn" },
        { id: "farewell_after_ask", labelZh: "我该走了", labelEn: "I should go", next: "farewell" }
      ]
    },
    trade: {
      id: "trade",
      nameZh: "交易",
      nameEn: "Trade",
      effect: { type: "trade", itemZh: OIL_ZH, itemEn: OIL_EN, heal: TRADE_HEAL },
      options: [
        { id: "warn_after_trade", labelZh: "前面还要注意什么？", labelEn: "Anything else ahead?", next: "warn" },
        { id: "farewell_after_trade", labelZh: "谢了，我走了", labelEn: "Thanks. I'll go.", next: "farewell" }
      ]
    },
    warn: {
      id: "warn",
      nameZh: "警告",
      nameEn: "Warn",
      effect: { type: "warn" },
      options: [
        { id: "trade_after_warn", labelZh: "用残页换灯油", labelEn: "Trade a survey page for oil", next: "trade", needSurvey: true },
        { id: "farewell_after_warn", labelZh: "记下了", labelEn: "I'll remember", next: "farewell" }
      ]
    },
    farewell: {
      id: "farewell",
      nameZh: "告别",
      nameEn: "Farewell",
      options: [
        { id: "close", labelZh: "点头离开", labelEn: "Nod and leave", next: "done" }
      ]
    },
    done: {
      id: "done",
      nameZh: "话已说完",
      nameEn: "Done",
      options: []
    }
  };

  /**
   * 本地台词库：按「到达的状态 + 带来这一跳的选项」取 2～3 句。
   * 不是聊天记录。同一状态可以换句式，但不能换事实。
   */
  var LINES = {
    greet: {
      open: {
        zh: [
          "灯焰晃到一张被岩粉糊住的脸。他靠着哨壁，地质锤还插在腰带上，像是交接班的人把下一班忘了。「别靠近那条测线。」他说，声音干得像岩芯标签。",
          "这人站得太久，靴边结了一圈盐霜。袖章能认出是前任测绘员，不是幽灵。「你也是来收测线的？」他问，并不让开路。"
        ],
        en: [
          "The flame finds a face filmed with rock flour. He leans on the watch-wall, a geology hammer still in his belt, like a shift that never handed over. \"Stay off that survey line,\" he says, dry as a core tag.",
          "He has stood long enough for salt frost to rim his boots. The sleeve-badge is a former surveyor's, not a ghost's. \"Here for the line too?\" He does not step aside."
        ]
      },
      return_met: {
        zh: [
          "他看了你一眼，像核对测线编号，不是认一张脸。「你下来了。这一层换了图，人还是上一次那个。」锤柄点了点靴帮，没有寒暄。",
          "「同一条测线。」他说，并不问你叫什么。「我记得见过你。别把这当成故事会，我没有你的聊天记录。」"
        ],
        en: [
          "He checks you the way one checks a line number, not a face. \"You came down. New map. Same person.\" The hammer-haft ticks the boot. No small talk.",
          "\"Same survey line,\" he says, and does not ask your name. \"I remember meeting you. This is not a story circle. I keep no transcript.\""
        ]
      },
      return_traded: {
        zh: [
          "他的目光在你空着的手上停了一拍。「油在上一层。页在我这边。这一层我不再换第二次——不是小气，是测区规则。」",
          "「你换过油。」他像读岩芯标签那样读你。「背包可以空，账不能空。别拿残页来问第二次。」"
        ],
        en: [
          "His gaze pauses on your empty hands. \"Oil stayed on the last level. The page stayed with me. I will not trade twice — not spite. Survey rules.\"",
          "\"You already traded.\" He reads you like a core tag. \"A pack can be empty. A ledger cannot. Do not bring another scrap to ask again.\""
        ]
      },
      return_warned: {
        zh: [
          "「警告说过了。」他朝更黑的地方抬了抬下巴，并不去指这一层的哪一格。「我记得你听见过。新的地图不会把旧坐标还给我。」",
          "他不再划那条短线。「你被警告过。这一层的异兆要自己用脚测。我不会把同一句话再发明一遍。」"
        ],
        en: [
          "\"The warning is spent.\" He lifts his chin toward darker rock and does not point at a tile on this map. \"I remember you heard. A new map will not give me the old coordinates.\"",
          "He does not draw the short line again. \"You were warned. Survey this level's omens with your feet. I will not invent the same sentence twice.\""
        ]
      },
      return_both: {
        zh: [
          "他几乎没有抬头。「油换过。警告听过。你还下来，说明灯还亮着。」野簿合着，像一栏已经勾完的表。",
          "「两件事都记着：页换了油，路被标过。」他让开半肩，仍不让路。「这一层没有新的交易，也没有第二遍良心。」"
        ],
        en: [
          "He barely looks up. \"Oil traded. Warning heard. You came down, so the flame still lives.\" The field book stays shut, a form with both boxes ticked.",
          "\"Two facts: page for oil, the way marked.\" He gives you half a shoulder, not the path. \"No second trade on this level. No second conscience.\""
        ]
      }
    },
    ask: {
      ask: {
        zh: [
          "「第三测区的导线。墨水在潮气里开花，我把半页夹进本子，其余的——」他抬下巴，指向你还没走进的黑。「断层在滴水。记录比人耐放。」",
          "他从怀里摸出一本封皮开裂的野簿，空白比字多。「我在等一个永远不会上来的助手。你要是看见半页测线记录，别当废纸。那是这层唯一还认路的东西。」"
        ],
        en: [
          "\"Traverse of the third survey block. The ink bloomed in the damp; I kept half a page. The rest—\" He lifts his chin toward dark you have not walked. \"The fault is dripping. Notes outlast people.\"",
          "He draws a field book whose cover has split; blank outnumbers ink. \"I am waiting for a helper who will not come up. If you find a torn survey sheet, it is not scrap. It is the only thing on this level that still knows the way.\""
        ]
      }
    },
    trade: {
      trade: {
        zh: [
          "他把残页对上野簿的撕口，点一点头，像核对层位代号。一壶还封着的灯油换到你手里，金属壁上有白班的温度——错觉，但肩头松了。「油归你。页归档案。谁也不许再发明一个数字。」",
          "残页从你掌心抽走，灯油罐的铁丝被他咬开。油脂味盖过霉味。他不看你的伤口，只说：「喝不下去。擦手腕。黑暗不缩小，人可以再走一段。」"
        ],
        en: [
          "He matches the scrap to the tear in the field book, a nod like checking a horizon code. A still-sealed vial of oil finds your hand. The metal pretends it remembers day-shift. \"Oil for you. Page for the archive. Nobody invents a number.\"",
          "The scrap leaves your palm. He bites the wire on the can. Grease drowns mold. He does not look at your cuts. \"You cannot drink it. Rub the wrist. The dark does not shrink. You can walk farther.\""
        ]
      },
      trade_after_ask: {
        zh: [
          "「所以你真带着页。」他几乎笑了一下，随即收住。残页进野簿，灯油进你的壶。暖意从指节爬回小臂。「现在我们是同一条测线上的两个人。别死在编号还没写完的地方。」",
          "他核对了撕口的纤维方向，才肯交油。「测线不能缺页。人可以缺一顿。」罐盖打开时油味冲眼，随后指节不再那么僵。"
        ],
        en: [
          "\"So you did bring the page.\" Almost a smile, then none. Scrap into the book, oil into your flask. Warmth climbs the forearm. \"Two people on one line now. Do not die where the number is unfinished.\"",
          "He checks the fibre of the tear before he yields the oil. \"A line cannot miss a page. A person can miss a meal.\" The smell stings; the knuckles unstiffen."
        ]
      },
      trade_after_warn: {
        zh: [
          "警告说过了，交易才肯做——他像按规范走完两栏。「页换油。油不能让顶板变老实，只能让你摔得没那么快。」罐子到手，肩头那块发紧的地方松了。",
          "他一边把残页压进夹层，一边仍盯着那条你还没走的走廊。「拿去。被我标过的地方，别用油去赌运气。」"
        ],
        en: [
          "The warning first, then the trade — two columns of a form. \"Page for oil. Oil will not civilize the roof. It only lets you fall more slowly.\" The tightness in the shoulder lets go.",
          "He presses the scrap into the sleeve and still watches the unwalked corridor. \"Take it. Do not spend oil gambling on a place I already marked.\""
        ]
      }
    },
    warn: {
      warn: {
        zh: [
          "他在空气里划了一条短线，指向你火把照不到的拐角。「那一格在滴。不是水的声音，是碎石在重新找安息角。我把它记成危险——你的地图若肯听人，就该亮起来。」",
          "「走廊里有一处异兆，我踩过一次，顶板咬合又张开。」他不再看你，只看岩壁的层理。「我不能替你决定走不走。我只能让它不再假装是普通的地砖。」"
        ],
        en: [
          "He draws a short line in the air, toward a corner your flame does not own. \"That tile drips. Not water — scree looking for its angle of rest. I marked it dangerous. If your map will listen, it should light.\"",
          "\"An omen in the corridor. I stepped it once; the roof bit and opened.\" He watches bedding, not you. \"I cannot choose your feet. I can stop the floor pretending it is ordinary tile.\""
        ]
      },
      warn_after_ask: {
        zh: [
          "「你问测的是什么，答案在那条还没走的走廊里。」他用锤柄敲了敲靴帮，像给危险打拍子。「我标过一格。灯油救不了塌方，但眼睛可以少受一次骗。」",
          "野簿翻到夹着空页的那面。「导线在异兆那儿断了。你要是非走，至少走我标过的那一格——知道它会咬人，比不知道公平。」"
        ],
        en: [
          "\"You asked what I was surveying. The answer is in the corridor you have not walked.\" The hammer-haft ticks his boot, a metronome for hazard. \"I marked one tile. Oil will not stop a cave-in. Eyes can be fooled one time less.\"",
          "The book opens on a blank. \"The traverse dies at the omen. If you must go, go the tile I marked — knowing it bites is fairer than not.\""
        ]
      },
      warn_after_trade: {
        zh: [
          "油已经在你身上。他这才肯把更坏的消息说完：「前面那格我会给你标出来。别以为换了油就可以用肩膀去试顶板。」",
          "「交易是规范，警告是良心。」他指向黑暗里某一处你暂时看不见的地方。「灯焰到了会认。别装没看见。」"
        ],
        en: [
          "The oil is yours; only then the worse news. \"I will mark the tile ahead. Do not think the vial licenses your shoulder to test the roof.\"",
          "\"Trade is procedure. Warning is conscience.\" He points at a dark you cannot yet see. \"The flame will know it. Do not pretend otherwise.\""
        ]
      }
    },
    farewell: {
      farewell_after_ask: {
        zh: [
          "他重新靠回哨壁，像把交接班的话又咽回去。「测线还在。人不必一直站在这里。」灯焰在他脸上停了一拍，随即只剩岩粉。",
          "「去吧。若下一层还有哨，别指望我也在。我只是这一间房的表。」"
        ],
        en: [
          "He leans back into the watch-wall, the handover swallowed. \"The line remains. A person need not remain.\" The flame pauses on his face, then only flour.",
          "\"Go. If a watch post exists on the next level, do not expect me. I am only the table in this room.\""
        ]
      },
      farewell_after_trade: {
        zh: [
          "他按了按野簿，确认残页不会再掉出来。「油在你壶里。页在我这一侧。我们两清——不是友情，是测区规则。」",
          "「走。别在走廊里打开罐子。油是给人的，不是给岩石闻的。」"
        ],
        en: [
          "He presses the book shut so the scrap cannot fall. \"Oil in your flask. Page on my side. We are even — not friendship. Survey rules.\"",
          "\"Walk. Do not open the vial in the corridor. Oil is for people, not for rock to smell.\""
        ]
      },
      farewell_after_warn: {
        zh: [
          "「记住那一格就够了。我不会跟你走。」他闭上眼，仍能把危险指给你——因为危险写在表上，不写在情绪里。",
          "哨壁把他说过的话吸进去一点。「前面会咬。你已经听见。其余的，用脚去测。」"
        ],
        en: [
          "\"Remember the tile. I will not walk with you.\" Eyes shut, he can still point at hazard — because it lives in a table, not in a mood.",
          "The wall takes back a little of what he said. \"It will bite. You have heard. The rest, survey with your feet.\""
        ]
      }
    },
    done: {
      reopen: {
        zh: [
          "他只点了点头。话已经按表说完，不肯再发明一句。",
          "测绘员看着你，像看着一根已经测过的导线。没有新的状态可跳。"
        ],
        en: [
          "A nod. The table has spent its lines. He will not invent another.",
          "The surveyor looks at you the way one looks at a traverse already closed. No new state to jump."
        ]
      }
    }
  };

  var panel = null;
  var lineEl = null;
  var optEl = null;
  var whoEl = null;
  var stateEl = null;
  var open = false;
  var waiting = false;
  var wasAdjacent = false;

  function stateById(id) {
    return TABLE[id] || null;
  }

  function hasSurvey(inv) {
    inv = inv || [];
    for (var i = 0; i < inv.length; i++) {
      if (SURVEY_RE.test(String(inv[i]))) return true;
    }
    return false;
  }

  function takeSurvey(inv) {
    for (var i = 0; i < inv.length; i++) {
      if (SURVEY_RE.test(String(inv[i]))) return inv.splice(i, 1)[0];
    }
    return null;
  }

  /**
   * 只接受表里写过的那一跳。问候不能直接告别；也不能跳到未列出的状态。
   */
  function findOption(fromId, optionId) {
    var st = stateById(fromId);
    if (!st || !st.options) return null;
    for (var i = 0; i < st.options.length; i++) {
      if (st.options[i].id === optionId) return st.options[i];
    }
    return null;
  }

  function canUseOption(opt, npc, inv) {
    if (!opt) return false;
    if (opt.next === "trade" && npc.traded) return false;
    if (opt.next === "warn" && npc.warned) return false;
    if (opt.needSurvey && !hasSurvey(inv)) return false;
    return true;
  }

  function visibleOptions(npc, inv) {
    var st = stateById(npc.state);
    if (!st) return [];
    var out = [];
    for (var i = 0; i < st.options.length; i++) {
      var opt = st.options[i];
      if (opt.hidden) continue;
      var row = {
        id: opt.id,
        labelZh: opt.labelZh,
        labelEn: opt.labelEn,
        next: opt.next,
        needSurvey: !!opt.needSurvey,
        enabled: canUseOption(opt, npc, inv)
      };
      if (opt.next === "trade" && npc.traded) continue;
      if (opt.next === "warn" && npc.warned) continue;
      out.push(row);
    }
    return out;
  }

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
    map.npc = {
      x: cell.x,
      y: cell.y,
      roomId: room.id,
      kind: room.kind,
      roomNameZh: room.nameZh,
      roomNameEn: room.nameEn,
      nameZh: "灰岩",
      nameEn: "Huiyan",
      titleZh: "前任测绘员",
      titleEn: "former surveyor",
      state: "idle",
      traded: false,
      warned: false,
      met: false,
      last_state: "idle"
    };
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

  function greetOpenBank(ctx) {
    var pack = LINES.greet;
    if (!ctx.npcMet) return pack.open;
    if (ctx.npcTraded && ctx.npcWarned) return pack.return_both;
    if (ctx.npcTraded) return pack.return_traded;
    if (ctx.npcWarned) return pack.return_warned;
    return pack.return_met;
  }

  function localLine(ctx) {
    var lang = ctx.lang || "zh";
    if (lang === "mix") {
      var a = localLine(Object.assign({}, ctx, { lang: "zh" }));
      var b = localLine(Object.assign({}, ctx, { lang: "en" }));
      return a + "\n" + b;
    }
    var pack = LINES[ctx.npcState] || {};
    var bank = pack[ctx.npcOption] || pack.open || pack.reopen;
    if (ctx.npcState === "greet" && (ctx.npcOption === "open" || !ctx.npcOption)) {
      bank = greetOpenBank(ctx);
    }
    if (!bank) {
      var keys = Object.keys(pack);
      if (keys.length) bank = pack[keys[0]];
    }
    if (!bank) {
      return lang === "en"
        ? "He says nothing the table did not already allow."
        : "表上没有的话，他一句也不肯说。";
    }
    var list = lang === "en" ? bank.en : bank.zh;
    var rng = RNG.fromSeed(
      (ctx.seed || "stardust") + "|npc|" + ctx.npcState + "|" + (ctx.npcOption || "open")
      + "|m" + (ctx.npcMet ? "1" : "0")
      + "|t" + (ctx.npcTraded ? "1" : "0")
      + "|w" + (ctx.npcWarned ? "1" : "0")
    );
    return rng.pick(list);
  }

  function applyEffect(npc, stateObj, game) {
    if (!stateObj || !stateObj.effect) return null;
    var fx = stateObj.effect;
    if (fx.type === "trade") {
      if (npc.traded) return { type: "trade", skipped: true };
      if (!hasSurvey(Events.inventory)) return { type: "trade", error: "没有测线残页" };
      var lost = takeSurvey(Events.inventory);
      Events.inventory.push(fx.itemZh);
      var before = Events.hp;
      Events.hp = Math.min(Events.maxHp, Events.hp + fx.heal);
      npc.traded = true;
      return {
        type: "trade",
        beforeHp: before,
        afterHp: Events.hp,
        heal: fx.heal,
        gained: fx.itemZh,
        lost: lost
      };
    }
    if (fx.type === "warn") {
      if (npc.warned) return { type: "warn", skipped: true };
      npc.warned = true;
      Events.warned = true;
      var mark = markNearestEvent(game);
      Events.warnedEvent = mark;
      return { type: "warn", marked: mark };
    }
    return null;
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

  function mechanicLine(outcome) {
    if (!outcome) return "";
    if (outcome.error) return outcome.error;
    if (outcome.skipped) return "";
    var bits = [];
    if (outcome.type === "trade") {
      bits.push("HP " + outcome.beforeHp + "→" + outcome.afterHp);
      if (outcome.lost) bits.push("交出 " + outcome.lost);
      if (outcome.gained) bits.push("获得 " + outcome.gained);
    }
    if (outcome.type === "warn") {
      bits.push(outcome.marked ? "已标记一处异兆" : "警告已记下");
    }
    return bits.join(" · ");
  }

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
