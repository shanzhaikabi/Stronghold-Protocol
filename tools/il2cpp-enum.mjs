#!/usr/bin/env node
// tools/il2cpp-enum.mjs — look up C# enum literals in a cached Il2CppDumper dump of the official client.
//
//   node tools/il2cpp-enum.mjs AdvancedMovement.MoveType              # every member of one enum
//   node tools/il2cpp-enum.mjs AdvancedMovement.MoveType --value 4    # 4  → FIXED_DIRECTION
//   node tools/il2cpp-enum.mjs AdvancedMovement.MoveType --name FIXED_DIRECTION
//   node tools/il2cpp-enum.mjs --find FIXED_DIRECTION                 # which enums declare that literal
//   node tools/il2cpp-enum.mjs --search moveType                      # enum type names / literals matching a regex
//   node tools/il2cpp-enum.mjs --list                                 # all 3189 enum type names
//   node tools/il2cpp-enum.mjs --rebuild                              # re-parse dump.cs → enums.json (still read-only)
//
// READ-ONLY: this script never writes to the game install and never re-runs Il2CppDumper. It reads the cache that
// tools/il2cpp-dump.mjs produced (<dump>/enums.json, else <dump>/dump.cs) — see docs/research/14-il2cpp-metadata.md
// for what the dump can and cannot answer.
//
// Why this exists: game data (data/*.json) carries raw enum NUMBERS such as AutoChess projectile `_moveType: 4`.
// The literals live only in the IL2CPP metadata, so this is the only way to read a number as a name.
//
// Licence: this file is the project's own code (GPL-3.0-or-later). It does not bundle Il2CppDumper; that tool is MIT
// (Perfare) and stays in the git-ignored .cache/il2cpp/tool/ — see THIRD-PARTY-NOTICES.md.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ROOT, c, mark } from './setup.mjs';

const DEFAULT_DUMP = path.join(ROOT, '.cache', 'il2cpp', 'dump');

const HELP = `node tools/il2cpp-enum.mjs [<EnumType>] [options]  —  read enum literals from the cached IL2CPP dump (read-only)

  <EnumType>              full name, e.g. AdvancedMovement.MoveType, Torappu.Battle.XXX
                          a bare simple name works when it is unambiguous (e.g. MoveType)

  --value <n>             print the literal(s) with that numeric value
  --name <LITERAL>        print the numeric value of that literal
  --find <LITERAL>        search every enum for a literal of that name
  --search <regex>        search enum type names and literal names
  --list                  list every enum type name
  --dump <dir>            dump directory (default ${DEFAULT_DUMP})
                          env SP_IL2CPP_DUMP overrides the default too
  --rebuild               re-parse <dump>/dump.cs into <dump>/enums.json, then exit
  --json                  machine-readable output
  -h, --help

Exit codes: 0 found · 1 nothing found · 2 usage/cache error.`;

// ---------------------------------------------------------------------------------------------------
// Parsing dump.cs
// ---------------------------------------------------------------------------------------------------

/**
 * Parse the `enum` blocks of an Il2CppDumper `dump.cs`.
 *
 * The dumper writes each type as `// Namespace: <ns>` followed by `public enum <name> // TypeDefIndex: n` and one
 * `public const <Type> <LITERAL> = <int>;` per member. Verified against the 2.7.71-era Windows dump: nested types
 * (`AdvancedMovement.MoveType`) are printed with an EMPTY namespace line and an already-qualified name, and every
 * `public const` line inside an enum body is an integer literal (0 exceptions in 3189 enums).
 *
 * 2 of the 3189 declarations share a full name with an earlier one (`BigInteger.Sign`, `ColorTween.ColorTweenMode`);
 * both pairs are byte-identical, and the later definition wins. They are reported in `duplicateSink` so a caller can
 * record that the index is name-keyed rather than assembly-keyed.
 *
 * @param {string} dumpCs path to dump.cs
 * @param {string[]} [duplicateSink] filled with full names declared more than once
 * @returns {Promise<Map<string, Record<string, number>>>} full type name → { LITERAL: value }
 */
