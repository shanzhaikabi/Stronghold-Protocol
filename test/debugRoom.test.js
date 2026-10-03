// test/debugRoom.test.js — the TEMPORARY debug room (2026-10-03, server/debugRoom.js) that hands a 自选干员 out at
// round 1 and can open a match up from its first prep (调度中心 level, bond layers, the members that activate a
// bond) so the user can verify the battle fix and the 自选干员 shop pool without playing to 调度中心 5 级 first.
// Delete this file with the feature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  debugRoomSpec, debugRoomEnabled, grantDebugChess, applyDebugRoomSetup, debugBondChess,
  DEBUG_ROOM_ENV, DEBUG_GRANT_ENV, DEBUG_DIFFICULTY_ENV, DEBUG_SHOP_LEVEL_ENV, DEBUG_BOND_LAYERS_ENV,
  DEBUG_BOND_MEMBERS_ENV, DEBUG_NO_BANS_ENV, DEFAULT_DEBUG_GRANT, DEFAULT_DEBUG_CODE,
} from '../server/debugRoom.js';
import { APP_VERSION } from '../shared/constants.js';
import { makeMatch, DATA, legalTileFor } from './match/harness.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const ENV_KEYS = [
  DEBUG_ROOM_ENV, DEBUG_GRANT_ENV, DEBUG_DIFFICULTY_ENV, DEBUG_SHOP_LEVEL_ENV, DEBUG_BOND_LAYERS_ENV,
  DEBUG_BOND_MEMBERS_ENV, DEBUG_NO_BANS_ENV,
];

/** Run `fn` with the debug env vars set, restoring them afterwards. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] == null) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const WANG = DEFAULT_DEBUG_GRANT;
const STONE = 'token_10064_wang_stone1';
/** 奇迹's real key in data/bonds.json (the value SP_DEBUG_BOND_LAYERS / SP_DEBUG_BOND_MEMBERS take). */
const MIRA = 'miraShip';
const MIRA_OPS = debugBondChess(DATA, MIRA, 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every piece a player holds (board, hand, 整备区) with the given chess id. */
const held = (owner, id) => [...owner.board.values(), ...owner.hand.filter(Boolean), ...owner.temp.filter(Boolean)]
  .filter((p) => p && p.id === id);

test('debugRoomSpec: off unless SP_DEBUG_ROOM is set; a code, a grant list and a difficulty otherwise', async () => {
  await withEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, null])), () => {
    assert.equal(debugRoomSpec(), null);
    assert.equal(debugRoomEnabled(), false);
  });
  await withEnv({ [DEBUG_ROOM_ENV]: '1' }, () => {
    assert.deepEqual(debugRoomSpec(), {
      code: DEFAULT_DEBUG_CODE, grants: [WANG], difficulty: 'NORMAL', shopLevel: null, bondLayers: {}, bondMembers: {}, noBans: false,
    });
  });
  await withEnv({ [DEBUG_ROOM_ENV]: 'wxyz', [DEBUG_GRANT_ENV]: `${WANG}, chess_char_1_01_a`, [DEBUG_DIFFICULTY_ENV]: 'hard' }, () => {
    assert.deepEqual(debugRoomSpec(), {
      code: 'WXYZ', grants: [WANG, 'chess_char_1_01_a'], difficulty: 'HARD', shopLevel: null, bondLayers: {}, bondMembers: {}, noBans: false,
    });
  });
  // a value that is not a room code falls back to the default code (SP_DEBUG_ROOM=yes)
  await withEnv({ [DEBUG_ROOM_ENV]: 'yes' }, () => assert.equal(debugRoomSpec().code, DEFAULT_DEBUG_CODE));
  // codes with I / O are not in the lobby's alphabet
  await withEnv({ [DEBUG_ROOM_ENV]: 'IOWA' }, () => assert.equal(debugRoomSpec().code, DEFAULT_DEBUG_CODE));
});

