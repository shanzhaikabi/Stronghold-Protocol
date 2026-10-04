// Typed shields (server/sim/damage.js `absorbShields(…, damageType)` + the `physShield` / `artsShield` tags) — ported
// from PR #71 by SrC2O4 (增加六星自选功能, head c76a81f), where 夜莺 S3 and 傀影幻影 S1 need a barrier that only absorbs
// one damage type. Upstream's own file carries this case as "typed barriers absorb only matching damage and leave other
// shields intact"; here it is a sim-core test, so the prerequisite can be verified without the kits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

test('typed barriers absorb only matching damage and leave other shields intact', () => {
  // a synthetic 0 DEF / 0 RES unit: `mitigate` must not shrink the probe damage (a real operator record has DEF)
  const h = makeBattle({
    defs: { chess: { t_barrier: chessRec({ id: 't_barrier', stats: { maxHp: 5000, def: 0, res: 0 } }) } },
    units: [{ chessId: 't_barrier', row: 10, col: 5 }],
    content: 'none',
    autoFinish: false,
  });
  h.step();
  const b = h.b,
    u = h.unit('t_barrier');
  b.addBuff(u, { key: 'test:arts', shield: 200, tags: ['artsShield'] });
  const before = u.hp;
  b.dealDamage(null, u, { amount: 100, type: 'true', canDodge: false });
  assert.equal(u.hp, before - 100, 'true damage ignores every barrier');
  assert.equal(u.findBuff('test:arts').shield, 200);
  b.dealDamage(null, u, { amount: 100, type: 'arts', canDodge: false });
  assert.equal(u.hp, before - 100);
  assert.equal(u.findBuff('test:arts').shield, 100);
  b.addBuff(u, { key: 'test:phys', shield: 200, tags: ['physShield'] });
  b.dealDamage(null, u, { amount: 100, type: 'arts', canDodge: false });
  assert.equal(u.findBuff('test:phys').shield, 200);
  b.dealDamage(null, u, { amount: 100, type: 'phys', canDodge: false });
  assert.equal(u.findBuff('test:phys').shield, 100);
  // the type a `hit` handler assigns is what the barrier sees (驭法铁卫's arts conversion, 弱点伤害)
  b.addBuff(u, { key: 'test:typed', shield: 500, tags: ['artsShield'] });
  b.on('hit', (c) => { if (c.target === u && c.dmg.isAttack) c.dmg.type = 'arts'; }, { owner: u });
  b.dealDamage(u, u, { amount: 100, type: 'phys', isAttack: true, canDodge: false });
  assert.equal(u.findBuff('test:typed').shield, 400);
});
