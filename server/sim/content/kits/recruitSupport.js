// Shared primitives for individually authored recruit kits. Values are selected-loadout blackboards.
//
// Ported from PR #71 by SrC2O4 — 增加六星自选功能 <https://github.com/sganggs/Stronghold-Protocol/pull/71>,
// head c76a81f (feature commit e0d1a15). GPL-3.0-or-later, inbound = outbound: the file keeps its author's structure.
//
// [our modification — GPL §5] This project resolves a 自选干员's skill spec through `selectSkillSpec`, which takes a
// kit's `skills[id]` AS-IS, while the original build let the record carry its own decoded spec. To keep the fields our
// decoder (`genericSkillSpec`) supplies — a field-level diff over the 234 自选干员 skill records found 43 specs narrower
// than the decoder's, 89 wider, 60 differing on both sides and 42 identical — `timed()`, `instant()` and `next()` now
// SEED from `genericSkillSpec(def.skill, bb, def)` and layer the kit's own fields on top, exactly as the author's own
// recruitsCombat/Special/Summons files already seed (`seed`/`seedSpec` + `Object.assign`).
// Merge rule: the kit wins per key; `mods` / `targeting` / `attack` merge per key, so a field the kit does not mention
// survives instead of being dropped. Function-valued fields (`onStart` / `onTick` / `onEnd` / `onHit`) are NOT chained —
// a kit that authors one owns that event (the decoder's `onStart` of a "立即…造成…" skill would otherwise fire twice).
import { genericSkillSpec } from '../generic.js';
import { bodyInKeys } from '../../body.js';
import { sortEnemyTargets, absoluteRangeKeys } from '../../targeting.js';

export const alive = (u) => !!u?.alive && u.deployed && !u.removed;
export const inRange = (u, t) => bodyInKeys(t, u.rangeKeySet);
export const talent = (raw, i) => raw.talents?.find((t) => t.index === i)?.bb ?? {};
export const talText = (raw, i) => raw.talents?.find((t) => t.index === i)?.desc ?? '';
export const owned = (b, u, id) => b.allyUnits.filter((t) => t.ownerUnit === u && (!id || t.def.id === id) && alive(t));
export const enemies = (b, u, n = Infinity, priority) => {
  const grid = u.skill?.active && u.skill.spec.targeting?.rangeGrid;
  const keys = grid ? absoluteRangeKeys(grid, u.tileR, u.tileC, u.dir, 0) : u.rangeKeys;
  const xs = b.enemiesInKeys(keys, u, { ...u.profile, ...(u.skill?.active ? u.skill.spec.targeting : {}) });
  sortEnemyTargets(b, u, xs, priority ?? u.profile.priority);
  return xs.slice(0, n);
};
export const buff = (b, u, key, mods, duration = Infinity, extra = {}) =>
  b.addBuff(u, { key, mods, duration, ...extra });
export const status = (b, u, t, key, duration, value) => b.applyStatus(t, key, { source: u, duration, value });
export const damage = (b, u, t, scale, type = 'phys', extra = {}) =>
  b.dealDamage(u, t, { amount: u.s.atk * scale, type, tags: ['recruit'], ...extra });
export function area(b, u, at, radius, scale, type = 'phys', effect) {
  for (const e of b.foesInRadius(at.x, at.y, radius)) {
    damage(b, u, e, scale, type);
    effect?.(e);
  }
  b.fx('aoe', { x: at.x, y: at.y, r: radius, id: u.id });
}
export const deploy = (b, u, fn) =>
  b.on(
    'deploy',
    ({ unit }) => {
      if (unit === u) fn();
    },
    { owner: u },
  );
export const every = (b, u, interval, fn) =>
  b.every(
    interval,
    () => {
      if (alive(u)) fn();
    },
    { owner: u },
  );
export const onHit = (b, u, fn) =>
  b.on(
    'damaged',
    (ctx) => {
      if (ctx.source === u && ctx.dmg?.isAttack && ctx.target.side === 'enemy') fn(ctx);
    },
    { owner: u },
  );
