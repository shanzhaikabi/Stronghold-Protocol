// server/sim/content/genericTalents.js — the TALENT half of the generic kit (server/sim/content/generic.js).
//
// Why this exists: `genericKit` is the fallback for every chess without a hand-authored kit — 76 of the 93 自选干员
// records of `data/freePicks.json` (plus 火陈 and 望, whose kits author a skill but no talent) at the time of writing.
// It used to return `talents: []`, and `Battle.js` installs `u.kit.talents` and nothing else, so "kit-less" meant
// "talent-less": 78 of the 93 picks fought with NONE of the talents their own record declares (152 of 180), and the
// 133 module `talentChanges` of those records were dead with them — the module change DOES reach the resolved
// `def.talents` (measured: 凯尔希's uniequip_002 module puts `{cnt,def,attack_speed}` there, S7 of the audit), but
// nothing read it. This module reads `def.talents` — the LOADOUT-RESOLVED def, so the module half comes for free.
//
// What it does: it translates the blackboard of a declared talent into the existing kit DSL (`{ install(battle, unit) }`
// hooks, docs/SIM.md §7.2) for the patterns that can be reproduced faithfully, and it REPORTS every talent — and every
// half of a half-expressed talent — it cannot. Nothing is dropped silently: `translateTalents` returns one record per
// declared talent (`installed` / `partial` / `unexpressed` + the exact keys/reasons), `test/content/generic_talents.test.js`
// pins the result, and `docs/research/15-generic-talents.json` is the generated research note (tools/talent-plan.mjs).
//
// Covered patterns (rule → DSL):
//   selfStat / selfStatHpBelow / selfStatIdle / selfStatUnblocked / selfStatBlocking
//       plain self stat keys → a persistent stat buff (`Battle.addBuff` {persist, allowDead, tags:['talent']}),
//       conditionally kept by `toggleBuff` (HP ratio, "未进行攻击 N 秒", "未阻挡敌人时", "阻挡时")
//   auraProfession / auraRange   "所有【术师】…干员" / "攻击范围内的友方单位" → an aura over the selected allies
//   attackProc / attackProcRider "攻击时有 N% 概率攻击力提升至 M%" (×prob, optional def-down rider) → a `hit` multiplier
//   deployStun                   plain `stun` + "部署后立即对攻击范围内一个敌人…晕眩 N 秒" → on-deploy status
//   deploySp / deploySpRandom / deployCost   "部署后立即获得 N 点技力" / `sp_min sp_max` / `runtime_cost`
//   intervalSp                   `interval` + `sp` ("每 N 秒回复…技力")
//   fieldTimer                   `interval` + stat keys ("在战场停留 N 秒后…")
//
// NOT covered (recorded, never guessed) — the reasons the report carries: summon/count mechanics (`cnt`, `max_cnt`),
// "编入队伍时" roster/deploy-cost effects with no in-sim channel, damage-form/element riders, status-effect talents,
// threshold stacks, per-skill ("技能期间") talents that a skill-less kit cannot host, namespaced `ns[tag].key` groups
// other than the plain `ns[tag].<statKey>` fold, and every blackboard whose keys the sim has no mod for.
//
// Numbers always come from the record's own blackboards (`def.talents[i].bb`, resolved for the unit's module);
// the few literals are documented at their use.

import { bodyInKeys } from '../body.js';
import { canTargetEnemy, sortEnemyTargets } from '../targeting.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : undefined));
const up = (u) => !!(u && u.alive && u.deployed);

/** Profession names as a talent description writes them (【术师】…) → the data profession id. */
export const PROFESSION_BY_NAME = Object.freeze({
  先锋: 'PIONEER', 近卫: 'WARRIOR', 狙击: 'SNIPER', 重装: 'TANK', 医疗: 'MEDIC', 辅助: 'SUPPORT', 术师: 'CASTER', 特种: 'SPECIAL',
});

/**
 * Blackboard stat key → kit mods (docs/SIM.md §7.4's own mapping, minus the skill-only keys). `ctx.bat` is the unit's
 * base attack time (a `base_attack_time` blackboard entry is a FLAT change in seconds: freePicks `batFlat`).
 */
const STAT_MODS = {
  atk: (v) => (Math.abs(v) > 5 ? { atkFlat: v } : { atkPct: v }),
  def: (v) => (Math.abs(v) > 5 ? { defFlat: v } : { defPct: v }),
  max_hp: (v) => (Math.abs(v) > 5 ? { hpFlat: v } : { hpPct: v }),
  attack_speed: (v) => ({ aspd: v }),
  base_attack_time: (v, ctx) => ({ batPct: Math.max(-0.9, v / ctx.bat) }),
  magic_resistance: (v) => (Math.abs(v) < 1 ? { resMul: Math.max(0, 1 + v) } : { resFlat: v }),
  block_cnt: (v) => ({ blockCnt: v }),
  taunt_level: (v) => ({ taunt: v }),
  damage_resistance: (v) => ({ dmgTakenMul: 1 - v }),
  damage_scale: (v) => ({ dmgDealtMul: v }),
  heal_scale: (v) => ({ healingTakenMul: v }),
  sp_recovery_per_sec: (v) => ({ spRecoveryFlat: v }),
  hp_recovery_per_sec: (v) => ({ hpRegen: v }),
  hp_recovery_per_sec_by_max_hp_ratio: (v) => ({ hpRegenRatio: v }),
  magic_resist_penetrate_fixed: (v) => ({ resIgnoreFlat: v }),
  def_penetrate_fixed: (v) => ({ defIgnoreFlat: v }),
  def_penetrate_ratio: (v) => ({ defIgnorePct: v }),
  magic_resist_penetrate_ratio: (v) => ({ resIgnorePct: v }),
  move_speed: (v) => ({ moveMul: Math.max(0, 1 + v) }),
};
const STAT_KEYS = Object.freeze(Object.keys(STAT_MODS));

