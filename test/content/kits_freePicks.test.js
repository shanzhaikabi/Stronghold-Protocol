// Content tests for the 自选干员 (自由位置, data/freePicks.json) kits of server/sim/content/kits/freePicks.js.
//
// The nine 6★ 原型干员 of the season, one test per skill: a real battle through the harness (test/helpers/battleHarness)
// with the record itself as the chess def, and the signature numbers of the official description (PRTS
// `<名>(卫戍协议)`) asserted — +6 DP, 8 slashes of 155 %, DEF set to 0, 210 % ATK … never "something happened".
// A resolution test proves every one of the 25 skills gets a hand-authored spec (`skillSpecSource`, and the runtime
// `unit.kit.skillSource` of a battle) instead of the generic fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants, flatStage } from '../helpers/battleHarness.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { KITS, skillSpecSource } from '../../server/sim/content/index.js';
import { bodyKeys } from '../../server/sim/body.js';
import { attackRangeGrid } from '../../shared/loadoutRecord.js';

const FREE = JSON.parse(readFileSync(new URL('../../data/freePicks.json', import.meta.url), 'utf8'));
const ds = new DataSource({ chess: FREE }, getDefaultSource());
/** Resolved def of a freePick record for a skill index / module choice (moduleId omitted ⇒ the default module). */
const DM = (id, skillIndex = null, moduleId) => ds.getChess(id, {
  ...(skillIndex == null ? {} : { skillIndex }),
  ...(moduleId === undefined ? {} : { moduleId }),
});
/** Resolved def of a freePick record for a skill index. */
const D = (id, skillIndex = null) => DM(id, skillIndex);
/** The selected skill's blackboard. */
const bbOf = (id, skillIndex) => D(id, skillIndex).skill.bb;
/** ModuleRecord of a freePick record by uniEquipId. */
const modRec = (id, uniEquipId) => (FREE[id].modules || []).find((m) => m.uniEquipId === uniEquipId);

const TULIP = 'chess_free_char_608_acpion', SHARP = 'chess_free_char_609_acguad', MECH = 'chess_free_char_610_acfend';
const STORM = 'chess_free_char_611_acnipe', PITH = 'chess_free_char_612_accast', TOUCH = 'chess_free_char_613_acmedc';
const RAIDIAN = 'chess_free_char_614_acsupo', MISERY = 'chess_free_char_615_acspec', LORD = 'chess_free_char_617_sharp2';
/** 赤刃明霄陈 火陈 (S3 剑气长龙 only — her S1/S2 and both talents are still the generic / no-talent path). */
const CHEN = 'chess_free_char_1050_chen3';
/** 望 (SPECIAL 陷阱师, the 棋子 summoner — `tokens.js wangStone`): S3 天下劫 only. */
const WANG = 'chess_free_char_2027_wang';
/** The nine operators of this batch (the six 4★ 预备干员 stay on the generic `skcom_…` skills). */
const BATCH = [TULIP, SHARP, MECH, STORM, PITH, TOUCH, RAIDIAN, MISERY, LORD];

const approx = (a, b, msg = '', rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg}: ${a} ≈ ${b}`);
const READY = { sp: 999 };
const HOOKS = ['damaged', 'heal', 'skillStart', 'skillEnd', 'attack', 'death', 'deploy', 'fatal', 'dodge', 'statusApplied', 'kill', 'spGain', 'beforeAttack'];
/** A harmless 1e7 HP target that never moves. */
const STILL = () => enemyRec({ key: 'e_still', hp: 1e7, speed: 0, atk: 0, bat: 2 });
/** A walking enemy (it reaches the operator, is blocked by it and attacks it). */
const MOB = (o = {}) => enemyRec({ key: 'e_mob', hp: 1e7, speed: 1, atk: 120, bat: 1.5, ...o });
/** A leftward route from `start` (a spawn `pos` re-bases the route start). */
const walk = (r, c) => ({ motion: 'WALK', start: [r, c], end: [r, 2], checkpoints: [] });

function battle(units, o = {}) {
  return makeBattle({
    seed: o.seed ?? 7, autoFinish: false, timeLimit: o.timeLimit ?? 200, captureNoisy: true,
    hooks: o.hooks ?? HOOKS,
    defs: { chess: { ...FREE, ...(o.chess || {}) }, enemies: { e_still: STILL(), e_mob: MOB(), ...(o.recs || {}) } },
    units, enemies: o.spawns ?? [],
    flags: { startOpCooldown: 0, dpPerSec: 0, dpInit: 0, ...(o.flags || {}) },
    ...(o.extra || {}),
  });
}
const dealt = (h, u, f = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && f(c));
const heals = (h, u, f = () => true) => h.hooksOf('heal').filter((c) => c.source === u && f(c));
const tagged = (tag) => (c) => (c.dmg?.tags || []).includes(tag);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };

// =================================================================================================================
// resolution

test('freePicks: every skill of the nine 6★ 原型干员 resolves to a hand-authored spec, never generic', () => {
  for (const id of BATCH) {
    assert.equal(typeof KITS[id], 'function', `${id}: a kit is registered`);
    const rec = FREE[id];
    assert.equal(rec.skills.filter((s) => s.isDefault).length, 1, `${id}: exactly one default skill`);
    for (const s of rec.skills) assert.equal(skillSpecSource(D(id, s.index)), 'skills', `${id} ${s.skillId}`);
    const h = battle([{ chessId: id, row: 10, col: 4 }]);
    h.step();
    const u = h.unit(id);
    assert.ok(u && u.kit && !u.kit.generic, `${id}: hand-authored kit on the unit`);
    assert.equal(u.kit.skillSource, 'skills', `${id}: the spec comes from the kit's skills map`);
    assert.ok(u.skill && !u.skill.noSkill, `${id}: a skill spec is installed`);
    done(h);
  }
});

// =================================================================================================================
// 608_acpion 郁金香

test('郁金香 S1 钻心: +6 DP and 170 % ATK phys to up to 2 blocked enemies', () => {
  const id = TULIP, b = bbOf(id, 0);
  const h = battle([{ chessId: id, row: 9, col: 4, skillIndex: 0 }], {
    spawns: [
      { key: 'e_mob', pos: [9, 8], route: walk(9, 8) },
      { key: 'e_mob', pos: [9, 7], route: walk(9, 7) },
    ],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 40), 'casts with the enemies it blocks');
  assert.equal(h.b.getPlayer('p1').dp, b.cost, '+6 部署费用');
  assert.equal(u.blocking.length, 2, 'the 尖兵 blocks its two enemies');
  const hits = dealt(h, u, tagged('skill'));
  assert.equal(hits.length, b.max_target, '至多2名敌人');
  for (const c of hits) approx(c.amount, u.s.atk * b.atk_scale, '170 % ATK phys');
  done(h);
});

test('郁金香 S2 迅瞬: ASPD +95, 25 % DEF ignore, and 6 DP granted 1 per 1.6 s', () => {
  const id = TULIP, b = bbOf(id, 1);
  const h = battle([{ chessId: id, row: 9, col: 4, skillIndex: 1, carryState: READY }], { spawns: [{ key: 'e_still', pos: [9, 5] }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5), 'casts with an enemy in range');
  approx(u.s.aspd, u.base.aspd + b.attack_speed, '攻击速度+95');
  approx(u.s.defIgnorePct, b.def_penetrate, '无视目标25%防御力');
  h.run(5);
  assert.equal(h.b.getPlayer('p1').dp, 3, '3 of the 6 DP after 5 s (1 per 1.6 s)');
  h.runUntil(() => !u.skill.active, 10);
  assert.equal(h.b.getPlayer('p1').dp, b.trig_cnt, '6 DP over the duration');
  approx(u.s.aspd, u.base.aspd, 'the mods are gone');
  done(h);
});

test('郁金香 S3 只余芬芳: +6 DP and 8 × 155 % ATK phys (50 % DEF ignore) on every enemy of the 技能范围', () => {
  const id = TULIP, b = bbOf(id, 2);
  const h = battle([{ chessId: id, row: 10, col: 4, carryState: READY }], {
    recs: { e_arm: enemyRec({ key: 'e_arm', hp: 1e7, speed: 0, atk: 0, def: 200 }) },
    spawns: [{ key: 'e_arm', pos: [10, 5] }, { key: 'e_arm', pos: [9, 5] }, { key: 'e_still', pos: [12, 9] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 5), 'the SKILL_RANGE strategy casts');
  const hits = dealt(h, u, tagged('slash'));
  assert.equal(hits.length, b.times * 2, '8 slashes on each of the 2 enemies of the x-1 技能范围');
  assert.equal(new Set(hits.map((c) => c.target.id)).size, 2, 'both enemies of the ring');
  for (const c of hits) {
    assert.equal(c.dmg.defIgnorePct, b.def_penetrate, '无视目标50%防御力');
    approx(c.amount, u.s.atk * b.atk_scale - 200 * b.def_penetrate, '155 % ATK with half of the 200 DEF ignored');
  }
  assert.equal(h.b.getPlayer('p1').dp, b.cost, '+6 费用');
  done(h);
});

test('郁金香 talent 无垠之心: +0.6 SP/s until the 2nd activation after the deployment', () => {
  const id = TULIP, t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4, carryState: READY }], { spawns: [{ key: 'e_still', pos: [9, 5] }] });
  const u = h.unit(id);
  h.step();
  approx(u.s.spRecovery, u.base.spRecovery + t[0].bb.sp_recovery_per_sec, '技力自然回复速度+0.6/秒');
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 5));
  assert.ok(u.findBuff('acpion:t1'), 'still before the 2nd activation');
  assert.ok(h.runUntil(() => u.skill.activations >= 2 && !u.skill.active, 60), 'a 2nd activation');
  assert.ok(!u.findBuff('acpion:t1'), '无垠之心 ends with the 2nd activation');
  approx(u.s.spRecovery, u.base.spRecovery, 'the SP aura is gone');
  done(h);
});

test('郁金香 talent 浪潮之心: ATK +10 % and +1 部署费用 per kill', () => {
  const id = TULIP, t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4 }], {
    recs: { e_one: enemyRec({ key: 'e_one', hp: 1, speed: 0, atk: 0 }) },
    spawns: [{ key: 'e_one', pos: [9, 5] }],
  });
  const u = h.unit(id);
  h.step();
  approx(u.s.atk, u.base.atk * (1 + t[1].bb.atk), '攻击力+10%');
  h.run(3);
  assert.equal(h.enemies().length, 0, 'the 1 HP enemy died to her attack');
  assert.equal(h.b.getPlayer('p1').dp, t[1].bb.cost, '击杀敌人时额外获得1点部署费用');
  done(h);
});

// =================================================================================================================
// 609_acguad Sharp

test('Sharp S1 快刀: ATK +25 % and a 20 % double hit per attack', () => {
  const id = SHARP, b = bbOf(id, 0), t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4, skillIndex: 0, carryState: READY }], { spawns: [{ key: 'e_still', pos: [9, 5] }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + t[0].bb.atk + b.atk), '攻击力+25% on top of 隐匿刀刃');
  h.run(28);
  const dbl = dealt(h, u, tagged('doubleHit'));
  assert.ok(dbl.length >= 1, '每次攻击有20%概率变成二连击');
  for (const c of dbl) approx(c.amount, u.base.atk * (1 + t[0].bb.atk + b.atk), 'the 2nd hit repeats the attack');
  done(h);
});

