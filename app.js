'use strict';
/* Spire Buddy: Slay the Spire 2 reference. Data comes from data/{main,beta}.json,
   rebuilt daily by tools/build_data.py from Spire Codex's extracted game data. */

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch {} },
};

// Default ascension thresholds when the game code gives no exact level:
//   A8 "Tough Enemies" -> HP, block, innate powers;  A9 "Deadly Enemies" -> damage, hit counts.
// tools/game_code.py reads the exact level for each value from sts2.dll (m.sc / mv.sc / power.sc).
// DREAD (11) = Dread mode: every ascension on, plus the boss buffs read from the game code.
const HP_ASC = 8, DMG_ASC = 9, DREAD = 11;
const isDread = () => S.asc >= DREAD;
const ascLabel = a => a >= DREAD ? 'Dread' : 'A' + a;
// value at the current ascension for a {lvl, a, n, dadd, dval} record from the game code
function scVal(r, fallback) {
  if (!r) return fallback;
  let v = r.lvl != null && S.asc >= r.lvl && r.a != null ? r.a : (r.n ?? fallback);
  if (isDread()) { if (r.dval != null) v = r.dval; if (r.dadd) v += r.dadd; }
  return v;
}
const ACT_ORDER = ['Overgrowth', 'Underdocks', 'Hive', 'Glory', 'Event', 'Other'];
const ACT_NUM = { Overgrowth: 'Act 1', Underdocks: 'Act 1', Hive: 'Act 2', Glory: 'Act 3' };
const TYPE_ORDER = { Weak: 0, Normal: 1, Monster: 1, Elite: 2, Boss: 3 };

const S = {
  branch: store.get('branch', 'main'),
  asc: store.get('asc', 0),
  meta: null,
  cache: {},
  D: null,
  ui: store.get('ui', {}),
};
const ui = (k, d) => (S.ui[k] ?? d);
const setUi = (k, v) => { S.ui[k] = v; store.set('ui', S.ui); };

/* ---------------- data ---------------- */
async function loadMeta() {
  try { S.meta = await (await fetch('data/meta.json', { cache: 'no-cache' })).json(); } catch { S.meta = S.meta || {}; }
}
async function loadBranch(b) {
  if (S.cache[b]) return S.cache[b];
  const h = S.meta?.[b]?.hash || '';
  const r = await fetch(`data/${b}.json?h=${h}`);
  const D = await r.json();
  index(D);
  S.cache[b] = D;
  return D;
}
function index(D) {
  const by = (arr) => Object.fromEntries((arr || []).map(x => [x.id, x]));
  D.M = by(D.monsters); D.E = by(D.encounters); D.C = by(D.cards); D.R = by(D.relics);
  D.EV = by(D.events); D.AN = by(D.ancients); D.EN = by(D.enchantments); D.P = by(D.powers); D.PO = by(D.potions); D.A = by(D.acts);
  D.byName = {};
  for (const p of D.powers || []) D.byName[norm(p.name)] = p;
  D.cardByName = {};
  for (const c of D.cards || []) D.cardByName[norm(c.name)] = c;
  D.relicByName = {};
  for (const r of D.relics || []) D.relicByName[norm(r.name)] = r;
  // which events/acts each encounter sits in
  for (const m of D.monsters) m.acts = m.acts || [];
  D.ancientActs = {};
  for (const a of D.acts || []) for (const an of a.ancients || []) (D.ancientActs[an] ||= []).push(a.name);
  D.charNames = {};
  for (const c of D.characters || []) D.charNames[c.id.toLowerCase()] = c.name.replace(/^The /, '');
}
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const title = id => String(id || '').toLowerCase().split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');

/* ---------------- game text ---------------- */
const COLORS = ['gold', 'blue', 'red', 'green', 'purple', 'orange', 'aqua', 'pink'];
function fmt(s) {
  if (s == null) return '';
  let h = esc(String(s).replaceAll('[Amount]', 'X').replace(/\[(TargetPlayer|ApplierName)\]/g, 'the target').replace(/\[Card\]/g, 'a card'));
  for (const c of COLORS) h = h.replaceAll(`[${c}]`, `<span class="t-${c}">`).replaceAll(`[/${c}]`, '</span>');
  h = h.replace(/\[b\]/g, '<b>').replace(/\[\/b\]/g, '</b>').replace(/\[i\]/g, '<i>').replace(/\[\/i\]/g, '</i>');
  h = h.replace(/\[energy:(\d+)\]/g, (_, n) => `<span class="energy">${n}</span>`);
  h = h.replace(/\[star:(\d+)\]/g, (_, n) => `<span class="starico">${n}★</span>`);
  h = h.replace(/\[\/?[a-z_]+(?:=[^\]]*)?\]/g, '');
  return h.replace(/\n/g, '<br>');
}
const strip = s => String(s || '').replace(/\[[^\]]*\]/g, '');

/* ---------------- ascension maths ---------------- */
function hpOf(m, asc = S.asc) {
  const [mn, mx, amn, amx] = m.hp || [];
  const lvl = m.sc?.hp?.lvl ?? HP_ASC;
  const useA = asc >= lvl && amn != null;
  let lo = useA ? amn : mn, hi = useA ? (amx ?? amn) : (mx ?? mn);
  const add = asc >= DREAD ? (m.sc?.hp?.dadd || 0) : 0;
  if (add && lo != null) { lo += add; hi = (hi ?? lo - add) + add; }
  return { lo, hi, base: useA || add ? [mn, mx ?? mn] : null, lvl, dread: add };
}
const range = (lo, hi) => lo == null ? '?' : (hi != null && hi !== lo ? `${lo}–${hi}` : `${lo}`);
function dmgOf(mv, asc = S.asc) {
  const d = mv.damage; if (!d) return null;
  const r = mv.sc?.dmg;
  const a = asc >= (r?.lvl ?? DMG_ASC);
  let n = a && d.ascension != null ? d.ascension : d.normal;
  if (asc >= DREAD && r) { if (r.dval != null) n = r.dval; if (r.dadd) n += r.dadd; }
  const hits = asc >= DMG_ASC && d.hit_count_ascension != null ? d.hit_count_ascension : d.hit_count;
  const changed = n !== d.normal || (hits || 1) !== (d.hit_count || 1);
  return { n, hits: hits || 1, changed, base: d.normal, baseHits: d.hit_count || 1 };
}
function blkOf(mv) { return mv.block == null && !mv.sc?.blk ? null : scVal(mv.sc?.blk, mv.block); }
function innateAmt(p, asc = S.asc) {
  if (p.sc) return scVal(p.sc, p.amount);
  return asc >= HP_ASC && p.amount_ascension != null ? p.amount_ascension : p.amount;
}

/* ---------------- pattern engine ---------------- */
function patternModel(m) {
  const P = m.pattern; if (!P || !P.states) return null;
  const st = Object.fromEntries(P.states.map(s => [s.id, s]));
  const resolve = id => {
    if (!id) return null;
    if (st[id]) return st[id];
    return P.states.find(s => s.type === 'move' && s.move_id === id) || st[id + '_MOVE'] || null;
  };
  return { P, st, resolve };
}
function moveById(m, id) { return (m.moves || []).find(x => x.id === id); }