/** Conditions a helper below models exactly; their presence anywhere else makes a talent unexpressible. */
const CONDITIONAL = /低于|高于|少于|多于|不低于|不高于|阻挡|未阻挡|未进行攻击|未攻击|技能期间|技能结束时|每\d|概率|几率|仅一次|首次|受到伤害后|被击倒|起飞|存在\d+(名|个)|状态下|累计|叠加|时/;

/** Wording that makes a "self" reading wrong: the effect belongs to allies / summons / tiles / a state. */
const NOT_SELF = /所有|友方|友军|【|全场|周围|相邻|地块|该(角色|干员|单位)|召唤物|浮游单元|装置|起飞|处于|目标|播种/;
/** The same, without the wording a penetrate talent legitimately uses ("自身与浮游单元无视敌人…"). */
const AURA_ONLY = /所有|友方|友军|【|全场/;

/**
 * The blackboard keys a rule consumed (installed or explicitly noted as dropped). Every OTHER key of the talent becomes
 * an automatic "not expressed" note, so a half-expressed talent can never look complete (134_ifrit 莱茵回路 keeps its
 * namespaced `ifrit_e_002[dice_sp].*` sub-effect on the record).
 */
function consumedKeys(rule, bb) {
  switch (rule) {
    case 'deployStun': return ['stun'];
    case 'deployCost': return ['runtime_cost'];
    case 'deploySp': case 'deploySpRandom': return ['sp', 'sp_min', 'sp_max'];
    case 'intervalSp': return ['interval', 'sp'];
    case 'hand:ash:assault': return ['runtime_cost', 'sp'];
    case 'onHurtSp': return ['prob', 'sp'];
    case 'nearbyKillSp': return ['sp'];
    case 'attackProc': case 'attackProcRider': return ['atk_scale', 'prob', 'def', 'defdown_duration', 'duration'];
    case 'attackVsLowHp': return ['hp_ratio', 'damage_scale'];
    case 'blockedEnemyDebuff': return ['attack_speed'];
    default: return Object.keys(bb);
  }
}

/** Build mods for the given keys, or null when a key has no faithful mod. */
function modsOf(bb, keys, ctx) {
  const mods = {};
  for (const k of keys) {
    const v = num(bb[k]);
    if (v === undefined || !STAT_MODS[k]) return null;
    Object.assign(mods, STAT_MODS[k](v, ctx));
  }
  return mods;
}

// ---------------------------------------------------------------------------------------------------------------
// per-unit helpers (self-contained: this module must not import kits/*, which import generic.js back)

/** Permanent talent stat buff (survives death / redeploy; the same shape the kits use). */
function statBuff(battle, unit, key, mods) {
  const m = {};
  for (const [k, v] of Object.entries(mods)) if (Number.isFinite(v) && v !== 0 && !(k.endsWith('Mul') && v === 1)) m[k] = v;
  if (Object.keys(m).length) battle.addBuff(unit, { key, mods: m, persist: true, allowDead: true, tags: ['talent'], visible: true });
}

/** Keep buff `key` on `unit` exactly while `cond()` holds. */
function toggleBuff(battle, unit, key, cond, mods) {
  const check = () => {
    const want = up(unit) && !!cond();
    const cur = unit.findBuff(key);
    if (want && !cur) battle.addBuff(unit, { key, mods, tags: ['talent'], visible: true });
    else if (!want && cur) battle.removeBuff(unit, key);
  };
  battle.on('tick', check, { owner: unit });
  battle.on('battleStart', check, { owner: unit });
  battle.on('deploy', (ctx) => { if (ctx.unit === unit && battle.started) check(); }, { owner: unit });
}

/** "获得 N 点技力" (the engine refuses SP while a timed skill runs — AK: none during a skill). */
function giveSp(unit, n) {
  if (!unit || !unit.skill || unit.skill.noSkill || (unit.skill.active && unit.skill.isTimed) || !(n > 0)) return 0;
  return unit.skill.gainSp(n, 'talent');
}

/** Every `0.5` s, (re)buff the allies `select()` returns (an aura lapses a moment after its source stops). */
function auraPulse(battle, unit, key, mods, select, gate = null) {
  if (!Object.keys(mods).length) return;
  battle.every(0.5, () => {
    if (!up(unit)) return;
    if (gate && !gate()) return;
    for (const a of select(battle, unit)) battle.addBuff(a, { key, duration: 0.6, refresh: 'replace', mods, source: unit, tags: ['talent'], visible: true });
  }, { owner: unit, immediate: true });
}