test('debugRoomSpec: the prep-opening knobs (调度中心 level, bond layers, bond members, no bans) are parsed and default off', async () => {
  await withEnv({ [DEBUG_ROOM_ENV]: 'WANG', [DEBUG_SHOP_LEVEL_ENV]: '6', [DEBUG_BOND_LAYERS_ENV]: `${MIRA}:999`, [DEBUG_BOND_MEMBERS_ENV]: `${MIRA}:2`, [DEBUG_NO_BANS_ENV]: '1' }, () => {
    const s = debugRoomSpec();
    assert.equal(s.shopLevel, 6);
    assert.deepEqual(s.bondLayers, { [MIRA]: 999 });
    assert.deepEqual(s.bondMembers, { [MIRA]: 2 });
    assert.equal(s.noBans, true);
  });
  // several entries, whitespace, and junk that must be dropped instead of throwing
  await withEnv({ [DEBUG_ROOM_ENV]: 'WANG', [DEBUG_BOND_LAYERS_ENV]: ` ${MIRA}:999 , yanShip:50 , nope , x:0 ,y:-3`, [DEBUG_BOND_MEMBERS_ENV]: `${MIRA}:2,z:y` }, () => {
    const s = debugRoomSpec();
    assert.deepEqual(s.bondLayers, { [MIRA]: 999, yanShip: 50 });
    assert.deepEqual(s.bondMembers, { [MIRA]: 2 });
    assert.equal(s.noBans, false, 'an unset flag stays off');
  });
  // malformed / zero / negative values leave the knob off
  await withEnv({ [DEBUG_ROOM_ENV]: 'WANG', [DEBUG_SHOP_LEVEL_ENV]: 'abc', [DEBUG_BOND_LAYERS_ENV]: '', [DEBUG_BOND_MEMBERS_ENV]: '0', [DEBUG_NO_BANS_ENV]: 'maybe' }, () => {
    const s = debugRoomSpec();
    assert.equal(s.shopLevel, null);
    assert.deepEqual(s.bondLayers, {});
    assert.deepEqual(s.bondMembers, {});
    assert.equal(s.noBans, false);
  });
});

test('debugBondChess: the season chess that carry a bond, cheapest first, golden excluded', () => {
  const two = debugBondChess(DATA, MIRA, 2);
  assert.equal(two.length, 2);
  for (const id of two) {
    const rec = DATA.chess[id];
    assert.ok(rec, `${id} is a season chess`);
    assert.ok(rec.bonds.includes(MIRA), `${id} carries ${MIRA}`);
    assert.equal(rec.isGolden, false, `${id} is not the elite copy of another member`);
  }
  // every visible non-golden carrier is offered (hidden records are the season's own business, not members a room
  // may hand out); asking for more than exist returns them all — the caller (lobby.createDebugRoom) refuses
  const all = debugBondChess(DATA, MIRA, 99);
  const carriers = Object.values(DATA.chess).filter((c) => !c.isGolden && c.visible !== false && c.bonds.includes(MIRA));
  assert.equal(all.length, carriers.length);
  assert.ok(all.length >= 2, `${all.length} 奇迹 carriers`);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(debugBondChess(DATA, 'noSuchBond', 2), []);
});

test('the debug room starts the match at 调度中心 6 with 奇迹 999 and its two members — humans only', () => {
  assert.equal(MIRA_OPS.length, 2, 'fixture: two 奇迹 operators resolve');
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seed: 6, fake: true,
    seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
      { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true }],
    debugGrants: [WANG, ...MIRA_OPS],
    debugSetup: { shopLevel: 6, bondLayers: { [MIRA]: 999 } },
  });
  h.start();
  h.toPrep(1);
  const ps = h.ps('p_0'), bot = h.ps('ai_0');
  // 调度中心 6: the level the round-1 shop rolled at (5 chess + 1 item slots) and a maxed upgrade price
  assert.equal(ps.shop.level, 6);
  assert.equal(ps.shop.upgradePrice, 0);
  assert.equal(ps.shop.slots.length, 6, '6 级 shop layout (5 chess + 1 item)');
  assert.equal(ps.shop.slots.filter((s) => s && s.kind === 'chess').length, 5);
  // 奇迹 layers (BOND_LAYER_CAP) through the real gain path, and the bond really active
  assert.equal(ps.layers[MIRA], 999);
  assert.equal(ps.bonds[MIRA].layers, 999);
  assert.equal(ps.bonds[MIRA].active, true, 'two members in hand activate the bond');
  assert.equal(ps.bonds[MIRA].count, 2);
  // the hand-out: 望 plus the two 奇迹 members
  for (const id of [WANG, ...MIRA_OPS]) assert.equal(held(ps, id).length, 1, `${id} in the human's hand`);
  // …and the bot got none of it
  assert.equal(bot.shop.level, 1);
  assert.equal(bot.shop.slots.length, 4, 'bots keep the level-1 shop');
  assert.equal(bot.layers[MIRA], undefined);
  assert.equal(bot.bonds[MIRA].active, false);
  for (const id of [WANG, ...MIRA_OPS]) assert.equal(held(bot, id).length, 0, `bots never get ${id}`);
  h.invariants();
  h.m.dispose();
});

