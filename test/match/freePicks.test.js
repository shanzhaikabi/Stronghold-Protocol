// test/match/freePicks.test.js — 自选干员 / 自由位置 on the MATCH side (DESIGN §21).
//
// seats[].picks → PlayerState.freePicks (re-checked against this match's data), and freePickIds(): the picks that
// actually join THIS player's shop pool. A pick whose 主盟约 is in the match's drawn disabled set is dropped entirely
// ("如果对应的主盟约被ban，该干员也不会出现在池子内" [user]); 协防干员 can never be banned (its bond has weight 0, so
// the ban draw cannot pick it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../../shared/constants.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA, makeMatch, give, giveItem } from './harness.js';

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

test('自选干员: 进入本人池 —— 出现在该玩家的抽卡候选里,并按自己的阶级服从 tier ≤ 调度中心等级', () => {
  const h = start({ 5: [proto6[0]] });
  const ps = h.ps('p_0');
  const entries = ps.freePickEntries();
  const mine = entries.find((e) => e.id === proto6[0]);
  assert.ok(mine, 'the pick is a pool entry of its owner');
  assert.equal(mine.tier, free[proto6[0]].tier, 'its tier');

  // the shared pool alone never lists it — a prototype is not a season chess
  assert.ok(!h.m.pool._eligible({ maxTier: 6 }).some(([id]) => id === proto6[0]), 'absent from the shared list');
  // …and this player's draw obeys the same gate as any operator of that tier (DESIGN §21; research 01 §6
  // "shop level L offers operators of tier ≤ L"): a 6★ pick is NOT drawable at 调度中心 5 级, only at 6 级
  const lists = (maxTier) => h.m.pool._eligible({ maxTier, extra: entries }).some(([id]) => id === proto6[0]);
  const shared6 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 6).chessId;
  const sharedAt = (maxTier) => h.m.pool._eligible({ maxTier }).some(([id]) => id === shared6);
  for (const level of [1, 4, 5]) {
    assert.equal(lists(level), false, `not listed at 调度中心 ${level} 级`);
    assert.equal(sharedAt(level), false, `(a season 6★ is not either — no special case)`);
  }
  assert.equal(lists(6), true, 'drawable at 6 级');
  assert.equal(sharedAt(6), true);
  // an exact-tier request (the merge promotion reward / 信标) still filters by tier — that is how a lower-level merge
  // legitimately reaches one tier above (research 01 §7)
  assert.ok(!h.m.pool._eligible({ tier: 5, extra: entries }).some(([id]) => id === proto6[0]), 'not for an exact tier-5 draw');
  assert.ok(h.m.pool._eligible({ tier: mine.tier, extra: entries }).some(([id]) => id === proto6[0]), 'but for its own tier');
  // the caller's filter applies to extras as well (寻呼模块 etc. roll by bond)
  assert.ok(!h.m.pool._eligible({ maxTier: 6, extra: entries, filter: () => false }).some(([id]) => id === proto6[0]), 'filter respected');
  assert.ok(!h.m.pool._eligible({ maxTier: 6, extra: entries, filter: (id, e) => e.tier === 4 }).some(([id]) => id === proto6[0]), 'filter sees the extra tier');

  assert.deepEqual(h.ps('ai_0').freePickEntries(), [], 'other players never see it — the pool is private');
  h.m.dispose();
});

test('自选干员: 商店槽位按调度中心等级放行 —— 5 级抽不到 6★ 选取,6 级能;4★ 预备干员 4 级就进池', () => {
  const t4 = freeIds.find((id) => free[id].rarity === 4);
  const h = start({ 5: [proto6[0], t4] });   // a 6★ pick and a 4★ 预备干员 (pickable at 5 级, tier 4)
  const ps = h.ps('p_0');
  h.toPrep(1);
  /** id sets the shop slot yields at a level (the real `PlayerState._rollChessSlot` call). */
  const shopIds = (level, n = 400) => {
    ps.shop.level = level;
    const seen = new Set();
    for (let i = 0; i < n; i++) seen.add(ps._rollChessSlot().id);
    return seen;
  };
  for (const level of [1, 4, 5]) {
    const seen = shopIds(level);
    assert.ok(!seen.has(proto6[0]), `the 6★ pick never rolls at 调度中心 ${level} 级`);
    assert.ok([...seen].every((id) => h.m.gd.tierOf(id) <= level), `nothing above the gate at ${level} 级`);
  }
  assert.ok(shopIds(4).has(t4), 'the 4★ 预备干员 (tier 4) IS drawable at 4 级 — same gate as a normal T4');
  assert.ok(!shopIds(3).has(t4), 'and not at 3 级');
  assert.ok(shopIds(6).has(proto6[0]), 'the 6★ pick is drawable once 调度中心 reaches 6 级');
  h.m.dispose();
});

test('自选干员: 三合一晋升奖励 — 5 级合出的 6★ 抽取里能有选取,4 级合出的 5★ 抽取里能有 5★ 选取', () => {
  // the roster has no 5★ record (6★ + the 4★ 预备干员 only), so the level-4 case gets one injected: same shape, its
  // own 自选干员 data, tier 5, selectable at 调度中心 5 级 only
  const T5 = 'chess_free_test_t5';
  const data = { ...DATA, freePicks: { ...free, [T5]: { ...free[proto6[0]], chessId: T5, baseId: T5, name: '测试五星原型', rarity: 5, tier: 5, freePickLevels: [5] } } };
  const seat = { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks: { 5: [T5, proto6[0]] } };
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