test('Sharp S2 亮剑: DEF set to 0, max HP +30 %, every attack at 160 % ATK', () => {
  const id = SHARP, b = bbOf(id, 1);
  const h = battle([{ chessId: id, row: 9, col: 4, skillIndex: 1, carryState: READY }], { spawns: [{ key: 'e_still', pos: [9, 5] }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  assert.equal(u.s.def, 0, '防御力降至0');
  approx(u.s.maxHp, u.base.maxHp * (1 + b.max_hp), '生命上限+30%');
  const hits = dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash);
  assert.ok(hits.length >= 1);
  for (const c of hits) approx(c.amount, u.s.atk * b['attack@atk_scale'], '每次攻击的攻击力提升至160%');
  done(h);
});

test('Sharp S3 力战不竭: ATK +30 %, +16 % per attack (≤ 8, reset on a target change), HP never below 1', () => {
  const id = SHARP, b = bbOf(id, 2), t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4, carryState: READY }], { spawns: [{ key: 'e_still', pos: [9, 5] }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  const at = (n) => u.base.atk * (1 + t[0].bb.atk + b.atk + b.atk_each_stack * n);
  h.run(15);
  const hits = dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash).map((c) => c.amount);
  assert.ok(hits.length >= 9, `enough attacks (${hits.length})`);
  for (let i = 0; i < b.max_atk_stack_cnt; i++) {
    approx(hits[i], at(i + 1), `attack ${i + 1}: ${i + 1} stacks`);
  }
  for (const a of hits.slice(b.max_atk_stack_cnt)) approx(a, at(b.max_atk_stack_cnt), 'the 8-stack cap');
  // the HP floor: "技能持续期间内干员的生命值始终不会低于1"
  h.b.dealDamage(null, u, { amount: 1e6, type: 'true' });
  assert.equal(u.alive, true, 'survives a lethal hit while the skill runs');
  assert.equal(u.hp, 1, 'held at 1 HP');
  assert.equal(h.hooksOf('fatal').at(-1)?.prevented, true, 'the fatal hook was prevented');
  done(h);
});

test('Sharp talents: 隐匿刀刃 ATK +15 % / 30 % physical dodge; 寸步不退 ASPD +10 after 30 s', () => {
  const id = SHARP, t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4 }], { spawns: [{ key: 'e_still', pos: [9, 6] }] });
  const u = h.unit(id);
  h.step();
  approx(u.s.atk, u.base.atk * (1 + t[0].bb.atk), '攻击力+15%');
  approx(u.s.dodgePhys, t[0].bb.prob, '获得30%的物理闪避');
  assert.ok(!u.findBuff('acguad:t2'), 'not yet 30 s on the field');
  h.run(31);
  approx(u.s.aspd, u.base.aspd + t[1].bb.attack_speed, '在战场停留30秒后，自身攻击速度+10');
  done(h);
});

// =================================================================================================================
// 610_acfend Mechanist

test('Mechanist S1 结构稳定: max HP +26 %, DEF +26 % (on top of 精研材料)', () => {
  const id = MECH, b = bbOf(id, 0), t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4, skillIndex: 0, moduleId: 'none', carryState: READY }], { spawns: [{ key: 'e_mob', pos: [9, 7], route: walk(9, 7) }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 25), 'TAKE_DAMAGE: cast by the first hit');
  approx(u.s.maxHp, u.base.maxHp * (1 + b.max_hp), '最大生命值+26%');
  const t1 = t[0].bb.def + (u.hpRatio < t[0].bb.hp_ratio ? t[0].bb['acfend_t_1[extra].def'] : 0);
  approx(u.s.def, u.base.def * (1 + b.def + t1), '防御力+26% plus 精研材料');
  done(h);
});

test('Mechanist S2 不变性原理: DEF +50 % and 反馈装甲 doubled to ASPD −14 on the blocked enemy', () => {
  const id = MECH, b = bbOf(id, 1), t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4, skillIndex: 1, moduleId: 'none', carryState: READY }], { spawns: [{ key: 'e_mob', pos: [9, 7], route: walk(9, 7) }] });
  const u = h.unit(id);
  h.step();
  const e = h.enemy('enemy_e_mob');
  assert.ok(h.runUntil(() => e.blockedBy === u && e.findBuff('acfend:t2'), 25), '反馈装甲 on the blocked enemy');
  approx(e.findBuff('acfend:t2').mods.aspd, t[1].bb.attack_speed, '自身阻挡的敌人攻击速度-7');
  assert.ok(h.runUntil(() => u.skill.active, 25), 'TAKE_DAMAGE');
  const t1 = t[0].bb.def + (u.hpRatio < t[0].bb.hp_ratio ? t[0].bb['acfend_t_1[extra].def'] : 0);
  approx(u.s.def, u.base.def * (1 + b.def + t1), '防御力+50%');
  assert.ok(h.runUntil(() => e.findBuff('acfend:t2')?.mods.aspd === t[1].bb.attack_speed * b.talent_mult, 5), '第二天赋的效果提升至2倍');
  approx(e.findBuff('acfend:t2').mods.aspd, -14, 'ASPD −14');
  done(h);
});

test('Mechanist S3 应力倒置: DEF +50 %, block +1, 40 % ATK arts per second on the blocked enemies', () => {
  const id = MECH, b = bbOf(id, 2), t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4, moduleId: 'none', carryState: READY }], { spawns: [{ key: 'e_mob', pos: [9, 7], route: walk(9, 7) }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 25), 'TAKE_DAMAGE');
  const t1 = t[0].bb.def + (u.hpRatio < t[0].bb.hp_ratio ? t[0].bb['acfend_t_1[extra].def'] : 0);
  approx(u.s.def, u.base.def * (1 + b.def + t1), '防御力+50%');
  assert.equal(u.s.blockCnt, u.base.blockCnt + b.block_cnt, '阻挡数+1');
  h.run(5);
  const ticks = dealt(h, u, tagged('stress'));
  assert.ok(ticks.length >= 4, `每秒一 tick (${ticks.length})`);
  for (const c of ticks) {
    assert.equal(c.dmg.type, 'arts', '法术伤害');
    approx(c.amount, u.s.atk * b.atk_scale, '相当于攻击力40%');
    assert.equal(c.target.blockedBy, u, '自身阻挡的敌人');
  }
  done(h);
});

// =================================================================================================================
// 611_acnipe Stormeye

test('Stormeye S1 破空: ATK +15 %, ASPD +30 and 100 DEF ignored', () => {
  const id = STORM, b = bbOf(id, 0), t = D(id).talents;
  const h = battle([{ chessId: id, row: 11, col: 4, skillIndex: 0, carryState: READY }], {
    recs: { e_arm: enemyRec({ key: 'e_arm', hp: 1e7, speed: 0, atk: 0, def: 150 }) },
    spawns: [{ key: 'e_arm', pos: [11, 6] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + b.atk), '攻击力+15%');
  approx(u.s.aspd, u.base.aspd + b.attack_speed, '攻击速度+30');
  assert.equal(u.s.defIgnoreFlat, b.def_penetrate_fixed, '无视攻击目标100防御力');
  assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash).length >= 1, 5));
  const hit = dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash)[0];
  const pen = b.def_penetrate_fixed;
  const allowed = [u.s.atk - Math.max(0, 150 - pen), u.s.atk * t[0].bb.atk_scale - Math.max(0, 150 - pen)];
  assert.ok(allowed.some((x) => Math.abs(hit.amount - x) < 1e-6), `100 DEF ignored (${hit.amount} of ${allowed.join(' / ')})`);
  done(h);
});

test('Stormeye S2 心手合一 (AUTO, 持续时间无限): ATK +5 % and one extra attack target', () => {
  const id = STORM, b = bbOf(id, 1);
  const h = battle([{ chessId: id, row: 11, col: 4, skillIndex: 1, carryState: READY }], {
    spawns: [{ key: 'e_still', pos: [11, 6] }, { key: 'e_still', pos: [11, 7] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5), 'fires with an enemy in range');
  approx(u.s.atk, u.base.atk * (1 + b.atk), '攻击力+5%');
  assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 5));
  assert.equal(h.hooksOf('attack').find((c) => c.attacker === u).targets.length, b['attack@max_target'], '每次攻击额外攻击1个目标');
  h.run(30);
  assert.equal(u.skill.active, true, '持续时间无限 (a toggle)');
  done(h);
});

test('Stormeye S3 旋臂: 3 targets, a double hit, and +1 hit per target above 90 % HP', () => {
  const id = STORM, b = bbOf(id, 2);
  const h = battle([{ chessId: id, row: 11, col: 4, carryState: READY }], {
    spawns: [{ key: 'e_still', pos: [11, 6] }, { key: 'e_still', pos: [11, 7] }, { key: 'e_still', pos: [12, 6] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.targets.length >= 3), 10), '可以同时攻击3个目标');
  h.run(4);
  // 二连击: one attack = 2 damage instances on each of the 3 targets (the same attackId carries all of them)
  const byAtk = new Map();
  for (const c of dealt(h, u, (c) => c.dmg.isAttack && c.dmg.attackId > 0)) {
    byAtk.set(c.dmg.attackId, [...(byAtk.get(c.dmg.attackId) ?? []), c]);
  }
  const one = [...byAtk.values()].find((g) => new Set(g.map((c) => c.target.id)).size >= 3);
  assert.ok(one, 'an attack on 3 targets');
  assert.equal(one.length, b['attack@max_target'] * b['attack@times'], '3 targets × 二连击');
  for (const tid of new Set(one.map((c) => c.target.id))) {
    assert.equal(one.filter((c) => c.target.id === tid).length, b['attack@times'], 'each target hit twice');
  }
  // 攻击目标生命值高于90%时额外造成1次伤害
  const extra = dealt(h, u, tagged('extra'));
  assert.ok(extra.length >= 3, 'one extra hit per target above 90 % HP');
  for (const c of extra) { approx(c.amount, u.s.atk * b['attack@atk_scale_extra'], 'atk_scale_extra × ATK'); assert.equal(c.target.hpRatio > b['attack@hp_ratio'] - 0.5, true); }
  assert.equal(b['talent@prob'], 0.3, '第一天赋的触发概率提高至30% (the kit reads this key)');
  done(h);
});

test('Stormeye talents: 风坠 25 % ×1.8; 风雨欲来 +0.2 SP/s while it holds its fire', () => {
  const id = STORM, t = D(id).talents;
  const h = battle([{ chessId: id, row: 11, col: 4 }], { spawns: [{ key: 'e_still', pos: [11, 6] }] });
  const u = h.unit(id);
  h.step();
  approx(u.s.spRecovery, u.base.spRecovery, 'no SP aura while it attacks');
  assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length >= 1, 12), 'it attacks');
  const crit = h.eventsOf('fx').filter((x) => x[1] === 'crit');
  assert.ok(dealt(h, u, (c) => c.dmg.isAttack).some((c) => Math.abs(c.amount - u.s.atk * t[0].bb.atk_scale) < 1e-6) || crit.length > 0, '风坠: 25 % for 攻击力提升至180%');
  const e = h.enemy('enemy_e_still');
  e.x = 19; e.y = 2; // out of range: the operator holds its fire
  h.run(3);
  approx(u.s.spRecovery, u.base.spRecovery + t[1].bb.sp_recovery_per_sec, '自身未进行攻击时，技力回复速度+0.2/秒');
  done(h);
});

// =================================================================================================================
// 612_accast Pith

