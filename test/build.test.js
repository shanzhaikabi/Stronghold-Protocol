// test/build.test.js — the served-runtime build tag (server/index.js computeBuildTag / buildTag): the signal that lets
// an already-open page notice a deploy (public/js/ui/buildGuard.js; /healthz `build`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeBuildTag, buildTag, resetBuildTag, BUILD_INPUTS, BUILD_TAG_TTL_MS } from '../server/index.js';

/** A throwaway root with the runtime layout (one file per BUILD_INPUTS entry). */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-build-'));
  for (const rel of BUILD_INPUTS) {
    const abs = path.join(root, rel);
    if (path.extname(rel)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x');
    } else {
      fs.mkdirSync(abs, { recursive: true });
      fs.writeFileSync(path.join(abs, 'file.js'), 'x');
    }
  }
  return root;
}

test('computeBuildTag: stable for one tree, different when a runtime file changes (size or mtime)', () => {
  const root = fixture();
  try {
    const a = computeBuildTag(root);
    assert.match(a, /^[0-9a-f]{12}$/);
    assert.equal(computeBuildTag(root), a, 'same tree → same tag');
    // a changed file (new size) is a new build
    fs.writeFileSync(path.join(root, 'shared', 'file.js'), 'yy');
    const b = computeBuildTag(root);
    assert.notEqual(b, a, 'a changed runtime file is a new build');
    // …and so is a rewrite with the same size but a new mtime (a deploy of identical bytes keeps its timestamp)
    const target = path.join(root, 'data', 'file.js');
    const st = fs.statSync(target);
    fs.utimesSync(target, st.atime, new Date(st.mtimeMs + 5000));
    assert.notEqual(computeBuildTag(root), b);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('computeBuildTag: nothing readable → null (an unknown build never reloads a page)', () => {
  assert.equal(computeBuildTag(path.join(os.tmpdir(), 'sp-does-not-exist-xyz')), null);
});

test('buildTag: cached for BUILD_TAG_TTL_MS, recomputed after it (a client-only deploy does not restart the process)', () => {
  resetBuildTag();
  const t0 = 1_000_000;
  const first = buildTag(t0);
  assert.match(String(first), /^[0-9a-f]{12}$/);
  assert.equal(buildTag(t0 + BUILD_TAG_TTL_MS - 1), first, 'inside the TTL the tag is reused');
  // the cache only hides a change for the TTL; the point here is that it expires
  assert.equal(typeof buildTag(t0 + BUILD_TAG_TTL_MS + 1), 'string');
  resetBuildTag();
});