test('the debug setup is opt-in: a match without it starts at 调度中心 1 with no layers', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 6, fake: true, humans: 1, bots: 1 });
  h.start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  assert.equal(ps.shop.level, 1);
  assert.equal(ps.layers[MIRA] ?? 0, 0);
  assert.equal(ps.bonds[MIRA].active, false);
  h.m.dispose();
});

test('applyDebugRoomSetup: unknown bonds and a level past the cap are clamped, bots and departed players skipped', () => {
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seed: 6, fake: true,
    seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
      { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true }],
  });
  h.start();
  h.toPrep(1);
  const ps = h.ps('p_0'), bot = h.ps('ai_0');
  assert.equal(applyDebugRoomSetup(h.m, { shopLevel: 99, bondLayers: { [MIRA]: 5000, noSuchBond: 10 } }), 1);
  assert.equal(ps.shop.level, 6, 'clamped to gd.maxShopLevel');
  assert.equal(ps.layers[MIRA], 999, 'clamped to BOND_LAYER_CAP');
  assert.equal(ps.layers.noSuchBond, undefined, 'an unknown bond adds nothing');
  assert.equal(bot.shop.level, 1);
  assert.equal(bot.layers[MIRA], undefined);
  h.m.dispose();
});

test('SP_DEBUG_NO_BANS opens the pool: a picked 自选干员 still reaches the shop when the draw would have banned its 主盟约', () => {
  // a 4★ 预备干员 for the level-5 slot (six-star candidates cannot repeat across levels) + two more 6★ for level 6
  const four = Object.values(DATA.freePicks).find((r) => r.freePickLevels.length === 1 && r.freePickLevels[0] === 5);
  const six = Object.values(DATA.freePicks).filter((r) => r.freePickLevels.includes(6) && r.chessId !== WANG).slice(0, 2).map((r) => r.chessId);
  assert.ok(four && six.length === 2, 'fixtures: level-5 and level-6 自选候选人');
  const picks = { 5: [WANG, four.chessId], 6: [six[0], six[1]] };
  const build = (noBans) => {
    const h = makeMatch({
      mode: 'coop', difficulty: 'NORMAL', seed: 6, fake: true,
      seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks },
        { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true }],
      debugGrants: [WANG], debugSetup: { shopLevel: 6, bondLayers: { [MIRA]: 999 }, noBans },
    });
    h.start();
    h.toPrep(1);
    return h;
  };
  // the rule the knob exists for: a pick whose 主盟约 is in the match's drawn disabled set never joins the pool
  const h1 = build(false);
  const ps1 = h1.ps('p_0');
  assert.ok(h1.m.disabledBonds.length > 0, 'NORMAL draws bond bans');
  const main = ps1.freePickMainBond(DATA.freePicks[WANG]);
  assert.equal(ps1.freePickIds().includes(WANG), !h1.m.disabledBonds.includes(main), `${WANG} joins the pool iff ${main} is not drawn`);
  h1.m.dispose();
  // noBans: the draw is discarded, every pick is in the pool, and the level-6 shop really rolls 自选干员
  const h = build(true);
  const ps = h.ps('p_0');
  assert.deepEqual(h.m.disabledBonds, []);
  assert.deepEqual(h.m.bannedChess, []);
  for (const id of [WANG, ...six]) assert.ok(ps.freePickIds().includes(id), `${id} joins the pool`);
  assert.ok(ps.freePickEntries().every((e) => e.left > 0));
  let found = 0;
  for (let i = 0; i < 400; i++) {
    ps.rollShop({ keepFrozen: false });
    found += ps.shop.slots.filter((s) => s && DATA.freePicks[s.id]).length;
  }
  assert.ok(found > 0, `the level-6 shop rolls 自选干员 (${found} slots in 400 rerolls)`);
  h.m.dispose();
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
  assert.equal(held(ps, WANG).length, 1, 'the human holds the debug chess at prep 1');
  assert.equal(held(bot, WANG).length, 0, 'bots get nothing');
  const piece = held(ps, WANG)[0];
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
  assert.equal(held(ps, WANG).length, 0);
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

