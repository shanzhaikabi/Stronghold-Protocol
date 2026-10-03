// Operator loadout model (DESIGN §16) — pure logic of the 干员调配 screen (screens/loadout.js), shared with the sync
// (ui/loadoutSync.js) and usable by the in-match UI (shop cards / detail panel: `effectiveChoice`, `selectedSkill`).
//
// The per-browser loadout is `{ [baseChessId]: { skill?: skillIndex, module?: uniEquipId | 'none' } }`, persisted in
// localStorage (`sp.pref.loadout` = { v: 1, entries }) and sent with C2S `room.loadout { entries }`. Only choices that
// differ from the chess's defaults are kept. The legal choices come from data/chess.json (DESIGN §16): every chess has
// `skills[]` (SkillRecord at its own skill level — the normal chess Lv4, the elite Lv7) and elites `modules[]`
// (ModuleRecord: uniEquipId, name, typeName, attr, traitOverride, talentChanges, isDefault) — while the data lacks
// them only the default skill / module is offered. The option rules are shared with the server
// (shared/protocol.js loadoutOptions / checkLoadout), so a sanitised loadout is always accepted.

import { loadoutOptions, checkLoadout, resolveLoadout, MODULE_NONE, LOADOUT_LIMITS, FREE_PICK_LIMITS, freePickLevelsOf } from '../../../shared/protocol.js';

export { MODULE_NONE };

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const LOADOUT_PREF = 'loadout';
export const LOADOUT_VERSION = 1;

