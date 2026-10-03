# 17 — 特性（trait）审计 · 机制缺口来源裁决 · 诚实天花板

**结论先行（三句话）**

1. **特性本身没有"大面积缺失"**：359 个可上场记录里 **351 个**在一场真实战斗里都带着自己的 `trait`（`def.traitBb` → `profile.tb`）打起来了，**64 个 subprofession 里只有 7 组没有实现**（5 组根本没有 profile + `counsellor` + `duelist`），玩家可见的也就 7 条免费自选 + 凛御银灰。**"traper 的特性丢了"在本树里复现不出来**（3 条 traper 记录全部带完整 `desc`/`bb`）。
2. **真正缺的是两类东西**：(a) **自由位置（自选干员）的 82 条记录跑通用 kit** —— 它们的特性黑板书**只**能被 `professions.js` 的 `TUNE[subProfession]` 读，凡是"只有手写 kit 才会读"的特性/模组词条在这些记录上**全部空转**；(b) **引擎词汇**（无敌/阻回/不可阻挡/静默/强制缴械/起飞/弱点伤害/阈值叠层/"技能期间"）—— 一半是引擎已有 flag 但数据通道没接（实现缺口），一半是**真的没有数据能表达**。
3. **两张此前没被管线加载的表，能关掉两大块**：
   - **`excel/gamedata_const.json`**（两个镜像都 206 可取；本机 `D:\projects\_scratch\fever\gamedata_const.json` 已有副本）→ `subProfessionDamageTypePairs`（**5 个缺 profile 的 subprofession 的伤害类型**）、`termDescriptionDict.cc.g.*` / `ba.laiosteam` / `ba.sees`（**阵营光环的权威名册**，含"乌萨斯学生自治团/岁/莱欧斯小队/深海猎人/莱茵生命…"）、`ba.weaknessatk`（**弱点伤害定义**）、`ba.liftoff`（**起飞定义**）、`feverGameData`（450/20）、`pushForces`/`pullForces`（**推拉力表**）。
   - **`config/buff_template_holder.ab`（客户端 AB，本机就有；已解成 `_scratch/probe/buff_template_data.json`，37 MB）** → buff 模板的 ActionNode 图，是"效果住在 buff 模板里而不是黑板里"那一类（阈值叠层、技能期间效果、状态挂载）的唯一权威源。

Tag 约定沿用 `00-INDEX.md`；本文件新增 **[MEASURED]** = 本次跑真实战斗/真实模块量出来的。

---

## 0. 方法与快照

| 项 | 值 |
|---|---|
| 记录源 | `data/chess.json` 266（可见普通 112 / 可见精锐 112 / 隐藏普通 17 / 隐藏精锐 17 / DIY 8）+ `data/freePicks.json` 93 = **359** |
| 每记录实测 | `test/helpers/battleHarness.js makeBattle`（`content: 'full'`）逐条开一场真实战斗，读 `unit.profile` / `unit.kit` [MEASURED] |
| 关键模块 | `server/sim/professions.js`（`SUB` / `TUNE` / `resolveProfile`）、`server/sim/content/index.js`（`KITS` / `setupUnitKit`）、`server/sim/simdata.js`（`DataSource`）、`server/sim/content/genericTalents.js` |
| 草稿 | `D:\projects\_scratch\trait-audit\`（`enumerate.mjs` / `measure.mjs` / `keys.mjs` / `genericTraits.mjs` / `tokkaudit.mjs` / `factions2.mjs` / `g15.mjs` / `probes.mjs`；输出 `enum.txt`、`measure.txt`、`measure.json`、`rows.json`、`keys.txt`、`tokens.json`、`faction-auras.json`） |
| 只读声明 | 未改动任何既有仓库文件；未跑 `build-data` / `fetch-assets` / `extract.py`；本文是本轮**唯一**新增文件 |
| 快照 | 测量时刻（2026-10-03 21:1x +08）的输入 md5：`data/chess.json` `e173d370…`、`data/freePicks.json` `84119cf3…`、`data/tokens.json` `9dafd3e6…`、`server/sim/professions.js` `ee375b3c…`、`generic.js` `0943dec3…`、`genericTalents.js` `93a73082…`、`content/index.js` `a7f4f803…`、`kits/freePicks.js` `356c3b4e…`（**该文件当时正被另一个 agent 编辑**，工作区未提交）、`content/tokens.js` `11b4b5df…` |

---

## 1. A 部分 — 特性审计

### 1.1 特性到底有没有进仿真（实测）

**结论：进得来，而且每条都能查到。** 链路是：

```
character_table.trait.candidates ──build-data.mjs:552-565 traitRecord()──▶ rec.trait{desc,descRaw,bb,bbStr,rangeGrid,moduleDesc}
        （精税的模组覆写：:532-545 applyModuleTraitParts，读 part.overrideTraitDataBundle.candidates）