test('GET /debug/room creates the fixed-code room (reused on a second call) and resolves the bond members', async () => {
  await withEnv({
    [DEBUG_ROOM_ENV]: 'WXYZ', [DEBUG_GRANT_ENV]: WANG, [DEBUG_SHOP_LEVEL_ENV]: '6',
    [DEBUG_BOND_LAYERS_ENV]: `${MIRA}:999`, [DEBUG_BOND_MEMBERS_ENV]: `${MIRA}:2`, [DEBUG_NO_BANS_ENV]: '1',
  }, async () => {
    const server = await startServer({ port: 0, quiet: true });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const res = await fetch(`${base}/debug/room`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, {
        ok: true, code: 'WXYZ', mode: 'coop', difficulty: 'NORMAL',
        grants: [WANG, ...MIRA_OPS], reused: false, shopLevel: 6, bondLayers: { [MIRA]: 999 }, noBans: true,
      }, 'the reply names the resolved members the room will grant');
      const room = server.lobby.rooms.get('WXYZ');
      assert.ok(room, 'the room exists in the lobby (joinable by code)');
      assert.deepEqual(room.debugGrants, [WANG, ...MIRA_OPS]);
      assert.deepEqual(room.debugSetup, { shopLevel: 6, bondLayers: { [MIRA]: 999 }, noBans: true });
      assert.equal(room.mode, 'coop', 'coop: a player joins it by code (a solo room refuses joins)');
      const again = await (await fetch(`${base}/debug/room`)).json();
      assert.equal(again.reused, true);
      assert.equal(again.code, 'WXYZ');
      // unknown chess / unknown bonds / an impossible member count are refused instead of creating a broken room
      const bad = await fetch(`${base}/debug/room`).then(() => server.lobby.createDebugRoom({ code: 'ZZZZ', grants: ['chess_nope'] }));
      assert.equal(bad.error, 'BAD_TARGET');
      assert.equal(server.lobby.rooms.has('ZZZZ'), false);
      assert.equal(server.lobby.createDebugRoom({ code: 'ZZZY', grants: [WANG], bondLayers: { noSuchBond: 10 } }).error, 'BAD_TARGET');
      assert.equal(server.lobby.createDebugRoom({ code: 'ZZZX', grants: [WANG], bondMembers: { noSuchBond: 1 } }).error, 'BAD_TARGET');
      assert.equal(server.lobby.createDebugRoom({ code: 'ZZZW', grants: [WANG], bondMembers: { [MIRA]: 99 } }).error, 'BAD_TARGET');
      assert.equal(server.lobby.rooms.has('ZZZY') || server.lobby.rooms.has('ZZZX') || server.lobby.rooms.has('ZZZW'), false);
    } finally {
      await server.close();
    }
  });
});

