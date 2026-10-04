// 自选干员 per-operator kits — ported from PR #71 by SrC2O4 (增加六星自选功能, head c76a81f) and adapted to this
// project's data model (data/freePicks.json, one record per operator: no tier × elite variants, DESIGN §22).
//
// The upstream file's test/content/recruits.test.js drove `recruit_{5,6}_<charId>_{a,b}` records and a 936-combination
// matrix (78 × 3 skills × 2 tiers × 2 elite). Our roster has a single record per operator, so the same matrix is
// 78 × 3 = 234 combinations; every other idea of that file is kept (spec source, roster registry contract, the token
// life-cycle loop, the behaviour tests), with the record ids and the data lookups replaced. See server/sim/content/
// kits/recruitSupport.js for the spec merge this project adds on top of the ported kits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec } from '../helpers/battleHarness.js';
import classic from '../../server/sim/content/kits/recruitsClassic.js';
import tactics from '../../server/sim/content/kits/recruitsTactics.js';
import combat from '../../server/sim/content/kits/recruitsCombat.js';
import summons from '../../server/sim/content/kits/recruitsSummons.js';
import special from '../../server/sim/content/kits/recruitsSpecial.js';
import { area } from '../../server/sim/content/kits/recruitSupport.js';
import { kitFn, KITS, PORTED_KITS } from '../../server/sim/content/index.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const authored = { ...classic, ...tactics, ...combat, ...summons, ...special };
const CHAR_IDS = Object.keys(authored);
const chessIdOf = (char) => `chess_free_${char}`;

/** Every 自选候选 record of the sim's data (DataSource merges data/freePicks.json into the chess map). */
const freeRecords = () => Object.values(getDefaultSource().raw.chess).filter((r) => r && r.freePick === true);
/** The season records (what the pick roster must never collide with: `kitFn`'s charId fallback keys on the operator). */
const seasonRecords = () => Object.values(getDefaultSource().raw.chess).filter((r) => r && r.freePick !== true && r.charId);

test('every authored recruit kit belongs to a 自选候选 record and never shadows a season operator', () => {
  const free = freeRecords();
  const byChar = new Map(free.map((r) => [r.charId, r]));
  assert.equal(CHAR_IDS.length, 78);
  for (const char of CHAR_IDS) {
    const rec = byChar.get(char);
    assert.ok(rec, `${char} is a 自选候选 record`);
    assert.equal(rec.rarity, 6, `${char} is a six-star`);
    assert.equal(typeof authored[char], 'function');
  }
  // the charId fallback of kitFn must not be able to hand a season operator a recruit kit
  const seasonChars = new Set(seasonRecords().map((r) => r.charId));
  for (const char of CHAR_IDS) assert.ok(!seasonChars.has(char), `${char} is not used by a season record`);
});

test('each of the 78 ported kits answers for its own record, and 火陈 / 望 keep OUR kits', () => {
  const ds = getDefaultSource();
  let ported = 0;
  for (const char of CHAR_IDS) {
    const f = kitFn(ds.getChess(chessIdOf(char), {}), KITS);
    if (char === 'char_1050_chen3' || char === 'char_2027_wang') {
      // the per-operator decisions (server/sim/content/kits/freePicks.js): our key is tried first, so the ported kit of
      // those two records is unreachable — kept for reference only
      assert.equal(f, KITS[chessIdOf(char)], `${char}: our kits/freePicks.js kit wins`);
      assert.notEqual(f, PORTED_KITS[char]);
      continue;
    }
    assert.equal(f, PORTED_KITS[char], `${char}: the ported kit answers for the record`);
    ported++;
  }
  assert.equal(ported, 76);
});

test('every six-star 自选候选 has a hand-authored kit: the ported 78, or ours in kits/freePicks.js', () => {
  const sixStar = freeRecords().filter((r) => r.rarity === 6);
  assert.equal(sixStar.length, 87);
  const ours = [];
  for (const rec of sixStar) {
    const f = kitFn(getDefaultSource().getChess(rec.chessId, {}), KITS);
    assert.equal(typeof f, 'function', `${rec.name} (${rec.charId}) resolves to a kit`);
    if (!authored[rec.charId]) ours.push([rec.chessId, rec.charId, f === KITS[rec.chessId]]);
  }
  // the 9 精英干员 prototypes: our own kits, keyed by the record's own chess id
  assert.equal(ours.length, 9);
  for (const [chessId, charId, isOurs] of ours) assert.ok(isOurs, `${chessId} uses kits/freePicks.js (${charId})`);
});