/** Targetable enemies inside the unit's CURRENT range, best targets first (a 部署后 effect may run before the enemy
 *  tile index of the tick exists, so it scans `battle.enemies` through body.js like the kits do). */
function enemiesInRange(battle, unit, n = 0) {
  const keys = unit.rangeKeySet || new Set(unit.rangeKeys || []);
  const prof = { canHitFly: true };
  const list = [];
  for (const e of battle.enemies) {
    if (!e.alive || e.hidden || !e.deployed || !bodyInKeys(e, keys) || !canTargetEnemy(unit, e, prof)) continue;
    list.push(e);
  }
  sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}

// ---------------------------------------------------------------------------------------------------------------
// the rules

/** The talent's description text: the data record carries `desc`, the loadout-resolved def `description`. */
const descOf = (t) => String(t?.desc ?? t?.description ?? t?.descRaw ?? '');

/** Does the blackboard consist exactly of `keys` (order-insensitive)? */
const only = (keys, ...want) => keys.length === want.length && want.every((k) => keys.includes(k));

/** Rule: deployment flash — plain `stun` + "部署后立即对攻击范围内一个敌人…晕眩 N 秒" (灰烬 辅助装备). */
function deployStun(bb, d) {
  const stun = num(bb.stun);
  if (!(stun > 0) || !/部署后/.test(d) || !/晕眩/.test(d)) return null;
  const around = /周围/.test(d);
  const n = /一个敌人/.test(d) ? 1 : 0;
  return {
    rule: 'deployStun',
    drops: [],
    install(battle, unit) {
      battle.on('deploy', (c) => {
        if (c.unit !== unit || !up(unit)) return;
        for (const e of enemiesInRange(battle, unit, n)) {
          battle.applyStatus(e, 'stun', { duration: stun, source: unit });
          if (around) for (const e2 of battle.enemiesInRadius(e.x, e.y, 1.5)) if (e2.alive && e2 !== e) battle.applyStatus(e2, 'stun', { duration: stun, source: unit });
        }
        battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'flash' });
      }, { owner: unit });
    },
  };
}

/** `{install}` for "获得 n 点技力 on deployment". */
const mkDeploySp = (n) => ({ install(battle, unit) { battle.on('deploy', (c) => { if (c.unit === unit && up(unit)) giveSp(unit, n); }, { owner: unit }); } });
/** `{install, drops}` for "首次部署时部署费用 −cut". */
const mkDeployCost = (cut) => ({
  drops: ['部署费用是备战/重新部署侧的量：sim 的初始部署不付 DP，这里只降低 `base.cost`（= 以后重新部署时少付 DP；先例 kits/tier6.js 开源节流）'],
  install(battle, unit) { battle.on('battleStart', () => { unit.base.cost = Math.max(0, unit.base.cost - cut); }, { owner: unit }); },
});

/**
 * Rule: `runtime_cost` — "首次部署时部署费用-N". README of the reading: the sim places its units from the input
 * (the initial deployment pays no DP), so the only in-sim channel is `base.cost`, which the engine charges on a
 * REDEPLOY (Battle.redeploy / _checkRedeploys) — the same channel tier6.js 开源节流 uses. Partial by construction.
 */
function deployCost(bb, d) {
  const raw = num(bb.runtime_cost);
  if (!(raw < 0) || !only(Object.keys(bb), 'runtime_cost')) return null;
  return { rule: 'deployCost', ...mkDeployCost(-raw) };
}

/** Rule: deployment SP — `sp` ("部署后立即获得 N 点技力") or `sp_min`/`sp_max` (random, max exclusive). */
function deploySp(bb, d) {
  const keys = Object.keys(bb);
  const hasRange = num(bb.sp_min) !== undefined || num(bb.sp_max) !== undefined;
  const flat = num(bb.sp);
  if (hasRange ? !keys.every((k) => k === 'sp_min' || k === 'sp_max') : !only(keys, 'sp')) return null;
  if (!hasRange && !(flat > 0)) return null;
  if (!/部署后/.test(d) || !/技力/.test(d)) return null;
  if (hasRange) {
    const lo = num(bb.sp_min) ?? 0, hi = num(bb.sp_max) ?? lo + 1;
    return {
      rule: 'deploySpRandom',
      install(battle, unit) {
        battle.on('deploy', (c) => { if (c.unit === unit && up(unit)) giveSp(unit, lo + battle.rng.int(Math.max(1, hi - lo))); }, { owner: unit });
      },
    };
  }
  return {
    rule: 'deploySp',
    ...mkDeploySp(flat),
  };
}

/** Rule: `interval` + `sp` — "在场时每 N 秒回复…技力" (陈 呵斥). `自身额外回复` is folded in. */
function intervalSp(bb, d) {
  const iv = num(bb.interval), n = num(bb.sp);
  if (!(iv > 0) || !(n > 0) || !/技力/.test(d) || !/每\d/.test(d)) return null;
  if (!['interval', 'sp'].every((k) => k in bb)) return null;
  const extraSelf = /自身额外/.test(d) ? num(bb.sp) : 0;
  return {
    rule: 'intervalSp',
    drops: /攻击\/受击技力|攻击技力|受击技力/.test(d) ? ['只回“攻击/受击技力”的类型限制（SkillRuntime.gainSp 不分类型）'] : [],
    install(battle, unit) {
      battle.every(iv, () => {
        if (!up(unit)) return;
        for (const a of battle.allyUnits) if (a.kind === 'op' && a.alive && a.deployed && !a.hidden && a.ownerId === unit.ownerId) giveSp(a, n);
        if (extraSelf > 0) giveSp(unit, extraSelf);
      }, { owner: unit });
    },
  };
}

