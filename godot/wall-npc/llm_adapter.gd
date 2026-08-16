class_name WallLlmAdapter
extends RefCounted
## 台词适配器的空插座。默认关闭。
##
## 这一课的数字（耐性 / 被看见 / 墙进度 / 时刻 / 结局）只准来自 wall_table.gd。
## 本文件就算以后打开，也只准交回一句口气，不准改表、不准写结局。

const ENABLED := false


static func flavor(_ctx: Dictionary) -> String:
	# 关闭时交空串。房间脚本不得把返回值写进任何计量。
	if not ENABLED:
		return ""
	return ""
