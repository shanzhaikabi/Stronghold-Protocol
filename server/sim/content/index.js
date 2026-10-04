// server/sim/content/index.js — installs all content into a Battle (DESIGN §7).
//
// installContent(battle, { mode }) — applies the per-battle loadout data view (simdata withUnitLoadouts; DESIGN §16),
//   then mode 'full' (default): hand-authored kits (kits/tier1..6) with generic
//   fallback + every domain module's install(battle); 'generic': generic kits only, no domain modules;
//   'none': no kits (units never cast skills) and no modules. Every module install runs inside try/catch:
//   a faulty content module is logged and skipped, never crashing the battle.
// setupUnitKit(battle, unit, mode) — resolves a unit's Kit: kits[baseChessId]?.(bb, chess, def) ?? generic.
//   Battle opts.kits ({ [baseChessId]: kitFn }) take precedence (tests / sandboxes).
//   Operator loadouts (DESIGN §16): the def is resolved for the unit's selected skill / module (simdata getChess), so
//   the kit receives `chess.skill` = the SELECTED skill record and `bb` = its blackboard (talents / trait / module of
//   the selected module). Kit contract (backward compatible): `{ skill?, skills?: { [skillId]: SkillSpec }, talents,
//   trait, install? }` — the skill spec is `skills[selectedSkillId]` when the kit authors it, else `skill` only when
//   the selected skill is the chess's default one, else the GENERIC spec of the selected skill (its generic install,
//   e.g. counter damage, is chained after the kit's). Talents / trait / install of the kit always apply.
//   syncUnitLoadout (called first, before the battle starts): a unit whose def lacks the loadout of its own input entry
//   (id-only data lookups in a multi-player field; an entry without loadout fields = the default) is given its own
//   def; summon pieces follow their owner (an inline `def` of a token entry is kept). Summons spawned AFTER the start
//   are resolved by Battle (getToken(id, owner.defId, owner.def.loadout)), not here.
// registerAllMeta(registry) — calls each domain module's registerMeta(registry) (prep side, server boot).
//
// [port] PR #71 by SrC2O4 — 增加六星自选功能 <https://github.com/sganggs/Stronghold-Protocol/pull/71>, head c76a81f:
//   the 78 per-operator 自选干员 kits (kits/recruits{Classic,Tactics,Combat,Summons,Special}.js) are registered under
//   the operator's charId, so `kitFn` gained upstream's `raw.kitBaseId` and `def.charId` fallbacks, and a kit of that
//   registry that authors no `talents` receives the installs of our own talent translator (content/genericTalents.js):
//   their kit object has no `talents` key, and `selectSkillSpec` returning it early would otherwise stop the translator
//   from running for the records it covers today. Our modification: those two lookups + the wrapper; the kits
//   themselves and their spec seeding live in kits/recruitSupport.js (see its header).

import { genericKit } from './generic.js';
import { translateTalents } from './genericTalents.js';
import { KIT_TALENTS, KIT_TALENT_NOTE } from './kits/recruitTalents.js';
import { withUnitLoadouts } from '../simdata.js';

