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
const BONDS = load('bonds.json');
/** The 8 core bonds the user's faction rule maps to (plus 协防干员 for everyone outside them). */
const CORE = new Set(Object.values(BONDS).filter((b) => b.isCore).map((b) => b.bondId));

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
    // exactly ONE bond — the 主盟约: a core faction bond (阿戈尔 … 炎) or 协防干员; never a second one, because the ban
    // filter drops a pick by its single 主盟约 [user].
    assert.equal(r.bonds.length, 1, `${id}: one 主盟约, got ${r.bonds.join(',')}`);
    assert.ok(CORE.has(r.bonds[0]) || r.bonds[0] === 'emptyShip', `${id}: ${r.bonds[0]} is a core bond or 协防干员`);
    assert.ok(BONDS[r.bonds[0]], `${id}: ${r.bonds[0]} exists in bonds.json`);
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

test('自选干员:不进本赛季池;素材是按需的(缺失时客户端显示首字占位)', () => {
  const visible = Object.values(CHESS).filter((c) => c.visible && !c.isGolden).map((c) => c.chessId);
  assert.equal(visible.length, 112, 'the season pool is unchanged by this file');
  const noArt = [];
  for (const [id, r] of Object.entries(FREE)) {
    assert.ok(!visible.includes(id), `${id}: never part of visibleChess`);
    assert.equal(r.assets?.avatar, r.charId, `${id}: the record points at its own operator art`);
    assert.equal(r.assets?.spine, r.charId, id);
    // art lives in data/assets.json, which is built from the local game client and is NOT in git: an operator whose
    // art has not been extracted yet renders as its first character (chessAvatarUrl fallback) instead of failing.
    const art = CHARS[r.charId];
    if (!art || !art.avatar || !art.portrait || !art.spine?.front?.skel) noArt.push(r.charId);
  }
  // the season's own 原型干员 DO have art (they ship with the release bundle); a large regression would mean the
  // manifest broke, so require at least those.
  const proto = Object.values(FREE).filter((r) => /^char_6\d\d_/.test(r.charId)).map((r) => r.charId);
  assert.ok(proto.length >= 15, `the 原型干员 are still in the roster (${proto.length})`);
  assert.deepEqual(noArt.filter((c) => proto.includes(c)), [], 'every 原型干员 has avatar/portrait/spine');
  assert.ok(noArt.length < Object.keys(FREE).length, 'not every candidate may lack art');
});

test('自选干员:名单由原始数据推导 — 候选绝不与本赛季池重复,且覆盖全部原型干员', () => {
  // the池 duplicate rule [user]: no candidate may be an operator a season chess record already uses
  const seasonChars = new Set(Object.values(CHESS).filter((c) => c.charId).map((c) => c.charId));
  for (const [id, r] of Object.entries(FREE)) {
    assert.ok(!seasonChars.has(r.charId), `${id}: ${r.charId} already has a season chess — it must not be a 自选候选`);
  }
  // every 原型干员 of the season's backup data is offered, except the 先锋 / 特种 4★ the rule leaves out
  const backup = JSON.parse(readFileSync(path.join(ROOT, 'docs/research/03-operators.json'), 'utf8'));
  const protos = new Set((backup.chess || []).filter((c) => c?.backup?.charId).map((c) => c.backup.charId));
  assert.ok(protos.size >= 17, `the backup data lists ${protos.size} 原型干员`);
  const offered = new Set(Object.values(FREE).map((r) => r.charId));
  const missing = [...protos].filter((c) => !offered.has(c) && !['char_600_cpione', 'char_607_cspec'].includes(c));
  assert.deepEqual(missing, [], 'every 原型干员 is offered (the 先锋 / 特种 two are the only exceptions)');
  // the roster is the whole 6★ pool the season does NOT offer: well past the 15 records it started with
  assert.ok(Object.keys(FREE).length >= 90, `roster size ${Object.keys(FREE).length}`);
});

test('自选干员: their summons resolve into tokens.json, and no season operator\'s summon changed', () => {
  // user report 2026-10-03: "部署望这种有召唤物的干员，也无法选取召唤物部署" — the batch shipped with `tokens: []`; the
  // builder now resolves them like a season chess (displayTokenDict + the skills' overrideTokenKey + the talents'
  // tokenKey) and buildTokens emits the record. 26 of the 93 picks have summons (37 token ids).
  const TOK = load('tokens.json');
  const freeOwned = Object.values(TOK).filter((t) => (t.owners || []).some((o) => String(o).startsWith('chess_free_')));
  assert.ok(freeOwned.length >= 20, `${freeOwned.length} 自选干员 summons built`);
  const stone = TOK['token_10064_wang_stone1'];   // 望's 棋子
  assert.ok(stone, '棋子 exists');
  assert.equal(stone.name, '棋子');
  assert.equal(stone.placeable, true, 'and is a manually deployable hand card');
  assert.ok(stone.variants['chess_free_char_2027_wang'], 'with the owner variant');
  assert.deepEqual(FREE['chess_free_char_2027_wang'].tokens, ['token_10064_wang_stone1']);
  // ownership never mixes: a token belongs to the season or to the free-pick roster
  for (const t of Object.values(TOK)) {
    const owners = (t.owners || []).map(String);
    const free = owners.some((o) => o.startsWith('chess_free_'));
    const season = owners.some((o) => !o.startsWith('chess_free_'));
    assert.ok(!(free && season), `${t.tokenId}: a season and a 自选干员 must not share a token`);
  }
  // every season chess still finds each of its summons, owned by itself (the 22 season tokens are untouched)
  for (const [id, c] of Object.entries(CHESS)) {
    for (const tid of c.tokens || []) assert.ok((TOK[tid]?.owners || []).includes(id), `${id}: ${tid} still owned by it`);
  }
});
