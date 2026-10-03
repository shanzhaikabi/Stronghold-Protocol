# 14 · IL2CPP metadata: reading enum literals and type/field names out of the official client

Written 2026-10-03 in response to a concrete need: the projectile investigation could read `_moveType: 4` from the
AssetBundles but had to *guess* what `4` meant, because `data/*.json` carries only the number and the literals live in
the IL2CPP metadata. The user approved dump-based tooling as auxiliary infrastructure for future deep implementations.
This note records what was built, how to reproduce it, what it answered, and — just as important — what it still
cannot answer.

**Tags** (as in research 09/11)
- **[DATA]**: read from the official client. Here: the local Windows client, `global-metadata.dat` SHA-256
  `EE7F1239…` and `GameAssembly.dll` SHA-256 `6EDBC00B…` (see §2 for the full identity).
- **[TOOL]**: a fact about the tooling built here.
- **[ASSUMED]**: inference, clearly marked.

---

## 0. TL;DR

| # | Question | Answer |
|---|---|---|
| 1 | Is there a working IL2CPP metadata reader on this machine? | **Yes.** [Il2CppDumper](https://github.com/Perfare/Il2CppDumper) v6.7.46, self-contained win-x64 build, MIT. It runs with no .NET install at all (this machine happens to have .NET 8.0.14 and 10.0.3 anyway). |
| 2 | Where are the artifacts? | `.cache/il2cpp/` — **git-ignored** (`.gitignore:14` is `.cache/`). 524 MB: `dump.cs` (87 MB), `il2cpp.h`, `script.json`, `stringliteral.json`, `DummyDll/` (94 files), plus `enums.json` (0.42 MB) and `PROVENANCE.md`. |
| 3 | What did it resolve? | `AutoChess` projectile `_moveType` is `AdvancedMovement.MoveType`, and **`4 = FIXED_DIRECTION`** — the earlier empirical reading was **right**. Full literal table in §3. |
| 4 | How does a future task ask a question? | `node tools/il2cpp-enum.mjs AdvancedMovement.MoveType --value 4` (read-only, reads the cached dump; never re-runs the dumper, never touches the game). |
| 5 | What is still unreadable? | **Ability bodies (C#), hit-range geometry, and every server-side rule.** The dump gives *names, signatures and offsets* — not method bodies and not inlined constants. §5. |

**Ceiling, stated up front so nobody over-claims later:** this closes the *enum / type / field names* gap **only**. A
number that exists solely as an inlined constant inside a C# method — the 1.3 collision radius is the standing example
— is **not** obtainable here. Reading those needs disassembly (research 08 Appendix B, research 11 §2), which is a
different and much more expensive exercise.

---

## 1. The tool: what was tried, and what actually runs

### 1.1 What was checked first

| Candidate | Outcome |
|---|---|
| **Il2CppDumper** (Perfare) | **[TOOL] Chosen.** v6.7.46 has a **self-contained** `Il2CppDumper-win-v6.7.46.zip` (11 MB) — it bundles its own runtime, so it does not depend on whatever .NET is installed. Ran first try. |
| Cpp2IL | Not needed — no reason to duplicate once Il2CppDumper worked. |
| Il2CppInspector | Not needed. Its releases are older and its .NET dependency story is worse than a self-contained build. |
| Pure-Python `global-metadata.dat` parser | **Not needed as a fallback.** Worth knowing for later: research 11's author already read metadata by hand (v29 ints are compressed), so a hand parser is *possible* — but it would re-implement what a maintained tool already does correctly. |

**Runtime note:** the machine has `.NET 8.0.14` and `.NET 10.0.3` runtimes installed (`C:\Program Files\dotnet`), but
**no SDK** and no `msbuild`. That matters only if a tool must be *built from source* — the self-contained release
sidesteps it completely. (The framework-dependent `Il2CppDumper-net6/net7` assets from the same release would **not**
have run as-is: there is no .NET 6 or 7 runtime here, and a `net6.0`/`net7.0` app does not roll forward to 8.0 under
the default policy.)

### 1.2 Getting it and what got in the way

`gh` works on this machine and reaches GitHub through the Windows system proxy, so no `HTTPS_PROXY` was needed:

```powershell
gh release download v6.7.46 --repo Perfare/Il2CppDumper --pattern "Il2CppDumper-win-v6.7.46.zip" --dir <dir>
```

Two things had to be dealt with:

1. **`RequireAnyKey`.** The shipped `config.json` sets `RequireAnyKey: true`, so the dumper blocks on a keypress and
   would hang any scripted run. `tools/il2cpp-dump.mjs` sets it to `false` in the *tool's* directory (never in the
   game install) before launching.

2. **[TOOL] Il2CppDumper.exe is refused write access inside this git working tree.** Both
   `Stronghold-Protocol\.cache\il2cpp\dump\` and a fresh `Stronghold-Protocol\sp-il2cpp-probe\` failed with

   ```
   System.UnauthorizedAccessException: Access to the path '…\dump.cs' is denied.
      at Microsoft.Win32.SafeFileHandle.CreateFile(…)
   ```

   while the **same binary writes fine to `D:\projects\_scratch\…`**, and PowerShell, `cmd`, `fsutil` and Node all
   write 90 MB files into `.cache\` without complaint (checked: no Deny ACEs, no mandatory label, no reparse point,
   no read-only attribute, no Mark-of-the-Web, Windows Defender's service is not even running). This is **not** a
   permissions problem with the directory; it is specific to that executable in that tree, and it reproduced 4/4 times
   against 3/3 successes outside. Root cause was not pinned down — no AV/EDR confirmed it, and it is not worth a
   deeper hunt.

   **Consequence for the tooling:** `tools/il2cpp-dump.mjs` *always* dumps into a temp staging directory
   (`os.tmpdir()`) and copies the artifacts into `.cache/il2cpp/dump`. This is harmless on a machine where the dumper
   can write into the repo directly, and it is the only thing that works here.

### 1.3 Invocation

```powershell
node tools/il2cpp-dump.mjs                 # auto-detects the client, dumps, writes PROVENANCE.md, rebuilds enums.json
node tools/il2cpp-dump.mjs --game "D:\Game\Hypergryph Launcher\games\Arknights Game"
node tools/il2cpp-dump.mjs --fetch         # download Il2CppDumper with gh/curl into .cache/il2cpp/tool first
node tools/il2cpp-dump.mjs --force         # re-dump even though the inputs are unchanged
```

The underlying command (what the script runs, into a staging dir):

```
Il2CppDumper.exe <game>\GameAssembly.dll <game>\Arknights_Data\il2cpp_data\Metadata\global-metadata.dat <stage>
```

Both inputs are opened **read-only and never modified** — verified by re-hashing them after the dump (§2). Runtime was
**38 s** on this machine (Ryzen 7 9700X, 8 cores; ~12 GB free RAM was enough).

`--game` accepts either the game root (the directory holding `GameAssembly.dll`) or the AssetBundle root the other
tools take (`…\Arknights_Data\StreamingAssets\AB\Windows`); the script walks up from the latter. With no `--game` it
falls back to `findClient()` from `tools/setup.mjs`, honouring `SP_IL2CPP_DUMP` for the output directory.

**A fix on the way:** `tools/setup.mjs:clientCandidates()` did not know this machine's install layout. It probed
`…\Hypergryph Launcher\games\Arknights\…`, but the official PC launcher actually installs to
**`…\games\Arknights Game\…`**, here under a `Game` folder (`D:\Game\Hypergryph Launcher\games\Arknights Game`), so
`findClient()` returned `null` and its 36 candidates contained no match. The candidate list now also tries the
`Arknights Game` leaf and the `Game\…` prefix (78 candidates; every previous candidate is still probed). This is a
superset, no test pinned the old list, and it also fixes `node tools/doctor.mjs` and `node tools/setup.mjs`, which use
the same helper.

---

## 2. Provenance: how to trust and reproduce the dump

`tools/il2cpp-dump.mjs` writes `.cache/il2cpp/PROVENANCE.md` on every run. Its content after the run that produced the
current cache:

| Item | Value |
|---|---|
| Tool | **Il2CppDumper v6.7.46** (Perfare), MIT — self-contained win-x64 |
| Archive SHA-256 | `F5FC60DFC5C034C1FF3FC651514416EBD47658A63493207734537FD25FA2DEA2` |
| Metadata version / IL2CPP version | **29 / 29** (agrees with research 11's reading) |
| `CodeRegistration` / `MetadataRegistration` | `186cd91e0` / `1878338b0` |
| Game root | `D:\Game\Hypergryph Launcher\games\Arknights Game` |
| `GameAssembly.dll` | 214,586,344 B · SHA-256 `6EDBC00B11E016C8935BBC45F158D5363F63D35038B0A69F8297612235E533CE` |
| `global-metadata.dat` | 45,263,956 B · SHA-256 `EE7F1239E1CFF67620A7964D651189DBB5C98E13699169096BE2A907FD541118` |
| Client **data version** | `26-08-16-14-00-43_415873` (from `StreamingAssets\AB\Windows\hot_update_list.json → versionId`) |
| Bundle manifest | `V077` (`5bf3460e8509049311389521ce77a6cc.idx`) |
| Unity | 2021.3.39f1 |
| Files dated | 2026-08-25 |

**There is no `data_version.txt` on this install.** A full recursive search of the game directory for `*version*`
returns nothing. The reproducible identity of a build is therefore the **`versionId` in `hot_update_list.json`** plus
the two input hashes above — use those, not a filename that does not exist.

Note the client has moved since research 11, which read a build described as 2.7.71 with files dated 2026-08-20 (this
one is dated 2026-08-25, data version `26-08-16`). The game's *app* version string is not stored in the install in any
form found here; the launcher directory it sits under is `1.6.0`, which is the **launcher's** version, not the game's.

`enums.json` carries its own provenance header:

```json
"_meta": { "source": "dump.cs", "sourceBytes": 87351440, "sourceMtime": "…",
           "enumCount": 3187, "memberCount": 19876, "duplicateNames": ["BigInteger.Sign", "ColorTween.ColorTweenMode"],
           "generatedBy": "tools/il2cpp-enum.mjs --rebuild" }
```

Artifacts and what each is for:

| File | Size | Use |
|---|---|---|
| `dump.cs` | 87.4 MB | Every type, field, property, method signature, plus **field offsets** and method offsets. `--rebuild` reads this. |
| `DummyDll/` (94 files) | — | Reconstructed reference assemblies: let a C#/ILSpy-style tool browse types. **No method bodies.** |
| `il2cpp.h` | 137.5 MB | C structs for IDA/Ghidra. The bridge to disassembly work. |
| `script.json` | 244.0 MB | Symbol/offset map for IDA/Ghidra (`ida_with_struct_py3.py` etc. ship with the dumper). |
| `stringliteral.json` | 3.8 MB | String literals (useful for finding a message, not for enum values). |
| `enums.json` | 0.42 MB | Compact `{ "Type": { "LITERAL": value } }` index — what the helper reads. |

---

## 3. The worked example: `_moveType` and `AdvancedMovement.MoveType`

### 3.1 The problem it solves

The projectile dump (`_scratch/akx/proj_moves.json`, 2177 movement components across the shipped projectile prefabs)
recorded numbers such as `"moveType": 4` with no way to name them. The literals are not in any AssetBundle.

The owning field is, from `dump.cs`:

```csharp
public class AdvancedMovement : BasicMovement   // TypeDefIndex: 12495
{
    [SerializeField] private AdvancedMovement.MoveType _moveType; // 0xB0
    [SerializeField] private FuncTimeBasedParamData _moveTypeData; // 0xB8
    [SerializeField] private float _speed;   // 0xC0
    [SerializeField] private float _distance; // 0xC4
    …
}
```

and the enum itself (`TypeDefIndex: 12493`) is complete: **ten members, 0–9, no gaps, no aliases.**

### 3.2 The literals **[DATA]**

`node tools/il2cpp-enum.mjs AdvancedMovement.MoveType`

| Value | Literal | Prefabs using it (of 2177) | Reading |
|---|---|---|---|
| 0 | `NONE` | 0 | no calculator |
| 1 | `TRACE_TARGET_WITH_SPEED` | **2038** | the default homing projectile — travels to the target at `_speed` |
| 2 | `TRACE_TARGET_WITHIN_TIME` | 10 | reaches the target within a set time |
| 3 | `TWO_POINTS` | 4 | `projectile_chr_thorn2_s3*`, `projectile_enemy_martyr_scan` |
| **4** | **`FIXED_DIRECTION`** | **111** | **straight line in a fixed direction** — `InitStraightLine`, `projectile_enemy_msnip`, `projectile_chr_svash2_s3_bird` |
| 5 | `FIXED_DISTANCE` | 3 | `projectile_portlexi*` — note `_distance` is set (3.5 / 30.0) while `_speed` is 0 |
| 6 | `FUNC_ANGLE_AND_TIME` | 7 | the `Striaght` [sic] test prefabs |
| 7 | `FUNC_INIT_SPEED_AND_ACC` | 0 | unused by shipped projectiles |
| 8 | `FUNC_CURVE_AND_X_LENGTH` | 1 | `projectile_chr_aglna2_s2_fly` |
| 9 | `FUNC_TURN_AND_WAVE_TO_TARGET` | 3 | the `TurnTarget` / `StrightForward` / `Comback` test prefabs |

**Verdict: the earlier empirical reading of `4` as `FIXED_DIRECTION` was correct.** It is also self-consistent in the
data: those 111 prefabs are the straight-line shots, and the two that set `_useSourceDirection: 1` are firing along
the shooter's facing rather than at the target. The histogram spanning exactly `{1,2,3,4,5,6,8,9}` — i.e. every literal
except `NONE` and `FUNC_INIT_SPEED_AND_ACC` — is a good sanity signal that the numbers were being read correctly in
the first place.

**[ASSUMED]** the exact behavioural reading of each calculator (what "fixed direction" does with
`_useSourceDirection`, inertia, `_comeBack`, …) is inferred from the literal names and the serialized fields; the
authoritative behaviour is in the C# bodies, which are **not** in this dump (§5). `_useSourceDirection`,
`_useTargetDirection`, `_rotateToTarget` etc. are declared on the base class `BasicMovement : Projectile.Behaviour`
(`_useSourceDirection` at `0x2A`) — which is why the AssetBundle probe saw them on the same component.

### 3.3 Other things this immediately unlocks

Anything in `data/*.json` that was stored as a raw enum number and guessed at. Two concrete shapes worth knowing:

- **`--find <LITERAL>`** answers the reverse question — "which enum declares `FIXED_DIRECTION`?" — which is how you
  find the *type* when you only know a name from a log, a string literal or a wiki.
- **`--search <regex>`** sweeps type names and literals at once, e.g. `node tools/il2cpp-enum.mjs --search 'autoChess.*mode'`.

---

## 4. The reusable helper

`tools/il2cpp-enum.mjs` — **read-only**, no dependencies, reads the cached index (or `dump.cs`) and never runs the
dumper, never opens the game install.

```powershell
node tools/il2cpp-enum.mjs AdvancedMovement.MoveType            # every member, sorted by value
node tools/il2cpp-enum.mjs AdvancedMovement.MoveType --value 4  # 4 → FIXED_DIRECTION
node tools/il2cpp-enum.mjs AdvancedMovement.MoveType --name FIXED_DIRECTION
node tools/il2cpp-enum.mjs --find FIXED_DIRECTION               # which enums declare this literal
node tools/il2cpp-enum.mjs --search moveType                    # types + literals matching a regex
node tools/il2cpp-enum.mjs --list                               # all 3187 enum type names
node tools/il2cpp-enum.mjs --rebuild                            # re-parse dump.cs → enums.json
node tools/il2cpp-enum.mjs AdvancedMovement.MoveType --json     # machine-readable
```

- `--dump <dir>` (or `SP_IL2CPP_DUMP`) points at a different cache; default `.cache/il2cpp/dump`.
- Exit codes: `0` found · `1` nothing found · `2` usage/cache missing — safe to use in a script.
- Names may be given in full or as a bare simple name; an ambiguous simple name (`ResultCode` exists in three
  namespaces) lists the candidates instead of guessing.
- The parser is exported (`parseEnums`, `loadEnums`, `resolveType`, `literalsOfValue`) so a test or another tool can
  reuse it without shelling out.

**A note on the index:** it is keyed by type *name*, not by assembly. 3189 enum declarations collapse to 3187 keys
because `BigInteger.Sign` and `ColorTween.ColorTweenMode` each appear twice; both pairs are byte-identical and the
later definition wins. `_meta.duplicateNames` records them so nobody has to rediscover this.

---

## 5. The ceiling: what this does **not** give you

Be explicit about this in any future task that leans on the dump.

| Thing | Readable? | Why |
|---|---|---|
| Enum literals and their numeric values | **Yes** | This is exactly what the dump is for. |
| Type / field / property / method **names and signatures**, field **offsets**, TypeDefIndex | **Yes** | In `dump.cs` / `DummyDll`. |
| Default values of `static readonly` fields and constants | Partly | Research 11 read `AutoChessBattleConst` values this way. |
| **C# method bodies** | **No** | IL2CPP compiles them to native code; `DummyDll` methods are stubs with no IL. They live in `GameAssembly.dll` as x86-64. |
| **Constants inlined into method bodies** | **No** | A literal like `999` or `300000` exists in the *code*, not in metadata. Research 11 had to scan the code section for the immediate to find its use sites. |
| **Hit-range / collision geometry that is not serialized** | **No** | The 1.3 collision radius is **not** in the prefab data (checked: of the 812 projectile colliders in `[uc]projectiles.ab`, none has radius 1.3 — they are 1.0, 0.1, …). It is therefore in code, and unreadable here. |
| **Ability bodies / kit logic (望, 火陈, …)** | **No** | Same reason: bodies, not names. Behaviour must still come from PRTS/wiki/playtest, or from disassembly. |
| **Server-side-only rules** | **No** | The client does not contain the scene server's logic at all (research 11 §1.2 hit this: the prep-side layer gains are computed server-side). |

Going further means **disassembly** — `il2cpp.h` + `script.json` + the IDA/Ghidra scripts the dumper ships, as
research 08 Appendix B and research 11 §2 already do by hand (`llvm-objdump`, the `Il2CppCodeGenModule`
method-pointer table). That is a different, much more expensive toolchain; this note deliberately does not claim it.

---

## 6. Licensing and hygiene

| Item | Value |
|---|---|
| Il2CppDumper licence | **MIT**, Copyright (c) 2016 Perfare (verified from the repository's `LICENSE`) |
| Vendored into the repo? | **No.** The binary lives only in `.cache/il2cpp/tool/` (git-ignored). Nothing was added to the tracked tree but the two scripts and this note. |
| Game files modified? | **No.** Both inputs re-hashed after the dump; hashes unchanged (§2). |
| Dump committed? | **No.** 524 MB under `.cache/`, which `.gitignore:14` ignores — verified with `git check-ignore`. |

Because the tool is not redistributed, `THIRD-PARTY-NOTICES.md` gains only a row marking it as an *external,
not-distributed* tool, alongside the existing "no" rows for UnityPy and friends — not a licence text. If a future
change ever wants to vendor it, MIT permits it, but that should be a deliberate decision with the notice and copyright
line carried along.

---

## 7. Reproducing after a client update

1. The client updates → the two input hashes change → the cache is stale. `tools/il2cpp-dump.mjs` detects this via
   `.cache/il2cpp/dump/.input-hashes.json` and re-dumps automatically (it will *not* re-dump if nothing changed; use
   `--force` to override).
2. Re-run `node tools/il2cpp-dump.mjs`. It re-dumps, refreshes `PROVENANCE.md` and rebuilds `enums.json`.
3. **TypeDefIndex and field offsets are not stable across builds.** Never hard-code a TypeDefIndex or an offset from
   the dump into project code — look them up by name at the time you need them.
