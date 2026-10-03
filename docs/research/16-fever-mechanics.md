# 16 — Fever（`env_033_fever`）：数值、语义与实现规格

**结论先行：Fever 的数值这次全部找到了**（不是"只能自己编"）。`docs/research/15` 之后新增本文件，
因为丰川祥子 `chess_free_char_4182_oblvns` 的天赋 2 与三个技能都挂在 Fever 上，需要一份可执行规格。

Tag 约定沿用 `00-INDEX.md`：**[DATA]** 客户端/官方数据 · **[VERIFIED]** 官方或 wiki 规则原文 · **[BUNDLE]** 客户端 AB 里读到的序列化字段 · **[IL2CPP]** 类型/字段名 · **[ASSUMED]** 提案。

来源优先级（本次全部可复核）：

| 来源 | 位置 | 用途 |
|---|---|---|
| 官方 gamedata 常量 | `gamedata_const.json → feverGameData`（两个镜像一致）| **量表上限 / Fever 时长** |
| 客户端 AB | `…\AB\Windows\battle\prefabs\[uc]envsystems.ab` → GO `env_033_fever` | 档位阈值 / 事件名 / HUD / BGM |
| IL2CPP 元数据 | `.cache/il2cpp/dump/dump.cs`（`tools/il2cpp-enum.mjs`）| 类型与字段名、**"谁消费 Fever 状态"的全集** |
| PRTS | `术语释义` 页 `id=ba.fever`；`丰川祥子` 页天赋/备注 | 语义、+N 值、无衰减 |

草稿与证据副本：`D:\projects\_scratch\fever\`（`gamedata_const.json`、`levels/`、`prts-sakiko.txt`、
`prts-terms.txt`、`prts-无忧梦呓.txt`、`env033-full.txt`、`skills-fever.txt`、`misc-fever.txt`、`probe_*.py`）。

---

## 1. 数值（这就是之前缺的全部）

| 量 | 值 | 出处（精确） | 标签 |
|---|---|---|---|
| **量表上限** | **450** | `gamedata_const.json → "feverGameData": {"feverDuration":20,"feverNeed":450}`。两镜像逐字一致：`Kengxxiao/ArknightsGameData@master zh_CN/gamedata/excel/gamedata_const.json`、`ArknightsAssets/ArknightsGamedata@master cn/gamedata/excel/gamedata_const.json`（jsDelivr 取，200）。PRTS 独立佐证："Fever累计至**450点**时" | **[DATA] + [VERIFIED]** |
| **Fever 持续** | **20 s** | 同上 `feverDuration: 20`；PRTS `ba.fever` "**20秒内**会持续释放当前技能"；BGM 片段 "时长约20秒" | **[DATA] + [VERIFIED]** |
| **衰减** | **没有衰减** | PRTS `ba.fever`："该进度所有成员共享，**在整场战斗中保留**"；"Fever状态期间：**耗尽**且不累积Fever值" ⇒ 只在**触发时清零**。旁证：`gamedata_const` 里 fever 只有 `feverDuration/feverNeed` **两个**字段，没有任何 decay 常量可调 | **[VERIFIED]** + 缺失推断 |
| **档位阈值** | **5 → `fever_full`**、**1 → `fever_mid`**、**0 → `fever_stop`** | `[uc]envsystems.ab` → GO `env_033_fever` → MB path_id `94084988182100305`（`FeverSystemManager`）：`_feverSteps` 原样三个元素 | **[BUNDLE]** |
| 进入/加入/离开事件名 | `fever_start` / `join` / `leave` | 同一 MB：`_feverStartEvent` / `_feverCharacterJoinEvent` / `_feverCharacterLeaveEvent` | **[BUNDLE]** |
| **`fever_mid`/`fever_full` 干什么** | **只切 BGM，没有任何玩法效果** | 同一 GO 的第四个 MB（`EnvFeverDuckingMusic`）：`_mainDucking {status:"fever_mid",bankName:"fever_mid"}`、`_subDucking {status:"fever_full",bankName:"fever_full"}`、`_mainStatus fever_mid`、`_subStatus fever_full`、`_stopStatus fever_stop`、`_startStatus fever_start`、`_maxPlayingTime 22.0`。而 IL2CPP 里**唯一**带 Fever 名字、且继承 `GlobalEnvSystem.EnvEventExecutor` 的类就是 `EnvFeverDuckingMusic`（`dump.cs:395134`）⇒ 没有第二个 Fever 专属消费者（泛用 executor 如 `EnvActionToGlobal` 是否被某张关卡场景配了 Fever 状态，见 §4.3 的残差）。PRTS 也把两者只描述成 BGM 版本：`fever_mid` = 《KiLLKiSS》inst.，`fever_full` = "场上存在**五名不同名且通过Fever状态开启技能的**成员"时切 Vocal. | **[BUNDLE] + [IL2CPP] + [VERIFIED]** |
| Fever 时长黑板键 | `FEVER_DURATION = "fever_duration"` | `dump.cs:124831`；技能 prefab 的 buff 用 `durationKey: "fever_duration"` | **[IL2CPP] + [BUNDLE]** |
| **天赋 2 每次伤害 +N** | **+3**（精英2）/ +2（精英1）/ +1（精英0） | `character_table.json → char_4182_oblvns.talents[1].candidates[*].blackboard` 的 `cnt` = **1 / 2 / 3**，与 PRTS 天赋三档 "Fever+1/+2/+3" **逐档吻合** | **[DATA] + [VERIFIED]** |
| HUD 量表最大值 | = 450（无独立数字） | HUD 插件 MB：`_pluginName "HudPlugins/char_fever_prepare_slider"`、`_filterByGroupTag 1`、`_groupTags ["mujica"]` —— **插件本身没有上限字段**；`FeverPrepareSlider` / `FeverCastSlider`（`dump.cs:614500/614560`）只有 `_feverKey` / `_characterGroupTag` 与一个运行时 `FeverSystemManager` 引用 ⇒ 上限只能来自 `gameData.feverNeed` | **[BUNDLE] + [IL2CPP]** |

**Fever 量表的上限/时长住在 `GameDataConsts.FeverGameData`（`dump.cs:171817`：`float feverDuration; float feverNeed;`）** ——
即"关卡常量表"，不是关卡 JSON、不是 prefab。这也解释了为什么之前翻遍关卡数据都找不到。

## 2. 机制语义（PRTS `术语释义#ba_fever` 原文，节选）

