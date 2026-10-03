// server/debugRoom.js — TEMPORARY debug room (2026-10-03, user verification of the 自选干员 battle fix).
//
// ── WHAT THIS IS ────────────────────────────────────────────────────────────────────────────────────────────────
// An env-gated, obviously-temporary debug path: it creates one fixed-code room whose matches hand every human a
// 自选干员 (default 望, `chess_free_char_2027_wang`) at round 1 — so the user can verify the 自选干员 battle fix
// without playing to 调度中心 5 级 first. Four more opt-in knobs open a match up from its FIRST prep (added
// 2026-10-03 for the "do 自选干员 show up in the shop / pool" test): the 调度中心 level, bond layers, the members that
// make a bond actually active, and an open pool (no drawn bond bans). Everything is default-off, bots are never
// touched, and unsetting the new variables leaves the original behaviour exactly as it was.
//
// ── HOW TO TURN IT ON ───────────────────────────────────────────────────────────────────────────────────────────
//   SP_DEBUG_ROOM=WANG              ← the room code handed out (any 4 letters of ABCDEFGHJKLMNPQRSTUVWXYZ; "1" = WANG)
//   SP_DEBUG_GRANT=chess_free_char_2027_wang   ← optional, comma-separated chess ids (default: 望)
//   SP_DEBUG_ROOM_DIFFICULTY=NORMAL            ← optional (default NORMAL)
//   SP_DEBUG_SHOP_LEVEL=6                      ← optional, 调度中心 level (1…6) at the match's first prep
//   SP_DEBUG_BOND_LAYERS=miraShip:999          ← optional, `bondId:layers` list, applied at round 1 (cap 999)
//   SP_DEBUG_BOND_MEMBERS=miraShip:2           ← optional, `bondId:count` list: grant `count` season chess that
//                                                carry the bond (data/chess.json `bonds`) so it really activates
//   SP_DEBUG_NO_BANS=1                         ← optional: draw NO bond bans for this match, so the whole pool
//                                                (and every 自选干员 whose 主盟约 would have been banned) stays open
// The two bond lists use the REAL bond keys of data/bonds.json — 奇迹 is `miraShip` (not "miracle"). Several
// entries are comma-separated: `SP_DEBUG_BOND_LAYERS=miraShip:999,yanShip:50`. The resolved chess of
// SP_DEBUG_BOND_MEMBERS is appended to the round-1 grant list, so it goes through the same `grantDebugChess` path
// (and shows up in the `/debug/room` reply).
// Then restart the server (env is read at match/room creation, so no other code path changes) and:
//   curl -s http://127.0.0.1:13000/debug/room
// prints `{"ok":true,"code":"WANG","shopLevel":6,"bondLayers":{"miraShip":999},"noBans":true,"grants":[…],…}` — hand
// that code to the player; they join it from the lobby (加入房间) and their first prep has 望 in hand (its 棋子 card
// appears once it is deployed), 调度中心 6, the 奇迹 layers and an active 奇迹 bond. Set their 自由位置 picks in
// 干员调配 before starting: only PICKED 自选干员 enter the shop pool (SP_DEBUG_GRANT hands one over directly).
//
// ── HOW TO REMOVE IT ──────────────────────────────────────────────────────────────────────────────────────────
// Unset the env vars (the endpoint disappears and nothing else runs), or delete this file and the guarded call
// sites (grep for `debugRoom` / `debugGrants` / `debugSetup`): server/index.js (env-gated endpoint + import),
// server/lobby.js (createDebugRoom, the resolved bond grants + the `debugGrants` / `debugSetup` match options),
// server/match/Match.js (the round-1 hook: applyDebugRoomSetup before the players' own startRound, grantDebugChess
// after it), test/match/harness.js (the same two options) and test/debugRoom.test.js.