/** Rule: `atk_scale` (+`prob`, optional `def`/`defdown_duration` rider) — "攻击时…概率攻击力提升至 M%" (黑 破甲箭头,
 *  Stormeye 风坠) or "…概率造成相当于攻击力 M% 的…伤害" (艾拉 正中靶心). */
function attackProc(bb, d) {
  const allowed = new Set(['atk_scale', 'prob', 'def', 'defdown_duration']);
  const keys = Object.keys(bb);
  if (!keys.every((k) => allowed.has(k))) return null;
  const scale = num(bb.atk_scale);
  if (!(scale > 0)) return null;
  if (!/(攻击力提升至|(造成|额外造成)相当于攻击力\d+(\.\d+)?%的)/.test(d) || !/(概率|几率)/.test(d)) return null;
  // a "技能期间 / 首次 / 每个敌人" talent needs the skill side (提丰 重如沼泥), never a plain attack rider
  if (/技能|首次/.test(d)) return null;
  const prob = num(bb.prob) ?? 1;
  const defDown = num(bb.def);
  const dur = num(bb.defdown_duration) ?? num(bb.duration) ?? 5;
  const drops = [];
  if (defDown !== undefined && !(defDown < 0)) drops.push('`def` 不是下调，未表达');
  if (/必定触发/.test(d)) drops.push('“对受到雷鸣地雷影响的目标必定触发”这一追加条件（未接雷鸣地雷状态）');
  const rule = defDown < 0 ? 'attackProcRider' : 'attackProc';
  return {
    rule,
    drops,
    install(battle, unit) {
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !ctx.dmg || !ctx.dmg.isAttack) return;
        if (prob > 0 && prob < 1 && !battle.rng.chance(prob)) return;
        ctx.dmg.mul *= scale;
        battle.fx('crit', { x: unit.x, y: unit.y, id: unit.id });
        const tgt = ctx.target;
        if (defDown < 0 && tgt && tgt.alive && tgt.side === 'enemy') {
          battle.addBuff(tgt, { key: `${unit.defId}:talent:defdown`, duration: dur, mods: { defPct: defDown }, refresh: 'extend', source: unit });
        }
      }, { owner: unit });
    },
  };
}

/** Rule: `prob` + `sp` — "受到攻击时，有 N% 几率回复 M 点技力" (林 韬光). */
function onHurtSp(bb, d) {
  const keys = Object.keys(bb);
  if (!keys.every((k) => k === 'prob' || k === 'sp')) return null;
  const n = num(bb.sp), p = num(bb.prob);
  if (!(n > 0) || !(p > 0 && p <= 1)) return null;
  if (!/^(自身)?受到攻击时/.test(d) || !/技力/.test(d)) return null;
  return {
    rule: 'onHurtSp',
    drops: [],
    install(battle, unit) {
      battle.on('damaged', (ctx) => {
        if (ctx.target !== unit || !unit.alive) return;
        if (!ctx.dmg || !ctx.dmg.isAttack) return;
        if (battle.rng.chance(p)) giveSp(unit, n);
      }, { owner: unit });
    },
  };
}

/** Rule: plain `sp` + "周围四格内有敌人倒下时获得 N 点技力" (推进之王 粉碎). */
function nearbyKillSp(bb, d) {
  const keys = Object.keys(bb);
  if (!only(keys, 'sp')) return null;
  const n = num(bb.sp);
  if (!(n > 0) || !/(周围|附近|身边).{0,6}(敌人|敌军)(倒下|被击倒|死亡)/.test(d) || !/技力/.test(d)) return null;
  return {
    rule: 'nearbyKillSp',
    drops: [],
    install(battle, unit) {
      battle.on('kill', (ctx) => {
        const v = ctx.victim;
        if (!v || v.side !== 'enemy' || !up(unit)) return;
        if (Math.max(Math.abs(v.tileR - unit.tileR), Math.abs(v.tileC - unit.tileC)) <= 1) giveSp(unit, n);
      }, { owner: unit });
    },
  };
}

/** Rule: "攻击额外造成攻击力 N% 的 X 伤害" (`attack@atk_scale_N`, 麒麟R夜刀 双雷剑麒麟) — a bonus hit of its own. */
function attackAddHit(bb, d) {
  const keys = Object.keys(bb);
  if (keys.length !== 1 || !/^attack@atk_scale(_\d+)?$/.test(keys[0])) return null;
  const m = /攻击(时)?额外造成(相当于)?攻击力(\d+(\.\d+)?)%的(物理|法术|真实)伤害/.exec(d);
  if (!m) return null;
  const scale = num(bb[keys[0]]);
  const type = m[5] === '法术' ? 'arts' : m[5] === '真实' ? 'true' : 'phys';
  if (!(scale > 0)) return null;
  return {
    rule: 'attackAddHit',
    drops: [],
    install(battle, unit) {
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !ctx.dmg || !ctx.dmg.isAttack || ctx.dmg.isSplash || (ctx.dmg.tags || []).includes('chain')) return;
        const t = ctx.target;
        if (!t || !t.alive || t.side !== 'enemy') return;
        battle.dealDamage(unit, t, { amount: unit.s.atk * scale, type, isSkill: true, tags: ['talent'] });
      }, { owner: unit });
    },
  };
}