> Fever累计至450点时，任意一位 Ave Mujica 成员**手动触发技能**后，在场所有 Ave Mujica 成员 20 秒内会持续释放当前技能
> ※Fever值以 ♪ 图标显示于在场Ave Mujica成员模型右下……该进度所有成员共享，在整场战斗中保留
> ※Fever状态期间：耗尽且不累积Fever值，技力消耗条变为玫红色，所有受影响成员将无视技力限制地持续尝试**开启技能**（切换类技能除外），且通过此方法开启技能时**不消耗技力**；通过Fever状态开启的持续类技能将在Fever状态结束时强制结束；进入Fever状态前正在释放的持续类技能暂停计时，直至Fever状态结束

⇒ 需要实现的一共是**两个布尔 + 一个量表**：

- `collected` (0…450) —— 每次造成伤害 `+= cnt`（精英2 = 3），**不衰减**；
- `full` = `collected >= 450` —— 对应 ActionNode `Nodes.IsFeverFull`；
- `inFever` + `remaining`(20 s) —— 对应 `Nodes.IsInFever`；触发时 `collected = 0`。

**档位（0/1/5）与她的技能无关**：`_feverSteps` 的 `feverCharacterCount` 是"**已加入 Fever 的成员数**"
（`FeverStatus.feverCharacterCount`，由 `FeverBehaviour._JoinFever()` → `MarkJoinFever()` 维护，`m_feverCharacterSet` 是 `ListDict<string,int>`，
与 PRTS "五名**不同名**"吻合），而且只驱动 BGM。她的三个技能用的是 `IsInFever` / `IsFeverFull` 两个节点，见 §3。

## 3. 她自己的客户端数据（逐字段实测）

`[uc]skills.ab` 里带 `_feverKey` 的 MonoBehaviour 共 13 个，其中属于她的是 4 个（1 个 `FeverValidator` + 3 个技能行为）：

| 技能 GO | 关键字段（实测值） |
|---|---|
| `skchr_oblvns_1` | `_tryJoinFeverOnSkillStart 1` · `_continusCastWhenInFever 1` · `_updateAbilityCooldown 1` · `_leaveFeverWhenSkillEnd 0` · `_buffs = [oblvns_s_1[fever]（AbnormalFlag **1 = SP_RECOVER_STOPPED**）, fever_skill_cast_progress_buff]` |
| `skchr_oblvns_2` | `_tryJoinFeverOnSkillStart 1` · `_continusCastWhenInFever 0` · `_updateAbilityCooldown 0` · `_buffs` = **[`oblvns_s_2[fever_eff]`** → templateKey `oblvns_s_2[switch][in_fever]`（AbnormalFlag **24 = SKILL_NOT_ACTIVATABLE**，`durationKey "fever_duration"`）] · `_buffAfterFever` = **[`oblvns_s_2[fever]`]**；另有 **2 个 `FeverValidator` 且 `_invertResult: 1`**（= "**不在** Fever 中"才成立 ⇒ 手动开启的闸门） |
| `skchr_oblvns_3` | `_tryJoinFeverOnSkillStart 1` · `_continusCastWhenInFever 0` · `_buffs` = **[`oblvns_s_3[fever]`**（`ON_BUFF_START → TriggerAbility "FeverAura"`，`durationKey "fever_duration"`）] |

