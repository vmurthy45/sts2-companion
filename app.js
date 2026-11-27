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
function fmt(s, energy = 'colorless') {
  if (s == null) return '';
  let h = esc(String(s).replaceAll('[Amount]', 'X').replace(/\[(TargetPlayer|ApplierName)\]/g, 'the target').replace(/\[Card\]/g, 'a card'));
  for (const c of COLORS) h = h.replaceAll(`[${c}]`, `<span class="t-${c}">`).replaceAll(`[/${c}]`, '</span>');
  h = h.replace(/\[b\]/g, '<b>').replace(/\[\/b\]/g, '</b>').replace(/\[i\]/g, '<i>').replace(/\[\/i\]/g, '</i>');
  const ico = (src, n) => { const k = parseInt(n, 10); const many = Number.isNaN(k) || k <= 0 || k >= 5; return (many ? `<span>${esc(n)}</span>` : '') + `<img class="tico" src="${src}" alt="">`.repeat(many ? 1 : k); };
  h = h.replace(/\[energy:(\w+)\]/g, (_, n) => ico(`https://cdn.spire-codex.com/icons/${energy}_energy_icon.webp`, n));
  h = h.replace(/\[star:(\w+)\]/g, (_, n) => ico('https://cdn.spire-codex.com/icons/star_icon.webp', n));
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
    const first = P.states.find(s => s.type === 'move');
    const cs = P.states.find(s => s.type === 'conditional' && (s.branches || []).length);
    if (rs) h += `<div class="note">Picks at random each turn:</div>${renderRandom(m, model, rs)}`;
    else if (cs) h += `<div class="note">Opening move depends on the situation:</div>${renderCond(m, model, cs, 1, str0)}`;
    else if (first) {
      // a loop with no fixed opener: the game picks where each one starts (e.g. Corpse Slugs start on different moves)
      const steps = walk(model, first.id).filter(x => x.kind === 'move');
      h += `<div class="note">Repeats this loop. The move it starts on varies${(m.encounters || []).some(id => (S.D.E[id]?.lineup?.fixed?.[m.id] || 0) > 1) ? ' (in a group, each one starts on a different move)' : ''}:</div>${renderSeq(m, model, first.id, 1, str0).replace(/Turn (\d+)/g, 'Move $1').replace(/from turn (\d+)/g, 'from move $1')}`;
    }
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
/* compact filter: native dropdown styled as a chip (iOS shows its wheel picker) */
function fsel(key, opts) {
  const cur = String(ui(key, 'all'));
  return `<label class="fsel ${cur !== 'all' ? 'on' : ''}"><select data-key="${key}" aria-label="${esc(opts[0][1])}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
function wireSelects(root, redraw) {
  root.querySelectorAll('.fsel select').forEach(sel => sel.addEventListener('change', () => {
    setUi(sel.dataset.key, sel.value); sel.parentElement.classList.toggle('on', sel.value !== 'all'); redraw();
  }));
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
      <div class="frow">${fsel('eact', [['all', 'Act'], ...acts.map(a => [a, a])])}
      ${fsel('etype', [['all', 'Type'], ['Normal', 'Normal'], ['Elite', 'Elite'], ['Boss', 'Boss']])}</div>`, () => {
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
    wireSelects(view, draw); wireSearch(view, 'eq', draw, q => rank(D.monsters, q, m => m.name).map(sgEnemy)); draw();
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
    ${doms.map(d => `<div style="margin-top:6px"><b class="nm">${esc(d.name)}</b><div class="gtext">${fmt(d.description)}</div></div>`).join('')}</div>`;
}

V.enemy = (id) => {
  const m = S.D.M[id];
  if (!m) return notFound();
  $('#view').innerHTML = backBtn() + enemyBlock(m) + ascNote();
};
const ascNote = () => `<div class="note faint" style="margin-top:20px">Each value switches at the ascension level the game code uses (HP and block mostly at A8 Tough Enemies, damage at A9 Deadly Enemies). Dread adds the boss buffs read from the game code. Strength gained from its own moves is added to later turns; your Weak, Vulnerable and Block are not.</div>`;

/* Fight line-up from the game code: fixed counts, random slots, summons (Dread can differ) */
function lineup(e) {
  const D = S.D, lu = e.lineup;
  if (!lu) return { fixed: (e.monsters || []).map(id => ({ m: D.M[id], n: 1 })).filter(x => x.m), random: null, summons: [] };
  const counts = Object.assign({}, lu.fixed || {}, isDread() ? (lu.dread || {}) : {});
  return {
    fixed: Object.entries(counts).map(([id, n]) => ({ m: D.M[id], n })).filter(x => x.m),
    random: lu.random ? { n: lu.random.n, from: (lu.random.from || []).map(id => D.M[id]).filter(Boolean) } : null,
    summons: (lu.summons || []).map(id => D.M[id]).filter(Boolean),
  };
}
function encRow(e) {
  const L = lineup(e);
  const label = e.weak ? 'Weak' : (e.room === 'Monster' ? 'Normal' : e.room);
  const thumbs = [...L.fixed.map(x => x.m), ...(L.random?.from || [])].slice(0, 3);
  const who = [
    ...L.fixed.map(({ m, n }) => { const h = hpOf(m); return `${n > 1 ? `<b>${n}×</b> ` : ''}${esc(m.name)} ${range(h.lo, h.hi)}`; }),
    L.random ? `${L.random.n ? `<b>${L.random.n}×</b> random` : 'random'}: ${L.random.from.map(m => esc(m.name)).join(' / ')}` : '',
    L.summons.length ? `summons ${L.summons.map(m => esc(m.name)).join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  return `<a class="enc" href="#/fight/${e.id}"><div class="thumbs">${thumbs.map(m => imgTag(m.img, '', m.name)).join('')}</div><div class="body"><b>${esc(e.name)}</b> ${typeBadge(label)}<div class="who">${who}</div></div><span class="faint">›</span></a>`;
}

V.fights = () => {
  const D = S.D;
  const acts = ACT_ORDER.filter(a => D.encounters.some(e => e.act === a));
  const page = () => {
    const { view, draw } = listPage(() => `
      ${searchBox('fq', 'Search fights or enemies')}
      <div class="frow">${fsel('fact', [['all', 'Act'], ...acts.map(a => [a, a])])}
      ${fsel('froom', [['all', 'Room'], ['Weak', 'Weak'], ['Normal', 'Normal'], ['Elite', 'Elite'], ['Boss', 'Boss']])}</div>`, () => {
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
    wireSelects(view, draw); wireSearch(view, 'fq', draw, q => [...rank(D.encounters, q, e => e.name).map(e => ({ label: e.name, sub: `${e.weak ? 'Weak' : e.room === 'Monster' ? 'Normal' : e.room} · ${e.act}`, href: '#/fight/' + e.id })), ...rank(D.monsters, q, m => m.name).map(sgEnemy)]); draw();
  };
  page();
};

V.fight = (id) => {
  const D = S.D, e = D.E[id];
  if (!e) return notFound();
  const L = lineup(e);
  const label = e.weak ? 'Weak' : (e.room === 'Monster' ? 'Normal' : e.room);
  let lo = 0, hi = 0, count = 0;
  for (const { m, n } of L.fixed) { const h = hpOf(m); lo += n * (h.lo || 0); hi += n * (h.hi || h.lo || 0); count += n; }
  const exact = !L.random || L.random.n;
  if (L.random?.n && L.random.from.length) {
    const hs = L.random.from.map(m => hpOf(m));
    lo += L.random.n * Math.min(...hs.map(h => h.lo || 0)); hi += L.random.n * Math.max(...hs.map(h => h.hi || h.lo || 0)); count += L.random.n;
  }
  const block = (m, n, note) => `<div class="fight-mon">${n > 1 || note ? `<div class="mult">${n > 1 ? `${n}×` : ''}${note ? ` <span>${esc(note)}</span>` : ''}</div>` : ''}${enemyBlock(m, { link: true, noEncounters: true })}</div>`;
  $('#view').innerHTML = backBtn() + `<h1>${esc(e.name)}</h1><div>${typeBadge(label)} ${actBadge(e.act)}</div>
    <div class="stats"><div class="stat"><b class="hp">${exact ? range(lo, hi) : range(lo, hi) + '+'}</b><span>Total HP · ${ascLabel(S.asc)}</span></div><div class="stat"><b>${exact ? count : count + '+'}</b><span>Enemies</span></div></div>
    ${e.lineup?.dread ? `<div class="note">${isDread() ? 'Dread line-up shown.' : `In Dread: ${Object.entries(e.lineup.dread).map(([k, n]) => `${n}× ${esc(D.M[k]?.name || k)}`).join(', ')}.`}</div>` : ''}
    ${L.fixed.map(({ m, n }) => block(m, n)).join('')}
    ${L.random ? `<h2>${L.random.n ? `${L.random.n} random` : 'Random'} from these</h2>${L.random.from.map(m => block(m, 1, 'possible')).join('')}` : ''}
    ${L.summons.length ? `<h2>Summoned during the fight</h2>${L.summons.map(m => block(m, 1, 'summoned')).join('')}` : ''}` + ascNote();
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
/* ---- In-game card render ----
   Layered from the game's own card-frame pieces (served by Spire Codex), positioned on the game's
   300×422 card canvas. Layout numbers adapted from Spire Codex's CardRender (PolyForm Noncommercial,
   © Peter Lord and Spire Codex contributors). */
const FR = n => `https://cdn.spire-codex.com/card-frames/${n}.webp`;
const ICON = n => `https://cdn.spire-codex.com/icons/${n}.webp`;
const CW = 300, CH = 422, CX = 150, CY = 211;
const GAME_COLORS = { gold: '#efc851', red: '#ff5555', green: '#7fff00', blue: '#87ceeb', purple: '#ee82ee', orange: '#ffa518', pink: '#ff78a0', aqua: '#2aebbe' };
const TITLE_OUTLINE = { common: '#4d4b40', uncommon: '#005c75', rare: '#6b4b00', curse: '#550b9e', quest: '#7e3e15', status: '#4f522f', event: '#1b6131', ancient: '#4d4b40' };
const ENERGY_OUTLINE = { ironclad: '#802020', silent: '#1a6625', regent: '#803d0e', necrobinder: '#803367', defect: '#1d5673', fool: '#5a4411', quest: '#431e14', colorless: '#5c5440' };
const ENERGY_BOX = { colorless: [74, 74, 1, 2, 71, 71], defect: [74, 74, 1, 1, 71, 72], necrobinder: [74, 74, 0, 3, 74, 69] };
const CHARS6 = ['ironclad', 'silent', 'defect', 'necrobinder', 'regent', 'fool'];
const KW_BEFORE = ['Unplayable', 'Innate', 'Retain', 'Sly', 'Ethereal'], KW_AFTER = ['Exhaust', 'Eternal'];
const bx = (l, t, w, h) => `left:${l + CX}px;top:${t + CY}px;width:${w}px;height:${h}px`;
const kreonBase = (top, height, size) => top + (height - (61 / 48) * size - 3) / 2 + (47 / 48) * size;

function energyOf(c) { return CHARS6.includes(c.color) ? c.color : c.color === 'quest' ? 'quest' : 'colorless'; }
function svgText(text, x, y, size, weight, fill, stroke, radius, fit) {
  const common = `x="${x + CX}" y="${y + CY}" text-anchor="middle" font-family="Kreon, Georgia, serif" font-size="${size}" font-weight="${weight}" stroke-width="${radius * 2}" stroke-linejoin="round" paint-order="stroke"${fit ? ` data-fit="${fit}"` : ''}`;
  return `<svg class="gc-svg" width="${CW}" height="${CH}" aria-hidden="true"><g opacity="0.188" transform="translate(2 2)"><text ${common} fill="#000" stroke="#000">${esc(text)}</text></g><text ${common} fill="${fill}" stroke="${stroke}">${esc(text)}</text></svg>`;
}
/* game rich text: [gold]..[/gold] colours, [energy:n]/[star:n] icons; numbers that changed on upgrade in green */
function cardText(src, energy, baseSrc) {
  let s = String(src || '');
  if (baseSrc != null) {   // mark numbers that differ from the base text
    const a = String(baseSrc).split(/(\d+)/), b = s.split(/(\d+)/);
    if (a.length === b.length) s = b.map((t, i) => (i % 2 && t !== a[i]) ? `\u0001${t}\u0002` : t).join('');
  }
  let h = esc(s);
  for (const [k, v] of Object.entries(GAME_COLORS)) h = h.replaceAll(`[${k}]`, `<span style="color:${v}">`).replaceAll(`[/${k}]`, '</span>');
  const icon = (src, n, g) => {
    const num = parseInt(n, 10), counted = n !== 'X' && !Number.isNaN(num), numbered = counted && (num <= 0 || num >= 5);
    const reps = !counted || numbered ? 1 : num;
    return (numbered ? `<span${g ? ` style="color:${GAME_COLORS.green}"` : ''}>${num}</span>` : '') + `<img class="gc-ico" src="${src}" alt="">`.repeat(reps);
  };
  h = h.replace(/\[energy:(\w+)\]/g, (_, n) => icon(ICON(`${energy}_energy_icon`), n)).replace(/\[star:(\w+)\]/g, (_, n) => icon(ICON('star_icon'), n));
  h = h.replace(/\[\/?[a-z_]+(?:=[^\]]*)?\]/g, '');
  h = h.replace(/\u0001/g, `<span style="color:${GAME_COLORS.green}">`).replace(/\u0002/g, '</span>');
  return h.split('\n').map(p => `<div>${p || '&#8203;'}</div>`).join('');
}
function cardKeywords(c, up) {
  const kw = new Set(c.kw || []);
  const u = up ? (c.up || {}) : {};
  if (u.add_innate) kw.add('Innate'); if (u.add_retain) kw.add('Retain'); if (u.add_exhaust === true) kw.add('Exhaust');
  if (u.remove_exhaust) kw.delete('Exhaust'); if (u.remove_ethereal) kw.delete('Ethereal'); if (u.remove_innate) kw.delete('Innate'); if (u.remove_retain) kw.delete('Retain');
  if (c.cost == null || c.cost < 0) { if (c.type === 'Status' || c.type === 'Curse') kw.add('Unplayable'); }
  return kw;
}
function gameCard(c, up) {
  up = up && !!(c.up || c.udesc);
  const type = c.type || 'Skill';
  const ft = ['Attack', 'Power', 'Quest'].includes(type) ? type.toLowerCase() : 'skill';
  const bt = ft === 'quest' ? 'skill' : ft;
  const fc = CHARS6.includes(c.color) ? c.color : ['curse', 'quest'].includes(c.color) ? c.color : 'colorless';
  const rl = String(c.rarity || '').toLowerCase();
  const rarity = ['uncommon', 'rare', 'curse', 'status', 'event', 'quest', 'ancient'].includes(rl) ? rl : 'common';
  const energy = energyOf(c);
  const art = c.img;  // c.bimg is the game's optional placeholder "beta art", not the beta branch
  // body: keyword lines (as the game prints them) around the description
  const kw = cardKeywords(c, up);
  const desc = up ? (upText(c) || c.desc) : c.desc;
  const before = KW_BEFORE.filter(k => kw.has(k)).map(k => `[gold]${k}[/gold].`);
  const after = KW_AFTER.filter(k => kw.has(k)).map(k => `[gold]${k}[/gold].`);
  const body = [...before, desc, ...after].filter(Boolean).join('\n');
  const baseBody = up ? [...KW_BEFORE.filter(k => cardKeywords(c, false).has(k)).map(k => `[gold]${k}[/gold].`), c.desc, ...KW_AFTER.filter(k => cardKeywords(c, false).has(k)).map(k => `[gold]${k}[/gold].`)].filter(Boolean).join('\n') : null;
  // cost
  let cost = c.cost, costUp = false;
  if (up && c.up && c.up.cost != null) { const v = String(c.up.cost); cost = /^[+-]/.test(v) ? c.cost + Number(v) : Number(v); costUp = true; }
  const showOrb = c.x || (cost != null && cost >= 0);
  const eb = ENERGY_BOX[energy] || [74, 74, 0, 0, 74, 74], es = 64 / Math.max(eb[0], eb[1]);
  const eL = -166 + (64 - eb[0] * es) / 2 + eb[2] * es, eT = -227 + (64 - eb[1] * es) / 2 + eb[3] * es;
  const bs = 327 / 655, bTop = -207 + (83 - 170 * bs) / 2;
  const hasStar = c.xstar || (c.star != null && c.star >= 0);
  const title = c.name + (up ? '+' : '');
  return `<div class="gcard-wrap"><div class="gcard">
    <img class="gl" src="${FR('frame_attack_colorless')}" style="${bx(-138, -199, 299, 422)};filter:brightness(0);opacity:.251" alt="">
    ${art ? `<img class="gl" src="${esc(art)}" style="${bx(-125, -168, 250, 190)};object-fit:contain" alt="">` : ''}
    <img class="gl" src="${FR(`frame_${ft}_${fc}`)}" style="${bx(-150, -211, ft === 'quest' ? 299.5 : 299, 422)}" alt="">
    <div class="gc-desc" style="${bx(-122, 37, 243, 136)}"><div class="gc-desc-in">${cardText(body, energy, baseBody)}</div></div>
    <img class="gl" src="${FR(`border_${bt}_${rarity}`)}" style="${bx(-137.5, -164, 275, 210)}" alt="">
    <img class="gl" src="${FR(`banner_${rarity}`)}" style="${bx(-163 + bs, bTop + 23 * bs, 653 * bs, 145 * bs)}" alt="">
    ${svgText(title, 0, kreonBase(-204, 54, 26) + 0.5, 26, 400, up ? GAME_COLORS.green : '#fff6e2', up ? '#1b6131' : (TITLE_OUTLINE[rarity] || '#4d4b40'), 3, 210)}
    <div class="gc-plaque" style="${bx(-30, 1, 61, 37)};border-image-source:url(${FR(`plaque_${rarity}`)})"><span>${esc(type)}</span></div>
    ${showOrb ? `<img class="gl" src="${FR(`energy_${energy}`)}" style="${bx(eL, eT, eb[4] * es, eb[5] * es)}" alt="">
      ${svgText(c.x ? 'X' : String(cost), -134, kreonBase(-221, 56, 35) - 0.5, 35, 700, costUp ? GAME_COLORS.green : '#fff6e2', costUp ? '#1f5923' : (ENERGY_OUTLINE[energy] || '#4c4943'), 3.5)}` : ''}
    ${hasStar ? `<img class="gl" src="https://cdn.spire-codex.com/card-render/energy_star.png" style="${bx(-186, -189, 58, 58)}" alt="">
      ${svgText(c.xstar ? 'X' : String(c.star), -157, kreonBase(-180, 40, 23.5) - 2.5, 23.5, 700, '#fff6e2', 'rgba(23,85,97,0.863)', 2.75)}` : ''}
  </div></div>`;
}
/* After inserting a card: scale the 300×422 canvas to the wrapper, shrink the title to fit,
   size the type plaque, and shrink the description font until it fits its box (like the game). */
function fitCards(root = document) {
  root.querySelectorAll('.gcard-wrap').forEach(w => {
    const g = w.querySelector('.gcard');
    const fit = () => {
      g.style.transform = `scale(${w.clientWidth / CW})`;
      w.style.height = (w.clientWidth * CH / CW) + 'px';
      w.querySelectorAll('text[data-fit]').forEach(t => {
        const max = +t.dataset.fit, nodes = t.closest('svg').querySelectorAll('text');
        let size = 26; nodes.forEach(n => n.setAttribute('font-size', size));
        while (t.getComputedTextLength() > max && size > 7) { size--; nodes.forEach(n => { n.setAttribute('font-size', size); n.setAttribute('y', kreonBase(-204, 54, size) + 0.5 + CY); }); }
      });
      const pl = w.querySelector('.gc-plaque'), sp = pl?.querySelector('span');
      if (pl && sp) { const pw = Math.max(sp.offsetWidth + 17, 61); pl.style.width = pw + 'px'; pl.style.left = (CX + Math.round(-pw / 2)) + 'px'; }
      const box = w.querySelector('.gc-desc'), inner = w.querySelector('.gc-desc-in');
      let fs = 21; inner.style.fontSize = fs + 'px';
      while (inner.scrollHeight > box.clientHeight && fs > 12) { fs -= 0.5; inner.style.fontSize = fs + 'px'; }
    };
    fit();
    document.fonts?.ready.then(fit);
  });
}
window.addEventListener('resize', () => fitCards());
function costHtml(c, up) {
  const en = energyOf(c);
  const orb = cls => `<div class="cost orb ${cls}" style="background-image:url(https://cdn.spire-codex.com/card-frames/energy_${en}.webp);--eo:${ENERGY_OUTLINE[en] || '#4c4943'}">`;
  let cost = c.cost, changed = false;
  if (up && c.up && c.up.cost != null) {
    const v = String(c.up.cost);
    cost = /^[+-]/.test(v) ? c.cost + Number(v) : Number(v); changed = true;
  }
  if (c.x) return orb('') + 'X</div>';
  if (c.star != null && (cost == null || cost < 0)) return `<div class="cost orb star" style="background-image:url(https://cdn.spire-codex.com/card-render/energy_star.png)">${c.star}</div>`;
  if (cost == null || cost < 0) return `<div class="cost none"></div>`;
  return orb(changed ? 'changed' : '') + cost + '</div>';
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
      <div class="frow">
        ${fsel('ccolor', [['all', 'Character'], ...colors.map(c => [c, colorName(c)])])}
        ${fsel('ctype', [['all', 'Type'], ...['Attack', 'Skill', 'Power', 'Status', 'Curse', 'Quest'].filter(t => D.cards.some(c => c.type === t)).map(t => [t, t])])}
        ${fsel('crar', [['all', 'Rarity'], ...['Basic', 'Common', 'Uncommon', 'Rare', 'Ancient', 'Event', 'Token'].filter(r => D.cards.some(c => c.rarity === r)).map(r => [r, r])])}
        <button type="button" id="upT" class="fbtn ${ui('cup', false) ? 'on' : ''}" aria-pressed="${!!ui('cup', false)}">Upgraded</button>
      </div>`, () => {
      const q = norm(ui('cq', '')), col = ui('ccolor', 'all'), ty = ui('ctype', 'all'), ra = ui('crar', 'all'), up = ui('cup', false);
      const list = D.cards.filter(c => (col === 'all' || c.color === col) && (ty === 'all' || c.type === ty) && (ra === 'all' || c.rarity === ra) &&
        (!q || norm(c.name).includes(q) || norm(strip(c.desc)).includes(q) || norm(strip(c.udesc)).includes(q)))
        .sort((a, b) => (colors.indexOf(a.color) - colors.indexOf(b.color)) || ((a.order ?? 9999) - (b.order ?? 9999)) || a.name.localeCompare(b.name));
      if (!list.length) return '<div class="empty">No cards match.</div>';
      return `<div class="count">${list.length} cards</div><div class="list">${list.slice(0, 400).map(c => {
        const t = up ? (upText(c) || c.desc) : c.desc;
        return `<a class="item cardrow" style="--cc:${cardColor(c)}" href="#/card/${c.id}">${costHtml(c, up)}<div class="body"><div class="title"><span class="nm">${esc(c.name)}</span>${up && c.up ? '<span class="t-up">+</span>' : ''} <span class="ctype"><span class="r-${esc(c.rarity)}">${esc(c.rarity || '')}</span> ${esc(c.type || '')}${col === 'all' ? ' · ' + esc(colorName(c.color)) : ''}</span></div><div class="desc">${fmt(t, energyOf(c))}</div></div></a>`;
      }).join('')}</div>${list.length > 400 ? '<div class="note">Showing first 400. Narrow the filters to see more.</div>' : ''}`;
    });
    wireSearch(view, 'cq', draw, q => rank(D.cards, q, c => c.name).map(c => ({ label: c.name, sub: `${c.rarity || ''} ${c.type || ''} · ${colorName(c.color)}`, href: '#/card/' + c.id })));
    $('#upT').addEventListener('click', e => { const on = !ui('cup', false); setUi('cup', on); e.currentTarget.classList.toggle('on', on); e.currentTarget.setAttribute('aria-pressed', on); draw(); });
    wireSelects(view, draw);
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
    ${(c.kw || []).length ? `<h2>Keywords</h2><div class="panel">${c.kw.map(k => { const kk = (D.keywords || []).find(x => norm(x.name || x.id) === norm(k)); return `<div style="margin:3px 0"><b class="nm" style="color:#efc851">${esc(k)}</b>${kk?.description ? ' <span class="gtext">' + fmt(kk.description) + '</span>' : ''}</div>`; }).join('')}</div>` : ''}
    ${evs.length ? `<h2>From events</h2>${evs.map(evRow).join('')}` : ''}`;
  fitCards($('#gcWrap'));
  $('#upSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const u = b.dataset.u === '1'; setUi('cdup', u);
    $('#upSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#gcWrap').innerHTML = gameCard(c, u);
    fitCards($('#gcWrap'));
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
      <div class="frow">${fsel('rrar', [['all', 'Rarity'], ...rar.map(r => [r, r])])}
      ${fsel('rpool', [['all', 'Pool'], ...pools.map(p => [p, p === 'shared' ? 'Shared' : colorName(p)])])}</div>`, () => {
      const q = norm(ui('rq', '')), ra = ui('rrar', 'all'), po = ui('rpool', 'all');
      const list = D.relics.filter(r => (ra === 'all' || r.rarity === ra) && (po === 'all' || r.pool === po) && (!q || norm(r.name).includes(q) || norm(strip(r.desc)).includes(q)))
        .sort((a, b) => (((rar.indexOf(a.rarity) + 99) % 99) - ((rar.indexOf(b.rarity) + 99) % 99)) || a.name.localeCompare(b.name));
      if (!list.length) return '<div class="empty">No relics match.</div>';
      return `<div class="count">${list.length} relics</div><div class="list">${list.map(r => `<a class="item" href="#/relic/${r.id}">${imgTag(r.img, 'ico', r.name)}<div class="body"><div class="title"><span class="nm">${esc(r.name)}</span> <span class="ctype r-${esc(r.rarity)}">${esc(r.rarity)}</span>${r.pool && r.pool !== 'shared' ? ` <span class="ctype">· ${esc(colorName(r.pool))}</span>` : ''}</div><div class="desc">${fmt(r.desc)}</div>${relicSource(r, true)}</div></a>`).join('')}</div>`;
    });
    wireSelects(view, draw); wireSearch(view, 'rq', draw, q => rank(D.relics, q, r => r.name).map(r => ({ label: r.name, sub: `${r.rarity}${r.pool && r.pool !== 'shared' ? ' · ' + colorName(r.pool) : ''}`, href: '#/relic/' + r.id, img: r.img }))); draw();
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
    <h2>Effect</h2><div class="panel gtext">${fmt(r.desc)}</div>
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
      <div class="frow">${fsel('vact', [['all', 'Act'], ...acts.map(a => [a, a]), ['none', 'Shared / other']])}</div>`, () => {
      const q = norm(ui('vq', '')), act = ui('vact', 'all');
      const list = D.events.filter(e => (act === 'all' || (act === 'none' ? !(e.acts || []).length : (e.acts || []).includes(act))) && (!q || norm(e.name).includes(q) || norm(strip(JSON.stringify(e.options || ''))).includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name));
      return `<div class="count">${list.length} events</div><div class="list">${list.map(evRow).join('')}</div>`;
    });
    wireSelects(view, draw); wireSearch(view, 'vq', draw, q => rank(D.events, q, e => e.name).map(e => ({ label: e.name, sub: (e.acts || []).join(' / ') || 'Any act', href: '#/event/' + e.id }))); draw();
  };
  page();
};
V.event = (id) => {
  const D = S.D, e = D.EV[id]; if (!e) return notFound();
  const opt = o => `<div class="opt-ev"><b>${fmt(o.title || title(o.id))}</b>${fmt(o.description || '')}</div>`;
  const relics = D.relics.filter(r => (r.events || []).includes(id));
  const cards = D.cards.filter(c => (c.events || []).includes(id));
  $('#view').innerHTML = backBtn() + `<h1>${esc(e.name)}</h1><div>${(e.acts || []).map(actBadge).join(' ') || '<span class="badge">Any act</span>'} ${e.type && e.type !== 'Event' ? `<span class="badge">${esc(e.type)}</span>` : ''}</div>
    ${e.desc ? `<div class="panel gtext" style="margin-top:12px">${fmt(e.desc)}</div>` : ''}
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
      <div class="frow">${fsel('wtype', [['all', 'Kind'], ['Buff', 'Buffs'], ['Debuff', 'Debuffs'], ['kw', 'Card keywords']])}</div>`, () => {
      const q = norm(ui('wq', '')), ty = ui('wtype', 'all');
      if (ty === 'kw') return `<div class="list">${(D.keywords || []).map(k => `<div class="item"><div class="body"><div class="title"><span class="nm">${esc(k.name || k.id)}</span></div><div class="desc">${fmt(k.description || '')}</div></div></div>`).join('')}</div>`;
      const list = D.powers.filter(p => (ty === 'all' || p.type === ty) && (!q || norm(p.name).includes(q) || norm(strip(p.desc)).includes(q))).sort((a, b) => a.name.localeCompare(b.name));
      return `<div class="count">${list.length} powers</div><div class="list">${list.map(p => `<div class="item">${imgTag(p.img, 'ico')}<div class="body"><div class="title"><span class="nm">${esc(p.name)}</span> <span class="ctype">${esc(p.type || '')}</span></div><div class="desc">${fmt(p.desc)}</div></div></div>`).join('')}</div>`;
    });
    wireSelects(view, draw); wireSearch(view, 'wq', draw, q => [...rank(D.powers, q, p => p.name).map(p => ({ label: p.name, sub: p.type, img: p.img })), ...rank(D.keywords || [], q, k => k.name || k.id).map(k => ({ label: k.name || k.id, sub: 'Card keyword' }))]); draw();
  };
  page();
};
V.ascension = () => {
  const D = S.D;
  const levels = `<div class="list" style="margin-top:12px">${D.ascensions.map(a => `<button class="item" data-a="${a.level}" style="text-align:left;cursor:pointer;${a.level === S.asc && !isDread() ? 'border-color:var(--accent)' : ''}"><div class="cost ${a.level <= S.asc ? '' : 'none'}">${a.level}</div><div class="body"><div class="title"><span class="nm">${esc(a.name)}</span>${a.level === HP_ASC ? ' <span class="badge">enemy HP up</span>' : ''}${a.level === DMG_ASC ? ' <span class="badge">enemy damage up</span>' : ''}</div><div class="desc">${fmt(a.desc)}</div></div></button>`).join('')}`;
  // Dread sits after A10 (it includes every ascension), then its Dominions
  const dread = D.dread ? `<button class="item" id="dreadBtn" style="text-align:left;cursor:pointer;${isDread() ? 'border-color:var(--accent)' : ''}"><div class="cost ${isDread() ? '' : 'none'}">D</div><div class="body"><div class="title"><span class="nm">Dread</span> <span class="badge">beta</span></div><div class="desc">${fmt(D.dread.intro || D.dread.desc)}</div>${(D.dread.rules || []).map((r, i) => `<div class="foot">${i + 1}. ${fmt(r)}</div>`).join('')}</div></button>` : '';
  const doms = D.dread ? `<h2>Dominions</h2><div class="list">${(D.dread.dominions || []).map(d => `<div class="item"><div class="body"><div class="title"><span class="nm">${esc(d.name)}</span></div><div class="desc">${fmt(d.description)}</div></div></div>`).join('')}</div>` : '';
  $('#view').innerHTML = backBtn() + `<h1>Ascension</h1><div class="sub">Tap a level to set it for enemy stats. Each level includes every level below it.</div>
    ${levels}${dread}</div>${doms}`;
  $('#view').querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => setAsc(+b.dataset.a)));
  $('#dreadBtn')?.addEventListener('click', () => setAsc(DREAD));
};
V.characters = () => {
  const D = S.D;
  const cn = id => D.cardByName[norm(id)]?.name || D.C[id.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()]?.name || id.replace(/([a-z])([A-Z])/g, '$1 $2');
  const rn = id => { const r = D.R[id.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()] || D.relicByName[norm(id)]; return r ? `<a href="#/relic/${r.id}" class="t-gold">${esc(r.name)}</a>` : esc(id); };
  $('#view').innerHTML = backBtn() + `<h1>Characters</h1>${D.characters.map(c => {
    const deck = {}; (c.deck || []).forEach(x => { const n = cn(x); deck[n] = (deck[n] || 0) + 1; });
    return `<div class="panel" style="margin-top:10px"><h3 class="nm">${esc(c.name)}</h3><div class="gtext">${fmt(c.desc)}</div>
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
    ${a.desc ? `<div class="panel gtext" style="margin-top:12px">${fmt(a.desc)}</div>` : ''}
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
    <a href="#/events">Events <span>${D.events.length} ›</span></a>
    <a href="#/ancients">Ancients <span>${(D.ancients || []).length} ›</span></a>
    <a href="#/enchantments">Enchantments <span>${(D.enchantments || []).length} ›</span></a>
    <a href="#/potions">Potions <span>${D.potions.length} ›</span></a>
    <a href="#/powers">Powers &amp; keywords <span>${D.powers.length} ›</span></a>
    <a href="#/ascension">Ascension levels <span>${ascLabel(S.asc)} ›</span></a>
    <a href="#/characters">Characters <span>${D.characters.length} ›</span></a>
    ${devicePlatform() && !isInstalled() ? '<a href="#/more" id="installAgain">Add to Home Screen <span>How to ›</span></a>' : ''}
    <a href="#/news">The Neowsletter <span>${esc((S.meta?.news?.latest || '').replace(/^The Neowsletter - /, '')) || 'Latest'} ›</span></a>
    <a href="#/patch">Latest patch changes <span>v${esc(D.version)} ›</span></a>
  </div>
  <h2>Data</h2><div class="panel sub">
    <div><b>Main</b>: v${esc(S.meta?.main?.version || '?')} · updated ${esc(S.meta?.main?.updated || '?')}</div>
    <div><b>Beta</b>: v${esc(S.meta?.beta?.version || '?')} · updated ${esc(S.meta?.beta?.updated || '?')}</div>
    <div class="note">Checked every few hours against <a class="t-gold" href="https://spire-codex.com" target="_blank" rel="noopener">Spire Codex</a>, which extracts each patch from the game files. Enemy, card and relic images are served by Spire Codex. Game content © Mega Crit.</div>
    <div class="note">Ascension levels for each enemy value, Dread buffs and event relic sources are read from the game files on Vig’s Mac whenever Steam updates the game.</div>
  </div>`;
  $('#installAgain')?.addEventListener('click', e => { e.preventDefault(); showSplash(true); });
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
  $('#view').dataset.p = V[name] ? name : 'enemies';
  try { (V[name] || V.enemies)(arg && decodeURIComponent(arg)); }
  catch (err) { console.error(err); $('#view').innerHTML = `<div class="empty">Something in this page’s data didn’t parse (${esc(err.message)}).</div>`; }
  window.scrollTo(0, keepScroll ? y : (scrollPos[h] || 0));
}
let lastHash = location.hash;
window.addEventListener('scroll', () => { scrollPos[(location.hash.replace(/^#\/?/, '') || 'enemies')] = window.scrollY; }, { passive: true });
window.addEventListener('hashchange', () => { lastHash = location.hash; route(false); });

/* ---- First-launch "Add to Home Screen" splash: phones and tablets only, never once installed ----
   ?splash=ios|ios-firefox|ios-other|android|android-firefox|samsung forces a variant (for testing). */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#instBtn')?.removeAttribute('hidden'); });
window.addEventListener('appinstalled', () => { store.set('installSeen', true); closeSplash(); });
function devicePlatform() {
  const force = new URLSearchParams(location.search).get('splash');
  if (force) return force;
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox/.test(ua) ? 'android-firefox' : 'android';
  // iPads report themselves as a Mac, so a touch-screen "Mac" is an iPad
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return /FxiOS/.test(ua) ? 'ios-firefox' : /CriOS|EdgiOS|OPiOS|DuckDuckGo|GSA\//.test(ua) ? 'ios-other' : 'ios';
  return null;   // desktop: no splash
}
const isInstalled = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
const SHARE_ICO = '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
const DOTS_V = '<b class="kbd">⋮</b>', DOTS_H = '<b class="kbd">⋯</b>', BARS = '<b class="kbd">☰</b>';
function installSteps(p) {
  const add = '<b>Add to Home Screen</b>';
  switch (p) {
    case 'ios': return [`Tap ${DOTS_H} at the bottom (or the Share button ${SHARE_ICO}), then <b>Share</b>.`, `Scroll down and tap ${add}.`, 'Tap <b>Add</b>.'];
    case 'ios-firefox': return [`Tap ${BARS}, then <b>Share</b>.`, `Tap ${add}, then <b>Add</b>.`, '<span class="muted">Firefox on iPhone shows a plain letter instead of the app icon. Add it from Safari to get the icon.</span>'];
    case 'ios-other': return [`Tap the Share button ${SHARE_ICO} (in some browsers it’s under ${DOTS_H}).`, `Scroll down and tap ${add}.`, 'Tap <b>Add</b>.'];
    case 'samsung': return [`Tap ${BARS} at the bottom.`, 'Tap <b>Add page to</b>, then <b>Home screen</b>.', 'Tap <b>Add</b>.'];
    case 'android-firefox': return [`Tap ${DOTS_V} in the top corner.`, `Tap <b>Install</b> or ${add}.`, 'Confirm with <b>Add</b>.'];
    default: return [`Tap ${DOTS_V} in the top corner.`, `Tap <b>Install app</b> or ${add}.`, 'Confirm with <b>Install</b>.'];
  }
}
function showSplash(force) {
  const p = devicePlatform();
  if (!p || isInstalled() || (!force && store.get('installSeen', false))) return;
  if ($('#splash')) return;
  const el = document.createElement('div');
  el.id = 'splash';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'splashTitle');
  el.innerHTML = `<div class="splash-card">
    <img class="splash-icon" src="apple-touch-icon.png" alt="">
    <h1 id="splashTitle">Spire Buddy</h1>
    <p class="splash-lede">Add it to your Home Screen to use it like an app: full screen, works offline, updates itself with every patch.</p>
    ${p.startsWith('android') || p === 'samsung' ? `<button id="instBtn" class="splash-primary" ${deferredInstall ? '' : 'hidden'}>Install Spire Buddy</button>` : ''}
    <ol class="splash-steps">${installSteps(p).map(t => `<li>${t}</li>`).join('')}</ol>
    <button id="splashOk" class="splash-ok">Got it</button>
  </div>`;
  document.body.appendChild(el);
  document.body.classList.add('splash-open');
  $('#splashOk').addEventListener('click', () => { store.set('installSeen', true); closeSplash(); });
  $('#instBtn')?.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const r = await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null;
    if (r?.outcome === 'accepted') { store.set('installSeen', true); closeSplash(); }
  });
  $('#splashOk').focus();
}
function closeSplash() { $('#splash')?.remove(); document.body.classList.remove('splash-open'); }

async function boot() {
  document.querySelectorAll('#branch button').forEach(b => b.addEventListener('click', () => setBranch(b.dataset.b)));
  $('#ascDown').addEventListener('click', () => setAsc(S.asc - 1));
  $('#ascUp').addEventListener('click', () => setAsc(S.asc + 1));
  paintHeader();
  await loadMeta();
  try { S.D = await loadBranch(S.branch); }
  catch (e) { $('#view').innerHTML = '<div class="empty">Couldn’t load game data. Check your connection and reopen.</div>'; return; }
  paintHeader(); route(false);
  showSplash(new URLSearchParams(location.search).has('splash'));
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    // Check for a new version on every open / return to the app, and reload once when it takes over.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  }
}
boot();
