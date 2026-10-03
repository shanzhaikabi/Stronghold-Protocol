// public/js/ui/buildGuard.js — the "this page is running an outdated build" guard (2026-10-03).
//
// WHY: every module a page imports lives in its module map for the whole page lifetime, so a deploy can never reach
// an already-open tab — not even a client-only one, which is served `Cache-Control: no-cache` and would be picked up
// by a reload. The 自选干员 battle fix (simdata.js freePicks merge + runner.js SIM_DATA_FILES) shipped exactly that
// way and stayed invisible on the reporting player's iOS page: the nginx log shows the page loaded the PRE-fix
// `/sim/simdata.js` (gzip 10931 = the pre-fix blob) and then made no module request at all for the rest of the
// session, so the battle kept dropping their 自选干员 as "unknown chess".
//
// HOW: the server stamps a short hash of the runtime it is serving into `/healthz.build` (server/index.js
// computeBuildTag). The first successful check of a page records that tag as "the build this page runs" (a page load
// revalidates every module — they are served `no-cache` — so the two agree); any later check that sees a DIFFERENT
// tag means the server changed under this page, and the page reloads itself once — deferred while a battle is on
// screen, so a live field is never thrown away.
//
// Kept dependency-free and injectable (fetch / storage / reload) so test/ui/buildGuard.test.js can drive it.

/** sessionStorage key: the build tag this page loaded with. */
export const BUILD_KEY = 'sp.build';
/** How often a page re-asks the server for its build tag. */
export const BUILD_CHECK_MS = 60_000;
/** Phases in which a reload would throw away a running battle (the guard waits for them to end). */
export const BATTLE_PHASES = Object.freeze(['COMBAT', 'FINAL_ASSAULT', 'HIDDEN_CORE', 'UNITE']);

/** Is `phase` a phase with a battle on screen? */
export const isBattlePhase = (phase) => BATTLE_PHASES.includes(String(phase ?? ''));

/** fetch `/healthz` and return its `build` tag (null when unavailable / not reported). Never throws. */
export async function fetchBuild(fetchFn) {
  try {
    const res = await fetchFn('/healthz', { cache: 'no-store' });
    if (!res || !res.ok) return null;
    const body = await res.json();
    return body && typeof body.build === 'string' && body.build ? body.build : null;
  } catch { return null; }
}

function readKey(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}
function writeKey(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* private mode */ }
}

/**
 * One check.
 * @param {{ fetchFn?: Function, storage?: any, reload?: Function, key?: string }} [o]
 * @returns {Promise<{ status: 'first'|'current'|'stale'|'unknown', build: string|null, was?: string|null }>}
 */
export async function checkBuildOnce(o = {}) {
  const fetchFn = o.fetchFn || ((url, init) => globalThis.fetch(url, init));
  const key = o.key || BUILD_KEY;
  const build = await fetchBuild(fetchFn);
  if (!build) return { status: 'unknown', build: null };
  const was = readKey(o.storage, key);
  if (!was) { writeKey(o.storage, key, build); return { status: 'first', build }; }
  if (was === build) return { status: 'current', build };
  writeKey(o.storage, key, build);
  return { status: 'stale', build, was };
}

/**
 * Watch for a new build. Reloads once when one appears — immediately while nothing is fought, and as soon as the
 * battle on screen ends otherwise.
 * @param {{ fetchFn?: Function, storage?: any, reload?: Function, isBusy?: () => boolean, intervalMs?: number,
 *           setInterval?: Function, clearInterval?: Function, onStale?: (info: object) => void, key?: string }} [o]
 * @returns {{ stop: () => void, check: () => Promise<object>, stale: () => boolean }}
 */
export function startBuildGuard(o = {}) {
  const storage = o.storage !== undefined ? o.storage : (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const reload = o.reload || (() => globalThis.location.reload());
  const isBusy = typeof o.isBusy === 'function' ? o.isBusy : () => false;
  const setIv = o.setInterval || ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearIv = o.clearInterval || ((h) => globalThis.clearInterval(h));
  const intervalMs = Number.isFinite(o.intervalMs) && o.intervalMs > 0 ? o.intervalMs : BUILD_CHECK_MS;
  let stale = false;
  let pending = false;
  let timer = null;
  let stopped = false;

  const reloadNow = () => { stopped = true; if (timer != null) { clearIv(timer); timer = null; } reload(); };

  const check = async () => {
    if (stopped) return { status: 'stopped', build: null };
    if (pending) return { status: 'pending', build: null };
    pending = true;
    let r;
    try { r = await checkBuildOnce({ fetchFn: o.fetchFn, storage, key: o.key }); }
    finally { pending = false; }
    if (r.status === 'stale') {
      stale = true;
      try { o.onStale?.(r); } catch { /* ignore */ }
      // a battle on screen: keep it, reload when the field is over (the next interval re-checks isBusy)
      if (!isBusy()) reloadNow();
    } else if (stale && !isBusy()) {
      reloadNow();
    }
    return r;
  };

  const tick = () => { check().catch(() => {}); };
  check().catch(() => {});
  timer = setIv(tick, intervalMs);
  return { stop: () => { stopped = true; if (timer != null) { clearIv(timer); timer = null; } }, check, stale: () => stale };
}
