// server/sim/content/kits/freePicks.js — hand-authored kits for the 自选干员 of 自由位置 (data/freePicks.json, DESIGN §21).
//
// `export default { [baseChessId]: (bb, chess, def) => Kit }` (docs/SIM.md §7.2), merged into `KITS` by
// content/index.js right after kits/tier1..6.js. The keys are the free-pick chess ids themselves
// (`chess_free_char_608_acpion` …): a data/freePicks.json record never carries an `_a` / `_b` suffix, and `goldenIdOf`
// falls back to the id itself for such a record (there is no `_b` sibling), so one key covers the normal and the 精锐
// piece alike.
//
// This batch = the nine 6★ 原型干员 of the season, 赤刃明霄陈 火陈 (the "火龙" / 剑气长龙 report, S3 only), plus a small
// wrapper for the six 4★ 预备干员 (their shared generic
// skills `skcom_atk_up[…]` / … are reproduced exactly by the generic kit, which however installs no talent — theirs is
// a plain stat talent that the wrapper below adds):
//   608_acpion 郁金香 (PIONEER 尖兵)        609_acguad Sharp (WARRIOR 无畏者)   610_acfend Mechanist (TANK 铁卫)
//   611_acnipe Stormeye (SNIPER 速射手)     612_accast Pith (CASTER 扩散术师)  613_acmedc Touch (MEDIC 医师)
//   614_acsupo Raidian (SUPPORT 凝滞师)     615_acspec Misery (SPECIAL 处决者) 617_sharp2 领主·Sharp (WARRIOR 领主)
//   1050_chen3 赤刃明霄陈 (WARRIOR 术战者, S3 剑气长龙)
//   601_cguard / 602_cdfend / 603_csnipe / 604_ccast / 605_cmedic / 606_csuppo (4★ 预备干员, `reserveKit`)
// Every number comes from the record's own blackboards (`bb` = the SELECTED skill's one, `def.talents[i].bb`,
// `def.traitBb`); the few constants are documented where they are used. The official wording (description + 备注) was
// checked against the PRTS 卫戍协议 pages of the eight operators (`<名>(卫戍协议)`) — two of their 备注 settle
// blackboard shapes this file depends on: Raidian S3's plain `atk` 0.9 is the 虚弱's 同名取最高 priority (not the
// skill's ATK, which is the namespaced `acsupo_s_3.atk` 0.4), and Misery S3's `force` 0 is 小力.
//
// Loadouts (DESIGN §16): `bb` is the SELECTED skill's blackboard, so `alt()` builds only the selected skill's spec — a
// builder may read `bb` directly. `install` / `talents` run for every loadout; logic that belongs to one skill is gated
// on `isSel(def, id)` or `skillOn(unit, id)`.
// Tests: test/content/kits_freePicks.test.js.

import { COLS, ROWS } from '../../constants.js';
import { absoluteRangeKeys, canTargetEnemy, sortEnemyTargets } from '../../targeting.js';
import { bodyInKeys } from '../../body.js';
import { genericKit } from '../generic.js';

// ---------------------------------------------------------------------------------------------------------------
// helpers

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));
/** Blackboard of named talent `i` of the resolved def (module upgrades already merged by the data). */
const tbb = (def, i) => def?.talents?.[i]?.bb ?? {};
/** Id of the selected skill. */
const selId = (def) => def?.skill?.id ?? def?.raw?.skill?.skillId ?? null;
/** Is `id` the selected skill? */
const isSel = (def, id) => selId(def) === id;
/** `skills` map of a kit: only the selected skill's builder runs, so its spec uses that skill's own `bb`. */
function alt(def, builders) {
  const id = selId(def);
  return id && typeof builders[id] === 'function' ? { [id]: builders[id]() } : {};
}
/** The skill's own 技能范围 (the data has resolved it onto the selected skill record), or null. */
const gridOf = (def) => (def?.skill?.rangeGrid && def.skill.rangeGrid.length ? def.skill.rangeGrid : null);
/** `base_attack_time` in a skill blackboard is a FLAT change of the base attack time in seconds (tier1 batMod). */
const batFlat = (def, v) => { const b = num(def?.stats?.bat, 1) || 1; return Math.max(-0.9, num(v, 0) / b); };
/** The unit's selected skill is running. */
const skillOn = (u, id) => !!(u && u.skill && u.skill.active && u.skill.id === id);
/** Run `fn` every `iv` s (seconds; battle.every) while the unit is alive and deployed. */
const whileDeployed = (battle, unit, iv, fn) => battle.every(iv, () => { if (unit.alive && unit.deployed) fn(); }, { owner: unit });
/** Short-lived aura buff (an aura refreshes it every ≤ 0.2 s; it lapses a few ticks after the source stops). */
const pulse = (battle, target, key, mods, extra = {}) => battle.addBuff(target, { key, mods, duration: AURA_DUR, ...extra });
/** Permanent talent stat buff (survives death / redeploy). */
function statBuff(battle, unit, key, mods) {
  const m = {};
  for (const [k, v] of Object.entries(mods)) if (Number.isFinite(v) && v !== 0 && !(k.endsWith('Mul') && v === 1)) m[k] = v;
  if (Object.keys(m).length) battle.addBuff(unit, { key, mods: m, persist: true, allowDead: true, tags: ['talent'] });
}
/** Keep (or drop) a conditional self buff — re-added only when its mods change (toggleBuff in tier4). */
function toggleBuff(battle, unit, key, on, mods) {
  const cur = unit.findBuff(key);
  if (on) {
    if (!cur || JSON.stringify(cur.mods) !== JSON.stringify(mods)) battle.addBuff(unit, { key, mods, refresh: 'replace' });
  } else if (cur) battle.removeBuff(unit, key);
}
/** SP gift ("获得N点技力"); the engine refuses SP while a timed skill runs (AK: none during a skill). */
const giveSp = (u, n, reason = 'talent') => (u && u.skill && !u.skill.noSkill && n > 0 ? u.skill.gainSp(n, reason) : 0);
/** DP grant + its client fx. */
const gainDp = (battle, unit, n) => { if (n > 0) { battle.addDp(unit.ownerId, n); battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n }); } };
/**
 * Targetable enemies on `g` (offsets relative to the unit's tile / direction; null ⇒ its current range), best first.
 * It scans `battle.enemies` with body.js instead of the tile index: a 部署后 effect (Misery S3) runs during the initial
 * deployment, before the enemy tile index of that tick exists.
 */
