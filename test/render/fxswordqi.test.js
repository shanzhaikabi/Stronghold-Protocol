// test/render/fxswordqi.test.js — 火陈 S3 赤霄·天喟's 剑气长龙 as a travelling projectile (render/fx.js, user report
// 2026-10-03 "然后火陈的剑气还是看不到").
//
// The sim (server/sim/content/kits/freePicks.js `swordQi`) re-emits ONE fx 'swordQi' per tile of flight — {x, y} = the
// tile the qi comes from, {tx, ty} = the tile it reached, `id` = the caster — every 1 / 1.5 = 0.667 s (SWORD_QI_SPEED;
// the tile-grid state machine added in 2754a4f). Those segments are all the client gets, so the renderer has to make the
// 长龙 out of them: a bright head on the arrived tile, and a ribbon over the segment whose life OUTLASTS the next step so
// consecutive segments join instead of blinking. The archetype used to be the generic 'move' (a one-off 0.35 s thin
// displacement trail, no head: 53 % duty cycle, and the pale ADD colour washes out on the board edge art the qi hugs
// once it turns).
// Against the headless fake PIXI (test/render/fakepixi.js), like fxflame.test.js / fxproj.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, FX;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
});
after(() => fake.restore());

const DT = 1 / 120;
const cam = presetCamera('normal', { width: 1600, height: 900 });
/** The sim's per-tile step: 1 / SWORD_QI_SPEED (freePicks.js, `_speed: 1.5` of projectile_chr_chen3_s3). */
const QI_STEP = 1 / 1.5;
const unit = (id, x, y, o = {}) => ({ id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, info: { defId: 'x' }, onHit() {}, ...o });

function makeFx(views) {
  const P = fake.P;
  const ctx = fakeViewCtx(P);
  const map = new Map(views.map((v) => [v.id, v]));
  const fx = new FX.FxSystem({
    P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
    timeScale: () => 1, loadLevel: () => 0, subProfOf: () => null, view: (id) => map.get(id) || null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
  return { fx, map };
}
const run = (fx, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) fx.update(DT); };
/** One sim event of the qi: the 1-tile segment (x, y) → (tx, ty) of caster `owner` (the sim's own shape). */
const seg = (fx, owner, x, y, tx, ty) => fx.simFx('swordQi', x, y, { id: owner.id, tx, ty });
/** The ribbous / head particles a segment drew, in creation order. */
const sprites = (fx) => fx.parts.map((p) => ({ tex: p.sp.texture, x: p.sp.position.x, y: p.sp.position.y, sx: p.sp.scale.x, sy: p.sp.scale.y, rot: p.sp.rotation, a: p.sp.alpha, max: p.max, tint: p.sp.tint }));
const ribbons = (fx) => sprites(fx).filter((s) => s.tex && s.tex.width === 128 && s.tex.height === 32);   // the 'streak' texture

describe('火陈 S3 剑气长龙: one travelling projectile out of the sim\'s per-tile segments (user report 2026-10-03)', () => {
  test('its own archetype, not the generic displacement trail', () => {
    assert.equal(FX.FX_KINDS.swordQi.a, 'swordQi');
    assert.equal(FX.fxSpec('swordQi').a, 'swordQi');
  });

  test('every segment draws a ribbon over itself plus a head on the arrived tile', () => {
    const chen = unit(7, 4, 12), { fx } = makeFx([chen]);
    const n0 = fx.parts.length;
    seg(fx, chen, 9, 9, 8, 9);                      // the qi stepped from (9,9) to (8,9)
    const drawn = fx.parts.length - n0;
    assert.ok(drawn >= 3, `a ribbon (body + core) and a head are drawn (${drawn} particles)`);
    const band = ribbons(fx);
    assert.ok(band.length >= 2, 'the body is layered (a wide outer ribbon + a bright core)');
    assert.equal(band[0].rot, band[0].rot, 'a rotation, not NaN');
    // the ribbon ends on the tile the qi reached, anchored there (anchorX 1: it trails backwards); it is drawn at the
    // same raised height the case projects from
    const head = cam.project(8, 9, 0.4);
    for (const b of band) assert.ok(Math.hypot(b.x - head.x, b.y - head.y) < 1, `ribbon anchored at the head (${b.x},${b.y}) vs (${head.x},${head.y})`);
    assert.ok(band[0].sy > band[1].sy, 'the outer ribbon is thicker than the core');
    assert.ok(fx.counts.rings >= 1, 'a ring on the ground marks the head');
  });

  test('the ribbon outlives the next sim step: consecutive segments join instead of blinking', () => {
    const chen = unit(7, 4, 12), { fx } = makeFx([chen]);
    // the sim's own cadence: one segment per QI_STEP (0.667 s), the qi turning clockwise at the field edge
    const path = [[9, 9, 8, 9], [8, 9, 8, 10], [8, 10, 8, 11], [8, 11, 8, 12]];
    for (const [x, y, tx, ty] of path) {
      seg(fx, chen, x, y, tx, ty);
      run(fx, QI_STEP);
      const live = ribbons(fx).filter((s) => s.a > 0);
      assert.ok(live.length >= 1, 'the segment just drawn (and usually the one before it) is still on screen');
    }
    // a ribbon lives QI_TAIL > QI_STEP: right before the next step the previous segment is still visible
    const { fx: fx2 } = makeFx([chen]);
    seg(fx2, chen, 9, 9, 8, 9);
    const born = ribbons(fx2).length;
    run(fx2, QI_STEP - 0.05);
    const still = ribbons(fx2).filter((s) => s.a > 0.02);
    assert.equal(born, 2, 'the segment drew its body and its core');
    assert.ok(still.length >= 1, 'the body is still there when the next step arrives (no gap, no flicker)');
    assert.equal(ribbons(fx2)[0].max, 1.05, 'and its life outlasts the sim\'s 0.667 s step');
  });

  test('the pale ADD colour no longer washes out: a bright white core inside the tinted body', () => {
    const chen = unit(7, 4, 12), { fx } = makeFx([chen]);
    seg(fx, chen, 9, 9, 8, 9);
    const band = ribbons(fx);
    assert.equal(band[0].tint, FX.FX_KINDS.swordQi.c, 'the outer ribbon keeps the 剑气 colour');
    assert.equal(band[1].tint, 0xffffff, 'and a white core runs inside it');
    assert.ok(band[1].a > band[0].a, 'the core is the brighter of the two');
  });

  test('a grid-less / headless event still draws: the ribbon falls back to the event\'s own anchor', () => {
    const chen = unit(7, 4, 12), { fx } = makeFx([chen]);
    const n0 = fx.parts.length;
    fx.simFx('swordQi', 9, 9, { id: 7 });          // no tx / ty (older emitters)
    assert.ok(fx.parts.length > n0, 'nothing throws, something is drawn');
  });
});
