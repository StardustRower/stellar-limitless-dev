class_name HuiyanTable
extends RefCounted
## 灰岩的状态表：从 js/npc-table.js 抄进 Godot 的 Dictionary。
## 不要在这一课另写一套问候/交易/告别——改 next / heal，应和 HTML 演示同一张图。
##
## 下一课可以让按钮去问同一本 FastAPI 旗标账本（server/ledger.py）。
## 不是这一课：这一课只证明表能站进 Godot 的节点树，不接 HTTP、不接 LLM。

const TRADE_HEAL := 3
const OIL_ZH := "一小壶灯油"
const OIL_EN := "a vial of lamp oil"
const SURVEY_ITEM := "半页测线记录，墨水遇潮发花"
const START_HP := 7
const MAX_HP := 10

## 状态表。和 GM.TABLE / js/npc-table.js 同构：能发生的事必须先写在这里。
## 图（不能从问候直接跳到告别——那一跳不在表里）：
##   idle → greet → ask / trade / warn → … → farewell → done
const TABLE := {
	"idle": {
		"id": "idle",
		"nameZh": "未交谈",
		"nameEn": "Idle",
		"options": [
			{
				"id": "open",
				"hidden": true,
				"next": "greet"
			}
		]
	},
	"greet": {
		"id": "greet",
		"nameZh": "问候",
		"nameEn": "Greet",
		"options": [
			{
				"id": "ask",
				"labelZh": "你在测什么？",
				"labelEn": "What were you surveying?",
				"next": "ask"
			},
			{
				"id": "trade",
				"labelZh": "用测线残页换灯油",
				"labelEn": "Trade a survey page for oil",
				"next": "trade",
				"needSurvey": true
			},
			{
				"id": "warn",
				"labelZh": "前面的路怎样？",
				"labelEn": "What's the way ahead?",
				"next": "warn"
			}
		]
	},
	"ask": {
		"id": "ask",
		"nameZh": "打听",
		"nameEn": "Ask",
		"options": [
			{
				"id": "trade_after_ask",
				"labelZh": "用残页换灯油",
				"labelEn": "Trade a survey page for oil",
				"next": "trade",
				"needSurvey": true
			},
			{
				"id": "warn_after_ask",
				"labelZh": "那前面危险吗？",
				"labelEn": "Is the way ahead dangerous?",
				"next": "warn"
			},
			{
				"id": "farewell_after_ask",
				"labelZh": "我该走了",
				"labelEn": "I should go",
				"next": "farewell"
			}
		]
	},
	"trade": {
		"id": "trade",
		"nameZh": "交易",
		"nameEn": "Trade",
		"effect": {
			"type": "trade",
			"itemZh": "一小壶灯油",
			"itemEn": "a vial of lamp oil",
			"heal": 3
		},
		"options": [
			{
				"id": "warn_after_trade",
				"labelZh": "前面还要注意什么？",
				"labelEn": "Anything else ahead?",
				"next": "warn"
			},
			{
				"id": "farewell_after_trade",
				"labelZh": "谢了，我走了",
				"labelEn": "Thanks. I'll go.",
				"next": "farewell"
			}
		]
	},
	"warn": {
		"id": "warn",
		"nameZh": "警告",
		"nameEn": "Warn",
		"effect": {
			"type": "warn"
		},
		"options": [
			{
				"id": "trade_after_warn",
				"labelZh": "用残页换灯油",
				"labelEn": "Trade a survey page for oil",
				"next": "trade",
				"needSurvey": true
			},
			{
				"id": "farewell_after_warn",
				"labelZh": "记下了",
				"labelEn": "I'll remember",
				"next": "farewell"
			}
		]
	},
	"farewell": {
		"id": "farewell",
		"nameZh": "告别",
		"nameEn": "Farewell",
		"options": [
			{
				"id": "close",
				"labelZh": "点头离开",
				"labelEn": "Nod and leave",
				"next": "done"
			}
		]
	},
	"done": {
		"id": "done",
		"nameZh": "话已说完",
		"nameEn": "Done",
		"options": []
	}
}

