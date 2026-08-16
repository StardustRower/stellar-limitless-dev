extends Control
## 夜班房间壳：一面墙，三个动词，一块 HUD。
## 数字和结局只来自 wall_table.gd。这里只负责画、点、重开。
##
## 修 / 听 / 说 是场景里的固定按钮，不在 pressed 回调里拆掉。
## 抢装备 / 登记罢工 会重建：先 remove_child，再 queue_free，禁止 free()。

const Table = preload("res://wall_table.gd")
const Llm = preload("res://llm_adapter.gd")

@onready var time_label: Label = %TimeLabel
@onready var patience_label: Label = %PatienceLabel
@onready var seen_label: Label = %SeenLabel
@onready var wall_label: Label = %WallLabel
@onready var patience_bar: ProgressBar = %PatienceBar
@onready var seen_bar: ProgressBar = %SeenBar
@onready var wall_bar: ProgressBar = %WallBar
@onready var talk_line: Label = %TalkLine
@onready var mechanic_label: Label = %MechanicLabel
@onready var extra_box: VBoxContainer = %ExtraOptions
@onready var verb_row: HBoxContainer = %VerbRow
@onready var repair_button: Button = %RepairButton
@onready var listen_button: Button = %ListenButton
@onready var speak_button: Button = %SpeakButton
@onready var ending_panel: ColorRect = %EndingPanel
@onready var ending_title: Label = %EndingTitle
@onready var ending_body: Label = %EndingBody
@onready var wall_fill: ColorRect = %WallFill
@onready var wall_face: ColorRect = %WallFace
@onready var crack_a: Polygon2D = %CrackA
@onready var crack_b: Polygon2D = %CrackB
@onready var crack_c: Polygon2D = %CrackC
@onready var cabinet: ColorRect = %Cabinet
@onready var room_back: ColorRect = %RoomBack
@onready var lamp: ColorRect = %Lamp
@onready var stage_caption: Label = %StageCaption

var run: Dictionary = {}


func _ready() -> void:
	_install_cjk_font()
	_style_bars()
	start_shift()


func _process(delta: float) -> void:
	if run.is_empty() or bool(run.get("ended", false)):
		return
	var outcome: Dictionary = Table.tick_clock(run, delta)
	if str(outcome.get("ending", "")) != "":
		_apply_outcome(outcome)
		return
	_sync_hud()


func start_shift() -> void:
	run = Table.make_run()
	talk_line.text = "零点。墙在。工具柜锁是坏的。广播还没开口。你只有三个动词。"
	mechanic_label.text = "数字只来自表，不来自句子。LLM 关闭。"
	ending_panel.visible = false
	verb_row.visible = true
	room_back.color = Color("1a1814")
	cabinet.visible = true
	cabinet.rotation = 0.0
	wall_face.rotation = 0.0
	_sync_hud()
	_render_extras()


func _on_repair_pressed() -> void:
	_do_verb(Table.VERB_REPAIR)


func _on_listen_pressed() -> void:
	_do_verb(Table.VERB_LISTEN)


func _on_speak_pressed() -> void:
	_do_verb(Table.VERB_SPEAK)


func _on_restart_pressed() -> void:
	start_shift()


func _do_verb(verb: String) -> void:
	if run.is_empty() or bool(run.get("ended", false)):
		return
	var outcome: Dictionary = Table.apply(run, verb)
	_apply_outcome(outcome)


func _apply_outcome(outcome: Dictionary) -> void:
	if not bool(outcome.get("ok", false)) and str(outcome.get("line", "")) == "":
		return
	if str(outcome.get("line", "")) != "":
		talk_line.text = str(outcome.line)
	if str(outcome.get("mechanic", "")) != "":
		mechanic_label.text = str(outcome.mechanic)
	# 适配器默认关闭，返回空串。即使以后打开，也只准附在句子后面，不准进表。
	var flavor := Llm.flavor({
		"verb": str(run.get("last_verb", "")),
		"ending": str(run.get("ending", "")),
	})
	if flavor != "":
		talk_line.text = str(talk_line.text) + "\n" + flavor
	_sync_hud()
	_render_extras()
	if bool(run.get("ended", false)):
		_show_ending()