function humanCond(c) {
  if (!c) return '';
  let s = c.replace(/\(\(\w+\)base\.Creature\.Monster\)\./g, '').replace(/base\.Creature\./g, '').replace(/this\./g, '');
  s = s.replace(/SlotName == "(first|second|third|fourth)"/g, (_, w) => `in slot ${{ first: 1, second: 2, third: 3, fourth: 4 }[w]}`);
  s = s.replace(/SlotName == "([a-z]+)(\d)"/g, (_, n, d) => `in ${n} slot ${d}`);
  s = s.replace(/CurrentHp < MaxHp \/ 2/g, 'below 50% HP').replace(/CurrentHp >= MaxHp \/ 2/g, 'at 50%+ HP');
  s = s.replace(/GetAllyCount\(\) == 0/g, 'no allies left').replace(/GetAllyCount\(\) > 0/g, 'has allies');
  s = s.replace(/_?([a-z]+)Counter/gi, '$1 counter').replace(/^_/, '');
  s = s.replace(/\bIsFront\b/g, 'InFront').replace(/\bIsAlone\b/g, 'Alone');
  s = s.replace(/!\s*([A-Za-z]+)/g, 'not $1');
  s = s.replace(/&&/g, 'and').replace(/\|\|/g, 'or');
  s = s.replace(/\bInFront\b/g, 'in front').replace(/\bAlone\b/g, 'alone');
  s = s.replace(/\b(Is|Has|Can)([A-Z]\w*)/g, (_, a, b) => `${a === 'Is' ? '' : a.toLowerCase() + ' '}${b.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`);
  s = s.replace(/\b([a-z]+)([A-Z][a-z]+)\b/g, (_, a, b) => `${a} ${b.toLowerCase()}`);
  s = s.replace(/\b[a-z]+(?:[A-Z][a-z]+)+\b/g, w => w.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  return 'If ' + s.replace(/\s+/g, ' ').trim();
}
const REPEAT = { CannotRepeat: "can't repeat", CanRepeatForever: 'can repeat', UseOnlyOnce: 'only once per fight' };
const repeatText = b => b.repeat === 'CanRepeatXTimes' ? `max ${b.max_times ?? '?'} in a row` : (REPEAT[b.repeat] || '');

/* Walk the state machine from a starting state. Returns a list of steps:
   {kind:'move', move, state} | {kind:'loop', to} | {kind:'random', state} | {kind:'cond', state} | {kind:'end'} */
function walk(model, startId, limit = 10) {
  const out = []; const seen = new Map();
  let s = model.resolve(startId);
  while (s && out.length < limit) {
    if (seen.has(s.id)) { out.push({ kind: 'loop', to: seen.get(s.id) }); return out; }
    if (s.type === 'move') {
      seen.set(s.id, out.length);
      out.push({ kind: 'move', move_id: s.move_id, state: s });
      if (!s.next) { out.push({ kind: 'end' }); return out; }
      s = model.resolve(s.next);
      continue;
    }
    if (s.type === 'random') { out.push({ kind: 'random', state: s }); return out; }
    if (s.type === 'conditional') { out.push({ kind: 'cond', state: s }); return out; }
    break;
  }
  return out;
}

function numsHtml(m, mv, str = 0) {
  if (!mv) return '';
  const parts = [];
  const d = dmgOf(mv);
  if (d) {
    const n = d.n + str;
    parts.push(`<span class="n-atk">${n}${d.hits > 1 ? '×' + d.hits : ''}</span>`);
  }
  { const b = blkOf(mv); if (b) parts.push(`<span class="n-blk">${b}<small> blk</small></span>`); }
  if (mv.heal) parts.push(`<span class="n-heal">+${mv.heal}</span>`);
  return parts.join(' ');
}
function moveSub(m, mv, str) {
  const bits = [esc(mv?.intent || '')];
  if (str && dmgOf(mv || {})) bits.push(`incl. +${str} Str`);
  const pw = (mv?.powers || []).map(p => `${powName(p.power_id)} ${p.amount ?? ''}${p.target === 'player' ? ' → you' : p.target === 'self' ? '' : p.target ? ' → ' + p.target : ''}`);
  if (pw.length) bits.push(esc(pw.join(', ')));
  return bits.filter(Boolean).join(' · ');
}
// Power text bakes in an example stack size; show this enemy's actual amount instead.
function powerDesc(d, amt) {
  d = String(d || '');
  if (amt == null) return d;
  if (d.includes('[Amount]')) return d.replaceAll('[Amount]', amt);
  return d.replace(/\[blue\]\d+\[\/blue\]/, `[blue]${amt}[/blue]`);
}
function powName(id) { const p = S.D.P[id]; return p ? p.name : title(id); }

/* Render a turn sequence starting at a state id. Tracks self-Strength so later
   turns show the damage you will actually take (before your own Weak/Vulnerable etc). */
function renderSeq(m, model, startId, turn0 = 1, str0 = 0, stack = []) {
  const steps = walk(model, startId);
  let str = str0, t = turn0, html = '<div class="turns">';
  const strengthTracked = (mv) => (mv?.powers || []).filter(p => p.power_id === 'STRENGTH' && p.target === 'self').reduce((a, p) => a + (p.amount || 0), 0);
  for (const s of steps) {
    if (s.kind === 'move') {
      const mv = moveById(m, s.move_id);
      html += `<div class="turn"><div class="tn">Turn ${t}</div><div class="mv">${esc(mv?.name || title(s.move_id))}${s.state.must_perform_once ? ' <span class="badge">once</span>' : ''}<small>${moveSub(m, mv, str)}</small></div><div class="nums">${numsHtml(m, mv, str)}</div></div>`;
      str += strengthTracked(mv);
      t++;
    } else if (s.kind === 'loop') {
      html += `<div class="turn loop">↺ Repeats from turn ${turn0 + s.to}${str > str0 ? ' (Strength keeps stacking)' : ''}</div>`;
    } else if (s.kind === 'end') {
      html += `<div class="turn loop">Then depends on the fight (see moves below)</div>`;
    } else if (s.kind === 'random') {
      html += `</div><div class="note">From turn ${t}, picks at random:</div>${renderRandom(m, model, s.state)}<div class="turns">`;
    } else if (s.kind === 'cond') {
      if (stack.includes(s.state.id) || stack.length > 3) { html += `<div class="turn loop">↺ Then back to the check above</div>`; continue; }
      html += `</div><div class="note">${t === 1 ? 'Opening move depends on the situation:' : `From turn ${t}:`}</div>${renderCond(m, model, s.state, t, str, [...stack, s.state.id])}<div class="turns">`;
    }
  }
  return html + '</div>';
}
function renderRandom(m, model, st) {
  const br = st.branches || [];
  if (!br.length) {
    // Codex couldn't read the weights; list the moves this state can lead to.
    const ids = (m.moves || []).map(x => x.id);
    return `<div class="rand">${ids.map(id => `<div class="opt"><span>${esc(moveById(m, id)?.name || title(id))}</span></div>`).join('')}</div><div class="note">Weights not available for this enemy.</div>`;
  }
  const tot = br.reduce((a, b) => a + (b.weight ?? 1), 0) || 1;
  return `<div class="rand">${br.map(b => {
    const mv = moveById(m, b.move_id);
    const r = repeatText(b);
    return `<div class="opt"><span><b>${esc(mv?.name || title(b.move_id))}</b> <span class="muted">${numsHtml(m, mv)}</span>${r ? ` <span class="faint">· ${r}</span>` : ''}</span><span class="pct">${Math.round(100 * (b.weight ?? 1) / tot)}%</span></div>`;
  }).join('')}</div>`;
}
function renderCond(m, model, st, t = 1, str = 0, stack = []) {
  const br = st.branches || [];
  if (!br.length) return `<div class="note">Next move depends on the fight state.${m.pattern?.description ? ' ' + esc(m.pattern.description) : ''}</div>`;
  return br.map(b => `<div class="branch"><div class="cond">${esc(humanCond(b.condition))}</div>${renderSeq(m, model, b.move_id, t, str, stack)}</div>`).join('');
}

function renderPattern(m) {
  const model = patternModel(m);
  if (!model) return `<div class="note">No move pattern data for this enemy${m.pattern?.description ? ': ' + esc(m.pattern.description) : '.'}</div>`;
  const P = model.P;
  const str0 = (m.innate || []).filter(p => p.power_id === 'STRENGTH').reduce((a, p) => a + (innateAmt(p) || 0), 0);
  let h = '';
  if (P.initial_move) {
    h += renderSeq(m, model, P.initial_move, 1, str0);
  } else {
    const rs = P.states.find(s => s.type === 'random');
    h += rs ? `<div class="note">Picks at random each turn:</div>${renderRandom(m, model, rs)}` : '';
  }
  // Moves that never show up in the walk (e.g. triggered by HP thresholds or deaths)
  const shown = new Set();
  const collect = (id, depth = 0) => {
    if (depth > 6) return;
    for (const s of walk(model, id)) {
      if (s.kind === 'move') shown.add(s.move_id);
      if ((s.kind === 'random' || s.kind === 'cond')) for (const b of s.state.branches || []) { shown.add(b.move_id); if (!shown.has('__' + b.move_id)) { shown.add('__' + b.move_id); collect(b.move_id, depth + 1); } }
    }
  };
  if (P.initial_move) collect(P.initial_move);
  const extra = (m.moves || []).filter(x => !shown.has(x.id));
  if (extra.length && P.initial_move) h += `<div class="note">Also has: ${extra.map(x => `<b>${esc(x.name)}</b>`).join(', ')} (triggered by the fight, e.g. HP thresholds or allies dying).</div>`;
  if (P.description && P.type !== 'cycle') h += `<div class="note faint">Extracted summary: ${esc(P.description)}</div>`;
  return h;
}

/* ---------------- views ---------------- */
const V = {};
const actBadge = a => `<span class="badge act">${esc(a)}</span>`;
const typeBadge = t => `<span class="badge ${esc(t)}">${esc(t)}</span>`;
const imgTag = (src, cls = '', alt = '') => src ? `<img loading="lazy" decoding="async" class="${cls}" src="${esc(src)}" alt="${esc(alt)}" onerror="this.style.visibility='hidden'">` : '';

function chips(key, opts, cur) {
  return `<div class="chips" data-key="${key}">${opts.map(([v, l]) => `<button class="chip ${String(cur) === String(v) ? 'on' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
}
function wireChips(root, rerender) {
  root.querySelectorAll('.chips').forEach(c => c.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    setUi(c.dataset.key, b.dataset.v); rerender();
  }));
}
/* Search box with a clear (×) button and live suggestions as you type.
   suggest(q) returns [{label, sub, href, img}]; an item without href fills the box instead. */