export const PROF_ORDER = ['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL'];
export const PROF_NAME = Object.freeze({ PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击', CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种' });
export const SP_TYPE = Object.freeze({ INCREASE_WITH_TIME: '自动回复', INCREASE_WHEN_ATTACK: '攻击回复', INCREASE_WHEN_TAKEN_DAMAGE: '受击回复', ON_DEPLOY: '被动', 8: '被动' });
/** Module attribute keys (ModuleRecord.attr / battle_equip attributeBlackboard) → label + unit. */
export const ATTR_LABEL = Object.freeze({
  maxHp: ['生命上限', ''], max_hp: ['生命上限', ''], atk: ['攻击力', ''], def: ['防御力', ''], res: ['法术抗性', ''],
  magic_resistance: ['法术抗性', ''], aspd: ['攻击速度', ''], attack_speed: ['攻击速度', ''], cost: ['部署费用', ''],
  blockCnt: ['阻挡数', ''], block_cnt: ['阻挡数', ''], respawnTime: ['再部署时间', '秒'], respawn_time: ['再部署时间', '秒'],
  baseAttackTime: ['攻击间隔', '秒'], base_attack_time: ['攻击间隔', '秒'], moveSpeed: ['移动速度', ''], hpRecoveryPerSec: ['每秒回复', ''],
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
/** Shape of a chess / bond / item id, shared by the stored parsers (mirrors the server's `isId`). */
const ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;

// ---- storage -----------------------------------------------------------------------------------------------------

/**
 * Parse a stored loadout (any junk → {}): keeps structurally valid entries only (ids, skill ints, module ids).
 * @param {any} raw `{ v, entries }` (or a bare entries map from an older build)
 * @returns {Record<string, { skill?: number, module?: string }>}
 */
export function parseStored(raw) {
  const src = isObj(raw) && isObj(raw.entries) ? raw.entries : isObj(raw) && raw.v == null ? raw : null;
  const out = {};
  if (!src) return out;
  for (const [id, e] of Object.entries(src)) {
    if (Object.keys(out).length >= LOADOUT_LIMITS.entries) break;
    if (!/^[A-Za-z0-9_\-.:]{1,64}$/.test(id) || !isObj(e)) continue;
    const x = {};
    if (isInt(e.skill) && e.skill >= 0 && e.skill <= LOADOUT_LIMITS.skillIndex) x.skill = e.skill;
    if (typeof e.module === 'string' && /^[A-Za-z0-9_\-.:]{1,64}$/.test(e.module)) x.module = e.module;
    if (Object.keys(x).length) out[id] = x;
  }
  return out;
}

/** Serialised form for localStorage (entries + 自由位置 picks, DESIGN §22). */
export const toStored = (entries, picks = {}) => ({ v: LOADOUT_VERSION, entries: entries || {}, picks: picks || {} });

// ---- 自由位置 picks (DESIGN §22) ------------------------------------------------------------------------------------

/** The 调度中心 levels that hold 自由位置 slots (5 级 and 6 级), re-exported for the screen. */
export const FREE_PICK_LEVELS = Object.freeze([...FREE_PICK_LIMITS.levels]);
/** Slots per level (the screen renders this many card slots). */
export const FREE_PICK_PER_LEVEL = FREE_PICK_LIMITS.perLevel;

/**
 * Parse stored 自由位置 picks (any junk → {}): structurally valid level keys, id-shaped entries, at most `perLevel` per
 * level, and never the same operator twice — the picker forbids duplicates across both levels [user].
 * @param {any} raw `{ [level]: chessId[] }`
 * @returns {Record<string, string[]>}
 */
export function parseStoredPicks(raw) {
  const src = isObj(raw) ? raw : {};
  const out = {};
  const seen = new Set();
  for (const level of FREE_PICK_LEVELS) {
    const list = src[level] ?? src[String(level)];
    if (!Array.isArray(list)) continue;
    const keep = [];
    for (const id of list) {
      if (keep.length >= FREE_PICK_LIMITS.perLevel) break;
      if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      keep.push(id);
    }
    if (keep.length) out[String(level)] = keep;
  }
  return out;
}

/** The ids picked at any level (the picker marks them as taken — an operator may not be picked twice [user]). */
export function pickedIds(picks) {
  const s = new Set();
  for (const list of Object.values(parseStoredPicks(picks))) for (const id of list) s.add(id);
  return s;
}

/**
 * Drop picks that are not selectable any more (a retired operator, a level that no longer fits) — the spirit of
 * `sanitizeEntries`, so one stale id never makes the server refuse the whole `room.loadout` frame.
 * @param {any} picks @param {(id: string) => any} getChess
 */
export function sanitizePicks(picks, getChess) {
  const out = {};
  const seen = new Set();
  for (const [level, list] of Object.entries(parseStoredPicks(picks))) {
    const lv = Number(level);
    const keep = [];
    for (const id of list) {
      if (seen.has(id)) continue;
      if (!freePickLevelsOf(getChess ? getChess(id) : null).includes(lv)) continue;
      seen.add(id);
      keep.push(id);
    }
    if (keep.length) out[level] = keep;
  }
  return out;
}

/**
 * Put `id` into the 自由位置 slot list of `level` (DESIGN §22). Returns the NEW picks, or null when the operator is
 * not selectable at that level, is already picked at another level, or the level's slots are full.
 * @param {any} picks @param {number|string} level @param {string} id @param {(id: string) => any} getChess
 * @returns {Record<string, string[]> | null}
 */
export function setPick(picks, level, id, getChess) {
  const lv = Number(level);
  if (!FREE_PICK_LEVELS.includes(lv)) return null;
  if (!freePickLevelsOf(getChess ? getChess(id) : null).includes(lv)) return null;
  const current = parseStoredPicks(picks);
  if (pickedIds(current).has(id)) return null;
  const list = current[String(lv)] || [];
  if (list.length >= FREE_PICK_LIMITS.perLevel) return null;
  return { ...current, [String(lv)]: [...list, id] };
}

/** Remove `id` from the slots of `level` (an emptied level disappears). */
export function clearPick(picks, level, id) {
  const current = parseStoredPicks(picks);
  const key = String(level);
  const list = (current[key] || []).filter((x) => x !== id);
  const out = { ...current };
  if (list.length) out[key] = list;
  else delete out[key];
  return out;
}

/**
 * The 自由位置 slots for rendering: `{ 5: [id|null, id|null], 6: […] }` — always `perLevel` entries per level, so the
 * screen does not have to pad them itself.
 * @param {any} picks
 * @returns {Record<string, Array<string|null>>}
 */
export function freePickSlots(picks) {
  const current = parseStoredPicks(picks);
  const out = {};
  for (const level of FREE_PICK_LEVELS) {
    const list = current[String(level)] || [];
    out[String(level)] = Array.from({ length: FREE_PICK_LIMITS.perLevel }, (_, i) => list[i] ?? null);
  }
  return out;
}

/** Total picks in use (a badge on the 自由位置 row: "2/4"). */
export const pickedCount = (picks) => pickedIds(picks).size;

// ---- export / import ----------------------------------------------------------------------------------------------

/**
 * `kind` of an exported loadout envelope. A saved-file / clipboard payload and (later) the blob an account endpoint
 * stores are the SAME object, so 导出 / 导入 / 登录后读取 all share one path: `entries` is exactly
 * `room.loadout.entries`, i.e. what `setEntries` + the sync already accept.
 */
export const LOADOUT_EXPORT_KIND = 'stronghold.loadout';

/**
 * Portable payload of a loadout (the shape a future account API PUTs / GETs as-is).
 * @param {Record<string, any>} entries `room.loadout.entries`
 * @param {{ now?: number, name?: string|null }} [o]
 */
export function exportPayload(entries, { now = Date.now(), name = null } = {}) {
  const clean = {};
  for (const [id, e] of Object.entries(entries || {})) if (isObj(e)) clean[id] = { ...e };
  return {
    kind: LOADOUT_EXPORT_KIND,
    v: LOADOUT_VERSION,
    name: name ? String(name).slice(0, 40) : null,
    exportedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
    count: Object.keys(clean).length,
    entries: clean,
  };
}

/** Pretty JSON of `exportPayload` — one preset per file / clipboard payload. */
export function serializeExport(entries, opts) {
  return JSON.stringify(exportPayload(entries, opts), null, 2);
}

/**
 * Parse an exported, pasted or account-fetched loadout. Tolerant by design: the envelope, the stored `{ v, entries }`
 * form and a bare `{ [chessId]: { skill, module } }` map all work, as does a JSON string of any of them. Parsing is
 * STRUCTURAL only — the caller still runs `sanitizeEntries` against the loaded data, because a preset from another
 * season may name chess / skills / modules this build does not have.
 * @param {any} input payload object or JSON text
 * @returns {{ ok: true, entries: Record<string, any>, meta: { v: number|null, name: string|null, exportedAt: string|null, kind: string|null } }
 *          | { ok: false, error: string }}
 */
export function parseImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return { ok: false, error: '没有可导入的内容' };
    try { raw = JSON.parse(text); } catch { return { ok: false, error: '不是合法的 JSON' }; }
  }
  if (!isObj(raw)) return { ok: false, error: '无法识别的格式' };
  const v = isInt(raw.v) ? raw.v : null;
  // a newer envelope may reshuffle fields — refuse instead of silently reading it as something else
  if (v != null && v > LOADOUT_VERSION) return { ok: false, error: `数据版本 v${v} 高于当前支持的 v${LOADOUT_VERSION}` };
  const kind = typeof raw.kind === 'string' ? raw.kind : null;
  if (kind && kind !== LOADOUT_EXPORT_KIND) return { ok: false, error: '这不是干员调配的数据' };
  const entries = parseStored(raw);
  if (!Object.keys(entries).length) return { ok: false, error: '里面没有有效的调配条目' };
  return {
    ok: true,
    entries,
    meta: { v, name: typeof raw.name === 'string' ? raw.name : null, exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null, kind },
  };
}

