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


def build(folder, pools_path, branch_name):
    acts = load(folder, 'acts')
    act_names = {a['id']: a['name'] for a in acts}
    act_index = {a['name']: a['index'] for a in acts}
    event_acts, ancient_acts = {}, {}
    for a in acts:
        for e in a.get('events') or []:
            event_acts.setdefault(e, []).append(a['name'])
        for an in a.get('ancients') or []:
            ancient_acts.setdefault(an, []).append(a['name'])

    ancient_ids = {an for a in acts for an in a.get('ancients') or []}
    all_events = load(folder, 'events')
    ancients_raw = [e for e in all_events if e.get('type') == 'Ancient' or e['id'] in ancient_ids]
    events_raw = [e for e in all_events if e not in ancients_raw]
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
    # Links read from the game's code by tools/game_code.py (covers relics the event text never names)
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
    # line-ups read from the game code: how many of each monster, random slots, summons, Dread
    ep = os.path.join(OUT, 'encounter_code.json')
    lineups = json.load(open(ep, encoding='utf-8')) if os.path.exists(ep) else {}
    for e in encounters:
        lu = lineups.get(e['id'])
        if not lu:
            continue
        listed = set(e['monsters'])
        named = set(lu.get('fixed', {})) | set(lu.get('dread', {})) | set(lu.get('summons', []))
        if not (set(lu.get('fixed', {})) <= listed):
            continue                       # line-up from another game version; keep Codex's list
        e['lineup'] = dict(lu)
        if 'random' in lu:
            pool = [m for m in lu['random'].get('from', []) if m in listed] or sorted(listed - named)
            e['lineup']['random'] = dict(lu['random'], **{'from': pool})

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

    apply_game_code(monsters, branch_name)

    ancients = []
    pools = {p['id']: p for p in json.load(open(pools_path, encoding='utf-8'))} if pools_path and os.path.exists(pools_path) else {}
    for e in ancients_raw:
        p = pools.get(e['id'], {})
        pcr = p.get('per_character_relics') or []
        ancients.append({'id': e['id'], 'name': e['name'], 'acts': ancient_acts.get(e['id'], []), 'desc': e.get('description'),
                         'relics': (p.get('relics') or []) + (sum(pcr.values(), []) if isinstance(pcr, dict) else pcr)})

    enchantments = [{'id': x['id'], 'name': x['name'], 'desc': x.get('description'), 'extra': x.get('extra_card_text'),
                     'cardType': x.get('card_type'), 'applies': x.get('applicable_to'), 'stack': x.get('is_stackable'),
                     'img': img(x.get('image_url'))} for x in load(folder, 'enchantments')]
    modes = load(folder, 'game_modes')
    dread = next(({'desc': m.get('description'), 'intro': m.get('intro'), 'rules': m.get('rules'),
                   'unlock': m.get('unlock_info'), 'dominions': m.get('dominions')} for m in modes if m['id'] == 'DREAD'), None)

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
        'ancients': ancients, 'enchantments': enchantments, 'dread': dread,
    })


def camel_words(s):
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', s)