function searchBox(key, ph) {
  const v = ui(key, '');
  return `<div class="sbox"><input class="search" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${esc(ph)}" value="${esc(v)}"><button class="sclear" type="button" aria-label="Clear search"${v ? '' : ' hidden'}>×</button><div class="sugg" hidden></div></div>`;
}
function rank(list, q, nameOf) {
  const n = norm(q); if (!n) return [];
  return list.map(o => [o, norm(nameOf(o))]).filter(([, k]) => k.includes(n))
    .sort((a, b) => (b[1].startsWith(n) - a[1].startsWith(n)) || (a[1].length - b[1].length)).map(([o]) => o);
}
function hl(label, q) {
  const i = String(label).toLowerCase().indexOf(String(q).trim().toLowerCase());
  if (i < 0 || !q.trim()) return esc(label);
  const L = q.trim().length;
  return esc(label.slice(0, i)) + '<b>' + esc(label.slice(i, i + L)) + '</b>' + esc(label.slice(i + L));
}
function wireSearch(root, key, rerender, suggest) {
  const i = root.querySelector('.search'); if (!i) return;
  const x = root.querySelector('.sclear'), box = root.querySelector('.sugg');
  let items = [];
  const show = () => {
    const q = i.value;
    items = q.trim() && suggest ? suggest(q).slice(0, 8) : [];
    box.hidden = !items.length || document.activeElement !== i;
    box.innerHTML = items.map((it, k) => `<a class="sg" data-k="${k}"${it.href ? ` href="${it.href}"` : ''}>${it.img ? imgTag(it.img, 'sgi') : ''}<span class="nm">${hl(it.label, q)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</a>`).join('');
  };
  const set = v => { i.value = v; setUi(key, v); x.hidden = !v; rerender(true); };
  i.addEventListener('input', () => { setUi(key, i.value); x.hidden = !i.value; rerender(true); show(); });
  i.addEventListener('focus', show);
  i.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 250));
  i.addEventListener('keydown', e => { if (e.key === 'Enter') { box.hidden = true; i.blur(); } if (e.key === 'Escape') set(''); });
  box.addEventListener('mousedown', e => e.preventDefault());
  box.addEventListener('click', e => {
    const a = e.target.closest('.sg'); if (!a) return;
    const it = items[+a.dataset.k]; box.hidden = true;
    if (!it.href) { e.preventDefault(); set(it.label); i.blur(); }
  });
  x.addEventListener('mousedown', e => e.preventDefault());
  x.addEventListener('click', () => { set(''); box.hidden = true; i.focus(); });
}
const sgEnemy = m => ({ label: m.name, sub: `${m.type} · ${m.acts.join(', ') || 'Other'}`, href: '#/enemy/' + m.id, img: m.img });
/* list pages render header once, then only the results, so typing keeps focus */
function listPage(head, results) {
  const view = $('#view');
  view.innerHTML = head() + '<div id="results"></div>';
  const draw = () => { $('#results').innerHTML = results(); };
  return { view, draw };
}

V.enemies = () => {
  const D = S.D;
  const acts = ACT_ORDER.filter(a => D.monsters.some(m => m.acts.includes(a) || (a === 'Other' && !m.acts.length)));
  const page = () => {
    const { view, draw } = listPage(() => `
      ${searchBox('eq', 'Search enemies or moves')}
      ${chips('eact', [['all', 'All acts'], ...acts.map(a => [a, a])], ui('eact', 'all'))}
      ${chips('etype', [['all', 'All'], ['Normal', 'Normal'], ['Elite', 'Elite'], ['Boss', 'Boss']], ui('etype', 'all'))}`, () => {
      const q = norm(ui('eq', '')), act = ui('eact', 'all'), ty = ui('etype', 'all');
      let list = D.monsters.filter(m =>
        (act === 'all' || m.acts.includes(act) || (act === 'Other' && !m.acts.length)) &&
        (ty === 'all' || m.type === ty) &&
        (!q || norm(m.name).includes(q) || (m.moves || []).some(x => norm(x.name).includes(q))));
      list.sort((a, b) => (ACT_ORDER.indexOf(a.acts[0] || 'Other') - ACT_ORDER.indexOf(b.acts[0] || 'Other')) || ((TYPE_ORDER[a.type] ?? 1) - (TYPE_ORDER[b.type] ?? 1)) || a.name.localeCompare(b.name));
      if (!list.length) return '<div class="empty">No enemies match.</div>';
      return `<div class="count">${list.length} enemies · HP at ${ascLabel(S.asc)}</div><div class="grid">${list.map(m => {
        const h = hpOf(m);
        return `<a class="tile" href="#/enemy/${m.id}"><div class="pic">${imgTag(m.img, '', m.name)}</div><div class="meta"><div class="name">${esc(m.name)}</div><div class="hp">❤ ${range(h.lo, h.hi)} · ${typeBadge(m.type)}</div><div class="hp">${m.acts.map(esc).join(', ') || 'Other'}</div></div></a>`;
      }).join('')}</div>`;
    });
    wireChips(view, page); wireSearch(view, 'eq', draw, q => rank(D.monsters, q, m => m.name).map(sgEnemy)); draw();
  };
  page();
};

function enemyBlock(m, opts = {}) {
  const D = S.D; const h = hpOf(m);
  const innate = (m.innate || []).map(p => {
    const pw = D.P[p.power_id];
    const amt = innateAmt(p);
    return `<div class="pw">${imgTag(pw?.img)}<div><b>${esc(pw?.name || title(p.power_id))}${amt != null ? ' ' + amt : ''}</b>${p.amount_ascension != null && amt !== p.amount ? ` <span class="was">(A0: ${p.amount})</span>` : ''}<div class="sub">${fmt(powerDesc(pw?.desc, amt))}</div></div></div>`;
  }).join('');
  const moves = (m.moves || []).map(mv => {
    const d = dmgOf(mv);
    const fx = [];
    if (d) fx.push(`<span class="fxp n-atk"><b>${d.n}${d.hits > 1 ? '×' + d.hits : ''}</b> dmg${d.changed ? ` <span class="was">A0: ${d.base}${d.baseHits > 1 ? '×' + d.baseHits : ''}</span>` : ''}</span>`);
    { const b = blkOf(mv); if (b) fx.push(`<span class="fxp n-blk"><b>${b}</b> block${b !== mv.block ? ` <span class="was">A0: ${mv.block}</span>` : ''}</span>`); }
    if (mv.heal) fx.push(`<span class="fxp n-heal"><b>${mv.heal}</b> heal</span>`);
    for (const p of mv.powers || []) fx.push(`<span class="fxp">${esc(powName(p.power_id))} <b>${p.amount ?? ''}</b>${p.target === 'player' ? ' → you' : p.target === 'self' ? ' (self)' : p.target ? ' → ' + esc(p.target) : ''}</span>`);
    return `<div class="move"><div class="mh"><b>${esc(mv.name)}</b><span class="intent">${esc(mv.intent || '')}</span></div>${fx.length ? `<div class="fx">${fx.join('')}</div>` : ''}</div>`;
  }).join('');
  const encs = opts.noEncounters ? '' : (m.encounters || []).map(id => D.E[id]).filter(Boolean);
  return `
    <div class="hero">
      <div class="art">${imgTag(m.img, '', m.name)}</div>
      <div>
        ${opts.link ? `<a href="#/enemy/${m.id}"><h1>${esc(m.name)} ›</h1></a>` : `<h1>${esc(m.name)}</h1>`}
        <div>${typeBadge(m.type)} ${m.acts.map(actBadge).join(' ')}</div>
        <div class="stats">
          <div class="stat"><b class="hp">${range(h.lo, h.hi)}</b><span>HP · ${ascLabel(S.asc)}</span>${h.base ? `<div class="was">A0–${h.lvl - 1}: ${range(h.base[0], h.base[1])}${h.dread ? ` · Dread +${h.dread}` : ''}</div>` : ''}</div>
        </div>
      </div>
    </div>
    ${innate ? `<h2>Starts with</h2><div class="panel">${innate}</div>` : ''}
    ${dreadPanel(m)}
    <h2>Pattern at ${ascLabel(S.asc)}</h2>
    ${renderPattern(m)}
    <h2>Moves</h2>
    ${moves || '<div class="note">No moves listed.</div>'}
    ${extraPanel(m)}
    ${encs && encs.length ? `<h2>Appears in</h2>${encs.map(encRow).join('')}` : ''}`;
}

