extends Control
## 视觉小说壳：同一张 HuiyanTable，没有走路，没有地牢格子。
## 左侧剪影、右侧选项。能发生的事仍只来自表。
##
## 下一课可以让按钮去问同一本 FastAPI 旗标账本（见仓库 server/ledger.py）。
## 不是这一课：这一课只证明表能站进 Godot 的节点树，不接 HTTP、不接 LLM。

const Table = preload("res://npc_table.gd")

@onready var seed_edit: LineEdit = %SeedEdit
@onready var who_label: Label = %WhoLabel
@onready var state_label: Label = %StateLabel
@onready var hp_label: Label = %HpLabel
@onready var hp_bar: ProgressBar = %HpBar
@onready var bag_label: Label = %BagLabel
@onready var flags_label: Label = %FlagsLabel
@onready var talk_line: Label = %TalkLine
@onready var mechanic_label: Label = %MechanicLabel
@onready var options_box: VBoxContainer = %Options
@onready var drop_page_button: Button = %DropPageButton
@onready var figure_host: Control = %FigureHost
@onready var silhouette: Node2D = %Silhouette
@onready var head: Polygon2D = %Head
@onready var hammer_haft: Polygon2D = %HammerHaft
@onready var hammer_head: Polygon2D = %HammerHead
@onready var oil_flask: Polygon2D = %OilFlask
@onready var omen_mark: Polygon2D = %OmenMark
@onready var omen_caption: Label = %OmenCaption

var npc: Dictionary = {}
var world: Dictionary = {}
var seed_text: String = "stardust-7"
var last_outcome: String = ""
var _busy: bool = false


func _ready() -> void:
	_install_cjk_font()
	_style_hp_bar()
	figure_host.resized.connect(_place_figure)
	start_scene(seed_edit.text)


func _process(_delta: float) -> void:
	if omen_mark.visible:
		omen_mark.modulate.a = 0.55 + 0.25 * sin(Time.get_ticks_msec() / 260.0)


func start_scene(seed_value: String) -> void:
	seed_text = seed_value.strip_edges()
	if seed_text == "":
		seed_text = "stardust-7"
	seed_edit.text = seed_text
	world = {
		"hp": Table.START_HP,
		"maxHp": Table.MAX_HP,
		"inventory": [Table.SURVEY_ITEM],
		"warned": false,
	}
	npc = Table.make_npc()
	last_outcome = ""
	_enter_state("greet", Table.find_option("idle", "open"))


func _enter_state(next_id: String, via_option) -> void:
	var next = Table.state_by_id(next_id)
	if next == null:
		talk_line.text = "未知状态"
		return
	var prev: String = str(npc.get("state", "idle"))
	npc.state = next_id
	var outcome = Table.apply_world_effect(npc, next, world)
	if outcome != null and outcome.get("error", ""):
		npc.state = prev
		last_outcome = str(outcome.error)
		talk_line.text = last_outcome
		_sync_hud()
		_render_options()
		return
	if outcome != null:
		last_outcome = Table.mechanic_line(outcome)
	else:
		last_outcome = ""
	var option_id := "open"
	if via_option != null:
		option_id = str(via_option.get("id", "open"))
	# 台词按跳进来之前的旗标取句；见面旗标要在开口之后才立，否则初见会走成「你下来了」。
	talk_line.text = Table.local_line({
		"lang": "zh",
		"seed": seed_text,
		"npcState": npc.state,
		"npcOption": option_id,
		"npcMet": npc.get("met", false),
		"npcTraded": npc.get("traded", false),
		"npcWarned": npc.get("warned", false),
	})
	if npc.state != "idle":
		npc.met = true
	npc.last_state = npc.state
	_sync_hud()
	_render_options()


func _pick(option_id: String) -> void:
	if _busy:
		return
	var opt = Table.find_option(str(npc.get("state", "")), option_id)
	if opt == null:
		talk_line.text = "这一跳不在表里。他不接。"
		return
	if not Table.can_use_option(opt, npc, world.inventory):
		talk_line.text = "没有测线残页，交易这一栏是空的。表拒绝了，不是他在即兴。" if opt.get("needSurvey", false) else "这一跳此刻不准。"
		_render_options()
		return
	_busy = true
	_enter_state(str(opt.get("next", "")), opt)
	_busy = false


func _render_options() -> void:
	while options_box.get_child_count() > 0:
		var child := options_box.get_child(0)
		options_box.remove_child(child)
		child.free()
	if str(npc.get("state", "")) == "done":
		var again := _make_option_button("重开这一幕", true)
		again.pressed.connect(_on_replay_pressed)
		options_box.add_child(again)
		return
	for row in Table.visible_options(npc, world.inventory):
		var label := str(row.get("labelZh", row.get("id", "")))
		var btn := _make_option_button(label, bool(row.get("enabled", true)))
		if not bool(row.get("enabled", true)):
			btn.tooltip_text = "需要测线残页。点「放下残页」可看见表如何拒绝交易。"
		var captured := str(row.get("id", ""))
		btn.pressed.connect(_pick.bind(captured))
		options_box.add_child(btn)