const LINES := {
	"greet": {
		"open": {
			"zh": ["灯焰晃到一张被岩粉糊住的脸。他靠着哨壁，地质锤还插在腰带上，像是交接班的人把下一班忘了。「别靠近那条测线。」他说，声音干得像岩芯标签。", "这人站得太久，靴边结了一圈盐霜。袖章能认出是前任测绘员，不是幽灵。「你也是来收测线的？」他问，并不让开路。"],
			"en": ["The flame finds a face filmed with rock flour. He leans on the watch-wall, a geology hammer still in his belt, like a shift that never handed over. \"Stay off that survey line,\" he says, dry as a core tag.", "He has stood long enough for salt frost to rim his boots. The sleeve-badge is a former surveyor's, not a ghost's. \"Here for the line too?\" He does not step aside."]
		},
		"return_met": {
			"zh": ["他看了你一眼，像核对测线编号，不是认一张脸。「你下来了。这一层换了图，人还是上一次那个。」锤柄点了点靴帮，没有寒暄。", "「同一条测线。」他说，并不问你叫什么。「我记得见过你。别把这当成故事会，我没有你的聊天记录。」"],
			"en": ["He checks you the way one checks a line number, not a face. \"You came down. New map. Same person.\" The hammer-haft ticks the boot. No small talk.", "\"Same survey line,\" he says, and does not ask your name. \"I remember meeting you. This is not a story circle. I keep no transcript.\""]
		},
		"return_traded": {
			"zh": ["他的目光在你空着的手上停了一拍。「油在上一层。页在我这边。这一层我不再换第二次——不是小气，是测区规则。」", "「你换过油。」他像读岩芯标签那样读你。「背包可以空，账不能空。别拿残页来问第二次。」"],
			"en": ["His gaze pauses on your empty hands. \"Oil stayed on the last level. The page stayed with me. I will not trade twice — not spite. Survey rules.\"", "\"You already traded.\" He reads you like a core tag. \"A pack can be empty. A ledger cannot. Do not bring another scrap to ask again.\""]
		},
		"return_warned": {
			"zh": ["「警告说过了。」他朝更黑的地方抬了抬下巴，并不去指这一层的哪一格。「我记得你听见过。新的地图不会把旧坐标还给我。」", "他不再划那条短线。「你被警告过。这一层的异兆要自己用脚测。我不会把同一句话再发明一遍。」"],
			"en": ["\"The warning is spent.\" He lifts his chin toward darker rock and does not point at a tile on this map. \"I remember you heard. A new map will not give me the old coordinates.\"", "He does not draw the short line again. \"You were warned. Survey this level's omens with your feet. I will not invent the same sentence twice.\""]
		},
		"return_both": {
			"zh": ["他几乎没有抬头。「油换过。警告听过。你还下来，说明灯还亮着。」野簿合着，像一栏已经勾完的表。", "「两件事都记着：页换了油，路被标过。」他让开半肩，仍不让路。「这一层没有新的交易，也没有第二遍良心。」"],
			"en": ["He barely looks up. \"Oil traded. Warning heard. You came down, so the flame still lives.\" The field book stays shut, a form with both boxes ticked.", "\"Two facts: page for oil, the way marked.\" He gives you half a shoulder, not the path. \"No second trade on this level. No second conscience.\""]
		}
	},
	"ask": {
		"ask": {
			"zh": ["「第三测区的导线。墨水在潮气里开花，我把半页夹进本子，其余的——」他抬下巴，指向你还没走进的黑。「断层在滴水。记录比人耐放。」", "他从怀里摸出一本封皮开裂的野簿，空白比字多。「我在等一个永远不会上来的助手。你要是看见半页测线记录，别当废纸。那是这层唯一还认路的东西。」"],
			"en": ["\" Traverse of the third survey block. The ink bloomed in the damp; I kept half a page. The rest—\" He lifts his chin toward dark you have not walked. \"The fault is dripping. Notes outlast people.\"", "He draws a field book whose cover has split; blank outnumbers ink. \"I am waiting for a helper who will not come up. If you find a torn survey sheet, it is not scrap. It is the only thing on this level that still knows the way.\""]
		}
	},
	"trade": {
		"trade": {
			"zh": ["他把残页对上野簿的撕口，点一点头，像核对层位代号。一壶还封着的灯油换到你手里，金属壁上有白班的温度——错觉，但肩头松了。「油归你。页归档案。谁也不许再发明一个数字。」", "残页从你掌心抽走，灯油罐的铁丝被他咬开。油脂味盖过霉味。他不看你的伤口，只说：「喝不下去。擦手腕。黑暗不缩小，人可以再走一段。」"],
			"en": ["He matches the scrap to the tear in the field book, a nod like checking a horizon code. A still-sealed vial of oil finds your hand. The metal pretends it remembers day-shift. \"Oil for you. Page for the archive. Nobody invents a number.\"", "The scrap leaves your palm. He bites the wire on the can. Grease drowns mold. He does not look at your cuts. \"You cannot drink it. Rub the wrist. The dark does not shrink. You can walk farther.\""]
		},
		"trade_after_ask": {
			"zh": ["「所以你真带着页。」他几乎笑了一下，随即收住。残页进野簿，灯油进你的壶。暖意从指节爬回小臂。「现在我们是同一条测线上的两个人。别死在编号还没写完的地方。」", "他核对了撕口的纤维方向，才肯交油。「测线不能缺页。人可以缺一顿。」罐盖打开时油味冲眼，随后指节不再那么僵。"],
			"en": ["\"So you did bring the page.\" Almost a smile, then none. Scrap into the book, oil into your flask. Warmth climbs the forearm. \"Two people on one line now. Do not die where the number is unfinished.\"", "He checks the fibre of the tear before he yields the oil. \"A line cannot miss a page. A person can miss a meal.\" The smell stings; the knuckles unstiffen."]
		},
		"trade_after_warn": {
			"zh": ["警告说过了，交易才肯做——他像按规范走完两栏。「页换油。油不能让顶板变老实，只能让你摔得没那么快。」罐子到手，肩头那块发紧的地方松了。", "他一边把残页压进夹层，一边仍盯着那条你还没走的走廊。「拿去。被我标过的地方，别用油去赌运气。」"],
			"en": ["The warning first, then the trade — two columns of a form. \"Page for oil. Oil will not civilize the roof. It only lets you fall more slowly.\" The tightness in the shoulder lets go.", "He presses the scrap into the sleeve and still watches the unwalked corridor. \"Take it. Do not spend oil gambling on a place I already marked.\""]
		}
	},
	"warn": {
		"warn": {
			"zh": ["他在空气里划了一条短线，指向你火把照不到的拐角。「那一格在滴。不是水的声音，是碎石在重新找安息角。我把它记成危险——你的地图若肯听人，就该亮起来。」", "「走廊里有一处异兆，我踩过一次，顶板咬合又张开。」他不再看你，只看岩壁的层理。「我不能替你决定走不走。我只能让它不再假装是普通的地砖。」"],
			"en": ["He draws a short line in the air, toward a corner your flame does not own. \"That tile drips. Not water — scree looking for its angle of rest. I marked it dangerous. If your map will listen, it should light.\"", "\"An omen in the corridor. I stepped it once; the roof bit and opened.\" He watches bedding, not you. \"I cannot choose your feet. I can stop the floor pretending it is ordinary tile.\""]
		},
		"warn_after_ask": {
			"zh": ["「你问测的是什么，答案在那条还没走的走廊里。」他用锤柄敲了敲靴帮，像给危险打拍子。「我标过一格。灯油救不了塌方，但眼睛可以少受一次骗。」", "野簿翻到夹着空页的那面。「导线在异兆那儿断了。你要是非走，至少走我标过的那一格——知道它会咬人，比不知道公平。」"],
			"en": ["\"You asked what I was surveying. The answer is in the corridor you have not walked.\" The hammer-haft ticks his boot, a metronome for hazard. \"I marked one tile. Oil will not stop a cave-in. Eyes can be fooled one time less.\"", "The book opens on a blank. \"The traverse dies at the omen. If you must go, go the tile I marked — knowing it bites is fairer than not.\""]
		},
		"warn_after_trade": {
			"zh": ["油已经在你身上。他这才肯把更坏的消息说完：「前面那格我会给你标出来。别以为换了油就可以用肩膀去试顶板。」", "「交易是规范，警告是良心。」他指向黑暗里某一处你暂时看不见的地方。「灯焰到了会认。别装没看见。」"],
			"en": ["The oil is yours; only then the worse news. \"I will mark the tile ahead. Do not think the vial licenses your shoulder to test the roof.\"", "\"Trade is procedure. Warning is conscience.\" He points at a dark you cannot yet see. \"The flame will know it. Do not pretend otherwise.\""]
		}
	},
	"farewell": {
		"farewell_after_ask": {
			"zh": ["他重新靠回哨壁，像把交接班的话又咽回去。「测线还在。人不必一直站在这里。」灯焰在他脸上停了一拍，随即只剩岩粉。", "「去吧。若下一层还有哨，别指望我也在。我只是这一间房的表。」"],
			"en": ["He leans back into the watch-wall, the handover swallowed. \"The line remains. A person need not remain.\" The flame pauses on his face, then only flour.", "\"Go. If a watch post exists on the next level, do not expect me. I am only the table in this room.\""]
		},
		"farewell_after_trade": {
			"zh": ["他按了按野簿，确认残页不会再掉出来。「油在你壶里。页在我这一侧。我们两清——不是友情，是测区规则。」", "「走。别在走廊里打开罐子。油是给人的，不是给岩石闻的。」"],
			"en": ["He presses the book shut so the scrap cannot fall. \"Oil in your flask. Page on my side. We are even — not friendship. Survey rules.\"", "\"Walk. Do not open the vial in the corridor. Oil is for people, not for rock to smell.\""]
		},
		"farewell_after_warn": {
			"zh": ["「记住那一格就够了。我不会跟你走。」他闭上眼，仍能把危险指给你——因为危险写在表上，不写在情绪里。", "哨壁把他说过的话吸进去一点。「前面会咬。你已经听见。其余的，用脚去测。」"],
			"en": ["\"Remember the tile. I will not walk with you.\" Eyes shut, he can still point at hazard — because it lives in a table, not in a mood.", "The wall takes back a little of what he said. \"It will bite. You have heard. The rest, survey with your feet.\""]
		}
	},
	"done": {
		"reopen": {
			"zh": ["他只点了点头。话已经按表说完，不肯再发明一句。", "测绘员看着你，像看着一根已经测过的导线。没有新的状态可跳。"],
			"en": ["A nod. The table has spent its lines. He will not invent another.", "The surveyor looks at you the way one looks at a traverse already closed. No new state to jump."]
		}
	}
}