test('the real lobby + WebSocket flow: joining the debug room and starting the match gives prep 1 调度中心 6, 奇迹 999, an active bond and an open pool', async () => {
  await withEnv({
    [DEBUG_ROOM_ENV]: 'WXYZ', [DEBUG_GRANT_ENV]: WANG, [DEBUG_SHOP_LEVEL_ENV]: '6',
    [DEBUG_BOND_LAYERS_ENV]: `${MIRA}:999`, [DEBUG_BOND_MEMBERS_ENV]: `${MIRA}:2`, [DEBUG_NO_BANS_ENV]: '1',
  }, async () => {
    // the 自由位置 picks the user would set in 干员调配 (only PICKED 自选干员 join the pool): 望 + 3 others
    const four = Object.values(DATA.freePicks).find((r) => r.freePickLevels.length === 1 && r.freePickLevels[0] === 5);
    const six = Object.values(DATA.freePicks).filter((r) => r.freePickLevels.includes(6) && r.chessId !== WANG).slice(0, 2).map((r) => r.chessId);
    const picks = { 5: [WANG, four.chessId], 6: [six[0], six[1]] };
    const server = await startServer({ port: 0, quiet: true });
    const c = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
    try {
      const w = await c.hello('Debug');
      c.id = w.playerId;
      const info = await (await fetch(`http://127.0.0.1:${server.port}/debug/room`)).json();
      assert.equal(info.code, 'WXYZ');
      assert.equal((await c.request({ t: 'room.join', code: info.code })).t, 'ok');
      await c.waitFor('room.state', (s) => s.code === 'WXYZ' && s.seats.some((x) => x && x.playerId === c.id));
      assert.equal((await c.request({ t: 'room.loadout', entries: {}, picks })).t, 'ok', 'the 自由位置 picks are accepted');
      // an AI teammate: the same match must not hand any of the debug state to it
      assert.equal((await c.request({ t: 'room.addBot' })).t, 'ok');
      await c.waitFor('room.state', (s) => s.seats.some((x) => x && x.isBot));
      assert.equal((await c.request({ t: 'room.start' })).t, 'ok');
      const m = server.lobby.rooms.get('WXYZ').match;
      assert.ok(m, 'the room runs a match');
      const ps = m.players.get(c.id);
      const bot = [...m.players.values()].find((p) => p.isBot);
      assert.ok(ps && bot, 'the human and the AI seat are in the match');
      // confirm the briefing, then take the strategy (the socket drives the real protocol; the room is untimed)
      await c.waitFor('m.public', (p) => p.phase === 'INFO_CHECK', 10_000);
      assert.equal((await c.request({ t: 'g.infoReady' })).t, 'ok');
      await c.waitFor('m.public', (p) => p.phase === 'BAND_DRAFT', 10_000);
      const t0 = Date.now();
      while (m.phase === 'BAND_DRAFT' && Date.now() - t0 < 10_000) {
        if (m.draftTurn() === c.id) assert.equal((await c.request({ t: 'g.band', bandId: m.defaultBand(c.id) })).t, 'ok');
        else await sleep(20);
      }
      assert.notEqual(m.phase, 'BAND_DRAFT', 'the draft finished');
      // round 1: the shop rolls 2 s after BATTLE_CHECK (startRound applies the debug setup)
      const t1 = Date.now();
      while (!(m.round === 1 && m.phase === 'PREP') && Date.now() - t1 < 20_000) await sleep(25);
      assert.equal(m.round, 1, `round 1 reached (phase ${m.phase})`);
      assert.equal(m.phase, 'PREP');
      // what the user asked to see from the very first prep
      assert.equal(ps.shop.level, 6, '调度中心 6');
      assert.equal(ps.shop.slots.filter((s) => s && s.kind === 'chess').length, 5, 'the level-6 shop rolled 5 chess slots');
      assert.equal(ps.layers[MIRA], 999, '奇迹 999 layers');
      assert.equal(ps.bonds[MIRA].active, true, 'the 奇迹 bond is active');
      for (const id of [WANG, ...MIRA_OPS]) assert.equal(held(ps, id).length, 1, `${id} in hand`);
      // …and the shop pool: no drawn bans, and every picked 自选干员 (望 included) is in the player's own pool
      assert.deepEqual(m.disabledBonds, [], 'SP_DEBUG_NO_BANS drew no bond bans');
      for (const id of [WANG, ...six]) assert.ok(ps.freePickIds().includes(id), `${id} joins the shop pool`);
      let freeSlots = 0;
      for (let i = 0; i < 200; i++) {
        ps.rollShop({ keepFrozen: false });
        freeSlots += ps.shop.slots.filter((s) => s && DATA.freePicks[s.id]).length;
      }
      assert.ok(freeSlots > 0, `the level-6 shop rolls 自选干员 (${freeSlots} slots in 200 rerolls)`);
      // …and the AI teammate is untouched
      assert.equal(bot.shop.level, 1);
      assert.equal(bot.layers[MIRA], undefined);
      assert.equal(bot.bonds[MIRA].active, false);
      for (const id of [WANG, ...MIRA_OPS]) assert.equal(held(bot, id).length, 0, `the bot never gets ${id}`);
    } finally {
      await c.close();
      await server.close();
    }
  });
});
