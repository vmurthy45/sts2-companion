#!/usr/bin/env python3
"""Build the app's data bundles from Spire Codex's extracted game data.

Spire Codex (github.com/ptrlrd/spire-codex, PolyForm Noncommercial) decompiles
every Slay the Spire 2 patch and commits the results as JSON:
  data/eng/*.json                 -> current main (public) branch
  data-beta/<latest>/eng/*.json   -> current Steam public-beta branch

This script sparse-clones just those folders, trims them to what the app shows,
links event relics/cards to the events that give them, and writes
  data/main.json, data/beta.json, data/meta.json
Files are only rewritten when their content changes, so the daily GitHub Action
commits nothing on days without a patch.

Usage: python3 tools/build_data.py [--src /path/to/existing/spire-codex/clone]
"""
import json, os, re, subprocess, sys, tempfile, hashlib, datetime

REPO = 'https://github.com/ptrlrd/spire-codex.git'
CDN = 'https://cdn.spire-codex.com/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data')


def sh(*a, cwd=None):
    return subprocess.run(a, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def fetch_source():
    if '--src' in sys.argv:
        return sys.argv[sys.argv.index('--src') + 1]
    d = tempfile.mkdtemp(prefix='codex-')
    sh('git', 'clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', REPO, d)
    sh('git', 'sparse-checkout', 'set', '--no-cone', '/data/eng/', '/data/changelogs/', '/data/ancient_pools_parsed.json', '/data-beta/latest', cwd=d)
    beta = os.readlink(os.path.join(d, 'data-beta', 'latest'))
    sh('git', 'sparse-checkout', 'add', f'/data-beta/{beta}/eng/', f'/data-beta/{beta}/ancient_pools_parsed.json', f'/data-beta/{beta}/changelogs/', cwd=d)
    return d


def vkey(v):
    return [int(x) if x.isdigit() else x for x in re.split(r'[.\-]', v.lstrip('v'))]


def img(u):
    if not u:
        return None
    return CDN + re.sub(r'^/static/images/', '', u)


def load(folder, name):
    p = os.path.join(folder, name + '.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []


def strings(o):
    """Every string inside a nested JSON value."""
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)


def prune(o):
    """Drop null / empty values to keep bundles small."""
    if isinstance(o, dict):
        return {k: prune(v) for k, v in o.items() if v not in (None, [], {}, '')}
    if isinstance(o, list):
        return [prune(v) for v in o]
    return o


ACT_LABEL = {'Act 1 - Overgrowth': 'Overgrowth', 'Act 1 - Underdocks': 'Underdocks', 'Underdocks': 'Underdocks',
             'Act 2 - Hive': 'Hive', 'Act 3 - Glory': 'Glory'}


def act_of(label, enc_id=''):
    if label in ACT_LABEL:
        return ACT_LABEL[label]
    if label and '/' in label:
        return label.replace('Act 1 - ', '')
    return 'Event' if 'EVENT' in enc_id else 'Other'


def build(folder, pools_path):
    acts = load(folder, 'acts')
    act_names = {a['id']: a['name'] for a in acts}
    act_index = {a['name']: a['index'] for a in acts}
    event_acts, ancient_acts = {}, {}
    for a in acts:
        for e in a.get('events') or []:
            event_acts.setdefault(e, []).append(a['name'])
        for an in a.get('ancients') or []:
            ancient_acts.setdefault(an, []).append(a['name'])

    events_raw = load(folder, 'events')
    events = []
    for e in events_raw:
        acts_for = event_acts.get(e['id']) or ([] if not e.get('act') else
                                               [act_of(x.strip()) for x in e['act'].replace('Act 1 - ', '').split('/')])
        events.append({
            'id': e['id'], 'name': e['name'], 'type': e.get('type'), 'acts': acts_for,
            'desc': e.get('description'), 'pre': e.get('preconditions'),
            'options': e.get('options'),
            'pages': [{'id': p.get('id'), 'desc': p.get('description'), 'options': p.get('options')} for p in e.get('pages') or []],
        })
    event_text = {e['id']: '\n'.join(strings(e)) for e in events_raw}

    event_ids = {e['id'] for e in events_raw}
    ancient_ids = {an for a in acts for an in a.get('ancients') or []}
    # Links read from the game's code by tools/event_sources.py (covers relics the event text never names)
    code = {}
    sp = os.path.join(OUT, 'event_sources.json')
    if os.path.exists(sp):
        code = json.load(open(sp, encoding='utf-8'))

    def sources(name, oid, kind):
        pat = re.compile(r'(?<![\w])' + re.escape(name) + r'(?![\w])')
        found = {eid for eid, t in event_text.items() if pat.search(t)}
        found |= set(code.get(kind, {}).get(oid, []))
        return sorted(e for e in found if e in event_ids and e not in ancient_ids)

    ancient_of = {}
    if pools_path and os.path.exists(pools_path):
        for p in json.load(open(pools_path, encoding='utf-8')):
            for r in p.get('relics') or []:
                ancient_of.setdefault(r, []).append(p['id'])
            pcr = p.get('per_character_relics') or []
            for r in (sum(pcr.values(), []) if isinstance(pcr, dict) else pcr):
                ancient_of.setdefault(r, []).append(p['id'])

    relics = []
    for r in load(folder, 'relics'):
        rar = r.get('rarity_key') or r.get('rarity', '').replace(' Relic', '')
        o = {'id': r['id'], 'name': r['name'], 'rarity': rar, 'pool': r.get('pool'),
             'desc': r.get('description'), 'flavor': r.get('flavor'), 'img': img(r.get('image_url')),
             'price': (r.get('merchant_price') or {}).get('base'), 'notes': r.get('notes'), 'order': r.get('compendium_order')}
        o['events'] = sources(r['name'], r['id'], 'relics') if rar == 'Event' else \
            sorted(e for e in code.get('relics', {}).get(r['id'], []) if e in event_ids and e not in ancient_ids)
        if r['id'] in ancient_of:
            o['ancients'] = ancient_of[r['id']]
        relics.append(o)

    cards = []
    for c in load(folder, 'cards'):
        o = {'id': c['id'], 'name': c['name'], 'color': c.get('color'), 'type': c.get('type'), 'rarity': c.get('rarity'),
             'cost': c.get('cost'), 'x': c.get('is_x_cost'), 'star': c.get('star_cost'), 'xstar': c.get('is_x_star_cost'),
             'target': c.get('target'), 'desc': c.get('description'), 'udesc': c.get('upgrade_description'),
             'up': c.get('upgrade'), 'kw': c.get('keywords'), 'tags': c.get('tags'),
             'img': img(c.get('image_url')), 'bimg': img(c.get('beta_image_url')), 'order': c.get('compendium_order')}
        o['events'] = sources(c['name'], c['id'], 'cards') if c.get('rarity') == 'Event' else \
            sorted(e for e in code.get('cards', {}).get(c['id'], []) if e in event_ids and e not in ancient_ids)
        cards.append(o)

    # Relics/cards an event card turns into (e.g. Byrdonis Egg hatches into Byrdpip) inherit its events
    for o in relics + cards:
        if o.get('rarity') == 'Event' and not o.get('events'):
            pat = re.compile(r'(?<![\w])' + re.escape(o['name']) + r'(?![\w])')
            via = sorted({e for c in cards if c.get('events') and c['id'] != o['id']
                          and pat.search((c.get('desc') or '') + (c.get('udesc') or '')) for e in c['events']})
            if via:
                o['events'] = via

    encounters = []
    for e in load(folder, 'encounters'):
        encounters.append({'id': e['id'], 'name': e['name'], 'room': e.get('room_type'), 'weak': e.get('is_weak'),
                           'act': act_of(e.get('act'), e['id']), 'tags': e.get('tags'),
                           'monsters': [m['id'] for m in e.get('monsters') or []]})
    enc_by_id = {e['id']: e for e in encounters}

    monsters = []
    for m in load(folder, 'monsters'):
        encs = [x['encounter_id'] for x in m.get('encounters') or []]
        monsters.append({
            'id': m['id'], 'name': m['name'], 'type': m.get('type'),
            'hp': [m.get('min_hp'), m.get('max_hp'), m.get('min_hp_ascension'), m.get('max_hp_ascension')],
            'moves': m.get('moves'), 'pattern': m.get('attack_pattern'), 'innate': m.get('innate_powers'),
            'encounters': encs,
            'acts': sorted({enc_by_id[x]['act'] for x in encs if x in enc_by_id}, key=lambda a: act_index.get(a, 9)),
            'img': img(m.get('image_url')),
        })

    powers = [{'id': p['id'], 'name': p['name'], 'type': p.get('type'), 'desc': p.get('description'),
               'img': img(p.get('image_url'))} for p in load(folder, 'powers')]
    potions = [{'id': p['id'], 'name': p['name'], 'rarity': p.get('rarity_key') or p.get('rarity'), 'pool': p.get('pool'),
                'desc': p.get('description'), 'img': img(p.get('image_url'))} for p in load(folder, 'potions')]
    characters = [{'id': c['id'], 'name': c['name'], 'desc': c.get('description'), 'hp': c.get('starting_hp'),
                   'gold': c.get('starting_gold'), 'energy': c.get('max_energy'), 'orbs': c.get('orb_slots'),
                   'deck': c.get('starting_deck'), 'relics': c.get('starting_relics'), 'color': c.get('color')}
                  for c in load(folder, 'characters')]
    ascensions = [{'level': a['level'], 'name': a['name'], 'desc': a.get('description')} for a in load(folder, 'ascensions')]
    keywords = load(folder, 'keywords')
    intents = load(folder, 'intents')

    return prune({
        'acts': [{'id': a['id'], 'name': a['name'], 'index': a['index'], 'bosses': a.get('bosses'),
                  'ancients': a.get('ancients'), 'events': a.get('events'), 'encounters': a.get('encounters')} for a in acts],
        'ascensions': ascensions, 'characters': characters, 'cards': cards, 'relics': relics,
        'monsters': monsters, 'encounters': encounters, 'events': events, 'powers': powers,
        'potions': potions, 'keywords': keywords, 'intents': intents,
    })


def changelog(folder):
    """Latest changelog JSON for this branch, if Codex has one."""
    d = os.path.join(folder, 'changelogs')
    if not os.path.isdir(d):
        return None, None
    names = sorted((f[:-5] for f in os.listdir(d) if f.endswith('.json')), key=vkey)
    if not names:
        return None, None
    return names[-1], json.load(open(os.path.join(d, names[-1] + '.json'), encoding='utf-8'))


def write_if_changed(path, obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=False)
    old = open(path, encoding='utf-8').read() if os.path.exists(path) else None
    if old != s:
        open(path, 'w', encoding='utf-8').write(s)
        return True
    return False


def main():
    src = fetch_source()
    os.makedirs(OUT, exist_ok=True)
    beta_ver = os.readlink(os.path.join(src, 'data-beta', 'latest'))
    main_ver, main_cl = changelog(os.path.join(src, 'data'))
    _, beta_cl = changelog(os.path.join(src, 'data-beta', beta_ver))
    commit = sh('git', 'rev-parse', '--short', 'HEAD', cwd=src)

    meta_path = os.path.join(OUT, 'meta.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    today = datetime.date.today().isoformat()
    changed = []
    for branch, folder, pools, ver, cl in [
        ('main', os.path.join(src, 'data', 'eng'), os.path.join(src, 'data', 'ancient_pools_parsed.json'), main_ver, main_cl),
        ('beta', os.path.join(src, 'data-beta', beta_ver, 'eng'), os.path.join(src, 'data-beta', beta_ver, 'ancient_pools_parsed.json'), beta_ver.lstrip('v'), beta_cl),
    ]:
        bundle = build(folder, pools)
        bundle['version'] = ver
        bundle['changelog'] = cl
        if write_if_changed(os.path.join(OUT, branch + '.json'), bundle):
            changed.append(branch)
            meta[branch] = {'version': ver, 'updated': today}
        meta.setdefault(branch, {'version': ver, 'updated': today})
        meta[branch]['counts'] = {k: len(bundle.get(k, [])) for k in ('cards', 'relics', 'monsters', 'encounters', 'events', 'potions')}
        h = hashlib.sha1(open(os.path.join(OUT, branch + '.json'), 'rb').read()).hexdigest()[:10]
        meta[branch]['hash'] = h
    if changed:
        meta['source_commit'] = commit
    write_if_changed(meta_path, meta)
    print('changed:', ', '.join(changed) or 'nothing', '| main', main_ver, '| beta', beta_ver, '| codex', commit)


if __name__ == '__main__':
    main()
