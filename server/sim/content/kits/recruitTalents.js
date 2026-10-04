// Talents a ported PR #71 kit implements INSIDE its own `install()` — the merge guard between the 78 自选干员 kits of
// PR #71 by SrC2O4 (增加六星自选功能 <https://github.com/sganggs/Stronghold-Protocol/pull/71>, head c76a81f) and this
// project's generic talent translator (server/sim/content/genericTalents.js).
//
// WHY THIS TABLE EXISTS (measured, not guessed). The ported kits author a skill (and a trait / an install) but carry no
// `talents` key, so `content/index.js withGenericTalents` merges the translator's installs into them — otherwise the
// records would lose the talent installs they have today. But a ported kit that READS a talent's blackboard generally
// IMPLEMENTS that talent itself, and then the translator's install of the same talent is a SECOND one:
//   * our own test/content/generic_talents.test.js caught two of them the first time the merge ran unguarded —
//     艾雅法拉 炎息 landed as +44 % ATK on every 【术师】 (the kit's +22 % aura and the translator's +22 % aura) and
//     灰烬 突击手 gifted 17 SP twice (spCost 25 ⇒ a full bar instead of 17).
// Reviewing all 27 installs the translator produces for the 76 records a ported kit serves, ALL 27 are implemented by
// that kit's own body once the one gap below is closed (verified key by key against the kit source — 陈 呵斥 even
// honours the 攻击/受击 SP-type filter and self extra the translator cannot express, 黑 破甲箭头 keeps 黑's S3 crit
// variant). They are listed below: the translator still RUNS and still REPORTS them, but as `installed-by-kit` (the
// mechanism genericTalents.js already uses for its WRAPPER_KITS), and its duplicate install is dropped.
// The one gap: 灰烬 突击手 `{runtime_cost: -5, sp: 17}` was only HALF implemented by the ported kit (the SP gift; the
// kit never touched `base.cost`). Our modification (GPL §5) completes the kit instead of keeping the translator's
// install: kits/recruitsTactics.js `ash` gained the `runtime_cost` half of that translator's deployCost rule (one
// `battleStart` line, credited in place), so the kit now implements the whole talent and it is listed below like the
// other 26. Without that line, merging the translator's install would gift the 17 SP twice.
// test/content/generic_talents.test.js 灰烬 pins both halves.
//
// The list also carries char_1050_chen3 (火陈): that record is served by OUR kit (kits/freePicks.js, whose key is tried
// first), which authors its own two talents, so the table entry is only documentation — the wrapper never sees it.

/**
 * `charId` → the talent indices (of the record's own `talents[]` / `def.talents`) that the ported kit implements itself.
 * `content/index.js withGenericTalents` drops the translator's install for these and reports them as `installed-by-kit`.
 */
export const KIT_TALENTS = Object.freeze({
  char_010_chen: [0, 1],      // 陈 呵斥 / 持刀格斗术
  char_1029_yato2: [0],       // 麒麟R夜刀 双雷剑麒麟
  char_1050_chen3: [0],       // 赤刃明霄陈 形意洞照 (our kits/freePicks.js wins the lookup for this record — see there)
  char_112_siege: [0, 1],     // 推进之王 万兽之王 / 粉碎
  char_113_cqbw: [0],         // W 设伏
  char_134_ifrit: [1],        // 伊芙利特 莱茵回路
  char_147_shining: [0, 1],   // 闪灵 黑恶魔的庇护 / 法典
  char_179_cgbird: [0],       // 夜莺 白恶魔的庇护
  char_180_amgoat: [0, 1],    // 艾雅法拉 炎息 / 乱火
  char_188_helage: [1],       // 赫拉格 运筹帷幄
  char_2014_nian: [0],        // 年 积甲成山
  char_225_haak: [1],         // 阿 药剂扩散
  char_293_thorns: [1],       // 棘刺 故土潮声
  char_340_shwaz: [0, 1],     // 黑 破甲箭头 / 交叉火力
  char_377_gdglow: [1],       // 澄闪 精准导流
  char_4011_lessng: [0],      // 止颂 苦痛专注
  char_4080_lin: [1],         // 林 韬光
  char_4123_ela: [1],         // 艾拉 “正中靶心” (the kit's `ela` branch of the shared trapKit reads `z.prob`/`z.atk_scale`)
  char_416_zumama: [1],       // 森蚺 愈战愈勇
  char_4229_aphris: [1],      // 谬因 取样优化
  char_450_necras: [1],       // 死芒 回光黯淡
  char_456_ash: [0, 1],       // 灰烬 辅助装备 (kit's flash) / 突击手 (kit's 17 SP + our runtime_cost line)
});

/** The `reason` the research note prints for a talent the ported kit implements itself. */
export const KIT_TALENT_NOTE = 'the ported PR #71 kit (kits/recruits*.js) implements this talent inside its own install — the translator reports it instead of installing it a second time (kits/recruitTalents.js)';
