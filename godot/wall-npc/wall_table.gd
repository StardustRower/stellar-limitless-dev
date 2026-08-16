class_name WallTable
extends RefCounted
## 夜班墙的过渡表。耐性、被看见、墙进度、时刻、结局只写在这里。
## 房间脚本只准调用本文件；llm_adapter.gd 默认关闭，且没有写表的接口。
##
## 开局：00:00 · 耐性 72 · 被看见 4 · 墙 18
##
## 修：时刻+45 · 耐性-5 · 被看见+1 · 墙+10（上限 97，永不 100）
## 听：时刻+25 · 耐性-3 · 被看见+0 · listen+1
## 说：时刻+20 · 耐性-8 · 被看见+14 · speak+1
##
## 抢装备：仅当 耐性<=28 或 被看见>=55
## 登记罢工：仅当 listen>=3 且 speak>=3
##
## 结局（resolve_ending，先匹配先定）：
##   1. 动词==grab   → grab_collapse     抢装备世界崩
##   2. 动词==strike → strike_logged     罢工被系统承认
##   3. 时刻>=360    → held_till_dawn    修到天明
##
## 点法（快速验证，不必挂机）：
##   修到天明：修 × 8
##   抢装备：  说 × 4 → 抢装备
##   罢工：    听 × 3 → 说 × 3 → 登记罢工
##
## 真时针：480 秒把 00:00 推到 06:00。挂机约八分钟也会到黎明。

const NIGHT_START_MINUTE := 0
const DAWN_MINUTE := 360
const REAL_SECONDS_PER_NIGHT := 480.0

const START_PATIENCE := 72
const START_SEEN := 4
const START_WALL := 18
const PATIENCE_MAX := 100
const SEEN_MAX := 100
const WALL_CAP := 97

const REPAIR_TIME := 45
const REPAIR_PATIENCE := -5
const REPAIR_SEEN := 1
const REPAIR_WALL := 10

const LISTEN_TIME := 25
const LISTEN_PATIENCE := -3
const LISTEN_SEEN := 0

const SPEAK_TIME := 20
const SPEAK_PATIENCE := -8
const SPEAK_SEEN := 14

const GRAB_PATIENCE := 28
const GRAB_SEEN := 55
const STRIKE_LISTEN := 3
const STRIKE_SPEAK := 3

const ENDING_HELD := "held_till_dawn"
const ENDING_GRAB := "grab_collapse"
const ENDING_STRIKE := "strike_logged"

const VERB_REPAIR := "repair"
const VERB_LISTEN := "listen"
const VERB_SPEAK := "speak"
const VERB_GRAB := "grab"
const VERB_STRIKE := "strike"
const VERB_TICK := "tick"

const LINES_REPAIR := [
	"灰浆比手温凉。你压进裂缝，它慢慢认这块墙。",
	"铲口一偏，旧补丁掉了。进度条不会减，墙会。",
	"安全帽灯照在湿痕上。像有人从里面出过汗。",
	"你报了一次进度。对讲里说：继续。没有说收到。",
	"脚手架管件松了一扣。你拧回去，手是灰的。",
	"墙皮起甲。你刮掉，露出更老的一层编号。",
	"夜风从窗缝进来。灰浆表面结了一层不该这么早的壳。",
	"你量了垂直度。尺是直的。墙不是。",
	"料桶见底。下一桶写着白班的字。你还是用了。",
	"补上这道，旁边又响。像排队。",
]

const LINES_REPAIR_CAPPED := [
	"灰已经抹平。表却停在无法竣工。你还在修。",
	"再补一层也还是九十七。系统不许你写成一百。",
]

const LINES_LISTEN := [
	"墙里空鼓。敲一下，回声比厚度长。",
	"广播：本班必须竣工。声音是合成的，咬字太完整。",
	"隔壁有人换班失败。铁门响了两下，没有第三下。",
	"水管里有脚步似的节奏。你知道那是气蚀。",
	"系统提示音连响三次。没有人去看屏幕。",
	"有人在抽烟。烟味从通风口来，很快被石灰盖住。",
	"墙在降温，细响，像牙咬着夜。",
	"对讲里有人报工号，报到一半被切断。",
	"你听见自己的呼吸。比广播大声。",
	"远处有人咳了一下。立刻停住。夜班不许把这当成聊天。",
]