/** Rule: a self `attack_speed` debuff on the enemies the unit blocks ("自身阻挡的敌人攻击速度-7", Mechanist 反馈装甲). */
function blockedEnemyDebuff(bb, d) {
  const keys = Object.keys(bb);
  if (!only(keys, 'attack_speed')) return null;
  const v = num(bb.attack_speed);
  if (!(v < 0) || !/阻挡的敌人/.test(d)) return null;
  return {
    rule: 'blockedEnemyDebuff',
    drops: [],
    install(battle, unit) {
      battle.every(0.5, () => {
        if (!up(unit)) return;
        for (const e of unit.blocking || []) if (e.alive) battle.addBuff(e, { key: `${unit.defId}:talent:blockaspd`, duration: 0.6, refresh: 'replace', mods: { aspd: v }, source: unit, tags: ['talent'], visible: true });
      }, { owner: unit, immediate: true });
    },
  };
}

/** Rule: "攻击生命值低于 N% 的敌人时攻击力提升至 M%" (`hp_ratio` + `damage_scale`, 死芒 回光黯淡). */
function attackVsLowHp(bb, d) {
  const keys = Object.keys(bb);
  if (!keys.every((k) => k === 'hp_ratio' || k === 'damage_scale')) return null;
  const ratio = num(bb.hp_ratio), scale = num(bb.damage_scale);
  if (!(ratio > 0 && ratio < 1) || !(scale > 0)) return null;
  if (!/(攻击|造成).{0,8}生命(值)?低于\d+(\.\d+)?%的敌人/.test(d)) return null;
  const drops = /召唤物/.test(d) ? ['“自身和召唤物…”的召唤物一半（召唤物的伤害不由主人的 kit 挂钩）'] : [];
  return {
    rule: 'attackVsLowHp',
    drops,
    install(battle, unit) {
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !ctx.dmg || !ctx.dmg.isAttack) return;
        const t = ctx.target;
        if (t && t.alive && t.side === 'enemy' && t.hpRatio < ratio) ctx.dmg.mul *= scale;
      }, { owner: unit });
    },
  };
}

/** Rule: `interval` + stat keys — "在战场停留 N 秒后获得…" (W 设伏). */
function fieldTimer(bb, d, ctx) {
  const iv = num(bb.interval);
  const m = /在战场停留(\d+(\.\d+)?)秒后/.exec(d);
  if (!(iv > 0) || !m || num(bb.interval) !== +m[1]) return null;
  const statKeys = Object.keys(bb).filter((k) => k !== 'interval' && k !== 'prob' && k !== 'taunt_level');
  const mods = modsOf(bb, statKeys, ctx);
  if (!mods) return null;
  const prob = num(bb.prob);
  if (prob !== undefined && !/闪避/.test(d)) return null;
  if (prob !== undefined) { if (/物理/.test(d)) mods.dodgePhys = prob; if (/法术/.test(d)) mods.dodgeArts = prob; }
  const taunt = num(bb.taunt_level);
  if (taunt !== undefined) mods.taunt = taunt;
  const drops = [];
  if (/不容易成为敌人的攻击目标/.test(d) && taunt === undefined) drops.push('“不容易成为敌人的攻击目标”（无 taunt 黑板书）');
  return {
    rule: 'fieldTimer',
    drops,
    install(battle, unit) {
      let done = false;
      battle.every(1, () => {
        if (done || !up(unit) || battle.time - (unit.deployedAt ?? 0) < iv - 1e-9) return;
        done = true;
        statBuff(battle, unit, `${unit.defId}:talent:field`, mods);
      }, { owner: unit });
    },
  };
}

/** Rule: an aura limited to a profession ("所有【术师】职业干员的攻击力+22%", 艾雅法拉 炎息). */
function auraProfession(bb, d, ctx) {
  const m = /所有(?:友方)?【(.+?)】(?:职业)?干员/.exec(d);
  if (!m) return null;
  const prof = PROFESSION_BY_NAME[m[1]];
  if (!prof) return null;
  const keys = Object.keys(bb);
  const mods = modsOf(bb, keys, ctx);
  if (!mods) return null;
  const drops = [];
  const selfExtra = /自身[^。]*额外\+?(\d+(\.\d+)?)%/.exec(d);
  if (selfExtra) drops.push(`自身额外 +${selfExtra[1]}%（同一天赋的双档写法，未拆分）`);
  const needOther = /另外至少一名/.test(d);
  if (needOther) drops.push(`“另外至少一名${m[1]}干员”的编队条件按场上同类干员 ≥1 评估（携带 ≠ 部署）`);
  if (/携带|编入队伍/.test(d)) drops.push('“携带 / 编入队伍”是编队条件（不要求上场），sim 里光环只在该干员在场时生效');
  return {
    rule: 'auraProfession',
    drops,
    install(battle, unit) {
      const gate = needOther ? () => battle.allyUnits.some((a) => a.kind === 'op' && a.alive && a.deployed && !a.hidden && a.ownerId === unit.ownerId && a !== unit && a.def?.profession === prof) : null;
      auraPulse(battle, unit, `${unit.defId}:talent:aura:${prof}`, mods,
        (b) => b.allyUnits.filter((a) => a.kind === 'op' && a.alive && a.deployed && !a.hidden && a.ownerId === unit.ownerId && a.def?.profession === prof), gate);
    },
  };
}