test('Pith S1 “书我所书” (AUTO): ASPD +30 and a 1.5-tile splash', () => {
  const id = PITH, b = bbOf(id, 0);
  const h = battle([{ chessId: id, row: 11, col: 4, skillIndex: 0, carryState: READY }], { spawns: [{ key: 'e_still', pos: [11, 6] }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.aspd, u.base.aspd + b.attack_speed, '自身攻击速度+30');
  approx(u.skill.attackOverride().splashRadius, b['attack@projectile_range'], '溅射范围扩大至1.5');
  done(h);
});

test('Pith S2 “为我所为”: ASPD +35 and every 【术师】 operator ATK +30 %', () => {
  const id = PITH, b = bbOf(id, 1), t = D(id).talents;
  const mate = chessRec({ id: 't_caster', profession: 'CASTER', subProfessionId: 'splashcaster', stats: { atk: 300 }, rangeGrid: [[0, 0], [0, 1]] });
  const h = battle([
    { chessId: id, row: 11, col: 4, skillIndex: 1, carryState: READY, uid: 1 },
    { chessId: 't_caster', row: 12, col: 4, uid: 2 },
    { chessId: STORM, row: 12, col: 5, uid: 3 },
  ], { chess: { t_caster: mate }, spawns: [{ key: 'e_still', pos: [11, 6] }] });
  const pith = h.unit(1), other = h.unit(2), sniper = h.unit(3);
  assert.ok(h.runUntil(() => pith.skill.active, 5));
  h.run(0.3);
  approx(pith.s.aspd, pith.base.aspd + b.attack_speed, '自身攻击速度+35');
  // 授我所授 (T2) gives self and the adjacent 【术师】 +10 % — the same key, so never twice
  approx(pith.s.atk, pith.base.atk * (1 + b.atk + t[1].bb.atk), '所有术师+30% 及 授我所授+10%');
  approx(other.s.atk, other.base.atk * (1 + b.atk + t[1].bb.atk), '相邻的术师 +30 % and +10 %');
  approx(sniper.s.atk, sniper.base.atk, 'a SNIPER is untouched');
  done(h);
});

test('Pith S3 “驭我所驭”: a 100 % arts burst on every enemy in range, 2 targets, ASPD +40, splash 1.2', () => {
  const id = PITH, b = bbOf(id, 2);
  const h = battle([{ chessId: id, row: 11, col: 4, carryState: READY }], {
    spawns: [{ key: 'e_still', pos: [11, 6] }, { key: 'e_still', pos: [10, 5] }, { key: 'e_still', pos: [12, 5] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  const burst = dealt(h, u, tagged('burst'));
  assert.equal(burst.length, 3, '对攻击范围内的所有敌人');
  for (const c of burst) { assert.equal(c.dmg.type, 'arts', '法术伤害'); approx(c.amount, u.s.atk * b.atk_scale_aoe, '攻击力100%'); }
  approx(u.s.aspd, u.base.aspd + b.attack_speed, '攻击速度+40');
  assert.equal(u.skill.spec.targeting.maxTargets, b['attack@max_target'], '攻击目标数+1');
  approx(u.skill.attackOverride().splashRadius, b['attack@projectile_range'], '溅射范围扩大至1.2');
  done(h);
});

test('Pith talents: 见我所见 ignores 12 RES; 授我所授 gives self and the adjacent 【术师】 +10 % ATK', () => {
  const id = PITH, t = D(id).talents;
  const mate = chessRec({ id: 't_caster', profession: 'CASTER', subProfessionId: 'splashcaster', stats: { atk: 300 }, rangeGrid: [[0, 0], [0, 1]] });
  const h = battle([
    { chessId: id, row: 11, col: 4, uid: 1 },
    { chessId: 't_caster', row: 11, col: 5, uid: 2 },
    { chessId: 't_caster', row: 9, col: 9, uid: 3 },
  ], { chess: { t_caster: mate } });
  h.run(1);
  const pith = h.unit(1), near = h.unit(2), far = h.unit(3);
  assert.equal(pith.s.resIgnoreFlat, t[0].bb.magic_resist_penetrate_fixed, '攻击无视目标12法术抗性');
  approx(pith.s.atk, pith.base.atk * (1 + t[1].bb.atk), '自身及相邻四格的【术师】攻击力+10% (self)');
  approx(near.s.atk, near.base.atk * (1 + t[1].bb.atk), 'the adjacent 【术师】');
  approx(far.s.atk, far.base.atk, 'a 【术师】 outside the 4 adjacent tiles is untouched');
  done(h);
});

// =================================================================================================================
// 613_acmedc Touch

test('Touch S1 慨赠: ATK +40 % and a 40 % chance of one extra heal', () => {
  const id = TOUCH, b = bbOf(id, 0);
  const h = battle([{ chessId: id, row: 11, col: 4, skillIndex: 0, carryState: READY, uid: 1 }, { chessId: 't_ally', row: 11, col: 6, uid: 2 }], {
    chess: { t_ally: chessRec({ id: 't_ally', stats: { maxHp: 3e5, atk: 0 } }) },
  });
  const u = h.unit(1), ally = h.unit(2);
  h.step();
  ally.hp = ally.s.maxHp * 0.5;
  assert.ok(h.runUntil(() => u.skill.active, 5));
  const atk = u.s.atk;
  approx(atk, u.base.atk * (1 + b.atk), '攻击力+40%');
  h.run(20);
  const hs = heals(h, u);
  assert.ok(hs.length >= 2, `healed (${hs.length})`);
  // a heal action that paid twice in the same tick = 额外治疗一次, for the same amount
  const byTick = new Map();
  for (const c of hs) byTick.set(c.t, [...(byTick.get(c.t) ?? []), c]);
  const dup = [...byTick.values()].find((g) => g.length >= 2);
  assert.ok(dup, '每次治疗有40%概率额外治疗一次');
  approx(dup[0].amount, atk, 'the extra heal is a full heal');
  approx(dup[1].amount, atk);
  done(h);
});

test('Touch S2 宛如天启: 攻击范围扩大, 2 heal targets, every 【医疗】 operator ATK +21 %', () => {
  const id = TOUCH, b = bbOf(id, 1);
  const h = battle([
    { chessId: id, row: 11, col: 4, skillIndex: 1, carryState: READY, uid: 1 },
    { chessId: 't_ally', row: 11, col: 5, uid: 2 },
    { chessId: 't_ally', row: 12, col: 5, uid: 3 },
  ], { chess: { t_ally: chessRec({ id: 't_ally', stats: { maxHp: 3e5, atk: 0 } }) } });
  const u = h.unit(1), a = h.unit(2), c = h.unit(3);
  h.step();
  a.hp = a.s.maxHp * 0.5; c.hp = c.s.maxHp * 0.5;
  assert.ok(h.runUntil(() => u.skill.active, 5));
  assert.equal(u.rangeKeys.length, D(id, 1).skill.rangeGrid.length, '自身攻击范围扩大 (3-10)');
  approx(u.s.atk, u.base.atk * (1 + b['attack@atk']), '所有医疗干员攻击力+21% (self included)');
  h.run(4);
  const byTick = new Map();
  for (const ev of heals(h, u)) byTick.set(ev.t, [...(byTick.get(ev.t) ?? []), ev]);
  const two = [...byTick.values()].find((g) => g.length >= 2);
  assert.ok(two, '每次治疗2个目标');
  assert.equal(new Set(two.map((x) => x.target.uid)).size, 2, 'two different allies');
  for (const x of two) approx(x.amount, u.s.atk, 'a full heal each');
  done(h);
});

test('Touch S3 恳切福音: 135 % on ≤ half HP allies, 2 targets, +30 % of the main heal to the lowest-HP unit', () => {
  const id = TOUCH, b = bbOf(id, 2);
  const h = battle([
    { chessId: id, row: 11, col: 4, skillIndex: 2, moduleId: 'none', carryState: READY, uid: 1 },
    { chessId: 't_ally', row: 11, col: 5, uid: 2 },
    { chessId: 't_ally', row: 11, col: 6, uid: 3 },
  ], { chess: { t_ally: chessRec({ id: 't_ally', stats: { maxHp: 3e5, atk: 0 } }) } });
  const u = h.unit(1), low = h.unit(2), high = h.unit(3);
  h.step();
  low.hp = low.s.maxHp * 0.2;
  high.hp = high.s.maxHp * 0.4;
  assert.ok(h.runUntil(() => u.skill.active, 5));
  assert.equal(u.rangeKeys.length, D(id, 2).skill.rangeGrid.length, '自身攻击距离+2 (5-2)');
  approx(u.s.atk, u.base.atk * (1 + b.atk), '攻击力+20%');
  h.run(4);
  const hs = heals(h, u).slice(0, 3);
  assert.equal(hs.length, 3, '2 main heals + 1 extra');
  const main = u.s.atk * b.heal_scale;   // the heal is ×heal_scale on a target at ≤ half HP
  assert.equal(hs[0].target.uid, low.uid, 'the lowest HP ratio is healed first');
  approx(hs[0].amount, main, '对生命值不高于一半的友方单位治疗量提高为原来的135%');
  approx(hs[1].amount, main * b['attack@addition_heal_scale'] * b.heal_scale, '额外治疗量为主目标的30% (its own target is ≤ half HP, so it is boosted too)');
  assert.equal(hs[2].target.uid, high.uid);
  approx(hs[2].amount, main, 'the 2nd of the 每次治疗2个目标');
  done(h);
});

test('Touch talents: 攫升 +3 SP to the healed unit, 超脱 +5 SP when an operator in range is knocked out', () => {
  const id = TOUCH, t = D(id).talents;
  const h = battle([
    { chessId: id, row: 11, col: 4, uid: 1 },
    { chessId: 't_ally', row: 11, col: 6, uid: 2 },
  ], { chess: { t_ally: chessRec({ id: 't_ally', stats: { maxHp: 3e5, atk: 0, spRecovery: 0 }, skill: { spCost: 100, initSp: 0 } }) } });
  const u = h.unit(1), ally = h.unit(2);
  h.step();
  ally.hp = ally.s.maxHp * 0.5;
  assert.ok(h.runUntil(() => heals(h, u).length >= 1, 10), 'Touch heals');
  approx(ally.skill.sp, t[0].bb.sp, '治疗目标时使其获得3点技力', 1e-9);
  const sp0 = u.skill.sp;
  h.b.dealDamage(null, ally, { amount: 1e6, type: 'true' });
  assert.equal(ally.alive, false);
  approx(u.skill.sp - sp0, t[1].bb.sp, '攻击范围内的友方干员被击倒时获得5点技力', 0.5);
  done(h);
});

// =================================================================================================================
// 614_acsupo Raidian

test('Raidian S1 双声: ATK +25 % and one extra attack target', () => {
  const id = RAIDIAN, b = bbOf(id, 0);
  const h = battle([{ chessId: id, row: 11, col: 5, skillIndex: 0, carryState: READY }], {
    spawns: [{ key: 'e_still', pos: [11, 6] }, { key: 'e_still', pos: [11, 7] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + b.atk), '攻击力+25%');
  assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.targets.length >= 2), 5), '额外攻击一个目标');
  assert.equal(h.hooksOf('attack').find((c) => c.attacker === u).targets.length, b['attack@max_target']);
  done(h);
});

test('Raidian S2 三形: attack interval −0.1 s, 3 targets, the 停顿 lengthened to 1.1 s', () => {
  const id = RAIDIAN, b = bbOf(id, 1);
  const h = battle([{ chessId: id, row: 11, col: 5, skillIndex: 1, carryState: READY }], {
    spawns: [{ key: 'e_still', pos: [11, 6] }, { key: 'e_still', pos: [11, 7] }, { key: 'e_still', pos: [12, 6] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.interval, (u.base.bat + b.base_attack_time) * 100 / u.s.aspd, '攻击间隔略微缩短(-0.1)');
  assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.targets.length >= 3), 5), '同时攻击三个目标');
  h.run(2); // the bolts land
  const sl = h.hooksOf('statusApplied').filter((c) => c.status === 'sluggish' && c.source === u);
  assert.ok(sl.length >= 1, '攻击造成停顿');
  approx(Math.max(...sl.map((c) => c.duration)), b['attack@sluggish'], '停顿时间延长至1.1秒');
  done(h);
});

test('Raidian S3 信号跃动: range up, ATK +40 %, 同调 ×2, 脆弱 10 % + 虚弱 10 % on the enemies in range', () => {
  const id = RAIDIAN, b = bbOf(id, 2), t = D(id).talents;
  const h = battle([
    { chessId: id, row: 11, col: 5, skillIndex: 2, carryState: READY, uid: 1 },
    { chessId: TULIP, row: 12, col: 5, uid: 2 },
  ], { spawns: [{ key: 'e_mob', pos: [11, 7], route: walk(11, 7) }, { key: 'e_still', pos: [12, 9] }] });
  const u = h.unit(1), mate = h.unit(2);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.run(0.4);
  approx(u.s.atk, u.base.atk * (1 + b['acsupo_s_3.atk']), '攻击力+40% (acsupo_s_3.atk, not the 虚弱 priority `atk`)');
  assert.equal(u.rangeKeys.length, D(id, 2).skill.rangeGrid.length, '攻击范围扩大 (y-4)');
  approx(u.s.aspd, u.base.aspd + t[0].bb.attack_speed * b.talent_scale, '第一天赋的效果提升至2倍');
  approx(mate.s.aspd, mate.base.aspd + t[0].bb['acsupo_t_1[ally].attack_speed'] * b.talent_scale, 'the adjacent operator ×2 as well');
  const e = h.enemy('enemy_e_mob'), far = h.enemy('enemy_e_still');
  assert.ok(h.runUntil(() => e.findBuff('fragile'), 5), '攻击范围内所有敌人受到脆弱');
  approx(e.findBuff('fragile').mods.dmgTakenMul, b.damage_scale, '10 % 脆弱 (damage ×1.1)');
  const weak = e.findBuff('acsupo:weaken');
  assert.ok(weak, '虚弱');
  approx(weak.data.value, b.atk, 'the 虚弱 is valued 0.9 for the 同名取最高 rule (PRTS 备注)');
  approx(e.s.atk, e.base.atk * 0.9, '10 % 虚弱 (attack ×0.9)');
  assert.ok(!far.findBuff('fragile') && !far.findBuff('acsupo:weaken'), 'an enemy outside the range is untouched');
  done(h);
});

test('Raidian talents: 同调 self +15 / adjacent +10 ASPD; 诱引 −10 % enemy hit rate in range', () => {
  const id = RAIDIAN, t = D(id).talents;
  const h = battle([
    { chessId: id, row: 11, col: 5, uid: 1 },
    { chessId: TULIP, row: 11, col: 6, uid: 2 },
    { chessId: TULIP, row: 9, col: 9, uid: 3 },
  ]);
  h.run(1);
  const u = h.unit(1), near = h.unit(2), far = h.unit(3);
  approx(u.s.aspd, u.base.aspd + t[0].bb.attack_speed, '攻击速度+15');
  approx(near.s.aspd, near.base.aspd + t[0].bb['acsupo_t_1[ally].attack_speed'], '相邻的干员攻击速度+10');
  approx(far.s.aspd, far.base.aspd, 'a unit further away is untouched');
  // 诱引: 300 plain physical hits from an enemy standing in her range — ~10 % are cancelled
  const e = h.spawn('e_still', { pos: [11, 7] });
  assert.ok(e);
  for (let i = 0; i < 300; i++) {
    if (!u.alive) break;
    h.b.dealDamage(e, u, { amount: 2, type: 'phys', isAttack: true, canDodge: false });
  }
  const misses = h.hooksOf('dodge').filter((c) => c.source === e && c.target === u).length;
  assert.ok(misses >= 15 && misses <= 45, `≈10 % of 300 hits missed (${misses})`);
  done(h);
});

// =================================================================================================================
// 615_acspec Misery

test('Misery S1 物理的服从 (passive): 45 % physical dodge and the 2nd talent proc at 25 % for 10 s', () => {
  const id = MISERY, b = bbOf(id, 0);
  const h = battle([{ chessId: id, row: 9, col: 4, skillIndex: 0 }], { spawns: [{ key: 'e_still', pos: [9, 5] }] });
  const u = h.unit(id);
  h.step();
  approx(u.s.dodgePhys, b.prob, '获得45%物理闪避');
  h.run(9);
  assert.ok(u.findBuff('acspec:s1'), 'the deployment buff still runs');
  assert.ok(dealt(h, u, tagged('doubleHit')).length >= 1, '二象命末 procs (raised to 25 %)');
  h.run(2);
  assert.ok(!u.findBuff('acspec:s1'), '持续10秒');
  assert.equal(u.s.dodgePhys, 0, 'the dodge is gone');
  done(h);
});

test('Misery S2 战争的恭顺 (passive): ATK +30 % and ASPD +15 for 10 s after the deployment', () => {
  const id = MISERY, b = bbOf(id, 1);
  const h = battle([{ chessId: id, row: 9, col: 4, skillIndex: 1, moduleId: 'none' }], { spawns: [{ key: 'e_still', pos: [9, 6] }] });
  const u = h.unit(id);
  h.step();
  approx(u.s.atk, u.base.atk * (1 + b.atk), '部署后攻击力+30%');
  approx(u.s.aspd, u.base.aspd + b.attack_speed, '攻击速度+15');
  h.run(11);
  approx(u.s.atk, u.base.atk, 'after the 10 s (no 四维分离 either: the enemy stands 2 tiles ahead)');
  approx(u.s.aspd, u.base.aspd);
  done(h);
});

test('Misery S3 空间的归依 (passive): 210 % ATK phys on the ground enemies around, 小力 pull + 2.5 s 停顿', () => {
  const id = MISERY, b = bbOf(id, 2);
  const h = battle([{ chessId: id, row: 10, col: 4 }], {
    recs: { e_fly: enemyRec({ key: 'e_fly', hp: 1e7, speed: 0, atk: 0, motion: 'FLY' }) },
    // 部署后立即…: the passive runs BEFORE the t=0 spawns, so the ring is populated in `setup`
    extra: { setup: (b) => { for (const [key, r, c2] of [['e_still', 10, 5], ['e_still', 9, 4], ['e_fly', 10, 3], ['e_still', 12, 9]]) b.spawnEnemy(key, { pos: [r, c2] }); } },
  });
  const u = h.unit(id);
  h.step();
  const burst = dealt(h, u, tagged('burst'));
  assert.equal(burst.length, 2, '周围所有敌人 (the 2 ground ones) — 不可对空');
  for (const c of burst) approx(c.amount, u.s.atk * b.atk_scale, '攻击力210%的物理伤害');
  assert.equal(h.enemy('enemy_e_fly').stats.taken, 0, '※不可对空');
  // 将所有未被阻挡的敌人小力地拖拽至面前
  const pulled = h.enemies().find((e) => e.defId === 'enemy_e_still' && Math.round(e.y) === 10);
  assert.ok(pulled.x > 4 && pulled.x < 4.9, `小力 pull towards the front (x = ${pulled.x})`);
  const sl = h.hooksOf('statusApplied').filter((c) => c.status === 'sluggish' && c.target.side === 'enemy');
  assert.equal(sl.length, 2, '2.5秒停顿 on the two ground enemies');
  for (const c of sl) approx(c.duration, b.sluggish, '2.5 s');
  done(h);
});

test('Misery talents: 二象命末 10 % double hit; 四维分离 ATK +10 % with exactly one enemy around', () => {
  const id = MISERY, t = D(id).talents;
  const h = battle([{ chessId: id, row: 9, col: 4, moduleId: 'none' }], { spawns: [{ key: 'e_still', pos: [9, 6] }] });
  const u = h.unit(id);
  h.run(1);
  approx(u.s.atk, u.base.atk, 'no 四维分离 ATK (the enemy stands 2 tiles ahead, not around him)');
  assert.ok(h.spawn('e_still', { pos: [10, 4] }));
  h.run(1);
  approx(u.s.atk, u.base.atk * (1 + t[1].bb.atk), '周围四格内仅存在一名敌人时，攻击力+10%');
  assert.ok(h.spawn('e_still', { pos: [9, 3] }));
  h.run(1);
  approx(u.s.atk, u.base.atk, 'two enemies around him: no bonus');
  done(h);
});

// =================================================================================================================
// 617_sharp2 领主·Sharp

test('领主·Sharp S1 沉默的爆发: ATK +130 %, ASPD +35, 2 targets and no ranged penalty', () => {
  const id = LORD, b = bbOf(id, 0), t = D(id).talents;
  const h = battle([{ chessId: id, row: 11, col: 4, carryState: READY }], { spawns: [{ key: 'e_still', pos: [11, 6] }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + t[0].bb.atk + b.atk), '攻击力+130% on top of 无声之锋');
  approx(u.s.aspd, u.base.aspd + b.attack_speed, '攻击速度+35');
  assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash).length >= 1, 5));
  approx(dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash)[0].amount, u.s.atk, '远程攻击不再降低攻击力 (no ×0.8)');
  assert.equal(u.base.atk > 0 && u.s.atk > 0, true);
  assert.ok(h.spawn('e_still', { pos: [11, 7] }));
  h.run(4);
  assert.ok(h.hooksOf('attack').some((c) => c.attacker === u && c.targets.length >= 2), '同时攻击2个目标');
  done(h);
});

test('领主·Sharp talents: 无声之锋 ATK +20 % / 25 % arts dodge; 陷阵勇气 ASPD +12 with ≥ 2 enemies in range', () => {
  const id = LORD, t = D(id).talents;
  const h = battle([{ chessId: id, row: 11, col: 4 }], { spawns: [{ key: 'e_still', pos: [11, 6] }] });
  const u = h.unit(id);
  h.run(1);
  approx(u.s.atk, u.base.atk * (1 + t[0].bb.atk), '攻击力+20%');
  approx(u.s.dodgeArts, t[0].bb.prob, '获得25%的法术闪避');
  approx(u.s.aspd, u.base.aspd, 'one enemy: no 陷阵勇气');
  assert.ok(h.spawn('e_still', { pos: [11, 7] }));
  h.run(1);
  approx(u.s.aspd, u.base.aspd + t[1].bb.attack_speed, '攻击范围内存在2名及以上敌人时，攻击速度+12');
  assert.equal(t[1].bb.cnt, 2);
  done(h);
});

// =================================================================================================================
// the six 4★ 预备干员 (601…606): shared generic skills + the plain stat talent of `reserveKit`

test('4★ 预备干员: the shared `skcom_*` skill stays generic and the plain stat talent (攻击/防御/攻速) applies', () => {
  // the talents of data/freePicks.json verbatim: 攻击提升 攻击力+8 % (近卫 / 狙击 / 医疗), 防御提升 防御力+10 % (重装),
  // 施法速度提升 攻击速度+9 (术师 / 辅助) — every one a single plain stat key
  const RESERVE = [
    ['chess_free_char_601_cguard', { atk: 0.08 }],
    ['chess_free_char_602_cdfend', { def: 0.1 }],
    ['chess_free_char_603_csnipe', { atk: 0.08 }],
    ['chess_free_char_604_ccast', { attack_speed: 9 }],
    ['chess_free_char_605_cmedic', { atk: 0.08 }],
    ['chess_free_char_606_csuppo', { attack_speed: 9 }],
  ];
  for (const [id, talent] of RESERVE) {
    const rec = FREE[id];
    assert.ok(rec, `${id}: a 自选候选 record`);
    const t = D(id).talents[0];
    assert.ok(t, `${id}: one talent`);
    const keys = Object.keys(talent);
    assert.equal(Object.keys(t.bb).length, 1, `${id}: a plain stat blackboard (${JSON.stringify(t.bb)})`);
    for (const k of keys) assert.equal(t.bb[k], talent[k], `${id}: ${t.description} blackboard`);
    // the shared skill of every one of them is the generic `skcom_*` spec, exactly as the finding says
    assert.equal(skillSpecSource(D(id, rec.skills.find((s) => s.isDefault).index)), 'generic', `${id}: skcom_* stays generic`);
    const h = battle([{ chessId: id, row: 10, col: 4 }]);
    h.step();
    const u = h.unit(id);
    assert.equal(u.kit.talents.length, 1, `${id}: the talent is installed`);
    assert.equal(u.kit.generic, true, `${id}: the skill spec is still the generic kit's`);
    if (talent.atk) approx(u.s.atk, u.base.atk * (1 + talent.atk), `${id}: 攻击力+8%`);
    if (talent.def) approx(u.s.def, u.base.def * (1 + talent.def), `${id}: 防御力+10%`);
    if (talent.attack_speed) approx(u.s.aspd, u.base.aspd + talent.attack_speed, `${id}: 攻击速度+9`);
    done(h);
  }
});

test('4★ 预备干员: the stat talent adds to the selected `skcom_*` skill (both blackboards applied at once)', () => {
  // one representative per talent shape, with its own strongest shared skill selected (each record's default)
  const CASES = [
    ['chess_free_char_601_cguard', 'atk', false],          // 攻击提升 攻击力+8% + skcom_atk_up[3] 攻击力+45%
    ['chess_free_char_602_cdfend', 'def', false],          // 防御提升 防御力+10% + skcom_def_up[3] 防御力+45%
    ['chess_free_char_604_ccast', 'attack_speed', false],  // 施法速度提升 攻击速度+9 + skcom_magic_rage[3] 攻击速度+45
    ['chess_free_char_605_cmedic', 'atk', true],           // 攻击提升 攻击力+8% + skcom_heal_up[3] 攻击力+55%
  ];
  for (const [id, key, medic] of CASES) {
    const idx = FREE[id].skills.find((s) => s.isDefault).index;
    const rec = FREE[id], talent = D(id).talents[0].bb;
    const units = [{ chessId: id, row: 10, col: 4, skillIndex: idx, carryState: READY, uid: 1 }];
    if (medic) units.push({ chessId: 't_ally', row: 10, col: 6, uid: 2 });   // the 医师 needs an injured ally
    const h = battle(units, {
      chess: { t_ally: chessRec({ id: 't_ally', stats: { maxHp: 4000, atk: 0 } }) },
      // a walking enemy: the 重装 skill's data trigger is TAKE_DAMAGE, the others cast on the enemy in range
      spawns: [{ key: 'e_mob', pos: [10, 8], route: walk(10, 8) }],
    });
    const u = h.unit(1);
    if (medic) { h.step(); const ally = h.unit(2); ally.hp = ally.s.maxHp * 0.5; }
    assert.ok(h.runUntil(() => u.skill.active, 25), `${id}: casts ${D(id, idx).skill.id}`);
    const v = bbOf(id, idx)[key];
    assert.ok(v > 0, `${id}: the skill's ${key} blackboard`);
    if (key === 'attack_speed') approx(u.s.aspd, u.base.aspd + v + talent[key], `${id}: 攻击速度 ${v} + talent ${talent[key]}`);
    else approx(u.s[key], u.base[key] * (1 + v + talent[key]), `${id}: the skill's +${v} and the talent's +${talent[key]}`);
    assert.equal(rec.skills.filter((s) => s.isDefault).length, 1);
    done(h);
  }
});

// =================================================================================================================
// 模组 (user rule "模组相关规则和普通干员一致"): a 自选候选 is its own elite — its record carries `modules[]` and the
// no-module bases, so a 干员调配 screen can offer its 模组 and the battle composes attr / trait / talents from it.

test('freePicks 模组: the record is its own elite (modules[] + bases); the equipped module composes attr/trait/talents', () => {
  for (const id of BATCH) {
    const rec = FREE[id];
    assert.ok(Array.isArray(rec.modules) && rec.modules.length >= 1, `${id}: modules[]`);
    assert.equal(rec.modules.filter((m) => m.isDefault).length, 1, `${id}: exactly one default module`);
    assert.ok(rec.statsBase && rec.traitBase && rec.talentsBase, `${id}: the no-module bases`);
    const defMod = rec.modules.find((m) => m.isDefault);
    assert.equal(rec.module.id, defMod.uniEquipId, `${id}: module.id is the default module`);
    assert.equal(rec.module.active, true);
    assert.equal(rec.status.equipLevel, defMod.level, `${id}: the module level is the record's equipLevel`);
    assert.equal(defMod.level, 3, `${id}: a tier-6 operator gets the season's level-3 module`);
    assert.equal(rec.goldenId, null, `${id}: no _b sibling — the record itself is the elite`);
    // 模组不装备 ⇒ the record's own no-module bases
    const on = D(id), off = DM(id, null, 'none');
    assert.equal(off.raw.module.active, false, `${id}: 不装备`);
    assert.equal(off.raw.module.id, null);
    for (const k of Object.keys(off.stats)) approx(off.stats[k], rec.statsBase[k], `${id}: ${k} without a module`);
    // the default module adds its attr, its trait and its talent changes
    for (const [k, v] of Object.entries(defMod.attr)) approx(on.stats[k], off.stats[k] + v, `${id}: ${k} = base + module attr`);
    assert.equal(on.raw.module.id, defMod.uniEquipId, `${id}: the default module is equipped`);
    if (defMod.traitOverride) {
      // the module's trait part: an override of the whole text (SOL-X …) or an added sentence (`moduleDesc`), plus bb
      const rec2 = on.raw.trait;
      assert.equal(rec2.desc, defMod.traitOverride.desc, `${id}: the module's trait text`);
      assert.equal(rec2.moduleDesc ?? null, defMod.traitOverride.moduleDesc ?? null, `${id}: the module sentence`);
      assert.ok(String(rec2.moduleDesc || rec2.desc).length > 0, `${id}: the module trait has text`);
      for (const [k, v] of Object.entries(defMod.traitOverride.bb || {})) approx(on.traitBb[k], v, `${id}: trait bb ${k}`);
      assert.notDeepEqual(rec2, off.raw.trait, `${id}: 不装备 uses the no-module trait`);
    } else {
      assert.equal(DM(id).raw.trait.desc, off.raw.trait.desc, `${id}: the module adds no trait part`);
    }
    assert.notDeepEqual(on.talents, off.talents, `${id}: the module's talent upgrade / hidden talent applies`);
    for (const m of rec.modules) {
      assert.ok(m.uniEquipId && m.name && m.typeName, `${id}: a selectable module record`);
      assert.ok(m.attr && Object.keys(m.attr).length, `${id} ${m.uniEquipId}: module attr`);
    }
  }
});

test('模组 SOL-X 郁金香: 阻挡敌人时攻击力和防御力各+8% (阻挡 on, 不装备 off) + 无垠之心 +1/秒', () => {
  const mk = (moduleId) => battle([{ chessId: TULIP, row: 9, col: 4, ...(moduleId ? { moduleId } : {}) }],
    { spawns: [{ key: 'e_mob', pos: [9, 7], route: walk(9, 7) }] });
  const on = mk(), off = mk('none');
  const uOn = on.unit(TULIP), uOff = off.unit(TULIP);
  on.step(); off.step();
  approx(uOn.s.spRecovery, uOn.base.spRecovery + 1, '模组: 无垠之心 技力自然回复速度+1/秒');
  approx(uOff.s.spRecovery, uOff.base.spRecovery + 0.6, '不装备: +0.6/秒');
  assert.equal(uOn.findBuff('acpion:module'), null, 'not blocking yet');
  approx(uOn.s.atk, uOn.base.atk * 1.1, '浪潮之心 only while not blocking');
  assert.ok(on.runUntil(() => uOn.blocking.length > 0, 25), 'the mob reaches her');
  on.run(0.2); off.run(25);
  assert.deepEqual(uOn.findBuff('acpion:module').mods, { atkPct: 0.08, defPct: 0.08 }, '阻挡敌人时攻击力和防御力各+8%');
  approx(uOn.s.atk, uOn.base.atk * (1 + 0.1 + 0.08), 'ATK +8% while blocking');
  approx(uOn.s.def, uOn.base.def * 1.08, 'DEF +8% while blocking');
  assert.equal(uOff.findBuff('acpion:module'), null, '不装备: no module buff');
  approx(uOff.s.atk, uOff.base.atk * 1.1);
  approx(uOff.s.def, uOff.base.def, '不装备: no DEF bonus');
  done(on); done(off);
});

test('模组 PRO-X Mechanist: 阻挡敌人时防御力+20%, 精研材料 +0.2 below half HP', () => {
  const mk = (moduleId) => battle([{ chessId: MECH, row: 9, col: 4, ...(moduleId ? { moduleId } : {}) }],
    { spawns: [{ key: 'e_mob', pos: [9, 7], route: walk(9, 7) }] });
  const on = mk(), off = mk('none');
  const uOn = on.unit(MECH), uOff = off.unit(MECH);
  assert.ok(on.runUntil(() => uOn.blocking.length > 0, 25), 'the mob reaches her');
  on.run(0.2); off.run(25);
  assert.deepEqual(uOn.findBuff('acfend:module').mods, { defPct: 0.2 }, '阻挡敌人时防御力+20%');
  approx(uOn.s.def, uOn.base.def * (1 + 0.1 + 0.2), '精研材料 +10% (≥ half HP) and the module +20%');
  assert.equal(uOff.findBuff('acfend:module'), null, '不装备: no module buff');
  approx(uOff.s.def, uOff.base.def * 1.1);
  done(on); done(off);
  // 精研材料's below-half-HP part is the module's upgraded 0.2 (the base talent has 0.1)
  for (const [h, expected] of [[on, 0.2], [off, 0.1]]) {
    const u = h.unit(MECH);
    u.hp = u.s.maxHp * 0.4;
    h.run(0.3);
    approx(u.findBuff('acfend:t1').mods.defPct, 0.1 + expected, `${expected === 0.2 ? '模组' : '不装备'}: 生命值低于50%时 +${expected}`);
    done(h);
  }
});

test('模组 DRE-X Sharp: 攻击被阻挡的敌人时攻击力提升至115% (不装备: 100%)', () => {
  const mk = (moduleId) => battle([{ chessId: SHARP, row: 9, col: 4, ...(moduleId ? { moduleId } : {}) }],
    { spawns: [{ key: 'e_mob', pos: [9, 7], route: walk(9, 7) }] });
  const on = mk(), off = mk('none');
  const uOn = on.unit(SHARP), uOff = off.unit(SHARP);
  const plain = (h, u) => dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash);
  let tOn = null, tOff = null;
  assert.ok(on.runUntil(() => { if (!tOn && uOn.blocking.length) tOn = on.b.time; return !!tOn; }, 25), 'the mob blocks her');
  assert.ok(off.runUntil(() => { if (!tOff && uOff.blocking.length) tOff = off.b.time; return !!tOff; }, 25));
  on.run(4); off.run(4);
  const blockedOn = plain(on, uOn).filter((c) => c.t >= tOn), blockedOff = plain(off, uOff).filter((c) => c.t >= tOff);
  assert.ok(blockedOn.length >= 2 && blockedOff.length >= 2, 'she attacks the blocked enemy');
  for (const c of blockedOn) approx(c.amount, uOn.s.atk * 1.15, '攻击被阻挡的敌人时攻击力提升至115%');
  for (const c of blockedOff) approx(c.amount, uOff.s.atk, '不装备: 100%');
  // …and the hits on the still-walking enemy (1 tile away, in range but NOT blocked) stay 100 % with the module
  const walking = plain(on, uOn).filter((c) => c.t < tOn);
  for (const c of walking) approx(c.amount, uOn.s.atk, 'not blocked yet: 100 %');
  done(on); done(off);
});

test('模组 MAR-X Stormeye: 攻击空中单位时攻击力提升至110% (+ 风坠 ×1.9, 不装备 ×1.8)', () => {
  const mk = (moduleId) => battle([{ chessId: STORM, row: 11, col: 4, ...(moduleId ? { moduleId } : {}) }], {
    recs: { e_fly: enemyRec({ key: 'e_fly', hp: 1e7, speed: 0, atk: 0, motion: 'FLY' }) },
    spawns: [{ key: 'e_fly', pos: [11, 6] }],
  });
  const on = mk(), off = mk('none');
  const uOn = on.unit(STORM), uOff = off.unit(STORM);
  on.step(); off.step();
  assert.equal(uOn.profile.flyScale, 1.1, '攻击空中单位时攻击力提升至110%');
  assert.equal(uOff.profile.flyScale, 1, '不装备: no fly bonus');
  approx(D(STORM).talents[0].bb.atk_scale, 1.9, '风坠 ×1.9 with the module');
  approx(DM(STORM, null, 'none').talents[0].bb.atk_scale, 1.8, '×1.8 without');
  assert.ok(on.runUntil(() => dealt(on, uOn, (c) => c.dmg.isAttack && !c.dmg.isSplash).length >= 1, 12));
  off.run(12);
  const ratios = (h, u) => new Set(dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash).map((c) => Math.round((c.amount / u.s.atk) * 1000) / 1000));
  for (const r of ratios(on, uOn)) assert.ok([1.1, 2.09].some((x) => Math.abs(r - x) < 1e-3), `模组 vs a flyer: ${r} (×1.1, ×1.1×1.9 on a 风坠 proc)`);
  for (const r of ratios(off, uOff)) assert.ok([1, 1.8].some((x) => Math.abs(r - x) < 1e-3), `不装备 vs a flyer: ${r}`);
  done(on); done(off);
});

