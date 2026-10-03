// tools/talent-plan.mjs — generate (or verify) docs/research/15-generic-talents.json: which declared talent of every
// 自选干员 record the generic kit translator expresses, which it only half-expresses, and which it cannot express at all.
//
//   node tools/talent-plan.mjs            # write the file (+ print the summary)
//   node tools/talent-plan.mjs --check    # exit 1 when the committed file is stale (test/content/generic_talents.test.js)
//
// Everything is MEASURED: the installs come from a real battle per record (test/helpers/battleHarness.js makeBattle,
// the audit's own method), and the plan comes from the shipping translator (server/sim/content/genericTalents.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { translateTalents } = await imp('server/sim/content/genericTalents.js');
const content = await imp('server/sim/content/index.js');
const { makeBattle } = await imp('test/helpers/battleHarness.js');
const { DataSource, getDefaultSource } = await imp('server/sim/simdata.js');
const CHESS = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const FREE = JSON.parse(readFileSync(join(ROOT, 'data/freePicks.json'), 'utf8'));
const DS = new DataSource({ chess: CHESS, freePicks: FREE }, getDefaultSource());
const OUT = join(ROOT, 'docs/research/15-generic-talents.json');
/** The date the table below was last verified against the data (a research note keeps a fixed stamp: determinism). */
const CHECKED_AT = '2026-10-04';


const REASONS = {
  'no kit-DSL form': 'the sim has no mod / hook for this mechanic (summon counts, roster & deploy-cost rules, damage-form or element riders, status talents, threshold stacks, per-skill "技能期间" talents, …)',
};

function kitKind(id) {
  const f = content.KITS[id] ?? content.KITS[String(id).replace(/_[ab]$/, '')];
  if (typeof f !== 'function') return 'generic';
  return /^chess_free_char_60[1-6]_/.test(id) ? 'wrapper(genericKit + the kit installs the talent itself)' : 'hand-authored';
}

const records = [];
/** Build the whole research document (pure: reads the data + a real battle per record, writes nothing). */
export function buildDoc() {
  records.length = 0;
  for (const [id, rec] of Object.entries(FREE)) {
    const h = makeBattle({ seed: 1, autoFinish: false, timeLimit: 1, content: 'full', units: [{ chessId: id, row: 10, col: 4 }], enemies: [] });
    h.step();
    const u = h.unit(id);
    const installed = (u && u.kit && u.kit.talents) || [];
    const plan = (u && u.kit && u.kit.talentPlan) || translateTalents(DS.getChess(id, {}), rec).report;
    const talents = plan.map((t) => {
      const src = (rec.talents ?? []).find((x) => (x.name ?? null) === t.name);
      const out = { index: t.index, name: t.name, keys: t.keys, status: t.status, rule: t.rule };
      if (t.status === 'unexpressed') { out.bb = src?.bb ?? {}; out.desc = src?.desc ?? ''; out.reason = t.reason; }
      if (t.drops?.length) out.drops = t.drops;
      if (t.reason && t.status !== 'unexpressed') out.note = t.reason;
      return out;
    });
    records.push({
      chessId: id, name: rec.name, kit: kitKind(id),
      declared: talents.length, installed: installed.length,
      installedBy: installed.map((f) => f.talentName ?? '(kit)'),
      talents,
    });
  }
  return doc();
}

