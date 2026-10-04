// test/match/freePicks.test.js — 自选干员 / 自由位置 on the MATCH side (DESIGN §23).
//
// seats[].picks → PlayerState.freePicks (re-checked against this match's data), and freePickIds(): the picks that
// actually join THIS player's shop pool. A pick whose 主盟约 is in the match's drawn disabled set is dropped entirely
// ("如果对应的主盟约被ban，该干员也不会出现在池子内" [user]); 协防干员 can never be banned (its bond has weight 0, so
// the ban draw cannot pick it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../../shared/constants.js';
import { createRng } from '../../server/sim/rng.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { tierOf as simTierOf } from '../../server/sim/content/support/index.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { DATA, makeMatch, give, giveItem, legalTileFor } from './harness.js';

const free = DATA.freePicks || {};
const freeIds = Object.keys(free).sort();
const proto6 = freeIds.filter((id) => free[id].rarity === 6);
const chessOf = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : (Object.hasOwn(free, id) ? free[id] : null));

// NORMAL seed 6 draws kjeragShip + siracusaShip + kazimierzShip among its core bans (the same fixtures pool.test.js uses)
const SEED = 6;
// 自选候选 fixtures: the season pool never appears here (a 自选候选 is by definition an operator it does NOT offer)
const BANNED = 'chess_free_char_4037_demetr'; // 贝洛内 → siracusaShip (banned at this seed)
const SAFE = 'chess_free_char_112_siege';     // 推进之王 → victoriaShip (not banned)
const SEASON = 'chess_char_3_01_a';           // 能天使: a season chess, only for the 主盟约-derivation test

function start(picks) {
  const seat = { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks };
  const bot = { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true };
  return makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: SEED, fake: true, seats: [seat, bot] }).start();
}

test('自选干员: seats[].picks 存入 PlayerState(校验通过时)', () => {
  assert.ok(proto6.length >= 2, 'fixtures');
  const h = start({ 5: [proto6[0]], 6: [SAFE] });
  const ps = h.ps('p_0');
  assert.deepEqual(ps.freePicks, { 5: [proto6[0]], 6: [SAFE] });
  assert.equal(ps.freePickIds().length, 2, 'both join the pool — neither 主盟约 is banned');
  assert.deepEqual(h.ps('ai_0').freePicks, {}, 'bots never pick');
  h.m.dispose();
});

test('自选干员: 主盟约被 ban 的选取不进池;协防(原型)永远进池', () => {
  const h = start({ 5: [proto6[0]], 6: [BANNED] });
  const ps = h.ps('p_0');
  assert.ok(h.m.disabledBonds.includes('siracusaShip'), 'fixture: siracusaShip is banned at this seed');
  assert.equal(ps.freePickMainBond(chessOf(BANNED)), 'siracusaShip');
  assert.ok(!ps.freePickIds().includes(BANNED), '忍冬 的主盟约被 ban ⇒ 本局不进池');
  assert.ok(ps.freePickIds().includes(proto6[0]), '原型是协防干员 —— weight 0,永远抽不到 ban');
  assert.deepEqual(ps.freePicks, { 5: [proto6[0]], 6: [BANNED] }, 'the pick is still stored; the filter applies on use');
  h.m.dispose();
});

test('自选干员: 主盟约以数据 bonds 为准(隐藏势力),而不是 nationId', () => {
  const h = start({});
  const ps = h.ps('p_0');
  // 能天使 is 龙门 (lungmen) by nationId but carries 拉特兰 — user: "游戏过程中的实际盟约可能与别处显示的盟约有冲突,
  // 此处以实际盟约为准"
  assert.equal(chessOf(SEASON).nationId, 'lungmen');
  assert.equal(ps.freePickMainBond(chessOf(SEASON)), 'lateranoShip', 'the record bonds win over the faction');
  // a prototype carries no faction at all ⇒ 协防干员
  assert.equal(ps.freePickMainBond(chessOf(proto6[0])), 'emptyShip');
  h.m.dispose();
});