// Content files are loaded with guarded dynamic imports: a module that fails to load (syntax error, throwing
// top-level code, missing file) is logged and replaced by an empty module instead of breaking the server.
async function safeImport(path) {
  try {
    return await import(path);
  } catch (e) {
    console.error(`[content] failed to load ${path}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    return {};
  }
}

const TIERS = await Promise.all([1, 2, 3, 4, 5, 6].map((t) => safeImport(`./kits/tier${t}.js`)));
// 自选干员 of 自由位置 (DESIGN §22): the hand-authored kits of the 6★ 原型干员 batch (data/freePicks.json records are
// keyed by their own chess id, so they never collide with a tier module's `chess_char_N_NN_a` keys)
const FREE_PICKS = await safeImport('./kits/freePicks.js');
// [port] PR #71 (SrC2O4, head c76a81f): the 78 per-operator kits of the roster, keyed by the operator's charId. Our own
// kits/freePicks.js wins for 火陈 / 望 (its `chess_free_<charId>` key is tried first) — see those entries.
const RECRUIT_MODULES = ['Classic', 'Tactics', 'Combat', 'Summons', 'Special'];
const RECRUITS = await Promise.all(RECRUIT_MODULES.map((n) => safeImport(`./kits/recruits${n}.js`)));
const RECRUIT_KITS = withGenericTalents(Object.assign({}, ...RECRUITS.map((m) => (m && m.default && typeof m.default === 'object' ? m.default : {}))));
/**
 * [port] PR #71's 78 kits (`charId` → kit function, the `withGenericTalents` wrappers): exported so a tool can tell a
 * ported kit from a hand-authored one of this project (tools/talent-plan.mjs labels the rows of the talent audit).
 */
export const PORTED_KITS = Object.freeze(RECRUIT_KITS);
const DOMAIN_NAMES = ['tokens', 'devices', 'enemies', 'bosses', 'bonds', 'garrisons', 'items', 'bands', 'choices'];
const DOMAINS = await Promise.all(DOMAIN_NAMES.map((n) => safeImport(`./${n}.js`)));
const tokens = DOMAINS[0];

/**
 * [port] PR #71: a kit of the recruit registry authors a skill (and sometimes a trait / an install) but no `talents` —
 * upstream's data model carried them in the recruit's own record. Ours does not: the generic talent translator has to
 * keep running for these records (docs/research/15-generic-talents.json, test/content/generic_talents.test.js), else
 * the records would lose the talent installs they have today. A kit that authors its own `talents` (ours in
 * kits/freePicks.js, every tier kit) is returned untouched.
 *
 * [our modification — GPL §5] The translator's install is dropped for the (charId, talentIndex) pairs of
 * kits/recruitTalents.js KIT_TALENTS — talents the ported kit implements itself, where merging would install the same
 * talent twice (measured: 艾雅法拉 炎息 +44 % instead of +22 %, 灰烬 突击手 17 SP twice). Those rows are reported as
 * `installed-by-kit`, the status genericTalents.js already uses for its thin WRAPPER_KITS.
 */
function withGenericTalents(reg) {
  const out = {};
  for (const [id, f] of Object.entries(reg)) {
    if (typeof f !== 'function') { out[id] = f; continue; }
    out[id] = (bb, raw, def) => {
      const k = f(bb, raw, def);
      if (!k || typeof k !== 'object' || Array.isArray(k.talents)) return k;
      try {
        const { installs, report } = translateTalents(def ?? raw, raw);
        const own = new Set(KIT_TALENTS[def?.charId] ?? []);
        return {
          ...k,
          talents: installs.filter((i) => !own.has(i.talentIndex)),
          talentPlan: report.map((r) => (own.has(r.index)
            ? { ...r, status: 'installed-by-kit', rule: 'kit-install:PR#71', reason: KIT_TALENT_NOTE, drops: [] }
            : r)),
        };
      } catch {
        return { ...k, talents: [] };
      }
    };
  }
  return out;
}

/** Merged kit registry: baseChessId (or charId, [port] PR #71) → (bb, chess, def) => Kit */
export const KITS = Object.freeze(Object.assign({},
  ...TIERS.map((m) => (m && m.default && typeof m.default === 'object' ? m.default : {})),
  FREE_PICKS && FREE_PICKS.default && typeof FREE_PICKS.default === 'object' ? FREE_PICKS.default : {},
  RECRUIT_KITS));

/**
 * The kit function of a def: `def.baseId` → `def.id` → the suffix-less id (DESIGN §5.6's `chess_char_1_01` and
 * data/SIM.md's `…_a` are both accepted) → [port] PR #71's `raw.kitBaseId` (upstream's "the record this recruit was
 * generated from") → [port] `def.charId`, how the 78 recruit kits are keyed. Null when no key holds a function.
 * @param {object|null} def normalised def (its `raw` is used for `kitBaseId`)
 * @param {object} kits registry (defaults to KITS)
 */
export function kitFn(def, kits = KITS) {
  if (!def) return null;
  const raw = def.raw ?? def;
  const bare = String(def.baseId ?? def.id ?? '').replace(/_[ab]$/, '');
  for (const k of [def.baseId, def.id, bare, raw && raw.kitBaseId, def.charId]) {
    if (k && typeof kits?.[k] === 'function') return kits[k];
  }
  return null;
}

/** Domain modules in install order: tokens, devices, enemies, bosses, bonds, garrisons, items, bands, choices. */
export const MODULES = Object.freeze(DOMAIN_NAMES.map((n, i) => [n, DOMAINS[i]]));

/** Resolve the Kit of an ally unit. Never throws (falls back to the generic kit). */
export function setupUnitKit(battle, unit, mode = 'full') {
  try { syncUnitLoadout(battle, unit); } catch (e) { battle._handlerError?.('loadout', unit, e); }
  if (mode === 'none') return {};
  const def = unit.def || {};
  const raw = def.raw ?? def;
  const bb = def.skill?.bb ?? {};
  if (unit.kind === 'token') {
    const tk = mode === 'full' ? (tokens.kits?.[def.id] ?? tokens.default?.[def.id]) : null;
    if (typeof tk === 'function') {
      try { const k = tk(bb, raw, def); if (k) return k; } catch (e) { battle._handlerError(`tokenKit:${def.id}`, unit, e); }
    }
    return def.skill ? genericKit(bb, raw, def) : {};
  }
  if (unit.kind !== 'op') return {};
  const injected = battle.opts && battle.opts.kits;
  if (mode === 'full' || injected) {
    const f = kitFn(def, injected) ?? (mode === 'full' ? kitFn(def, KITS) : null);
    if (typeof f === 'function') {
      try {
        const k = f(bb, raw, def);
        if (k) return selectSkillSpec(k, bb, raw, def);
      } catch (e) {
        battle._handlerError(`kit:${def.baseId}`, unit, e);
      }
    }
  }
  return genericKit(bb, raw, def);
}

/** A unit's own PlayerBattleInput entry (operators: kind ≠ 'token'; tokens: kind 'token'), or null. */
function inputEntry(unit) {
  const list = unit && unit.player && unit.player.input && Array.isArray(unit.player.input.units) ? unit.player.input.units : null;
  if (!list || unit.uid == null) return null;
  const tok = unit.kind === 'token';
  return list.find((v) => v && v.uid === unit.uid && (v.kind === 'token') === tok) ?? null;
}

/**
 * The loadout `{ skillIndex, moduleId }` a unit's PlayerBattleInput entry gives; an entry without loadout fields means
 * the DEFAULT loadout (`{}`), never "whatever the data view maps this chess id to" (another player's choice in a
 * multi-player field). Null when the unit has no input entry.
 */
function inputLoadout(unit) {
  const x = inputEntry(unit);
  if (!x) return null;
  if (x.skillIndex == null && x.moduleId == null) return {};
  return { skillIndex: x.skillIndex ?? null, moduleId: x.moduleId ?? null };
}

/** Put a def on a not-yet-deployed ally (the fields Battle._makeAlly takes from the def). */
function swapDef(unit, def) {
  const st = def.stats;
  unit.def = def;
  unit.defId = def.id;
  unit.name = def.name;
  unit.rangeGrid = def.rangeGrid;
  Object.assign(unit.base, {
    maxHp: st.maxHp, atk: st.atk, def: st.def, res: st.res, aspd: st.aspd, bat: st.bat, blockCnt: st.blockCnt,
    spRecovery: st.spRecovery, tauntLevel: st.tauntLevel, massLevel: st.massLevel, hpRecoveryPerSec: st.hpRecoveryPerSec,
    cost: st.cost, respawnTime: st.respawnTime,
  });
  unit.markDirty?.();
  unit.hp = unit.s ? unit.s.maxHp : st.maxHp;
}

/**
 * Loadout exactness (DESIGN §16) before the battle starts: an operator whose def does not carry the loadout of its own
 * PlayerBattleInput entry (the per-battle data view resolves id-only lookups per chess id — two players of one field
 * may give the same chess different loadouts) gets the def of its own loadout — an entry without loadout fields means
 * the default — and a summon piece follows its owner's (unless its entry carries an inline `def`). A no-op when the def
 * already matches (Battle passing the unit's loadout to getChess / getToken).
 */
export function syncUnitLoadout(battle, unit) {
  if (!battle || battle.started || !unit || unit.deployed || !unit.def || !battle.data) return;
  if (unit.kind === 'op') {
    const lo = inputLoadout(unit);
    if (!lo || typeof battle.data.getChess !== 'function') return;
    // an entry without loadout fields only needs a look when the def carries a non-default loadout
    if (!Object.keys(lo).length && !(unit.def.loadout && unit.def.loadout.isDefault === false)) return;
    const want = battle.data.getChess(unit.def.id, lo);
    if (want && want !== unit.def && want.id === unit.def.id) swapDef(unit, want);
  } else if (unit.kind === 'token' && unit.ownerUnit && unit.ownerUnit.kind === 'op' && typeof battle.data.getToken === 'function') {
    // an explicit inline def of the input entry (Battle `_tokenDef(id, owner, inp.def)`) is never replaced
    if (inputEntry(unit)?.def) return;
    const owner = unit.ownerUnit;
    syncUnitLoadout(battle, owner);
    if (!owner.def || !owner.def.loadout) return;
    const want = battle.data.getToken(unit.def.id, owner.def.id, owner.def.loadout);
    if (want && want !== unit.def && want.id === unit.def.id) swapDef(unit, want);
  }
}

/** Id of the selected skill of an operator def (null without a skill). */
const selectedSkillId = (def) => def?.skill?.id ?? def?.raw?.skill?.skillId ?? null;

/** True when the def's selected skill is the chess's default skill (no loadout info ⇒ default). */
const skillIsDefault = (def) => !def?.loadout || def.loadout.skillIsDefault !== false;

/**
 * The kit with the skill spec of the SELECTED skill (see header): `kit.skills[id]` → `kit.skill` (default skill only)
 * → the generic spec. Returns the kit itself when nothing changes; `kit.skillSource` tells which one was used
 * ('skills' | 'kit' | 'generic').
 * @param {object} kit hand-authored kit
 */
export function selectSkillSpec(kit, bb, raw, def) {
  const id = selectedSkillId(def);
  const map = kit && kit.skills && typeof kit.skills === 'object' ? kit.skills : null;
  if (id && map && Object.prototype.hasOwnProperty.call(map, id)) return { ...kit, skill: map[id] ?? null, skillSource: 'skills' };
  if (skillIsDefault(def)) return kit;
  const g = genericKit(bb, raw, def);
  const own = typeof kit.install === 'function' ? kit.install : null;
  const gen = typeof g.install === 'function' ? g.install : null;
  const out = { ...kit, skill: g.skill ?? null, skillSource: 'generic' };
  if (own && gen) out.install = (battle, unit) => { own(battle, unit); gen(battle, unit); };
  else if (gen) out.install = gen;
  return out;
}

/**
 * Whether the kit of `def` has a hand-authored spec for its selected skill (tools/kit-coverage.mjs, tests): `skills`
 * entry, or the kit's `skill` for the default skill when the kit is not the generic fallback. Never throws.
 * @returns {'skills'|'kit'|'generic'|'none'} where the spec comes from ('none' = no kit function at all)
 */
export function skillSpecSource(def, kits = KITS) {
  const f = kitFn(def, kits);
  if (typeof f !== 'function') return 'none';
  let k = null;
  try { k = f(def.skill?.bb ?? {}, def.raw ?? def, def); } catch { return 'generic'; }
  if (!k || k.generic) return 'generic';
  const id = selectedSkillId(def);
  if (id && k.skills && Object.prototype.hasOwnProperty.call(k.skills, id)) return 'skills';
  return skillIsDefault(def) && k.skill !== undefined ? 'kit' : 'generic';
}

/**
 * Install kits for every ally unit and (mode 'full') every domain module. First, a Battle constructed without the spec
 * path (server-run fields, bot rehearsals, tests) gets the same per-battle loadout data view createBattleFromSpec uses
 * (simdata withUnitLoadouts over its players' inputs), so summons spawned during the battle (`getToken(id, owner)`)
 * and every other id-only lookup resolve the owner's selected skill / module there too (DESIGN §16).
 */
export function installContent(battle, { mode = 'full', extra = null } = {}) {
  try {
    const view = withUnitLoadouts(battle.data, (battle.players || []).map((p) => p && p.input));
    if (view && view !== battle.data) battle.data = view;
  } catch (e) { battle._handlerError?.('loadoutView', null, e); }
  for (const u of battle.allyUnits) {
    if (u.kit) continue;
    try { battle._setupUnit(u); } catch (e) { battle._handlerError('setupUnit', u, e); }
  }
  if (mode === 'full') {
    for (const [name, mod] of MODULES) {
      if (typeof mod.install !== 'function') continue;
      try { mod.install(battle); } catch (e) { battle._handlerError(`content:${name}`, null, e); }
    }
  }
  for (const m of extra || []) {
    try { (typeof m === 'function' ? m : m.install)?.(battle); } catch (e) { battle._handlerError('content:extra', null, e); }
  }
}

/** Prep-side registration of every domain module (server boot). */
export function registerAllMeta(registry) {
  for (const [name, mod] of MODULES) {
    if (typeof mod.registerMeta !== 'function') continue;
    try { mod.registerMeta(registry); } catch (e) { console.error(`[content] ${name}.registerMeta failed:`, e); }
  }
}
