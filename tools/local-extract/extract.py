#!/usr/bin/env python3
"""Extract autochess art from a locally installed Arknights client (optional, host-side).

The official CN client ships Unity AssetBundles compressed with a custom LZ4 variant ("LZ4AK");
aklz4.py registers a decoder for it. This script pulls the art the web sources lack:
  - map_autochess / map_autochesssand textures (the real board tile atlas)
  - every Sprite of the three autochess UI bundles (HUD frames, badges, banners, icons)
  - the 6 in-match emoticon themes of 盟约 (activity_table autoChessData.enabledEmoticonThemeIdList; only the
    *_battle sprites, keyed by display_meta_table picId: emoticon/<dir>/<picId>.png, see data/emotes.json)
  - the autochess guidebook pages, battle projectile sprites and a few token/skin Spine models missing upstream
  - for the official 3D board (DESIGN §15): the map theme's Material parameters (map/<theme>/materials.json; shader
    names resolved through the shaders/*.ab bundles), the background / device meshes as Wavefront OBJ
    (mesh/<bundle>/<mesh>.obj; UnityPy's exporter, X mirrored into a right-handed frame) and their GameObject
    placement (mesh/<bundle>/prefab.json)
  - the standard gate / objective effects of every battle map (arts/effects/[pack]map.ab → map/fx: the [opt]start_box /
    [opt]end_box / [opt]start_fly meshes, their merged additive textures, materials and prefab), the blower's texture
    (arts/maps/common/res.ab → map/common: TX_wind_device of the s_wind_device mesh) and the shared water / noise
    textures (arts/maps/effect.ab → map/water) used for deep-sea / mire / smog tiles
  - derived PBR maps for three.js (DERIVED): Unity stores the theme's normal map as two channels (BC5: RG = XY, B = 0)
    and metallic/gloss with the smoothness in A; the board renderer needs an RGB normal map (Z rebuilt) and a
    roughness map in G (1 − smoothness; metalness B = 0), written next to the source as <name>_rgb.png / _rough.png
  - the art of the 自选干员 the free-pick roster adds (DESIGN §21), which the released bundle does not carry: the
    avatars and 半身像 portraits of every such operator (spritepack/ui_char_avatar_*.ab, spritepack/char_portrait_*.ab),
    their battle Spine, both directions (chararts/<charId>.ab), their skill icons (spritepack/skill_icons_*.ab) and
    the avatars of their summons (spritepack/ui_char_avatar_*.ab, the object named `{tokenId}`) —
    written into public/assets/char, public/assets/token, public/assets/spine and public/assets/skill, i.e. the layout
    tools/assets/plan.mjs expects, NOT under public/assets/local

Usage:
  python3 -m venv .venv && .venv/bin/pip install -r tools/local-extract/requirements.txt
  .venv/bin/python tools/local-extract/extract.py [--game <AB root>] [--out public/assets/local] [--only <subdir prefix>]
  python3 tools/local-extract/extract.py --print-jobs     (the job table as JSON; needs no dependencies)

Writes <out>/**.png|.skel|.atlas and data/local-assets.json (manifest of what was extracted). With --only, just the
jobs whose output subdir starts with one of the prefixes run, and their groups replace those of the existing manifest
(every other group is kept as is). The operator-art jobs (char/*, spine/op/*) are the exception: they write under the
--public root (public/assets/char and public/assets/spine) instead of --out, because the released art lives there and
not in public/assets/local, and they record nothing in that manifest (data/assets.json is their manifest). Run them
with `--only char` and `--only spine/op` — and, to extract into a scratch tree rather than the real public/assets,
`--public <dir>` — then rebuild the manifest with `node tools/fetch-assets.mjs --offline`.
Everything is (c) Hypergryph; for private, non-commercial fan use only.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parents[2]
HOME = Path.home()
CANDIDATES = [
    HOME / 'Library/Application Support/CrossOver/Bottles/Arknights/drive_c/Program Files/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows',
    HOME / 'Library/Containers/com.hypergryph.arknights/Data/Documents/Bundles',
    # native Windows installs of the official launcher (default and x86 locations)
    Path('C:/Program Files/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows'),
    Path('C:/Program Files (x86)/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows'),
]

# In-match emote themes (display_meta_table emoticonData, scene AUTOCHESS_BATTLE), in the order of
# activity_table autoChessData.enabledEmoticonThemeIdList: (themeId, output dir under emoticon/). The dirs are the
# ones of shared/constants.js EMOTE_THEMES / data/emotes.json. Only the *_battle sprites are exported: the bundles also
# hold room / pick pics of other modes (and the autochess room pics are not in the local client at all).
EMOTE_THEMES = [
    ('emoticon_autochess_basic', 'basic'),
    ('emoticon_originium_slug', 'slug'),
    ('emoticon_autochess_basic_2', 'basic_2'),
    ('emoticon_foolsday_doctor', 'fooldoctor'),
    ('emoticon_foolsday_amiya', 'foolamiya'),
    ('emoticon_foolsday_wisdel', 'foolwisdel'),
]
BATTLE_EMOTE = r'^pic_.+_battle$'

# Meshes of the official board scene (DESIGN §15): (bundle, output name under mesh/).
MESH_BUNDLES = [
    ('arts/maps/map_autochess/bkg_mesh.ab', 'map_autochess_bkg'),
    ('arts/maps/common/meshes/s_background_common.ab', 's_background_common'),
    ('arts/maps/common/meshes/s_common_box_01.ab', 's_common_box_01'),
    ('arts/maps/common/meshes/s_wind_device.ab', 's_wind_device'),
]

# ---------------------------------------------------------------------------
# Operator art of the 自选干员 (DESIGN §21). It is the one class of output that does NOT belong under
# public/assets/local: the released bundle already ships public/assets/char/**, public/assets/spine/** and
# public/assets/skill/**, and these files have to sit next to them (the layout tools/assets/plan.mjs +
# tools/fetch-assets.mjs resolve against). A JOBS entry therefore may name its own output root as an optional 5th field
# — relative to the public directory (--public, default <repo>/public, so `--public <tmp>` extracts everything into a
# scratch tree) — and an extraction mode as an optional 6th: 'spine' for the battle Spine (its two directions share
# their object names, export_spine resolves them through the prefab) and 'skill_icon' for the skill icons (their object
# names carry the client's `skill_icon_` prefix, export_skill_icons drops it).

def _read_json(rel):
    """Parsed JSON of a repository file, or None (the job table must stay importable without the data files)."""
    try:
        return json.loads((ROOT / rel).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def free_pick_chars():
    """charIds of data/freePicks.json that docs/research/07-assets.json does not cover — the 自选干员 of DESIGN §21:
    the released bundle carries the season's own pools (the 138 operators of research 07) and nothing else, so these
    are exactly the operators whose art has to come from the local client. Research 07 is the reference (not
    data/assets.json, which is rebuilt from the extracted files and would make the jobs vanish once it is complete)."""
    picks = _read_json('data/freePicks.json') or {}
    covered = set((_read_json('docs/research/07-assets.json') or {}).get('operators') or {})
    ids = {rec['charId'] for rec in picks.values() if isinstance(rec, dict) and isinstance(rec.get('charId'), str)}
    return sorted(ids - covered)


def free_pick_tokens():
    """tokenIds of data/tokens.json that docs/research/07-assets.json does not list — the summons the 自选干员 batch
    adds (DESIGN §21.9: 26 of the 93 picks grant summons, 37 token records in all). The released bundle carries the
    season's 20 pool tokens and nothing else, so these are exactly the tokens whose avatar has to come from the local
    client. Research 07 is the reference (not data/assets.json, which is rebuilt from the extracted files)."""
    toks = _read_json('data/tokens.json') or {}
    covered = set((_read_json('docs/research/07-assets.json') or {}).get('tokens') or {})
    return sorted(i for i in toks if isinstance(i, str) and re.fullmatch(r'token_\d+_[a-z0-9_]+', i, re.I)
                  and i not in covered)


def free_pick_skill_icons():
    """Skill iconIds of those operators — the `skills[]` of their data/freePicks.json records, which is what
    tools/assets/plan.mjs resolves as public/assets/skill/<iconId>.png for them (the season's own operators come from
    research 07 and already ship their icons, so they are not included). The client names the sprite
    `skill_icon_<iconId>` (SKILL_ICON_PREFIX)."""
    wanted = set(OP_CHARS)
    ids = set()
    for rec in (_read_json('data/freePicks.json') or {}).values():
        if not isinstance(rec, dict) or rec.get('charId') not in wanted:
            continue
        for skill in rec.get('skills') or []:
            icon = (skill.get('iconId') or skill.get('skillId')) if isinstance(skill, dict) else None
            if isinstance(icon, str) and icon:
                ids.add(icon)
    return sorted(ids)


OP_CHARS = free_pick_chars()
# Output root of the operator-art jobs, inside the public directory: `assets`, i.e. public/assets/char, /spine and
# /skill next to the released art (instead of the --out default, public/assets/local).
OP_ROOT = 'assets'
# Only these operators are exported: the spritepack bundles carry every operator of the game, and the season's own art
# must not be replaced by a client extraction (`{charId}` / `{charId}_1` / `{charId}_2`; a client without the roster
# yields a never-matching filter).
OP_KEEP = r'^(' + '|'.join(re.escape(c) for c in OP_CHARS) + r')(_1|_2)?$' if OP_CHARS else r'(?!)'
# Client prefix of a skill-icon sprite: `skill_icon_skchr_kalts_1` is plan.mjs's skill/skchr_kalts_1.png.
SKILL_ICON_PREFIX = 'skill_icon_'
OP_SKILL_ICONS = free_pick_skill_icons()
OP_SKILL_KEEP = r'^' + SKILL_ICON_PREFIX + r'(' + '|'.join(re.escape(i) for i in OP_SKILL_ICONS) + r')$' \
    if OP_SKILL_ICONS else r'(?!)'
# Only the summons of the 自选干员 are exported (the spritepack series carries every token of the game, and the season's
# own 20 token avatars already ship). The client names the object exactly `{tokenId}` — plan.mjs's token/avatar path.
OP_TOKENS = free_pick_tokens()
OP_TOKEN_KEEP = r'^(' + '|'.join(re.escape(t) for t in OP_TOKENS) + r')$' if OP_TOKENS else r'(?!)'

# (bundle path relative to the AB root, output subdir, which object types to export[, name regex to keep
#  [, output root under --public[, extraction mode]]]). `bundle` may use `*` / `?` (not `[`: bundle names such as
#  `[uc]autochesscommon.ab` are literal), `keep` is matched against the object name, `extraction mode` is 'objects'
#  (default: export the objects `kinds` selects), 'spine' (an operator's battle Spine, resolved through its prefab —
#  see export_spine) or 'skill_icon' (a skill icon, renamed to plan.mjs's path — see export_skill_icons).
JOBS = [
    # Avatars and 半身像 portraits of the 自选干员. spritepack/ui_char_avatar_<n>.ab holds every operator's 精英0 / 精英2
    # avatar (180x180) as the sprites `{charId}` / `{charId}_2`; spritepack/char_portrait_<n>.ab holds the 半身像
    # (180x360) as `{charId}_1` / `{charId}_2` — which is exactly the layout plan.mjs expects
    # (char/avatar/{charId}.png + {charId}_2.png, char/portrait/{charId}_1.png + {charId}_2.png). Both are series of
    # spritepack bundles, hence the glob. (arts/charavatars/avatar_hub.ab and arts/charportraits/portraits_hub.ab are
    # index bundles — a single MonoBehaviour each, 0 Sprites/Texture2Ds — so the art is in the spritepacks.)
    ('spritepack/ui_char_avatar_*.ab', 'char/avatar', {'Sprite'}, OP_KEEP, OP_ROOT),
    ('spritepack/char_portrait_*.ab', 'char/portrait', {'Sprite'}, OP_KEEP, OP_ROOT),
    # Skill icons of the 自选干员: spritepack/skill_icons_<n>.ab holds every operator's icon (128x128) as the Sprite
    # `skill_icon_<iconId>`, while the plan wants skill/<iconId>.png — hence the 'skill_icon' mode.
    ('spritepack/skill_icons_*.ab', 'skill', {'Sprite'}, OP_SKILL_KEEP, OP_ROOT, 'skill_icon'),
    # Avatars of the summons of the 自选干员 (DESIGN §21.9): the same spritepack series, but the object is named exactly
    # `{tokenId}` (Sprite, or its padded Texture2D) — which is the layout plan.mjs expects
    # (token/avatar/{tokenId}.png). Run it with `--only token/avatar`.
    ('spritepack/ui_char_avatar_*.ab', 'token/avatar', {'Sprite', 'Texture2D'}, OP_TOKEN_KEEP, OP_ROOT),
    # Battle Spine of each 自选干员: one chararts bundle per operator, holding BOTH directions. See export_spine for
    # why this needs its own mode (the Front and the Back skeleton are named identically inside the bundle).
    *[(f'chararts/{charId}.ab', f'spine/op/{charId}', {'TextAsset', 'Texture2D'}, None, OP_ROOT, 'spine') for charId in OP_CHARS],
    ('arts/maps/map_autochess/res.ab', 'map/autochess', {'Texture2D', 'Material'}),
    ('arts/maps/map_autochesssand/res.ab', 'map/autochesssand', {'Texture2D', 'Material'}),
    ('ui/autochess/[uc]autochesscommon.ab', 'ui/common', {'Sprite'}),
    ('ui/autochess/[uc]autochessbattle.ab', 'ui/battle', {'Sprite', 'TextAsset'}),
    ('ui/autochess/[uc]autochessouter.ab', 'ui/outer', {'Sprite'}),
    *[(f'ui/emoticon/theme/[uc]{theme}.ab', f'emoticon/{sub}', {'Sprite'}, BATTLE_EMOTE) for theme, sub in EMOTE_THEMES],
    ('arts/guidebookpages/[pack]autochess.ab', 'guide', {'Sprite', 'Texture2D'}),
    ('battle/prefabs/[uc]projectiles.ab', 'projectiles', {'Sprite', 'Texture2D'}),
    # official module (uniequip) type icons, keyed by lower-case type name (e.g. 'mar-x')
    ('spritepack/ui_equip_type_hub_h2_0.ab', 'module', {'Sprite'}),
    ('skinpack/token_10039_ulpia_block.ab', 'spine/token_10039_ulpia_block', {'TextAsset', 'Texture2D'}),
    *[(rel, f'mesh/{sub}', {'Mesh', 'GameObject', 'Material', 'Texture2D'}) for rel, sub in MESH_BUNDLES],
    ('arts/effects/[pack]map.ab', 'map/fx', {'Mesh', 'GameObject', 'Material', 'Texture2D'}),
    ('arts/maps/common/res.ab', 'map/common', {'Material', 'Texture2D'}, r'^(TX|MT)_wind_device$'),
    ('arts/maps/effect.ab', 'map/water', {'Texture2D'}, r'water_normal|Caustics|WaterNoise|noise_clouds|Water_Foam|SmoothWaves'),
]

# Derived three.js maps: (output subdir, source texture, kind, output name). 'normal_rg' rebuilds Z of a two-channel
# (BC5) normal map into an RGB tangent-space map; 'rough_from_gloss' turns Unity's metallic/gloss map (smoothness in
# A) into a roughness (G) / metalness (B) map. Written after the job that exported the source texture.
DERIVED = [
    ('map/autochess', 'TX_autochessi_N', 'normal_rg', 'TX_autochessi_N_rgb'),
    ('map/autochess', 'TX_autochessi_M', 'rough_from_gloss', 'TX_autochessi_M_rough'),
]

# Shader bundles loaded beside every job that exports Materials, only so that the materials' shader references
# (external CABs) resolve to a name in materials.json (e.g. Torappu/Scene/StandardDirectional); nothing is exported
# from them.
SHADER_DEPS = 'shaders/*.ab'
# the root shader bundle ([uc]shaders.ab) holds the Torappu particle shaders of the map effects (map/fx)
SHADER_DEPS_ROOT = '[uc]shaders.ab'

SAFE = re.compile(r'[^A-Za-z0-9_.\-\[\]]+')


def safe_name(name):
    name = SAFE.sub('_', name).strip('._') or 'unnamed'
    return name[:120]


def job_parts(job):
    """(rel, sub, kinds, keep, base, mode) of a JOBS entry: keep is a compiled name filter or None, base the job's own
    output root relative to the repository (None = the --out argument) and mode 'objects' or 'spine'."""
    rel, sub, kinds = job[:3]
    keep = re.compile(job[3]) if len(job) > 3 and job[3] else None
    base = job[4] if len(job) > 4 and job[4] else None
    mode = job[5] if len(job) > 5 and job[5] else 'objects'
    return rel, sub, kinds, keep, base, mode


def job_bundles(ab_root, rel):
    """The bundle files a job covers. `rel` may use `*` / `?` (the operator-art jobs cover a whole spritepack series);
    `[` is literal, because bundle names such as `ui/autochess/[uc]autochesscommon.ab` contain it."""
    if '*' not in rel and '?' not in rel:
        return [ab_root / rel]
    return [p for p in sorted(ab_root.glob(rel)) if p.is_file()]


def url_root(base):
    """Public URL directory of a job's output. Jobs without their own base keep the historical /assets/local (what
    data/local-assets.json has always described, whatever --out was set to); a job that names its own root under the
    public directory gets that root's URL instead (the operator art → /assets)."""
    return '/assets/local' if not base else '/' + base.strip('/')


