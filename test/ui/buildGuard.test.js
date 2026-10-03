// test/ui/buildGuard.test.js — public/js/ui/buildGuard.js: the "this page runs an outdated build" guard that lets a
// deploy reach a tab that was already open (a page keeps its imported ES modules for its whole lifetime — the reason
// the 自选干员 battle fix stayed invisible on the reporting player's iOS page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBuildOnce, startBuildGuard, isBattlePhase, BUILD_KEY } from '../../public/js/ui/buildGuard.js';

/** A fake fetch answering /healthz with `build` (null → the frame carries none). */
const fetchOf = (build) => async (url, init) => {
  assert.equal(url, '/healthz');
  assert.equal(init.cache, 'no-store');
  return { ok: true, status: 200, json: async () => ({ ok: true, build }) };
};
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _map: m };
};

test('checkBuildOnce: records the first build, passes the same one through, fires on a change', async () => {
  const storage = memStorage();
  assert.deepEqual(await checkBuildOnce({ fetchFn: fetchOf('aaa'), storage }), { status: 'first', build: 'aaa' });
  assert.equal(storage.getItem(BUILD_KEY), 'aaa');
  assert.deepEqual(await checkBuildOnce({ fetchFn: fetchOf('aaa'), storage }), { status: 'current', build: 'aaa' });
  assert.deepEqual(await checkBuildOnce({ fetchFn: fetchOf('bbb'), storage }), { status: 'stale', build: 'bbb', was: 'aaa' });
  assert.equal(storage.getItem(BUILD_KEY), 'bbb', 'the new build is recorded before the reload');
  assert.deepEqual(await checkBuildOnce({ fetchFn: fetchOf('bbb'), storage }), { status: 'current', build: 'bbb' });
});

test('checkBuildOnce: an unreachable / version-less /healthz is unknown, never stale', async () => {
  const storage = memStorage();
  const boom = async () => { throw new Error('offline'); };
  assert.deepEqual(await checkBuildOnce({ fetchFn: boom, storage }), { status: 'unknown', build: null });
  assert.deepEqual(await checkBuildOnce({ fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }), storage }), { status: 'unknown', build: null });
  assert.deepEqual(await checkBuildOnce({ fetchFn: fetchOf(null), storage }), { status: 'unknown', build: null });
  assert.equal(storage.getItem(BUILD_KEY), null, 'nothing recorded');
});

/** A guard driven by hand: run the interval callback on demand. */
function manual() {
  const ticks = [];
  const calls = { reload: 0, stale: [] };
  const storage = memStorage();
  let build = 'aaa';
  let busy = false;
  const guard = startBuildGuard({
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ build }) }),
    storage,
    reload: () => { calls.reload++; },
    isBusy: () => busy,
    setInterval: (fn) => { ticks.push(fn); return ticks.length; },
    clearInterval: () => {},
    onStale: (info) => calls.stale.push(info),
  });
  return {
    calls, storage, ticks,
    setBuild: (b) => { build = b; },
    setBusy: (b) => { busy = b; },
    /** run the interval callback and let its await settle */
    tick: async () => { for (const fn of ticks) fn(); await new Promise((r) => setTimeout(r, 0)); },
    guard,
  };
}

test('startBuildGuard: reloads once when the server build changes, and again only on a new build', async () => {
  const m = manual();
  await new Promise((r) => setTimeout(r, 0));       // the immediate first check
  assert.equal(m.storage.getItem(BUILD_KEY), 'aaa');
  assert.equal(m.calls.reload, 0);
  await m.tick();
  assert.equal(m.calls.reload, 0, 'same build → no reload');
  m.setBuild('bbb');
  await m.tick();
  assert.equal(m.calls.reload, 1, 'a new build reloads the page');
  assert.deepEqual(m.calls.stale.map((s) => s.build), ['bbb']);
  await m.tick();
  assert.equal(m.calls.reload, 1, 'the recorded build settles (the reload would load the new code)');
});

test('startBuildGuard: a running battle is never thrown away — the reload waits for the field to end', async () => {
  const m = manual();
  await new Promise((r) => setTimeout(r, 0));
  m.setBusy(true);
  m.setBuild('bbb');
  await m.tick();
  assert.equal(m.calls.reload, 0, 'busy: the battle is kept');
  assert.equal(m.guard.stale(), true, 'the staleness is remembered');
  await m.tick();
  assert.equal(m.calls.reload, 0);
  m.setBusy(false);
  await m.tick();
  assert.equal(m.calls.reload, 1, 'once the battle is over the page reloads');
});

test('startBuildGuard: stop() ends the watch; isBattlePhase names the phases with a field on screen', async () => {
  const m = manual();
  await new Promise((r) => setTimeout(r, 0));
  m.guard.stop();
  m.setBuild('bbb');
  await m.tick();
  assert.equal(m.calls.reload, 0);
  for (const p of ['COMBAT', 'FINAL_ASSAULT', 'HIDDEN_CORE', 'UNITE']) assert.equal(isBattlePhase(p), true, p);
  for (const p of ['LOBBY', 'PREP', 'INFO_CHECK', null, undefined]) assert.equal(isBattlePhase(p), false, String(p));
});
