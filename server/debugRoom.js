// server/debugRoom.js — TEMPORARY debug room (2026-10-03, user verification of the 自选干员 battle fix).
//
// ── WHAT THIS IS ────────────────────────────────────────────────────────────────────────────────────────────────
// An env-gated, obviously-temporary debug path: it creates one fixed-code room whose matches hand every human a
// 自选干员 (default 望, `chess_free_char_2027_wang`) at round 1 — so the user can verify the 自选干员 battle fix
// without playing to 调度中心 5 级 first.
//
// ── HOW TO TURN IT ON ───────────────────────────────────────────────────────────────────────────────────────────
//   SP_DEBUG_ROOM=WANG              ← the room code handed out (any 4 letters of ABCDEFGHJKLMNPQRSTUVWXYZ; "1" = WANG)
//   SP_DEBUG_GRANT=chess_free_char_2027_wang   ← optional, comma-separated chess ids (default: 望)
//   SP_DEBUG_ROOM_DIFFICULTY=NORMAL            ← optional (default NORMAL)
// Then restart the server (env is read at match/room creation, so no other code path changes) and:
//   curl -s http://127.0.0.1:13000/debug/room
// prints `{"ok":true,"code":"WANG",...}` — hand that code to the player; they join it from the lobby (加入房间)
// and their first prep has 望 in hand (its 棋子 card appears once it is deployed).
//
// ── HOW TO REMOVE IT ──────────────────────────────────────────────────────────────────────────────────────────
// Unset the env var (the endpoint disappears and nothing else runs), or delete this file and the four guarded call
// sites (grep for `debugRoom` / `debugGrants`): server/index.js (env-gated endpoint + import), server/lobby.js
// (createDebugRoom + the `debugGrants` match option), server/match/Match.js (the round-1 hook), test/debugRoom.test.js.

/** Env var enabling the whole debug path (unset/empty = completely off). */
export const DEBUG_ROOM_ENV = 'SP_DEBUG_ROOM';
/** Env var with the comma-separated chess ids granted at round 1. */
export const DEBUG_GRANT_ENV = 'SP_DEBUG_GRANT';
/** Env var with the room's difficulty. */
export const DEBUG_DIFFICULTY_ENV = 'SP_DEBUG_ROOM_DIFFICULTY';
/** The reported case of the user report: 望 (陷阱师), whose summon is `token_10064_wang_stone1`. */
export const DEFAULT_DEBUG_GRANT = 'chess_free_char_2027_wang';
/** Room code used when `SP_DEBUG_ROOM` is set to a non-code value (e.g. `1`). */
export const DEFAULT_DEBUG_CODE = 'WANG';

const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);

/** Room-code alphabet (server/lobby.js CODE_ALPHABET): no I/O, no digits. */
const CODE_RE = /^[A-HJ-NP-Z]{4}$/;

/**
 * The debug room the environment asks for, or null when the debug path is off. Read on every call (cheap: two
 * `process.env` reads), so a test may set / clear the variables.
 * @returns {{ code: string, grants: string[], difficulty: string } | null}
 */
export function debugRoomSpec() {
  const raw = String(env(DEBUG_ROOM_ENV) ?? '').trim().toUpperCase();
  if (!raw) return null;
  const code = CODE_RE.test(raw) ? raw : DEFAULT_DEBUG_CODE;
  const grants = String(env(DEBUG_GRANT_ENV) ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const difficulty = String(env(DEBUG_DIFFICULTY_ENV) ?? '').trim().toUpperCase() || 'NORMAL';
  return { code, grants: grants.length ? grants : [DEFAULT_DEBUG_GRANT], difficulty };
}

/** Whether the debug endpoint / room exists in this process. */
export const debugRoomEnabled = () => debugRoomSpec() != null;

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
