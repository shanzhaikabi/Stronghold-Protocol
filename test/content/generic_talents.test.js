// Content tests for the TALENT half of the generic kit (server/sim/content/genericTalents.js) — the fix for the
// 2026-10-03 audit's G1/G2: 78 of the 93 自选干员 fought with none of their declared talents because `genericKit`
// returned `talents: []` and `Battle.js` installs `u.kit.talents` only.
//
// The evidence is runtime: a real battle per record (test/helpers/battleHarness.js `makeBattle`, `content/index.js`
// KITS, `simdata.js` DataSource), the audit's own method. The named numbers (灰烬 `stun:4` / `sp:17` / `runtime_cost:-5`,
// 黑 `atk_scale 1.6` / `def -0.2` / `prob 0.2`, 艾雅法拉 `atk 0.22` / `sp_min 7` / `sp_max 16`) come from the records'
// own blackboards, never from a literal copied out of the kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants, hashOf } from '../helpers/battleHarness.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { KITS } from '../../server/sim/content/index.js';
import { translateTalents, translateTalent, declaredTalents, WRAPPER_KITS } from '../../server/sim/content/genericTalents.js';
import { buildDoc } from '../../tools/talent-plan.mjs';

const FREE = JSON.parse(readFileSync(new URL('../../data/freePicks.json', import.meta.url), 'utf8'));
const CHESS = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
const ds = new DataSource({ chess: CHESS, freePicks: FREE }, getDefaultSource());
const D = (id) => ds.getChess(id, {});
const REC = (id) => FREE[id] ?? CHESS[id];
/** The declared talent of a record by name (the audit's filter: no hidden / index −1 placeholder). */
const talent = (id, name) => (REC(id).talents ?? []).find((t) => t.name === name && !t.hidden && t.index !== -1);
/** A battle with one operator of `id` on the board, no enemies (the audit's harness call). */
function solo(id, o = {}) {
  return makeBattle({
    seed: o.seed ?? 1, autoFinish: false, timeLimit: o.timeLimit ?? 60, content: 'full',
    units: [{ chessId: id, row: o.row ?? 10, col: o.col ?? 4, ...(o.unit || {}) }],
    enemies: o.enemies ?? [],
    defs: o.defs,
    flags: { startOpCooldown: 0, ...(o.flags || {}) },
    captureNoisy: o.captureNoisy,
    hooks: o.hooks,
  });
}
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
const approx = (a, b, msg = '', rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg}: ${a} ≈ ${b}`);

// The 76 records that resolve to the GENERIC kit (no KITS entry) — the class the audit measured as "152 declared
// talents, 0 installed". Pinned so a change in either direction has to be deliberate.
const KITLESS = Object.keys(FREE).filter((id) => typeof KITS[id] !== 'function' && !WRAPPER_KITS.has(id));

// =================================================================================================================
// the choke point

test('genericTalents: every kit-less 自选干员 talent is either installed or explicitly reported (never dropped)', () => {
  let declared = 0, installed = 0, records = 0;
  for (const id of KITLESS) {
    const def = D(id);
    const { installs, report } = translateTalents(def, REC(id));
    const declaredList = declaredTalents(def, REC(id));
    assert.equal(report.length, declaredList.length, `${id}: one report row per declared talent`);
    for (const r of report) {
      if (r.status === 'unexpressed') assert.ok(r.reason, `${id}/${r.name}: an unexpressed talent says why`);
      else assert.ok(installs.some((i) => i.talentName === r.name), `${id}/${r.name}: installed ⇒ an install hook`);
    }
    declared += report.length;
    installed += installs.length;
    if (installs.length) records++;
  }
  assert.equal(KITLESS.length, 76, 'the kit-less class of the audit');
  assert.equal(declared, 152, 'the 152 talents the audit measured as lost');
  assert.equal(installed, 27, 'installed by the translator (the rest is in docs/research/15-generic-talents.json)');
  assert.equal(records, 21, 'records that now fight with at least one declared talent (was 0)');
});

test('genericTalents: a real battle installs them (the audit baseline was 24 talents on 15/93 picks)', () => {
  let pickInstalled = 0, pickRecords = 0, zero = 0;
  for (const [id, rec] of Object.entries(FREE)) {
    const h = solo(id, { timeLimit: 1, enemies: [] });
    h.step();
    const u = h.unit(id);
    assert.ok(u, `${id}: the unit is on the field`);
    const n = (u.kit.talents || []).length;
    pickInstalled += n;
    if (n) pickRecords++;
    const declared = (rec.talents ?? []).filter((t) => t && !t.hidden && t.index !== -1).length;
    if (declared && !n) zero++;
    done(h);
  }
  assert.equal(pickInstalled, 51, 'picks: installed talents (24 before the change, 180 declared)');
  assert.equal(pickRecords, 36, 'picks with ≥1 installed talent (15 before the change)');
  assert.equal(zero, 57, 'picks that declare talents and still install none (78 before the change)');
});

test('genericTalents: the six 4★ 预备干员 keep exactly their one wrapper talent (no double install)', () => {
  // the list also carries `char_605_cmedic` (the band map character of tokens.js reserveMedicKit, a different record
  // id — its +4 % ATK is pinned by test/content/tokens_devices.test.js)
  for (const id of [...WRAPPER_KITS].filter((x) => FREE[x])) {
    const def = D(id);
    assert.equal(translateTalents(def, REC(id)).installs.length, 0, `${id}: the translator defers to the wrapper kit`);
    const h = solo(id, { timeLimit: 1 });
    h.step();
    const u = h.unit(id);
    assert.equal(u.kit.talents.length, 1, `${id}: exactly one talent hook`);
    done(h);
  }
});

// =================================================================================================================
// the three hand-authored records the audit named, with their own numbers

test('灰烬: 辅助装备 `stun` and 突击手 `sp`/`runtime_cost` — the numbers from the record', () => {
  const ASH = 'chess_free_char_456_ash';
  const flash = talent(ASH, '辅助装备'), assault = talent(ASH, '突击手');
  assert.deepEqual(flash.bb, { stun: 4 });
  assert.deepEqual(assault.bb, { runtime_cost: -5, sp: 17 });

  // 辅助装备: "部署后立即对攻击范围内一个敌人投掷闪光弹，使其和周围敌人晕眩 N 秒"
  const still = () => enemyRec({ key: 'e_still', hp: 1e7, speed: 0, atk: 0 });
  const h = solo(ASH, { defs: { chess: { [ASH]: FREE[ASH] }, enemies: { e_still: still() } }, hooks: ['deploy', 'statusApplied'] });
  h.step();
  const u = h.unit(ASH);
  const e = h.spawn('e_still', { pos: [10, 6] });          // inside the sniper's range, in front of her
  assert.ok(e, 'the enemy spawned');
  h.b.retreat(u);
  assert.ok(h.b.redeploy(u, { free: true }), 'the unit is redeployed (a `deploy` event)');
  const stuns = h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.target === e);
  assert.equal(stuns.length, 1, 'the flash stuns the enemy in range on deployment');
  assert.equal(stuns[0].duration, flash.bb.stun, 'for the blackboard seconds');
  done(h);

  // 突击手: the SP half is a real deploy gift; the runtime_cost half reaches `base.cost` (documented reading)
  const h2 = solo(ASH, { timeLimit: 1 });
  h2.step();
  const u2 = h2.unit(ASH);
  const base = REC(ASH).stats.cost;
  assert.equal(u2.base.cost, base + assault.bb.runtime_cost, `首次部署时部署费用${assault.bb.runtime_cost}`);
  // one engine tick of natural SP recovery rides along (spType INCREASE_WITH_TIME): the gift is the blackboard value
  approx(u2.skill.sp, assault.bb.sp, '部署后立即获得17技力 (spCost 25 > 17)', 0.01);
  done(h2);
});

test('黑: 破甲箭头 `atk_scale` / `def` / `prob` / `defdown_duration` — the numbers from the record', () => {
  const SHAW = 'chess_free_char_340_shwaz';
  const t = talent(SHAW, '破甲箭头');
  assert.deepEqual(t.bb, { atk_scale: 1.6, def: -0.2, prob: 0.2, defdown_duration: 5 });
  const build = (hit) => {
    const h = solo(SHAW, {
      defs: { chess: { [SHAW]: FREE[SHAW] }, enemies: { e_still: enemyRec({ key: 'e_still', hp: 1e7, speed: 0, atk: 0 }) } },
      hooks: ['hit', 'damaged'], captureNoisy: true,
    });
    h.step();
    h.b.rng.chance = (p) => { assert.ok(p > 0 && p <= 1, 'a probability roll'); return hit; };
    const u = h.unit(SHAW);
    const e = h.spawn('e_still', { pos: [10, 6] });
    h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.dmg?.isAttack), 10);
    return { h, u, e };
  };
  const on = build(true);
  const hit = on.h.hooksOf('hit').filter((c) => c.source === on.u && c.dmg?.isAttack).pop();
  assert.ok(hit, 'the attack landed');
  approx(hit.dmg.mul, t.bb.atk_scale, '攻击力提升至160%');
  const down = (on.e.buffs || []).find((b) => b.mods && b.mods.defPct === t.bb.def);
  assert.ok(down, '命中的目标防御力下降20%');
  assert.equal(down.duration, t.bb.defdown_duration, '持续5秒');
  done(on.h);

  const off = build(false);
  const miss = off.h.hooksOf('hit').filter((c) => c.source === off.u && c.dmg?.isAttack).pop();
  assert.equal(miss.dmg.mul, 1, '概率未触发时不加成');
  assert.equal((off.e.buffs || []).some((b) => b.mods && b.mods.defPct === t.bb.def), false, '也不破甲');
  done(off.h);
});

test('艾雅法拉: 炎息 `atk` (all 【术师】) and 乱火 `sp_min`/`sp_max` — the numbers from the record', () => {
  const GOAT = 'chess_free_char_180_amgoat';
  const fire = talent(GOAT, '炎息'), wildfire = talent(GOAT, '乱火');
  assert.deepEqual(fire.bb, { atk: 0.22 });
  assert.deepEqual(wildfire.bb, { sp_min: 7, sp_max: 16 });
  assert.equal(D(GOAT).profession, 'CASTER', '炎息 covers herself');

  // 炎息: the aura lands on every 【术师】 operator of the owner — herself included
  const h = solo(GOAT, { timeLimit: 1 });
  h.step(); h.run(0.6);
  const u = h.unit(GOAT);
  approx(u.s.atk, u.base.atk * (1 + fire.bb.atk), '所有友方【术师】职业干员的攻击力+22%');
  done(h);

  // 乱火: "部署后立即随机获得 7~15 点技力" — `sp_max` is EXCLUSIVE, so the roll is [sp_min, sp_max)
  const seen = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const hh = solo(GOAT, { seed, timeLimit: 1 });
    hh.step();
    const uu = hh.unit(GOAT);
    const gained = uu.skill.sp - D(GOAT).skill.initSp;
    assert.ok(gained >= wildfire.bb.sp_min && gained < wildfire.bb.sp_max, `seed ${seed}: ${gained} ∈ [7, 16)`);
    seen.add(gained);
    done(hh);
  }
  assert.ok(seen.size > 1, 'the gift is random, not a constant');
});

// =================================================================================================================
// the season must not move

test('season: 258/258 non-DIY records still resolve to a hand-authored kit and install the same talent hooks', () => {
  let installed = 0, generic = [], cases = 0;
  for (const [id, rec] of Object.entries(CHESS)) {
    const h = solo(id, { timeLimit: 1, defs: { chess: CHESS } });
    h.step();
    const u = h.unit(id);
    if (rec.isDiy) { assert.equal((u.kit.talents || []).length, 0, `${id}: a DIY template declares no talent`); done(h); continue; }
    // the elite `_b` shares the base `_a` kit key (content/index.js setupUnitKit resolves via def.baseId)
    const key = KITS[id] ?? KITS[D(id).baseId];
    assert.equal(typeof key, 'function', `${id}: a hand-authored kit`);
    assert.equal(!!u.kit.generic, false, `${id}: never the generic fallback`);
    if (u.kit.generic) generic.push(id);
    installed += (u.kit.talents || []).length;
    cases++;
    done(h);
  }
  assert.equal(cases, 258, 'the 258 real season records of the audit');
  assert.deepEqual(generic, [], 'no season record falls back to the generic kit');
  assert.equal(installed, 389, 'the season talent-hook total measured before the change');
});

// =================================================================================================================
// determinism, the mapping table, and the research note

test('genericTalents: the translation is deterministic and serialisable', () => {
  const digest = () => Object.entries(FREE).map(([id, rec]) => translateTalents(D(id), rec).report);
  const a = digest(), b = digest();
  assert.equal(hashOf(a), hashOf(b), 'two runs agree');
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'byte-identical plans');
  const kit = (id) => {
    const h = solo(id, { timeLimit: 1 });
    h.step();
    return (h.unit(id).kit.talents || []).map((t) => `${t.talentName}#${t.talentRule}#${JSON.stringify(t.talentDrops)}`);
  };
  const one = KITLESS.map(kit), two = KITLESS.map(kit);
  assert.deepEqual(one, two, 'the runtime install list is deterministic (talent names, rules and drops)');
});