export const onAttack = (b, u, fn) =>
  b.on(
    'attack',
    (ctx) => {
      if (ctx.attacker === u) fn(ctx);
    },
    { owner: u },
  );
export const after = (b, u, delay, fn) => {
  const seq = u.deploySeq;
  return b.after(
    delay,
    () => {
      if (alive(u) && u.deploySeq === seq) fn();
    },
    { owner: u },
  );
};
export const bat = (bb, raw) => (bb.base_attack_time ?? 0) / raw.stats.bat;
export const statMods = (bb, raw) => ({
  atkPct: bb.atk ?? 0,
  defPct: bb.def ?? 0,
  aspd: bb.attack_speed ?? 0,
  batPct: bat(bb, raw),
});

/**
 * [our modification] The decoder seed of a kit spec: `genericSkillSpec` of the SELECTED skill record (never throwing —
 * a kit must not be able to lose its hand-authored fields to a decoder error).
 */
export function seedSpec(bb, raw, def) {
  const sk = def?.skill ?? raw?.skill ?? null;
  if (!sk) return {};
  try { return { ...(genericSkillSpec(sk, bb, def) ?? {}) }; } catch { return {}; }
}

/**
 * [our modification] Layer the kit's own spec fields on the decoder seed (see the file header): the kit wins per key and
 * `mods` / `targeting` / `attack` merge per key. An empty object is kept when the seed had one — `attack: {}` is the
 * engine's "the next attack is the skill's attack" (`skills.js activate`: `pending = !!spec.attack`).
 */
export function mergeSpec(bb, raw, def, over = {}) {
  const base = seedSpec(bb, raw, def);
  const out = { ...base, ...over };
  for (const k of ['mods', 'targeting', 'attack']) {
    if (base[k] || over[k]) out[k] = { ...(base[k] || {}), ...(over[k] || {}) };
  }
  // the seed's duration/ammo describe the seed's kind; a kit that re-kinds the skill (toggle/duration ⇄ charges) keeps
  // its own numbers and must not inherit an `ammo` count it never asked for
  if (over.kind && base.kind && over.kind !== base.kind && !('ammo' in over)) delete out.ammo;
  return out;
}

export const timed = (bb, raw, def, extra = {}) =>
  mergeSpec(bb, raw, def, {
    kind: raw.skill.duration < 0 ? 'toggle' : 'duration',
    mods: statMods(bb, raw),
    ...(def.skill.rangeGrid ? { targeting: { rangeGrid: def.skill.rangeGrid } } : {}),
    ...extra,
  });
export const next = (bb, raw, def, extra = {}) => mergeSpec(bb, raw, def, { kind: 'charges', attack: { atkScale: bb.atk_scale ?? 1 }, ...extra });
// [our modification] `instant` takes the same (bb, raw, def) context as `timed`/`next` — the call sites were updated
// accordingly — so its spec is seeded from the decoder too. `bb` may be `{}` where a kit wants no stat mods at all.
export const instant = (bb, raw, def, fn, extra = {}) =>
  mergeSpec(bb ?? {}, raw, def, { kind: 'charges', onStart: fn, ...extra });
// Only the selected authored spec is exposed; unrelated skills never get marked implemented.
export const kit = (raw, spec, install, trait) => ({ skills: { [raw.skill.skillId]: spec }, install, trait });
export function dot(b, u, t, key, amount, duration, type = 'arts', maxStacks = 1) {
  b.addBuff(t, {
    key: `${key}:${u.id}`,
    source: u,
    duration,
    interval: 1,
    refresh: maxStacks > 1 ? 'stack' : 'replace',
    maxStacks,
    onTick: ({ buff: a }) => b.dealDamage(u, t, { amount: amount * (a?.stacks ?? 1), type, tags: ['recruitDot'] }),
  });
}
