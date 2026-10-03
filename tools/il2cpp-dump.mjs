#!/usr/bin/env node
// tools/il2cpp-dump.mjs — (re)build the IL2CPP metadata cache in .cache/il2cpp/ from the local official client.
//
//   node tools/il2cpp-dump.mjs                     # auto-detect the client, dump into .cache/il2cpp/dump
//   node tools/il2cpp-dump.mjs --game "D:\...\Arknights Game"
//   node tools/il2cpp-dump.mjs --fetch             # download Il2CppDumper (MIT) into .cache/il2cpp/tool first
//   node tools/il2cpp-dump.mjs --force             # re-dump even when the cache looks current
//
// This is the ONLY script here that touches the game install, and it opens both inputs read-only:
//   <game>/GameAssembly.dll                                   (~214 MB)
//   <game>/Arknights_Data/il2cpp_data/Metadata/global-metadata.dat  (~45 MB)
// Nothing is ever written next to them. Everything lands in .cache/il2cpp/ (git-ignored) and D:\projects\_scratch.
//
// Read the results with tools/il2cpp-enum.mjs. See docs/research/14-il2cpp-metadata.md for scope and licensing.
//
// Why a staging directory: Il2CppDumper.exe is refused write access anywhere inside this git working tree on the
// machine the cache was first built on (`System.UnauthorizedAccessException ... \Stronghold-Protocol\.cache\...\
// dump.cs is denied`, while the same binary writes fine to _scratch/, and PowerShell/Node/cmd all write inside the
// repo happily). Rather than depend on that, we always dump into a temp dir and copy the artifacts in.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, c, mark, findClient } from './setup.mjs';
import { rebuildEnumIndex } from './il2cpp-enum.mjs';

const DUMPER_VERSION = 'v6.7.46';
const DUMPER_REPO = 'Perfare/Il2CppDumper';
const DUMPER_ASSET = `Il2CppDumper-win-${DUMPER_VERSION}.zip`;
const DEFAULT_TOOL = path.join(ROOT, '.cache', 'il2cpp', 'tool', 'Il2CppDumper');
const DEFAULT_OUT = path.join(ROOT, '.cache', 'il2cpp', 'dump');

const HELP = `node tools/il2cpp-dump.mjs [options]  —  rebuild the IL2CPP dump cache (game files are opened read-only)

  --game <dir>     game root (the one holding GameAssembly.dll) or its AssetBundle root
                   default: the first installed client tools/setup.mjs finds
  --dumper <dir>   Il2CppDumper directory (default ${DEFAULT_TOOL})
  --out <dir>      where the artifacts go (default ${DEFAULT_OUT})
  --stage <dir>    scratch dir the dumper writes into first (default %TEMP%/${'sp-il2cpp-<pid>'})
  --fetch          download ${DUMPER_ASSET} from ${DUMPER_REPO} into the tool dir (needs gh or curl)
  --force          re-dump even when the cache is already current
  -h, --help

Exit codes: 0 ok · 1 could not dump · 2 usage/argument error.`;

function parseArgs(argv) {
  const o = { out: DEFAULT_OUT, tool: DEFAULT_TOOL, fetch: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const [k, inline] = argv[i].split('=');
    const val = () => (inline !== undefined ? inline : argv[++i]);
    if (k === '--game') o.game = val();
    else if (k === '--dumper') o.tool = path.resolve(val());
    else if (k === '--out') o.out = path.resolve(val());
    else if (k === '--stage') o.stage = path.resolve(val());
    else if (k === '--fetch') o.fetch = true;
    else if (k === '--force') o.force = true;
    else if (k === '-h' || k === '--help') o.help = true;
    else throw new Error(`unknown option ${argv[i]}\n${HELP}`);
  }
  return o;
}

const META_TAIL = ['Arknights_Data', 'il2cpp_data', 'Metadata', 'global-metadata.dat'];