static func state_by_id(id: String):
	if TABLE.has(id):
		return TABLE[id]
	return null


static func has_survey(inv: Array) -> bool:
	for item in inv:
		var text := str(item)
		if text.contains("测线") or text.to_lower().contains("survey"):
			return true
	return false


static func take_survey(inv: Array):
	for i in range(inv.size()):
		var text := str(inv[i])
		if text.contains("测线") or text.to_lower().contains("survey"):
			return inv.pop_at(i)
	return null


## 只接受表里写过的那一跳。问候不能直接告别；也不能跳到未列出的状态。
static func find_option(from_id: String, option_id: String):
	var st = state_by_id(from_id)
	if st == null or not st.has("options"):
		return null
	for opt in st.options:
		if opt.get("id", "") == option_id:
			return opt
	return null


static func can_use_option(opt, npc: Dictionary, inv: Array) -> bool:
	if opt == null:
		return false
	if str(opt.get("next", "")) == "trade" and npc.get("traded", false):
		return false
	if str(opt.get("next", "")) == "warn" and npc.get("warned", false):
		return false
	if opt.get("needSurvey", false) and not has_survey(inv):
		return false
	return true


static func visible_options(npc: Dictionary, inv: Array) -> Array:
	var st = state_by_id(str(npc.get("state", "")))
	if st == null:
		return []
	var out: Array = []
	for opt in st.options:
		if opt.get("hidden", false):
			continue
		if str(opt.get("next", "")) == "trade" and npc.get("traded", false):
			continue
		if str(opt.get("next", "")) == "warn" and npc.get("warned", false):
			continue
		out.append({
			"id": opt.get("id", ""),
			"labelZh": opt.get("labelZh", ""),
			"labelEn": opt.get("labelEn", ""),
			"next": opt.get("next", ""),
			"needSurvey": bool(opt.get("needSurvey", false)),
			"enabled": can_use_option(opt, npc, inv),
		})
	return out