def select_jobs(only):
    """The jobs whose output subdir starts with one of the `only` prefixes (all jobs when `only` is empty)."""
    if not only:
        return list(JOBS)
    return [j for j in JOBS if any(j[1] == p.rstrip('/') or j[1].startswith(p.rstrip('/') + '/') for p in only)]


def _num(v, nd=6):
    """JSON-safe rounded float (NaN / inf → 0)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return round(f, nd) + 0.0 if f == f and abs(f) != float('inf') else 0  # + 0.0: no '-0.0'


def vec(v, keys='xyz'):
    """[x, y, z(, w)] of a UnityPy vector / quaternion (missing components → 0)."""
    return [_num(getattr(v, k, 0)) for k in keys]


def _pptr_name(pptr):
    """Name of the object a PPtr points to, or None (null pointer or an unloaded external bundle)."""
    try:
        if not getattr(pptr, 'm_PathID', 0):
            return None
        return getattr(pptr.read(), 'm_Name', None) or None
    except Exception:  # external dependency not loaded, unsupported type, …
        return None


def material_info(mat):
    """JSON summary of a Material: shader, keywords, textures (by name, with tiling), floats and colours."""
    shader = None
    try:
        sh = mat.m_Shader.read()
        shader = getattr(getattr(sh, 'm_ParsedForm', None), 'm_Name', None) or getattr(sh, 'm_Name', None)
    except Exception:
        shader = None
    props = getattr(mat, 'm_SavedProperties', None)
    textures, floats, colors = {}, {}, {}
    for k, env in (getattr(props, 'm_TexEnvs', None) or []):
        name = _pptr_name(env.m_Texture)
        if name:
            textures[k] = {'texture': name, 'scale': vec(env.m_Scale, 'xy'), 'offset': vec(env.m_Offset, 'xy')}
    for k, v in (getattr(props, 'm_Floats', None) or []):
        floats[k] = _num(v)
    for k, c in (getattr(props, 'm_Colors', None) or []):
        colors[k] = vec(c, 'rgba')
    kw = getattr(mat, 'm_ValidKeywords', None) or getattr(mat, 'm_ShaderKeywords', None) or []
    if isinstance(kw, str):
        kw = kw.split()
    return {'shader': shader, 'keywords': sorted(kw), 'textures': dict(sorted(textures.items())),
            'floats': dict(sorted(floats.items())), 'colors': dict(sorted(colors.items()))}


def prefab_node(go, mesh_keys=None):
    """JSON summary of a GameObject: local transform (Unity space), parent, mesh and material names. `mesh_keys`
    ({mesh path id: manifest key}) names the exported OBJ when two meshes of a bundle share a name."""
    node = {'name': getattr(go, 'm_Name', '') or '', 'parent': None, 'pos': [0, 0, 0], 'rot': [0, 0, 0, 1],
            'scale': [1, 1, 1], 'mesh': None, 'materials': []}
    for c in getattr(go, 'm_Component', None) or []:
        pptr = getattr(c, 'component', c)
        try:
            comp = pptr.read()
        except Exception:
            continue
        kind = type(comp).__name__
        if kind in ('Transform', 'RectTransform'):
            node['pos'] = vec(comp.m_LocalPosition)
            node['rot'] = vec(comp.m_LocalRotation, 'xyzw')
            node['scale'] = vec(comp.m_LocalScale)
            try:
                father = comp.m_Father.read() if getattr(comp.m_Father, 'm_PathID', 0) else None
                node['parent'] = father.m_GameObject.read().m_Name if father else None
            except Exception:
                node['parent'] = None
        elif kind == 'MeshFilter':
            node['mesh'] = _pptr_name(comp.m_Mesh)
            pid = getattr(comp.m_Mesh, 'm_PathID', 0)
            if mesh_keys and pid in mesh_keys and not getattr(comp.m_Mesh, 'm_FileID', 0):
                node['mesh'] = mesh_keys[pid]
        elif kind in ('MeshRenderer', 'SkinnedMeshRenderer'):
            node['materials'] = [_pptr_name(m) for m in getattr(comp, 'm_Materials', None) or []]
    return node


def dep_bundles(ab_root, kinds):
    """Bundles to load next to a job so its references resolve: the shader bundles when it exports Materials."""
    if 'Material' not in kinds:
        return []
    root = Path(ab_root)
    extra = [root / SHADER_DEPS_ROOT] if (root / SHADER_DEPS_ROOT).is_file() else []
    return sorted(p for p in root.glob(SHADER_DEPS) if p.is_file()) + extra


_NORMAL_Z = None


def _normal_z_table():
    """Z byte of a unit normal for every (x byte, y byte) pair: 128 + 127·sqrt(max(0, 1 − x² − y²))."""
    global _NORMAL_Z
    if _NORMAL_Z is None:
        t = bytearray(65536)
        for xb in range(256):
            x = xb / 127.5 - 1.0
            for yb in range(256):
                y = yb / 127.5 - 1.0
                z = max(0.0, 1.0 - x * x - y * y) ** 0.5
                t[(xb << 8) | yb] = min(255, int(round(127.5 + 127.5 * z)))
        _NORMAL_Z = bytes(t)
    return _NORMAL_Z


def derive_normal_rg(img):
    """RGB tangent-space normal map from a two-channel (BC5: R = X, G = Y, B unused) one: Z rebuilt per pixel."""
    from PIL import Image
    rgb = img.convert('RGB')
    r, g, _ = rgb.split()
    table = _normal_z_table()
    z = bytes(table[(x << 8) | y] for x, y in zip(r.tobytes(), g.tobytes()))
    return Image.merge('RGB', (r, g, Image.frombytes('L', rgb.size, z)))


def derive_rough_from_gloss(img):
    """three.js roughness / metalness map (G = 1 − smoothness from Unity's A, B = metalness 0, R = 1) from a
    Unity metallic/gloss map."""
    from PIL import Image
    rgba = img.convert('RGBA')
    rough = rgba.getchannel('A').point(lambda v: 255 - v)
    return Image.merge('RGB', (Image.new('L', rgba.size, 255), rough, Image.new('L', rgba.size, 0)))


DERIVERS = {'normal_rg': derive_normal_rg, 'rough_from_gloss': derive_rough_from_gloss}


def run_derived(out_root, sub, manifest, log, url='/assets/local'):
    """Write the DERIVED maps of output subdir `sub` (from its exported PNGs) and record them in the manifest."""
    from PIL import Image
    n = 0
    for dsub, src, kind, name in DERIVED:
        if dsub != sub:
            continue
        path = Path(out_root) / sub / f'{src}.png'
        if not path.exists():
            log(f'  derived {name}: source {src} missing')
            continue
        try:
            img = DERIVERS[kind](Image.open(path))
            img.save(Path(out_root) / sub / f'{name}.png')
        except Exception as e:  # a broken source only drops the derived map (the renderer falls back)
            log(f'  warn derived {name}: {e}')
            continue
        manifest.setdefault(sub, {})[name] = {'path': f'{url}/{sub}/{name}.png', 'w': img.width, 'h': img.height,
                                              'kind': 'Derived', 'from': src, 'derive': kind}
        n += 1
    return n


def merge_manifest(old_groups, new_groups, ran_subs):
    """Groups of the previous manifest minus the subdirs that were re-extracted, plus the new ones (sorted keys)."""
    out = {g: v for g, v in (old_groups or {}).items() if g not in ran_subs}
    out.update(new_groups)
    return {g: dict(sorted(out[g].items())) for g in sorted(out)}


def export_bundle(ab_root, job, out_root, manifest, log, public_root=None):
    """Run one JOBS entry over every bundle it covers. `out_root` is the --out argument, the output root of the jobs
    that do not name their own; `public_root` (-–public) is the root a job that does name one is relative to."""
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    rel, sub, kinds, keep, base, mode = job_parts(job)
    bundles = job_bundles(ab_root, rel)
    if not bundles:
        log(f'skip (missing) {rel}')
        return 0
    out = out_root if not base else (public_root or ROOT / 'public') / base
    # The operator art is not part of the local-client board manifest: data/local-assets.json describes
    # public/assets/local/** and is served as such, while the operator art belongs to public/assets/char|spine and is
    # described by data/assets.json (tools/fetch-assets.mjs reads the files, not this manifest). Recording it would
    # only grow that file with entries nothing resolves, and a full run would rewrite it.
    dest = manifest if not base else {}
    url = url_root(base)
    n = 0
    for src in bundles:
        try:
            env = UnityPy.load(str(src))
        except Exception as e:  # corrupt or unsupported bundle: report and continue
            log(f'FAIL load {src.name}: {e}')
            continue
        objects = list(env.objects)  # the job's own objects, listed before any dependency joins the environment
        if mode == 'spine':
            n += export_spine(objects, sub, out, url, dest, log)
            continue
        if mode == 'skill_icon':
            n += export_skill_icons(objects, sub, kinds, keep, out, url, dest, log)
            continue
        for dep in dep_bundles(ab_root, kinds):
            try:
                env.load_file(str(dep))
            except Exception as e:  # a missing shader only leaves that material's shader name null
                log(f'  warn dependency {dep.name}: {e}')
        n += export_objects(objects, src.relative_to(ab_root).as_posix(), sub, kinds, keep, out, url, dest, log)
    return n


def export_objects(objects, rel, sub, kinds, keep, out_root, url, manifest, log):
    """Export the objects of a bundle into <out_root>/<sub> and record them in the manifest."""
    out_dir = out_root / sub
    out_dir.mkdir(parents=True, exist_ok=True)
    seen, n = set(), 0
    materials, prefab, gos, mesh_keys = {}, [], [], {}
    for obj in objects:
        t = obj.type.name
        if t not in kinds:
            continue
        try:
            data = obj.read()
            raw_name = getattr(data, 'm_Name', '') or ''
            if keep is not None and not keep.search(raw_name):
                continue
            name = safe_name(raw_name or f'obj_{obj.path_id}')
            if t in ('Sprite', 'Texture2D'):
                img = data.image
                if img is None or img.width < 2 or img.height < 2:
                    continue
                fname = name + '.png'
                if fname in seen:  # same name twice: a Sprite (true aspect) beats its padded Texture2D
                    if t == 'Texture2D' or manifest.get(sub, {}).get(name, {}).get('kind') == 'Sprite':
                        continue
                img.save(out_dir / fname)
                seen.add(fname)
                manifest.setdefault(sub, {})[name] = {
                    'path': f'{url}/{sub}/{fname}', 'w': img.width, 'h': img.height, 'kind': t}
                n += 1
            elif t == 'TextAsset':
                blob = text_asset_bytes(data)
                if name.endswith('.atlas') or name.endswith('.skel'):
                    fname = name
                elif blob[:1] in (b'\n', b'') or b'size:' in blob[:200]:
                    fname = name + '.atlas'
                else:
                    fname = name + '.skel'
                (out_dir / fname).write_bytes(blob)
                manifest.setdefault(sub, {})[fname] = {'path': f'{url}/{sub}/{fname}', 'kind': t}
                n += 1
            elif t == 'Mesh':
                text = data.export()
                if not text or 'v ' not in text:
                    continue
                fname = name + '.obj'
                if fname in seen:
                    name, fname = f'{name}_{obj.path_id}', f'{name}_{obj.path_id}.obj'
                (out_dir / fname).write_text(text, encoding='utf-8')
                seen.add(fname)
                verts = sum(1 for line in text.splitlines() if line.startswith('v '))
                manifest.setdefault(sub, {})[name] = {'path': f'{url}/{sub}/{fname}', 'kind': 'Mesh', 'verts': verts}
                mesh_keys[obj.path_id] = name
                n += 1
            elif t == 'Material':
                materials[raw_name or name] = material_info(data)
            elif t == 'GameObject':
                gos.append(data)  # summarised after every mesh got its manifest key
        except Exception as e:
            log(f'  warn {rel} #{obj.path_id}: {e}')
    for go in gos:
        try:
            prefab.append(prefab_node(go, mesh_keys))
        except Exception as e:
            log(f'  warn {rel} GameObject: {e}')
    for key, fname, payload in (('materials', 'materials.json', materials), ('prefab', 'prefab.json', prefab)):
        if not payload:
            continue
        if isinstance(payload, list):
            payload = sorted(payload, key=lambda nd: (nd['parent'] or '', nd['name']))
        else:
            payload = dict(sorted(payload.items()))
        (out_dir / fname).write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        manifest.setdefault(sub, {})[key] = {'path': f'{url}/{sub}/{fname}', 'kind': key.capitalize(), 'count': len(payload)}
        n += 1
    n += run_derived(out_root, sub, manifest, log, url)
    log(f'{rel}: {n} files -> {sub}')
    return n


def text_asset_bytes(data):
    """Raw bytes of a Unity TextAsset (UnityPy hands over `str` for text-ish payloads)."""
    raw = data.m_Script
    return raw.encode('utf-8', 'surrogateescape') if isinstance(raw, str) else bytes(raw)


def asset_name(obj):
    """`m_Name` of a Unity object, or '' when it cannot be read."""
    try:
        return getattr(obj.read(), 'm_Name', '') or ''
    except Exception:
        return ''


def _typetree(obj):
    """Typetree of a MonoBehaviour, or None (no type tree in the bundle, or an unsupported type)."""
    if obj is None:
        return None
    try:
        return obj.read_typetree()
    except Exception:
        return None


def atlas_pages(text):
    """Page image names of a Spine atlas, with the same rule as tools/assets/atlas.mjs (a page starts at the first
    non-blank line of the file or after a blank line; its `key: value` fields follow it)."""
    pages = []
    for line in re.split(r'\r\n?|\n', text):
        if not line.strip():
            pages.append(None)
        elif pages and pages[-1] is None:
            pages[-1] = line.strip()
        elif not pages and ':' not in line:
            pages.append(line.strip())
    return [p for p in pages if p]


def spine_refs(objects):
    """{direction: {skel, atlas, pages}} of a chararts bundle (skel/atlas are UnityPy objects, pages a list of
    {'name', 'main', 'alpha'}).

    Arknights ships BOTH directions of an operator's battle Spine in one bundle and names them identically
    (`<charId>.skel`, `<charId>.atlas`, page `<charId>.png`), so nothing about a name says which is Front and which is
    Back — a name-based export would silently keep whichever object came last. The prefab does know: the GameObjects
    `Front` / `Back` carry a SkeletonRenderer whose `skeletonDataAsset` points at the SkeletonDataAsset, which names
    the skeleton TextAsset (`skeletonJSON`) and its Atlas (`atlasAssets`); the Atlas names its `atlasFile` and one
    material per texture page, whose `_MainTex` / `_AlphaTex` are that page's colour and alpha (see page_image)."""
    by_id = {o.path_id: o for o in objects}
    found = {}
    for obj in objects:
        if obj.type.name != 'GameObject':
            continue
        try:
            go = obj.read()
        except Exception:
            continue
        direction = (getattr(go, 'm_Name', '') or '').lower()
        if direction not in ('front', 'back'):
            continue
        for comp in getattr(go, 'm_Component', None) or []:
            pptr = getattr(comp, 'component', comp)
            if getattr(pptr, 'm_FileID', 0):  # external dependency: not in this bundle
                continue
            tree = _typetree(by_id.get(getattr(pptr, 'm_PathID', 0)))
            sda = (tree or {}).get('skeletonDataAsset')
            if not sda:
                continue
            sda_tree = _typetree(by_id.get(sda.get('m_PathID')))
            if not sda_tree:
                continue
            skel = by_id.get((sda_tree.get('skeletonJSON') or {}).get('m_PathID'))
            atlas_tree = next((t for t in (_typetree(by_id.get(a.get('m_PathID')))
                                           for a in (sda_tree.get('atlasAssets') or [])) if t), None)
            atlas = by_id.get((atlas_tree or {}).get('atlasFile', {}).get('m_PathID'))
            pages = []
            for mat in (atlas_tree or {}).get('materials') or []:
                obj_mat = by_id.get((mat or {}).get('m_PathID'))
                if obj_mat is None:
                    continue
                try:
                    data = obj_mat.read()
                except Exception:
                    continue
                page = {'name': None, 'main': None, 'alpha': None}
                for key, tex in (getattr(data.m_SavedProperties, 'm_TexEnvs', None) or []):
                    if key == '_MainTex':
                        page['main'] = by_id.get(getattr(tex.m_Texture, 'm_PathID', 0))
                    elif key == '_AlphaTex':
                        page['alpha'] = by_id.get(getattr(tex.m_Texture, 'm_PathID', 0)) or None
                if page['main'] is not None:
                    page['name'] = asset_name(page['main'])
                    pages.append(page)
            if skel is None or atlas is None or not pages:
                continue
            # the default skin's skeleton is `<charId>.skel`; a skin variant is not — prefer the default
            found[direction] = {'skel': skel, 'atlas': atlas, 'pages': pages,
                                'stem': asset_name(skel).rsplit('.', 1)[0]}
            break
    return found


def page_image(main, alpha):
    """RGBA texture page of a Spine atlas. The client stores a page in either of two ways: as one RGBA texture, or (the
    older split form) as an opaque `_MainTex` plus the alpha in the red channel of a greyscale `_AlphaTex`. The
    released art ships the merged RGBA page, so a page without its alpha would be drawn as an opaque square."""
    from PIL import Image
    img = main.convert('RGBA')
    if img.getchannel('A').getextrema()[0] < 250:  # the colour texture carries its own alpha
        return img
    if alpha is None or alpha.size != img.size:
        return img
    return Image.merge('RGBA', (*img.convert('RGB').split(), alpha.convert('RGB').getchannel('R')))


def js_safe_name(name):
    """tools/assets/sources.mjs safeName() of a name: the asset pipeline names files with it (`plan.mjs` computes every
    local path that way), so the few exports whose name the pipeline then looks up by have to match it character for
    character — the extractor's own safe_name() keeps `[` / `]`, which safeName() turns into '_'
    (`skcom_atk_up[3]` → `skcom_atk_up_3_.png`, `[ucp]TX_water_normal` → `_ucp_TX_water_normal`)."""
    return re.sub(r'[^A-Za-z0-9._-]', '_', str(name)) or '_'


def export_skill_icons(objects, sub, kinds, keep, out_root, url, manifest, log):
    """Export skill icons: the Sprite `skill_icon_<iconId>` of a spritepack/skill_icons_*.ab becomes
    <out_root>/skill/<iconId>.png, the path tools/assets/plan.mjs resolves for the free picks' `skills[]`.

    Two things differ from the object name and both are dictated by the plan pipeline, not by this script: the client's
    `skill_icon_` prefix is dropped, and the rest goes through safeName() (see js_safe_name) because that is how
    plan.mjs builds the local path — so `skcom_atk_up[3]` lands on skill/skcom_atk_up_3_.png."""
    out_dir = out_root / sub
    out_dir.mkdir(parents=True, exist_ok=True)
    n, seen = 0, set()
    for obj in objects:
        if obj.type.name not in kinds:
            continue
        try:
            data = obj.read()
            raw_name = getattr(data, 'm_Name', '') or ''
            if not raw_name.startswith(SKILL_ICON_PREFIX):
                continue
            if keep is not None and not keep.search(raw_name):
                continue
            name = js_safe_name(raw_name[len(SKILL_ICON_PREFIX):])
            if name in seen:
                continue
            img = data.image
            if img is None or img.width < 2 or img.height < 2:
                continue
            img.save(out_dir / f'{name}.png')
            seen.add(name)
            manifest.setdefault(sub, {})[name] = {
                'path': f'{url}/{sub}/{name}.png', 'w': img.width, 'h': img.height, 'kind': obj.type.name}
            n += 1
        except Exception as e:
            log(f'  warn skill icon #{obj.path_id}: {e}')
    log(f'{n} skill icons -> {sub}')
    return n


def export_spine(objects, sub, out_root, url, manifest, log):
    """Export an operator's battle Spine: <out_root>/spine/op/<charId>/<front|back>/<charId>.{skel,atlas,png}."""
    cid = sub.rsplit('/', 1)[-1]
    refs = spine_refs(objects)
    if not refs:
        log(f'  skip (no Spine prefab) {sub}')
        return 0
    n = 0
    for direction in ('front', 'back'):
        ref = refs.get(direction)
        if not ref:
            log(f'  warn {cid}: no {direction} Spine in the bundle')
            continue
        if ref['stem'] and ref['stem'] != cid:
            log(f'  warn {cid}: the {direction} skeleton is named {ref["stem"]}')
        try:
            skel = text_asset_bytes(ref['skel'].read())
            atlas = text_asset_bytes(ref['atlas'].read())
        except Exception as e:
            log(f'  warn {cid} {direction}: {e}')
            continue
        out_dir = out_root / sub / direction
        out_dir.mkdir(parents=True, exist_ok=True)
        for fname, blob in ((f'{cid}.skel', skel), (f'{cid}.atlas', atlas)):
            (out_dir / fname).write_bytes(blob)
            manifest.setdefault(sub, {})[f'{direction}/{fname}'] = {
                'path': f'{url}/{sub}/{direction}/{fname}', 'kind': 'TextAsset'}
            n += 1
        # One page file per atlas page — the atlas is authoritative (spine.mjs requires every page it lists to exist,
        # and an extra file would be an orphan). Its materials are in the same order and are named after their page
        # (`char_1052_kalts2` / `char_1052_kalts22` for the two pages of that skeleton), so they are matched by name
        # and fall back to the position.
        names = atlas_pages(atlas.decode('utf-8', 'replace')) or [f'{p["name"]}.png' for p in ref['pages'] if p['name']]
        for i, want in enumerate(names):
            stem = want.rsplit('.', 1)[0]
            src = next((p for p in ref['pages'] if p['name'] == stem), None)
            if src is None and i < len(ref['pages']):
                src = ref['pages'][i]
            if src is None or src['main'] is None:
                log(f'  warn {cid} {direction}: no texture for atlas page {want}')
                continue
            try:
                img = page_image(src['main'].read().image, src['alpha'].read().image if src['alpha'] else None)
            except Exception as e:
                log(f'  warn {cid} {direction}: page {want}: {e}')
                continue
            fname = js_safe_name(want)
            img.save(out_dir / fname)
            manifest.setdefault(sub, {})[f'{direction}/{fname}'] = {
                'path': f'{url}/{sub}/{direction}/{fname}', 'w': img.width, 'h': img.height, 'kind': 'Texture2D'}
            n += 1
            log(f'    {direction} page {fname} {img.width}x{img.height} (alpha {img.getchannel("A").getextrema()})')
        log(f'  {cid} {direction}: skel {len(skel)} B, atlas {len(atlas)} B, {len(names)} page(s)')
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', help='AssetBundle root (…/StreamingAssets/AB/Windows or …/Documents/Bundles)')
    ap.add_argument('--out', default=str(ROOT / 'public/assets/local'))
    ap.add_argument('--public', default=str(ROOT / 'public'),
                    help='root the jobs that name their own output (the operator art: char/, spine/) write under; '
                         'point it at a scratch tree to extract without touching public/assets')
    ap.add_argument('--manifest', default=str(ROOT / 'data/local-assets.json'))
    ap.add_argument('--only', action='append', default=[], metavar='SUBDIR',
                    help='only run the jobs whose output subdir starts with this prefix (repeatable), e.g. emoticon')
    ap.add_argument('--print-jobs', action='store_true', help='print the job table as JSON and exit')
    args = ap.parse_args()

    if args.print_jobs:
        jobs = [{'bundle': rel, 'sub': sub, 'kinds': sorted(kinds), 'keep': keep.pattern if keep else None,
                 'base': base, 'mode': mode}
                for rel, sub, kinds, keep, base, mode in map(job_parts, JOBS)]
        derived = [{'sub': sub, 'from': src, 'derive': kind, 'name': name} for sub, src, kind, name in DERIVED]
        print(json.dumps({'emoteThemes': [{'themeId': t, 'dir': d} for t, d in EMOTE_THEMES], 'jobs': jobs,
                          'derived': derived}, ensure_ascii=False))
        return 0

    ab_root = Path(args.game) if args.game else next((p for p in CANDIDATES if p.exists()), None)
    if not ab_root or not ab_root.exists():
        print('No Arknights install found. Pass --game <AssetBundle root>.', file=sys.stderr)
        return 2
    jobs = select_jobs(args.only)
    if not jobs:
        print(f'--only {args.only}: no job matches', file=sys.stderr)
        return 2
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    public_root = Path(args.public)
    manifest, total = {}, 0
    print(f'AB root: {ab_root}')
    for job in jobs:
        total += export_bundle(ab_root, job, out_root, manifest, print, public_root)
    old = {}
    if args.only and Path(args.manifest).exists():
        try:
            old = json.loads(Path(args.manifest).read_text(encoding='utf-8')).get('groups') or {}
        except (OSError, ValueError) as e:
            print(f'warn: previous manifest unreadable ({e}); writing only the re-extracted groups', file=sys.stderr)
    groups = merge_manifest(old, manifest, set(manifest))  # a missing bundle keeps its previous group
    count = sum(len(v) for v in groups.values())
    doc = {'version': 1, 'source': 'local-client', 'count': count, 'groups': groups}
    Path(args.manifest).write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'done: {total} files extracted, manifest {args.manifest} ({count} entries)')
    return 0 if total else 1


if __name__ == '__main__':
    sys.exit(main())