test('自选干员: 非法选取被拒,已有选取保持不变', () => {
  const h = start({ 5: [proto6[0]] });
  const ps = h.ps('p_0');
  assert.equal(ps.setFreePicks({ 6: ['chess_char_2_01_a'] }), false, 'a PRESET operator is refused');
  assert.deepEqual(ps.freePicks, { 5: [proto6[0]] }, 'unchanged');
  assert.equal(ps.setFreePicks({ 5: [proto6[0], proto6[0]] }), false, 'a duplicate is refused');
  assert.equal(ps.setFreePicks({ 6: [proto6[1]] }), true, 'a legal set replaces it');
  assert.deepEqual(ps.freePicks, { 6: [proto6[1]] });
  h.m.dispose();
});

test('自选干员: m.private 暴露真正进池的列表;Match.setFreePicks 仅在 INFO_CHECK 接受', () => {
  const h = start({ 5: [proto6[0]], 6: [BANNED] });
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1);
  assert.deepEqual(ps.privateView().freePicks, [proto6[0]], 'only the one that joins the pool');
  assert.equal(m.setFreePicks('p_0', { 5: [proto6[1]] }).error, ERR.WRONG_PHASE, 'locked outside INFO_CHECK, like the loadout');
  m.dispose();
});

test('自选干员: 进入本人池 —— 出现在该玩家的抽卡候选里,并按自己的等阶服从 tier ≤ 调度中心等级', () => {
  const h = start({ 5: [proto6[0]], 6: [proto6[1]] });
  const ps = h.ps('p_0');
  const entries = ps.freePickEntries();
  const mine = entries.find((e) => e.id === proto6[0]);
  assert.ok(mine, 'the pick is a pool entry of its owner');
  assert.equal(mine.tier, 5, 'its tier is the 自由位置 slot it was filed at (not the record rarity)');

  // the shared pool alone never lists it — a prototype is not a season chess
  assert.ok(!h.m.pool._eligible({ maxTier: 6 }).some(([id]) => id === proto6[0]), 'absent from the shared list');
  // …and this player's draw obeys the same gate as any operator of that tier (DESIGN §23; research 01 §6
  // "shop level L offers operators of tier ≤ L"): a 等阶-5 pick is drawable from 调度中心 5 级, a 等阶-6 one from 6 级
  const lists = (maxTier, id = proto6[0]) => h.m.pool._eligible({ maxTier, extra: entries }).some(([x]) => x === id);
  const shared6 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 6).chessId;
  const sharedAt = (maxTier) => h.m.pool._eligible({ maxTier }).some(([id]) => id === shared6);
  for (const level of [1, 4]) {
    assert.equal(lists(level), false, `not listed at 调度中心 ${level} 级`);
    assert.equal(lists(level, proto6[1]), false, 'the 等阶-6 pick is not either');
    assert.equal(sharedAt(level), false, `(a season 6★ is not either — no special case)`);
  }
  assert.equal(lists(5), true, 'drawable at 5 级 (its own 等阶)');
  assert.equal(lists(5, proto6[1]), false, 'the 等阶-6 pick still waits for 6 级');
  assert.equal(lists(6), true, 'drawable at 6 级');
  assert.equal(lists(6, proto6[1]), true, 'and so is the 等阶-6 pick');
  assert.equal(sharedAt(6), true);
  // an exact-tier request (the merge promotion reward / 信标) still filters by tier — that is how a lower-level merge
  // legitimately reaches one tier above (research 01 §7)
  assert.ok(!h.m.pool._eligible({ tier: 4, extra: entries }).some(([id]) => id === proto6[0]), 'not for an exact tier-4 draw');
  assert.ok(h.m.pool._eligible({ tier: mine.tier, extra: entries }).some(([id]) => id === proto6[0]), 'but for its own tier');
  assert.ok(!h.m.pool._eligible({ tier: 6, extra: entries }).some(([id]) => id === proto6[0]), 'the 等阶-5 pick is not a tier-6 candidate');
  // the caller's filter applies to extras as well (寻呼模块 etc. roll by bond)
  assert.ok(!h.m.pool._eligible({ maxTier: 6, extra: entries, filter: () => false }).some(([id]) => id === proto6[0]), 'filter respected');
  assert.ok(!h.m.pool._eligible({ maxTier: 6, extra: entries, filter: (id, e) => e.tier === 4 }).some(([id]) => id === proto6[0]), 'filter sees the extra tier');

  assert.deepEqual(h.ps('ai_0').freePickEntries(), [], 'other players never see it — the pool is private');
  h.m.dispose();
});

