#!/usr/bin/env python3
"""Work out which event hands out which relic or card, straight from the game's code.

Spire Codex's event text names some event relics, but many (Sword of Jade, The Boot,
Bing Bong...) are only granted in code. This reads the locally installed sts2.dll
(.NET metadata, no decompiler needed), looks at every method of every event class
(including the compiler-generated async state machines nested inside them), and
records each Relic / Card model type those methods reference.

Writes data/event_sources.json: {"relics": {RELIC_ID: [EVENT_ID...]}, "cards": {...}, "build": ...}
build_data.py merges it with the text matches. Run it after a patch on a Mac with the
game installed (either branch): needs `pip install dnfile`.

Usage: python3 tools/event_sources.py [path/to/sts2.dll]
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
    out['source'] = os.path.basename(os.path.dirname(dll))
    path = os.path.join(ROOT, 'data', 'event_sources.json')
    json.dump(out, open(path, 'w'), indent=1, sort_keys=True)
    print(f"{len(out['relics'])} relics, {len(out['cards'])} cards linked to events -> {path}")


if __name__ == '__main__':
    main()