// ---- options & choices ---------------------------------------------------------------------------------------------

/**
 * The chess records of one loadout slot.
 * A 自选候选 (DESIGN §22, `freePick: true`) has `goldenId: null` and no `_b` sibling but carries its own `modules[]`
 * (DATA.md / tools/build-data.mjs freePickModuleBlock), so the record is returned as its own elite — the detail panel
 * then shows its 模组 section exactly like a season operator's (模组相关规则和普通干员一致).
 * @param {string} baseId normal chess id
 * @param {(id: string) => any} getChess
 * @returns {{ base: any, golden: any }}
 */
export function recordsOf(baseId, getChess) {
  const base = getChess(baseId) || null;
  const golden = base && base.goldenId ? getChess(base.goldenId) || null
    : (base && Array.isArray(base.modules) && base.modules.length ? base : null);
  return { base, golden };
}

/** SkillRecord of a chess record by skill index (data `skills[]`, else the default `skill`). */
export function skillRecord(chess, index) {
  if (!chess) return null;
  if (Array.isArray(chess.skills)) {
    const s = chess.skills.find((x) => x && x.index === index);
    if (s) return s;
  }
  return chess.skill && chess.skill.index === index ? chess.skill : null;
}

/** ModuleRecord of an elite by uniEquipId (data `modules[]`, else a minimal record from the default `module`). */
export function moduleRecord(golden, id) {
  if (!golden || !id || id === MODULE_NONE) return null;
  if (Array.isArray(golden.modules)) {
    const m = golden.modules.find((x) => x && x.uniEquipId === id);
    if (m) return m;
  }
  const d = golden.module;
  return d && d.id === id ? { uniEquipId: d.id, name: d.name, typeName: d.type, isDefault: true, attr: null, traitOverride: null, talentChanges: [] } : null;
}