test('模组 SPC-X Pith: 攻击范围扩大 — the module grid replaces her own (+ 授我所授 20%)', () => {
  const mod = modRec(PITH, 'uniequip_002_accast');
  const grid = (mod.talentChanges.find((t) => t.talentIndex === -1 && Array.isArray(t.rangeGrid)) || {}).rangeGrid;
  assert.ok(Array.isArray(grid) && grid.length, 'the module range-only talent change');
  const on = battle([{ chessId: PITH, row: 11, col: 4 }]);
  const off = battle([{ chessId: PITH, row: 11, col: 4, moduleId: 'none' }]);
  const uOn = on.unit(PITH), uOff = off.unit(PITH);
  on.step(); off.step();
  assert.equal(grid.length, 10, '攻击范围扩大: the 3×3 caster range + the centre tile');
  assert.equal(uOn.rangeKeys.length, grid.length, 'the module range in battle');
  assert.equal(uOff.rangeKeys.length, 9, '不装备: her own 3×3');
  assert.deepEqual(attackRangeGrid(D(PITH).raw), grid, 'the client-facing range helper agrees');
  approx(D(PITH).talents[1].bb.atk, 0.2, '授我所授 +20% with the module');
  approx(DM(PITH, null, 'none').talents[1].bb.atk, 0.1, '+10% without');
  done(on); done(off);
});