test('authored recruits execute all three skills without handler errors (the 234-combination matrix)', () => {
  for (const char of CHAR_IDS)
    for (let s = 0; s < 3; s++) {
      const chessId = chessIdOf(char);
      const h = makeBattle({
        units: [{ chessId, uid: 1, row: 10, col: 5, skillIndex: s }],
        defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1000000, speed: 0, def: 300, res: 30 }) } },
        enemies: [{ key: 'dummy', pos: [10, 6] }],
        autoFinish: false,
        timeLimit: 45,
      });
      h.run(0.1);
      const u = h.unit(chessId);
      assert.ok(u, `${chessId} S${s + 1} deployed`);
      // the kit must answer for the SELECTED skill id (the alias trap: a kit built from the default record's skill).
      // 火陈 is our own deliberate exception: kits/freePicks.js authors S3 (剑气长龙) only and lets S1/S2 fall back to
      // the generic decoder (see that entry) — so its spec source is 'generic' for the first two skills.
      const selected = u.def.skill.id;
      const source = char === 'char_1050_chen3' && s < 2 ? 'generic' : 'skills';
      assert.equal(u.kit.skillSource, source, `${chessId} S${s + 1}`);
      if (source === 'skills') {
        assert.ok(Object.prototype.hasOwnProperty.call(u.kit.skills, selected), `${chessId} S${s + 1} authors ${selected}`);
        // a seeded spec carries the decoder's `id`; a kit that authors a bare spec (傀影's passive) legitimately has none
        if (u.kit.skill.id != null) assert.equal(u.kit.skill.id, selected, `${chessId} S${s + 1} spec id`);
      }
      u.skill.activate('test', { free: true });
      h.run(45);
      assert.deepEqual(h.b.errors, [], `${chessId} S${s + 1}`);
      assert.ok(Number.isFinite(u.hp));
      for (const a of h.b.allyUnits)
        for (const key of ['atk', 'def', 'maxHp', 'interval'])
          assert.ok(Number.isFinite(a.s[key]), `${chessId} ${a.name} ${key}`);
    }
});

test('all produced recruit tokens survive casts, owner death and redeploy without handler errors', () => {
  for (const char of CHAR_IDS)
    for (let s = 0; s < 3; s++) {
      const chessId = chessIdOf(char);
      const h = makeBattle({
        units: [{ chessId, uid: 1, row: 10, col: 5, skillIndex: s }],
        defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1000000, speed: 0 }) } },
        autoFinish: false,
        timeLimit: 120,
      });
      h.run(0.1);
      const b = h.b;
      const u = h.unit(chessId);
      let index = 0;
      for (const entry of u.def.tokens ?? []) {
        const token = typeof entry === 'string' ? entry : entry.tokenId;
        if (!b.producesToken(u, token)) continue;
        b.spawnToken(u, token, 10 + Math.floor(index / 3), 6 + (index % 3));
        index++;
      }
      if (!index) continue;
      h.spawn('dummy', { pos: [10, 7] });
      h.run(0.1);
      u.skill.activate('test', { free: true });
      h.run(25);
      b.retreat(u, { reason: 'retreat' });
      h.run(1);
      b.redeploy(u, { free: true });
      h.run(2);
      assert.deepEqual(b.errors, [], `${char} S${s + 1}`);
      for (const a of b.allyUnits)
        for (const key of ['atk', 'def', 'maxHp', 'interval'])
          assert.ok(Number.isFinite(a.s[key]), `${char} ${a.name} ${key}`);
    }
});

test('recruit area effects obey upstream stealth and untargetable rules', () => {
  const { h, b, u } = setup('char_003_kalts', 0);
  const e = h.spawn('dummy', { pos: [10, 7] });
  e.s.flags.stealth = true;
  const hp = e.hp;
  area(b, u, e, 1, 1);
  assert.equal(e.hp, hp);
  e.s.flags.reveal = true;
  area(b, u, e, 1, 1);
  assert.ok(e.hp < hp);
  const revealedHp = e.hp;
  e.s.flags.untargetable = true;
  area(b, u, e, 1, 1);
  assert.equal(e.hp, revealedHp);
});

/** A battle with one 自选候选 at (10,5) on the synthetic flat stage, plus a 1e6 HP dummy for the kits that need one. */
function setup(char, skillIndex, { tokens = [], enemies = [], ...opts } = {}) {
  const chessId = chessIdOf(char);
  const h = makeBattle({
    units: [{ chessId, uid: 1, row: 10, col: 5, skillIndex }, ...tokens],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1000000, speed: 0, def: 300, res: 30 }) } },
    enemies,
    autoFinish: false,
    timeLimit: 120,
    ...opts,
  });
  h.run(0.1);
  return { h, b: h.b, u: h.unit(chessId) };
}