def apply_game_code(monsters, branch):
    """Merge data/monster_code.json (read from sts2.dll by tools/game_code.py): exact ascension
    level per value and Dread mode changes. The dll is whichever branch the Mac has installed, so a
    monster's record is only used when its numbers agree with this branch's Codex data."""
    p = os.path.join(OUT, 'monster_code.json')
    if not os.path.exists(p):
        return
    allcode = json.load(open(p, encoding='utf-8'))
    nk = lambda x: re.sub(r'[^a-z0-9]', '', str(x).lower())
    for m in monsters:
        code = allcode.get(m['id'])
        if not code:
            continue
        moves = m.get('moves') or []
        sc, extra, ok = {}, [], True
        for prop, r in sorted(code.items()):
            if prop in ('MinInitialHp', 'MaxInitialHp'):
                if 'lvl' in r and r['n'] not in (m['hp'][0], m['hp'][1]):
                    ok = False
                if prop == 'MinInitialHp':
                    sc['hp'] = {k: r[k] for k in ('lvl', 'dadd') if k in r}
                continue
            target = None
            for suf, field in (('Damage', 'dmg'), ('Block', 'blk'), ('Heal', 'heal')):
                if prop.endswith(suf) and prop != suf:
                    base = nk(prop[:-len(suf)])
                    target = next((i for i, mv in enumerate(moves) if nk(mv['id']) == base or nk(mv.get('name')) == base), None)
                    if target is None and 'lvl' in r:
                        def val(mv):
                            d = mv.get('damage') or {}
                            return (d.get('normal'), d.get('ascension')) if field == 'dmg' else (mv.get('block'), None) if field == 'blk' else (mv.get('heal'), None)
                        hits = [i for i, mv in enumerate(moves) if val(mv)[0] == r['n'] and val(mv)[1] in (None, r['a'])]
                        target = hits[0] if len(hits) == 1 else None
                    if target is not None:
                        mv = moves[target]
                        if field == 'dmg':
                            d = mv.get('damage')
                            if not d:
                                mv['damage'] = {'normal': r['n'], 'ascension': r.get('a')}
                            elif d.get('normal') != r['n']:
                                ok = False
                        mv.setdefault('sc', {})[field] = {k: r[k] for k in ('lvl', 'a', 'n', 'dadd', 'dval') if k in r}
                    break
            if target is not None:
                continue
            ip = next((x for x in (m.get('innate') or []) if nk(x['power_id']) == nk(re.sub(r'(Amount|Amt)$', '', prop))), None)
            if ip is not None:
                if 'lvl' in r and ip.get('amount') not in (None, r['n']):
                    ok = False
                ip['sc'] = {k: r[k] for k in ('lvl', 'a', 'n', 'dadd', 'dval') if k in r}
                continue
            extra.append(dict({'label': camel_words(re.sub(r'(Amt)$', 'Amount', prop))}, **{k: r[k] for k in ('lvl', 'a', 'n', 'dadd', 'dval') if k in r}))
        if not ok and branch == 'main':
            for mv in moves:
                mv.pop('sc', None)
            for ip in m.get('innate') or []:
                ip.pop('sc', None)
            continue
        if extra:
            sc['extra'] = extra
        if sc:
            m['sc'] = sc


def fetch_news():
    """Mega Crit's monthly Neowsletter, from Steam's public news feed (no CORS, so fetched here)."""
    import urllib.request
    url = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=2868840&count=100&maxlength=0&feeds=steam_community_announcements&format=json'
    try:
        items = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'spire-buddy-data'}), timeout=30))['appnews']['newsitems']
    except Exception as e:
        print('news fetch failed:', e)
        return None
    neo = [n for n in items if 'neowsletter' in n['title'].lower()]
    neo.sort(key=lambda n: -n['date'])
    clean = lambda n: {'title': n['title'], 'date': n['date'], 'url': n['url'], 'gid': n['gid']}
    return {'latest': dict(clean(neo[0]), body=neo[0]['contents']) if neo else None, 'past': [clean(n) for n in neo[1:]]}


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
        bundle = build(folder, pools, branch)
        bundle['version'] = ver
        bundle['changelog'] = cl
        if write_if_changed(os.path.join(OUT, branch + '.json'), bundle):
            changed.append(branch)
            meta[branch] = {'version': ver, 'updated': today}
        meta.setdefault(branch, {'version': ver, 'updated': today})
        meta[branch]['counts'] = {k: len(bundle.get(k, [])) for k in ('cards', 'relics', 'monsters', 'encounters', 'events', 'potions')}
        h = hashlib.sha1(open(os.path.join(OUT, branch + '.json'), 'rb').read()).hexdigest()[:10]
        meta[branch]['hash'] = h
    news = fetch_news()
    if news is not None and write_if_changed(os.path.join(OUT, 'news.json'), news):
        changed.append('news')
        meta['news'] = {'updated': today, 'latest': (news.get('latest') or {}).get('title')}
    if changed:
        meta['source_commit'] = commit
    write_if_changed(meta_path, meta)
    print('changed:', ', '.join(changed) or 'nothing', '| main', main_ver, '| beta', beta_ver, '| codex', commit)


if __name__ == '__main__':
    main()
