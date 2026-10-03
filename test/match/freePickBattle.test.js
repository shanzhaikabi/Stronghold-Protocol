// test/match/freePickBattle.test.js — the reported end-to-end flow of a 自选干员 (DESIGN §22): a pick on the board →
// battle start → the unit (and its summon) really fight, on BOTH sides of client-side combat.
//
// User report 2026-10-03: "自选干员能部署到棋盘上，但开战时干员和它的召唤物一起消失，也不阻挡" — i.e. the piece was
// absent from the battle simulation state, not merely unrendered. The causes were the two data lists the sim reads:
// the browser runner's SIM_DATA_FILES (freePicks.json never fetched) and the sim's own DataSource (raw.freePicks never
// merged) — `getChess('chess_free_…')` was null and Battle._createAllyFromInput dropped the unit as "unknown chess"
// (server/sim/Battle.js:252-274). This file pins the WHOLE flow so neither list can silently lose the file again:
//   * a real match (lobby → prep → board → combat) keeps the operator AND its summon in the client's own battle,
//   * the browser loader's DataSource resolves every 自选候选 of data/freePicks.json and every one of their summons,
//   * the battle a real match spec produces fields them (asserting the DEF, not a copied data list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, give, legalTileFor } from './harness.js';

const ROOT = new URL('../../', import.meta.url);
const WANG = 'chess_free_char_2027_wang';      // 望 (陷阱师), the reported case
const STONE = 'token_10064_wang_stone1';       // 棋子, its summon
const free = JSON.parse(readFileSync(new URL('data/freePicks.json', ROOT), 'utf8'));
const tokens = JSON.parse(readFileSync(new URL('data/tokens.json', ROOT), 'utf8'));

/** A browser-like fetch of /data/*.json straight from disk (the real files the runner loads). */
function diskFetch() {
  return async (url) => {
    const name = String(url).replace(/^.*\//, '');
    try {
      const body = readFileSync(new URL(`data/${name}`, ROOT), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false, status: 404, json: async () => null };
    }
  };
}

/** Every free-pick summon record of data/tokens.json, grouped by owner. */
function freePickSummons() {
  const out = [];
  for (const [tokenId, rec] of Object.entries(tokens)) {
    const owners = (rec && Array.isArray(rec.owners) ? rec.owners : []).map(String).filter((o) => o.startsWith('chess_free_'));
    if (owners.length) out.push({ tokenId, owner: owners[0] });
  }
  return out;
}

test('自选干员 开战流程: the pick reaches the board, the battle starts and the client keeps the operator AND its 棋子', () => {
  const seat = { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks: { 5: [WANG] } };
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 6, seats: [seat], clientCombat: true, captureFrames: false });
  const m = h.m;
  h.start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  assert.deepEqual(ps.freePickIds(), [WANG], 'the pick is the player\'s own pool entry');

  // place 望 like the player does (the real g.move path), then its summon card
  const piece = give(m, ps, WANG, 'hand');
  const at = legalTileFor(m, ps, WANG, new Set());
  assert.ok(at, 'a legal tile exists for the 自选干员');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: at[0], col: at[1] }, dir: 'RIGHT' }), { ok: true });
  const card = ps.hand.find((p) => p && p.kind === 'token' && p.id === STONE);
  assert.ok(card, '部署望 grants its 棋子 to the hand');
  const stoneAt = legalTileFor(m, ps, STONE, new Set([...ps.board.keys()]));
  assert.ok(stoneAt, 'a legal tile exists for the summon');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: card.uid, to: { area: 'board', row: stoneAt[0], col: stoneAt[1] }, dir: 'RIGHT' }), { ok: true });

  // the battle input a match sends: both units, by chessId / tokenId (Battle._createAllyFromInput's keys)
  const input = ps.battleInput({ side: 'L', colOffset: 0 });
  assert.deepEqual(input.units.map((u) => u.chessId ?? u.tokenId).sort(), [STONE, WANG].sort());

  m.handle('p_0', { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT || h.ended != null, { maxSteps: 3e6 });
  assert.equal(m.phase, PHASE.COMBAT);
  h.sched.advance(4000);

  const entry = [...h.clients.get('p_0').battles.values()].find((e) => e.spec.kind === 'normal');
  assert.ok(entry, 'the client built its own battle');
  const ops = entry.battle.allyUnits.filter((u) => u.defId === WANG);
  const summons = entry.battle.allyUnits.filter((u) => u.defId === STONE);
  assert.equal(ops.length, 1, 'the 自选干员 is on the field (an unresolvable chess id would have dropped it)');
  assert.equal(summons.length, 1, 'and so is its summon');
  assert.ok(ops[0].alive && ops[0].deployed, 'deployed and alive, not withdrawn');
  assert.equal(summons[0].ownerUnit, ops[0], 'the summon is linked to its owner');
  assert.deepEqual(entry.battle.errors, [], 'no sim errors');
  m.dispose();
});

