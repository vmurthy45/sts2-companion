#!/usr/bin/env python3
"""Read facts Spire Codex can't give us straight from the installed game's code (sts2.dll).

1. Event sources: which event hands out which relic or card.

Spire Codex's event text names some event relics, but many (Sword of Jade, The Boot,
Bing Bong...) are only granted in code. This reads the locally installed sts2.dll
(.NET metadata, no decompiler needed), looks at every method of every event class
(including the compiler-generated async state machines nested inside them), and
records each Relic / Card model type those methods reference.

   -> data/event_sources.json {"relics": {RELIC_ID: [EVENT_ID...]}, "cards": {...}}
2. Monster scaling: every monster value written as
     AscensionHelper.GetValueIfAscension(level, ascValue, normalValue)   (+ Dread bonus)
   or AscensionHelper.IsDread ? dreadValue : normalValue
   which gives the exact ascension level each value changes at, and Dread mode values.
   -> data/monster_code.json {MONSTER_ID: {Property: {lvl, a, n, dadd | dval}}}
3. Encounter line-ups: how many of each monster an encounter's GenerateMonsters() creates
   (Spire Codex lists each monster type once), which slots are random, and Dread differences.
   -> data/encounter_code.json {ENCOUNTER_ID: {fixed: {M: n}, random: {n, from: [M]}, pool: [M], dread: {M: n}}}

build_data.py merges both. Run after a patch on a Mac with the game installed
(either branch): needs `pip install dnfile`. The Mac's launchd agent does this automatically.

Usage: python3 tools/game_code.py [path/to/sts2.dll]
"""
import json, os, re, sys, glob
import dnfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_GLOBS = [
    '~/Library/Application Support/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.app/Contents/Resources/data_sts2_macos_*/sts2.dll',
    '~/.steam/steam/steamapps/common/Slay the Spire 2/data_sts2_*/sts2.dll',
    'C:/Program Files (x86)/Steam/steamapps/common/Slay the Spire 2/data_sts2_*/sts2.dll',
]
NS_EVENTS = 'MegaCrit.Sts2.Core.Models.Events'
NS_RELICS = 'MegaCrit.Sts2.Core.Models.Relics'
NS_CARDS = 'MegaCrit.Sts2.Core.Models.Cards'
TOKEN_OPS = {0x28, 0x6F, 0x73, 0xD0, 0x8D, 0x74, 0x75}  # call callvirt newobj ldtoken newarr castclass isinst


def snake(name):
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', '_', name).upper()


def find_dll():
    if len(sys.argv) > 1:
        return sys.argv[1]
    for g in DEFAULT_GLOBS:
        hits = sorted(glob.glob(os.path.expanduser(g)))
        if hits:
            return hits[-1]
    sys.exit('sts2.dll not found; pass its path')