function extraPanel(m) {
  const ex = m.sc?.extra || []; if (!ex.length) return '';
  const row = r => {
    const cur = scVal(r);
    const bits = [];
    if (r.lvl != null) bits.push(`${r.n} → ${r.a} at A${r.lvl}`);
    if (r.dval != null) bits.push(`${r.n} → ${r.dval} in Dread`);
    if (r.dadd) bits.push(`+${r.dadd} in Dread`);
    return `<div class="row-between" style="padding:4px 0"><span>${esc(r.label)}</span><span><b>${cur}</b> <span class="was">${esc(bits.join(' · '))}</span></span></div>`;
  };
  return `<h2>Other values at ${ascLabel(S.asc)}</h2><div class="panel">${ex.map(row).join('')}</div>`;
}
/* Dread: normal/elite enemies gain the upcoming boss's Dominion; bosses are buffed (values above) */
function dominionsFor(m) {
  const D = S.D; if (!D.dread) return [];
  const doms = D.dread.dominions || [];
  if (m.type === 'Boss') return doms.filter(d => (m.encounters || []).includes(d.encounter_id));
  const bosses = new Set((D.acts || []).filter(a => m.acts.includes(a.name)).flatMap(a => a.bosses || []));
  return doms.filter(d => bosses.has(d.encounter_id));
}
function dreadPanel(m) {
  if (!isDread()) return '';
  const doms = dominionsFor(m);
  if (!doms.length) return '';
  const boss = m.type === 'Boss';
  return `<h2>Dread</h2><div class="panel">${boss
    ? '<div class="sub" style="margin-bottom:6px">Its Dominion: enemies earlier in the act gain this when it is the upcoming boss.</div>'
    : `<div class="sub" style="margin-bottom:6px">Gains the upcoming boss's Dominion${doms.length > 1 ? ', one of:' : ':'}</div>`}
    ${doms.map(d => `<div style="margin-top:6px"><b class="nm">${esc(d.name)}</b><div class="sub">${fmt(d.description)}</div></div>`).join('')}</div>`;
}

V.enemy = (id) => {
  const m = S.D.M[id];
  if (!m) return notFound();
  $('#view').innerHTML = backBtn() + enemyBlock(m) + ascNote();
};
const ascNote = () => `<div class="note faint" style="margin-top:20px">Each value switches at the ascension level the game code uses (HP and block mostly at A8 Tough Enemies, damage at A9 Deadly Enemies). Dread adds the boss buffs read from the game code. Strength gained from its own moves is added to later turns; your Weak, Vulnerable and Block are not.</div>`;

function encRow(e) {
  const D = S.D;
  const ms = (e.monsters || []).map(id => D.M[id]).filter(Boolean);
  const label = e.weak ? 'Weak' : (e.room === 'Monster' ? 'Normal' : e.room);
  return `<a class="enc" href="#/fight/${e.id}"><div class="thumbs">${[...new Map(ms.map(m => [m.id, m])).values()].slice(0, 3).map(m => imgTag(m.img, '', m.name)).join('')}</div><div class="body"><b>${esc(e.name)}</b> ${typeBadge(label)}<div class="who">${ms.map(m => { const h = hpOf(m); return `${esc(m.name)} ${range(h.lo, h.hi)}`; }).join(' · ')}</div></div><span class="faint">›</span></a>`;
}

V.fights = () => {
  const D = S.D;
  const acts = ACT_ORDER.filter(a => D.encounters.some(e => e.act === a));
  const page = () => {
    const { view, draw } = listPage(() => `
      ${searchBox('fq', 'Search fights or enemies')}
      ${chips('fact', [['all', 'All acts'], ...acts.map(a => [a, a])], ui('fact', 'all'))}
      ${chips('froom', [['all', 'All'], ['Weak', 'Weak'], ['Normal', 'Normal'], ['Elite', 'Elite'], ['Boss', 'Boss']], ui('froom', 'all'))}`, () => {
      const q = norm(ui('fq', '')), act = ui('fact', 'all'), room = ui('froom', 'all');
      const lab = e => e.weak ? 'Weak' : (e.room === 'Monster' ? 'Normal' : e.room);
      const list = D.encounters.filter(e => (act === 'all' || e.act === act) && (room === 'all' || lab(e) === room) &&
        (!q || norm(e.name).includes(q) || (e.monsters || []).some(id => norm(D.M[id]?.name).includes(q))));
      if (!list.length) return '<div class="empty">No fights match.</div>';
      let h = '';
      for (const a of acts) {
        const inAct = list.filter(e => e.act === a); if (!inAct.length) continue;
        h += `<h2>${esc(ACT_NUM[a] ? ACT_NUM[a] + ' · ' + a : a)}</h2>`;
        for (const r of ['Weak', 'Normal', 'Elite', 'Boss']) {
          const g = inAct.filter(e => lab(e) === r).sort((x, y) => x.name.localeCompare(y.name));
          if (g.length) h += `<div class="sub" style="margin:10px 0 6px">${r === 'Weak' ? 'Weak (first fights of the act)' : r}</div>` + g.map(encRow).join('');
        }
      }
      return h;
    });
    wireChips(view, page); wireSearch(view, 'fq', draw, q => [...rank(D.encounters, q, e => e.name).map(e => ({ label: e.name, sub: `${e.weak ? 'Weak' : e.room === 'Monster' ? 'Normal' : e.room} · ${e.act}`, href: '#/fight/' + e.id })), ...rank(D.monsters, q, m => m.name).map(sgEnemy)]); draw();
  };
  page();
};

V.fight = (id) => {
  const D = S.D, e = D.E[id];
  if (!e) return notFound();
  const ms = (e.monsters || []).map(x => D.M[x]).filter(Boolean);
  const label = e.weak ? 'Weak' : (e.room === 'Monster' ? 'Normal' : e.room);
  const total = ms.reduce((a, m) => { const h = hpOf(m); return [a[0] + (h.lo || 0), a[1] + (h.hi || h.lo || 0)]; }, [0, 0]);
  $('#view').innerHTML = backBtn() + `<h1>${esc(e.name)}</h1><div>${typeBadge(label)} ${actBadge(e.act)}</div>
    <div class="stats"><div class="stat"><b class="hp">${range(total[0], total[1])}</b><span>Total HP · ${ascLabel(S.asc)}</span></div><div class="stat"><b>${ms.length}</b><span>Enemies</span></div></div>
    ${ms.map(m => `<div class="fight-mon">${enemyBlock(m, { link: true, noEncounters: true })}</div>`).join('')}` + ascNote();
};

/* ---- cards ---- */
function cardColors(D) {
  const pref = ['ironclad', 'silent', 'defect', 'necrobinder', 'regent'];
  const chars = (D.characters || []).map(c => c.id.toLowerCase()).sort((a, b) => ((pref.indexOf(a) + 99) % 99) - ((pref.indexOf(b) + 99) % 99));
  const extra = ['colorless', 'event', 'status', 'curse', 'token', 'quest'];
  const present = new Set(D.cards.map(c => c.color));
  const order = [...chars, ...extra, ...[...present].filter(c => !chars.includes(c) && !extra.includes(c))];
  return order.filter(c => present.has(c));
}
const colorName = c => S.D.charNames[c] || title(c);
// Frame colour per character / card group (in-game card frame colours, toned for a dark UI)
const CARD_COLORS = { ironclad: '#c0392b', silent: '#4e9a3a', defect: '#2f7fc8', necrobinder: '#9a55c4', regent: '#e08a2a', fool: '#d4b02a',
  colorless: '#9a958c', curse: '#6a2d63', status: '#7a6650', event: '#2c9c90', token: '#a07a52', quest: '#c79b3b' };
const CHAR_FALLBACK = { red: '#c0392b', green: '#4e9a3a', blue: '#2f7fc8', purple: '#9a55c4', orange: '#e08a2a', yellow: '#d4b02a' };
function cardColor(c) {
  if (CARD_COLORS[c.color]) return CARD_COLORS[c.color];
  const ch = (S.D.characters || []).find(x => x.id.toLowerCase() === c.color);
  return CHAR_FALLBACK[ch?.color] || '#8a7f70';
}
/* Upgraded text with the numbers that changed shown in green, like the in-game upgrade preview */
function upDiff(base, up) {
  const num = /(\d+)/g;
  const a = String(base || '').split(num), b = String(up || '').split(num);
  if (a.length !== b.length) return fmt(up);
  const mark = '\u0001', end = '\u0002';
  const merged = b.map((t, i) => (i % 2 === 1 && t !== a[i]) ? mark + t + end : t).join('');
  return fmt(merged).replace(/\u0001/g, '<span class="t-up">').replace(/\u0002/g, '</span>');
}
function gameCard(c, up) {
  const art = S.branch === 'beta' && c.bimg ? c.bimg : c.img;
  const text = up ? upDiff(c.desc, upText(c) || c.desc) : fmt(c.desc);
  const shape = { Attack: 'atk', Power: 'pow' }[c.type] || 'skl';
  return `<div class="gcard ${shape}" style="--cc:${cardColor(c)}">
    <div class="gc-top">${costHtml(c, up)}<div class="gc-name nm${up && c.up ? ' upg' : ''}">${esc(c.name)}${up && c.up ? '+' : ''}</div></div>
    <div class="gc-art">${imgTag(art, '', c.name)}</div>
    <div class="gc-type"><span class="r-${esc(c.rarity)}">●</span> ${esc(c.type || '')}</div>
    <div class="gc-text"><div>${text || "&nbsp;"}</div></div>
  </div>`;
}
function costHtml(c, up) {
  let cost = c.cost, changed = false;
  if (up && c.up && c.up.cost != null) {
    const v = String(c.up.cost);
    cost = /^[+-]/.test(v) ? c.cost + Number(v) : Number(v); changed = true;
  }
  if (c.x) return `<div class="cost">X</div>`;
  if (c.star != null && (cost == null || cost < 0)) return `<div class="cost">${c.star}★</div>`;
  if (cost == null || cost < 0) return `<div class="cost none">–</div>`;
  return `<div class="cost ${changed ? 'changed' : ''}">${cost}</div>`;
}
function upText(c) { return c.udesc || (c.up ? c.desc : null); }
function upExtras(c) {
  const u = c.up || {}; const out = [];
  if (u.cost != null) out.push(`Cost ${c.cost} → ${/^[+-]/.test(String(u.cost)) ? c.cost + Number(u.cost) : u.cost}`);
  if (u.add_innate) out.push('Gains Innate'); if (u.add_retain) out.push('Gains Retain');
  if (u.remove_exhaust) out.push('Loses Exhaust'); if (u.remove_ethereal) out.push('Loses Ethereal');
  if (u.add_exhaust === false) out.push('Loses Exhaust');
  return out;
}

V.cards = () => {
  const D = S.D, colors = cardColors(D);
  const page = () => {
    const { view, draw } = listPage(() => `
      ${searchBox('cq', 'Search cards or text')}
      ${chips('ccolor', [['all', 'All'], ...colors.map(c => [c, colorName(c)])], ui('ccolor', 'all'))}
      ${chips('ctype', [['all', 'Any type'], ...['Attack', 'Skill', 'Power', 'Status', 'Curse', 'Quest'].filter(t => D.cards.some(c => c.type === t)).map(t => [t, t])], ui('ctype', 'all'))}
      ${chips('crar', [['all', 'Any rarity'], ...['Basic', 'Common', 'Uncommon', 'Rare', 'Ancient', 'Event', 'Token'].filter(r => D.cards.some(c => c.rarity === r)).map(r => [r, r])], ui('crar', 'all'))}
      <div class="row-between" style="margin-top:8px"><label class="toggle"><input type="checkbox" id="upT" ${ui('cup', false) ? 'checked' : ''}> Show upgraded</label></div>`, () => {
      const q = norm(ui('cq', '')), col = ui('ccolor', 'all'), ty = ui('ctype', 'all'), ra = ui('crar', 'all'), up = ui('cup', false);
      const list = D.cards.filter(c => (col === 'all' || c.color === col) && (ty === 'all' || c.type === ty) && (ra === 'all' || c.rarity === ra) &&
        (!q || norm(c.name).includes(q) || norm(strip(c.desc)).includes(q) || norm(strip(c.udesc)).includes(q)))
        .sort((a, b) => (colors.indexOf(a.color) - colors.indexOf(b.color)) || ((a.order ?? 9999) - (b.order ?? 9999)) || a.name.localeCompare(b.name));
      if (!list.length) return '<div class="empty">No cards match.</div>';
      return `<div class="count">${list.length} cards</div><div class="list">${list.slice(0, 400).map(c => {
        const t = up ? (upText(c) || c.desc) : c.desc;
        return `<a class="item cardrow" style="--cc:${cardColor(c)}" href="#/card/${c.id}">${costHtml(c, up)}<div class="body"><div class="title"><span class="nm">${esc(c.name)}</span>${up && c.up ? '<span class="t-up">+</span>' : ''} <span class="ctype"><span class="r-${esc(c.rarity)}">${esc(c.rarity || '')}</span> ${esc(c.type || '')}${col === 'all' ? ' · ' + esc(colorName(c.color)) : ''}</span></div><div class="desc">${fmt(t)}</div></div></a>`;
      }).join('')}</div>${list.length > 400 ? '<div class="note">Showing first 400. Narrow the filters to see more.</div>' : ''}`;
    });
    wireChips(view, page); wireSearch(view, 'cq', draw, q => rank(D.cards, q, c => c.name).map(c => ({ label: c.name, sub: `${c.rarity || ''} ${c.type || ''} · ${colorName(c.color)}`, href: '#/card/' + c.id })));
    $('#upT').addEventListener('change', e => { setUi('cup', e.target.checked); draw(); });
    draw();
  };
  page();
};

V.card = (id) => {
  const D = S.D, c = D.C[id]; if (!c) return notFound();
  const ut = upText(c); const ex = upExtras(c);
  const evs = (c.events || []).map(e => D.EV[e]).filter(Boolean);
  const canUp = !!(c.up || c.udesc);
  const up = canUp && ui('cdup', false);
  $('#view').innerHTML = backBtn() + `
    <div class="sub" style="text-align:center"><span class="r-${esc(c.rarity)}">${esc(c.rarity || '')}</span> ${esc(c.type || '')} · ${esc(colorName(c.color))}${c.target && c.target !== 'None' ? ' · targets ' + esc(c.target.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()) : ''}</div>
    ${canUp ? `<div style="text-align:center;margin:10px 0 2px"><div class="seg" id="upSeg"><button data-u="0" class="${up ? '' : 'on'}">Base</button><button data-u="1" class="${up ? 'on' : ''}">Upgraded</button></div></div>` : '<div class="note" style="text-align:center">Can’t be upgraded</div>'}
    <div id="gcWrap">${gameCard(c, up)}</div>
    <div id="upNote" class="note" style="text-align:center">${up && ex.length ? ex.map(esc).join(' · ') : ''}</div>
    ${(c.kw || []).length ? `<h2>Keywords</h2><div class="panel">${c.kw.map(k => { const kk = (D.keywords || []).find(x => norm(x.name || x.id) === norm(k)); return `<div><b>${esc(k)}</b>${kk?.description ? ' <span class="sub">' + fmt(kk.description) + '</span>' : ''}</div>`; }).join('')}</div>` : ''}
    ${evs.length ? `<h2>From events</h2>${evs.map(evRow).join('')}` : ''}`;
  $('#upSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const u = b.dataset.u === '1'; setUi('cdup', u);
    $('#upSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#gcWrap').innerHTML = gameCard(c, u);
    $('#upNote').innerHTML = u && ex.length ? ex.map(esc).join(' · ') : '';
  });
};

/* ---- relics ---- */
V.relics = () => {
  const D = S.D;
  const rar = ['Starter', 'Common', 'Uncommon', 'Rare', 'Shop', 'Event', 'Ancient'].filter(r => D.relics.some(x => x.rarity === r));
  const pools = [...new Set(D.relics.map(r => r.pool).filter(Boolean))];
  const page = () => {
    const { view, draw } = listPage(() => `
      ${searchBox('rq', 'Search relics or text')}
      ${chips('rrar', [['all', 'Any rarity'], ...rar.map(r => [r, r])], ui('rrar', 'all'))}
      ${chips('rpool', [['all', 'Any pool'], ...pools.map(p => [p, p === 'shared' ? 'Shared' : colorName(p)])], ui('rpool', 'all'))}`, () => {
      const q = norm(ui('rq', '')), ra = ui('rrar', 'all'), po = ui('rpool', 'all');
      const list = D.relics.filter(r => (ra === 'all' || r.rarity === ra) && (po === 'all' || r.pool === po) && (!q || norm(r.name).includes(q) || norm(strip(r.desc)).includes(q)))
        .sort((a, b) => (rar.indexOf(a.rarity) - rar.indexOf(b.rarity)) || a.name.localeCompare(b.name));
      if (!list.length) return '<div class="empty">No relics match.</div>';
      return `<div class="count">${list.length} relics</div><div class="list">${list.map(r => `<a class="item" href="#/relic/${r.id}">${imgTag(r.img, 'ico', r.name)}<div class="body"><div class="title"><span class="nm">${esc(r.name)}</span> <span class="ctype r-${esc(r.rarity)}">${esc(r.rarity)}</span>${r.pool && r.pool !== 'shared' ? ` <span class="ctype">· ${esc(colorName(r.pool))}</span>` : ''}</div><div class="desc">${fmt(r.desc)}</div>${relicSource(r, true)}</div></a>`).join('')}</div>`;
    });
    wireChips(view, page); wireSearch(view, 'rq', draw, q => rank(D.relics, q, r => r.name).map(r => ({ label: r.name, sub: `${r.rarity}${r.pool && r.pool !== 'shared' ? ' · ' + colorName(r.pool) : ''}`, href: '#/relic/' + r.id, img: r.img }))); draw();
  };
  page();
};
function relicSource(r, short) {
  const D = S.D; const bits = [];
  if (r.rarity === 'Event' && (short || !(r.events || []).length)) {
    const evs = (r.events || []).map(e => D.EV[e]).filter(Boolean);
    bits.push(evs.length ? 'From ' + evs.map(e => `${esc(e.name)}${e.acts?.length ? ' (' + esc(e.acts.join('/')) + ')' : ''}`).join(', ') : 'Event source not in the data yet');
  }
  if (r.ancients?.length) bits.push('Offered by ' + r.ancients.map(a => `${short ? esc(D.AN?.[a]?.name || title(a)) : `<a class="t-aqua" href="#/ancient/${a}">${esc(D.AN?.[a]?.name || title(a))}</a>`}${D.ancientActs[a] ? ' (' + esc(D.ancientActs[a].join('/')) + ')' : ''}`).join(', '));
  if (r.price) bits.push(`Shop ~${r.price}g`);
  return bits.length ? `<div class="foot">${bits.join(' · ')}</div>` : '';
}
V.relic = (id) => {
  const D = S.D, r = D.R[id]; if (!r) return notFound();
  const evs = (r.events || []).map(e => D.EV[e]).filter(Boolean);
  $('#view').innerHTML = backBtn() + `
    <div class="hero"><div class="art">${imgTag(r.img, '', r.name)}</div><div><h1>${esc(r.name)}</h1><div class="sub"><span class="r-${esc(r.rarity)}">${esc(r.rarity)}</span> relic · ${esc(r.pool === 'shared' ? 'Shared' : colorName(r.pool))}</div></div></div>
    <h2>Effect</h2><div class="panel">${fmt(r.desc)}</div>
    ${r.flavor && !/revealed in the future/.test(r.flavor) ? `<div class="note"><i>${fmt(r.flavor)}</i></div>` : ''}
    ${r.notes ? `<div class="note">${fmt(typeof r.notes === 'string' ? r.notes : JSON.stringify(r.notes))}</div>` : ''}
    ${relicSource(r)}
    ${evs.length ? `<h2>From events</h2>${evs.map(evRow).join('')}` : ''}`;
};

/* ---- events ---- */
function evRow(e) {
  return `<a class="item" href="#/event/${e.id}"><div class="body"><div class="title"><span class="nm">${esc(e.name)}</span> <span class="ctype">${esc((e.acts || []).join(' / ') || 'Any act')}</span></div></div><span class="faint">›</span></a>`;
}
V.events = () => {
  const D = S.D;
  const acts = ['Overgrowth', 'Underdocks', 'Hive', 'Glory'];
  const page = () => {
    const { view, draw } = listPage(() => `
      <h1>Events</h1>
      ${searchBox('vq', 'Search events')}
      ${chips('vact', [['all', 'All'], ...acts.map(a => [a, a]), ['none', 'Shared / other']], ui('vact', 'all'))}`, () => {
      const q = norm(ui('vq', '')), act = ui('vact', 'all');
      const list = D.events.filter(e => (act === 'all' || (act === 'none' ? !(e.acts || []).length : (e.acts || []).includes(act))) && (!q || norm(e.name).includes(q) || norm(strip(JSON.stringify(e.options || ''))).includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name));
      return `<div class="count">${list.length} events</div><div class="list">${list.map(evRow).join('')}</div>`;
    });
    wireChips(view, page); wireSearch(view, 'vq', draw, q => rank(D.events, q, e => e.name).map(e => ({ label: e.name, sub: (e.acts || []).join(' / ') || 'Any act', href: '#/event/' + e.id }))); draw();
  };
  page();
};
V.event = (id) => {
  const D = S.D, e = D.EV[id]; if (!e) return notFound();
  const opt = o => `<div class="opt-ev"><b>${fmt(o.title || title(o.id))}</b>${fmt(o.description || '')}</div>`;
  const relics = D.relics.filter(r => (r.events || []).includes(id));
  const cards = D.cards.filter(c => (c.events || []).includes(id));
  $('#view').innerHTML = backBtn() + `<h1>${esc(e.name)}</h1><div>${(e.acts || []).map(actBadge).join(' ') || '<span class="badge">Any act</span>'} ${e.type && e.type !== 'Event' ? `<span class="badge">${esc(e.type)}</span>` : ''}</div>
    ${e.desc ? `<div class="panel" style="margin-top:12px">${fmt(e.desc)}</div>` : ''}
    ${e.pre ? `<div class="note">Requires: ${fmt(typeof e.pre === 'string' ? e.pre : JSON.stringify(e.pre))}</div>` : ''}
    ${(e.options || []).length ? `<h2>Options</h2>${e.options.map(opt).join('')}` : ''}
    ${(e.pages || []).filter(p => (p.options || []).length).map(p => `<h2>${esc(title(p.id))}</h2>${p.desc ? `<div class="note">${fmt(p.desc)}</div>` : ''}${p.options.map(opt).join('')}`).join('')}
    ${relics.length ? `<h2>Relics</h2><div class="list">${relics.map(r => `<a class="item" href="#/relic/${r.id}">${imgTag(r.img, 'ico')}<div class="body"><div class="title"><span class="nm">${esc(r.name)}</span></div><div class="desc">${fmt(r.desc)}</div></div></a>`).join('')}</div>` : ''}
    ${cards.length ? `<h2>Cards</h2><div class="list">${cards.map(c => `<a class="item" href="#/card/${c.id}">${costHtml(c)}<div class="body"><div class="title"><span class="nm">${esc(c.name)}</span></div><div class="desc">${fmt(c.desc)}</div></div></a>`).join('')}</div>` : ''}`;
};

/* ---- potions / powers / ascension / characters / patch ---- */
V.potions = () => {
  const D = S.D;
  const page = () => {
    const { view, draw } = listPage(() => `<h1>Potions</h1>${searchBox('pq', 'Search potions')}`, () => {
      const q = norm(ui('pq', ''));
      const ord = ['Common', 'Uncommon', 'Rare', 'Event', 'Token'];
      const list = D.potions.filter(p => !q || norm(p.name).includes(q) || norm(strip(p.desc)).includes(q)).sort((a, b) => ((ord.indexOf(a.rarity) + 9) % 9 - (ord.indexOf(b.rarity) + 9) % 9) || a.name.localeCompare(b.name));
      return `<div class="count">${list.length} potions</div><div class="list">${list.map(p => `<div class="item">${imgTag(p.img, 'ico')}<div class="body"><div class="title"><span class="nm">${esc(p.name)}</span> <span class="ctype r-${esc(p.rarity)}">${esc(p.rarity || '')}</span>${p.pool && !['shared', 'event'].includes(p.pool) ? ` <span class="ctype">· ${esc(colorName(p.pool))}</span>` : ''}</div><div class="desc">${fmt(p.desc)}</div></div></div>`).join('')}</div>`;
    });
    wireSearch(view, 'pq', draw, q => rank(D.potions, q, p => p.name).map(p => ({ label: p.name, sub: p.rarity, img: p.img }))); draw();
  };
  page();
};
V.powers = () => {
  const D = S.D;
  const page = () => {
    const { view, draw } = listPage(() => `<h1>Powers &amp; keywords</h1>${searchBox('wq', 'Search buffs, debuffs, keywords')}
      ${chips('wtype', [['all', 'All'], ['Buff', 'Buffs'], ['Debuff', 'Debuffs'], ['kw', 'Card keywords']], ui('wtype', 'all'))}`, () => {
      const q = norm(ui('wq', '')), ty = ui('wtype', 'all');
      if (ty === 'kw') return `<div class="list">${(D.keywords || []).map(k => `<div class="item"><div class="body"><div class="title"><span class="nm">${esc(k.name || k.id)}</span></div><div class="desc">${fmt(k.description || '')}</div></div></div>`).join('')}</div>`;
      const list = D.powers.filter(p => (ty === 'all' || p.type === ty) && (!q || norm(p.name).includes(q) || norm(strip(p.desc)).includes(q))).sort((a, b) => a.name.localeCompare(b.name));
      return `<div class="count">${list.length} powers</div><div class="list">${list.map(p => `<div class="item">${imgTag(p.img, 'ico')}<div class="body"><div class="title"><span class="nm">${esc(p.name)}</span> <span class="ctype">${esc(p.type || '')}</span></div><div class="desc">${fmt(p.desc)}</div></div></div>`).join('')}</div>`;
    });
    wireChips(view, page); wireSearch(view, 'wq', draw, q => [...rank(D.powers, q, p => p.name).map(p => ({ label: p.name, sub: p.type, img: p.img })), ...rank(D.keywords || [], q, k => k.name || k.id).map(k => ({ label: k.name || k.id, sub: 'Card keyword' }))]); draw();
  };
  page();
};
V.ascension = () => {
  const D = S.D;
  $('#view').innerHTML = backBtn() + `<h1>Ascension</h1><div class="sub">Tap a level to set it for enemy stats. Each level includes every level below it.</div>
    ${D.dread ? `<button class="item" id="dreadBtn" style="text-align:left;cursor:pointer;margin-top:12px;${isDread() ? 'border-color:var(--accent)' : ''}"><div class="cost ${isDread() ? '' : 'none'}">D</div><div class="body"><div class="title"><span class="nm">Dread</span> <span class="badge">beta</span></div><div class="desc">${fmt(D.dread.intro || D.dread.desc)}</div>${(D.dread.rules || []).map((r, i) => `<div class="foot">${i + 1}. ${fmt(r)}</div>`).join('')}</div></button>
      <h2>Dominions</h2><div class="list">${(D.dread.dominions || []).map(d => `<div class="item"><div class="body"><div class="title"><span class="nm">${esc(d.name)}</span></div><div class="desc">${fmt(d.description)}</div></div></div>`).join('')}</div><h2>Ascension levels</h2>` : ''}
    <div class="list">${D.ascensions.map(a => `<button class="item" data-a="${a.level}" style="text-align:left;cursor:pointer;${a.level === S.asc && !isDread() ? 'border-color:var(--accent)' : ''}"><div class="cost ${a.level <= S.asc ? '' : 'none'}">${a.level}</div><div class="body"><div class="title"><span class="nm">${esc(a.name)}</span>${a.level === HP_ASC ? ' <span class="badge">enemy HP up</span>' : ''}${a.level === DMG_ASC ? ' <span class="badge">enemy damage up</span>' : ''}</div><div class="desc">${fmt(a.desc)}</div></div></button>`).join('')}</div>`;
  $('#view').querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => setAsc(+b.dataset.a)));
  $('#dreadBtn')?.addEventListener('click', () => setAsc(DREAD));
};
V.characters = () => {
  const D = S.D;
  const cn = id => D.cardByName[norm(id)]?.name || D.C[id.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()]?.name || id.replace(/([a-z])([A-Z])/g, '$1 $2');
  const rn = id => { const r = D.R[id.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()] || D.relicByName[norm(id)]; return r ? `<a href="#/relic/${r.id}" class="t-gold">${esc(r.name)}</a>` : esc(id); };
  $('#view').innerHTML = backBtn() + `<h1>Characters</h1>${D.characters.map(c => {
    const deck = {}; (c.deck || []).forEach(x => { const n = cn(x); deck[n] = (deck[n] || 0) + 1; });
    return `<div class="panel" style="margin-top:10px"><h3 class="nm">${esc(c.name)}</h3><div class="sub">${fmt(c.desc)}</div>
      <div class="stats"><div class="stat"><b class="hp">${c.hp}</b><span>HP</span></div><div class="stat"><b>${c.gold}</b><span>Gold</span></div><div class="stat"><b>${c.energy}</b><span>Energy</span></div>${c.orbs ? `<div class="stat"><b>${c.orbs}</b><span>Orb slots</span></div>` : ''}</div>
      <div class="note">Starting relic: ${(c.relics || []).map(rn).join(', ')}</div>
      <div class="note">Deck: ${Object.entries(deck).map(([n, k]) => `${k}× ${esc(n)}`).join(', ')}</div></div>`;
  }).join('')}`;
};
V.patch = () => {
  const D = S.D, cl = D.changelog;
  if (!cl) { $('#view').innerHTML = backBtn() + '<div class="empty">No patch summary for this build.</div>'; return; }
  const item = x => {
    const ch = (x.changes || []).slice(0, 6).map(c => `<li><span class="faint">${esc(c.field)}:</span> <span class="diff-old">${fmt(String(c.old ?? '').slice(0, 140))}</span> → <span class="diff-new">${fmt(String(c.new ?? '').slice(0, 140))}</span></li>`).join('');
    return `<li><b>${esc(x.name || x.id)}</b>${ch ? `<ul class="changes">${ch}</ul>` : ''}</li>`;
  };
  $('#view').innerHTML = backBtn() + `<h1>${esc(cl.title || 'Patch ' + D.version)}</h1><div class="sub">${esc(cl.date || '')} · +${cl.summary?.added ?? 0} added · ${cl.summary?.changed ?? 0} changed · −${cl.summary?.removed ?? 0} removed</div>
    ${(cl.categories || []).filter(c => (c.added || []).length + (c.changed || []).length + (c.removed || []).length).map(c => `<h2>${esc(c.name)}</h2><div class="panel">
      ${(c.added || []).length ? `<div class="t-green"><b>Added</b></div><ul class="changes">${c.added.map(x => `<li>${esc(x.name || x.id)}</li>`).join('')}</ul>` : ''}
      ${(c.removed || []).length ? `<div class="t-red"><b>Removed</b></div><ul class="changes">${c.removed.map(x => `<li>${esc(x.name || x.id)}</li>`).join('')}</ul>` : ''}
      ${(c.changed || []).length ? `<div class="t-gold"><b>Changed</b></div><ul class="changes">${c.changed.map(item).join('')}</ul>` : ''}</div>`).join('')}`;
};
V.ancients = () => {
  const D = S.D;
  $('#view').innerHTML = backBtn() + `<h1>Ancients</h1><div class="sub">Ancients appear at the start of each act and offer a choice of relics.</div>
    <div class="list">${(D.ancients || []).sort((a, b) => ACT_ORDER.indexOf(a.acts?.[0]) - ACT_ORDER.indexOf(b.acts?.[0]) || a.name.localeCompare(b.name)).map(a =>
      `<a class="item" href="#/ancient/${a.id}"><div class="body"><div class="title"><span class="nm">${esc(a.name)}</span> <span class="ctype">${esc((a.acts || []).join(' / ') || 'Special')}</span></div><div class="foot">${(a.relics || []).length} relics in its pool</div></div><span class="faint">›</span></a>`).join('')}</div>`;
};
V.ancient = (id) => {
  const D = S.D, a = D.AN?.[id]; if (!a) return notFound();
  const rs = (a.relics || []).map(r => D.R[r]).filter(Boolean);
  $('#view').innerHTML = backBtn() + `<h1>${esc(a.name)}</h1><div>${(a.acts || []).map(actBadge).join(' ') || '<span class="badge">Special</span>'}</div>
    ${a.desc ? `<div class="panel" style="margin-top:12px">${fmt(a.desc)}</div>` : ''}
    ${rs.length ? `<h2>Relic pool (${rs.length})</h2><div class="list">${rs.map(r => `<a class="item" href="#/relic/${r.id}">${imgTag(r.img, 'ico', r.name)}<div class="body"><div class="title"><span class="nm">${esc(r.name)}</span>${r.pool && r.pool !== 'shared' ? ` <span class="ctype">· ${esc(colorName(r.pool))}</span>` : ''}</div><div class="desc">${fmt(r.desc)}</div></div></a>`).join('')}</div>` : ''}`;
};
V.enchantments = () => {
  const D = S.D;
  const page = () => {
    const { view, draw } = listPage(() => `<h1>Enchantments</h1><div class="sub" style="margin-bottom:8px">Permanent modifiers some events, relics and cards put on cards in your deck.</div>${searchBox('nq', 'Search enchantments')}`, () => {
      const q = norm(ui('nq', ''));
      const list = (D.enchantments || []).filter(x => !q || norm(x.name).includes(q) || norm(strip(x.desc)).includes(q)).sort((a, b) => a.name.localeCompare(b.name));
      return `<div class="count">${list.length} enchantments</div><div class="list">${list.map(x => `<div class="item">${imgTag(x.img, 'ico', x.name)}<div class="body"><div class="title"><span class="nm">${esc(x.name)}</span>${x.cardType ? ` <span class="ctype">${esc(x.cardType)}s only</span>` : ''}${x.stack ? ' <span class="ctype">· stacks</span>' : ''}</div><div class="desc">${fmt(x.desc)}</div>${x.extra ? `<div class="foot">Card text: ${fmt(x.extra)}</div>` : ''}${x.applies ? `<div class="foot">Applies to: ${esc(Array.isArray(x.applies) ? x.applies.join(', ') : x.applies)}</div>` : ''}</div></div>`).join('')}</div>`;
    });
    wireSearch(view, 'nq', draw, q => rank(D.enchantments || [], q, x => x.name).map(x => ({ label: x.name, sub: x.cardType ? x.cardType + 's only' : 'Enchantment', img: x.img })));
    draw();
  };
  page();
};
/* Neowsletter: Mega Crit's monthly Steam post, fetched by the data Action into data/news.json */
let NEWS = null;
async function loadNews() {
  if (NEWS) return NEWS;
  NEWS = await (await fetch('data/news.json?h=' + encodeURIComponent(S.meta?.news?.updated || ''))).json();
  return NEWS;
}
function bbcode(src) {
  let h = esc(src || '');
  h = h.replace(/\[img\]\{STEAM_CLAN_IMAGE\}\/([^\[]+)\[\/img\]/g, (_, p) => `<img class="nimg" loading="lazy" src="https://clan.akamai.steamstatic.com/images/${p}">`);
  h = h.replace(/\[img(?:=[^\]]*)?\](https?:[^\[]+)\[\/img\]/g, (_, u) => `<img class="nimg" loading="lazy" src="${u}">`);
  h = h.replace(/\[previewyoutube=([\w-]+)[^\]]*\]\[\/previewyoutube\]/g, (_, id) => `<a class="t-gold" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">▶ Watch on YouTube</a>`);
  h = h.replace(/\[url=(?:&quot;)?([^\]]+?)(?:&quot;)?\]([\s\S]*?)\[\/url\]/g, (_, u, t) => `<a class="t-gold" href="${u}" target="_blank" rel="noopener">${t}</a>`);
  h = h.replace(/\[h1\]([\s\S]*?)\[\/h1\]/g, '<h3 class="nm nh">$1</h3>').replace(/\[h2\]([\s\S]*?)\[\/h2\]/g, '<h3 class="nm nh">$1</h3>').replace(/\[h3\]([\s\S]*?)\[\/h3\]/g, '<h4>$1</h4>');
  h = h.replace(/\[(\/?)(b|i|u)\]/g, '<$1$2>').replace(/\[hr\]\[\/hr\]|\[hr\]/g, '<hr>');
  h = h.replace(/\[list\]|\[olist\]/g, '<ul>').replace(/\[\/list\]|\[\/olist\]/g, '</ul>').replace(/\[\*\]([^\n\[]*)/g, '<li>$1</li>');
  h = h.replace(/\[\/?[a-z0-9]+(?:=[^\]]*)?\]/g, '');
  return h.replace(/\n{3,}/g, '\n\n').replace(/\n/g, '<br>');
}
V.news = async () => {
  $('#view').innerHTML = backBtn() + '<div class="loading">Loading the Neowsletter…</div>';
  let n; try { n = await loadNews(); } catch { $('#view').innerHTML = backBtn() + '<div class="empty">Couldn’t load the Neowsletter.</div>'; return; }
  const L = n.latest; if (!L) { $('#view').innerHTML = backBtn() + '<div class="empty">No Neowsletter found.</div>'; return; }
  const date = t => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  $('#view').innerHTML = backBtn() + `<h1>${esc(L.title)}</h1><div class="sub">${date(L.date)} · <a class="t-gold" href="${esc(L.url)}" target="_blank" rel="noopener">Open on Steam</a></div>
    <div class="panel news" style="margin-top:12px">${bbcode(L.body)}</div>
    ${(n.past || []).length ? `<h2>Earlier Neowsletters</h2><div class="list">${n.past.map(p => `<a class="item" href="${esc(p.url)}" target="_blank" rel="noopener"><div class="body"><div class="title"><span class="nm">${esc(p.title)}</span></div><div class="foot">${date(p.date)}</div></div><span class="faint">↗</span></a>`).join('')}</div>` : ''}`;
};