闸门节点（`buff_template_data.json` 展开，`_scratch/fever/inspect_gates.mjs`）：

- `oblvns_s_2[switch]` → `IfConditions [_conditionsNode: [IsFeverFull, IsInFever]]` → `TryActiveFeverIfFull` / `SwitchMode`
  ⇒ **量表满时开技能只触发 Fever，不做音色切换**（PRTS 备注原话："可以触发Fever时，触发技能将仅触发Fever"）。
- `oblvns_s_3[switch_mode]` → `IfConditions [IsInFever, IsFeverFull]` → `CreateBuff` / `SwitchMode`。
- `oblvns_s_2[fever]`（Fever 结束后挂）→ `TriggerBuffsByKeys(oblvns_s_2[switch])`。

⇒ **她的 S2 二连击闸门与 S3 免死闸门只依赖 `inFever` 这个布尔**，不依赖 0/1/5 档位；档位只影响 BGM。

## 4. 仍然读不到的（残差，诚实清单）

1. **C# 方法体**（硬天花板）：`FeverSystemManager.OnTick / _DropFever / _UpdateFeverStep / AddFeverIfNotFull / TryActiveFever`、
   `FeverBehaviour._JoinFever / _LeaveFever / _CheckJoinFeverOrTickUseSkill` 的**实现**。可观测行为已由 PRTS 描述覆盖（§2），
   但"清零发生在哪一帧""join 的精确判定"只能按 PRTS 语义实现。
2. **`AddFeverBySourceIfNotFull` 没有数值字段**（只有 `_sourceType` / `_feverKey`），且基类 `ActionNode` **没有任何字段**
   （`dump.cs:554532`）⇒ +N 只能是**运行时从黑板读**（`cnt` 完美吻合 1/2/3 三档）或**内联在 C# 里**。两种情况下值都是 3（精英2）。