test('Mon3tr S3 changes summon damage, decays ATK, and costs summon HP when no kill', () => {
  const { h, b, u } = setup('char_003_kalts', 2, {
    tokens: [{ kind: 'token', tokenId: 'token_10002_kalts_mon3tr', uid: 2, ownerUid: 1, row: 10, col: 6 }],
  });
  const m = b.allyUnits.find((a) => a.ownerUnit === u);
  assert.ok(m?.deployed);
  u.skill.activate('test', { free: true });
  h.run(0.2);
  const start = m.s.atk;
  h.run(8);
  assert.ok(m.s.atk < start);
  const e = h.spawn('dummy', { pos: [10, 7] });
  const before = e.hp;
  b.dealDamage(m, e, { amount: 100, type: 'phys', isAttack: true });
  assert.equal(before - e.hp, 100, 'true damage ignores DEF and RES');
  const hp = m.hp;
  u.skill.end('manual');
  assert.equal(m.hp, hp - m.s.maxHp * 0.5);
  assert.equal(u.s.atk, u.base.atk, 'summon ATK is not applied to the healer');
});

test('Mon3tr out of healer range has zero DEF; 凯尔希 S2/S3 charge like any skill (our reading, see the kit)', () => {
  const { h, b, u } = setup('char_003_kalts', 1);
  h.run(2);
  // [our modification — GPL §5] the port left the kit zeroing time-based SP and overriding the trigger while no Mon3tr
  // was out; the record says `spType INCREASE_WITH_TIME` + `trigger.rule DEFAULT` for all three skills, and the project's
  // healer audit pins that a 医师's skills are castable without a summon (test/sim/feedback1e-healers.test.js)
  assert.ok(u.skill.sp > 0, 'S2 charges without a Mon3tr');
  const m = b.spawnToken(u, 'token_10002_kalts_mon3tr', 12, 3);
  h.run(0.2);
  assert.equal(m.s.def, 0);
  b.relocate(m, 10, 6);
  h.run(0.2);
  assert.ok(m.s.def > 0);
});

test('Chen S2 deals separate physical and arts hits to each target', () => {
  const { h, b, u } = setup('char_010_chen', 1);
  const e = h.spawn('dummy', { pos: [10, 6] });
  h.run(0.1);
  const before = e.hp;
  const atk = u.s.atk,
    scale = u.def.skill.bb.atk_scale;
  u.skill.activate('test', { free: true });
  assert.ok(Math.abs(before - e.hp - (atk * scale - e.s.def + atk * scale * 0.7)) < 0.001);
  assert.deepEqual(b.errors, []);
});

test('Phantom mirror receives the selected skill and independently spends S2 stacks', () => {
  const { h, b, u } = setup('char_250_phatom', 1, {
    tokens: [{ kind: 'token', tokenId: 'token_10007_phatom_twin', ownerUid: 1, uid: 2, row: 10, col: 6 }],
  });
  const twin = b.allyUnits.find((a) => a.ownerUnit === u);
  const stacks = u.trait.phantomStacks;
  assert.equal(twin.trait.phantomStacks, stacks);
  b.emit('attack', { attacker: twin, targets: [], isSkill: false });
  assert.equal(twin.trait.phantomStacks, stacks - 1);
  assert.equal(u.trait.phantomStacks, stacks);
  assert.deepEqual(b.errors, []);
});

test('Magallan S3 buffs her selected drone and recalls it on skill end', () => {
  const { b, u, h } = setup('char_248_mgllan', 2, {
    tokens: [{ kind: 'token', tokenId: 'token_10005_mgllan_drone3', ownerUid: 1, uid: 2, row: 10, col: 6 }],
  });
  const drone = b.allyUnits.find((a) => a.ownerUnit === u);
  const before = drone.s.atk;
  const scale = u.def.skill.bb.atk; // our record: 0.8 — the drone gains the skill's ATK percentage, not a factor of 2
  u.skill.activate('test', { free: true });
  h.run(0.2);
  assert.ok(Math.abs(drone.s.atk - before * (1 + scale)) < 1e-6);
  u.skill.end('manual');
  assert.equal(drone.deployed, false);
  assert.deepEqual(b.errors, []);
});

test('Thorns S3 second activation doubles the modifiers and becomes endless', () => {
  const { b, u, h } = setup('char_293_thorns', 2);
  u.skill.activate('test', { free: true });
  const first = u.s.atk;
  u.skill.end('manual');
  u.skill.activate('test', { free: true });
  assert.equal(u.skill.timeLeft, Infinity);
  assert.ok(u.s.atk > first);
  h.run(40);
  assert.ok(u.skill.active);
  assert.deepEqual(b.errors, []);
});

