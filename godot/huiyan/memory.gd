extends Node
## 测绘员的跨层记忆：四个旗标。从 js/memory.js 搬进 Godot。
##
## 这一课只问本地账本（server/ledger.py）要 met / traded / warned / last_state。
## 请求体里没有台词、没有手记、没有聊天记录。失败就当失忆，房间继续可玩。

const DEFAULT_URL := "http://127.0.0.1:8765"
const TIMEOUT_SEC := 0.8

signal status_changed(status: String)

var status: String = "unknown"
var last_flags: Dictionary = {}

@onready var _http: HTTPRequest = $HTTPRequest

var _gate: bool = false


func _ready() -> void:
	_http.timeout = TIMEOUT_SEC
	_http.use_threads = true
	last_flags = blank()


static func blank() -> Dictionary:
	return {
		"met": false,
		"traded": false,
		"warned": false,
		"last_state": "idle",
	}


## 同一条测线：种子后面叠多少个 "-down" 都不换人。
## 「换一颗种子」才会换一条测线。空键回退 stardust，和 js/memory.js 一致。
static func line_key(seed: String) -> String:
	var s := seed.strip_edges()
	while s.length() >= 5 and s.ends_with("-down"):
		s = s.substr(0, s.length() - 5)
	return s if s != "" else "stardust"


static func snapshot(npc: Dictionary) -> Dictionary:
	var flags := blank()
	if npc.is_empty():
		return flags
	var state := str(npc.get("state", ""))
	flags.met = bool(npc.get("met", false) or (state != "" and state != "idle"))
	flags.traded = bool(npc.get("traded", false))
	flags.warned = bool(npc.get("warned", false))
	if state != "":
		flags.last_state = state
	else:
		flags.last_state = str(npc.get("last_state", "idle"))
	return flags


## 旗标只增不减：这一局已经换过油，不能被一张空账本擦掉。
static func apply(npc: Dictionary, flags: Dictionary) -> void:
	if npc.is_empty() or flags.is_empty():
		return
	npc.met = bool(npc.get("met", false) or flags.get("met", false))
	npc.traded = bool(npc.get("traded", false) or flags.get("traded", false))
	npc.warned = bool(npc.get("warned", false) or flags.get("warned", false))
	var last := str(npc.get("last_state", "idle"))
	if last == "" or last == "idle":
		npc.last_state = str(flags.get("last_state", "idle"))


func reset_status() -> void:
	status = "unknown"
	last_flags = blank()
	status_changed.emit(status)


func load_flags(seed: String) -> Dictionary:
	var key := line_key(seed)
	var path := "/memory?line=%s" % key.uri_encode()
	var data := await _exchange(HTTPClient.METHOD_GET, path, null)
	if data.is_empty():
		last_flags = blank()
		_set_status("amnesia")
		return last_flags
	var flags = data.get("flags", {})
	if typeof(flags) != TYPE_DICTIONARY:
		flags = {}
	last_flags = {
		"met": bool(flags.get("met", false)),
		"traded": bool(flags.get("traded", false)),
		"warned": bool(flags.get("warned", false)),
		"last_state": str(flags.get("last_state", "idle")),
	}
	_set_status("online")
	return last_flags


func save_flags(seed: String, npc: Dictionary) -> Dictionary:
	var flags := snapshot(npc)
	# 字段名必须和 server/ledger.py 的 FlagBody 对得上。不要加 transcript。
	var body := {
		"line": line_key(seed),
		"met": bool(flags.met),
		"traded": bool(flags.traded),
		"warned": bool(flags.warned),
		"last_state": str(flags.last_state),
	}
	var data := await _exchange(HTTPClient.METHOD_POST, "/memory", body)
	if data.is_empty():
		_set_status("amnesia")
		return {}
	var stored = data.get("flags", {})
	if typeof(stored) != TYPE_DICTIONARY:
		stored = flags
	last_flags = {
		"met": bool(stored.get("met", flags.met)),
		"traded": bool(stored.get("traded", flags.traded)),
		"warned": bool(stored.get("warned", flags.warned)),
		"last_state": str(stored.get("last_state", flags.last_state)),
	}
	_set_status("online")
	return last_flags


func hydrate(npc: Dictionary, seed: String) -> Dictionary:
	var flags := await load_flags(seed)
	if status == "amnesia":
		# 账本没开：不要用空白表覆盖这一局已经发生的交易/警告。
		return snapshot(npc)
	apply(npc, flags)
	return flags


## 开口 / 交易 / 警告 / 告别：先 GET 再 POST。和 HTML 同一本保险。
func sync_flags(npc: Dictionary, seed: String) -> Dictionary:
	await hydrate(npc, seed)
	return await save_flags(seed, npc)


func _set_status(next: String) -> void:
	status = next
	status_changed.emit(status)


func _exchange(method: int, path: String, body) -> Dictionary:
	while _gate:
		await get_tree().process_frame
	_gate = true
	if _http.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED:
		_http.cancel_request()
	var headers := PackedStringArray()
	var payload := ""
	if body != null:
		headers.append("Content-Type: application/json")
		payload = JSON.stringify(body)
	var err := _http.request(DEFAULT_URL + path, headers, method, payload)
	if err != OK:
		_gate = false
		return {}
	var packed: Array = await _http.request_completed
	_gate = false
	if packed.size() < 4:
		return {}
	var result: int = int(packed[0])
	var code: int = int(packed[1])
	var raw: PackedByteArray = packed[3]
	if result != HTTPRequest.RESULT_SUCCESS or code < 200 or code >= 300:
		return {}
	var parsed = JSON.parse_string(raw.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	return parsed