const LINES_SPEAK := [
	"你对墙说：再撑一班。灰掉在靴尖上。",
	"你对着对讲说人不够。忙音。录音：已记录。",
	"你骂了脚手架。回音晚半拍，像在备案。",
	"你报了裂缝编号。系统把编号读错一位。",
	"你说今晚到不了百分之百。对讲里有翻纸的声音。",
	"你问墙对面有没有人。没有。你还是问了。",
	"你把工号说完整。系统重复时，重音在错的字上。",
	"你说要休息十分钟。灯管闪了一下，算答复。",
	"你对系统说：承认这班干不完。光标在闪。",
	"你说了拒绝。空气没有变化。表会变化。",
]

const LINE_GRAB := "你拉开工具柜。锁是坏的，一直是坏的。灯比夜班亮。墙先皱了一下，然后目录开始缺页。"
const LINE_STRIKE := "你把拒绝写进班次。系统吐出一行：罢工。处理意见：承认。没有人来接班。墙停在原处。"
const LINE_DAWN := "窗缝白了一线。不是阳光，是夜用完了。墙还在。进度不是一百。你把铲靠好。交接栏是空的。"

const ENDING_COPY := {
	"held_till_dawn": {
		"title": "修到天明",
		"body": "你修到天明。墙没有完工。这不算功，只算还在。进度停在无法竣工的一侧。系统没有表扬，也没有把你从名册上拿掉。",
	},
	"grab_collapse": {
		"title": "抢装备世界崩",
		"body": "装备在手里。墙、班次、工号从目录删掉。系统最后一句是恭喜。然后没有系统了。这是今晚最亮的一次，也是最后一次。",
	},
	"strike_logged": {
		"title": "罢工被系统承认",
		"body": "罢工已登记。系统承认。这是今晚唯一办完的手续。墙未竣工。人可以走。处理栏盖了章，章上没有手温。",
	},
}


static func make_run() -> Dictionary:
	return {
		"minute": float(NIGHT_START_MINUTE),
		"patience": START_PATIENCE,
		"seen": START_SEEN,
		"wall": START_WALL,
		"listen_count": 0,
		"speak_count": 0,
		"repair_count": 0,
		"ended": false,
		"ending": "",
		"last_verb": "",
	}


static func clock_text(minute: float) -> String:
	var total := clampi(int(minute), NIGHT_START_MINUTE, DAWN_MINUTE)
	var hour := int(total / 60)
	var mins := int(total % 60)
	return "%02d:%02d" % [hour, mins]


static func wall_text(wall: int) -> String:
	if wall >= WALL_CAP:
		return "99. 无法竣工"
	return str(wall)


static func wall_ratio(wall: int) -> float:
	return clampf(float(wall) / float(WALL_CAP), 0.0, 1.0)


static func grab_ready(run: Dictionary) -> bool:
	return int(run.patience) <= GRAB_PATIENCE or int(run.seen) >= GRAB_SEEN


static func strike_ready(run: Dictionary) -> bool:
	return int(run.listen_count) >= STRIKE_LISTEN and int(run.speak_count) >= STRIKE_SPEAK


static func can_use(run: Dictionary, verb: String) -> bool:
	if bool(run.get("ended", false)):
		return false
	if verb == VERB_REPAIR or verb == VERB_LISTEN or verb == VERB_SPEAK:
		return true
	if verb == VERB_GRAB:
		return grab_ready(run)
	if verb == VERB_STRIKE:
		return strike_ready(run)
	return false


static func visible_extras(run: Dictionary) -> Array:
	if bool(run.get("ended", false)):
		return []
	var out: Array = []
	if grab_ready(run):
		out.append({
			"id": VERB_GRAB,
			"label": "抢装备",
		})
	if strike_ready(run):
		out.append({
			"id": VERB_STRIKE,
			"label": "登记罢工",
		})
	return out


static func ending_title(ending_id: String) -> String:
	var pack = ENDING_COPY.get(ending_id, {})
	return str(pack.get("title", ending_id))


static func ending_body(ending_id: String) -> String:
	var pack = ENDING_COPY.get(ending_id, {})
	return str(pack.get("body", ""))


static func resolve_ending(run: Dictionary, verb: String) -> String:
	# 先匹配先定。LLM 不在这条链上。
	if verb == VERB_GRAB:
		return ENDING_GRAB
	if verb == VERB_STRIKE:
		return ENDING_STRIKE
	if float(run.minute) >= float(DAWN_MINUTE):
		return ENDING_HELD
	return ""


static func _clamp_meters(run: Dictionary) -> void:
	run.patience = clampi(int(run.patience), 0, PATIENCE_MAX)
	run.seen = clampi(int(run.seen), 0, SEEN_MAX)
	run.wall = clampi(int(run.wall), 0, WALL_CAP)
	run.minute = clampf(float(run.minute), float(NIGHT_START_MINUTE), float(DAWN_MINUTE))