static func make_npc() -> Dictionary:
	return {
		"nameZh": "灰岩",
		"nameEn": "Huiyan",
		"titleZh": "前任测绘员",
		"titleEn": "former surveyor",
		"state": "idle",
		"traded": false,
		"warned": false,
		"met": false,
		"last_state": "idle",
	}


static func greet_open_bank(ctx: Dictionary):
	var pack: Dictionary = LINES["greet"]
	if not ctx.get("npcMet", false):
		return pack["open"]
	if ctx.get("npcTraded", false) and ctx.get("npcWarned", false):
		return pack["return_both"]
	if ctx.get("npcTraded", false):
		return pack["return_traded"]
	if ctx.get("npcWarned", false):
		return pack["return_warned"]
	return pack["return_met"]


static func local_line(ctx: Dictionary) -> String:
	var lang := str(ctx.get("lang", "zh"))
	if lang == "mix":
		var zh_ctx := ctx.duplicate()
		zh_ctx["lang"] = "zh"
		var en_ctx := ctx.duplicate()
		en_ctx["lang"] = "en"
		return local_line(zh_ctx) + "\n" + local_line(en_ctx)
	var pack = LINES.get(str(ctx.get("npcState", "")), {})
	if typeof(pack) != TYPE_DICTIONARY:
		pack = {}
	var option_id := str(ctx.get("npcOption", ""))
	var bank = pack.get(option_id, pack.get("open", pack.get("reopen", null)))
	if str(ctx.get("npcState", "")) == "greet" and (option_id == "open" or option_id == ""):
		bank = greet_open_bank(ctx)
	if bank == null and pack.size() > 0:
		bank = pack[pack.keys()[0]]
	if bank == null:
		return "表上没有的话，他一句也不肯说。" if lang != "en" else "He says nothing the table did not already allow."
	var list = bank["en"] if lang == "en" else bank["zh"]
	var seed := "%s|npc|%s|%s|m%s|t%s|w%s" % [
		str(ctx.get("seed", "stardust")),
		str(ctx.get("npcState", "")),
		option_id if option_id != "" else "open",
		"1" if ctx.get("npcMet", false) else "0",
		"1" if ctx.get("npcTraded", false) else "0",
		"1" if ctx.get("npcWarned", false) else "0",
	]
	return _pick(list, seed)


