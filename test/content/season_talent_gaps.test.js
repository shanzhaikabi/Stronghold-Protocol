// The two "dead declared talent" season cases the 2026-10-03 audit could not settle — pinned as measured, because the
// audit read the DEFAULT loadout:
//
//  * 仇白 chess_char_6_15: the kit builds its crowd attack-speed talent from `t0.cnt` / `t0.attack_speed` and the
//    module's 落英 upgrade from `t1.duration_advanced`. Those keys live in the LOR-Y module's `talentChanges`
//    (`uniequip_003_qiubai`, "欲雪时" — moduleDesc "攻击范围内存在2名及以上敌人时攻击速度+12") and
//    `shared/loadoutRecord.js composeTalents` merges them into `def.talents` for that loadout, so both are LIVE when
//    the module is equipped and correctly dead under the default LOR-X. Nothing to fix — do not hardcode cnt/attack_speed.
//  * 凯瑟琳 chess_char_4_11: the talent's `cnt: 3` ("携带3个支援装置") is the token's `stats.deckStack: 3` (a data-only
//    stat no sim code reads); the deployable stack comes from `stats.deployLimit: 2` through
//    `GameData.placeableTokens` — the devices DO deploy (one hand stack of 2, refilled each round).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA } from '../match/harness.js';

const ds = new DataSource({ chess: DATA.chess ?? DATA }, getDefaultSource());
const QIUBAI = 'chess_char_6_15_b', CATHY = 'chess_char_4_11_a';
const bbOf = (id, lo) => ds.getChess(id, lo).talents.map((t) => t.bb);

test('仇白: the module`s crowd attack speed and 落英 upgrade are live under LOR-Y, absent under the default', () => {
  const base = bbOf(QIUBAI, {});
  assert.equal(base[0].cnt, undefined, 'the default module (LOR-X) declares no crowd talent');
  assert.equal(base[1].duration_advanced, undefined, '…and no 落英 upgrade');
  const y = bbOf(QIUBAI, { moduleId: 'uniequip_003_qiubai' });
  assert.equal(y[0].cnt, 2, '攻击范围内存在2名及以上敌人');
  assert.equal(y[0].attack_speed, 12, '攻击速度+12');
  assert.equal(y[1].prob, 0.25, 'the module raises 落英`s chance');
  assert.equal(y[1].duration_advanced, 3, '首次命中敌人时…束缚时间提升至3秒');
  // the kit reads the resolved bb: exactly one talent hook under LOR-Y, none under the default
  for (const [lo, want] of [[{ moduleId: 'uniequip_003_qiubai' }, 1], [{}, 0]]) {
    const h = makeBattle({ seed: 1, autoFinish: false, timeLimit: 1, content: 'full', units: [{ chessId: QIUBAI, row: 10, col: 4, ...lo }], enemies: [] });
    h.step();
    assert.equal(h.unit(QIUBAI).kit.talents.length, want, `talents under ${JSON.stringify(lo)}`);
  }
});

test('凯瑟琳: the 支援装置 deploy (deployLimit 2 from a 3-deep deck), so the talent`s `cnt` is not a lost mechanic', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  const t0 = DATA.chess[CATHY].talents[0];
  assert.deepEqual(t0.bb, { cnt: 3 }, '携带3个支援装置（最多部署2个）');
  const tok = DATA.tokens.token_10041_cathy_catsld;
  assert.equal(tok.placeable, true, 'the device is a hand piece');
  assert.equal(tok.kind, 'summon');
  assert.equal(tok.stats.deckStack, t0.bb.cnt, 'the 3 carried stacks are the token`s deckStack');
  assert.equal(tok.stats.deployLimit, 2, '最多部署2个');
  const cards = gd.placeableTokens(CATHY);
  assert.deepEqual(cards, [{ tokenId: 'token_10041_cathy_catsld', count: tok.stats.deployLimit }], 'the owner is sent its device stack');
});