3. **活动 45 期的关卡场景（Unity AB）拿不到**：本地客户端 `StreamingAssets\AB\Windows\scenes\activities\` 里
   **没有 `act45side`**（只有它的 `audio/sound_beta_2/music/act45side/*` 与 `raw/video/act45side/`，以及家具 `furni_act45d4`）；
   `hot_update_list.json`（`PersistentData/Bundles`，versionId `26-06-23-12-11-53_eec0f9`）里 abInfos 也**没有** act45side 关卡；
   镜像只镜像 gamedata（`ArknightsAssets/ArknightsAssets` 只有 `hot_update_list.json` + gamedata，没有 bundles）。
   ⇒ 无法 100% 排除"某张关卡场景给 `fever_mid/fever_full` 事件挂了 `EnvActionToGlobal`"。
   **反证**：(a) IL2CPP 里 Fever 的 `EnvEventExecutor` 只有 `EnvFeverDuckingMusic` 一个；(b) PRTS 的 Fever 词条把
   全部效果列尽了，没有第三条；(c) 镜像的 `act45side` 关卡 JSON 里 17 张图**全部只引用 `env_034_act45side_light`**（`runes → env_system_new`），
   一个 `fever` 字样都没有 —— 说明 Fever 环境系统是由**场景**挂载、且不在关卡 JSON 里配规则。
4. `env_033_fever` 出现在**哪些关卡**：同样因为缺场景而未知（不过对她的实现无影响）。

## 5. 实现规格（写 kit 时照这个来）

### 5.1 可以直接照着实现（有权威数值）

| # | 内容 | 依据 |
|---|---|---|
| F1 | 战斗级共享量表：`collected ∈ [0, 450]`，丰川祥子**每次造成伤害** `+= talents[1].bb.cnt`（精英2 = 3，精英1 = 2），**不衰减**，整场保留 | §1 / §2 |
| F2 | `full = collected >= 450`；`inFever` + `remaining = 20 s`；**触发时 `collected = 0`**（"耗尽"） | §1 / §2 |
| F3 | 触发条件：量表已满 **且** 一位成员**手动开启技能**时 → 进入 Fever（而不是开那个技能）| §2 + `TryActiveFeverIfFull` |
| F4 | Fever 期间：**SP 回复停止**、技能**无法手动开启**（`AbnormalFlag 1 / 24`），并持续尝试施放当前技能且**不消耗 SP**；Fever 结束时强制结束由 Fever 开启的持续类技能 | §2 + §3 |
| F5 | S2 二连击闸门 = `inFever` | §3 |
| F6 | S3 免死闸门 = `inFever`：致命伤害不撤退，**Fever 结束/自身退场时退场** | §3 + PRTS 技能备注 |
| F7 | 天赋 2 的攻速光环 +12 与射程延伸（射程延伸在本赛季的名单下是空转） | 已在 `data/freePicks.json` 的 bb 里 |

### 5.2 已知但**本仓库无从体现**（写成注释 / 留 TODO，不要伪造）

| # | 内容 | 为什么不做 |
|---|---|---|
| N1 | `fever_mid` / `fever_full` 的 **BGM 切换**（inst. / Vocal.） | 本 sim 没有 BGM ducking / bank 概念；且它是**唯一**的档位效果 |
| N2 | HUD 量表（`HudPlugins/char_fever_prepare_slider`，只对 `mujica` 成员显示） | 需要客户端 HUD 插件系统；数值上界就是 450，无独立数据 |
| N3 | `fever_full`（5 名不同名成员） | 本赛季名册里**只有祥子一名 Ave Mujica 成员**（另 4 位是 TIER_5，不进自选名单）⇒ 档位恒为 0 或 1，`fever_full` **不可达** |
| N4 | "全队无视 SP 限制持续开技能"的**团队**部分 | 同上，没有第二名成员可受影响；对她自己则由 F4 覆盖 |
| N5 | `_maxPlayingTime 22.0` 与 `feverDuration 20` 的 2 秒差 | 那是 BGM 片段长度，不是玩法时长 |

### 5.3 建议的最简做法

**在 `server/sim/content/kits/freePicks.js` 的 kit 内做一个战斗级小状态**，不改引擎、不改协议、不改数据管道：

- 状态用 `WeakMap<battle, {collected, inFever, until}>`（本仓库现有惯例，如 `content/bosses.js:145`、`devices.js:51`）；
  也可以挂 `unit.mem`，但量表是**全队共享**的，用 battle 键更贴官方语义。
- 累计伤害用现成的 `battle.on('attack', ctx => …)`（`ctx.attacker` / `ctx.targets`；`professions.js:48` 就是范例），
  按 `ctx.targets.length` 每次伤害 +`cnt` —— 官方节点是 `ON_OUTPUT_DAMAGE`（每次伤害前），普通攻击打 N 个目标就是 N 次。
- 触发点：S2/S3 的手动开启路径上检查 `full && !inFever` → 改为进入 Fever。**S2 的"该开着技能时不开、改为触发 Fever"要显式写**（对应 `TryActiveFeverIfFull`）。
- S2 的二连击 / S3 的免死都只读 `inFever`；S3 免死用现成的 `battle.on('fatal', …)` 守卫（`kits/freePicks.js:449`、`items/battle.js:22` 是范例），并在 Fever 结束时对"靠免死活着"的单位执行退场。
- 三个常量（`450` / `20 s` / `cnt`）**写成带出处的注释**：`450/20` 来自 `gamedata_const.json → feverGameData`，
  `cnt` 直接读 `unit.profile.talents[1].bb.cnt`（`data/freePicks.json` 已经有 3）。
- **可选（数据管道）**：`tools/build-data.mjs:291-298` 目前**没有**加载 `excel/gamedata_const.json`（该文件在
  `:43` 用的同一个 Kengxxiao 镜像里就有）。若要把 450/20 做成数据驱动而不是硬编码，加一行 `loadGamedata('excel/gamedata_const.json')` 即可 ——
  但**本次不改**（只读）。

**不要做**：不要把 `fever_mid/fever_full` 编成玩法增益（没有这种效果）；不要给档位编阈值（阈值 0/1/5 是**成员数**，已在 §1 记录）。

---

**一句话给实现者**：Fever = 一个上限 **450**、**不衰减**、全队共享的量表；造成伤害 `+cnt`（精英2 = **3**）；
满了以后**手动开技能**改为进入 **20 秒** Fever，期间禁手动开技能/停回 SP/持续施放；`inFever` 驱动她的 S2 二连击与 S3 免死；
`fever_mid/fever_full` **只是 BGM**，5 人档本赛季不可达。