rec.trait.bb ──simdata.js:188-189──▶ def.trait / def.traitBb
def.traitBb ──professions.js:448,455──▶ profile.tb（以及 TUNE 里的 tunable）
unit.kit.trait ──Battle.js:317 resolveProfile(u.def, u.kit.trait)──▶ 最终 profile
```

实测（`measure.mjs`，359 条）：

| 量 | 值 |
|---|---|
| 能在一场真实战斗里解析并带 `profile.tb` 的记录 | **351 / 359** [MEASURED] |
| 失败 | **8** —— 全是 `chess_char_{5,6}_diy{1,2}_{a,b}` 甄选干员：`stats: null`，`isDiy: true`，被 `server/match/gamedata.js:82` 的 `!c.isDiy` 从**每一个池子**里过滤掉 ⇒ **不是缺失，是未启用的占位** [MEASURED/read] |
| `trait` 为 `null` 的记录 | **只有这 8 条** [MEASURED] |
| **traper 的三条记录**（望 `chess_free_char_2027_wang`、多萝西 `…4048_doroth`、艾拉 `…4123_ela`） | **三条都带完整 `trait.desc`**（望 `bb:{}`、多萝西 `bb:{prob:0.2,atk_scale:2}`、艾拉带 `moduleDesc`）⇒ **brief 里那个"traper 特性丢了"的失败模式在本树不可复现**，与 `_scratch/sp-audit/REPORT.md` S3 一致 [MEASURED] |
| `data/chess.json` 里出现的 distinct `subProfessionId` | 69（含 DIY 的 `null`） [MEASURED] |
| `professions.js` 的 `SUB` 条目数（= `KNOWN_SUBPROFESSIONS`） | **64** [MEASURED]。注意 `test/sim/professions.test.js:34` 的注释写"73 authored SUB entries"，与实测不符（注释陈旧，不影响断言） |
| 走通用 kit（`kit.generic === true`）的记录 | **82**（全部是自选干员） [MEASURED] |

### 1.2 五组"没有 profile"的 subprofession（= 7 条自选干员）

`test/sim/professions.test.js:48` 已经把它们钉住；本次逐条实测确认：

| subProfessionId | 记录 | 官方特性原文（数据） | 现状（实测 profile） | 官方伤害类型 |
|---|---|---|---|---|
| `artsprotector` | 斩业星熊 `chess_free_char_1044_hsgma2` | 技能开启时普通攻击会造成法术伤害，且攻击和受到攻击时对目标额外造成10％攻击力的法术伤害 | `TANK` 默认 + `dmgType:'arts'`（**常态就是法术，错了**） | `PHYSICAL` |
| `blessing` | 淬羽赫默 `…1031_slent2`、遥 `…4202_haruka` | 攻击造成法术伤害，技能开启后改为治疗友方单位（100%/75% 攻击力，遥 2 目标） | `CASTER` 默认（法术攻击对，**"技能开启后改为治疗"完全没有**） | `MAGICAL` |
| `siegesniper` | 早露 `…197_poca`、提丰 `…2012_typhon` | 优先攻击重量最重的敌人（+模组：重量≥3 时攻击力提升至 115%） | `SNIPER` 默认，`profile.priority = null` | `PHYSICAL` |
| `soulcaster` | 死芒 `…450_necras` | 攻击造成法术伤害，可以通过击倒敌人生成召唤物，可攻击到自身召唤物阻挡的敌人且攻击力提升至115% | `CASTER` 默认（`atk_scale:1.15` **没人读**） | `MAGICAL` |
| `watchman` | 凯尔希·思衡托 `…1052_kalts2` | 恢复友方单位生命，并且可以起飞 | `MEDIC` 默认（治疗对，**"起飞"没有**） | `HEAL` |

> 第三列"官方伤害类型"= **`gamedata_const.json → subProfessionDamageTypePairs`**（本次实测：`artsprotector: PHYSICAL` / `blessing: MAGICAL` / `siegesniper: PHYSICAL` / `soulcaster: MAGICAL` / `watchman: HEAL`）[DATA, 本机 `_scratch/fever/gamedata_const.json`]。⇒ 这半边**不需要猜、也不需要抄 PRTS**，是**数据管线缺口**（见 §2.2）。

### 1.3 分组表（按 subProfessionId，64 组 + `(none)`）

判定口径：
- **I（已实现）**——特性的规则由 `stats`/`rangeGrid` 数据本身承载（阻挡数、部署位、攻击范围、伤害类型），**或** `SUB`/`TUNE`/手写 kit 真的读了它声明的键。
- **P（部分）**——基座实现，但列出的半边没有（几乎全部出现在"自由位置跑通用 kit"或"模组词条"上）。
- **N（未实现）**——特性规则没有任何读者。
- 每组给 `n(赛季/自选)`；`I*` 表示"赛季侧 I，自选侧见 §1.4"。

| # | subProfessionId | n(季/自) | 特性规则 | 判定 | 依据 / 缺的那一半 |
|---|---|---|---|---|---|
| 1 | `(none)` | 8/0 | — | **N/A** | DIY 占位，`stats:null` + `gamedata.js:82` 过滤 |
| 2 | agent | 2/0 | 再部署↓、可远程 | I | `respawnTime` 数据 + `SUB.agent.canHitFly` |
| 3 | alchemist | 6/0 | 投掷炼金单元 | I | `SUB.alchemist`（ranged/lob）+ 装置 token kit |
| 4 | aoesniper | 0/2 | 群体物理 | I* | `SUB.aoesniper.splashRadius 1.1`；**模组**`atk_scale`(W)/`def_penetrate_fixed`(菲亚梅塔) 在自选侧空转 |
| 5 | artsfghter | 4/2 | 法术伤害 | I* | `dmgType` 数据；薇薇安娜 `ep_damage_ratio`（灼燃目标 +15% 元素）自选侧空转 |
| 6 | **artsprotector** | 0/1 | 见 §1.2 | **N** | `SUB` 无条目（`professions.js:268-380`），`gamedata_const` 说常态 PHYSICAL |
| 7 | bard | 6/0 | 不攻击、光环治疗 10%/s | I | `SUB.bard`+`TUNE.bard`（`attack@atk_to_hp_recovery_ratio`）`professions.js:421` |
| 8 | bearer | 0/1 | 技能期阻挡 0，身前一名 +1 | **P** | `installBearer`（:157-162）只做自身 `blockCnt:-99`；**"身前一名干员阻挡数+1"没人做**，`block_cnt` 键在自选侧也无人读 |
| 9 | blastcaster | 4/2 | 超远距离群体法术 | I* | `SUB.blastcaster`；伊芙利特/谬因的距离加成（`min_dist`/`max_dist`/`damage_scale`）自选侧空转（`min_dist`/`max_dist` 全仓库无人读） |
| 10 | **blessing** | 0/2 | 见 §1.2 | **N** | 同上 |
| 11 | bombarder | 2/1 | 群体 + N 次余震 | P | `TUNE.bombarder`（:388）读 `attack@append_atk_scale`/`attack@times` ✓；**维什戴尔的 `attack@enable_third_attack`（第三次伤害）无人读** ⇒ 她只有 2 段 |
| 12 | centurion | 8/1 | 打阻挡的全部 | I* | `SUB.centurion.hitAllBlocked`；模组 `atk_scale`（被阻挡 +10%）在自选侧空转 |
| 13 | chain | 4/0 | 3~4 目标跳跃 + 停顿 | I | `TUNE.chain`（:408-418）读 `attack@max_target`/`attack@sluggish`/`attack@chain.atk_scale`+文本解析 |
| 14 | chainhealer | 2/1 | 3 目标跳跃治疗 | I | `TUNE.chainhealer`（:397-406） |
| 15 | charger | 6/0 | 击杀 +1DP；撤退返还费用 | **P** | `TUNE.charger`→`dpOnKill` ✓；**"撤退时返还部署费用"在仿真/对局层都没有实现**（`server/**` 无 refund 通道）——不过本模式**部署本来就不花 DP**，该子句实际空转，见 §3 |
| 16 | closerange | 2/3 | 高精度近射（定位） | I | 无规则；范围来自 `rangeGrid` |
| 17 | corecaster | 0/5 | 法术伤害 | I* | `dmgType`；模组 `magic_resist_penetrate_fixed`（无视 10 法抗）自选侧空转 |
| 18 | **counsellor** | 2/0 | 阻挡 2 + **可以支援待部署区** | **N** | `SUB.counsellor = P({})`（`professions.js:367`）且全仓库无其他读者；阻挡数由 `stats.blockCnt` ✓ |
| 19 | craftsman | 2/2 | 阻挡 2 + 支援装置 | P | 装置是 token：赛季侧有 kit；**自选侧白铁/娜斯提的装置落在 36 个无 kit 召唤物里**（§2.1-C） |
| 20 | crusher | 2/1 | 打阻挡的全部 | I* | `hitAllBlocked`；模组 `heal_scale` 自选侧空转 |
| 21 | dollkeeper | 4/1 | 致命伤换替身 | I | `installDollkeeper`（:88-115）+ `TUNE.dollkeeper`（`duration`/`max_hp`）；风丸的 `talent_override_rangeid_flag` 无人读（范围改由 `rangeGrid` 承载） |
| 22 | **duelist** | 0/1 | 缓慢回 SP，**只有阻挡时恢复** | **N** | `SUB.duelist = P({})`（:340）；`sp_recover_ratio` 全仓库唯一出现处是 `content/enemies.js:1015`（敌方技能）⇒ 森蚺的 SP 完全不受阻挡影响 |
| 23 | executor | 4/4 | 再部署大幅↓ | P | `respawnTime` 数据 ✓；**模组 `withdraw_cost_recover_ratio`（撤退返还大量费用）全仓库无人读**（同 #15） |
| 24 | fastshot | 10/3 | 优先空中 | I | `SUB.fastshot.priority:'fly'` + `TUNE.fastshot`（`atk_scale`） |
| 25 | fearless | 4/3 | 阻挡 1 | I* | `stats.blockCnt`；模组 `atk_scale`（被阻挡 +15%）自选侧空转 |
| 26 | fighter | 2/2 | 阻挡 1（精锐追加：HP>50% ASPD+10 / 15% 物闪） | **P** | 赛季山 `chess_char_5_17_b` 的 `attack_speed` **有实现**（`tier5.js:2119-2122` `whileOn`+`HALF_HP`）✓；**自选侧重岳（`prob:0.15` 闪避）与贝洛内（`attack_speed:10`+`hp_ratio`）无人读** |
| 27 | fortress | 4/0 | 不阻挡时远程群体 | I | `SUB.fortress.fortress` + `ai.js:114-121`（近/远切换） |
| 28 | funnel | 10/1 | 浮游单元同目标递增 | I | `SUB.funnel`+`TUNE.funnel`（init/delta/max） |
| 29 | geek | 2/1 | 自身持续掉血 | I | `installHpDrain`（:56-64）+ `TUNE.geek`（`hp_ratio`） |
| 30 | guardian | 6/1 | 技能可以治疗友方 | I | 治疗写在 kit 的技能里（赛季 6 条全有 kit） |
| 31 | hammer | 2/1 | 溅射 50% | P | `TUNE.hammer`（`attack@ability_range_radius`/`attack@atk_scale_2`）✓；**怒潮凛冬的 `atk_scale_e`/`cnt`（溅射≥3 敌人 +15%）无人读** |
| 32 | healer | 2/0 | 远距离治疗量 80% | I | `TUNE.healer`（`heal_scale`） |
| 33 | hookmaster | 4/0 | 位移 + 可放远程位 | I | `SUB.hookmaster.canHitFly` + kit 的拖拽；模组 `dist`/`value`/`interval` 有读者 |
| 34 | hunter | 2/1 | 弹药 8 发、120% | P | `TUNE.hunter`（`value`/`atk_scale`）✓；**莱伊的 `extra_add`（空弹时额外补 1 发）无人读** |
| 35 | incantationmedic | 6/0 | 攻击时治疗 50~60% | I | `TUNE.incantationmedic`（`scale`） |
| 36 | instructor | 2/1 | 未阻挡 +20~30% | I | `TUNE.instructor`（`atk_scale`） |
| 37 | librator | 2/1 | 不攻击、40 s 蓄到 +200% | I | `installLibrator`（:117-145）+ `TUNE.librator`（`atk`/`max_stack_cnt`）；`mid_stack_cnt` 无人读但线性 ramp 等价 |
| 38 | longrange | 4/0 | 优先最低防御 | I | `SUB.longrange.priority:'lowDef'` |
| 39 | loopshooter | 2/1 | 投射物回收前不能再攻击 | I | `installLoopshooter`（:190-193）+ `ai.js throwBoomerang` |
| 40 | lord | 8/3 | 可远程、远程 80% | P | `SUB.lord` dmgMul 读 `atk_scale` ✓；**棘刺 `atk_scale_m`（攻击附带 10% 法术伤害）、丰川祥子 `attack_speed`（范围内≥2 敌 +12）无人读** |
| 41 | merchant | 2/1 | 每 3 s 扣 DP | I | `installMerchant`（:66-80）+ `TUNE.merchant`（`interval`/`cost`） |
| 42 | musha | 2/2 | 禁疗、每次命中回血 | I | `installSelfHealOnHit` + `TUNE.musha`（`value`） |
| 43 | mystic | 2/2 | 蓄能（最多 3~4） | P | `installMystic`+`TUNE.mystic`（`times`）✓；**维伊 `merge_cnt`（有蓄能时 ASPD+30）无人读** |
| 44 | phalanx | 8/1 | 常态不攻击、防御/法抗↑ | P | `installPhalanx`+`TUNE.phalanx`（`def`/`magic_resistance`）✓；**"技能开启时保留部分效果"的 `*_e_002[buff].def`/`.magic_resistance`（薄绿/蜜蜡/卡涅利安/林）无人读** ⇒ 开技能时增益被整个摘掉 |
| 45 | physician | 10/4 | 治疗 | I* | `dmgType:'heal'`；**模组 `heal_scale`+`hp_ratio`（治疗低血 +15%）在自选侧空转**（手写自选 kit 走 `freePicks.js:749 installLowHpHealBonus`，通用 kit 不走） |
| 46 | pioneer | 6/3 | 阻挡 2（精锐追加：阻挡时攻防 +8%） | **P** | 赛季忍冬 `tier3.js:1373-1374` 用 `whileTrue(...blocking.length>0, {atkPct,defPct})` **实现了** ✓；**自选侧推进之王/郁金香/嵯峨的特性子句无人读**（他们的天赋是别的规则，通用 kit 只读天赋不读特性） |
| 47 | primcaster | 6/1 | 法术 + 可造成元素 | I* | 元素管线在（`playtest5_elements`）；`damage_scale`（元素爆发目标 +10%）在自选侧空转 |
| 48 | primprotector | 4/1 | 阻挡 3 + 元素损伤 | I* | `stats.blockCnt`；`ep_damage_scale`（阻挡时元素损伤 +15%）**在自选侧珊比身上空转**（赛季菲莱/余的 kit 有读） |
| 49 | protector | 8/3 | 阻挡 3~4 | I* | `stats.blockCnt`；模组 `def`（阻挡时防御 +20%）在自选侧空转 |
| 50 | pusher | 2/1 | 打阻挡的全部 + 可放远程位 | P | `hitAllBlocked` ✓；**"返还部署费用一半"（`value`）同 #15 未实现**（本模式部署免费 ⇒ 空转） |
| 51 | reaper | 6/0 | 禁疗、群伤、每命中回 50~60 | I | `SUB.reaper`+`installSelfHealOnHit(true)`+`TUNE.reaper` |
| 52 | reaperrange | 4/1 | 全体 + 前方一排 150~160% | I | `TUNE.reaperrange`（`atk_scale`+`def.raw.trait.rangeGrid`）+`onFrontLine`/`inTraitGrid` |
| 53 | ringhealer | 8/1 | 同时治疗 3~4 | I | `TUNE.ringhealer`（文本 三个/3个 + `heal.count`） |
| 54 | ritualist | 4/1 | 法术 + 元素损伤 | I* | 元素管线；`ep_damage_scale`（精英/领袖 +18%）**在自选侧酒神身上空转** |
| 55 | shotprotector | 6/2 | 阻挡 3 + 可远程 | I* | `SUB.shotprotector`；模组"隐匿失效"与【沉沦者的黑流树海】词条：前者赛季 kit 有，后者是**本赛季不存在的关卡主题**（§3） |
| 56 | **siegesniper** | 0/2 | 见 §1.2 | **N** | 同上 |
| 57 | skywalker | 2/1 | 起飞后阻挡 2 个飞行敌人 | I | `SUB.skywalker.blockFly` + `installSkywalker`（:240-242）；`height_offset` 是表现层 |
| 58 | slower | 12/2 | 法术 + 停顿 | I | `TUNE.slower`（`sluggish`） |
| 59 | **soulcaster** | 0/1 | 见 §1.2 | **N** | 同上 |
| 60 | splashcaster | 10/2 | 群体法术 | I | `SUB.splashcaster.splashRadius 1.1` |
| 61 | stalker | 2/1 | 全体伤害 + 50% 双闪避 | I | `installStalker`+`TUNE.stalker`（`prob`） |
| 62 | summoner | 0/3 | 可用召唤物 | **P** | 召唤机制本身在（`placeable` token、`gamedata.placeableTokens`），**但麦哲伦/令/电弧的召唤物全是无 kit 的 36 个之一**（§2.1-C） |
| 63 | sword | 2/2 | 普攻两段 | I* | `SUB.sword.hits:2`；模组 `damage_scale`/`value`/`def_penetrate_fixed` 在自选侧（陈/艾丽妮）空转 |
| 64 | tactician | 4/1 | 战术点召唤援军 + 150% | I | `installTactician`（:195-211）+`TUNE.tactician`（`atk_scale`） |
| 65 | traper | 0/3 | 陷阱协助（低费、不能放敌人所在格） | **P** | `SUB.traper`（:379）只给了 `attack/range`；**陷阱本体是多萝西的 `token_10025_doroth_recttp`（无 kit）**；模组 `prob`/`atk_scale`（20% 双倍伤害）无人读 |
| 66 | underminer | 8/0 | 法术 | I | `TUNE.underminer`（模块的 `atk`+`duration` → `weaken`） |
| 67 | unyield | 4/1 | 禁疗 | I* | `SUB.unyield.noHeal`；模组 `damage_scale` 在自选侧空转 |
| 68 | wandermedic | 4/0 | 回复元素损伤 50~60% | I | `TUNE.wandermedic`（`ep_heal_ratio`） |
| 69 | **watchman** | 0/1 | 见 §1.2 | **N** | 同上 |

**计数（按组，69 组全数入账）**：

| 判定 | 组数 | 组 |
|---|---|---|
| **I**（规则完整） | **31** | agent, alchemist, bard, chain, chainhealer, closerange, dollkeeper, fastshot, fortress, funnel, geek, guardian, healer, hookmaster, incantationmedic, instructor, librator, longrange, loopshooter, merchant, musha, reaper, reaperrange, ringhealer, skywalker, slower, splashcaster, stalker, tactician, underminer, wandermedic |
| **I\***（基座完整，只有"模组/自选侧"的词条空转） | **15** | aoesniper, artsfghter, blastcaster, centurion, corecaster, crusher, fearless, physician, primcaster, primprotector, protector, ritualist, shotprotector, sword, unyield |
| **P**（基座实现，列出的半边没有） | **15** | bearer, bombarder, charger, craftsman, executor, fighter, hammer, hunter, lord, mystic, phalanx, pioneer, pusher, summoner, traper |
| **N**（规则无任何读者） | **7** | artsprotector, blessing, counsellor, duelist, siegesniper, soulcaster, watchman |
| **N/A**（未启用占位） | **1** | `(none)`（8 条 DIY） |
**玩家可见的 N**：7 条自选干员（斩业星熊、淬羽赫默、遥、早露、提丰、死芒、凯尔希·思衡托）+ 赛季的 **凛御银灰**（`counsellor`，可见六星）+ 自选的 **森蚺**（`duelist`）⇒ **9 条记录 / 7 组**。

### 1.4 自选干员的不对称：特性黑板书只被 `TUNE` 读

**这是本轮最容易被误判的地方，也是"部分实现"的主要来源。**

- 赛道：`resolveProfile` 把 `def.traitBb` 摊成 `profile.tb`（`professions.js:448,455`），**赛季 kit 大量读 `traitBb(chess)`**（tier1:52、tier2:20、tier3:44、tier4、tier5:88、`freePicks.js:410/438/557/749/955`、`tokens.js:541/587`）——所以赛季记录的特性/模组词条基本都有读者。
- 自由位置：82 条记录走 `genericKit`。**`generic.js` 不读 `traitBb`，`genericTalents.js` 读的是 `def.talents`（天赋），不是特性。** ⇒ 这 82 条记录的 `profile.tb` **只可能**被 `professions.js` 的 `TUNE[subProfession]`（:386-434）消费。

实测（`genericTraits.mjs`）：这 82 条记录一共出现 **46 个不同的特性黑板键**，在 `TUNE`+`generic*.js` 里**完全没有读者**的有 10 个：

```
sp_recover_ratio            (duelist 森蚺)
withdraw_cost_recover_ratio (executor 傀影/麒麟R夜刀/弑君者)
attack@enable_third_attack  (bombarder 维什戴尔)
lin_e_002[buff].def / .magic_resistance  (phalanx 林)
merge_cnt                   (mystic 维伊)
atk_scale_e                 (hammer 怒潮凛冬)
extra_add                   (hunter 莱伊)
ep_damage_scale             (primprotector 珊比 / ritualist 酒神)
height_offset               (skywalker 予愿安洁莉娜，表现层)
min_dist / max_dist         (blastcaster 伊芙利特/谬因)
```

而**更多键虽然"全仓库有读者"（赛季 kit 里），对自选记录仍然空转**：`atk_scale`（W/煌/止颂/棘刺/假日威龙陈/娜仁图亚/可露希尔/死芒… 的模组）、`magic_resist_penetrate_fixed`（corecaster 五人）、`def_penetrate_fixed`（艾丽妮）、`heal_scale`（赫德雷/黍/凯尔希/闪灵）、`damage_scale`（真言/斥罪/陈）、`prob`/`attack_speed`/`hp_ratio`（重岳/贝洛内）、`ep_damage_ratio`（薇薇安娜）、`def`（年/预备干员-重装）、`attack_speed`+`attack_speed_m`（丰川祥子/棘刺）。**这类"模组的特性词条只在手写 kit 里被读"就是旧审计的 G2 类，本轮证明它同样命中"特性"而非只是"天赋"。**

> 复现：`node D:\projects\_scratch\trait-audit\genericTraits.mjs`（输出每组 `DEAD=[…]`）。

### 1.5 数据缺口 vs 实现缺口（带 file:line）

| 组 | 判定 | 类型 | 证据 |
|---|---|---|---|
| 8 条 DIY 甄选干员 | N/A | **数据缺口（有意）** | `trait: null` + `stats: null` + `isDiy`；`gamedata.js:82` 过滤；`build-data` 本就不该产出规则 |
| artsprotector / blessing / siegesniper / soulcaster / watchman | **N** | **实现缺口**（`SUB` 里没有条目：`professions.js:268-380`，`test/sim/professions.test.js:48` 钉住）+ **数据管线缺口**（伤害类型本来在 `gamedata_const.subProfessionDamageTypePairs`，管线没加载） | 实测 `KNOWN_SUBPROFESSIONS` 64 条不含这 5 个 |
| counselur 凛御银灰 | **N** | **实现缺口** | `professions.js:367` `counsellor: P({})`；"支援待部署区"全仓库无读者 |
| duelist 森蚺 | **N** | **实现缺口** | `professions.js:340` `duelist: P({})`；`sp_recover_ratio` 只在 `content/enemies.js:1015` 被读（敌方） |
| bearer 琴柳 的"身前一名 +1" | P | **实现缺口** | `installBearer`（`professions.js:157-162`）只改自身 |
| charger / executor / pusher 的"撤退返还费用" | P | **实现缺口**（但本模式空转，见 §3） | `withdraw_cost_recover_ratio` 零读者；`server/**` 无退款通道 |
| phalanx 模组"技能开启时保留部分效果" | P | **实现缺口** | `lin_e_002[buff].def/.magic_resistance`（薄绿 `soil_e_002`、卡涅利安 `billro_e_002`）零读者；`installPhalanx`（:147-155）技能一开就整个摘 buff |
| bombarder 维什戴尔第三次伤害 | P | **实现缺口** | `attack@enable_third_attack` 零读者；`TUNE.bombarder`（:388）只认 `attack@times` |
| mystic 维伊 / hunter 莱伊 / lord 棘刺 / hammer 怒潮凛冬 的模组词条 | P | **实现缺口** | `merge_cnt` / `extra_add` / `atk_scale_m` / `atk_scale_e` 零读者 |
| 自选侧的一大批模组 `atk_scale`/`heal_scale`/`damage_scale`/`prob`… | P | **实现缺口（架构性）** | 通用 kit 不读 `traitBb`（`generic.js`；`genericTalents.js` 只读 `def.talents`） |
| traper 三条记录 | — | **不是缺口** | `trait.desc`/`bb` 都在（实测） |
| ~~traper 特性丢失~~ | — | **不可复现** | 见 §1.1 |

---

## 2. B 部分 — 缺口清单（合并旧清单）与来源裁决

来源裁决代号：**(a)** 本机已缓存 · **(b)** 镜像 + 代理可取 · **(c)** 本机 PC 客户端 AB（`tools/local-extract/aklz4.py`）· **(d)** IL2CPP dump 里只有名字 · **(e)** 引擎独有（C# 方法体，真正读不到）。

### 2.1 排序后的清单（玩家可见价值优先）

| # | 类别 | 规模（本轮实测） | 现状 | **来源裁决** | 具体 key / 文件 |
|---|---|---|---|---|---|
| **A** | 自选干员的天赋 | 93 条记录声明 **180** 条天赋：`installed` 23、`installed-by-kit` 6、**`partial` 12**、**`unexpressed` 139** ⇒ **78/93 条记录装 0 条**（旧审计的 "152 未装" / brief 的 "125" 都是旧快照） | `server/sim/content/genericTalents.js` 已上线（`WRAPPER_KITS` 7 条记录不重复安装） | **(a)** `character_table.json`（`.cache/gamedata/excel/`）+ `skill_table.json`；**(c)** `buff_template_data.json`（阈值叠层/技能期间）；**(b)** PRTS | 三类 reason：**131** `no faithful kit-DSL form`、**8** `empty blackboard（描述即规则：召唤/编队机制）`；`genericTalents.js:28-31` 列了未覆盖类 |
| **B** | 特性 profile 缺失 | **7 条**自选（5 组） | 回落到职业默认 | **(a)+(b)** `gamedata_const.json → subProfessionDamageTypePairs`（伤害类型）；规则文本 → PRTS 子职业页 | `artsprotector/blessing/siegesniper/soulcaster/watchman` |
| **C** | 无 kit 的召唤物 | **59** 条 token 记录 = 23 有 kit（19 赛季 + 望的棋子 + 3 无主装置）；**36 无 kit，全部是自选干员声明的**；其中 **6 条既无 kit 又无记录技能** | 通用 token kit 只能读它自己的技能黑板 | **(a)** `skill_table.json`（37 条有运行时技能规格）+ `data/tokens.json`；**(c)** `buff_template_data.json`（棋子那类"piece/consume"行为）；**(b)** PRTS `Category:召唤物` | 6 条裸体：`token_10002_kalts_mon3tr`(Mon3tr)、`token_10003_cgbird_bird`(幻影)、`token_10032_jesca2_jckshd`(机动盾牌)、`token_10065_demetr_dmtpos`(牵绊，`placeable:false`)、`token_10070_aphris_pc`(中继器)、`token_10071_aglna2_agairp`("一会儿见！") |
| **D** | 阵营光环 | **66 处【…】引用，落在 60 条记录上**（本轮实测） | `genericTalents.js` 的 `auraProfession` **只**认 8 个职业名（`PROFESSION_BY_NAME`） | **分三层**：<br>①【米诺斯】【萨尔贡】【罗德岛】【拉特兰】【谢拉格】【萨卡兹】【卡西米尔】【叙拉古】= **`nationId`，已经在 `data/chess.json` 里** ⇒ 纯**实现缺口**；<br>②【乌萨斯学生自治团】【岁】【莱欧斯小队】= `teamId`/`groupId`，**没有写进 chess 记录**（`build-data.mjs:774/1239` 只写 `nationId`，`:1012` 读了但不落盘）⇒ **数据管线缺口**；源头有两条：`character_table.teamId/groupId`（已缓存）**和**权威名册 `gamedata_const.termDescriptionDict['cc.g.*']`/`ba.laiosteam`/`ba.sees`；<br>③【海怪】【野生动物】【萨卡兹的无终奇语】【岁的界园志异】【沉沦者的黑流树海】【卫戍协议】【调和】【法术脆弱】= 关卡/机制标签，**本赛季不存在该关卡主题** ⇒ 见 §3 | `cc.g.ussg`="早露、凛冬、真理、古米、烈夏、苦艾"；`cc.g.sui`="年、夕、令、重岳、黍、余、望"；`ba.laiosteam`="玛露西尔、森西、莱欧斯、齐尔查克" |
| **E** | 引擎词汇 | `docs/research/13-token-abnormal.json → unexpressible` 共 **24 类**（本轮计数；另有 `effects` 只映射了 `禁疗`/`孤立` 两个） | 一半引擎有 flag | **大部分 (e)/实现缺口**：`无敌`（引擎有 `invulnerable`，`Battle._setupUnit` 只读 `healFree`/`isolated`）、`不可阻挡`（有 `unblockable`，`abnormal` 没映射）、`阻回`（= `noSp`）、`静默`（= `silence`）、`强制缴械`（= `disarm`）、`不死`（无概念）；**定义本身在 `gamedata_const.termDescriptionDict ba.*`（(a)/(b)）** | `Battle.js:321`；`ba.steal`/`ba.palsy`/`ba.tremble`/`ba.chant`/`ba.overdrive`/`ba.strong`/`ba.refraction`/`ba.addbullet`/`ba.costlowerbound`/`ba.dmgresistance`/`ba.groundbind`/`ba.magicarcane` |
| **F** | 弱点伤害 | 3 条记录提到（火陈 形意洞照、伺夜 特性、鸿雪 弱点速记）| 无引擎支持 | **(a)/(b)** `gamedata_const.termDescriptionDict['ba.weaknessatk']` = "造成物理或法术伤害时，根据目标防御力和法术抗性变更伤害类型" ⇒ **定义有了，规则很短，是实现缺口** | — |
| **G** | 起飞 | watchman 凯尔希·思衡托 + skywalker 蒂比/予愿安洁莉娜 | skywalker 已实现（`blockFly`）；watchman 没有 | **(a)/(b)** `ba.liftoff` = "不阻挡地面敌人且不会被地面敌人攻击，可以阻挡飞行敌人" ⇒ 定义完整 | — |
| **H** | 阈值叠层 / 每技能"技能期间" | 属于 A 的 131 条 `no faithful kit-DSL form` 的主要子类 | DSL 没有对应 mod | **(c)** `buff_template_data.json`（ActionNode 图：`OverwriteBuff`/`max_stack_cnt`/`ON_SKILL_*`）+ **(a)** `char.skills[]` 黑板 | 例：`oblvns_s_2[switch]` 的 `IfConditions[IsFeverFull,IsInFever]`（16 号文件已示范读法） |
| **I** | Boss 体型两个遗留 follow-up | ① 47 个未建模 prefab 能否经本赛季刷怪图可达；② 是否有 stage 的部署图能落在 boss 自己的格子上 | — | **(c)** `battle/enm_pfb_*.ab`（根 collider）+ **(a)** `data/waves.json`/`data/stages.json` | `tools/local-extract/enemy_scales.py` 的推导法 |
| **J** | `enemy_5601_entlec.icon` | 1 个文件 | 永远取不到 | **四个来源全 404 + 本地客户端也没有** ⇒ 已自洽，不要修 | AGENTS.md 已记录 |

### 2.2 两张被低估的表

**`excel/gamedata_const.json`**（125 个顶层键；`tools/build-data.mjs` **没有**加载它 —— 16 号文件 §5.3 已指出）

| 键 | 关掉哪一块 | 示例值 |
|---|---|---|
| `subProfessionDamageTypePairs` | §1.2 的 5 组（伤害类型）+ 校验 artsprotector 现状是错的 | `{"artsprotector":"PHYSICAL","blessing":"MAGICAL","siegesniper":"PHYSICAL","soulcaster":"MAGICAL","watchman":"HEAL", …}`（含 `notchar1/2`、`mercenary`、`skybreaker`、`supportiveranger`、`primguard` 这些本赛季没有的） |
| `termDescriptionDict['cc.g.*']` + `ba.laiosteam` + `ba.sees` | **D-② 阵营光环的权威名册**（比 `teamId`/`groupId` 更直接：就是"包含以下干员"的名单） | `cc.g.ussg`/`cc.g.sui`/`cc.g.abyssal`/`cc.g.rh`/`cc.g.minos`/`cc.g.laterano`/`cc.g.sargon`/`cc.g.siracusa`/`cc.g.karlan`/`cc.g.elite`/`cc.g.psr`(红松骑士团)/`cc.g.bs`/`cc.g.glasgow`/`cc.g.lgd`/`cc.g.lda`/`cc.g.R6`/`cc.g.Attack`/`cc.g.Defence`/`cc.g.A1`/`cc.g.sm` |
| `ba.weaknessatk` / `ba.liftoff` | **F / G** 的定义 | 见 §2.1 F、G |
| `feverGameData` | Fever 450/20（16 号文件） | `{"feverDuration":20,"feverNeed":450}` |
| `pushForces` / `pullForces` + `*ZeroIndex` | 推拉力表（仿真现在是硬的 `PUSH_TILES` 类常量） | `[0,100,200,400,450,530,580]` idx 3 / `[0,2,10,40,42,44,46]` idx 3 |
| 其余 `ba.*`（40+ 条） | **E** 的状态语义 | `ba.strong`(精力充沛)、`ba.overdrive`(过载)、`ba.chant`(吟唱)、`ba.tremble`(战栗)、`ba.palsy`(麻痹)、`ba.steal`(偷取)、`ba.costlowerbound`(部署费用下限)… |

取法（实测 2026-10-04，两台镜像都 **206**，走代理）：
```powershell
$env:NODE_USE_ENV_PROXY='1'; $env:HTTP_PROXY='http://127.0.0.1:7890'; $env:HTTPS_PROXY='http://127.0.0.1:7890'
node -e "fetch('https://cdn.jsdelivr.net/gh/Kengxxiao/ArknightsGameData@master/zh_CN/gamedata/excel/gamedata_const.json').then(r=>console.log(r.status))"
# 或 ArknightsAssets/ArknightsGamedata@master cn/gamedata/excel/gamedata_const.json
```
本机已有副本：`D:\projects\_scratch\fever\gamedata_const.json`。**注意 `.cache/gamedata/excel/` 里没有它**（只有 activity/audio/battle_equip/character/enemy_handbook/range/skill/uniequip）——想进管线要新增一次 `loadGamedata('excel/gamedata_const.json')`。

**`buff_template_data.json`**（37 MB，**不是 excel 表**，是 buff 模板的 ActionNode 图）

- 内容形如 `{ "damage_block[all]": { templateKey, eventToActions: { ON_TAKE_DAMAGE: [ { "$type": "Torappu.Battle.Action.Nodes+BlockDamage, Assembly-CSharp", … } ] } } }`。
- **来源实测**：本机客户端 `…\AB\Windows\config\buff_template_holder.ab`（1.9 MB）里**恰好一个** MonoBehaviour，`m_Name = "buff_template_holder"`（本轮用仓库自己的 `tools/local-extract/aklz4.py` + UnityPy 读出）⇒ **[BUNDLE] / 裁决 (c)**，已解好的副本在 `_scratch/probe/buff_template_data.json`（**(a)**）。
- 关掉：**H（阈值叠层 / 每技能"技能期间" / 状态挂载）**，以及 **C 里"行为住在 buff 模板"的召唤物**。16 号文件已经示范过读法（`inspect_gates.mjs` 展开 `oblvns_s_2[switch]`）。
- 注意 **Kengxxiao 镜像 404**（`excel/buff_template_data.json` 不存在）⇒ 只能走客户端 AB，别去 raw 上找。

### 2.3 结论性判断：D 从"不可实现"变成"数据管线"

上一份报告说"这些阵营不在 `data/bonds.json`、也不在 `def.bonds`"——**这句话对"盟约（bond）"成立**（`data/bonds.json` 只有 23 个，没有 `cc.g.*` 这些阵营），**但对"能不能实现阵营光环"不成立**：

1. `nationId` 类（米诺斯/萨尔贡/罗德岛/拉特兰/谢拉格/萨卡兹/卡西米尔/叙拉古）**今天就在 `data/chess.json` 里**（`build-data.mjs:774/1239`）⇒ 只差一个"按 nation 的光环"规则，**10 分钟级**。
2. `teamId`/`groupId` 类（乌萨斯学生自治团/岁/莱欧斯小队/深海猎人/莱茵生命/红松骑士团/格拉斯哥帮/龙门近卫局/鲤氏侦探事务所/彩虹小队/精英干员）**在客户端数据里确实有**（`character_table.teamId|groupId`，本机 `.cache/gamedata/excel/character_table.json` 已缓存；实测 1375 名角色里 61 有 `teamId`、78 有 `groupId`）⇒ **数据管线任务**：给 chess 记录补两个字段 + 一个按组的解析器。**而且 `gamedata_const.termDescriptionDict.cc.g.*` 直接给了"包含以下干员"的名单**，连 character_table 都不用遍历。
3. 本赛季名册里各组的实际可上场成员（实测，用来估价值）：

| 组 | 可上场成员 |
|---|---|
| 岁(`sui`) | 夕、令、望、黍、年、余、重岳（7） |
| 精英干员(`elite`) | 迷迭香、逻各斯、烛煌、真言、电弧、机械师、煌（7） |
| 莱茵生命(`rhine`) | 白面鸮、赫默、缪尔赛思、伊芙利特、溯光星源、麦哲伦、淬羽赫默、娜斯提、多萝西、塞雷娅（10） |
| 深海猎人(`abyssal`) | 幽灵鲨、歌蕾蒂娅、归溟幽灵鲨、乌尔比安、斯卡蒂（5） |
| 乌萨斯学生自治团(`student`) | 古米、早露、怒潮凛冬（3） |
| 黑钢国际(`blacksteel`) | 雷蛇、涤火杰西卡（2）；红松骑士团 4；格拉斯哥帮 1；莱欧斯小队 **1**（只有玛露西尔） |
| `rainbow` | 灰烬、艾拉（2）；`babel` 4；`tara` 2；`lee` 2；`followers` 2；`sees`/`action4`/`reserve6` 各 1 |

> 【玛露西尔 可靠的同伴】要求"编队中有 4 名【莱欧斯小队】干员"——本赛季**只有她一人**可上场（`teamId:laios` 的另 3 人在任何池子里都没有）⇒ 这条天赋的条件**在本赛季不可达**，属于 §3，不要为它写代码。

---

## 3. C 部分 — 诚实天花板

**真的拿不到 / 不该再找的：**

1. **C# 方法体（IL2CPP 只有名字）**：`.cache/il2cpp/dump/dump.cs` 给的是类型/字段/签名。`FeverSystemManager.OnTick/_DropFever/_UpdateFeverStep`、`FeverBehaviour._JoinFever`、以及所有 `ActionNode` 子类的**实现**读不到。表现语义只能靠 PRTS 反推（16 号文件 §4.1 已列）。
2. **内联常量**：`AddFeverBySourceIfNotFull` 只有 `_sourceType`/`_feverKey`，基类 `ActionNode` **零字段**（`dump.cs:554532`）⇒ "每次伤害 +N" 只能是运行时读黑板或**内联在 C# 里**。同类：所有"黑板里没有、描述里有"的数字。
3. **拿不到的 Unity 场景**：`act45side`（活动 45 期）关卡场景不在本机客户端 `StreamingAssets\AB\Windows\scenes\activities\`，`hot_update_list.json` 也没有它 ⇒ **无法 100% 排除**"某张关卡场景给 Fever 档位挂了 `EnvActionToGlobal`"（16 号 §4.3 的反证仍然成立：IL2CPP 里 Fever 的 `EnvEventExecutor` 只有 `EnvFeverDuckingMusic`）。
4. **纯粹的表现层**：
   - BGM ducking（`fever_mid`/`fever_full` 只切 BGM）、HUD 插件（`HudPlugins/char_fever_prepare_slider`）——本 sim 没有 bank/HUD 插件系统。
   - **Unity 粒子/prefab 级特效**（例如只存在于 prefab 的命中特效、Spine 附属层）——渲染侧只消费 `render/fx.js` 的固定 fx 种类，**prefab 本体不是数据模型的一部分** [inferred]。
5. **本赛季不可达 / 空转的词条**（写代码也没有观测者）：
   - 【莱欧斯小队】4 人条件（只有玛露西尔可上场）。
   - **关卡主题词条**：【沉沦者的黑流树海】（机械师模组）、【岁的界园志异】（电弧模组）、【萨卡兹的无终奇语】（锡人）、【野生动物】（小满）——这些是别的模式的关卡标签，本赛季没有对应 stage。
   - **"撤退时返还部署费用"**（charger/executor/pusher 特性子句）：本模式部署**不花 DP**（`startOpCooldown` 与初始部署都免费），该子句在"盟约"里本就近乎空转。
   - `height_offset`、`talent_override_rangeid_flag`、`mid_stack_cnt`（线性 ramp 下与 `max_stack_cnt` 等价）——表现/冗余键。
6. **四个来源全 404 的素材**：`enemies.enemy_5601_entlec.icon`（本地客户端也没有；地图/计划已注明无 Spine、字形兜底）⇒ 状态自洽，**不要去"修复"**。
7. **47 个未建模的巨型 prefab**：今天没有 `data/enemies.json` 记录指向它们 ⇒ **不可达**，不是"不可实现"；要收口得先证明本赛季刷怪图能刷出来（§2.1-I①）。

**能拿到但需要工作量的（放进 §2 的裁决，不算天花板）**：`gamedata_const.json`（两镜像 206）与 `buff_template_data.json`（本机 AB）——**这就是本轮最大的可执行发现**。

---

## 4. 复现方式（全部只读）

```powershell
cd D:\projects\Stronghold-Protocol
node D:\projects\_scratch\trait-audit\enumerate.mjs     # 69 组 × 特性文本/黑板  -> enum.txt
node D:\projects\_scratch\trait-audit\measure.mjs       # 359 条各开一场真实战斗 -> measure.json/txt
node D:\projects\_scratch\trait-audit\keys.mjs          # 特性黑板键的读者可达性  -> keys.txt
node D:\projects\_scratch\trait-audit\genericTraits.mjs # 通用 kit 下空转的键     -> stdout
node D:\projects\_scratch\trait-audit\tokkaudit.mjs     # 59 token / 36 无 kit / 6 裸体
node D:\projects\_scratch\trait-audit\factions2.mjs     # teamId/groupId 与 66 处【…】-> faction-auras.json
node D:\projects\_scratch\trait-audit\g15.mjs           # 180 条天赋的 139/12/23/6 分布
node D:\projects\_scratch\trait-audit\probes.mjs        # 8 个针对性效果探针
python D:\projects\_scratch\trait-audit\probe_buff.py   # 证明 buff_template_data.json 来自 config/buff_template_holder.ab
```

**一句话给实现者**：先做 **(a)** `gamedata_const.json` 进管线（`subProfessionDamageTypePairs` 补齐 5 组 profile 的伤害类型 + `cc.g.*` 给阵营光环一份权威名册）——这是唯一"一次改动关掉两个大类"的动作；再按 §2.1 的 A→C 顺序推进；`D-①`（nation 光环）与 `F`（弱点伤害）是最便宜的两块；**不要**去追 §3 里的任何一条。