static func _pick(list: Array, seed_text: String) -> String:
	if list.is_empty():
		return ""
	# FNV-1a 32-bit，和 js/rng.js 的 hashString 同一思路：同一种子挑同一句。
	var h := 2166136261
	for i in seed_text.length():
		h = int(h ^ seed_text.unicode_at(i)) * 16777619
		h = h & 0xFFFFFFFF
	return str(list[h % list.size()])


## 表驱动的世界后果。world 只需 hp / maxHp / inventory。
## 这一幕没有格子，警告只立旗标。
static func apply_world_effect(npc: Dictionary, state_obj, world: Dictionary):
	if state_obj == null or not state_obj.has("effect"):
		return null
	var fx: Dictionary = state_obj.effect
	if str(fx.get("type", "")) == "trade":
		if npc.get("traded", false):
			return {"type": "trade", "skipped": true}
		if not has_survey(world.inventory):
			return {"type": "trade", "error": "没有测线残页"}
		var lost = take_survey(world.inventory)
		world.inventory.append(str(fx.get("itemZh", OIL_ZH)))
		var before: int = int(world.hp)
		var heal: int = int(fx.get("heal", TRADE_HEAL))
		world.hp = mini(int(world.maxHp), before + heal)
		npc.traded = true
		return {
			"type": "trade",
			"beforeHp": before,
			"afterHp": world.hp,
			"heal": heal,
			"gained": fx.get("itemZh", OIL_ZH),
			"lost": lost,
		}
	if str(fx.get("type", "")) == "warn":
		if npc.get("warned", false):
			return {"type": "warn", "skipped": true}
		npc.warned = true
		world.warned = true
		return {"type": "warn"}
	return null


static func mechanic_line(outcome) -> String:
	if outcome == null:
		return ""
	if outcome.get("error", ""):
		return str(outcome.error)
	if outcome.get("skipped", false):
		return ""
	var bits: Array[String] = []
	if str(outcome.get("type", "")) == "trade":
		bits.append("HP %s→%s" % [str(outcome.beforeHp), str(outcome.afterHp)])
		if outcome.get("lost", null):
			bits.append("交出 %s" % str(outcome.lost))
		if outcome.get("gained", null):
			bits.append("获得 %s" % str(outcome.gained))
	if str(outcome.get("type", "")) == "warn":
		bits.append("警告已记下")
	return " · ".join(bits)