V.more = () => {
  const D = S.D, m = S.meta?.[S.branch] || {};
  $('#view').innerHTML = `<h1>More</h1><div class="morelist" style="margin-top:12px">
    <a href="#/news">The Neowsletter <span>${esc((S.meta?.news?.latest || '').replace(/^The Neowsletter - /, '')) || 'Latest'} ›</span></a>
    <a href="#/events">Events <span>${D.events.length} ›</span></a>
    <a href="#/ancients">Ancients <span>${(D.ancients || []).length} ›</span></a>
    <a href="#/enchantments">Enchantments <span>${(D.enchantments || []).length} ›</span></a>
    <a href="#/potions">Potions <span>${D.potions.length} ›</span></a>
    <a href="#/powers">Powers &amp; keywords <span>${D.powers.length} ›</span></a>
    <a href="#/ascension">Ascension levels <span>${ascLabel(S.asc)} ›</span></a>
    <a href="#/characters">Characters <span>${D.characters.length} ›</span></a>
    <a href="#/patch">Latest patch changes <span>v${esc(D.version)} ›</span></a>
  </div>
  <h2>Data</h2><div class="panel sub">
    <div><b>Main</b>: v${esc(S.meta?.main?.version || '?')} · updated ${esc(S.meta?.main?.updated || '?')}</div>
    <div><b>Beta</b>: v${esc(S.meta?.beta?.version || '?')} · updated ${esc(S.meta?.beta?.updated || '?')}</div>
    <div class="note">Checked every few hours against <a class="t-gold" href="https://spire-codex.com" target="_blank" rel="noopener">Spire Codex</a>, which extracts each patch from the game files. Enemy, card and relic images are served by Spire Codex. Game content © Mega Crit.</div>
    <div class="note">Ascension levels for each enemy value, Dread buffs and event relic sources are read from the game files on Vig’s Mac whenever Steam updates the game.</div>
  </div>`;
};

