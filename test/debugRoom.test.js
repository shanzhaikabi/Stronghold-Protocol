// test/debugRoom.test.js — the TEMPORARY debug room (2026-10-03, server/debugRoom.js) that hands a 自选干员 out at
// round 1 so the user can verify the battle fix without playing to 调度中心 5 级. Delete this file with the feature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  debugRoomSpec, debugRoomEnabled, grantDebugChess,
  DEBUG_ROOM_ENV, DEBUG_GRANT_ENV, DEBUG_DIFFICULTY_ENV, DEFAULT_DEBUG_GRANT, DEFAULT_DEBUG_CODE,
} from '../server/debugRoom.js';
import { APP_VERSION } from '../shared/constants.js';
import { makeMatch, DATA, legalTileFor } from './match/harness.js';
import { startServer } from '../server/index.js';

/** Run `fn` with the debug env vars set, restoring them afterwards. */
async function withEnv(vars, fn) {
  const keys = [DEBUG_ROOM_ENV, DEBUG_GRANT_ENV, DEBUG_DIFFICULTY_ENV];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const k of keys) {
      if (saved[k] == null) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const WANG = DEFAULT_DEBUG_GRANT;
const STONE = 'token_10064_wang_stone1';

test('debugRoomSpec: off unless SP_DEBUG_ROOM is set; a code, a grant list and a difficulty otherwise', async () => {
  await withEnv({ [DEBUG_ROOM_ENV]: null, [DEBUG_GRANT_ENV]: null, [DEBUG_DIFFICULTY_ENV]: null }, () => {
    assert.equal(debugRoomSpec(), null);
    assert.equal(debugRoomEnabled(), false);
  });
  await withEnv({ [DEBUG_ROOM_ENV]: '1' }, () => {
    assert.deepEqual(debugRoomSpec(), { code: DEFAULT_DEBUG_CODE, grants: [WANG], difficulty: 'NORMAL' });
  });
  await withEnv({ [DEBUG_ROOM_ENV]: 'wxyz', [DEBUG_GRANT_ENV]: `${WANG}, chess_char_1_01_a`, [DEBUG_DIFFICULTY_ENV]: 'hard' }, () => {
    assert.deepEqual(debugRoomSpec(), { code: 'WXYZ', grants: [WANG, 'chess_char_1_01_a'], difficulty: 'HARD' });
  });
  // a value that is not a room code falls back to the default code (SP_DEBUG_ROOM=yes)
  await withEnv({ [DEBUG_ROOM_ENV]: 'yes' }, () => assert.equal(debugRoomSpec().code, DEFAULT_DEBUG_CODE));
  // codes with I / O are not in the lobby's alphabet
  await withEnv({ [DEBUG_ROOM_ENV]: 'IOWA' }, () => assert.equal(debugRoomSpec().code, DEFAULT_DEBUG_CODE));
});

test('the debug room hands 望 to the human at round 1 (never to a bot), and the piece is playable', () => {
  assert.ok(DATA.freePicks[WANG], 'fixture: the default grant is a 自选候选');
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seed: 6, fake: true,
    seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
      { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true }],
    debugGrants: [WANG],
  });
  h.start();
  h.toPrep(1);
  const ps = h.ps('p_0'), bot = h.ps('ai_0');
  const held = (owner) => [...owner.board.values(), ...owner.hand.filter(Boolean), ...owner.temp.filter(Boolean)].filter((p) => p && p.id === WANG);
  assert.equal(held(ps).length, 1, 'the human holds the debug chess at prep 1');
  assert.equal(held(bot).length, 0, 'bots get nothing');
  const piece = held(ps)[0];
  const at = legalTileFor(h.m, ps, WANG, new Set([...ps.board.keys()]));
  assert.ok(at, 'a legal tile exists');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: at[0], col: at[1] }, dir: 'RIGHT' }), { ok: true });
  assert.ok(ps.hand.some((p) => p && p.kind === 'token' && p.id === STONE), 'deploying it grants its 棋子');
  h.m.dispose();
});

test('a match without debugGrants hands out nothing (the debug path is opt-in)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 6, fake: true, humans: 1, bots: 1 });
  h.start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  assert.equal([...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)].filter((p) => p && p.id === WANG).length, 0);
  h.m.dispose();
});

test('grantDebugChess: unknown ids are skipped, a full hand is not fatal', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 6, fake: true, humans: 1, bots: 1 });
  h.start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (let i = 0; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('chess', 'chess_char_1_01_a');
  for (let i = 0; i < ps.temp.length; i++) ps.temp[i] = ps.newPiece('chess', 'chess_char_1_02_a');
  assert.equal(grantDebugChess(h.m, ['chess_nope', WANG]), 0, 'nothing fits into a full hand + 整备区');
  assert.doesNotThrow(() => grantDebugChess(h.m, ['chess_nope']));
  h.m.dispose();
});

test('GET /debug/room exists only while SP_DEBUG_ROOM is set, and /healthz reports a build tag', async () => {
  const server = await startServer({ port: 0, quiet: true });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    assert.equal((await fetch(`${base}/debug/room`)).status, 404, 'no endpoint without the env var');
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.match(String(health.build), /^[0-9a-f]{12}$/, '/healthz.build is the runtime hash a stale page notices');
    assert.equal(health.app, APP_VERSION);
  } finally {
    await server.close();
  }
});

test('GET /debug/room creates the fixed-code room (reused on a second call)', async () => {
  await withEnv({ [DEBUG_ROOM_ENV]: 'WXYZ', [DEBUG_GRANT_ENV]: WANG }, async () => {
    const server = await startServer({ port: 0, quiet: true });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const res = await fetch(`${base}/debug/room`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, code: 'WXYZ', mode: 'coop', difficulty: 'NORMAL', grants: [WANG], reused: false });
      const room = server.lobby.rooms.get('WXYZ');
      assert.ok(room, 'the room exists in the lobby (joinable by code)');
      assert.deepEqual(room.debugGrants, [WANG]);
      assert.equal(room.mode, 'coop', 'coop: a player joins it by code (a solo room refuses joins)');
      const again = await (await fetch(`${base}/debug/room`)).json();
      assert.equal(again.reused, true);
      assert.equal(again.code, 'WXYZ');
      // an unknown chess is refused instead of creating a broken room
      const bad = await fetch(`${base}/debug/room`).then(() => server.lobby.createDebugRoom({ code: 'ZZZZ', grants: ['chess_nope'] }));
      assert.equal(bad.error, 'BAD_TARGET');
      assert.equal(server.lobby.rooms.has('ZZZZ'), false);
    } finally {
      await server.close();
    }
  });
});