test('Schwarz S3 guarantees talent critical and applies armor reduction', () => {
  const { b, u, h } = setup('char_340_shwaz', 2);
  const e = h.spawn('dummy', { pos: [10, 6] });
  h.run(0.1);
  u.skill.activate('test', { free: true });
  const hp = e.hp;
  b.dealDamage(u, e, { amount: 1000, type: 'phys', isAttack: true, attackId: 100 });
  assert.ok(e.findBuff('schwarz:armor'));
  assert.ok(hp - e.hp > 1000);
});

test('Hellagur gains attack speed as HP falls, capped at his talent maximum', () => {
  const { u, h } = setup('char_188_helage', 1);
  h.run(0.2);
  const before = u.s.aspd;
  u.hp = u.s.maxHp * 0.4;
  h.run(0.1);
  const low = u.s.aspd;
  assert.ok(low > before);
  u.hp = u.s.maxHp * 0.1;
  h.run(0.1);
  assert.equal(u.s.aspd, low);
});

test('Lin barrier negates small hits and breaks on a larger hit', () => {
  const { b, u } = setup('char_4080_lin', 0);
  const hp = u.hp;
  b.dealDamage(null, u, { amount: 100, type: 'true' });
  assert.equal(u.hp, hp);
  b.dealDamage(null, u, { amount: 300, type: 'true' });
  assert.equal(u.hp, hp - 300);
  b.dealDamage(null, u, { amount: 100, type: 'true' });
  assert.equal(u.hp, hp - 400, 'broken barrier no longer cancels damage');
});

test('Nian starts with three hit shields and gains stats as each breaks', () => {
  const { b, u } = setup('char_2014_nian', 0);
  const hp = u.hp,
    atk = u.s.atk;
  for (let i = 0; i < 3; i++) b.dealDamage(null, u, { amount: 100, type: 'true' });
  assert.equal(u.hp, hp);
  assert.ok(u.s.atk > atk);
  b.dealDamage(null, u, { amount: 100, type: 'true' });
  assert.equal(u.hp, hp - 100);
});

test('Necras can damage its sleeping S2 targets and raises a servant on a nearby kill', () => {
  const { b, u, h } = setup('char_450_necras', 1, { enemies: [{ key: 'dummy', pos: [10, 6] }] });
  const e = h.enemies()[0];
  u.skill.activate('test', { free: true });
  assert.ok(e.s.flags.sleep);
  const hp = e.hp;
  h.run(1);
  assert.ok(e.hp < hp, 'sleep must not swallow its own skill damage');
  b.loseHp(e, e.hp, { source: u });
  assert.ok(b.allyUnits.some((a) => a.ownerUnit === u && a.alive));
  assert.deepEqual(b.errors, []);
});

test('Ling S3 merges two adjacent dragons and grants owner farewell talent', () => {
  const { b, u } = setup('char_2023_ling', 2);
  const first = b.spawnToken(u, 'token_10020_ling_soul3', 10, 6);
  assert.ok(first);
  const second = b.spawnToken(u, 'token_10020_ling_soul3', 10, 5);
  assert.equal(second, null, 'cannot overwrite the owner');
  const merged = b.spawnToken(u, 'token_10020_ling_soul3', 10, 7, { dir: 'LEFT' });
  assert.ok(merged.trait.lingGreater);
  assert.equal(first.alive, false);
  assert.ok(u.findBuff('ling:farewell'));
  assert.equal(merged.profile.dmgType, 'arts');
});

test('Dorothy S2 trap binds a lone enemy and increases the owner attack', () => {
  const { b, u, h } = setup('char_4048_doroth', 1);
  const atk = u.s.atk;
  const mine = b.spawnToken(u, 'token_10025_doroth_recttp', 10, 7);
  const e = h.spawn('dummy', { pos: [10, 7] });
  h.run(0.3);
  assert.equal(mine.alive, false);
  assert.ok(e.s.flags.bind);
  assert.ok(u.s.atk > atk);
  assert.deepEqual(b.errors, []);
});

test('Marcille spends finite mana, never passively recovers while deployed', () => {
  const { u, h } = setup('char_4141_marcil', 0);
  const mana = u.trait.mana;
  h.run(3);
  assert.equal(u.trait.mana, mana);
  u.skill.activate('test', { free: true });
  for (let i = 0; i < 100; i++) if (u.skill.active) u.skill.onAttackPerformed([], true);
  assert.equal(u.skill.active, false);
  assert.ok(u.trait.mana >= 0 && u.trait.mana < 2);
});