function doc() {
const sum = (a, k) => a.reduce((x, r) => x + r[k], 0);
const generic = records.filter((r) => r.kit === 'generic');
const tally = {};
for (const r of records) for (const t of r.talents) tally[t.status] = (tally[t.status] ?? 0) + 1;
const out = {
  source: 'server/sim/content/genericTalents.js (the talent half of the generic kit) — measured by a real makeBattle battle per record, the audit method of D:\\projects\\_scratch\\sp-audit',
  checkedAt: CHECKED_AT,
  how: {
    choke_point: 'server/sim/content/generic.js genericKit() used to return talents: [] and Battle.js installs u.kit.talents only, so a kit-less record (76 of the 93 自选干员 records, plus 火陈 / 望 whose kits author a skill but no talent) fought without any declared talent, and the module talentChanges the resolved def already carries were dead with them.',
    blackboard: 'def.talents[i].bb of the COMPOSED record (def.raw): shared/loadoutRecord.js composeTalents folds a module\'s talentChanges into the base talents by talentIndex, so the module numbers are already in the bb the translator reads.',
    install: 'each expressed talent becomes a Kit talent hook { install(battle, unit) } (docs/SIM.md §7.2); nothing is guessed — a talent whose blackboard or wording the rules do not cover is reported here and left uninstalled.',
    drops: 'status: installed (fully) | partial (the listed `drops` are NOT expressed) | unexpressed (nothing is) | installed-by-kit (the record\'s hand-authored wrapper kit installs it itself)',
    rules: {
      selfStat: 'unconditional self stat keys → a persistent stat buff (atk/def/max_hp/attack_speed/base_attack_time/magic_resistance/block_cnt/taunt_level/damage_resistance/damage_scale/heal_scale/sp_recovery_per_sec/hp_recovery_per_sec(_by_max_hp_ratio)/magic_resist_penetrate_fixed/def_penetrate_fixed/def_penetrate_ratio/magic_resist_penetrate_ratio/move_speed; `prob` when the text says 闪避)',
      selfStatHpBelow: '"生命值低于 X% 时…" + the namespaced `ns[tag].<statKey>` extra → base stats always, the extra while hpRatio < X',
      selfStatIdle: '"未进行攻击 / 没有主动攻击 N 秒" + `delay` → toggleBuff on idle time',
      selfStatUnblocked: '"未阻挡敌人时" → toggleBuff while nothing is blocked',
      selfStatBlocking: '"阻挡时 / 阻挡敌人时" → toggleBuff while blocking',
      auraProfession: '"所有(友方)【X】(职业)干员…" → an aura over the owner\'s allies of that profession',
      auraRange: '"攻击范围内的友方(军)…" → an aura over the allies inside the owner\'s own range',
      attackProc: '"攻击时…概率攻击力提升至 M%" (`atk_scale`, optional `prob`) → a mutable hit multiplier',
      attackProcRider: 'the same + `def`/`defdown_duration` → also a def-down buff on the target',
      attackAddHit: '"攻击额外造成攻击力 M% 的 X 伤害" → an extra damage instance of its own',
      attackVsLowHp: '"攻击生命(值)低于 X% 的敌人时攻击力提升至 M%" → a hit multiplier under the target-HP condition',
      blockedEnemyDebuff: '"自身阻挡的敌人攻击速度-N" → a repeating aspd debuff on the blocked enemies',
      deployStun: 'deployment flash: plain `stun` + "部署后立即对攻击范围内…晕眩 N 秒"',
      deploySp: '"部署后立即获得 N 点技力" (`sp`)',
      deploySpRandom: '`sp_min`/`sp_max` → a random SP gift on deployment (max exclusive: 7~15 of {7, 16})',
      deployCost: '`runtime_cost` → `base.cost` (docs in the rule: the sim\'s initial deployment pays no DP, so the discount reaches the engine as a cheaper redeploy)',
      intervalSp: '`interval` + `sp` ("每 N 秒回复…技力") → a repeating SP gift',
      onHurtSp: '"受到攻击时，有 N% 几率回复 M 点技力"',
      nearbyKillSp: '"周围四格内有敌人倒下时获得 N 点技力"',
      fieldTimer: '"在战场停留 N 秒后…" + stat keys → a one-shot stat buff after N seconds on the field',
    },
  },
  summary: {
    picks: {
      records: records.length,
      declared: sum(records, 'declared'),
      installed: sum(records, 'installed'),
      byStatus: tally,
      generic_kit_records: { records: generic.length, declared: sum(generic, 'declared'), installed: sum(generic, 'installed'), records_with_installs: generic.filter((r) => r.installed > 0).length },
      note: '火陈 chess_free_char_1050_chen3 and 望 chess_free_char_2027_wang have hand-authored kits (kits/freePicks.js) that author a skill but no talent: the translator does not run for them (their kit wins), so their 4 declared talents are still uninstalled — that file is owned by another agent.',
    },
    season: {
      note: 'no season record uses the generic kit except the 8 unused DIY templates (no talents, stats null, filtered out of every pool), so the season is untouched by construction.',
    },
    unexpressible_classes: REASONS,
  },
  records,
};
return out;
}

// ---------------------------------------------------------------------------------------------------------------
// CLI (imported by test/content/generic_talents.test.js, which calls buildDoc() instead)
const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  const built = buildDoc();
  const text = JSON.stringify(built, null, 1);
  if (process.argv.includes('--check')) {
    const cur = readFileSync(OUT, 'utf8');
    if (cur !== text) {
      console.error('docs/research/15-generic-talents.json is STALE — run: node tools/talent-plan.mjs');
      process.exit(1);
    }
    console.log('docs/research/15-generic-talents.json is up to date');
  } else {
    writeFileSync(OUT, text);
    console.log('wrote docs/research/15-generic-talents.json');
  }
  const p = built.summary.picks;
  console.log('picks:', JSON.stringify(p.byStatus), '| declared', p.declared, '| installed', p.installed,
    '| generic-kit records', p.generic_kit_records.records,
    '(declared', p.generic_kit_records.declared, '→ installed', p.generic_kit_records.installed, ')');
}
