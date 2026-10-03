// test/match/freePickSummons.test.js — the summons of the 自选干员 (DESIGN §21).
//
// The free-pick batch shipped with `tokens: []` ("their summons belong to that step"), so a picked operator like 望
// (陷阱师, `token_10064_wang_stone1` 棋子) could never hand its summon to the player — user report 2026-10-03:
// "部署望这种有召唤物的干员，也无法选取召唤物部署". tools/build-data.mjs now resolves a 自选候选's summons exactly like a
// season chess (displayTokenDict + the skills' overrideTokenKey + the talents' tokenKey) and buildTokens emits the
// record; this file checks the data contract and the hand card end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, legalTileFor } from './harness.js';

const free = DATA.freePicks || {};
const chessOf = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : (Object.hasOwn(free, id) ? free[id] : null));
const WANG = 'chess_free_char_2027_wang';       // 望 (陷阱师): the reported case
const STONE = 'token_10064_wang_stone1';        // 棋子

function start(picks) {
  const seat = { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks };
  const bot = { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true };
  return makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 6, fake: true, seats: [seat, bot] }).start();
}

test('自选干员 的召唤物: deploying 望 grants its 棋子, which joins the hand and can be placed', () => {
  assert.ok(free[WANG], 'fixture: 望 is a 自选候选');
  assert.deepEqual(free[WANG].tokens, [STONE], 'the record carries its summon');
  const h = start({ 5: [WANG] });
  const m = h.m, ps = h.ps('p_0');
  const tok = m.gd.token(STONE);
  assert.ok(tok, 'the token record exists');
  assert.equal(tok.placeable, true, 'and is a hand card (placeable)');
  assert.equal(tok.name, '棋子');
  assert.ok(tok.variants[WANG], 'with the owner variant');
  assert.deepEqual(tok.variants[WANG].sources, ['talent', 'skill', 'display']);
  const cards = m.gd.placeableTokens(WANG);
  assert.deepEqual(cards.map((x) => x.tokenId), [STONE], 'the client card list follows the record');
  assert.ok(cards[0].count >= 1, 'with a hand stack count');
  // deploying the owner grants the summon stack, and the card can be selected and placed by hand
  h.toPrep(1);
  give(m, ps, WANG, 'board', [9, 5]);
  const card = ps.hand.find((p) => p && p.kind === 'token' && p.id === STONE);
  assert.ok(card, 'the summon joined the hand when 望 was deployed');
  const to = legalTileFor(m, ps, STONE, new Set(['9,5']));
  assert.ok(to, 'a legal tile exists for it');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: card.uid, to: { area: 'board', row: to[0], col: to[1] }, dir: 'RIGHT' }), { ok: true }, 'and it can be selected and placed');
  assert.ok(ps.board.size >= 2, 'the summon stands on the board beside its owner');
  h.m.dispose();
});

test('自选干员 的召唤物 resolve as data, and the season\'s own summons are separate', () => {
  const TOK = DATA.tokens;
  const freeOwned = Object.values(TOK).filter((t) => (t.owners || []).some((o) => String(o).startsWith('chess_free_')));
  assert.ok(freeOwned.length >= 20, `${freeOwned.length} 自选干员 summons built`);
  assert.ok(freeOwned.every((t) => t.kind === 'summon'), 'all of them are summons');
  assert.ok(freeOwned.some((t) => t.placeable), 'and the manually deployable ones are hand cards');
  // a token belongs to the season or to the free-pick roster, never both
  for (const t of Object.values(TOK)) {
    const owners = (t.owners || []).map(String);
    assert.ok(!(owners.some((o) => o.startsWith('chess_free_')) && owners.some((o) => !o.startsWith('chess_free_'))), `${t.tokenId}: mixed owners`);
  }
  // every season chess still finds each of its summons (the season's 22 token records are untouched)
  for (const [id, c] of Object.entries(DATA.chess)) {
    for (const tid of c.tokens || []) assert.ok((TOK[tid]?.owners || []).includes(id), `${id}: ${tid} still owned by it`);
  }
  // every free-pick summon is listed by the record that owns it
  for (const [id, rec] of Object.entries(free)) {
    for (const tid of rec.tokens || []) assert.ok((TOK[tid]?.owners || []).includes(id), `${id}: ${tid} owned by it`);
  }
  assert.ok(chessOf(WANG).tokens.includes(STONE));
});