def main():
    dll = find_dll()
    pe = dnfile.dnPE(dll)
    md = pe.net.mdtables
    types = list(md.TypeDef)
    methods = list(md.MethodDef)

    # method index (1-based) -> owning type index (1-based), via MethodList ranges
    starts = [t.MethodList[0].row_index if t.MethodList else None for t in types]
    owner = {}
    for ti, t in enumerate(types, 1):
        for m in t.MethodList or []:
            owner[m.row_index] = ti

    # nested type -> enclosing type
    enclosing = {}
    for n in md.NestedClass or []:
        enclosing[n.NestedClass.row_index] = n.EnclosingClass.row_index

    def top(ti):
        while ti in enclosing:
            ti = enclosing[ti]
        return ti

    def tname(ti):
        t = types[ti - 1]
        return str(t.TypeNamespace), str(t.TypeName)

    kind = {}  # typedef index -> ('relic'|'card', ID)
    for ti, t in enumerate(types, 1):
        ns, nm = str(t.TypeNamespace), str(t.TypeName)
        if ns == NS_RELICS and not nm.startswith('<'):
            kind[ti] = ('relic', snake(nm))
        elif ns == NS_CARDS and not nm.startswith('<'):
            kind[ti] = ('card', snake(nm))

    # blob helpers for MethodSpec instantiations / TypeSpecs
    def uncompress(b, i):
        x = b[i]
        if x & 0x80 == 0:
            return x, i + 1
        if x & 0xC0 == 0x80:
            return ((x & 0x3F) << 8) | b[i + 1], i + 2
        return ((x & 0x1F) << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3], i + 4

    def typedefs_in_sig(b):
        out, i = [], 0
        while i < len(b):
            if b[i] in (0x12, 0x11):  # CLASS / VALUETYPE followed by TypeDefOrRef coded index
                v, j = uncompress(b, i + 1)
                if v & 3 == 0:
                    out.append(v >> 2)
                i = j
            else:
                i += 1
        return out

    def blob(v):
        return bytes(v.value if hasattr(v, 'value') else v)

    def resolve(tok):
        table, row = tok >> 24, tok & 0xFFFFFF
        try:
            if table == 0x02:
                return [row]
            if table == 0x06:
                return [owner.get(row)]
            if table == 0x2B:
                ms = md.MethodSpec[row - 1]
                res = typedefs_in_sig(blob(ms.Instantiation))
                meth = ms.Method
                if meth and meth.table and meth.table.name == 'MethodDef':
                    res.append(owner.get(meth.row_index))
                return res
            if table == 0x1B:
                return typedefs_in_sig(blob(md.TypeSpec[row - 1].Signature))
            if table == 0x0A:
                mr = md.MemberRef[row - 1]
                c = mr.Class
                if c and c.table and c.table.name == 'TypeDef':
                    return [c.row_index]
                if c and c.table and c.table.name == 'TypeSpec':
                    return typedefs_in_sig(blob(md.TypeSpec[c.row_index - 1].Signature))
        except Exception:
            pass
        return []

    found = {'relics': {}, 'cards': {}}
    for mi, m in enumerate(methods, 1):
        ti = owner.get(mi)
        if not ti or not m.Rva:
            continue
        tt = top(ti)
        ns, nm = tname(tt)
        if ns != NS_EVENTS:
            continue
        event_id = snake(nm)
        try:
            hdr = pe.get_data(m.Rva, 12)
            if hdr[0] & 3 == 2:
                code = pe.get_data(m.Rva + 1, hdr[0] >> 2)
            else:
                size = int.from_bytes(hdr[4:8], 'little')
                code = pe.get_data(m.Rva + (hdr[1] >> 4) * 4, size)
        except Exception:
            continue
        for i in range(len(code) - 4):
            if code[i] in TOKEN_OPS:
                tok = int.from_bytes(code[i + 1:i + 5], 'little')
                if (tok >> 24) not in (0x02, 0x06, 0x0A, 0x1B, 0x2B):
                    continue
                for t in resolve(tok):
                    if t in kind and top(t) != tt:
                        k, obj = kind[t]
                        found[k + 's'].setdefault(obj, set()).add(event_id)

    out = {k: {o: sorted(v) for o, v in sorted(d.items())} for k, d in found.items()}
    monsters = monster_values(pe, md, types, methods, owner, top, tname)
    mpath = os.path.join(ROOT, 'data', 'monster_code.json')
    json.dump(monsters, open(mpath, 'w'), indent=1, sort_keys=True)
    print(f"{len(monsters)} monsters with ascension/Dread values -> {mpath}")
    encs = encounter_lineups(pe, md, types, methods, owner, top, tname)
    epath = os.path.join(ROOT, 'data', 'encounter_code.json')
    json.dump(encs, open(epath, 'w'), indent=1, sort_keys=True)
    print(f"{len(encs)} encounter line-ups -> {epath}")
    out['source'] = os.path.basename(os.path.dirname(dll))
    path = os.path.join(ROOT, 'data', 'event_sources.json')
    json.dump(out, open(path, 'w'), indent=1, sort_keys=True)
    print(f"{len(out['relics'])} relics, {len(out['cards'])} cards linked to events -> {path}")


NS_ENCOUNTERS = 'MegaCrit.Sts2.Core.Models.Encounters'