test('自选干员: 自由位置的等级就是该干员本局的等阶(用户 2026-10-03: "自选干员都进了6级")', () => {
  // The 自由位置 slots are the 甄选干员 slots of the official 物资调配处: two at 等阶 5 and two at 等阶 6, and the slot IS
  // the operator's 等阶 for the match (biligame 卫戍协议: "对于五六阶干员…还各共开放了2个甄选干员名额" + the shop rule
  // "仅在调度中心等级 ≥ 干员所在等阶时，该干员才有可能出现在栏位中"). A 6★ record filed at the 等阶-5 slot therefore
  // enters the pool at 调度中心 5 级 — it must NOT be treated as a 等阶-6 operator because of its rarity.
  const EARLY = proto6[0];   // 凯尔希, 协防干员 (emptyShip: never banned at this seed)
  const LATE = proto6[1];    // 陈, 炎 (yanShip: not banned at this seed)
  const h = start({ 5: [EARLY], 6: [LATE] });
  const ps = h.ps('p_0');
  assert.deepEqual(ps.freePickIds(), [EARLY, LATE], 'both join the pool');
  const entries = ps.freePickEntries();
  assert.deepEqual(entries.map((e) => [e.id, e.tier]), [[EARLY, 5], [LATE, 6]],
    'the extra entry carries the SLOT level, not the record rarity (both records are 6★ / tier 6)');
  assert.equal(h.m.gd.tierOf(EARLY), 6, 'fixture: the record itself is a tier-6 operator');

  const listed = (level, id) => h.m.pool._eligible({ maxTier: level, extra: entries }).some(([x]) => x === id);
  for (const level of [1, 3, 4]) {
    assert.equal(listed(level, EARLY), false, `the 等阶-5 pick is not listed at 调度中心 ${level} 级 (it may not appear early)`);
    assert.equal(listed(level, LATE), false, `the 等阶-6 pick is not either`);
  }
  assert.equal(listed(5, EARLY), true, 'the 等阶-5 pick IS listed at 调度中心 5 级');
  assert.equal(listed(5, LATE), false, 'the 等阶-6 pick is not');
  assert.equal(listed(6, LATE), true, 'and it is at 6 级');

  // …and the real shop slot honours it (PlayerState._rollChessSlot → pool.roll({ maxTier: shop.level, extra }))
  h.toPrep(1);
  const shopIds = (level, n = 400) => {
    ps.shop.level = level;
    const seen = new Set();
    for (let i = 0; i < n; i++) seen.add(ps._rollChessSlot().id);
    return seen;
  };
  assert.equal(shopIds(5).has(EARLY), true, 'the 等阶-5 pick rolls in the shop at 5 级');
  assert.equal(shopIds(5).has(LATE), false, 'the 等阶-6 pick does not');
  assert.equal(shopIds(6).has(LATE), true, 'it rolls once 调度中心 reaches 6 级');
  h.m.dispose();
});

test('自选干员: 4★ 预备干员 填在 5 阶槽 ⇒ 5 级才进池(不是它的记录 tier 4)', () => {
  const t4 = freeIds.find((id) => free[id].rarity === 4);
  const h = start({ 5: [t4] });
  const ps = h.ps('p_0');
  assert.equal(h.m.gd.tierOf(t4), 4, 'fixture: the record itself is tier 4');
  assert.deepEqual(ps.freePickEntries().map((e) => [e.id, e.tier]), [[t4, 5]], 'the slot level gates it');
  const listed = (level) => h.m.pool._eligible({ maxTier: level, extra: ps.freePickEntries() }).some(([x]) => x === t4);
  assert.equal(listed(3), false, 'not at 3 级');
  assert.equal(listed(4), false, 'nor at 4 级 — the 5 阶 slot is what admits it');
  assert.equal(listed(5), true, 'from 调度中心 5 级');
  h.m.dispose();
});

