# 18 · Where this branch differs from upstream (v0.1.1) on purpose

Written 2026-10-04 while rebuilding the integration branch on top of upstream **`v0.1.1`** (`8cd6491e`,
released 2026-10-03 21:22 +08). The branch `fix/all-v011` **is** upstream v0.1.1 plus:

- the **自由位置 / 自选干员** feature (its spec is **DESIGN §23**; the roster is `data/freePicks.json`), and
- the pieces only we have: the stale-page build guard, the loadout export/import, the TOKEN_ABNORMAL
  research, the generic-talent translator, the IL2CPP tooling and the debug room.

Everything else is upstream's. Where our old `fix/all` (archived as `archive/fix-all-v010`) and upstream
implemented the same rule differently, **upstream's implementation was kept and ours was dropped**. This
file records those decisions so nobody re-applies the old code by accident.

## 1. Deliberately different behaviour (the user chose upstream's)

These four are **player-visible** and were confirmed by the user on 2026-10-03 — do **not** "fix" them back
to our old branch's behaviour.

| # | Rule | **This branch (upstream v0.1.1) — chosen** | Our old `fix/all` — rejected |
|---|---|---|---|
| 1 | 战术点: a tactician re-orients **in place** and a range-bound 援军 (狼群 / 流形) falls outside the new range | the 援军 **goes back to the 整备区** (stack, else a free hand / temp slot; with nowhere to put it, it leaves the board and its stack comes back at the next round start). `_reorient` refuses with **`HAND_FULL`** when one of them would have nowhere to go | the 援军 **stayed on the board** (we deliberately kept the range check out of `_legal`) |
| 2 | 突变细胞 (昆图斯) after a battle | the carrier is destroyed and **the cell returns to the 整备区 immediately, together with the carrier's other equipment, as the same item** (`PlayerState.transformChess`); the new operator is gained like any gain, the carrier's tile is freed | the cell was destroyed and re-granted **into the item list at the next round start** as a new instance (`effect:builtin_return_item_next_round`) |
| 3 | `BOARD_AND_DECK` bonds (远见 / 奇迹 / 投资人) | count **board ∪ hand** — the **临时整备区 does not count** | we counted board ∪ hand ∪ **temp** |
| 4 | 深池逐火's 余烬 隐匿 | the stealth is closed **only while it is blocked** (rule-based: it re-hides when unblocked) | our husk **permanently** removed its stealth bit the first time it was blocked |

Sources: `server/match/PlayerState.js` (`_legal` / `summonRange` / `_liftOutOfRange` /
`_roomForOutOfRange` / `_reorient` / `transformChess`), `server/match/bondsMeta.js` (`BOARD_AND_DECK`),
`server/sim/content/enemies.js` (`husk`). DESIGN: §21.3 (战术点), §21.1 (突变细胞), §6.3 (盟约口径),
§21.8 (余烬).

## 2. Other things we did **not** port (upstream's version wins)

Not behavioural choices — upstream simply implemented the same fixes its own way, and re-applying ours would
duplicate or contradict them. Kept on `archive/fix-all-v010` only.

| Our old commit / file | What upstream has instead |
|---|---|
| `60db22e` `kits/tier1.js` 深巡 / 雷蛇 S2 trigger | the same commit is **in** v0.1.1, and upstream adds four more skills (号角 S2/S3, 灰毫 S1/S2) through `tools/build-data.mjs TRIGGER_DEVIATIONS` |
| `6f4b433` `PlayerState._placeable` / `_tokenOnTacticalPoint`, `bot.js`, `ui/gameLogic.js` (issue #9) | `tokens.json ownerRange` + `PlayerState._legal` / `summonRange` (loadout-resolved range) + `_liftOutOfRange` |
| `3e23a36` / `34be8f5` 突变细胞 (`items/meta.js`, `builtinMeta.js`, `PlayerState.transformChess`) | `transformChess` returns the whole equipment set to the 整备区 (rule 2 above) |
| `5d672e1` 深池余烬 husk (`enemies.js`) | upstream's `husk()`: a 1 s 重生 window, `rebirthCleanse`, and the blocked-only 隐匿 (rule 4) |
| `f9640da` 变形同构体 / 调和 **client** derivation (`ui/gameLogic.js effectiveBonds`, `ui/detailPanel.js`, `ui/bondStrip.js`, `css/screens/game-panels.css`) | upstream sends `harmony: 1` in the bond payload and marks the 同构 chips server-side |
| `d097d8f` crossOrigin images (`public/js/assets.js`, `ui/guide.js`) | upstream merged the same change (`15cceeb6`); our files are upstream's |
| `e6abbf7` 替身 (dollkeeper) max HP (`kits/tier5.js`, `sim/professions.js`) | upstream's own handling of the substitute's HP |
| `41b1eb8` 阿戈尔 devour chain (`sim/content/bonds/core.js`) | upstream's own chain / revive handling |
| `e0c0ef7`, `2754a4f` 望 S1/S2/S3, 火陈 剑气长龙 **sim** fixes | kept **inside our own** `sim/content/kits/freePicks.js` (upstream has no record or kit for these operators at all — they are not in `data/chess.json`), so there is nothing to supersede |

`goldenIdOf`'s free-pick self-merge behaviour is upstream's code untouched: a 自选候选 has no `_b` sibling,
`goldenIdOf` falls back to the record's own id, and three copies "merge into themselves" — that is correct
and intended (DESIGN §23.2).

## 3. Documentation numbering

Upstream owns **DESIGN §21** ("Player feedback after 0.1.0", v0.1.1, its 29 subsections) and **DESIGN §22**
("GitHub issues after 0.1.1", v0.1.2, its 16 subsections). Our 自由位置 / 自选干员 spec therefore lives at
**DESIGN §23** (`§23.1`–`§23.11`), and every reference in our code and tests points at §23. A reference to
`§21.<n>` or `§22.<n>` anywhere in this tree means **upstream's** section (the first port put ours at §22;
the v0.1.2 port moved it to §23 when upstream took that number).

## 4. Files that are ours alone (upstream has no counterpart, so no divergence)

`data/freePicks.json` · `docs/research/12-free-pick-factions.json` ·
`server/sim/content/kits/freePicks.js` · `server/sim/content/genericTalents.js` + `docs/research/15` ·
`docs/research/13-token-abnormal.json` · `docs/research/14-il2cpp-metadata.md` + `tools/il2cpp-*.mjs` ·
`public/js/ui/buildGuard.js` · `public/js/ui/clipboard.js` · `server/debugRoom.js` ·
`tools/talent-plan.mjs`. Upstream's release does not contain any of them.
