# NPC Table Template v0.1 (Godot 4.7.1)

A small, fully offline Godot project showing a **table-driven NPC**: Huiyan, a former
surveyor. Every state, option, jump and number the NPC can use is written in one
table (`npc_table.gd`). The scene script only reads that table — no HTTP, no server,
no LLM. Flags (met / traded / warned / last state) live in memory and reset when you
restart the scene.

## Run it

1. Install Godot **4.7.1** (standard build, not .NET).
2. Project Manager → **Import** → pick this folder's `project.godot` → Import & Edit.
3. Press **F5**.

What you should see: HP starts at **7/10**. Choose the trade option (survey-line scrap
for lamp oil) and HP becomes **10/10**. Click "放下残页" (drop page) before trading and
the trade button turns grey (disabled): the table refuses without the scrap.

## Where to edit

- `npc_table.gd`
  - `START_HP`, `MAX_HP`, `TRADE_HEAL` — the numbers.
  - `TABLE` — states (`idle`, `greet`, `ask`, `trade`, `warn`, `farewell`, `done`),
    each with `options`; each option has an `id`, labels, and `next` (the state it
    jumps to). `needSurvey: true` means the option needs the scrap. `effect` on a state
    applies world changes (trade heals, warn sets a flag).
  - `LINES` — dialogue lines per state and option id (zh / en).
- `npc_room.gd` — UI only (buttons, HUD, silhouette). Usually no need to touch.
- `main.tscn` — the main scene.

If Chinese text shows as boxes, the machine has no CJK system font; add a CJK font
(e.g. Noto Sans SC) under Project Settings → GUI → Theme → Custom Font.

License: MIT (see `LICENSE`).