test('genericTalents: `def_penetrate_ratio` / `magic_resist_penetrate_ratio` map onto the DSL mods', () => {
  const bb = { def_penetrate_ratio: 0.3, magic_resist_penetrate_ratio: 0.15 };
  const out = translateTalent({ index: 0, name: 'synthetic', desc: '无视敌人30%的防御力和15%的法术抗性', bb }, { chessId: 'synthetic', bat: 1 });
  assert.ok(out && out.mods, 'expressed as a self stat talent');
  assert.equal(out.mods.defIgnorePct, 0.3);
  assert.equal(out.mods.resIgnorePct, 0.15);
  // the same shape with a probe key is refused instead of half-installed
  const bad = translateTalent({ index: 0, name: 'synthetic', desc: '无视敌人30%的防御力', bb: { def_penetrate_ratio: 0.3, mystery_key: 1 } }, { chessId: 'synthetic', bat: 1 });
  assert.equal(bad, null, 'an unknown key makes the talent unexpressed');
});

test('docs/research/15-generic-talents.json matches the shipping translator (node tools/talent-plan.mjs)', () => {
  const committed = JSON.parse(readFileSync(new URL('../../docs/research/15-generic-talents.json', import.meta.url), 'utf8'));
  const live = buildDoc();
  assert.deepEqual(committed, live, 'the research note is generated — regenerate it with node tools/talent-plan.mjs');
  assert.equal(committed.records.length, 93, 'one row per 自选干员 record');
  const unexpressed = committed.records.flatMap((r) => r.talents).filter((t) => t.status === 'unexpressed');
  assert.equal(unexpressed.length, 139, 'each lists its record, name, blackboard and why it is not expressed');
  for (const t of unexpressed) assert.ok(t.reason && t.desc !== undefined, `${t.name}: reason + description`);
  for (const r of committed.records) {
    for (const t of r.talents) {
      if (t.status !== 'installed') continue;
      assert.equal(t.drops, undefined, `${r.chessId}/${t.name}: a fully installed row drops nothing`);
    }
  }
});