/** Rule: an aura over the unit's own range ("攻击范围内的友方单位法术抗性+15…", 夜莺 白恶魔的庇护). */
function auraRange(bb, d, ctx) {
  if (!/攻击范围内的(友方|友军)/.test(d) || /攻击范围内的(敌人|敌军)/.test(d)) return null;
  const keys = Object.keys(bb).filter((k) => k !== 'def_lowland');
  const mods = modsOf(bb, keys, ctx);
  if (!mods) return null;
  const drops = [];
  if (num(bb.def_lowland) !== undefined) drops.push(`\`def_lowland\` ${num(bb.def_lowland)}（地面单位额外加成：按地形类型分档，未表达）`);
  return {
    rule: 'auraRange',
    drops,
    install(battle, unit) {
      auraPulse(battle, unit, `${unit.defId}:talent:aura:range`, mods, (b, u) => b.alliesInGrid(u));
    },
  };
}

/** Rule: unconditional self stats (+ `prob` when the text says 闪避 — 陈 持刀格斗术, Sharp 隐匿刀刃). */
function selfStat(bb, d, ctx) {
  // a stat talent the description conditions ("…时", a state, a stack count) or aims at someone else is NOT a plain
  // self stat and must not be installed as one (弑君者 弑君者威名, 维伊 “在挥刀之前”, 电弧 加油~, 黍 百谷长青).
  if (CONDITIONAL.test(d)) return null;
  const penetrateOnly = Object.keys(bb).every((k) => k.includes('penetrate') || k === 'prob');
  if (AURA_ONLY.test(d)) return null;
  if (NOT_SELF.test(d) && !penetrateOnly) return null;
  // the one exception is the penetrate wording ("无视敌人 N 点法术抗性"), which IS a self mod
  if (/敌人|敌方|敌军/.test(d) && !penetrateOnly) return null;
  const keys = Object.keys(bb);
  const drops = [];
  const statKeys = keys.filter((k) => k !== 'prob');
  if (keys.includes('prob')) {
    if (!/闪避/.test(d) || /概率|几率/.test(d)) return null;
    statKeys.push('prob');
  }
  const mods = modsOf(bb, statKeys.filter((k) => k !== 'prob'), ctx);
  if (!mods) return null;
  if (keys.includes('prob')) {
    const p = num(bb.prob);
    if (/物理/.test(d)) mods.dodgePhys = p;
    if (/法术/.test(d)) mods.dodgeArts = p;
  }
  // "自身与浮游单元无视敌人 N 点法术抗性" — the summon never gets the mod from here
  const summon = /(与|及)(浮游单元|召唤物|重构体|虚影|无人机|装置)/.exec(d);
  if (summon) drops.push(`“${summon[0]}”的共享部分（召唤物自身的属性/穿透不由此处授予）`);
  return { rule: 'selfStat', drops, mods };
}