def encounter_lineups(pe, md, types, methods, owner, top, tname):
    """Count the monsters GenerateMonsters() creates. Each creation is
    ModelDb.Monster<T>() ... .ToMutable(); random picks go through Rng.NextItem.
    Only clear patterns get exact counts; anything else is marked random."""
    def uncompress(b, i):
        x = b[i]
        if x & 0x80 == 0: return x, i + 1
        if x & 0xC0 == 0x80: return ((x & 0x3F) << 8) | b[i + 1], i + 2
        return ((x & 0x1F) << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3], i + 4

    def name_of(tok):
        t, r = tok >> 24, tok & 0xFFFFFF
        try:
            if t == 0x06:
                return str(methods[r - 1].Name)
            if t == 0x0A:
                return str(md.MemberRef[r - 1].Name)
            if t == 0x2B:
                ms = md.MethodSpec[r - 1]
                b = bytes(ms.Instantiation.value if hasattr(ms.Instantiation, 'value') else ms.Instantiation)
                mm = ms.Method
                base = str(methods[mm.row_index - 1].Name) if mm.table.name == 'MethodDef' else str(md.MemberRef[mm.row_index - 1].Name)
                if base == 'Monster':
                    i = 0
                    while i < len(b):
                        if b[i] in (0x12, 0x11):
                            v, j = uncompress(b, i + 1)
                            if v & 3 == 0:
                                return 'Monster:' + snake(str(types[(v >> 2) - 1].TypeName))
                            i = j
                        else:
                            i += 1
                return base
        except Exception:
            pass
        return '?'

    def calls_of(m):
        hdr = pe.get_data(m.Rva, 12)
        code = pe.get_data(m.Rva + 1, hdr[0] >> 2) if hdr[0] & 3 == 2 else \
            pe.get_data(m.Rva + (hdr[1] >> 4) * 4, int.from_bytes(hdr[4:8], 'little'))
        return [x[1] for x in il_seq(code, name_of) if x[0] == 'call']

    per = {}
    for mi, m in enumerate(methods, 1):
        ti = owner.get(mi)
        if not ti or not m.Rva:
            continue
        tt = top(ti)
        ns, tn = tname(tt)
        if ns != NS_ENCOUNTERS or tn.startswith('<'):
            continue
        name = str(m.Name)
        nested = ti != tt
        try:
            calls = calls_of(m)
        except Exception:
            continue
        e = per.setdefault(snake(tn), {'gen': [], 'lambda': [], 'pool': set(), 'all': set()})
        if name == 'GenerateMonsters' and not nested:
            e['gen'] = calls
        elif nested and 'GenerateMonsters' in str(types[ti - 1].TypeName) + name:
            e['lambda'] += calls
        if name == '.cctor' or nested:      # static pools / lambdas: candidates for random slots
            e['pool'] |= {c[8:] for c in calls if c.startswith('Monster:')}
        if name == 'get_AllPossibleMonsters':  # everything that can be in the fight, summons included
            e['all'] |= {c[8:] for c in calls if c.startswith('Monster:')}

    out = {}
    for eid, e in per.items():
        gen = e['gen']
        if not gen:
            continue
        rec = {}
        has_random = any(c in ('NextItem', 'NextBool', 'NextInt', 'Shuffle') for c in gen)
        # creations: Monster<T> then ToMutable = one monster (None = picked at random);
        # Monster<T> straight into list.Add = one monster made mutable later in a lambda.
        # `made` keeps run breaks (other calls) so IsDread branches can be told apart.
        made, pending, breaks = [], None, []
        for c in gen:
            if c.startswith('Monster:'):
                pending = c[8:]
            elif c == 'ToMutable' or (c == 'Add' and pending):
                made.append(pending)
                pending = None
            elif c not in ('get_Rng', 'NextItem'):
                if made and (not breaks or breaks[-1] != len(made)):
                    breaks.append(len(made))
                pending = None if c in ('.ctor', 'SetCount') else pending
        fixed = {}
        for t in made:
            if t:
                fixed[t] = fixed.get(t, 0) + 1
        unknown = made.count(None)
        mentioned = {c[8:] for c in gen if c.startswith('Monster:')}
        if 'IsDread' in gen:
            # IsDread ? [run A] : [run B]  -> the first run of a type is the Dread line-up
            runs, cur = [], None
            for i, t in enumerate(made):
                if cur and cur[0] == t and i not in breaks:
                    cur[1] += 1
                else:
                    cur = [t, 1]; runs.append(cur)
            seen, dread, normal = {}, {}, {}
            for t, n in runs:
                if t in seen:
                    dread[t], normal[t] = seen[t], n
                else:
                    seen[t] = n
            if dread:
                for t in dread:
                    fixed[t] = normal[t]
                rec['dread'] = {t: dread[t] for t in dread}
        if fixed:
            rec['fixed'] = fixed
        rpool = (e['pool'] | mentioned) - set(fixed) - set(rec.get('dread', {}))
        if has_random or unknown:
            exact = unknown and 'Where' not in gen and 'ToMutable' not in e['lambda']
            if rpool or unknown:   # RNG used only to order/vary a fixed line-up is not a random slot
                rec['random'] = {'n': unknown if exact else None, 'from': sorted(rpool)}
        summons = e['all'] - set(fixed) - set(rec.get('dread', {})) - (rpool if 'random' in rec else set())
        if summons:
            rec['summons'] = sorted(summons)
        out[eid] = rec
    return out


NS_MONSTERS = 'MegaCrit.Sts2.Core.Models.Monsters'
ONE_BYTE_ARG = {0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x1F, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0xDE}
FOUR_BYTE_ARG = {0x20, 0x22, 0x28, 0x29, 0x6F, 0x73, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F, 0x40, 0x41, 0x42, 0x43, 0x44, 0xDD,
                 0x70, 0x71, 0x72, 0x74, 0x75, 0x79, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F, 0x80, 0x81, 0x8C, 0x8D, 0x8F, 0xA3, 0xA4, 0xA5, 0xC2, 0xC6, 0xD0}