test('自选干员: 本局等阶按槽位走 —— 商店卡/手牌/侦查/结算/战斗单位都显示槽位阶级(用户 2026-10-04 "自选会变成 6 阶,即使我把它放在 5 阶的位置")', async () => {
  // DESIGN §23.6: the slot IS the operator's 等阶 for the match. `freePickEntries` (the pool gate) had learned that in
  // 2026-10-03, but every number the player is SHOWN — and every 等阶 the battle reads — still came from the record,
  // which is 6 for 87 of the 93 candidates: a pick filed at 5 阶 showed VI in the shop, on its card and in the battle.
  const EARLY = proto6[0];   // 凯尔希, 协防干员 — filed at 5 阶
  const LATE = proto6[1];    // 陈, 炎 — filed at 6 阶
  const FOUR = freeIds.find((id) => free[id].rarity === 4);   // a 4★ 预备干员 (5 阶 only)
  const SZN = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 6).chessId;
  const h = start({ 5: [EARLY, FOUR], 6: [LATE] });
  const m = h.m, ps = h.ps('p_0');

  assert.equal(m.gd.tierOf(EARLY), 6, 'fixture: the record itself is a 等阶-6 operator');
  assert.equal(m.gd.tierOf(FOUR), 4, 'fixture: the 4★ 预备干员 record itself is 等阶 4');

  h.toPrep(1);
  // the piece views (hand / 整备区 chip, the detail panel): the chip the player sees on the operator they filed at 5 阶
  const inHand = give(m, ps, EARLY, 'hand');
  assert.equal(ps.pieceView(inHand).tier, 5, 'the hand / 整备区 chip (pieceView — UnitThumb / the 3D renderer)');
  const onBoard = give(m, ps, EARLY, 'board', legalTileFor(m, ps, EARLY));
  assert.equal(m.prepFieldMeta(ps).units.find((u) => u.uid === onBoard.uid).tier, 5, 'the scouted board (m.field) of a teammate');
  // the shop card (public/js/ui/shopBar.js reads slot.tier; privateView must carry it — the record says 6)
  ps.shop.level = 5;
  ps.shop.slots = [{ kind: 'chess', id: EARLY, basePrice: m.gd.chessPrice(EARLY), sold: false, frozen: false }];
  assert.equal(ps.privateView().shop.slots[0].tier, 5, 'the shop slot view carries the match 等阶, not the rarity');
  const input = ps.battleInput({ side: 'L', colOffset: 0 });
  const unitInput = input.units.find((u) => u.uid === onBoard.uid);
  assert.equal(unitInput.tier, 5, 'the battle input carries the match 等阶 into the sim');

  // …and the sim reads it everywhere an operator's 等阶 matters (content/support.js tierOf: 据点 by_charlevel,
  // 克莱门莎's band13 (+its 等阶 layers), the 阿戈尔 devour layers) — and draws it on the battle chip
  const battle = makeBattle({ data: m.ds, players: [input], spawns: [] }).battle;
  const u = battle.units.find((x) => x.kind === 'op' && x.defId === EARLY);
  assert.ok(u, 'fixture: the pick stands on the field');
  assert.equal(unitInfo(u).tier, 5, 'UnitInfo (the battle chip and a battle unit\'s detail card)');
  assert.equal(simTierOf(u), 5, 'content tierOf — the 等阶 the content hooks read');
  assert.equal(simTierOf({ kind: 'token', ownerUnit: u }), 5, 'its summons follow their owner\'s 等阶');

  // the result screen's lineup is the same number
  const { buildResult } = await import('../../server/match/results.js');
  const res = buildResult(m, { victory: false, hiddenReached: false, hiddenCleared: false, reason: 'test' });
  assert.equal(res.players.find((p) => p.playerId === 'p_0').lineup.find((x) => x.id === EARLY).tier, 5, 'the result lineup');

  // the one source of truth behind all of the above (also what a pick's own elite resolves to — same record, §23.2)
  assert.equal(ps.matchTierOf(EARLY), 5, 'the match 等阶 of a pick filed at the 5 阶 slot');
  assert.equal(ps.matchTierOf(LATE), 6, '…and of one filed at 6 阶');
  assert.equal(ps.matchTierOf(FOUR), 5, 'a 4★ 预备干员 in the 5 阶 slot is 等阶 5 for this match');
  assert.equal(ps.matchTierOf(SZN), 6, 'a season operator keeps its record tier');

  // the 4★ 预备干员: 5 阶 like its slot, while its price and copy budget stay the RECORD's (DESIGN §23.6 — a deliberate
  // split: the 5 / 6 price rows are identical, the cap is a balance number the user has not asked to move)
  const four = give(m, ps, FOUR, 'hand');
  assert.equal(ps.pieceView(four).tier, 5, 'the 4★ shows its slot 等阶 (5), not its rarity (4)');
  assert.equal(m.gd.chessPrice(FOUR), m.gd.config.economy.chessPrice[4].normal, 'its price stays the record tier\'s row');
  assert.equal(m.gd.poolCopies(FOUR), m.gd.config.economy.poolCopies[4], 'and so does its copy cap');
  m.dispose();

  // the 等阶 is PER PLAYER (the same operator may be filed at 5 阶 by one and 6 阶 by another), like the private pool
  const h2 = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seed: SEED, fake: true,
    seats: [
      { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks: { 5: [EARLY] } },
      { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true, picks: { 6: [EARLY] } },
    ],
  }).start();
  assert.equal(h2.ps('p_0').matchTierOf(EARLY), 5, 'filed at 5 阶 by P0');
  assert.equal(h2.ps('p_1').matchTierOf(EARLY), 6, 'and at 6 阶 by P1 — never a function of the chess id alone');
  assert.deepEqual(h2.ps('p_0').freePickEntries().map((e) => [e.id, e.tier]), [[EARLY, 5]]);
  assert.deepEqual(h2.ps('p_1').freePickEntries().map((e) => [e.id, e.tier]), [[EARLY, 6]]);
  h2.m.dispose();
});