/**
 * Everything the screen shows for one chess: its skill options (normal Lv4 + elite Lv7 records) and module options.
 * @param {any} base normal chess record
 * @param {any} golden elite record (or null)
 */
export function chessOptions(base, golden) {
  const opt = loadoutOptions(base, golden);
  const skills = opt.skills.map((index) => ({
    index,
    normal: skillRecord(base, index),
    elite: skillRecord(golden, index),
    isDefault: index === opt.defaultSkill,
  }));
  const modules = opt.modules.map((id) => ({
    id,
    rec: moduleRecord(golden, id),
    isDefault: id === opt.defaultModule,
  }));
  return { ...opt, skillOptions: skills, moduleOptions: modules };
}

/**
 * The effective choice of a chess under a stored loadout (defaults for missing / unavailable choices).
 * @returns {{ skill: number|null, module: string|null, changed: boolean }}
 */
export function effectiveChoice(entries, base, golden) {
  const opt = loadoutOptions(base, golden);
  const e = base && entries && Object.hasOwn(entries, base.chessId) ? entries[base.chessId] : null;
  const skill = e && opt.skills.includes(e.skill) ? e.skill : opt.defaultSkill;
  const module = golden ? (e && opt.modules.includes(e.module) ? e.module : opt.defaultModule) : null;
  return { skill, module, changed: skill !== opt.defaultSkill || module !== opt.defaultModule };
}

/**
 * Set (part of) one chess's choice; an entry equal to the defaults is removed. Returns a new entries map.
 * @param {Record<string, any>} entries
 * @param {any} base @param {any} golden
 * @param {{ skill?: number, module?: string }} patch
 */
export function setChoice(entries, base, golden, patch) {
  if (!base) return entries;
  const opt = loadoutOptions(base, golden);
  const cur = effectiveChoice(entries, base, golden);
  const skill = patch && patch.skill !== undefined && opt.skills.includes(patch.skill) ? patch.skill : cur.skill;
  const module = golden && patch && patch.module !== undefined && opt.modules.includes(patch.module) ? patch.module : cur.module;
  const out = { ...(entries || {}) };
  delete out[base.chessId];
  const e = {};
  if (skill !== opt.defaultSkill && skill != null) e.skill = skill;
  if (golden && module !== opt.defaultModule && module != null) e.module = module;
  if (Object.keys(e).length) out[base.chessId] = e;
  return out;
}

/** Remove one chess's entry (恢复默认). */
export function resetChoice(entries, baseId) {
  if (!entries || !Object.hasOwn(entries, baseId)) return entries;
  const out = { ...entries };
  delete out[baseId];
  return out;
}