/** Env var enabling the whole debug path (unset/empty = completely off). */
export const DEBUG_ROOM_ENV = 'SP_DEBUG_ROOM';
/** Env var with the comma-separated chess ids granted at round 1. */
export const DEBUG_GRANT_ENV = 'SP_DEBUG_GRANT';
/** Env var with the room's difficulty. */
export const DEBUG_DIFFICULTY_ENV = 'SP_DEBUG_ROOM_DIFFICULTY';
/** Env var with the 调度中心 level the match starts at. */
export const DEBUG_SHOP_LEVEL_ENV = 'SP_DEBUG_SHOP_LEVEL';
/** Env var with the `bondId:layers` list applied at round 1. */
export const DEBUG_BOND_LAYERS_ENV = 'SP_DEBUG_BOND_LAYERS';
/** Env var with the `bondId:count` list of season chess granted to activate a bond. */
export const DEBUG_BOND_MEMBERS_ENV = 'SP_DEBUG_BOND_MEMBERS';
/** Env var that opens the whole shop pool (no drawn bond bans) for the debug match. */
export const DEBUG_NO_BANS_ENV = 'SP_DEBUG_NO_BANS';
/** The reported case of the user report: 望 (陷阱师), whose summon is `token_10064_wang_stone1`. */
export const DEFAULT_DEBUG_GRANT = 'chess_free_char_2027_wang';
/** Room code used when `SP_DEBUG_ROOM` is set to a non-code value (e.g. `1`). */
export const DEFAULT_DEBUG_CODE = 'WANG';

const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);

/** Room-code alphabet (server/lobby.js CODE_ALPHABET): no I/O, no digits. */
const CODE_RE = /^[A-HJ-NP-Z]{4}$/;

/**
 * `bondId:n[,bondId:n]` → `{ [bondId]: n }`, e.g. `miraShip:999`. Entries that are not `id:positive number` are
 * dropped; a repeated bond keeps its last value.
 * @param {string|undefined} raw
 * @returns {Record<string, number>}
 */
function parseBondList(raw) {
  const out = {};
  for (const part of String(raw ?? '').split(',')) {
    const [id, n] = part.split(':');
    const bondId = String(id ?? '').trim();
    const v = Math.floor(Number(String(n ?? '').trim()));
    if (!bondId || !Number.isFinite(v) || v <= 0) continue;
    out[bondId] = v;
  }
  return out;
}

/**
 * The debug room the environment asks for, or null when the debug path is off. Read on every call (cheap:
 * `process.env` reads only), so a test may set / clear the variables.
 * @returns {{ code: string, grants: string[], difficulty: string, shopLevel: number|null,
 *             bondLayers: Record<string, number>, bondMembers: Record<string, number>, noBans: boolean } | null}
 */