test('自选干员: 三合一晋升奖励 —— 5 级合出的 6★ 抽取里能有 6 阶槽的选取,4 级合出的 5★ 抽取里能有 5 阶槽的选取', () => {
  // the roster has no 5★ record (6★ + the 4★ 预备干员 only), so the level-4 case gets one injected: same shape, its
  // own 自选干员 data, 等阶 5 (filed at the 5 阶 slot, which is the only slot it may take)
  const T5 = 'chess_free_test_t5';
  const data = { ...DATA, freePicks: { ...free, [T5]: { ...free[proto6[0]], chessId: T5, baseId: T5, name: '测试五星原型', rarity: 5, tier: 5, freePickLevels: [5] } } };
  // 等阶 5 at 5 级, 等阶 6 at 6 级 — the slot, not the rarity, decides the exact-tier request that can reach each one
  const seat = { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks: { 5: [T5], 6: [proto6[0]] } };
  const bot = { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true };
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: SEED, fake: true, data, seats: [seat, bot] }).start();
  const ps = h.ps('p_0');
  const entries = ps.freePickEntries();
  assert.equal(entries.length, 2, 'both picks joined the pool');
  const rng = () => createRng(5);
  for (const [level, pick, tier] of [[4, T5, 5], [5, proto6[0], 6]]) {
    ps.shop.level = level;
    ps.offers.length = 0;
    const offer = ps.pushRewardOffer('merge');   // what _mergeChess queues after a 三合一
    assert.equal(offer.tier, tier, `a merge at ${level} 级 offers tier ${tier} (research 01 §7 min(shopLevel+1, 6))`);
    // the offer's own roll (PlayerState.pushRewardOffer: `pool.roll(rng, { tier: tt, filter: fresh, extra })`) admits it
    assert.ok(h.m.pool._eligible({ tier, extra: entries }).some(([id]) => id === pick), `the tier-${tier} candidate set contains the pick`);
    assert.equal(h.m.pool.roll(rng(), { tier, filter: (id) => id === pick, extra: entries }), pick, 'and an exact-tier roll can yield it');
  }
  h.m.dispose();
});