/**
 * The entries to send (`room.loadout.entries`): every stored entry that is still legal for the loaded data, the
 * rest dropped one by one (a stale browser loadout never gets the whole message refused). Defaults are dropped.
 * @param {Record<string, any>} entries
 * @param {(id: string) => any} getChess
 * @returns {Record<string, { skill?: number, module?: string }>}
 */
export function sanitizeEntries(entries, getChess) {
  const out = {};
  for (const [id, e] of Object.entries(entries || {})) {
    if (Object.keys(out).length >= LOADOUT_LIMITS.entries) break;
    const one = {};
    if (isInt(e?.skill)) one.skill = e.skill;
    if (typeof e?.module === 'string') one.module = e.module;
    if (!Object.keys(one).length) continue;
    const res = checkLoadout({ [id]: one }, getChess);
    if (!res.ok) {
      // keep the part that is still legal (e.g. the skill when a module disappeared)
      for (const k of ['skill', 'module']) {
        if (one[k] === undefined) continue;
        const r = checkLoadout({ [id]: { [k]: one[k] } }, getChess);
        if (r.ok && r.loadout[id]) out[id] = { ...(out[id] || {}), [k]: one[k] };
      }
      continue;
    }
    if (res.loadout[id]) out[id] = one;
  }
  return out;
}

/** Selected SkillRecord of a board / shop chess under a loadout (the elite gets its Lv7 record). */
export function selectedSkill(loadout, chess, getChess) {
  const r = resolveLoadout(loadout, chess, getChess);
  return skillRecord(chess, r.skillIndex) || chess?.skill || null;
}

/** Selected ModuleRecord of an elite under a loadout (null: none / a chess without module choices / '不装备'). */
export function selectedModule(loadout, chess, getChess) {
  if (!chess || !(chess.isGolden || (Array.isArray(chess.modules) && chess.modules.length))) return null;
  const r = resolveLoadout(loadout, chess, getChess);
  return moduleRecord(chess, r.moduleId);
}

// ---- roster & filters ------------------------------------------------------------------------------------------------

/**
 * Visible normal chess (the loadout slots), in shop order: tier, then shopSortId.
 * @param {any[]} list data.list('chess')
 */
/**
 * Whether a chess record is a loadout slot (what the server's `checkLoadout` accepts): a visible season chess, or a
 * 自选候选 of the free-pick roster (DESIGN §22 — invisible + hidden by design so the shop pool never offers it, yet its
 * owner picks it and configures its skill like any other operator).
 */
export const isLoadoutSlot = (c) => !!c && !c.isGolden && !c.isDiy && (!c.baseId || c.baseId === c.chessId)
  && (c.freePick === true || (c.visible !== false && !c.isHidden));

export function rosterOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter(isLoadoutSlot)
    .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0) || String(a.chessId).localeCompare(String(b.chessId)));
}

/**
 * The 自由位置 candidates a 调度中心 level may draw from (DESIGN §22): the 自选候选 records of `data/freePicks.json`.
 * The season pool never appears — a candidate is by definition an operator it does NOT offer [user] — and the level gate
 * is `freePickLevelsOf`, the same function the server checks with. Sorted 6★ first (the 4★ 预备干员 last).
 * @param {any[]} list data.list('freePicks') @param {number} level 5 or 6
 */
export function freePickRosterOf(list, level) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => isLoadoutSlot(c) && freePickLevelsOf(c).includes(Number(level)))
    .sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || (a.tier ?? 0) - (b.tier ?? 0) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * Apply the screen's filters.
 * @param {any[]} roster rosterOf(...)
 * @param {{ tier?: number|null, prof?: string|null, bond?: string|null, query?: string, changedOnly?: boolean }} f
 * @param {Record<string, any>} entries stored loadout (for changedOnly)
 * @param {(id: string) => any} getChess
 * @param {(id: string) => any} [getBond] bond lookup (the search also matches bond names)
 */