/** The condition-keyed self stats: one explicit condition the engine models, plus the keys it gates. */
function selfStatGated(bb, d, ctx) {
  const keys = Object.keys(bb);
  // --- "未阻挡敌人时" (赫拉格 运筹帷幄) / "阻挡时" (止颂 苦痛专注) / "阻挡敌人时" (森蚺 愈战愈勇)
  if (/未阻挡敌人时/.test(d) || /(^|[^未])阻挡(敌人|目标)?(的)?时/.test(d)) {
    if (AURA_ONLY.test(d)) return null;
    const statKeys = keys.filter((k) => STAT_MODS[k]);
    const mods = modsOf(bb, statKeys, ctx);
    if (!mods || statKeys.length !== keys.length) return null;
    const unblocked = /未阻挡/.test(d);
    const drops = /来自非自身阻挡敌人/.test(d) ? ['“来自非自身阻挡的敌人”这一来源限制（无按来源区分的减伤通道）'] : [];
    return {
      rule: unblocked ? 'selfStatUnblocked' : 'selfStatBlocking',
      drops,
      install(battle, unit) {
        toggleBuff(battle, unit, `${unit.defId}:talent:block`, () => ((unit.blocking?.length ?? 0) === 0) === unblocked, mods);
      },
    };
  }
  // --- "未进行攻击 N 秒" (Stormeye 风雨欲来) / "N 秒内没有主动攻击过" (棘刺 故土潮声)
  if (/(未进行攻击|未攻击|没有(主动)?攻击)/.test(d) && num(bb.delay) !== undefined) {
    if (AURA_ONLY.test(d)) return null;
    const delay = num(bb.delay);
    const statKeys = keys.filter((k) => k !== 'delay');
    const mods = modsOf(bb, statKeys, ctx);
    if (!mods) return null;
    return {
      rule: 'selfStatIdle',
      drops: [],
      install(battle, unit) {
        toggleBuff(battle, unit, `${unit.defId}:talent:idle`, () => battle.time - (unit.lastAttackAt ?? -Infinity) >= delay, mods);
      },
    };
  }
  // --- "生命值低于 X% 时" (Mechanist 精研材料): base stats always + the namespaced `ns[tag].<statKey>` group gated
  const hpGate = /生命值(低于|不高于|少于)/.test(d);
  if (hpGate) {
    const extraNs = new Set();
    const baseKeys = [];
    for (const k of keys) {
      const mm = /^([^\s.]+)\.(\w+)$/.exec(k);
      if (mm && STAT_MODS[mm[2]]) extraNs.add(k);
      else baseKeys.push(k);
    }
    if (extraNs.size && [...extraNs].map((k) => k.split('.').slice(0, -1).join('.')).every((ns, _, arr) => arr[0] === ns)) {
      const ratio = num(bb.hp_ratio) ?? num(bb.min_hp_ratio);
      const baseStatKeys = baseKeys.filter((k) => STAT_MODS[k]);
      const base = modsOf(bb, baseStatKeys, ctx);
      const extra = modsOf(bb, [...extraNs], ctx);
      const rest = keys.filter((k) => !baseStatKeys.includes(k) && !extraNs.has(k));
      if (base && extra && ratio > 0 && (rest.length === 0 || (rest.length === 1 && (rest[0] === 'hp_ratio' || rest[0] === 'min_hp_ratio')))) {
        return {
          rule: 'selfStatHpBelow',
          drops: [],
          install(battle, unit) {
            statBuff(battle, unit, `${unit.defId}:talent:hp`, base);
            const k = `${unit.defId}:talent:hp:low`;
            const check = () => {
              const want = up(unit) && unit.hpRatio < ratio;
              const cur = unit.findBuff(k);
              if (want && !cur) battle.addBuff(unit, { key: k, mods: extra, tags: ['talent'], visible: true });
              else if (!want && cur) battle.removeBuff(unit, k);
            };
            battle.on('tick', check, { owner: unit });
            battle.on('battleStart', check, { owner: unit });
          },
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// hand-authored talents (Phase B): the records the audit named by their exact numbers

/**
 * 456_ash 灰烬 — 辅助装备 `{stun:4}` ("部署后立即对攻击范围内一个敌人投掷闪光弹，使其和周围敌人晕眩4秒") and
 * 突击手 `{runtime_cost:-5, sp:17}` ("首次部署时部署费用-5，部署后立即获得17技力"). The flash is the deployStun rule
 * with its exact numbers; the 突击手 resource half is the deploySp rule (17 SP on deploy) and its `runtime_cost` half is
 * the deployCost rule's documented reading.
 */
const HAND_AUTHORED = {
  chess_free_char_456_ash: {
    辅助装备: (bb, d) => deployStun(bb, d),
    突击手: (bb, d) => {
      const sp = num(bb.sp), cost = num(bb.runtime_cost);
      const parts = [];
      const drops = [];
      if (sp > 0) parts.push(mkDeploySp(sp));
      if (cost < 0) { const c = mkDeployCost(-cost); parts.push(c); drops.push(...c.drops); }
      if (!parts.length || !only(Object.keys(bb), 'sp', 'runtime_cost')) return null;
      return {
        rule: 'hand:ash:assault',
        drops,
        install(battle, unit) { for (const p of parts) p.install(battle, unit); },
      };
    },
  },
  // 340_shwaz 黑 — 破甲箭头 `{atk_scale:1.6, def:-0.2, prob:0.2, defdown_duration:5}` (prob-gated ×1.6 + def −20 % for 5 s)
  // and 交叉火力 `{atk:0.13}` (all 【狙击】 ATK +13 % while another sniper is fielded).
  chess_free_char_340_shwaz: {
    破甲箭头: (bb, d, ctx) => attackProc(bb, d, ctx),
    交叉火力: (bb, d, ctx) => auraProfession(bb, d, ctx),
  },
  // 180_amgoat 艾雅法拉 — 炎息 `{atk:0.22}` (all 【术师】 ATK +22 %, herself included) and 乱火 `{sp_min:7, sp_max:16}`
  // (7–15 SP on deployment; `sp_max` is exclusive, the text says 7~15).
  chess_free_char_180_amgoat: {
    炎息: (bb, d, ctx) => auraProfession(bb, d, ctx),
    乱火: (bb, d, ctx) => deploySp(bb, d, ctx),
  },
};

// ---------------------------------------------------------------------------------------------------------------
// the translator

const RULES = [deployStun, deployCost, deploySp, intervalSp, onHurtSp, nearbyKillSp, attackProc, attackAddHit,
  attackVsLowHp, blockedEnemyDebuff, fieldTimer, auraProfession, auraRange, selfStatGated, selfStat];

/**
 * Translate ONE declared talent. Returns `{ rule, install?, mods?, drops }` when it is expressed (possibly partially),
 * or `null` when nothing faithful can be built. Pure: the returned install closes over blackboard numbers only.
 */
export function translateTalent(t, ctx) {
  const bb = t.bb || {};
  const d = descOf(t);
  const keys = Object.keys(bb);
  if (!keys.length) return null;
  const hand = HAND_AUTHORED[ctx.chessId]?.[t.name];
  if (typeof hand === 'function') {
    const out = hand(bb, d, ctx);
    if (out) return out;
  }
  for (const rule of RULES) {
    const out = rule(bb, d, ctx);
    if (out) return out;
  }
  return null;
}

/** A stable id for a talent install's buff keys. */
const keyOf = (ctx, t) => `${ctx.chessId}:talent:${t.index ?? 0}:${t.name ?? ''}`;

/**
 * Records whose hand-authored kit is a THIN WRAPPER over this generic kit and installs the record's own talent
 * itself — `kits/freePicks.js` `reserveKit` for the six 4★ 预备干员 (`chess_free_char_601_cguard` … `_606_csuppo`:
 * `const kit = genericKit(...); kit.talents = [...kit.talents, plainStatTalent]`) and `tokens.js` `reserveMedicKit`
 * for the band map character `char_605_cmedic` (预备干员-医疗: `genericKit(...)` + `mapCharTalents(def)`, the +4 % ATK
 * of its own record). Installing here too would double every one of those plain stat talents (atk +4 % → +8 %). The
 * translator therefore REPORTS their talents as `installed-by-kit` and installs nothing. A new wrapper kit must be
 * listed here (or stop wrapping `genericKit`).
 */
export const WRAPPER_KITS = Object.freeze(new Set([
  'chess_free_char_601_cguard', 'chess_free_char_602_cdfend', 'chess_free_char_603_csnipe',
  'chess_free_char_604_ccast', 'chess_free_char_605_cmedic', 'chess_free_char_606_csuppo',
  'char_605_cmedic',   // the 预备干员-医疗 BAND MAP CHARACTER (tokens.js reserveMedicKit), a different record id
]));

/**
 * The DECLARED talents of a record with the blackboards the unit actually fights with.
 *
 * The declaration metadata (`index` / `hidden` / module merge) lives on the composed data record (`def.raw`, the
 * `loadoutRecord` output: `composeTalents` folds a module's `talentChanges` into the base talents by `talentIndex`, so
 * `bb` here already contains the module's numbers — that is why a module on a kit-less record becomes live for free);
 * the normalised `def.talents` carries the same blackboards under `description` and no `index`. A hidden entry
 * (`index: −1`, e.g. 领主·Sharp's `magic_atk_scale`) or a module placeholder is not a declared talent.
 */
export function declaredTalents(def, chess) {
  const raw = def?.raw ?? chess;
  const base = Array.isArray(raw?.talents) && raw.talents.length ? raw.talents : (Array.isArray(chess?.talents) ? chess.talents : []);
  const resolved = Array.isArray(def?.talents) && def.talents !== base ? def.talents : [];
  const byName = new Map();
  for (const r of resolved) if (r && r.name) byName.set(r.name, r);
  return base.filter((t) => t && !t.hidden && t.index !== -1).map((t) => {
    const r = t.name ? byName.get(t.name) : null;
    return {
      index: t.index ?? null,
      name: t.name ?? null,
      bb: (r && r.bb && Object.keys(r.bb).length ? r.bb : t.bb) ?? {},
      desc: descOf(r) || descOf(t),
    };
  });
}

export function translateTalents(def, chess) {
  const talents = declaredTalents(def, chess);
  const ctx = { chessId: def?.id ?? chess?.id ?? chess?.chessId ?? null, bat: num(def?.stats?.bat) || num(chess?.stats?.bat) || 1 };
  const installs = [];
  const report = [];
  const wrapped = WRAPPER_KITS.has(ctx.chessId);
  for (const t of talents) {
    const keys = Object.keys(t.bb || {});
    const out = translateTalent(t, ctx);
    const rec = { index: t.index ?? null, name: t.name ?? null, keys, rule: out?.rule ?? null, drops: out?.drops ?? [] };
    if (!out) {
      rec.status = 'unexpressed';
      rec.reason = !keys.length ? 'empty blackboard: the effect lives in the description text only (a summon / roster mechanic)' : 'no faithful kit-DSL form for this key set / wording';
      report.push(rec);
      continue;
    }
    const install = out.install ?? (out.mods ? (battle, unit) => statBuff(battle, unit, keyOf(ctx, t), out.mods) : null);
    if (!install) {
      rec.status = 'unexpressed';
      rec.reason = 'the rule matched but produced no install';
      report.push(rec);
      continue;
    }
    if (wrapped) {
      rec.status = 'installed-by-kit';
      rec.reason = 'the hand-authored kit of this record installs this talent itself (WRAPPER_KITS)';
      report.push(rec);
      continue;
    }
    // every blackboard key the rule did not consume is REPORTED, never silently dropped
    const consumed = consumedKeys(out.rule, t.bb || {});
    for (const k of keys) if (!consumed.includes(k)) rec.drops.push(`黑板书 \`${k}\`（本规则未表达）`);
    rec.status = rec.drops.length ? 'partial' : 'installed';
    report.push(rec);
    installs.push({ install, talentIndex: t.index ?? null, talentName: t.name ?? null, talentRule: out.rule, talentDrops: rec.drops.slice(), talentKey: keyOf(ctx, t) });
  }
  return { installs, report };
}

/** The install hooks for the generic kit (empty array when nothing is expressible). */
export const genericTalents = (def, chess) => translateTalents(def, chess).installs;

export default genericTalents;