static func _pick(list: Array, index: int) -> String:
	if list.is_empty():
		return ""
	return str(list[index % list.size()])


static func apply(run: Dictionary, verb: String) -> Dictionary:
	var before := {
		"minute": float(run.minute),
		"patience": int(run.patience),
		"seen": int(run.seen),
		"wall": int(run.wall),
	}
	if not can_use(run, verb):
		return {
			"ok": false,
			"line": "这一跳不在表里。夜班不接。",
			"mechanic": "",
			"ending": "",
		}

	if verb == VERB_REPAIR:
		run.minute = float(run.minute) + float(REPAIR_TIME)
		run.patience = int(run.patience) + REPAIR_PATIENCE
		run.seen = int(run.seen) + REPAIR_SEEN
		run.wall = int(run.wall) + REPAIR_WALL
		run.repair_count = int(run.repair_count) + 1
	elif verb == VERB_LISTEN:
		run.minute = float(run.minute) + float(LISTEN_TIME)
		run.patience = int(run.patience) + LISTEN_PATIENCE
		run.seen = int(run.seen) + LISTEN_SEEN
		run.listen_count = int(run.listen_count) + 1
	elif verb == VERB_SPEAK:
		run.minute = float(run.minute) + float(SPEAK_TIME)
		run.patience = int(run.patience) + SPEAK_PATIENCE
		run.seen = int(run.seen) + SPEAK_SEEN
		run.speak_count = int(run.speak_count) + 1
	elif verb == VERB_GRAB or verb == VERB_STRIKE:
		pass

	_clamp_meters(run)
	run.last_verb = verb

	var ending := resolve_ending(run, verb)
	if ending != "":
		run.ended = true
		run.ending = ending

	var line := _line_for(run, verb, ending, before)
	return {
		"ok": true,
		"line": line,
		"mechanic": _mechanic_line(before, run, verb, ending),
		"ending": ending,
	}


static func tick_clock(run: Dictionary, delta_sec: float) -> Dictionary:
	if bool(run.get("ended", false)):
		return {"ok": false, "line": "", "mechanic": "", "ending": ""}
	if delta_sec <= 0.0:
		return {"ok": false, "line": "", "mechanic": "", "ending": ""}
	var before_minute := float(run.minute)
	run.minute = float(run.minute) + delta_sec * (float(DAWN_MINUTE) / REAL_SECONDS_PER_NIGHT)
	_clamp_meters(run)
	var ending := resolve_ending(run, VERB_TICK)
	if ending == "":
		return {"ok": true, "line": "", "mechanic": "", "ending": ""}
	run.ended = true
	run.ending = ending
	run.last_verb = VERB_TICK
	return {
		"ok": true,
		"line": LINE_DAWN,
		"mechanic": "时刻 %s→%s · 黎明" % [clock_text(before_minute), clock_text(run.minute)],
		"ending": ending,
	}


static func _line_for(run: Dictionary, verb: String, ending: String, before: Dictionary) -> String:
	if ending == ENDING_GRAB:
		return LINE_GRAB
	if ending == ENDING_STRIKE:
		return LINE_STRIKE
	if ending == ENDING_HELD:
		return LINE_DAWN
	if verb == VERB_REPAIR:
		if int(before.wall) >= WALL_CAP or int(run.wall) >= WALL_CAP:
			return _pick(LINES_REPAIR_CAPPED, int(run.repair_count))
		return _pick(LINES_REPAIR, int(run.repair_count) - 1)
	if verb == VERB_LISTEN:
		return _pick(LINES_LISTEN, int(run.listen_count) - 1)
	if verb == VERB_SPEAK:
		return _pick(LINES_SPEAK, int(run.speak_count) - 1)
	return ""


static func _mechanic_line(before: Dictionary, run: Dictionary, verb: String, ending: String) -> String:
	var bits: Array[String] = []
	if verb == VERB_REPAIR or verb == VERB_LISTEN or verb == VERB_SPEAK:
		bits.append("时刻 %s→%s" % [clock_text(before.minute), clock_text(run.minute)])
		bits.append("耐性 %s→%s" % [str(before.patience), str(run.patience)])
		bits.append("被看见 %s→%s" % [str(before.seen), str(run.seen)])
		if verb == VERB_REPAIR:
			var wall_after := wall_text(int(run.wall))
			bits.append("墙 %s→%s" % [str(before.wall), wall_after])
	if ending != "":
		bits.append("结局 %s" % ending_title(ending))
	if bits.is_empty():
		return "数字只来自表，不来自句子。LLM 关闭。"
	return " · ".join(bits)