test('the browser sim resolves EVERY 自选候选 and every one of their summons (the runner\'s own data list)', async () => {
  const { loadBrowserSim: load } = await import('../../public/js/battle/runner.js');
  const base = new URL('../../server/sim/', import.meta.url).href;
  // runs like a page: it injects this process' sim data (keep it in this file)
  const sim = await load({ base, dataBase: '/data/', fetchFn: diskFetch() });
  const ids = Object.keys(free);
  assert.ok(ids.length >= 50, `data/freePicks.json holds the 自选候选 (${ids.length})`);
  const unresolved = [];
  for (const id of ids) {
    let def = null;
    try { def = sim.ds.getChess(id); } catch (e) { def = null; }
    if (!def || def.id !== id) unresolved.push(id);
  }
  assert.deepEqual(unresolved, [], `${unresolved.length} chess record(s) of data/freePicks.json do not resolve in the loaded sim`);
  const summons = freePickSummons();
  assert.ok(summons.length >= 20, `the free-pick summons are data (${summons.length})`);
  const badSummons = [];
  for (const { tokenId, owner } of summons) {
    let def = null;
    try { def = sim.ds.getToken(tokenId, owner); } catch (e) { def = null; }
    if (!def) badSummons.push(`${tokenId} (${owner})`);
  }
  assert.deepEqual(badSummons, [], `${badSummons.length} free-pick summon(s) do not resolve`);

  // and a battle built from a REAL spec fields them: a def that does not resolve is dropped as "unknown chess"
  const { buildBattleSpec, createBattleFromSpec } = sim.spec;
  const stageId = Object.keys(sim.ds.raw.stages)[0];
  const units = [];
  for (const [i, id] of ids.entries()) {
    units.push({ uid: 100 + i, kind: 'chess', chessId: id, row: 10, col: 3 + (i % 10), dir: 'RIGHT' });
    for (const s of (free[id].tokens || [])) {
      if (tokens[s]) units.push({ uid: 10_000 + units.length, kind: 'token', tokenId: s, row: 12, col: 3 + (units.length % 10), dir: 'RIGHT', ownerUid: 100 + i });
    }
  }
  const spec = buildBattleSpec({ battleId: 'free', fieldId: 'n:p', kind: 'normal', seed: 5, round: 1, stageId, timeLimit: 10, players: [{ playerId: 'p', units }], spawns: [] });
  const b = createBattleFromSpec(spec, sim.ds, { quiet: true, recordEvents: false });
  const onField = new Set(b.allyUnits.map((u) => u.uid));
  const dropped = units.filter((u) => !onField.has(u.uid)).map((u) => u.chessId ?? u.tokenId);
  assert.deepEqual(dropped, [], `${dropped.length} unit(s) were dropped as "unknown chess"/"unknown token"`);
  assert.deepEqual(b.errors, []);
});