function enemiesInGrid(battle, unit, g, { canHitFly = true, groundOnly = false, n = 0, priority = null, blocked = true } = {}) {
  const prof = { canHitFly, groundOnly };
  const keys = g ? new Set(absoluteRangeKeys(g, unit.tileR, unit.tileC, unit.dir, 0)) : (unit.rangeKeySet || new Set(unit.rangeKeys || []));
  const list = [];
  for (const e of battle.enemies) {
    if (!e.alive || e.hidden || !e.deployed) continue;
    if (!bodyInKeys(e, keys)) continue;
    if (!canTargetEnemy(unit, e, prof)) continue;
    list.push(e);
  }
  // "可以选择且优先选择阻挡单位": the enemies a unit blocks are always its targets, in range or not (SIM.md §1.2)
  if (blocked) for (const e of unit.blocking || []) if (e.alive && !list.includes(e) && canTargetEnemy(unit, e, prof)) list.push(e);
  sortEnemyTargets(battle, unit, list, priority ?? unit.profile?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}
/** Deployed operators of the owner matching `f` (no devices; a 孤立 unit is never selected by an ally's ability). */
const ownerOps = (battle, unit, f) => battle.allyUnits.filter((a) => a.kind === 'op' && a.alive && a.deployed && !a.hidden
  && a.ownerId === unit.ownerId && battle.allySelectable(a, unit) && (!f || f(a)));
/** Deployed allies of the owner on the 4 tiles adjacent to `u`. */
function adjacentAllies(battle, unit, u) {
  const out = [];
  const seen = new Set();
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const a = battle.unitAt(u.tileR + dr, u.tileC + dc);
    if (!a || a === u || seen.has(a.id)) continue;
    seen.add(a.id);
    if (a.side === 'ally' && a.alive && a.kind !== 'device' && a.ownerId === unit.ownerId && battle.allySelectable(a, unit)) out.push(a);
  }
  return out;
}
/** A second normal hit on the same targets ("二连击"): the attack's own ATK-based damage again. */
function doubleHit(battle, unit, targets) {
  let any = false;
  for (const t of targets || []) {
    if (!t || !t.alive || t.side !== 'enemy') continue;
    battle.dealDamage(unit, t, { amount: unit.s.atk * unit.s.atkScaleMul, type: unit.profile?.dmgType === 'arts' ? 'arts' : 'phys', isAttack: true, tags: ['doubleHit'] });
    any = true;
  }
  if (any) battle.fx('crit', { x: unit.x, y: unit.y, id: unit.id });
  return any;
}

const AURA = 0.2;       // aura refresh period (s)
const AURA_DUR = 0.25;  // aura buff lifetime (s)

// ---------------------------------------------------------------------------------------------------------------
// 剑气长龙 ("火龙") of 赤刃明霄陈 S3 赤霄·天喟 — user report 2026-10-03: "火陈的火龙现在也没有实现"

/** PRTS 备注 of 赤霄·天喟: 剑气 "移动速度1.5" (tiles/s) — the data has no key for it. */
const SWORD_QI_SPEED = 1.5;
/** PRTS 备注 of 赤霄·天喟: 剑气 "碰撞半径1.3" (tiles) — the data has no key for it either. */
const SWORD_QI_RADIUS = 1.3;

/**
 * The sword-qi of S3 赤霄·天喟 (`skchr_chen3_3`): on activation she releases a qi straight ahead that damages **once**
 * every enemy its path passes through, for `max(hp_ratio × the victim's CURRENT HP, projectile_min_atk_scale × ATK)`
 * arts damage — both numbers are the skill's own blackboard keys (`hp_ratio` 0.06, `projectile_min_atk_scale` 5.3 at the
 * record's skill level). PRTS 备注 (the authority for what the data does not carry): "剑气可对空，碰撞半径1.3，移动速度
 * 1.5，每次转向前对每个敌人仅判定一次伤害；…"; "『至少造成』指的是『如果目标当前生命值的6%低于自己的攻击力*相应攻击力
 * 倍率』，则改为造成一次相应攻击力倍率的法术伤害（非伤害保底或无视法术抗性）"; "剑气的伤害为预计算的无途径法术普通伤害".
 * The qi therefore hits FLYING enemies too (`canHitFly: true`, unlike her own attacks — 地面敌人), flies to the field
 * edge at `SWORD_QI_SPEED` tiles/s (each step damages from where it has arrived, so a distant enemy is hit later),
 * and its ATK is the one cached at cast time (预计算 — a later ATK buff does not grow it).
 *
 * The 剑气 is a travelling projectile, not a tile sweep: its position is sampled once per tile of flight (0.667 s at
 * `SWORD_QI_SPEED`) and damages `battle.enemiesInRadius(x = its column, y = its row, SWORD_QI_RADIUS)` — the 1.3
 * 碰撞半径 of 备注, a body only has to touch that disc. `hit` keeps "每个敌人仅判定一次" per segment: a 巨型 enemy
 * (body.js `hitArea`) whose rectangle covers several samples, or one walking into the corridor between two steps, takes
 * ONE instance. The flight stops at the field edge (`battle.rect`), which for a normal battle is much narrower than the
 * 19×21 stage grid behind it.
 *
 * Not modelled: the official 可转向 (the qi turns clockwise 90° when the way ahead is blocked — 侵入点 / 保护目标 / 高地
 * within 0.25; it never turns here, so the whole flight is one segment) and obstacles / 高地 do not stop it either. Its
 * damage cannot be dodged by enemies: the official damage is a projectile hit, not one of the caster's attacks.
 */
