// test/freePicks.test.js — the 自选干员 (自由位置) data contract (DESIGN §21).
//
// data/freePicks.json carries the operators a 自由位置 may bring into a player's OWN shop pool. They are deliberately
// NOT season chess: they live in their own file (so the shop pool, the loadout slots and the season's counts cannot
// pick them up by accident), they are 协防干员 only (the official records of the 原型干员 carry no faction at all), they
// own no 特质, and every one of them must have its operator art in the client manifest — a missing asset would show as
// a blank card in game instead of failing the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const FREE = load('freePicks.json');
const CHESS = load('chess.json');
const CHARS = load('assets.json').chars || {};

test('自选干员:每一条都是自选候选,而不是本赛季的棋子', () => {
  const ids = Object.keys(FREE);
  assert.ok(ids.length > 0, 'data/freePicks.json is not empty');
  for (const [id, r] of Object.entries(FREE)) {
    assert.equal(r.chessId, id, id);
    assert.equal(r.freePick, true, id);
    assert.equal(r.visible, false, `${id}: must stay invisible — the shop pool is built from visibleChess`);
    assert.equal(r.chessType, 'PROTOTYPE', id);
    assert.equal(r.isGolden, false, id);
    assert.equal(r.goldenId, null, `${id}: no elite variant`);
    assert.deepEqual(r.bonds, ['emptyShip'], `${id}: 协防干员 only`);
    assert.deepEqual(r.garrisonIds, [], `${id}: 不拥有特质`);
    assert.ok(r.stats && r.stats.maxHp > 0 && r.stats.atk > 0, `${id}: stats`);
    assert.ok(Array.isArray(r.rangeGrid) && r.rangeGrid.length, `${id}: attack range`);
    assert.ok(Array.isArray(r.skills) && r.skills.length, `${id}: at least one skill`);
    assert.equal(r.skills.filter((s) => s.isDefault).length, 1, `${id}: exactly one default skill`);
    assert.ok(!(id in CHESS), `${id}: lives outside data/chess.json (that is what keeps the season pool clean)`);
  }
});

test('自选干员:等级门槛 — 六星可于 5/6 级,四星预备干员仅 5 级且排除先锋/特种', () => {
  for (const [id, r] of Object.entries(FREE)) {
    if (r.rarity === 6) assert.deepEqual(r.freePickLevels, [5, 6], id);
    else if (r.rarity === 4) {
      assert.deepEqual(r.freePickLevels, [5], id);
      assert.ok(r.profession !== 'PIONEER' && r.profession !== 'SPECIAL', `${id}: 先锋 / 特种 are excluded`);
    } else assert.fail(`${id}: unexpected rarity ${r.rarity}`);
  }
  // the two 4★ the rule leaves out must not be offered at all
  const chars = new Set(Object.values(FREE).map((r) => r.charId));
  assert.ok(!chars.has('char_600_cpione'), '预备干员-先锋 is not selectable');
  assert.ok(!chars.has('char_607_cspec'), '预备干员-特种 is not selectable');
});

test('自选干员:不进本赛季池,且素材在客户端 manifest 中齐备', () => {
  const visible = Object.values(CHESS).filter((c) => c.visible && !c.isGolden).map((c) => c.chessId);
  assert.equal(visible.length, 112, 'the season pool is unchanged by this file');
  for (const [id, r] of Object.entries(FREE)) {
    assert.ok(!visible.includes(id), `${id}: never part of visibleChess`);
    const art = CHARS[r.charId];
    assert.ok(art, `${id}: ${r.charId} is missing from data/assets.json chars`);
    assert.ok(art.avatar, `${id}: avatar`);
    assert.ok(art.portrait, `${id}: portrait`);
    assert.ok(art.spine?.front?.skel, `${id}: battle spine (front)`);
    assert.equal(r.assets?.avatar, r.charId, `${id}: the record points at its own operator art`);
    assert.equal(r.assets?.spine, r.charId, id);
  }
});