func _show_ending() -> void:
	var ending_id := str(run.get("ending", ""))
	ending_title.text = Table.ending_title(ending_id)
	ending_body.text = Table.ending_body(ending_id)
	ending_panel.visible = true
	verb_row.visible = false
	if ending_id == Table.ENDING_GRAB:
		room_back.color = Color("2a1210")
		cabinet.visible = false
		wall_face.rotation = 0.08
	elif ending_id == Table.ENDING_STRIKE:
		room_back.color = Color("14161a")
	else:
		room_back.color = Color("1c1a16")
		lamp.color = Color("d8c48a")


func _render_extras() -> void:
	# 抢装备 / 登记罢工接在 Button.pressed 上。这里若 free()，
	# 等于在回调还没返回时拆掉正在发射的按钮（Attempted to free a locked object）。
	# queue_free 等到这一帧空闲再删。修 / 听 / 说 是场景节点，不拆。
	while extra_box.get_child_count() > 0:
		var child := extra_box.get_child(0)
		extra_box.remove_child(child)
		child.queue_free()
	if bool(run.get("ended", false)):
		return
	for row in Table.visible_extras(run):
		var btn := _make_option_button(str(row.get("label", "")), true)
		var captured := str(row.get("id", ""))
		btn.pressed.connect(_do_verb.bind(captured))
		extra_box.add_child(btn)


func _sync_hud() -> void:
	time_label.text = "时刻 %s" % Table.clock_text(float(run.minute))
	patience_label.text = "耐性 %s" % str(run.patience)
	seen_label.text = "被看见 %s" % str(run.seen)
	wall_label.text = "墙进度 %s" % Table.wall_text(int(run.wall))
	patience_bar.max_value = float(Table.PATIENCE_MAX)
	patience_bar.value = float(run.patience)
	seen_bar.max_value = float(Table.SEEN_MAX)
	seen_bar.value = float(run.seen)
	wall_bar.max_value = 100.0
	wall_bar.value = float(run.wall)
	_style_fill(patience_bar, Color("8a3b32") if int(run.patience) <= Table.GRAB_PATIENCE else Color("c9a45c"))
	_style_fill(seen_bar, Color("a85a32") if int(run.seen) >= Table.GRAB_SEEN else Color("7ec8c4"))
	_style_fill(wall_bar, Color("6a5c4c") if int(run.wall) >= Table.WALL_CAP else Color("9a8b74"))
	var ratio := Table.wall_ratio(int(run.wall))
	var face_h := wall_face.size.y
	if face_h <= 1.0:
		face_h = 420.0
	wall_fill.offset_top = face_h * (1.0 - ratio)
	crack_a.modulate.a = 0.25 + 0.75 * ratio
	crack_b.modulate.a = 0.15 + 0.7 * ratio
	crack_c.modulate.a = 0.1 + 0.65 * ratio
	stage_caption.text = "夜班 · 一面墙 · 进度到不了 100"
	repair_button.disabled = bool(run.get("ended", false))
	listen_button.disabled = bool(run.get("ended", false))
	speak_button.disabled = bool(run.get("ended", false))


func _install_cjk_font() -> void:
	# Godot 自带字体几乎不含汉字。仓库里不塞几兆的字体文件：
	# 用 SystemFont 去找这台电脑已经有的中文字体。
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


func _style_bars() -> void:
	_style_track(patience_bar)
	_style_track(seen_bar)
	_style_track(wall_bar)
	_style_fill(patience_bar, Color("c9a45c"))
	_style_fill(seen_bar, Color("7ec8c4"))
	_style_fill(wall_bar, Color("9a8b74"))


func _style_track(bar: ProgressBar) -> void:
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color("2a2118")
	bar.add_theme_stylebox_override("background", bg)


func _style_fill(bar: ProgressBar, color: Color) -> void:
	var fill := StyleBoxFlat.new()
	fill.bg_color = color
	bar.add_theme_stylebox_override("fill", fill)


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