function swordQi(battle, unit, bb) {
  const [dr, dc] = Array.isArray(unit.fwd) ? unit.fwd : [0, 1];
  if (!dr && !dc) return;
  const ratio = num(bb.hp_ratio, 0.06);
  const scale = num(bb.projectile_min_atk_scale, 5.3);
  const atk = unit.s.atk;                       // 预计算: the ATK at cast time
  const R = battle.rect;                        // the qi flies over the FIELD, not the 19×21 grid behind it
  const path = [];
  for (let i = 1; i <= Math.max(ROWS, COLS); i++) {
    const r = unit.tileR + dr * i, c = unit.tileC + dc * i;
    if (r < R.r0 || r > R.r1 || c < R.c0 || c > R.c1) break;
    path.push([r, c]);
  }
  if (!path.length) return;
  const hit = new Set();                        // 每个敌人仅判定一次 (per segment)
  let px = unit.x, py = unit.y;                 // the qi's continuous position: her spot at cast time
  for (let i = 0; i < path.length; i++) {
    const [r, c] = path[i];
    const fx0 = px, fy0 = py;                   // the spot the qi comes from (fixed at cast: it does not follow her)
    battle.after((i + 1) / SWORD_QI_SPEED, () => {
      // one streak per step (`move` archetype: the client walks the event's tx / ty, see render/fx.js) — the old single
      // 'beam' for the whole flight resolved unit views only and drew a sparkle on the caster instead of a line
      battle.fx('swordQi', { x: fx0, y: fy0, id: unit.id, tx: c, ty: r });
      for (const e of battle.enemiesInRadius(c, r, SWORD_QI_RADIUS)) {
        if (hit.has(e) || !canTargetEnemy(unit, e, { canHitFly: true })) continue;
        hit.add(e);
        const amount = Math.max(e.hp * ratio, atk * scale);
        battle.dealDamage(unit, e, { amount, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'swordQi'] });
      }
    }, { owner: unit });
    px = c; py = r;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 模组 helpers (a 自选候选 is its own elite: its record carries `modules[]` + the module-applied trait / talents, so the
// module parts are read from the resolved def exactly as the season kits read them — 模组相关规则和普通干员一致)

/** Merged blackboard of the hidden module talents (data index −1) of the resolved record (tier1's moduleBb). */
function moduleTalentBb(def) {
  const o = {};
  for (const t of def?.raw?.talents ?? []) if (t && t.index === -1 && t.bb) Object.assign(o, t.bb);
  return o;
}
/** Module "攻击范围扩大" (SPC-X …): the active module's range-only talent change (index −1 grid) replaces the range. */
function applyModuleRange(battle, unit, def) {
  const m = def?.raw?.module;
  if (!m || !m.active || !m.id) return;
  const rec = (def.raw.modules || []).find((x) => x && x.uniEquipId === m.id);
  for (const t of rec?.talentChanges || []) {
    const g = t?.rangeGrid;
    if (Array.isArray(g) && g.length) { unit.rangeGrid = g; battle.refreshRange(unit); return; }
  }
}
/** Physician module trait (PHY-X): heals on allies below `hp_ratio` are ×`heal_scale` (tier4 installLowHpHealBonus). */
function installLowHpHealBonus(battle, unit, tb) {
  const s = num(tb.heal_scale, 0), r = num(tb.hp_ratio, 0);
  if (!(s > 0) || !(r > 0)) return;
  battle.on('heal', (c) => { if (c.source === unit && c.target !== unit && c.target.hpRatio < r) c.amount *= s; }, { owner: unit });
}
/** "周围四格" without another ally operator / summon (tier4 lonely): EXE-X's "周围四格没有友方干员时". */
function lonely(battle, unit) {
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const r = unit.tileR + dr, c = unit.tileC + dc;
    if (battle.grid && !battle.grid.inBounds(r, c)) continue;
    const a = battle.unitAt(r, c);
    if (a && a !== unit && a.side === 'ally' && a.kind !== 'device') return false;
  }
  return true;
}
/** Module SP tick: +`perSec` SP/s while `cond` holds, folded into the engine's own time recovery (tier1 spTimeBonus). */
function spTimeBonus(battle, unit, perSec, cond) {
  if (!(perSec > 0)) return;
  battle.on('spGain', (ctx) => {
    if (ctx.unit === unit && ctx.reason === 'time' && cond()) ctx.amount += perSec * battle.dt;
  }, { owner: unit });
}
/** Any targetable enemy in the unit's current range (tier1's enemyInRange). */
const enemyInRange = (battle, unit) => battle.enemiesInKeys(unit.rangeKeys || [], unit, { canHitFly: true }).length > 0;

/**
 * 4★ 预备干员 (chess_free_char_601…606): the shared generic skills (`skcom_atk_up[…]`, `skcom_def_up[…]`,
 * `skcom_magic_rage[…]`, `skcom_heal_up[…]`) are reproduced exactly by the generic kit — but that kit installs no
 * talent, and each of these six carries one plain stat talent (data: 攻击提升 攻击力+8% for 近卫 / 狙击 / 医疗,
 * 防御提升 防御力+10% for 重装, 施法速度提升 攻击速度+9 for 术师 / 辅助). The talent blackboard is mapped with the same
 * four keys the band map characters use (tokens.js `mapCharTalents`) and applied as a persistent stat buff; the kit
 * keeps `generic: true`, so the skill spec is still reported as the generic one (tools/kit-coverage).
 */
function reserveKit(bb, chess, def) {
  const kit = genericKit(bb, chess, def);
  const t = tbb(def, 0);
  const mods = {};
  for (const [key, mod] of [['atk', 'atkPct'], ['def', 'defPct'], ['max_hp', 'hpPct'], ['attack_speed', 'aspd']]) {
    const v = num(t[key]);
    if (v) mods[mod] = v;
  }
  if (Object.keys(mods).length) {
    kit.talents = [...(kit.talents ?? []), { install(battle, unit) { statBuff(battle, unit, 'reserve:talent', mods); } }];
  }
  return kit;
}

// ---------------------------------------------------------------------------------------------------------------
// the kits

export default {

  // ===============================================================================================================
  // 608_acpion 郁金香 (PIONEER 尖兵, char_608_acpion)
  //   无垠之心: 部署后第2次开启技能之前，技力自然回复速度+0.6/秒
  //   浪潮之心: 攻击力+10%，击杀敌人时额外获得1点部署费用
  //   S1 钻心: 立即获得6点部署费用，并对攻击范围至多2名敌人造成攻击力170%的物理伤害
  //   S2 迅瞬: 10 s — 技能持续时间内逐渐获得6点部署费用，攻击速度+95，并无视目标25%的防御力
  //   S3 只余芬芳 (default): 立即获得6点费用，对周围的敌人发动8次连续斩击，每次造成相当于攻击力155%的物理伤害，
  //      并无视目标50%防御力
  chess_free_char_608_acpion: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const g = gridOf(def);
    const S3 = 'skchr_acpion_3';
    return {
      skills: alt(def, {
        skchr_acpion_1: () => ({
          kind: 'instant',
          onStart({ battle, unit }) {
            gainDp(battle, unit, num(bb.cost));
            const foes = enemiesInGrid(battle, unit, null, { n: Math.max(1, Math.floor(num(bb.max_target, 1))) });
            for (const e of foes) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
            if (foes.length) battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: foes.length });
          },
        }),
        skchr_acpion_2: () => {
          const total = Math.max(0, Math.floor(num(bb.trig_cnt, 0))), per = num(bb.cost, 1), iv = Math.max(0.1, num(bb.interval, 1));
          return {
            kind: 'duration',
            mods: { aspd: num(bb.attack_speed), defIgnorePct: num(bb.def_penetrate) },
            onStart({ unit }) { unit.mem.acpionDp = { acc: 0, given: 0 }; },
            onTick({ battle, unit, dt }) {
              const m = unit.mem.acpionDp;
              if (!m) return;
              m.acc += dt;
              while (m.acc + 1e-9 >= iv && m.given < total) { m.acc -= iv; m.given++; gainDp(battle, unit, per); }
            },
            // the text promises the whole 6 DP within the duration ⇒ the remainder is handed over when it runs out
            // normally (a knock-out / withdrawal mid-skill loses it — the 焰尾 S3 reading)
            onEnd({ battle, unit, reason }) {
              const m = unit.mem.acpionDp;
              unit.mem.acpionDp = null;
              if (m && reason === 'duration' && m.given < total) gainDp(battle, unit, per * (total - m.given));
            },
          };
        },
        [S3]: () => ({
          kind: 'instant',
          onStart({ battle, unit }) {
            gainDp(battle, unit, num(bb.cost));
            const hits = Math.max(1, Math.floor(num(bb.times, 1)));
            const scale = num(bb.atk_scale, 1), pen = num(bb.def_penetrate);
            // "对周围的敌人发动8次连续斩击": every enemy of the 技能范围 x-1 takes all 8 slashes (the 锏 S3 reading of
            // "N次斩击"), air units included (the skill's own 攻击范围; PRTS 备注 of the 集成战略 version says ※可对空)
            const foes = enemiesInGrid(battle, unit, g);
            if (foes.length) battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: foes.length });
            for (const e of foes) {
              for (let i = 0; i < hits && e.alive; i++) {
                battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', defIgnorePct: pen, isSkill: true, tags: ['skill', 'slash'] });
              }
            }
          },
        }),
      }),
      talents: [
        { install(battle, unit) { // 无垠之心: until the `cnt`-th activation after the deployment
          const rate = num(t0.sp_recovery_per_sec), cnt = Math.max(1, Math.floor(num(t0.cnt, 2)));
          if (!(rate > 0)) return;
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            battle.addBuff(unit, { key: 'acpion:t1', mods: { spRecoveryFlat: rate }, tags: ['talent'], visible: true });
          }, { owner: unit });
          battle.on('skillStart', (c) => {
            if (c.unit !== unit || unit.skill.activations < cnt) return;
            battle.removeBuff(unit, 'acpion:t1');
          }, { owner: unit });
        } },
        { install(battle, unit) { // 浪潮之心: ATK +10%, +1 DP per kill
          statBuff(battle, unit, 'acpion:t2', { atkPct: num(t1.atk) });
          const n = num(t1.cost);
          if (n > 0) battle.on('kill', (c) => { if (c.killer === unit && c.victim.side === 'enemy') gainDp(battle, unit, n); }, { owner: unit });
        } },
      ],
      // 模组 SOL-X 郁金香证章: "阻挡敌人时攻击力和防御力各+8%" (trait bb atk/def; 忍冬 / 焰尾 SOL-X read it the same way)
      install(battle, unit) {
        const ma = num(def.traitBb?.atk, 0), md = num(def.traitBb?.def, 0);
        if (ma || md) whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'acpion:module', unit.blocking.length > 0, { atkPct: ma, defPct: md }));
      },
    };
  },

  // ===============================================================================================================
  // 609_acguad Sharp (WARRIOR 无畏者, char_609_acguad)
  //   隐匿刀刃: 攻击力+15%，获得30%的物理闪避
  //   寸步不退: 在战场停留30秒后，自身攻击速度+10
  //   S1 快刀: 30 s — 攻击力+25%，每次攻击有20%概率变成二连击
  //   S2 亮剑: 30 s — 防御力降至0，生命上限+30%，每次攻击的攻击力提升至160%
  //   S3 力战不竭 (default): 16 s — 攻击力+30%；每次攻击时获得可叠加的攻击力+16%的增益（最多叠加8层），切换目标后
  //      层数清零，技能持续期间内干员的生命值始终不会低于1
  chess_free_char_609_acguad: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const S1 = 'skchr_acguad_1', S3 = 'skchr_acguad_3';
    /** 力战不竭's stack buff (atk_each_stack × n, ≤ max_atk_stack_cnt). */
    function setStacks(battle, unit, n) {
      const per = num(bb.atk_each_stack), max = Math.max(1, Math.floor(num(bb.max_atk_stack_cnt, 1)));
      const k = Math.max(0, Math.min(max, Math.floor(n)));
      unit.mem.acguadStacks = k;
      if (k > 0) battle.addBuff(unit, { key: 'acguad:stacks', mods: { atkPct: per * k }, refresh: 'replace', source: unit, visible: true });
      else battle.removeBuff(unit, 'acguad:stacks');
    }
    return {
      // 模组 DRE-X Sharp证章: "攻击被阻挡的敌人时攻击力提升至115%" (trait bb atk_scale; 耀骑士临光 DRE-X reads it the
      // same way — blocked by ANY operator counts, "被阻挡的敌人")
      trait: num(def.traitBb?.atk_scale, 1) > 1 ? { dmgMul: (b, u, t) => (t.blockedBy ? num(def.traitBb.atk_scale, 1) : 1) } : null,
      skills: alt(def, {
        skchr_acguad_1: () => ({ kind: 'duration', mods: { atkPct: num(bb.atk) } }),
        // 亮剑: "防御力降至0" = a final multiplier of 0 on DEF (defMul), so nothing can raise it back
        skchr_acguad_2: () => ({
          kind: 'duration',
          mods: { hpPct: num(bb.max_hp), defMul: 0 },
          attack: { atkScale: num(bb['attack@atk_scale'], num(bb.atk_scale, 1)) },
        }),
        [S3]: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          onStart({ battle, unit }) {
            unit.mem.acguadTarget = null;
            setStacks(battle, unit, 0);
            if (unit.mem.acguadUndying) battle.off(unit.mem.acguadUndying);
            // "技能持续期间内干员的生命值始终不会低于1" (the 幽灵鲨 肉斩骨断 / 幽灵鲨2 S3 pattern)
            unit.mem.acguadUndying = battle.on('fatal', (c) => { if (c.unit === unit && skillOn(unit, S3)) c.prevented = true; }, { owner: unit, priority: 10 });
          },
          onEnd({ battle, unit }) {
            unit.mem.acguadTarget = null;
            setStacks(battle, unit, 0);
            if (unit.mem.acguadUndying) { battle.off(unit.mem.acguadUndying); unit.mem.acguadUndying = null; }
          },
        }),
      }),
      install(battle, unit) {
        if (isSel(def, S1)) {
          // "每次攻击有20%概率变成二连击" — one roll per attack; the attack itself doubles (a 2nd damage instance)
          const p = num(bb['attack@prob1']);
          if (p > 0) battle.on('attack', (c) => {
            if (c.attacker !== unit || !skillOn(unit, S1) || !c.targets.length) return;
            if (battle.rng.chance(p)) doubleHit(battle, unit, c.targets);
          }, { owner: unit });
        }
        if (isSel(def, S3)) {
          // "每次攻击时获得可叠加的攻击力+16%的增益（最多叠加8层），切换目标后层数清零"; PRTS 备注: judged before each
          // successful attack, at least one stack takes effect — so a fresh target's first attack carries 1 stack
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !skillOn(unit, S3)) return;
            const t = c.targets && c.targets[0];
            if (!t) return;
            const same = unit.mem.acguadTarget === t.id;
            unit.mem.acguadTarget = t.id;
            setStacks(battle, unit, same ? (unit.mem.acguadStacks ?? 0) + 1 : 1);
          }, { owner: unit });
        }
      },
      talents: [
        { install(battle, unit) { // 隐匿刀刃
          statBuff(battle, unit, 'acguad:t1', { atkPct: num(t0.atk), dodgePhys: num(t0.prob) });
        } },
        { install(battle, unit) { // 寸步不退: `interval` s after each deployment, ASPD +attack_speed
          const iv = num(t1.interval, 0), v = num(t1.attack_speed);
          if (!(iv > 0) || !(v > 0)) return;
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.acguadAt = battle.time; }, { owner: unit });
          whileDeployed(battle, unit, 0.5, () => {
            const t = unit.mem.acguadAt;
            toggleBuff(battle, unit, 'acguad:t2', t != null && battle.time - t >= iv, { aspd: v });
          });
        } },
      ],
    };
  },

  // ===============================================================================================================
  // 610_acfend Mechanist (TANK 铁卫, char_610_acfend)
  //   精研材料: 防御力+10%，生命值低于50%时防御力额外+10%（生命比例每0.1秒检测一次）
  //   反馈装甲: 自身阻挡的敌人攻击速度-7
  //   S1 结构稳定: 40 s — 最大生命值+26%，防御力+26%
  //   S2 不变性原理: 20 s — 防御力+50%，第二天赋的效果提升至2倍
  //   S3 应力倒置 (default): 30 s — 防御力+50%，阻挡数+1，每秒对自身阻挡的敌人造成相当于攻击力40%的法术伤害
  //   (all three are MANUAL 重装 skills ⇒ the data trigger TAKE_DAMAGE stays)
  chess_free_char_610_acfend: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const S2 = 'skchr_acfend_2';
    return {
      skills: alt(def, {
        skchr_acfend_1: () => ({ kind: 'duration', mods: { hpPct: num(bb.max_hp), defPct: num(bb.def) } }),
        [S2]: () => ({ kind: 'duration', mods: { defPct: num(bb.def) } }),
        skchr_acfend_3: () => ({
          kind: 'duration',
          mods: { defPct: num(bb.def), blockCnt: num(bb.block_cnt) },
          onStart({ unit }) { unit.mem.acfend = { acc: 0 }; },
          onTick({ battle, unit, dt }) {
            const m = unit.mem.acfend;
            if (!m) return;
            m.acc += dt;
            while (m.acc + 1e-9 >= 1) {
              m.acc -= 1;
              for (const e of unit.blocking.slice()) {
                if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'stress'] });
              }
            }
          },
          onEnd({ unit }) { unit.mem.acfend = null; },
        }),
      }),
      talents: [
        { install(battle, unit) { // 精研材料 (checked every 0.1 s)
          const base = num(t0.def), extra = num(t0['acfend_t_1[extra].def']), lim = num(t0.hp_ratio, 0.5);
          if (!(base > 0 || extra > 0)) return;
          whileDeployed(battle, unit, 0.1, () => {
            const m = { defPct: base + (unit.hpRatio < lim ? extra : 0) };
            const cur = unit.findBuff('acfend:t1');
            if (!cur || cur.mods.defPct !== m.defPct) battle.addBuff(unit, { key: 'acfend:t1', mods: m, tags: ['talent'], visible: true });
          });
        } },
        { install(battle, unit) { // 反馈装甲: the enemies it blocks get ASPD `attack_speed` (×talent_mult during S2)
          const v = num(t1.attack_speed);
          if (!v) return;
          whileDeployed(battle, unit, 0.1, () => {
            const m = skillOn(unit, S2) ? num(bb.talent_mult, 1) : 1;
            for (const e of unit.blocking) if (e.alive) pulse(battle, e, 'acfend:t2', { aspd: v * m });
          });
        } },
      ],
      // 模组 PRO-X Mechanist证章: "阻挡敌人时防御力+20%" (trait bb def; 泡泡 / 蛇屠箱 / 星熊 PRO-X read it the same way)
      install(battle, unit) {
        const bd = num(def.traitBb?.def, 0);
        if (bd) whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'acfend:module', unit.blocking.length > 0, { defPct: bd }));
      },
    };
  },

  // ===============================================================================================================
  // 611_acnipe Stormeye (SNIPER 速射手, char_611_acnipe; 优先攻击空中单位)
  //   风坠: 攻击时有25%的概率攻击力提升至180%
  //   风雨欲来: 自身未进行攻击时，技力回复速度+0.2/秒
  //   模组 MAR-X Stormeye证章: "攻击空中单位时攻击力提升至110%" — the 速射手 (fastshot) profile reads the trait bb
  //      `atk_scale` as its fly bonus (professions.js TUNE.fastshot → flyScale), so the module needs no kit code
  //   S1 破空: 20 s — 攻击力+15%，攻击速度+30，无视攻击目标100防御力
  //   S2 心手合一 (AUTO, 持续时间无限): 攻击力+5%，每次攻击额外攻击1个目标
  //   S3 旋臂 (default): 30 s — 可以同时攻击3个目标，第一天赋的触发概率提高至30%，攻击变为二连击；攻击目标生命值
  //      高于90%时额外造成1次伤害
  chess_free_char_611_acnipe: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const S3 = 'skchr_acnipe_3';
    const extraScale = num(bb['attack@atk_scale_extra']);
    const extraHp = num(bb['attack@hp_ratio'], 1);
    return {
      skills: alt(def, {
        skchr_acnipe_1: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed), defIgnoreFlat: num(bb.def_penetrate_fixed) },
        }),
        // "持续时间无限" ⇒ toggle (genericKind's reading); an AUTO skill keeps its own rule (no 技能策略, no op cooldown)
        skchr_acnipe_2: () => ({
          kind: 'toggle',
          mods: { atkPct: num(bb.atk) },
          targeting: { maxTargets: Math.max(2, Math.floor(num(bb['attack@max_target'], 2))) },
        }),
        [S3]: () => ({
          kind: 'duration',
          targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
          attack: {
            hits: Math.max(1, Math.floor(num(bb['attack@times'], 1))),
            // "攻击目标生命值高于90%时额外造成1次伤害": one extra instance per attacked target; the ratio is read
            // BEFORE the hit (`install` records the targets on `beforeAttack`, this runs per target of the attack)
            onEachHit({ battle, unit, target, isSplash }) {
              if (isSplash || !target || !target.alive || !(extraScale > 0)) return;
              if (!(unit.mem.acnipeExtra && unit.mem.acnipeExtra.has(target.id))) return;
              battle.dealDamage(unit, target, { amount: unit.s.atk * extraScale, type: 'phys', isSkill: true, tags: ['skill', 'extra'] });
            },
          },
        }),
      }),
      install(battle, unit) {
        if (!isSel(def, S3)) return;
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit) return;
          if (!skillOn(unit, S3)) { unit.mem.acnipeExtra = null; return; }
          const set = new Set();
          for (const t of c.targets) if (t && t.alive && t.hpRatio > extraHp + 1e-9) set.add(t.id);
          unit.mem.acnipeExtra = set.size ? set : null;
        }, { owner: unit });
      },
      talents: [
        { install(battle, unit) { // 风坠 (S3 raises the proc to `talent@prob`)
          const p0 = num(t0.prob), sc = num(t0.atk_scale, 1);
          const pMax = isSel(def, S3) ? num(bb['talent@prob'], p0) : p0;
          if (!(p0 > 0) || sc === 1) return;
          battle.on('hit', (c) => {
            const d = c.dmg;
            if (c.source !== unit || !c.target || c.target.side !== 'enemy' || !d.isAttack || d.isSplash || d.cancel) return;
            if ((d.tags || []).includes('extra')) return; // the S3 bonus instance is not procced a second time [ASSUMED]
            const p = skillOn(unit, S3) ? pMax : p0;
            if (p > 0 && battle.rng.chance(p)) { d.amount *= sc; battle.fx('crit', { x: c.target.x, y: c.target.y, id: unit.id }); }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 风雨欲来: "自身未进行攻击时，技力回复速度+0.2/秒"
          const rate = num(t1.sp_recovery_per_sec), delay = num(t1.delay, 0);
          if (!(rate > 0)) return;
          whileDeployed(battle, unit, 0.2, () => {
            toggleBuff(battle, unit, 'acnipe:t2', battle.time - (unit.lastAttackAt ?? -Infinity) >= delay, { spRecoveryFlat: rate });
          });
        } },
      ],
    };
  },

  // ===============================================================================================================
  // 612_accast Pith (CASTER 扩散术师, char_612_accast; 攻击造成群体法术伤害)
  //   “见我所见”: 攻击无视目标12法术抗性
  //   “授我所授”: 自身及相邻四格的【术师】干员攻击力+10%
  //   S1 “书我所书” (AUTO): 25 s — 自身攻击速度+30，溅射范围扩大
  //   S2 “为我所为”: 35 s — 自身攻击速度+35，所有【术师】干员攻击力+30%
  //   S3 “驭我所驭” (default): 35 s — 开启技能时，立即对攻击范围内的所有敌人造成一次攻击力100%的法术伤害，之后攻击
  //      目标数+1，攻击速度+40，溅射范围略微扩大（PRTS 备注: 溅射范围扩大至1.2）
  chess_free_char_612_accast: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const casters = (battle, unit) => ownerOps(battle, unit, (a) => a.def?.profession === 'CASTER');
    const splash = (d) => num(bb['attack@projectile_range'], d);
    return {
      skills: alt(def, {
        skchr_accast_1: () => ({
          kind: 'duration',
          mods: { aspd: num(bb.attack_speed) },
          attack: { splashRadius: splash(1.1) },
        }),
        skchr_accast_2: () => ({
          kind: 'duration',
          mods: { aspd: num(bb.attack_speed) },
          onStart({ battle, unit }) {
            const dur = num(def?.skill?.duration, 0);
            for (const a of casters(battle, unit)) battle.addBuff(a, { key: 'accast:doctrine', duration: dur > 0 ? dur : Infinity, mods: { atkPct: num(bb.atk) }, source: unit, visible: true });
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'doctrine' });
          },
          onEnd({ battle }) { for (const a of battle.allyUnits) battle.removeBuff(a, 'accast:doctrine'); },
        }),
        skchr_accast_3: () => ({
          kind: 'duration',
          mods: { aspd: num(bb.attack_speed) },
          targeting: { maxTargets: Math.max(2, Math.floor(num(bb['attack@max_target'], 2))) },
          attack: { splashRadius: splash(1.2) },
          onStart({ battle, unit }) {
            for (const e of enemiesInGrid(battle, unit, null)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale_aoe, 1), type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
            battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id });
          },
        }),
      }),
      talents: [
        { install(battle, unit) { // 见我所见: attacks ignore `magic_resist_penetrate_fixed` RES
          statBuff(battle, unit, 'accast:t1', { resIgnoreFlat: num(t0.magic_resist_penetrate_fixed) });
        } },
        { install(battle, unit) { // 授我所授: self + the 【术师】 operators on the 4 adjacent tiles, ATK +atk
          const v = num(t1.atk);
          if (!(v > 0)) return;
          whileDeployed(battle, unit, AURA, () => {
            if (unit.def?.profession === 'CASTER') pulse(battle, unit, 'accast:t2', { atkPct: v });
            for (const a of adjacentAllies(battle, unit, unit)) if (a.def?.profession === 'CASTER') pulse(battle, a, 'accast:t2', { atkPct: v });
          });
        } },
      ],
      // 模组 SPC-X Pith证章: "攻击范围扩大" — the module's range-only talent change (index −1 grid, 莫斯提马 / 莱恩哈特 /
      // 夕 SPC-X): it replaces the unit's own range from the deployment on
      install(battle, unit) { applyModuleRange(battle, unit, def); },
    };
  },

  // ===============================================================================================================
  // 613_acmedc Touch (MEDIC 医师, char_613_acmedc; 恢复友方单位生命)
  //   攫升: 治疗目标时使其获得3点技力
  //   超脱: 攻击范围内的友方干员被击倒时获得5点技力
  //   S1 慨赠: 20 s — 攻击力+40%，每次治疗有40%概率额外治疗一次
  //   S2 宛如天启: 30 s — 自身攻击范围扩大（3-10），每次治疗2个目标，所有医疗干员攻击力+21%
  //   S3 恳切福音 (default): 40 s — 自身攻击范围扩大（5-2），攻击力+20%，每次治疗2个目标，并额外治疗一次目标或目标
  //      相邻1个友方单位，治疗量为主目标的30%。对生命值不高于一半的友方单位治疗量提高为原来的135%
  chess_free_char_613_acmedc: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const g = gridOf(def);
    const S1 = 'skchr_acmedc_1', S2 = 'skchr_acmedc_2', S3 = 'skchr_acmedc_3';
    const boost = num(bb.heal_scale, 1), lim = num(bb.hp_ratio, 0), extraMul = num(bb['attack@addition_heal_scale'], 0);
    const medics = (battle, unit) => ownerOps(battle, unit, (a) => a.def?.profession === 'MEDIC');
    return {
      skills: alt(def, {
        skchr_acmedc_1: () => ({ kind: 'duration', mods: { atkPct: num(bb.atk) } }),
        [S2]: () => ({
          kind: 'duration',
          targeting: { ...(g ? { rangeGrid: g } : {}), maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
          onStart({ battle, unit }) {
            const dur = num(def?.skill?.duration, 0);
            for (const a of medics(battle, unit)) battle.addBuff(a, { key: 'acmedc:doctrine', duration: dur > 0 ? dur : Infinity, mods: { atkPct: num(bb['attack@atk']) }, source: unit, visible: true });
          },
          onEnd({ battle }) { for (const a of battle.allyUnits) battle.removeBuff(a, 'acmedc:doctrine'); },
        }),
        [S3]: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          targeting: { ...(g ? { rangeGrid: g } : {}), maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
          // "并额外治疗一次目标或目标相邻1个友方单位，治疗量为主目标的30%": one extra heal per heal action (2 targets
          // share it), 30 % of the main (first, lowest-HP-ratio) target's amount, the lower HP ratio of the target /
          // its 4 neighbours first (PRTS 备注: "优先选择生命比例更低的单位治疗（可治疗生命值已满单位）"). The extra heal
          // is a heal of its own, so the ≤ hp_ratio boost reaches it too when ITS target is that low (PRTS 备注
          // "额外治疗可触发技能后半段的治疗量提高效果")
          onHit({ battle, unit, target, heal }) {
            if (!(extraMul > 0) || !target || !(heal > 0)) return;
            const n = unit.stats.attacks;
            if (unit.mem.acmedcExtraAt === n) return;
            unit.mem.acmedcExtraAt = n;
            const main = unit.mem.acmedcMain && unit.mem.acmedcMain.target === target ? unit.mem.acmedcMain.amount : heal;
            let best = target;
            for (const a of adjacentAllies(battle, unit, target)) if (a.hpRatio < best.hpRatio) best = a;
            battle.heal(unit, best, main * extraMul);
            battle.fx('heal', { x: best.x, y: best.y, id: unit.id });
          },
        }),
      }),
      install(battle, unit) {
        // 模组 PHY-X Touch证章: "治疗生命值低于50%的友方单位时治疗量提升15%" (trait bb heal_scale / hp_ratio;
        // 录武官 / 华法琳 PHY-X use the same helper). It multiplies with S3's own ≤ hp_ratio boost, as both do.
        installLowHpHealBonus(battle, unit, def.traitBb || {});
        if (isSel(def, S3)) {
          // the ≤ hp_ratio boost, and the main heal's amount the extra heal is a share of
          battle.on('heal', (c) => {
            if (c.source !== unit || !skillOn(unit, S3)) return;
            if (lim > 0 && c.target.hpRatio <= lim + 1e-9) c.amount *= boost;
            unit.mem.acmedcMain = { target: c.target, amount: c.amount };
          }, { owner: unit });
        }
        if (isSel(def, S1)) {
          // "每次治疗有40%概率额外治疗一次"
          const p = num(bb['attack@prob']);
          if (p > 0) battle.on('attack', (c) => {
            if (c.attacker !== unit || !skillOn(unit, S1)) return;
            for (const a of c.targets) {
              if (!a || !a.alive || a.side !== 'ally') continue;
              if (!battle.rng.chance(p)) continue;
              battle.heal(unit, a, unit.s.atk);
              battle.fx('heal', { x: a.x, y: a.y, id: unit.id });
            }
          }, { owner: unit });
        }
      },
      talents: [
        { install(battle, unit) { // 攫升: "治疗目标时使其获得3点技力" (a heal output suffices, no HP restored needed)
          const sp = num(t0.sp, 0);
          if (!(sp > 0)) return;
          battle.on('heal', (c) => {
            const tg = c.target;
            if (c.source !== unit || !tg || tg === unit || tg.kind === 'device' || !tg.skill) return;
            if (tg.side !== 'ally' || !battle.allySelectable(tg, unit)) return;
            giveSp(tg, sp);
          }, { owner: unit, priority: -200 });
        } },
        { install(battle, unit) { // 超脱: "攻击范围内的友方干员被击倒时获得5点技力"
          const sp = num(t1.sp, 0);
          if (!(sp > 0)) return;
          battle.on('death', (c) => {
            const d = c.unit;
            if (c.reason !== 'killed' || !unit.alive || !unit.deployed || !d || d === unit || d.kind !== 'op' || d.ownerId !== unit.ownerId) return;
            if ((unit.rangeKeySet || new Set(unit.rangeKeys || [])).has(d.tileR * COLS + d.tileC)) {
              giveSp(unit, sp);
              battle.fx('spGain', { x: unit.x, y: unit.y, id: unit.id, n: sp });
            }
          }, { owner: unit });
        } },
      ],
    };
  },

  // ===============================================================================================================
  // 614_acsupo Raidian (SUPPORT 凝滞师, char_614_acsupo; 攻击造成法术伤害，并对敌人造成短暂的停顿)
  //   同调: 攻击速度+15，相邻的干员攻击速度+10
  //   诱引: 攻击范围内敌人的物理和法术命中率降低10%
  //   S1 双声: 24 s — 攻击力+25%，额外攻击一个目标
  //   S2 三形: 14 s — 攻击间隔略微缩短(-0.1 s)，同时攻击三个目标，攻击造成的停顿时间延长至1.1秒
  //   S3 信号跃动 (default): 30 s — 攻击范围扩大（y-4），攻击力+40%，第一天赋的效果提升至2倍，攻击范围内所有敌人
  //      受到10%的脆弱效果和10%的虚弱效果
  chess_free_char_614_acsupo: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const g = gridOf(def);
    const S3 = 'skchr_acsupo_3';
    const scale = num(bb.talent_scale, 1);
    const fragile = Math.max(0, num(bb.damage_scale, 1) - 1);   // "受到10%的脆弱效果" (damage taken ×1.1)
    const weakenPri = num(bb.atk, 0);                           // the 虚弱's 同名取最高 priority (0.9) — NOT the skill's ATK
    const weakenVal = 0.1;                                      // the description's 10 % (no blackboard key of its own)
    /** 信号跃动: 脆弱 + 虚弱 on every enemy of the (enlarged) attack range, refreshed while the skill runs. */
    function debuffRange(battle, unit) {
      for (const e of battle.enemiesInKeys(unit.rangeKeys || [], unit, { canHitFly: true })) {
        if (fragile > 0) battle.applyStatus(e, 'fragile', { duration: AURA_DUR, value: fragile, source: unit });
        if (weakenPri > 0) battle.applyStrongest(e, 'acsupo:weaken', { duration: AURA_DUR, value: weakenPri, source: unit, mods: () => ({ atkMul: Math.max(0, 1 - weakenVal) }) });
      }
    }
    return {
      skills: alt(def, {
        skchr_acsupo_1: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          targeting: { maxTargets: Math.max(2, Math.floor(num(bb['attack@max_target'], 2))) },
        }),
        skchr_acsupo_2: () => ({
          kind: 'duration',
          mods: { batPct: batFlat(def, bb.base_attack_time) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 3))) },
          attack: {
            onHit({ battle, unit, target }) {
              if (target && target.alive) battle.applyStatus(target, 'sluggish', { duration: num(bb['attack@sluggish'], 0.8), source: unit });
            },
          },
        }),
        [S3]: () => ({
          kind: 'duration',
          // the blackboard carries the skill's ATK twice: `acsupo_s_3.atk` 0.4 is the description's "+40%"; the plain
          // `atk` 0.9 is the 虚弱's 同名取最高 value the PRTS 备注 explains ("此技能的虚弱在叠加时视为90%…仅影响叠加
          // 优先级，不影响实际效果") — never the skill's own ATK
          mods: { atkPct: num(bb['acsupo_s_3.atk'], num(bb.atk)) },
          targeting: g ? { rangeGrid: g } : undefined,
          onStart({ battle, unit }) { debuffRange(battle, unit); },
          onTick({ battle, unit }) { debuffRange(battle, unit); },
        }),
      }),
      talents: [
        { install(battle, unit) { // 同调: self ASPD +attack_speed, the adjacent operators +[ally].attack_speed (S3 ×scale)
          const self = num(t0.attack_speed), ally = num(t0['acsupo_t_1[ally].attack_speed']);
          whileDeployed(battle, unit, AURA, () => {
            const sc = skillOn(unit, S3) ? scale : 1;
            const want = self * sc;
            const cur = unit.findBuff('acsupo:t1');
            if (want > 0 && (!cur || cur.mods.aspd !== want)) battle.addBuff(unit, { key: 'acsupo:t1', mods: { aspd: want }, tags: ['talent'], visible: true });
            if (ally > 0) for (const a of adjacentAllies(battle, unit, unit)) pulse(battle, a, 'acsupo:t1-ally', { aspd: ally * sc });
          });
        } },
        { install(battle, unit) { // 诱引: "攻击范围内敌人的物理和法术命中率降低10%" — a per-hit miss roll (the engine
          // has no accuracy stat); the enemy has to stand in Raidian's range, and only phys / arts hits roll
          const p = Math.max(0, -num(t1.damage_hitrate_physical, 0.1));
          if (!(p > 0)) return;
          battle.on('hit', (c) => {
            const d = c.dmg, src = c.source;
            if (!src || src.side !== 'enemy' || d.cancel || (d.type !== 'phys' && d.type !== 'arts')) return;
            if (!unit.alive || !unit.deployed) return;
            if (!bodyInKeys(src, unit.rangeKeySet || new Set(unit.rangeKeys || []))) return;
            if (!battle.rng.chance(p)) return;
            d.cancel = true;
            battle.fx('dodge', { x: c.target.x, y: c.target.y, id: unit.id });
            battle.emit('dodge', { source: src, target: c.target, dmg: d });
          }, { owner: unit });
        } },
      ],
      // 模组 DEC-X Raidian证章: "攻击范围内存在敌人时技力自然恢复速度+0.2/秒" — the value lives in the module's hidden
      // talent (index −1), the condition in its trait text (tier1 波登可 / tier2 小满 DEC-X use the same pair)
      install(battle, unit) {
        spTimeBonus(battle, unit, num(moduleTalentBb(def).sp_recovery_per_sec), () => enemyInRange(battle, unit));
      },
    };
  },

  // ===============================================================================================================
  // 615_acspec Misery (SPECIAL 处决者, char_615_acspec; 再部署时间大幅度减少)
  //   二象命末: 攻击时有10%概率造成二连击
  //   四维分离: 周围四格内仅存在一名敌人时，攻击力+10%
  //   S1 物理的服从 (被动): 部署后第一天赋触发概率提升至25%，获得45%物理闪避（持续10秒）
  //   S2 战争的恭顺 (被动): 部署后攻击力+30%，攻击速度+15（持续10秒）
  //   S3 空间的归依 (被动, default): 部署后立即对周围所有敌人造成相当于攻击力210%的物理伤害，开启空间源石技艺将所有未被
  //      阻挡的敌人小力地拖拽至面前并施加2.5秒停顿 — PRTS 备注 "※不可对空"
  chess_free_char_615_acspec: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const g = gridOf(def);
    const S1 = 'skchr_acspec_1';
    const dur = Math.max(0.1, num(def?.skill?.duration, 10));
    // 二象命末's proc chance: the data key is `attack@prob` (the module's X-3 raises it to 15 %), `prob` only as a
    // fallback; S1 物理的服从 raises it for its 10 s
    const p0 = num(t0['attack@prob'], num(t0.prob));
    const pS1 = isSel(def, S1) ? num(bb['attack@prob'], p0) : p0;
    return {
      skills: alt(def, {
        // a PASSIVE skill in the data (skillType PASSIVE, spType ON_DEPLOY): its effect starts at every deployment
        [S1]: () => ({
          kind: 'passive',
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: 'acspec:s1', duration: dur, mods: { dodgePhys: num(bb.prob) }, visible: true, tags: ['skill'] });
            battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id });
          },
        }),
        skchr_acspec_2: () => ({
          kind: 'passive',
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: 'acspec:s2', duration: dur, mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) }, visible: true, tags: ['skill'] });
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'power' });
          },
        }),
        skchr_acspec_3: () => ({
          kind: 'passive',
          onStart({ battle, unit }) {
            const foes = enemiesInGrid(battle, unit, g, { canHitFly: false, groundOnly: true });
            for (const e of foes) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill', 'burst'] });
            for (const e of foes) {
              if (!e.alive) continue;
              if (!e.blockedBy) battle.pullToFront(e, unit, num(bb.force, 0));   // 小力 = 力度 0
              battle.applyStatus(e, 'sluggish', { duration: num(bb.sluggish, 0), source: unit });
            }
            if (foes.length) battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id });
          },
        }),
      }),
      talents: [
        { install(battle, unit) { // 二象命末 (S1 raises the proc to 25 % for its 10 s; the module X-3 adds ATK `atk`)
          const atk = num(t0.atk);
          if (atk > 0) statBuff(battle, unit, 'acspec:t1-atk', { atkPct: atk });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || !c.targets.length) return;
            const p = unit.findBuff('acspec:s1') ? pS1 : p0;
            if (!(p > 0) || !battle.rng.chance(p)) return;
            doubleHit(battle, unit, c.targets);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 四维分离: exactly `cnt` enemies on the 4 tiles around ⇒ ATK +atk
          const want = Math.max(1, Math.floor(num(t1.cnt, 1))), v = num(t1.atk);
          if (!(v > 0)) return;
          whileDeployed(battle, unit, 0.1, () => {
            const n = enemiesInGrid(battle, unit, [[1, 0], [-1, 0], [0, 1], [0, -1]], { blocked: false }).length;
            toggleBuff(battle, unit, 'acspec:t2', n === want, { atkPct: v });
          });
        } },
      ],
      // 模组 EXE-X Misery证章: "周围四格没有友方干员时攻击力+10%" (trait bb atk; 缄默德克萨斯 EXE-X uses the same rule)
      install(battle, unit) {
        const a = num(def.traitBb?.atk, 0);
        if (a) whileDeployed(battle, unit, AURA, () => toggleBuff(battle, unit, 'acspec:module', lonely(battle, unit), { atkPct: a }));
      },
    };
  },

  // ===============================================================================================================
  // 617_sharp2 领主·Sharp (WARRIOR 领主, char_617_sharp2; 可以进行远程攻击，但此时攻击力降低至80%)
  //   无声之锋: 攻击力+20%，获得25%的法术闪避
  //   陷阵勇气: 攻击范围内存在2名及以上敌人时，攻击速度+12
  //   S1 沉默的爆发 (default): 30 s — 攻击力+130%，攻击速度+35，同时攻击2个目标，远程攻击不再降低攻击力
  chess_free_char_617_sharp2: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    return {
      skills: alt(def, {
        skchr_sharp2_1: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
          // "远程攻击不再降低攻击力": the lord profile's ×0.8 ranged scale (professions.js TUNE.lord) is dropped — the
          // 银灰 S3 reading (attack.dmgMul = () => 1 with projectile 'none' = the hit resolves at melee scale)
          attack: { projectile: 'none', dmgMul: () => 1 },
        }),
      }),
      talents: [
        { install(battle, unit) { // 无声之锋: ATK +atk, `prob` arts dodge
          statBuff(battle, unit, 'sharp2:t1', { atkPct: num(t0.atk), dodgeArts: num(t0.prob) });
        } },
        { install(battle, unit) { // 陷阵勇气: ≥ cnt enemies in the attack range ⇒ ASPD +attack_speed
          const want = Math.max(1, Math.floor(num(t1.cnt, 1))), v = num(t1.attack_speed);
          if (!(v > 0)) return;
          whileDeployed(battle, unit, 0.1, () => {
            toggleBuff(battle, unit, 'sharp2:t2', battle.enemiesInKeys(unit.rangeKeys || [], unit, { canHitFly: true }).length >= want, { aspd: v });
          });
        } },
      ],
      // 模组 LOR-X 领主·Sharp证章: "攻击附带10%攻击力的法术伤害" — the value is the module's hidden talent (index −1,
      // key `magic_atk_scale`), one extra arts instance per attack hit (拉普兰德 / 银灰 LOR-X `atk_scale_m` reading)
      install(battle, unit) {
        const m = num(moduleTalentBb(def).magic_atk_scale, 0);
        if (!(m > 0)) return;
        battle.on('damaged', (c) => {
          if (c.source !== unit || !c.dmg?.isAttack || c.dmg.cancel || !c.target || c.target.side !== 'enemy' || !c.target.alive) return;
          battle.dealDamage(unit, c.target, { amount: unit.s.atk * m, type: 'arts', tags: ['module'] });
        }, { owner: unit });
      },
    };
  },

  // ===============================================================================================================
  // 1050_chen3 赤刃明霄陈 (WARRIOR 术战者, char_1050_chen3; 攻击造成法术伤害) — 火陈 [user], the reported "火龙"
  //   形意洞照: 攻击力+13%，攻击速度+13，攻击变为弱点伤害
  //   寒暑觉知: 未受到伤害时，每6秒随机治疗自身一定（攻击力的50%~200%）生命值，并闪避下次物理与法术攻击
  //   S1 赤霄·奔夜: 攻击力+65%，攻击变为二连击，攻击使目标敌人特殊能力失效至技能结束
  //   S2 赤霄·绝影-驰: 对周围最近的1名敌人发动10次斩击 ×390% 法术，击倒则转移（剩余次数+1），结束时移动到其位置；
  //                    之后攻击力+230%、40%双闪避
  //   S3 赤霄·天喟 (default, 20 s): 开启时向前释放一道剑气长龙（`swordQi`），并且每次攻击对最多 3 名地面敌人造成
  //                    3 次攻击力 165% 的法术伤害
  //
  // Only S3 is authored here: it is the skill the user reported ("火陈的火龙现在也没有实现") and the default one, so the
  // 剑气长龙 is what a player sees. S1 / S2 have no special mechanic the generic kit cannot express, so they keep falling
  // back to it (`selectSkillSpec`: no `skills[skchr_chen3_1|2]` entry ⇒ the generic spec of the selected skill), and the
  // two TALENTS stay unauthored like those of every other pick the generic kit serves — 78 of the 93 have none (only the
  // nine 原型干员 and the six 预备干员's `reserveKit` install one; DESIGN §21.11). Both gaps are recorded there rather than
  // half-modelled here: 形意洞照's 弱点伤害 (the attack deals whichever of physical / arts is higher for the target) has
  // no engine support anywhere, and modelling it for one operator alone would silently make 火陈 the only pick whose
  // talent exists.
  chess_free_char_1050_chen3: (bb, chess, def) => {
    const S3 = 'skchr_chen3_3';
    const g = gridOf(def);
    return {
      skills: alt(def, {
        [S3]: () => ({
          kind: 'duration',
          // "攻击范围扩大": the data's own S3 grid (what the generic spec's `targeting.rangeGrid` line does), and
          // "最多3名地面敌人": `attack@max_target` 3 (地面 ⇒ `attack.groundOnly`, the 蕾缪安 S3 reading)
          targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 3))), ...(g ? { rangeGrid: g } : {}) },
          // "3 次攻击力165%": the count is in the text, not in a `times` key — the generic kit reads `attack@atk_scale`
          // (1.65 ✓) but can only produce ONE instance per target, so the skill's real damage needs this line
          attack: { atkScale: num(bb['attack@atk_scale'], 1.65), hits: 3, dmgType: 'arts', groundOnly: true },
          onStart({ battle, unit }) { swordQi(battle, unit, bb); },
        }),
      }),
    };
  },

  // ===============================================================================================================
  // the six 4★ 预备干员: the shared generic skills + the plain stat talent `reserveKit` adds (see its doc comment)
  chess_free_char_601_cguard: reserveKit,  // 预备干员-近卫 (WARRIOR 无畏者): 攻击提升 攻击力+8%
  chess_free_char_602_cdfend: reserveKit,  // 预备干员-重装 (TANK 铁卫): 防御提升 防御力+10%
  chess_free_char_603_csnipe: reserveKit,  // 预备干员-狙击 (SNIPER 速射手): 攻击提升 攻击力+8%
  chess_free_char_604_ccast: reserveKit,   // 预备干员-术师 (CASTER 中坚术师): 施法速度提升 攻击速度+9
  chess_free_char_605_cmedic: reserveKit,  // 预备干员-医疗 (MEDIC 医师): 攻击提升 攻击力+8%
  chess_free_char_606_csuppo: reserveKit,  // 预备干员-辅助 (SUPPORT 凝滞师): 施法速度提升 攻击速度+9
};
