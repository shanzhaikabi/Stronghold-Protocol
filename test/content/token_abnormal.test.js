// tokens.json `abnormal` — the 异常效果 a summon holds from the start (PRTS 召唤物 pages, 备注 "持有…"; user playtest #6
// item 18). Batch 1 of the missing-implementations programme: the hand table in tools/build-data.mjs covered only the
// season's 10 summons + 炎佑, so all 37 自选干员 token records shipped `abnormal: []` although 30 of them carry a 持有
// note on PRTS — 28 禁疗 and 6 孤立, i.e. expressible with the engine vocabulary that already exists
// (Battle._setupUnit: healFree → noHeal, isolated → isolated + noHeal).
//
// The flags now come from docs/research/13-token-abnormal.json (PRTS, `source` + `checkedAt`), which records for every
// summon: the quoted 备注 持有 segment, the effects applied (`holds` → `effects` → a token flag), the effects PRTS names
// but this pipeline cannot express (`unexpressed`, each with a reason in `unexpressible`), and the ones merely mentioned
// (`mentions`). These tests pin (1) data ↔ research agreement, (2) real examples across different owners, (3) that no
// dead key can be written, (4) that the season is unchanged, and (5) the coverage split.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const TOKENS = read('data/tokens.json');
const RESEARCH = read('docs/research/13-token-abnormal.json');
const BUILD_DATA = readFileSync(join(ROOT, 'tools', 'build-data.mjs'), 'utf8');
const REAL = { skip: !hasGeneratedData() };
const raw = (id) => getDefaultSource().rawToken(id);

/** The research file's flags for one token: its held effects mapped through `effects`, in order. */
const researchFlags = (id) => {
  const e = RESEARCH.tokens[id];
  if (!e) return null;
  return [...new Set((e.holds || []).map((n) => RESEARCH.effects[n]))];
};
const summons = () => Object.values(TOKENS).filter((t) => t.kind === 'summon' || t.kind === 'bondSummon');

test('13-token-abnormal: every summon in data/tokens.json matches the PRTS research file (data ↔ research)', REAL, () => {
  const ids = summons().map((t) => t.tokenId);
  assert.ok(ids.length > 50, `summons: ${ids.length}`);
  for (const id of ids) {
    const e = RESEARCH.tokens[id];
    assert.ok(e, `${id} (${TOKENS[id].name}) has no docs/research/13-token-abnormal.json entry`);
    assert.equal(e.page, e.page?.trim(), `${id}: page name`);
    assert.deepEqual(TOKENS[id].abnormal, researchFlags(id), `${id} (${TOKENS[id].name}, PRTS 备注 "${e.quote}"): data flags vs research`);
    // the sim's own normalisation carries the same list (simdata.js normalizeToken → def.abnormal)
    assert.deepEqual(raw(id).abnormal, researchFlags(id), `${id}: DataSource.rawToken().abnormal`);
  }
  // …and the other way round: the research file holds no token this build does not emit (a silent no-op)
  for (const id of Object.keys(RESEARCH.tokens)) assert.ok(TOKENS[id], `13-token-abnormal: ${id} is not a token of this build`);
});