export async function parseEnums(dumpCs, duplicateSink) {
  const enums = new Map();
  const input = fs.createReadStream(dumpCs, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let ns = '';
  let open = false; // are we inside an enum body?
  let current = null;
  try {
    for await (const line of rl) {
      if (!open) {
        if (line.startsWith('// Namespace: ')) { ns = line.slice('// Namespace: '.length).trim(); continue; }
        const decl = /^public enum (\S+)/.exec(line);
        if (decl) {
          const name = decl[1];
          // Nested types arrive already qualified (`Outer.Inner`); plain ones still need their namespace.
          const full = ns && !name.startsWith(`${ns}.`) ? `${ns}.${name}` : name;
          if (enums.has(full) && duplicateSink) duplicateSink.push(full);
          current = full;
          enums.set(full, {});
          open = true;
        }
        continue;
      }
      if (line === '}') { open = false; current = null; continue; }
      const member = /^\s*public const\s+\S+\s+([\w@`<>]+)\s*=\s*(-?\d+);\s*$/.exec(line);
      if (member) enums.get(current)[member[1]] = Number(member[2]);
    }
  } finally {
    rl.close();
    input.destroy();
  }
  return enums;
}

/** Parse `dump.cs` and write the compact `<dump>/enums.json` next to it. */
export async function rebuildEnumIndex(dumpDir) {
  const dumpCs = path.join(dumpDir, 'dump.cs');
  if (!fs.existsSync(dumpCs)) throw new Error(`no dump.cs in ${dumpDir} — run: node tools/il2cpp-dump.mjs`);
  const duplicateNames = [];
  const enums = await parseEnums(dumpCs, duplicateNames);
  const stat = fs.statSync(dumpCs);
  let members = 0;
  for (const m of enums.values()) members += Object.keys(m).length;
  const out = {
    _meta: {
      source: 'dump.cs',
      sourceBytes: stat.size,
      sourceMtime: stat.mtime.toISOString(),
      enumCount: enums.size,
      memberCount: members,
      duplicateNames,
      generatedBy: 'tools/il2cpp-enum.mjs --rebuild',
    },
    enums: Object.fromEntries([...enums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  const target = path.join(dumpDir, 'enums.json');
  fs.writeFileSync(target, JSON.stringify(out));
  return { target, enumCount: enums.size, memberCount: members, bytes: fs.statSync(target).size };
}

/** Load the enum index: `enums.json` when present, otherwise parse `dump.cs` (both read-only). */
export async function loadEnums(dumpDir) {
  const index = path.join(dumpDir, 'enums.json');
  if (fs.existsSync(index)) {
    const parsed = JSON.parse(fs.readFileSync(index, 'utf8'));
    return { enums: new Map(Object.entries(parsed.enums)), meta: parsed._meta, from: index };
  }
  const dumpCs = path.join(dumpDir, 'dump.cs');
  if (!fs.existsSync(dumpCs)) {
    throw new Error(`no enums.json and no dump.cs under ${dumpDir}\n  build the cache first:  node tools/il2cpp-dump.mjs`);
  }
  return { enums: await parseEnums(dumpCs), meta: null, from: dumpCs };
}

// ---------------------------------------------------------------------------------------------------
// Lookup helpers (exported so tests / other tools can reuse them)
// ---------------------------------------------------------------------------------------------------

/**
 * Resolve a user-typed type name against the index.
 * Exact full name first, then a unique simple-name suffix match.
 * @returns {{ name: string, members: Record<string, number> } | { error: string, candidates?: string[] }}
 */
export function resolveType(enums, query) {
  if (enums.has(query)) return { name: query, members: enums.get(query) };
  const suffix = `.${query}`;
  const hits = [...enums.keys()].filter((k) => k === query || k.endsWith(suffix));
  if (hits.length === 1) return { name: hits[0], members: enums.get(hits[0]) };
  if (hits.length === 0) return { error: `no enum type named "${query}"` };
  return { error: `"${query}" is ambiguous`, candidates: hits };
}

/** Literal(s) carrying a numeric value (`--value`). Aliases are returned in declaration order. */
export function literalsOfValue(members, value) {
  return Object.entries(members).filter(([, v]) => v === value).map(([k]) => k);
}

// ---------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { dump: process.env.SP_IL2CPP_DUMP || DEFAULT_DUMP, json: false, rebuild: false, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const [k, inline] = argv[i].split('=');
    const val = () => (inline !== undefined ? inline : argv[++i]);
    if (k === '--dump') o.dump = path.resolve(val());
    else if (k === '--value') o.value = Number(val());
    else if (k === '--name') o.name = val();
    else if (k === '--find') o.find = val();
    else if (k === '--search') o.search = val();
    else if (k === '--list') o.list = true;
    else if (k === '--rebuild') o.rebuild = true;
    else if (k === '--json') o.json = true;
    else if (k === '-h' || k === '--help') o.help = true;
    else if (k.startsWith('-')) throw new Error(`unknown option ${argv[i]}\n${HELP}`);
    else positional.push(argv[i]);
  }
  o.type = positional[0];
  if (positional.length > 1) throw new Error(`unexpected extra argument "${positional[1]}"\n${HELP}`);
  if (o.value !== undefined && !Number.isFinite(o.value)) throw new Error('--value needs a number');
  return o;
}

/** The machine-readable answer, shared by --json and the human renderer. */
function query(o, enums) {
  if (o.list) return { type: 'list', types: [...enums.keys()] };
  if (o.find) {
    const hits = [];
    for (const [type, members] of enums) {
      if (Object.hasOwn(members, o.find)) hits.push({ type, value: members[o.find] });
    }
    return { type: 'find', literal: o.find, hits };
  }
  if (o.search) {
    const re = new RegExp(o.search, 'i');
    const types = [];
    const literals = [];
    for (const [type, members] of enums) {
      if (re.test(type)) types.push(type);
      for (const [lit, value] of Object.entries(members)) if (re.test(lit)) literals.push({ type, literal: lit, value });
    }
    return { type: 'search', pattern: o.search, types, literals };
  }
  if (!o.type) return { type: 'usage' };
  const r = resolveType(enums, o.type);
  if (r.error) return { type: 'error', error: r.error, candidates: r.candidates };
  if (o.value !== undefined) {
    return { type: 'value', enum: r.name, value: o.value, literals: literalsOfValue(r.members, o.value) };
  }
  if (o.name !== undefined) {
    const value = Object.hasOwn(r.members, o.name) ? r.members[o.name] : undefined;
    return { type: 'name', enum: r.name, literal: o.name, found: value !== undefined, value };
  }
  return { type: 'enum', enum: r.name, members: r.members };
}

function render(result, opts) {
  const L = (s = '') => console.log(s);
  switch (result.type) {
    case 'usage':
      L(HELP);
      return 0;
    case 'error':
      console.error(`${mark.err} ${result.error}`);
      if (result.candidates) for (const cand of result.candidates) L(`    ${cand}`);
      return 1;
    case 'list':
      for (const t of result.types) L(t);
      L(c.dim(`\n${result.types.length} enum types  (${opts.from})`));
      return 0;
    case 'find':
      if (!result.hits.length) { console.error(`${mark.err} no enum declares a literal named ${result.literal}`); return 1; }
      for (const h of result.hits) L(`${c.bold(String(h.value).padStart(4))}  ${h.type}.${result.literal}`);
      return 0;
    case 'search':
      if (!result.types.length && !result.literals.length) { console.error(`${mark.err} nothing matches /${result.pattern}/i`); return 1; }
      if (result.types.length) { L(c.bold('enum types')); for (const t of result.types) L(`  ${t}`); }
      if (result.literals.length) {
        L(c.bold('literals'));
        for (const l of result.literals) L(`  ${String(l.value).padStart(4)}  ${l.type}.${l.literal}`);
      }
      return 0;
    case 'value':
      if (!result.literals.length) {
        console.error(`${mark.err} ${result.enum} has no member with value ${result.value}`);
        return 1;
      }
      for (const lit of result.literals) L(`${c.bold(String(result.value).padStart(4))}  ${result.enum}.${lit}`);
      return 0;
    case 'name':
      if (!result.found) { console.error(`${mark.err} ${result.enum} has no member named ${result.literal}`); return 1; }
      L(`${String(result.value).padStart(4)}  ${result.enum}.${result.literal}`);
      return 0;
    case 'enum': {
      L(c.bold(result.enum));
      for (const [lit, value] of Object.entries(result.members).sort((a, b) => a[1] - b[1])) {
        L(`  ${String(value).padStart(4)}  ${lit}`);
      }
      return 0;
    }
    default:
      return 2;
  }
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`${mark.err} ${e.message}`); return 2; }
  if (o.rebuild) {
    try {
      const r = await rebuildEnumIndex(o.dump);
      console.log(`${mark.ok} ${r.enumCount} enums / ${r.memberCount} literals → ${r.target} (${(r.bytes / 1048576).toFixed(2)} MB)`);
      return 0;
    } catch (e) { console.error(`${mark.err} ${e.message}`); return 2; }
  }
  let loaded;
  try { loaded = await loadEnums(o.dump); } catch (e) { console.error(`${mark.err} ${e.message}`); return 2; }
  const result = query(o, loaded.enums);
  if (o.json) { console.log(JSON.stringify(result, null, 2)); return result.type === 'error' ? 1 : 0; }
  return render(result, { ...o, from: loaded.from });
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.error(`${mark.err} il2cpp-enum: ${e?.stack || e}`);
    process.exitCode = 2;
  });
}