func _sync_hud() -> void:
	who_label.text = "%s · %s" % [str(npc.get("nameZh", "灰岩")), str(npc.get("titleZh", ""))]
	var st = Table.state_by_id(str(npc.get("state", "")))
	state_label.text = str(st.get("nameZh", npc.state)) if st != null else str(npc.state)
	hp_label.text = "HP %s/%s" % [str(world.hp), str(world.maxHp)]
	hp_bar.max_value = float(world.maxHp)
	hp_bar.value = float(world.hp)
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color("8a3b32") if int(world.hp) <= 3 else Color("c9a45c")
	hp_bar.add_theme_stylebox_override("fill", fill)
	if world.inventory.is_empty():
		bag_label.text = "背包 空"
	else:
		bag_label.text = "背包 " + " · ".join(world.inventory)
	var bits: Array[String] = []
	bits.append("见过面" if npc.get("met", false) else "初见")
	bits.append("换过油" if npc.get("traded", false) else "未交易")
	bits.append("听过警告" if npc.get("warned", false) else "未警告")
	bits.append("上次 %s" % str(npc.get("last_state", "idle")))
	flags_label.text = "旗标 " + " · ".join(bits)
	if last_outcome == "":
		mechanic_label.text = "数字只来自表，不来自句子。引擎：本地台词（这一课不接 LLM）。"
	else:
		mechanic_label.text = last_outcome
	var has_page := Table.has_survey(world.inventory)
	drop_page_button.text = "放下残页" if has_page else "捡起残页"
	drop_page_button.disabled = bool(npc.get("traded", false))
	oil_flask.visible = bool(npc.get("traded", false))
	omen_mark.visible = bool(npc.get("warned", false))
	omen_caption.visible = bool(npc.get("warned", false))
	var warn_pose: bool = str(npc.get("state", "")) == "warn"
	hammer_haft.rotation = -0.45 if warn_pose else 0.12
	hammer_head.rotation = -0.45 if warn_pose else 0.12
	var pose := str(npc.get("state", ""))
	head.position.y = 6.0 if pose == "farewell" or pose == "done" else 0.0
	_place_figure()


func _on_drop_page_pressed() -> void:
	if npc.is_empty() or npc.get("traded", false):
		return
	if Table.has_survey(world.inventory):
		Table.take_survey(world.inventory)
	else:
		world.inventory.append(Table.SURVEY_ITEM)
	_sync_hud()
	_render_options()


func _on_replay_pressed() -> void:
	start_scene(seed_edit.text)


func _on_seed_submitted(new_text: String) -> void:
	start_scene(new_text)


func _place_figure() -> void:
	if figure_host.size.x <= 1.0:
		return
	silhouette.position = Vector2(figure_host.size.x * 0.42, 24.0)
	omen_mark.position = Vector2(figure_host.size.x * 0.82, figure_host.size.y * 0.28)


func _install_cjk_font() -> void:
	# Godot 自带字体几乎不含汉字。仓库里不塞几兆的字体文件：
	# 用 SystemFont 去找这台电脑已经有的中文字体（Windows 的微软雅黑、macOS 的苹方等）。
	var font := SystemFont.new()
	font.font_names = PackedStringArray([
		"Microsoft YaHei",
		"微软雅黑",
		"PingFang SC",
		"Noto Sans CJK SC",
		"Noto Sans SC",
		"Source Han Sans SC",
		"WenQuanYi Micro Hei",
		"Noto Sans CJK JP",
		"sans-serif",
	])
	var ui_theme := Theme.new()
	ui_theme.default_font = font
	ui_theme.default_font_size = 16
	theme = ui_theme


func _style_hp_bar() -> void:
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color("2a2118")
	hp_bar.add_theme_stylebox_override("background", bg)
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color("c9a45c")
	hp_bar.add_theme_stylebox_override("fill", fill)


func _make_option_button(label: String, enabled: bool) -> Button:
	var btn := Button.new()
	btn.text = label
	btn.disabled = not enabled
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	var normal := StyleBoxFlat.new()
	normal.bg_color = Color("2a2118")
	normal.set_content_margin_all(10)
	var hover := StyleBoxFlat.new()
	hover.bg_color = Color("3a3124")
	hover.set_content_margin_all(10)
	var disabled := StyleBoxFlat.new()
	disabled.bg_color = Color("1a1612")
	disabled.set_content_margin_all(10)
	btn.add_theme_stylebox_override("normal", normal)
	btn.add_theme_stylebox_override("hover", hover)
	btn.add_theme_stylebox_override("pressed", hover)
	btn.add_theme_stylebox_override("disabled", disabled)
	btn.add_theme_color_override("font_color", Color("eadcc6"))
	btn.add_theme_color_override("font_hover_color", Color("c9a45c"))
	btn.add_theme_color_override("font_disabled_color", Color("6a5c4c"))
	return btn