test('13-token-abnormal: real PRTS examples across different owners (龙腾.F 禁疗, 令 禁疗, 贝洛内 孤立, 酒神/谬因 禁疗+孤立)', REAL, () => {
  // 龙腾.F (麦哲伦) — PRTS 龙腾.F 备注 "※持有{{异常效果|禁疗}}。" (its 缴械 is commented out on the wiki)
  assert.equal(TOKENS.token_10005_mgllan_drone1.name, '龙腾.F');
  assert.deepEqual(TOKENS.token_10005_mgllan_drone1.abnormal, ['healFree']);
  assert.deepEqual(raw('token_10005_mgllan_drone1').abnormal, ['healFree']);
  assert.equal(RESEARCH.tokens.token_10005_mgllan_drone1.owner, '麦哲伦');
  // 令's three souls — PRTS “清平”/“逍遥”/“弦惊” 备注 "※持有{{异常效果|禁疗}}"
  for (const [id, name] of [['token_10020_ling_soul1', '“清平”'], ['token_10020_ling_soul2', '“逍遥”'], ['token_10020_ling_soul3', '“弦惊”']]) {
    assert.equal(TOKENS[id].name, name);
    assert.deepEqual(TOKENS[id].abnormal, ['healFree'], id);
  }
  // 牵绊 (贝洛内) — PRTS "※持有{{异常效果|无敌}}、{{异常效果|孤立}}、…": 无敌 is not expressible, 孤立 is (but NOT 禁疗)
  assert.equal(TOKENS.token_10065_demetr_dmtpos.name, '牵绊');
  assert.deepEqual(TOKENS.token_10065_demetr_dmtpos.abnormal, ['isolated']);
  // 迷狂牢笼 (酒神) / 中继器 (谬因) / 铁钳号·原型机 (白铁) — PRTS 禁疗 + 孤立
  assert.deepEqual(TOKENS.token_10055_phatm2_mndclv.abnormal, ['healFree', 'isolated']);
  assert.deepEqual(TOKENS.token_10070_aphris_pc.abnormal, ['healFree', 'isolated']);
  assert.deepEqual(TOKENS.token_10027_ironmn_pile3.abnormal, ['healFree', 'isolated']);
  // 重构体 (Mon3tr) — the 通常形态 (the manually deployed form the sim models) holds 禁疗 + 不可阻挡; 孤立 belongs to the
  // 路标形态 only, which is not modelled, so it must NOT be applied (PRTS lists it in the 路标形态 bullet, not 持有)
  assert.deepEqual(TOKENS.token_10050_monstr_prosts.abnormal, ['healFree']);
  assert.ok(RESEARCH.tokens.token_10050_monstr_prosts.mentions['孤立'], '路标形态 孤立 is recorded as a mention, not held');
  // 从不混淆的方向 (乌尔比安) — the season's 孤立 token keeps its flag (byte-identical, see the season test)
  assert.deepEqual(TOKENS.token_10039_ulpia_block.abnormal, ['isolated']);
});