test('模组 PHY-X Touch: 治疗生命值低于50%的友方单位时治疗量提升15% (+ 超脱 8 SP)', () => {
  const mk = (moduleId) => battle([
    { chessId: TOUCH, row: 11, col: 4, uid: 1, ...(moduleId ? { moduleId } : {}) },
    { chessId: 't_ally', row: 11, col: 6, uid: 2 },
  ], { chess: { t_ally: chessRec({ id: 't_ally', stats: { maxHp: 3e5, atk: 0 } }) } });
  const on = mk(), off = mk('none');
  const uOn = on.unit(1), uOff = off.unit(1);
  for (const h of [on, off]) { h.step(); const a = h.unit(2); a.hp = a.s.maxHp * 0.4; }
  assert.ok(on.runUntil(() => heals(on, uOn).length >= 1, 10), 'Touch heals');
  off.run(10);
  approx(heals(on, uOn)[0].amount, uOn.s.atk * 1.15, '治疗量提升15%');
  approx(heals(off, uOff)[0].amount, uOff.s.atk, '不装备: a plain heal');
  approx(D(TOUCH).talents[1].bb.sp, 8, '超脱 8 点技力 with the module');
  approx(DM(TOUCH, null, 'none').talents[1].bb.sp, 5, '5 without');
  done(on); done(off);
});