export function debugRoomSpec() {
  const raw = String(env(DEBUG_ROOM_ENV) ?? '').trim().toUpperCase();
  if (!raw) return null;
  const code = CODE_RE.test(raw) ? raw : DEFAULT_DEBUG_CODE;
  const grants = String(env(DEBUG_GRANT_ENV) ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const difficulty = String(env(DEBUG_DIFFICULTY_ENV) ?? '').trim().toUpperCase() || 'NORMAL';
  const lvl = Math.floor(Number(String(env(DEBUG_SHOP_LEVEL_ENV) ?? '').trim()));
  const noBans = /^(1|true|yes|on)$/i.test(String(env(DEBUG_NO_BANS_ENV) ?? '').trim());
  return {
    code,
    grants: grants.length ? grants : [DEFAULT_DEBUG_GRANT],
    difficulty,
    shopLevel: Number.isFinite(lvl) && lvl > 0 ? lvl : null,
    bondLayers: parseBondList(env(DEBUG_BOND_LAYERS_ENV)),
    bondMembers: parseBondList(env(DEBUG_BOND_MEMBERS_ENV)),
    noBans,
  };
}

/** Whether the debug endpoint / room exists in this process. */
export const debugRoomEnabled = () => debugRoomSpec() != null;

/**
 * The season chess that carry `bondId`, cheapest first (then by id), for the debug room's "grant N members so the
 * bond really activates" option — a bond's membership is the chess's own `bonds` list (bondsMeta.computeBonds).
 * Golden records are skipped (they are the same operator as their normal copy and would not add a distinct member),
 * as are hidden/invisible ones (nothing the shop could offer).
 * @param {any} data the lobby's game data (data/chess.json shape: `{ chess: { [chessId]: record } }`)
 * @param {string} bondId @param {number} n
 * @returns {string[]} up to `n` chess ids
 */
export function debugBondChess(data, bondId, n) {
  const chess = data && typeof data === 'object' && data.chess && typeof data.chess === 'object' ? data.chess : {};
  const hits = [];
  for (const rec of Object.values(chess)) {
    if (!rec || rec.isGolden || rec.visible === false) continue;
    if (!Array.isArray(rec.bonds) || !rec.bonds.includes(bondId)) continue;
    hits.push(rec);
  }
  hits.sort((a, b) => (Number(a.tier) || 99) - (Number(b.tier) || 99) || String(a.chessId).localeCompare(String(b.chessId)));
  return hits.slice(0, Math.max(0, Math.floor(n) || 0)).map((r) => r.chessId);
}

/**
 * Hand the debug chess to every human of a freshly started match (called from Match.startRound at round 1).
 * Pieces take the normal acquisition path (`acquireChess`, pool untouched → the player's own pool is unaffected);
 * a piece that cannot be stored (hand + temp full) is returned like any other grant.
 * @param {any} match running Match @param {string[]} grants chess ids
 * @returns {number} pieces granted
 */
export function grantDebugChess(match, grants) {
  let n = 0;
  for (const ps of match.players.values()) {
    if (ps.isBot || ps.left) continue;
    for (const id of grants) {
      if (!match.gd.chess(id)) continue;
      try {
        if (ps.acquireChess(id, { fromPool: false, source: 'debug' })) n++;
      } catch (e) {
        match.log?.warn?.(`[debug] grant ${id} to ${ps.playerId} failed: ${e && e.message}`);
      }
    }
  }
  match.log?.warn?.(`[debug] room ${match.roomCode}: granted ${grants.join(', ')} to ${n} hand(s) at round 1`);
  return n;
}

/**
 * Apply the debug room's match-start state to every human, BEFORE the players' own `startRound` (Match.startRound,
 * round 1 only) — the round-1 shop rolls at the level this leaves behind:
 *   shopLevel   调度中心 level (clamped to `gd.maxShopLevel`; the upgrade price follows `gd.upgradeBase`, so a
 *               maxed shop shows 0 like the private view's own rule)
 *   bondLayers  `{ bondId: n }` through `PlayerState.addLayers` — the real gain path, so the cap (999) and the
 *               bond's own on-layers effects (奇迹 pays funds per 100 layers) behave exactly like a played gain
 * (`noBans` is not applied here: it opens the pool while the Match is constructed, see server/match/Match.js.)
 * Bots and departed players are never touched.
 * @param {any} match running Match
 * @param {{ shopLevel?: number|null, bondLayers?: Record<string, number> }} setup
 * @returns {number} the number of human players it changed
 */
export function applyDebugRoomSetup(match, setup) {
  const s = setup && typeof setup === 'object' ? setup : {};
  const layers = s.bondLayers && typeof s.bondLayers === 'object' ? s.bondLayers : {};
  const lvl = Math.floor(Number(s.shopLevel));
  let n = 0;
  for (const ps of match.players.values()) {
    if (ps.isBot || ps.left) continue;
    let touched = false;
    if (Number.isFinite(lvl) && lvl > 0 && ps.shop) {
      const level = Math.min(lvl, match.gd.maxShopLevel);
      ps.shop.level = level;
      ps.shop.upgradePrice = match.gd.upgradeBase(level) ?? 0;
      touched = true;
    }
    for (const [bondId, count] of Object.entries(layers)) {
      if (ps.addLayers(bondId, count, { reason: 'debug' }) > 0) touched = true;
    }
    if (touched) n++;
  }
  match.log?.warn?.(`[debug] room ${match.roomCode}: setup ${JSON.stringify({ shopLevel: s.shopLevel ?? null, bondLayers: layers })} applied to ${n} human(s) at round 1`);
  return n;
}