test('自选干员: 份数预算 = 该阶级池上限 − 已拥有(精锐算 goldenCopies),买满即不再出现', () => {
  const h = start({ 5: [proto6[0]] });
  const ps = h.ps('p_0');
  const cap = h.m.gd.poolCopies(proto6[0]);
  assert.ok(cap > 0, 'fixture: the base has a pool cap');
  assert.equal(ps.freePickEntries()[0].left, cap, 'nothing owned yet ⇒ the full cap');
  give(h.m, ps, proto6[0], 'hand');
  assert.equal(ps.freePickEntries()[0].left, cap - 1, 'one owned copy spends one');
  for (let i = 1; i < cap; i++) give(h.m, ps, proto6[0], 'hand');
  assert.deepEqual(ps.freePickEntries(), [], 'owned in full ⇒ the pick stops appearing');
  h.m.dispose();
});

test('自选干员: 突变细胞的「高一阶」按本局等阶 —— 4★ 预备干员在 5 阶槽 ⇒ 抽 6 阶(记录 tier 4 只会抽 5 阶)', () => {
  // 突变细胞 (char_chess_transformation_equip): "获得一名高一阶的随机初始干员（最高六阶）". One tier ABOVE the carrier's 等阶
  // for the match — which for a 自选干员 is its 自由位置 slot (DESIGN §23.6), not its record rarity: the 4★ 预备干员's
  // record is tier 4 but it is a 等阶-5 operator here, so the cell must draw 等阶 6.
  const FOUR = freeIds.find((id) => free[id].rarity === 4);
  const T5 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 5).chessId;
  const T6 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 6).chessId;
  const h = start({ 5: [FOUR] });
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1);
  // pin the cell's roll per tier, so the test reads WHICH tier it asked for (everything else stays the real path)
  const roll = m.pool.roll.bind(m.pool);
  m.pool.roll = (rng, o = {}) => (o.tier === 5 ? T5 : o.tier === 6 ? T6 : roll(rng, o));
  const carrier = give(m, ps, FOUR, 'hand');
  const cell = giveItem(m, ps, 'chess_item_5_08_e_a');
  assert.equal(m.handle('p_0', { t: 'g.equip', itemUid: cell.uid, targetUid: carrier.uid }).ok, true, 'the cell equips');
  m.dispatch(ps, 'onBattleResult', { result: {}, lpLoss: 0, perfect: true });
  assert.ok(!ps.find(carrier.uid), 'the carrier is destroyed');
  const gained = ps.allChess().find((p) => p.uid !== carrier.uid);
  assert.equal(gained?.id, T6, 'a 等阶-5 carrier gets a 等阶-6 operator (the record tier 4 would have drawn 等阶 5)');
  m.dispose();
});

test('自选干员: 信标不能把它送走 —— 拒绝装备,且干员不被销毁', () => {
  const h = start({ 5: [proto6[0]] });
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1);
  const target = give(m, ps, proto6[0], 'hand');
  const beacon = giveItem(m, ps, 'chess_item_5_04_e_a'); // 信标
  const res = m.handle('p_0', { t: 'g.equip', itemUid: beacon.uid, targetUid: target.uid });
  assert.equal(res.error, ERR.BAD_TARGET, '信标 refuses a 自选干员');
  assert.ok(ps.allChess().some((p) => p.uid === target.uid), 'and the operator survives — the effect destroys its target');
  // a season operator is still a valid 信标 target (nothing else changed)
  const normal = give(m, ps, SEASON, 'hand');
  assert.equal(m.handle('p_0', { t: 'g.equip', itemUid: beacon.uid, targetUid: normal.uid }).ok, true, 'a season chess is unaffected');
  m.dispose();
});