test('模组 DEC-X Raidian: 攻击范围内存在敌人时技力自然恢复速度+0.2/秒 (+ 同调 +20/+12)', () => {
  const mk = (moduleId) => battle([
    { chessId: RAIDIAN, row: 11, col: 5, ...(moduleId ? { moduleId } : {}) },
    { chessId: TULIP, row: 12, col: 5, uid: 2 },
  ], { spawns: [{ key: 'e_still', pos: [11, 7] }] });
  const on = mk(), off = mk('none');
  const uOn = on.unit(RAIDIAN), uOff = off.unit(RAIDIAN);
  on.run(0.3); off.run(0.3);
  assert.equal(uOn.rangeKeySet.size > 0, true);
  approx(uOn.s.aspd, uOn.base.aspd + 20, '同调 攻击速度+20 with the module');
  approx(uOff.s.aspd, uOff.base.aspd + 15, '+15 without');
  approx(on.unit(2).s.aspd, on.unit(2).base.aspd + 12, '相邻的干员 +12 with the module');
  approx(off.unit(2).s.aspd, off.unit(2).base.aspd + 10, '+10 without');
  const sp = (h, u) => { const s0 = u.skill.sp; h.run(3); return u.skill.sp - s0; };
  const dOn = sp(on, uOn), dOff = sp(off, uOff);
  approx(dOn, (uOn.s.spRecovery + 0.2) * 3, '攻击范围内存在敌人时 技力自然恢复速度+0.2/秒', 0.05);
  approx(dOff, uOff.s.spRecovery * 3, '不装备: the plain recovery', 0.05);
  assert.ok(dOn > dOff, 'the module SP tick is the difference');
  done(on); done(off);
});

test('模组 EXE-X Misery: 周围四格没有友方干员时攻击力+10% (+ 二象命末 +5%/15%)', () => {
  const mk = (moduleId, ally = false) => battle([
    { chessId: MISERY, row: 9, col: 4, ...(moduleId ? { moduleId } : {}) },
    ...(ally ? [{ chessId: TULIP, row: 10, col: 4, uid: 2 }] : []),
  ], { spawns: [{ key: 'e_still', pos: [9, 6] }] });
  const on = mk(), off = mk('none'), withAlly = mk(undefined, true);
  const uOn = on.unit(MISERY), uOff = off.unit(MISERY);
  on.run(0.3); off.run(0.3); withAlly.run(0.3);
  assert.deepEqual(uOn.findBuff('acspec:module').mods, { atkPct: 0.1 }, '周围四格没有友方干员时攻击力+10%');
  approx(uOn.s.atk, uOn.base.atk * (1 + 0.1 + 0.05), 'the module trait + 二象命末 (0.05 with the module)');
  assert.equal(uOff.findBuff('acspec:module'), null, '不装备: no module buff');
  approx(uOff.s.atk, uOff.base.atk, '不装备: no bonus');
  assert.equal(withAlly.unit(MISERY).findBuff('acspec:module'), null, 'an ally on the 4 tiles turns it off');
  approx(withAlly.unit(MISERY).s.atk, withAlly.unit(MISERY).base.atk * 1.05, 'only 二象命末');
  done(on); done(off); done(withAlly);
});

test('freePicks 二象命末: the proc chance comes from `attack@prob` — it procs on its own (10 %, 15 % with the module)', () => {
  // regression: the kit read `prob` (undefined ⇒ never procced) instead of the data key `attack@prob`
  for (const moduleId of [undefined, 'none']) {
    const h = battle([{ chessId: MISERY, row: 9, col: 4, ...(moduleId ? { moduleId } : {}) }],
      { spawns: [{ key: 'e_still', pos: [9, 5] }] });   // in her 2-tile range, so she attacks it
    const u = h.unit(MISERY);
    assert.ok(h.runUntil(() => dealt(h, u, tagged('doubleHit')).length >= 1, 40),
      `${moduleId ? '不装备' : '模组'}: 二象命末 procs with the default skill`);
    done(h);
  }
  approx(D(MISERY).talents[0].bb['attack@prob'], 0.15, 'the module X-3 raises it to 15 %');
  approx(DM(MISERY, null, 'none').talents[0].bb['attack@prob'], 0.1, '10 % without');
});

test('模组 LOR-X 领主·Sharp: 攻击附带10%攻击力的法术伤害 (+ 无声之锋 +25%/35%)', () => {
  const mk = (moduleId) => battle([{ chessId: LORD, row: 11, col: 4, ...(moduleId ? { moduleId } : {}) }],
    { spawns: [{ key: 'e_still', pos: [11, 6] }] });
  const on = mk(), off = mk('none');
  const uOn = on.unit(LORD), uOff = off.unit(LORD);
  on.step(); off.step();
  approx(uOn.s.dodgeArts, 0.35, '无声之锋 25% → 35% with the module');
  approx(uOff.s.dodgeArts, 0.25, '25% without');
  assert.ok(on.runUntil(() => dealt(on, uOn, (c) => c.dmg.isAttack).length >= 1, 12), 'she attacks');
  off.run(12);
  const rider = dealt(on, uOn, (c) => c.dmg.type === 'arts' && (c.dmg.tags || []).includes('module'));
  assert.ok(rider.length >= 1, '攻击附带10%攻击力的法术伤害');
  for (const c of rider) { approx(c.amount, uOn.s.atk * 0.1, '10 % of her ATK'); assert.equal(c.target.side, 'enemy'); }
  assert.equal(dealt(off, uOff, (c) => c.dmg.type === 'arts').length, 0, '不装备: no arts rider');
  done(on); done(off);
});

// =================================================================================================================
// 1050_chen3 赤刃明霄陈 火陈 — S3 赤霄·天喟's 剑气长龙 ("火龙", user report 2026-10-03: "火陈的火龙现在也没有实现")

test('火陈 S3 剑气长龙: 沿朝向贯穿一条直线 —— max(当前生命6%, 攻击力530%) 法术,可对空,每个敌人只判定一次', () => {
  const id = CHEN, b = bbOf(id, 2);
  assert.equal(KITS[id] !== undefined, true, 'the kit is registered (it was the GENERIC kit before this fix)');
  assert.equal(skillSpecSource(D(id, 2)), 'skills', 'S3 comes from the kit');
  assert.equal(FREE[id].tokens.length, 0, 'fixture: 火陈 has NO summon token — her "火龙" is this skill, not a token');
  const FAT = 1e6, THIN = 20000;
  const h = battle([{ chessId: id, row: 10, col: 4, skillIndex: 2, carryState: READY }], {
    recs: {
      e_fat: enemyRec({ key: 'e_fat', hp: FAT, speed: 0, atk: 0 }),
      e_thin: enemyRec({ key: 'e_thin', hp: THIN, speed: 0, atk: 0 }),
      e_fly: enemyRec({ key: 'e_fly', hp: FAT, speed: 0, atk: 0, motion: 'FLY' }),   // 剑气可对空
      e_back: enemyRec({ key: 'e_back', hp: FAT, speed: 0, atk: 0 }),
    },
    // all four out of her attack range (S3 covers cols 4–7): only the 剑气 can reach them
    spawns: [{ key: 'e_fat', pos: [10, 8] }, { key: 'e_thin', pos: [10, 9] }, { key: 'e_fly', pos: [10, 10] }, { key: 'e_back', pos: [10, 2] }],
  });
  const u = h.unit(id);
  h.step();
  assert.deepEqual(u.fwd, [0, 1], 'fixture: she faces right (the 剑气 flies along +col)');
  assert.ok(u.skill.activate('test', { free: true }), 'S3 opens');
  h.run(2.0);
  assert.equal(dealt(h, u, tagged('swordQi')).length, 0, 'nothing yet: the 剑气 travels at 1.5 tiles/s (4 tiles = 2.67 s)');
  // the 1.3 碰撞半径 (备注) puts the leading sample within reach of the first enemy one tile earlier than a tile sweep
  // would — at t ≈ 2.03 s — while the next one (col 9) is reached at t ≈ 2.70 s: 0.6 s isolates the first hit
  h.run(0.6);
  const early = dealt(h, u, tagged('swordQi'));
  assert.equal(early.length, 1, 'the first enemy on the line is hit as the 剑气 reaches it');
  h.run(1.5);   // t ≈ 4.1 s: the qi has swept to the field edge (col 10 at t = 4.0), before its first 转向
  const qi = dealt(h, u, tagged('swordQi'));
  const byTarget = (key) => qi.filter((c) => c.target.defId === `enemy_${key}`);
  assert.equal(qi.length, 3, 'exactly the three enemies of the line, once each in this segment (每次转向前…仅判定一次)');
  for (const c of qi) { assert.equal(c.type, 'arts', '法术伤害'); assert.ok(!c.dmg.isAttack, 'not one of her attacks'); }
  approx(byTarget('e_fat')[0].amount, Math.max(FAT * b.hp_ratio, u.s.atk * b.projectile_min_atk_scale), '6 % of the CURRENT hp');
  approx(byTarget('e_thin')[0].amount, u.s.atk * b.projectile_min_atk_scale, 'below the floor ⇒ 530 % ATK instead');
  assert.equal(qi.indexOf(byTarget('e_fat')[0]) < qi.indexOf(byTarget('e_thin')[0]), true, 'nearer enemy first');
  assert.equal(qi.indexOf(byTarget('e_thin')[0]) < qi.indexOf(byTarget('e_fly')[0]), true, 'then farther');
  assert.ok(byTarget('e_fly').length === 1, '可对空: the flying enemy is pierced too');
  assert.equal(byTarget('e_back').length, 0, 'the enemy BEHIND her is not touched (向前)');
  // 转向: at the field edge the qi turns 90° clockwise — and the 侵入点 (9,10) one tile further turns it a second time —
  // so it comes back along row 10. A turn CLEARS the per-segment 仅判定一次 set ("每次转向前对每个敌人仅判定一次伤害"),
  // so the three enemies of the line are each judged once more on the reverse leg — the observable 盘旋 of the report.
  h.run(0.8);   // t ≈ 4.9 s: the first reverse step (10,9) landed at t = 4.667
  const back = dealt(h, u, tagged('swordQi'));
  const backTarget = (key) => back.filter((c) => c.target.defId === `enemy_${key}`);
  assert.equal(back.length, qi.length + 3, 'the reverse segment re-judges the three enemies it passes, once each');
  assert.equal(backTarget('e_back').length, 0, 'the enemy behind her is still untouched (the reverse leg has not reached col 2)');
  done(h);
});