test('13-token-abnormal: the flags are exactly the vocabulary Battle._setupUnit reads — no dead key can be written', REAL, () => {
  // the engine side: Battle._setupUnit maps `abnormal` entries to flags (healFree → noHeal, isolated → isolated + noHeal)
  const battleSrc = readFileSync(join(ROOT, 'server', 'sim', 'Battle.js'), 'utf8');
  const engineFlags = [...battleSrc.matchAll(/ab\.includes\('([^']+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(engineFlags, ['healFree', 'isolated'], 'Battle._setupUnit reads exactly these two abnormal effects');
  // the data side: nothing outside that set, and the research file cannot map an effect to something else
  for (const t of summons()) for (const f of t.abnormal) assert.ok(engineFlags.includes(f), `${t.tokenId}: dead key ${f}`);
  for (const [name, flag] of Object.entries(RESEARCH.effects)) assert.ok(engineFlags.includes(flag), `research effect ${name} → ${flag}`);
  // every effect the pipeline cannot express is recorded with a reason instead of being written as a flag
  for (const [id, e] of Object.entries(RESEARCH.tokens)) {
    for (const n of e.unexpressed || []) {
      assert.ok(RESEARCH.unexpressible[n], `${id}: unexpressed ${n} has no reason in unexpressible`);
      assert.ok(!(e.holds || []).includes(n), `${id}: ${n} is both held and unexpressed`);
    }
  }
  // …and the build asserts the same contract (unknown flag / unmapped effect / season drift → integrity error)
  assert.match(BUILD_DATA, /TOKEN_ABNORMAL_FLAGS = Object\.freeze\(\['healFree', 'isolated'\]\)/);
  assert.match(BUILD_DATA, /13-token-abnormal: \$\{name\} maps to unknown flag/);
  assert.match(BUILD_DATA, /13-token-abnormal: \$\{id\} \(in the season fallback table\) is missing/);
});

test('13-token-abnormal: the season\'s 11 flagged summon records are unchanged (the fallback table == the research file)', REAL, () => {
  const season = {
    token_10015_dusk_drgn: ['healFree'], token_10019_nearl2_sword: ['healFree'], token_10017_skadi2_dedant: ['healFree'],
    token_10011_beewax_oblisk: ['healFree'], token_10030_mlyss_wtrman: ['healFree'], token_10028_vigil_wolf: ['healFree'],
    token_10012_rosmon_shield: ['healFree'], token_10040_siege2_vlion: ['healFree'], token_10058_sbell2_icetgt: ['healFree'],
    token_10039_ulpia_block: ['isolated'], enemy_9012_acloon: ['isolated'],
  };
  for (const [id, flags] of Object.entries(season)) {
    assert.deepEqual(TOKENS[id].abnormal, flags, `${id} (${TOKENS[id].name})`);
    assert.deepEqual(researchFlags(id), flags, `${id}: the research file must reproduce the hand table`);
  }
  // the 9 season summons PRTS gives no 持有 note keep an empty list (医疗探机 / 诅咒娃娃 / 纸偶 / 香槟炸弹 / 爬行号 / 投递坐标 /
  // 风雪之眼 ×3 — 投递坐标 holds only 无敌 + 不可阻挡, neither expressible)
  for (const id of ['token_10000_silent_healrb', 'token_10006_vodfox_doll', 'token_10022_kazema_shadow', 'token_10031_swire2_gdtrap',
    'token_10041_cathy_catsld', 'token_10056_angel2_target', 'token_10057_svash2_eagle1', 'token_10057_svash2_eagle2', 'token_10057_svash2_eagle3']) {
    assert.deepEqual(TOKENS[id].abnormal, [], id);
  }
  // the hand table survives in the build as the no-research fallback, with exactly these ids
  const fallback = BUILD_DATA.slice(BUILD_DATA.indexOf('const TOKEN_ABNORMAL_FALLBACK'), BUILD_DATA.indexOf('const TOKEN_ABNORMAL_FLAGS'));
  for (const id of Object.keys(season)) assert.ok(fallback.includes(`${id}:`), `TOKEN_ABNORMAL_FALLBACK: ${id}`);
  assert.equal([...fallback.matchAll(/\n  ([a-z_0-9]+): \[/g)].length, 11, 'the fallback holds exactly the season\'s 11 ids');
});

test('13-token-abnormal: coverage — 30 of the 37 自选干员 summons now carry a flag, 7 genuinely have none', REAL, () => {
  const free = summons().filter((t) => (t.owners || []).some((o) => o.startsWith('chess_free_')));
  assert.equal(free.length, 37, '自选干员 token records');
  const flagged = free.filter((t) => t.abnormal.length);
  assert.equal(flagged.length, 30);
  // the 7 whose PRTS page carries no 持有 note at all (or only 无敌): 共振装置 / “打字机” / 夜灯 / 雷鸣地雷 / 本能的召唤 /
  // 棋子 / 战术锚点 — every one of them is a PRTS `quote: ""` or a 无敌-only entry in the research file
  const none = free.filter((t) => !t.abnormal.length).map((t) => t.tokenId).sort();
  assert.deepEqual(none, ['token_10025_doroth_recttp', 'token_10026_bgsnow_subbow', 'token_10029_slent2_protrb', 'token_10033_ela_grzmot',
    'token_10054_phatm2_encdool', 'token_10064_wang_stone1', 'token_10068_kalts2_mtship']);
  assert.deepEqual(RESEARCH.tokens.token_10068_kalts2_mtship.holds, [], '战术锚点 holds 无敌 only');
  assert.deepEqual(RESEARCH.tokens.token_10068_kalts2_mtship.unexpressed, ['无敌']);
  // 禁疗 vs 孤立 among the 30 (从不混淆的方向, the season's other 孤立 token, is not a 自选干员 summon)
  assert.equal(flagged.filter((t) => t.abnormal.includes('healFree')).length, 28);
  assert.equal(flagged.filter((t) => t.abnormal.includes('isolated')).length, 5);
});