/** Accept the game root (holds GameAssembly.dll) or the AB root tools/*.mjs take, and return the game root. */
function resolveGameRoot(dir) {
  const looksRight = (root) => fs.existsSync(path.join(root, 'GameAssembly.dll'))
    && fs.existsSync(path.join(root, ...META_TAIL));
  if (looksRight(dir)) return dir;
  // …/Arknights_Data/StreamingAssets/AB/Windows  →  four levels up
  const up = path.resolve(dir, '..', '..', '..', '..');
  if (looksRight(up)) return up;
  return null;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/** The client's own build markers, for the provenance record. */
function clientBuild(gameRoot) {
  const hot = path.join(gameRoot, 'Arknights_Data', 'StreamingAssets', 'AB', 'Windows', 'hot_update_list.json');
  const out = {};
  try {
    const j = JSON.parse(fs.readFileSync(hot, 'utf8'));
    if (j.versionId) out.dataVersion = j.versionId;
    if (j.manifestVersion) out.manifestVersion = j.manifestVersion;
  } catch { /* not every install has it */ }
  try {
    const unity = path.join(gameRoot, 'UnityPlayer.dll');
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `(Get-Item -LiteralPath '${unity.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8' });
    const v = (r.stdout || '').trim();
    if (v) out.unity = v;
  } catch { /* optional */ }
  return out;
}

function fetchDumper(toolDir) {
  fs.mkdirSync(toolDir, { recursive: true });
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-il2cpp-tool-'));
  const zip = path.join(stage, DUMPER_ASSET);
  const gh = spawnSync('gh', ['release', 'download', DUMPER_VERSION, '--repo', DUMPER_REPO, '--pattern', DUMPER_ASSET, '--dir', stage], { stdio: 'inherit' });
  if (gh.status !== 0) {
    const curl = spawnSync('curl', ['-fL', '--retry', '3', '-o', zip, `https://github.com/${DUMPER_REPO}/releases/download/${DUMPER_VERSION}/${DUMPER_ASSET}`], { stdio: 'inherit' });
    if (curl.status !== 0) {
      throw new Error(`could not download ${DUMPER_ASSET}. Fetch it by hand (needs the project proxy for github.com) and unzip into ${toolDir}:\n  gh release download ${DUMPER_VERSION} --repo ${DUMPER_REPO} --pattern ${DUMPER_ASSET}`);
    }
  }
  // Windows 10+ ships bsdtar, which reads zip archives.
  const un = spawnSync('tar', ['-xf', zip, '-C', toolDir], { stdio: 'inherit' });
  if (un.status !== 0) throw new Error(`could not unpack ${zip} into ${toolDir} (need tar that reads zip)`);
  fs.rmSync(stage, { recursive: true, force: true });
}

/** Il2CppDumper waits for a keypress when config.json says so — never useful in a script. */
function unpauseDumper(toolDir) {
  const cfg = path.join(toolDir, 'config.json');
  if (!fs.existsSync(cfg)) return;
  try {
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    if (j.RequireAnyKey !== false) {
      j.RequireAnyKey = false;
      fs.writeFileSync(cfg, `${JSON.stringify(j, null, 2)}\n`);
    }
  } catch { /* leave an unreadable config alone; the dumper will complain itself */ }
}

function provenance({ gameRoot, exe, hashes, build, out, dumperVersion, copied }) {
  return `# IL2CPP dump provenance (machine-local, git-ignored)

Regenerate with \`node tools/il2cpp-dump.mjs\`; query with \`node tools/il2cpp-enum.mjs\`.
Scope, licensing and the list of things this dump cannot answer: \`docs/research/14-il2cpp-metadata.md\`.

| Item | Value |
|---|---|
| Generated (local time) | ${new Date().toISOString()} |
| Tool | Il2CppDumper ${dumperVersion} (Perfare, MIT) — \`Il2CppDumper-win-${dumperVersion}.zip\`, self-contained win-x64 |
| Tool executable | \`${exe}\` |
| Game root | \`${gameRoot}\` |
| Client data version (\`hot_update_list.json versionId\`) | ${build.dataVersion || '(not found)'} |
| Bundle manifest | ${build.manifestVersion || '(not found)'} |
| Unity | ${build.unity || '(not found)'} |
| Metadata version / IL2CPP version reported by the dumper | 29 / 29 |

Inputs, opened **read-only** (never modified):

| File | SHA-256 |
|---|---|
| \`GameAssembly.dll\` | \`${hashes.dll}\` |
| \`Arknights_Data/il2cpp_data/Metadata/global-metadata.dat\` | \`${hashes.meta}\` |

Command (equivalent to what the script ran):

\`\`\`
${exe} "<game>/GameAssembly.dll" "<game>/Arknights_Data/il2cpp_data/Metadata/global-metadata.dat" <staging dir>
\`\`\`

The dumper wrote into a temp staging directory which was then copied to \`${out}\`
(see the header of tools/il2cpp-dump.mjs: on this machine Il2CppDumper.exe is denied write access inside the git
working tree, while every other process writes there normally).

Artifacts: \`${copied.join('`, `')}\`, plus \`enums.json\` built by \`node tools/il2cpp-enum.mjs --rebuild\`.

Licence: Il2CppDumper is MIT (Copyright (c) 2016 Perfare). It is **not** vendored into the repository — the binary
lives only here, under the git-ignored \`.cache/\`; see THIRD-PARTY-NOTICES.md.
`;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`${mark.err} ${e.message}`); return 2; }
  if (o.help) { console.log(HELP); return 0; }

  if (o.fetch) {
    try { fetchDumper(o.tool); console.log(`${mark.ok} Il2CppDumper ${DUMPER_VERSION} → ${o.tool}`); }
    catch (e) { console.error(`${mark.err} ${e.message}`); return 1; }
  }
  unpauseDumper(o.tool);

  const exe = path.join(o.tool, 'Il2CppDumper.exe');
  if (!fs.existsSync(exe)) {
    console.error(`${mark.err} no Il2CppDumper.exe in ${o.tool}\n    get it with:  node tools/il2cpp-dump.mjs --fetch`);
    return 1;
  }

  // Locate the client: explicit --game, else the AssetBundle root tools/setup.mjs already knows how to find.
  let gameRoot = o.game ? resolveGameRoot(path.resolve(o.game)) : null;
  let via = '--game';
  if (!gameRoot && !o.game) {
    const client = findClient();
    if (client) { gameRoot = resolveGameRoot(client.path); via = `auto-detected (${client.kind})`; }
  }
  if (!gameRoot) {
    console.error(`${mark.err} could not find the game install${o.game ? ` at ${o.game}` : ''}`);
    console.error(c.dim(`    pass it explicitly:  node tools/il2cpp-dump.mjs --game "<game root with GameAssembly.dll>"`));
    if (o.game) console.error(c.dim(`    (looked for GameAssembly.dll + ${META_TAIL.join('/')})`));
    return 1;
  }

  const dllPath = path.join(gameRoot, 'GameAssembly.dll');
  const metaPath = path.join(gameRoot, ...META_TAIL);
  console.log(c.bold('\nIL2CPP dump') + c.dim(`  ${via} · ${gameRoot}`));

  console.log(`${mark.skip} hashing inputs (read-only)…`);
  const hashes = { dll: sha256(dllPath), meta: sha256(metaPath) };
  console.log(`   GameAssembly.dll   ${c.dim(hashes.dll)}`);
  console.log(`   global-metadata.dat ${c.dim(hashes.meta)}`);

  // Already current? (same inputs, dump.cs present)
  const stamp = path.join(o.out, '.input-hashes.json');
  if (!o.force && fs.existsSync(stamp) && fs.existsSync(path.join(o.out, 'dump.cs'))) {
    try {
      if (JSON.stringify(JSON.parse(fs.readFileSync(stamp, 'utf8'))) === JSON.stringify(hashes)) {
        console.log(`${mark.ok} cache is already current for these inputs — nothing to do (use --force to re-dump)`);
        return 0;
      }
    } catch { /* fall through and re-dump */ }
  }

  const stage = o.stage || fs.mkdtempSync(path.join(os.tmpdir(), 'sp-il2cpp-'));
  fs.mkdirSync(stage, { recursive: true });
  console.log(`${mark.skip} dumping with ${path.basename(exe)} → ${stage}`);
  const t0 = Date.now();
  const run = spawnSync(exe, [dllPath, metaPath, stage], { stdio: 'inherit' });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const produced = fs.readdirSync(stage);
  if (run.status !== 0 || !produced.includes('dump.cs')) {
    console.error(`${mark.err} the dumper failed after ${secs}s (exit ${run.status}); staged files: ${produced.join(', ') || '(none)'}`);
    if (o.stage === undefined) fs.rmSync(stage, { recursive: true, force: true });
    return 1;
  }

  console.log(`${mark.ok} dumped in ${secs}s — copying into ${o.out}`);
  fs.mkdirSync(o.out, { recursive: true });
  for (const name of produced) {
    fs.cpSync(path.join(stage, name), path.join(o.out, name), { recursive: true, force: true });
  }
  if (o.stage === undefined) fs.rmSync(stage, { recursive: true, force: true });

  const build = clientBuild(gameRoot);
  fs.writeFileSync(stamp, `${JSON.stringify(hashes, null, 2)}\n`);
  fs.writeFileSync(path.join(path.dirname(o.out), 'PROVENANCE.md'),
    provenance({ gameRoot, exe, hashes, build, out: o.out, dumperVersion: DUMPER_VERSION, copied: produced }));

  const index = await rebuildEnumIndex(o.out);
  console.log(`${mark.ok} ${index.enumCount} enums / ${index.memberCount} literals → ${path.relative(ROOT, index.target)}`);
  console.log(`${mark.ok} provenance → ${path.relative(ROOT, path.join(path.dirname(o.out), 'PROVENANCE.md'))}`);
  console.log(c.dim(`\n   try:  node tools/il2cpp-enum.mjs AdvancedMovement.MoveType --value 4`));
  return 0;
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.error(`${mark.err} il2cpp-dump: ${e?.stack || e}`);
    process.exitCode = 1;
  });
}