test('火陈 S3 剑气长龙: 横跨两格的巨型敌人只判定一次 (每次转向前对每个敌人仅判定一次伤害)', () => {
  const id = CHEN;
  // A 巨型单位 (body.js `hitArea`, w 2.5 ⇒ its body covers cols 7–9 of her row) sitting on the line she pierces. Per-tile
  // hit collection with no cross-tile memory hit it once per occupied tile the 剑气 swept — 3 instances — while PRTS 备注
  // of 赤霄·天喟 ("每次转向前对每个敌人仅判定一次伤害") says ONE per segment, and the 剑气 never turns here.
  const huge = enemyRec({ key: 'e_huge', hp: 1e6, speed: 0, atk: 0, bat: 2 });
  huge.hitArea = { w: 2.5, h: 1 };
  const h = battle([{ chessId: id, row: 10, col: 4, skillIndex: 2, carryState: READY }], {
    recs: { e_huge: huge },
    spawns: [{ key: 'e_huge', pos: [10, 8] }],
  });
  const u = h.unit(id);
  h.step();
  const e = h.enemy('enemy_e_huge');
  assert.ok(bodyKeys(e).length >= 2, `fixture: the body covers ${bodyKeys(e).length} tiles of her row`);
  assert.equal(Math.round(e.y), u.tileR, 'fixture: the 巨型敌人 stands on the 剑气\'s line');
  assert.ok(u.skill.activate('test', { free: true }), 'S3 opens');
  assert.ok(h.runUntil(() => dealt(h, u, tagged('swordQi')).length >= 1, 10), 'the straight segment reaches the body');
  h.run(1.5);   // the qi sweeps on over the whole body (cols 7–9) to the field edge — still the SAME segment
  const qi = dealt(h, u, tagged('swordQi'));
  assert.equal(qi.length, 1, 'exactly ONE instance for a body the qi meets several steps in a row (每段仅判定一次)');
  assert.equal(qi[0].target, e, 'and it is the 巨型敌人');
  // the field edge turns the qi clockwise (twice: the 侵入点 (9,10) is one tile further), so it comes back along row 10.
  // A turn starts a NEW segment ⇒ the body is judged once more there — and exactly once for the whole reverse pass.
  assert.ok(h.runUntil(() => dealt(h, u, tagged('swordQi')).length >= 2, 10), 'the reverse segment judges the body again');
  h.run(2.0);
  assert.equal(dealt(h, u, tagged('swordQi')).length, 2, 'one instance per segment, not one per tile of the body');
  done(h);
});

// -----------------------------------------------------------------------------------------------------------------
// 剑气's 转向 — the tile-grid state machine of `projectile_chr_chen3_s3` (see the swordQi doc comment)

/** A clean LOW row (cols 2–18) for the 剑气 scenes (the qi flies over the FIELD: rows 9–12, cols 0–10 of the flat stage). */
const LOW_ROW = '##' + 'r'.repeat(17) + '##';
/** The 剑气 corridor: row 12 with `ch` at col 7 — a trigger tile straight ahead of 火陈 at (12,4) facing RIGHT. */
const corridor = (ch) => '##' + 'rrrrr' + ch + 'r'.repeat(11) + '##';
/** A battle whose 剑气 corridor is row 12 with `ch` at col 7 (`h` 高地 / `S` 侵入点 / `E` 保护目标). */
function qiScene(ch, spawns, o = {}) {
  return battle([{ chessId: CHEN, row: 12, col: 4, skillIndex: 2, carryState: READY }], {
    ...o, spawns,
    extra: { stage: flatStage({ rows: { 9: LOW_ROW, 10: LOW_ROW, 11: LOW_ROW, 12: corridor(ch) } }), ...(o.extra || {}) },
  });
}
/** The tiles the 剑气 has swept ([row, col]; the fx streak draws from → to: x/y = the from tile's col/row, tx/ty the to). */
const qiTrack = (h) => h.eventsOf('fx').filter((e) => e[1] === 'swordQi').map((e) => [e[4].ty, e[4].tx]);

test('火陈 S3 剑气长龙: 前进方向上是高地 ⇒ 顺时针90°转向 (the qi is a tile state machine)', () => {
  const h = qiScene('h', [{ key: 'e_still', pos: [12, 8] }, { key: 'e_still', pos: [10, 6] }]);
  const u = h.unit(CHEN);
  h.step();
  assert.equal(h.b.grid.tile(12, 7).height, 'HIGH', 'fixture: a 高地 tile straight ahead');
  assert.ok(u.skill.activate('test', { free: true }), 'S3 opens');
  h.run(3.5);
  // one tile per 1/1.5 s: (12,5) at 0.67 s, (12,6) at 1.33 s — then the 高地 ahead turns it 90° clockwise (RIGHT → DOWN)
  assert.deepEqual(qiTrack(h).slice(0, 5), [[12, 5], [12, 6], [11, 6], [10, 6], [9, 6]],
    'the qi turns at the 高地 instead of entering it, and sweeps down the new heading');
  const qi = dealt(h, u, tagged('swordQi'));
  assert.equal(qi.filter((c) => c.target.tileC === 6).length, 1,
    'the turned qi damages the enemy two rows below the corridor (a straight flight never reaches it)');
  assert.equal(qi.filter((c) => c.target.tileC === 8).length, 0, 'the enemy BEYOND the 高地 is never touched');
  done(h);
});

test('火陈 S3 剑气长龙: 前进方向上是 保护目标 / 侵入点 ⇒ 同样顺时针90°转向', () => {
  for (const [ch, what] of [['E', '保护目标 (tile_end)'], ['S', '侵入点 (tile_start)']]) {
    const h = qiScene(ch, [{ key: 'e_still', pos: [12, 8] }, { key: 'e_still', pos: [10, 6] }]);
    const u = h.unit(CHEN);
    h.step();
    assert.equal(h.b.grid.tile(12, 7).special, ch === 'E' ? 'end' : 'start', `fixture: a ${what} straight ahead`);
    assert.ok(u.skill.activate('test', { free: true }), 'S3 opens');
    h.run(3.5);
    assert.deepEqual(qiTrack(h).slice(0, 5), [[12, 5], [12, 6], [11, 6], [10, 6], [9, 6]], `${what}: 顺时针转向`);
    const qi = dealt(h, u, tagged('swordQi'));
    assert.equal(qi.filter((c) => c.target.tileC === 6).length, 1, `${what}: the turned qi damages the enemy below it`);
    assert.equal(qi.filter((c) => c.target.tileC === 8).length, 0, `${what}: the enemy beyond it is untouched`);
    done(h);
  }
});

test('火陈 S3 剑气长龙: 转向前后各判定一次 —— 每段对每个敌人仅判定一次伤害', () => {
  const h = qiScene('h', [{ key: 'e_still', pos: [12, 6] }, { key: 'e_still', pos: [12, 3] }]);
  const u = h.unit(CHEN);
  h.step();
  assert.ok(u.skill.activate('test', { free: true }), 'S3 opens');
  const onTurnTile = () => dealt(h, u, tagged('swordQi')).filter((c) => c.target.tileC === 6).length;
  h.run(1.5);   // t = 1.5 s: the qi sits on the turn tile (12,6), where that enemy stands
  assert.equal(onTurnTile(), 1, 'judged once while the straight segment runs');
  h.run(0.6);   // t ≈ 2.1 s: after the turn the qi has stepped down to (11,6) — the enemy is within the 1.3 radius again
  assert.equal(onTurnTile(), 2, 'exactly one more judgement in the new segment (每次转向前…仅判定一次伤害)');
  h.run(1.0);   // t ≈ 3.1 s: the qi passed (10,6) and (9,6) — still the same segment
  assert.equal(onTurnTile(), 2, 'and only once in that segment');
  assert.equal(dealt(h, u, tagged('swordQi')).filter((c) => c.target.tileC === 3).length, 0,
    'the enemy further down the corridor is beyond the 高地 and untouched');
  done(h);
});

test('火陈 S3 天喟: 每次攻击对最多3名地面敌人 3 次 165% 法术 (generic kit could only do 1 次)', () => {
  const id = CHEN, b = bbOf(id, 2);
  const h = battle([{ chessId: id, row: 10, col: 4, skillIndex: 2, carryState: READY }], {
    recs: { e_fly: enemyRec({ key: 'e_fly', hp: 1e6, speed: 0, atk: 0, motion: 'FLY' }) },
    spawns: [
      { key: 'e_still', pos: [10, 6] },   // in range [0,2]
      { key: 'e_still', pos: [10, 7] },   // [0,3]
      { key: 'e_still', pos: [9, 5] },    // [-1,1]
      { key: 'e_fly', pos: [10, 5] },     // 地面敌人 only: the flyer is in range but never attacked
    ],
  });
  const u = h.unit(id);
  h.step();
  assert.ok(u.skill.activate('test', { free: true }), 'S3 opens');
  assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length >= 1, 20), 'she attacks');
  // one attack = one `attackId`: count its instances, not the total over several attacks (a 1-instance-per-attack
  // generic spec would still reach 3 per target after three attacks)
  const all = dealt(h, u, (c) => c.dmg.isAttack);
  const attackId = all[0].dmg.attackId;
  const atk = all.filter((c) => c.dmg.attackId === attackId);
  const per = new Map();
  for (const c of atk) per.set(c.target.id, (per.get(c.target.id) || 0) + 1);
  assert.equal(per.size, Math.floor(b['attack@max_target']), '最多3名地面敌人');
  for (const [, n] of per) assert.equal(n, 3, '3 次 per attack');
  assert.equal(atk.length, 3 * 3, '3 enemies × 3 instances in ONE attack');
  for (const c of atk) { approx(c.amount, u.s.atk * b['attack@atk_scale'], '165 % ATK per instance'); assert.equal(c.type, 'phys', '弱点伤害 vs a 0-DEF / 0-RES dummy (see the 形意洞照 test below)'); }
  assert.equal(all.some((c) => c.target.isFlying), false, '地面敌人: the flyer takes no attack (the 剑气 is what hits flyers)');
  done(h);
});