function backBtn() { return `<button class="back" onclick="history.length > 1 ? history.back() : (location.hash = '#/enemies')">‹ Back</button>`; }
function notFound() { $('#view').innerHTML = backBtn() + `<div class="empty">Not in the ${S.branch} branch data.</div>`; }

/* ---------------- shell ---------------- */
function setAsc(a) {
  const max = Math.max(...(S.D?.ascensions || [{ level: 10 }]).map(x => x.level)) + (S.D?.dread ? 1 : 0);
  S.asc = Math.max(0, Math.min(max, a)); store.set('asc', S.asc);
  paintHeader(); route(true);
}
async function setBranch(b) {
  if (b === S.branch) return;
  S.branch = b; store.set('branch', b); paintHeader();
  $('#view').innerHTML = '<div class="loading">Loading ' + b + ' data…</div>';
  S.D = await loadBranch(b); paintHeader(); route(true);
}
function paintHeader() {
  document.querySelectorAll('#branch button').forEach(x => x.classList.toggle('on', x.dataset.b === S.branch));
  if (S.D && S.asc >= DREAD && !S.D.dread) S.asc = DREAD - 1;
  $('#ascVal').textContent = S.asc >= DREAD ? 'Dread' : 'A' + S.asc;
  $('#ascVal').classList.toggle('dread', S.asc >= DREAD);
  $('#ascVal').classList.toggle('hot', S.asc >= HP_ASC);
  const m = S.meta?.[S.branch];
  $('#ver').textContent = m ? `v${m.version}` : '';
}
const scrollPos = {};
function route(keepScroll) {
  const h = location.hash.replace(/^#\/?/, '') || 'enemies';
  const [name, arg] = h.split('/');
  const top = { enemies: 'enemies', enemy: 'enemies', fights: 'fights', fight: 'fights', cards: 'cards', card: 'cards', relics: 'relics', relic: 'relics' }[name] || 'more';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.t === top));
  const y = window.scrollY;
  try { (V[name] || V.enemies)(arg && decodeURIComponent(arg)); }
  catch (err) { console.error(err); $('#view').innerHTML = `<div class="empty">Something in this page’s data didn’t parse (${esc(err.message)}).</div>`; }
  window.scrollTo(0, keepScroll ? y : (scrollPos[h] || 0));
}
let lastHash = location.hash;
window.addEventListener('scroll', () => { scrollPos[(location.hash.replace(/^#\/?/, '') || 'enemies')] = window.scrollY; }, { passive: true });
window.addEventListener('hashchange', () => { lastHash = location.hash; route(false); });

async function boot() {
  document.querySelectorAll('#branch button').forEach(b => b.addEventListener('click', () => setBranch(b.dataset.b)));
  $('#ascDown').addEventListener('click', () => setAsc(S.asc - 1));
  $('#ascUp').addEventListener('click', () => setAsc(S.asc + 1));
  paintHeader();
  await loadMeta();
  try { S.D = await loadBranch(S.branch); }
  catch (e) { $('#view').innerHTML = '<div class="empty">Couldn’t load game data. Check your connection and reopen.</div>'; return; }
  paintHeader(); route(false);
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