def il_seq(code, name_of):
    """Very small IL walker: returns ints pushed by ldc.i4* and names of called methods, in order."""
    out, i = [], 0
    while i < len(code):
        op = code[i]
        if op == 0xFE:
            sub = code[i + 1] if i + 1 < len(code) else 0
            i += 2 + (2 if sub in (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E) else 4 if sub in (0x06, 0x07, 0x15, 0x16, 0x1C, 0x1D) else 0)
            if sub == 0x03:  # cgt.un  (bool -> int)
                out.append(('cgt',))
            continue
        if 0x16 <= op <= 0x1E:
            out.append(('i4', op - 0x16)); i += 1; continue
        if op == 0x15:
            out.append(('i4', -1)); i += 1; continue
        if op == 0x1F:
            out.append(('i4', int.from_bytes(code[i + 1:i + 2], 'little', signed=True))); i += 2; continue
        if op == 0x20:
            out.append(('i4', int.from_bytes(code[i + 1:i + 5], 'little', signed=True))); i += 5; continue
        if op in (0x28, 0x6F, 0x73):
            out.append(('call', name_of(int.from_bytes(code[i + 1:i + 5], 'little')))); i += 5; continue
        if op == 0x45:
            i += 5 + 4 * int.from_bytes(code[i + 1:i + 5], 'little'); continue
        if op == 0x21 or op == 0x23:
            i += 9; continue
        if op in ONE_BYTE_ARG:
            i += 2; continue
        if op in FOUR_BYTE_ARG:
            i += 5; continue
        i += 1
    return out


def monster_values(pe, md, types, methods, owner, top, tname):
    def name_of(tok):
        t, r = tok >> 24, tok & 0xFFFFFF
        try:
            if t == 0x06:
                return str(methods[r - 1].Name)
            if t == 0x0A:
                return str(md.MemberRef[r - 1].Name)
            if t == 0x2B:
                m = md.MethodSpec[r - 1].Method
                return str(methods[m.row_index - 1].Name) if m.table.name == 'MethodDef' else str(md.MemberRef[m.row_index - 1].Name)
        except Exception:
            pass
        return '?'

    res = {}
    for mi, m in enumerate(methods, 1):
        ti = owner.get(mi)
        name = str(m.Name)
        if not ti or not m.Rva or not name.startswith('get_'):
            continue
        ns, tn = tname(ti)
        if ns != NS_MONSTERS or tn.startswith('<'):
            continue
        try:
            hdr = pe.get_data(m.Rva, 12)
            code = pe.get_data(m.Rva + 1, hdr[0] >> 2) if hdr[0] & 3 == 2 else \
                pe.get_data(m.Rva + (hdr[1] >> 4) * 4, int.from_bytes(hdr[4:8], 'little'))
        except Exception:
            continue
        seq = il_seq(code, name_of)
        calls = [x[1] for x in seq if x[0] == 'call']
        if 'GetValueIfAscension' not in calls and 'IsDread' not in calls:
            continue
        if any(c in calls for c in ('InitializeArray',)):
            continue
        rec = {}
        ints = lambda xs: [x[1] for x in xs if x[0] == 'i4']
        if 'GetValueIfAscension' in calls:
            gi = next(i for i, x in enumerate(seq) if x == ('call', 'GetValueIfAscension'))
            pre = ints(seq[:gi])
            if len(pre) < 3:
                continue
            rec.update(lvl=pre[-3], a=pre[-2], n=pre[-1])
            if 'IsDread' in calls:
                di = next(i for i, x in enumerate(seq) if x == ('call', 'IsDread'))
                post = seq[di + 1:]
                vals = ints(post)
                if any(x[0] == 'cgt' for x in post) and len(vals) <= 1:
                    rec['dadd'] = 1                      # value + (IsDread ? 1 : 0)
                elif len(vals) >= 2 and vals[0] == 0:
                    rec['dadd'] = vals[1]                # value + (IsDread ? X : 0)
                else:
                    continue
        else:
            di = next(i for i, x in enumerate(seq) if x == ('call', 'IsDread'))
            vals = ints(seq[di + 1:])
            if len(vals) != 2 or len(calls) != 1:
                continue
            rec.update(n=vals[0], dval=vals[1])          # IsDread ? dval : n
        res.setdefault(snake(tn), {})[name[4:]] = rec
    return res


if __name__ == '__main__':
    main()