// 火陈's two talents, ported from PR #71 (SrC2O4, head c76a81f — kits/recruitsSpecial.js `chen3`): 形意洞照
// `{atk:0.13, attack_speed:13}` + 攻击变为弱点伤害, 寒暑觉知 `{stack_time:6, heal_atk_scale_min:50,
// heal_atk_scale_max:201}`. Our own kit keeps its S3 剑气长龙 (the ported kit's S3 is one instantaneous AoE) but takes
// both talents — see the entry in kits/freePicks.js.
test('火陈 形意洞照: 攻击力+13 % / 攻击速度+13, and 攻击变为弱点伤害 picks the target\'s weaker side', () => {
  // 弱点伤害 (the ported rule): the hit's damage type is 法术 when the target's DEF exceeds this attack's own ATK × RES %
  // — i.e. when physics would be mitigated more than arts — and 物理 otherwise
  for (const [key, def, res, want] of [['e_soft', 0, 0, 'phys'], ['e_hard', 500, 0, 'arts']]) {
    const h = battle([{ chessId: CHEN, row: 10, col: 4, skillIndex: 2, carryState: READY }], {
      recs: { [key]: enemyRec({ key, hp: 1e7, speed: 0, def, res }) },
      spawns: [{ key, pos: [10, 5] }],   // her melee tile: the DEFAULT trigger needs an enemy in her own range
    });
    h.step();
    const u = h.unit(CHEN);
    assert.equal(u.s.atk, u.base.atk * 1.13, '形意洞照 攻击力+13%');
    assert.equal(u.s.aspd, u.base.aspd + 13, '形意洞照 攻击速度+13');
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length > 0, 20), 'she attacks');
    assert.equal(dealt(h, u, (c) => c.dmg.isAttack)[0].type, want, `${key}: def ${def} / res ${res}`);
    done(h);
  }
});

test('火陈 寒暑觉知: after 6 s without damage, heals ATK × 50–201 % and gains one hit-shield', () => {
  const h = battle([{ chessId: CHEN, row: 10, col: 4, skillIndex: 2, carryState: READY }], { timeLimit: 30 });
  h.step();
  const u = h.unit(CHEN);
  u.hp = u.s.maxHp * 0.5;
  const t1 = D(CHEN, 2).talents[1].bb;
  assert.ok(h.runUntil(() => heals(h, u, (c) => c.target === u).length > 0, 12), '未受到伤害时每6秒治疗自身');
  const heal = heals(h, u, (c) => c.target === u)[0];
  const lo = (u.s.atk * t1.heal_atk_scale_min) / 100, hi = (u.s.atk * t1.heal_atk_scale_max) / 100;
  assert.ok(heal.amount >= lo - 1e-6 && heal.amount <= hi + 1e-6, `${heal.amount} ∈ [50 %, 201 %] of ATK`);
  assert.ok(u.findBuff('chen3:evade')?.shieldHits === 1, '闪避下次物理与法术攻击 (one hit-shield)');
  done(h);
});

// =================================================================================================================
// 2027_wang 望 — S1 取势 / S2 连星 / S3 天下劫. Two user reports, one class of bug: 棋子's own damage scales appearing
// on 望's own attacks — first the 2.9 of S3 天下劫 (`atk_scale`, reported as "2.9 加到了她自己身上"), then the 1.05 /
// 4.2 of S1 / S2 (`attack@atk_scale`), which stayed on the generic fallback because only S3 was authored.

test('望 S1 取势 / S2 连星: 棋子\'s passive scale (attack@atk_scale) never lands on HER own attack', () => {
  const id = WANG;
  for (const si of [0, 1]) {
    const rec = FREE[id].skills[si];
    // both numbers are the 棋子's trigger damage, read off 望's own ATK ("棋子触发时…相当于望攻击力的N%") and carried a
    // second time, unprefixed, on 棋子's own skill (data/tokens.json `sktok_wang_1` / `sktok_wang_2`, tokens.js wangStone)
    const scale = rec.bb['attack@atk_scale'];
    assert.ok(scale > 1, `fixture: S${si + 1} ${rec.name} attack@atk_scale = ${scale} — 棋子's trigger scale`);
    assert.equal(rec.durationType, 'NONE', `fixture: S${si + 1} 立即获得两枚棋子, no duration`);
    const h = battle([{ chessId: id, row: 10, col: 4, skillIndex: si, carryState: READY }], {
      spawns: [{ key: 'e_still', pos: [10, 7] }],
    });
    const u = h.unit(id);
    h.step();
    assert.ok(u.kit && !u.kit.generic, 'a hand-authored kit on the unit');
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length >= 3, 20), 'she attacks');
    // the ready skill auto-casts in the same tick as her first attack (an instant spec's override is pending for
    // exactly that attack) — the window the generic spec put 棋子's scale into
    assert.equal(h.hooksOf('skillStart').some((c) => c.unit === u), true, `S${si + 1} casts while she attacks`);
    for (const c of dealt(h, u, (c) => c.dmg.isAttack)) approx(c.amount, u.s.atk, `${scale} × ATK must not be hers`);
    assert.equal(u.skill.spec.attack?.atkScale, undefined, `her own attack does NOT carry the ${scale} (it belongs to 棋子)`);
    // 取势's `attack@sluggish` 6.5 is 棋子's 停顿 on the enemy that stepped on it, not a status her attacks inflict
    if (rec.bb['attack@sluggish']) assert.equal(h.enemies()[0].findBuff('sluggish'), null, "棋子's 停顿 is not hers either");
    // kept from the generic path (only the leak is gone): the instant cast its own metadata derives, the data's SP
    assert.equal(u.skill.kind, 'instant', 'an instant cast, as the generic spec derived');
    assert.equal(u.skill.duration, 0, 'no duration');
    assert.equal(u.skill.ammo, 0, 'no ammo');
    assert.equal(u.skill.spCost, rec.spCost, `SP cost from the record (S${si + 1})`);
    assert.equal(rec.spType, 'INCREASE_WITH_TIME', `fixture: S${si + 1} SP type`);
    assert.equal(u.skill.spType, 'time', 'SP type from the record');
    assert.equal(u.skill.spec.targeting, undefined, 'no targeting override (neither S1 nor S2 has a skill range)');
    assert.equal(h.hooksOf('skillEnd').some((c) => c.unit === u && c.reason === 'instant'), true, 'the instant cast ends on its attack, as with the generic spec');
    done(h);
  }
});

test('望 S1 取势 / S2 连星: the GENERIC kit she used to run — both scales on her own attacks (the report, for the record)', () => {
  const id = WANG;
  for (const si of [0, 1]) {
    const scale = FREE[id].skills[si].bb['attack@atk_scale'];
    // `kits: { [id]: () => null }` = the generic fallback (the harness `kits` injection the loadout tests use)
    const h = battle([{ chessId: id, row: 10, col: 4, skillIndex: si, carryState: READY }], {
      spawns: [{ key: 'e_still', pos: [10, 7] }],
      extra: { kits: { [WANG]: () => null } },
    });
    const u = h.unit(id);
    h.step();
    assert.equal(u.skill.spec.attack?.atkScale, scale, `the generic kit reads attack@atk_scale as HER attack scale (${scale})`);
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length >= 1, 5), 'and she attacks with it');
    approx(dealt(h, u, (c) => c.dmg.isAttack)[0].amount, u.s.atk * scale, `${scale * 100} % of her ATK instead of 100 %`);
    done(h);
  }
});

test('望: all three skills (S1 取势 / S2 连星 / S3 天下劫) come from the kit, never the generic fallback', () => {
  const id = WANG;
  assert.equal(KITS[id] !== undefined, true, 'the kit is registered');
  for (const s of FREE[id].skills) assert.equal(skillSpecSource(D(id, s.index)), 'skills', `${id} ${s.skillId}`);
  for (const s of FREE[id].skills) {
    const h = battle([{ chessId: id, row: 10, col: 4, skillIndex: s.index }]);
    h.step();
    const u = h.unit(id);
    assert.equal(u.kit.skillSource, 'skills', `${s.skillId} runs the kit's own spec`);
    done(h);
  }
});

test('望 S3 天下劫: 停止攻击 —— an AMMO skill must set noAttack too (the generic kit only stops `duration` kinds)', () => {
  const id = WANG, b = bbOf(id, 2);
  assert.equal(KITS[id] !== undefined, true, 'the kit is registered (she ran the GENERIC kit before this fix)');
  assert.equal(skillSpecSource(D(id, 2)), 'skills', 'S3 comes from the kit');
  assert.equal(FREE[id].skills[2].durationType, 'AMMO', 'fixture: 装有20发弹药');
  approx(b.trigger_time, 20, 'fixture: 20 发弹药');
  approx(b.atk_scale, 2.9, "fixture: 天下劫's 2.9 — the damage scale of 棋子's own skill (data/tokens.json `sktok_wang_3`)");
  // no `carryState: READY`: a MANUAL skill that is ready would auto-cast on the DEFAULT rule (the enemy in her range),
  // and this test needs her to attack normally first (sp 38/57 at the start)
  const h = battle([{ chessId: id, row: 10, col: 4, skillIndex: 2 }], {
    hooks: [...HOOKS, 'ammoUsed'],
    spawns: [{ key: 'e_still', pos: [10, 7] }],
  });
  const u = h.unit(id);
  h.step();
  assert.ok(u.kit && !u.kit.generic, 'a hand-authored kit on the unit');
  assert.equal(u.kit.skillSource, 'skills');
  assert.equal(u.skill.spec.attack?.atkScale, undefined, 'her own attack does NOT carry the 2.9 (it belongs to 棋子)');
  // before the skill she attacks normally: 1.0 × ATK — never 2.9 × ATK
  assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length >= 1, 10), 'she attacks before the skill');
  approx(dealt(h, u, (c) => c.dmg.isAttack)[0].amount, u.s.atk, 'a normal attack carries 1.0 × ATK');
  const r0 = u.rangeKeys.length, n0 = dealt(h, u, (c) => c.dmg.isAttack).length;
  assert.ok(u.skill.activate('test', { free: true }), 'S3 opens');
  assert.equal(u.skill.ammoLeft, 20, 'the skill starts with its 20 rounds');
  assert.ok(u.rangeKeys.length > r0, `攻击范围扩大 (${r0} → ${u.rangeKeys.length} tiles)`);
  h.run(5);
  assert.equal(dealt(h, u, (c) => c.dmg.isAttack).length, n0, '停止攻击: not one attack while the skill runs');
  // Nothing spends the rounds yet (the 棋子 grant / ammo economy / mid-combat placement is the next batch, so `noAttack`
  // would hold for ever): the kit's fallback spends one round per second and the skill ends by the AMMO path.
  assert.ok(h.runUntil(() => !u.skill.active, 30), 'the fallback ends the skill');
  assert.equal(h.hooksOf('skillEnd').some((c) => c.unit === u && c.reason === 'ammo'), true, 'ended by the ammo path');
  const ammo = h.hooksOf('ammoUsed');
  assert.equal(ammo.length, 20, '20 rounds spent (one per second)');
  assert.equal(ammo[ammo.length - 1].left, 0, 'the last one empties the magazine');
  assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length > n0, 15), 'she attacks again after it');
  approx(dealt(h, u, (c) => c.dmg.isAttack)[n0].amount, u.s.atk, 'and still 1.0 × ATK — the 2.9 was never hers');
  done(h);
});

test('望 S3 天下劫: the GENERIC kit she used to run — attacking during the skill, at 2.9 × ATK (the report, for the record)', () => {
  const id = WANG;
  // `kits: { [id]: () => null }` = the generic fallback (the harness `kits` injection the loadout tests use)
  const h = battle([{ chessId: id, row: 10, col: 4, skillIndex: 2, carryState: READY }], {
    spawns: [{ key: 'e_still', pos: [10, 7] }],
    extra: { kits: { [WANG]: () => null } },
  });
  const u = h.unit(id);
  h.step();
  assert.equal(u.kit.generic, true, 'the injected kit leaves the generic spec');
  assert.equal(u.skill.active, true, 'the ready skill auto-casts on the enemy in her range');
  assert.equal(u.skill.kind, 'ammo', 'her S3 is an AMMO skill — the generic kit only sets noAttack for `duration` kinds');
  approx(u.skill.spec.attack.atkScale, 2.9, "the skill's passive 2.9, read as HER attack scale");
  assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length >= 1, 5), 'and she kept attacking while it runs');
  approx(dealt(h, u, (c) => c.dmg.isAttack)[0].amount, u.s.atk * 2.9, '290 % of her ATK instead of 100 %');
  done(h);
});