export function filterRoster(roster, f = {}, entries = {}, getChess = () => null, getBond = () => null) {
  const q = String(f.query || '').trim().toLowerCase();
  return roster.filter((c) => {
    if (f.tier && c.tier !== f.tier) return false;
    if (f.prof && c.profession !== f.prof) return false;
    if (f.bond && !(Array.isArray(c.bonds) && c.bonds.includes(f.bond))) return false;
    if (f.changedOnly) {
      const { golden } = recordsOf(c.chessId, getChess);
      if (!effectiveChoice(entries, c, golden).changed) return false;
    }
    if (q) {
      const hay = [c.name, c.appellation, c.subProfessionName, PROF_NAME[c.profession], ...(c.bonds || []).map((b) => getBond(b)?.name)]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Number of chess whose choice differs from the defaults (only loadout slots of the loaded data count: an entry of a
 *  retired / hidden chess is never sent nor applied). */
export function changedCount(entries, getChess) {
  let n = 0;
  for (const id of Object.keys(entries || {})) {
    const { base, golden } = recordsOf(id, getChess);
    if (isLoadoutSlot(base) && base.chessId === id && effectiveChoice(entries, base, golden).changed) n++;
  }
  return n;
}

// ---- display helpers -----------------------------------------------------------------------------------------------------

/** "S2" style label of a skill index. */
export const skillLabel = (index) => (isInt(index) ? `S${index + 1}` : '—');

/** Short type badge of a module ("MAR-X" → "X", "ISW-α" → "α"); 'none' → "—". */
export function moduleBadge(rec, id = null) {
  if (!rec) return id === MODULE_NONE || id == null ? '—' : '?';
  const t = String(rec.typeName || rec.type || '');
  const m = t.match(/-([^-\s]+)$/);
  return m ? m[1] : t.slice(-1) || '?';
}

/**
 * Module stat bonus as display rows (non-zero entries only).
 * @param {Record<string, number> | null | undefined} attr
 * @returns {Array<{ key: string, label: string, text: string, positive: boolean }>}
 */
export function attrRows(attr) {
  const out = [];
  if (!isObj(attr)) return out;
  for (const [k, v] of Object.entries(attr)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
    const [label, unit] = ATTR_LABEL[k] || [k, ''];
    const n = Math.abs(v) < 10 && !Number.isInteger(v) ? Number(v.toFixed(2)) : Math.round(v);
    out.push({ key: k, label, text: `${v > 0 ? '+' : ''}${n}${unit}`, positive: k === 'cost' || k === 'respawnTime' || k === 'respawn_time' || k === 'baseAttackTime' || k === 'base_attack_time' ? v < 0 : v > 0 });
  }
  return out;
}

/**
 * Tags of a SkillRecord: SP recovery, SP numbers, duration / ammo, charges.
 * @returns {{ sp: string, spKind: 'time'|'atk'|'def'|'passive', init: number|null, cost: number|null, duration: string|null, charges: number|null, passive: boolean }}
 */
export function skillTags(rec) {
  if (!rec) return { sp: '—', spKind: 'time', init: null, cost: null, duration: null, charges: null, passive: false };
  const passive = rec.skillType === 'PASSIVE' || rec.spType === 'ON_DEPLOY' || rec.spType === 8;
  const spKind = passive ? 'passive' : rec.spType === 'INCREASE_WHEN_ATTACK' ? 'atk' : rec.spType === 'INCREASE_WHEN_TAKEN_DAMAGE' ? 'def' : 'time';
  let duration = null;
  if (rec.durationType === 'AMMO') duration = '弹药';
  else if (Number(rec.duration) > 0) duration = `${Number(rec.duration)}秒`;
  return {
    sp: SP_TYPE[rec.spType] || (passive ? '被动' : '技力'),
    spKind,
    init: passive ? null : Number.isFinite(rec.initSp) ? rec.initSp : 0,
    cost: passive ? null : Number.isFinite(rec.spCost) ? rec.spCost : 0,
    duration,
    charges: Number(rec.maxChargeTime) > 1 ? Number(rec.maxChargeTime) : null,
    passive,
  };
}
