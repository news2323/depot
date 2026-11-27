/* Ansichten und Bedienung. Aufbau: Seitenleiste (Mac) bzw. Leiste unten (Handy), Marktleiste, Inhalt, Detail als Seitenpanel. */
'use strict';
const ICON = {
  home: '<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/>',
  depot: '<path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19V8"/>',
  watch: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.5a7 7 0 0 0-2.2 1.3l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.5a7 7 0 0 0 2.2-1.3l2.3 1 2-3.4-2-1.5c.07-.4.1-.9.1-1.3z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  logo: '<path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/>',
  strat: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  insight: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
};
const svg = n => `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`;
const TABS = [['home', 'Übersicht'], ['depot', 'Positionen'], ['watch', 'Watchlist'], ['strat', 'Strategie'], ['insight', 'Einblicke'], ['cal', 'Termine']];
const CAT = {Earnings: ['blue', 'Quartalszahlen'], Makro: ['teal', 'Konjunktur'], Fed: ['purple', 'Notenbank'], IPO: ['pink', 'IPO'], Dividende: ['good', 'Ex-Dividende'], Zahltag: ['good', 'Zahltag'], Krypto: ['warn', 'Krypto'], Event: ['', 'Event']};
const isMine = e => !e.market;
const ALERT_TYPES = {price_above: 'Kurs steigt über', price_below: 'Kurs fällt unter', change_above: 'Tagesplus größer als (%)',
  change_below: 'Tagesminus größer als (%)', funding_above: 'Funding über (% je 8 Std.)', funding_below: 'Funding unter (% je 8 Std.)'};
const valClass = l => !l ? '' : /unter|niedrig|abgekühlt/.test(l) ? 'good' : /über|hoch/.test(l) ? 'bad' : '';
const toneClass = t => ({good: 'good', bad: 'bad', warn: 'warn'}[t] || '');
const card = (title, sub, inner, extra = '', cls = '') => `<section class="card ${cls}"><div class="head"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${extra}</div>${inner}</section>`;
const tile = (l, v, n = '', cls = '') => `<div class="tile"><div class="l">${l}</div><div class="v num ${cls}">${v}</div>${n ? `<div class="n">${n}</div>` : ''}</div>`;
const stat = (l, v, n = '', cls = '') => `<div class="stat"><div class="l">${l}</div><div class="v num ${cls}">${v}</div>${n ? `<div class="n">${n}</div>` : ''}</div>`;
// Auswahl der Teildepots (nur wenn es mehr als eines gibt): Alle, dann je Depot
const depSeg = () => depots().length < 2 ? '' : `<div class="seg depseg">${[{id: 'all', name: 'Alle'}, ...depots()].map(d =>
  `<button data-act="dep" data-v="${esc(d.id)}" class="${d.id === S.dep ? 'on' : ''}">${esc(d.name)}</button>`).join('')}</div>`;
const seg = (act, opts, cur) => `<div class="seg">${opts.map(o => `<button data-act="${act}" data-v="${o}" class="${o === cur ? 'on' : ''}">${o}</button>`).join('')}</div>`;
const MODES = {kauf: 'Seit Kauf', positionen: 'Heutige Positionen'};
const CMP = {Gesamt: 'Dein Depot', Aktien: 'Deine Aktien und ETFs', Krypto: 'Dein Krypto'};

function render() {
  if (!LOCAL && !cfg) return renderSetup();
  S._jb = null; S._ideal = undefined; S._rules = null; S._alias = null; S._since = null;   // Depot Jakob, Ideal-Depot, Wort je Titel neu rechnen
  const c = calc(), now = new Date(), upd = S.market.updated;
  const stale = upd && Date.now() - Date.parse(upd) > 45 * 6e4;
  if (!TABS.some(t => t[0] === S.tab)) S.tab = 'home';
  if (!MODES[S.mode]) S.mode = 'kauf';
  const view = {home: vHome, depot: vDepot, watch: vWatch, strat: vStrat, insight: vInsight, cal: vCal}[S.tab](c);
  const title = Object.fromEntries(TABS)[S.tab];
  $('#app').innerHTML = `<div class="shell">${sideBar(upd, stale)}
  <main class="main"><div class="inner">
    <header class="top"><div><h1>${title}</h1>
      <p class="sub"><span class="live ${stale ? 'old' : ''}"></span><span>Kurse ${esc(ago(upd))}<span class="hm"> · ${WT_LANG[now.getDay()]}, ${now.getDate()}. ${MON[now.getMonth()]}</span></span></p></div>
      <div class="topact"><div class="search">${svg('search')}<input id="q" type="search" placeholder="Titel suchen" autocomplete="off" aria-label="Titel suchen"><kbd>/</kbd><div id="qres" class="qres" hidden></div></div>
      <button class="iconbtn mobs" data-act="searchopen" title="Suchen">${svg('search')}</button>
      <button class="iconbtn${S.hide ? ' on' : ''}" data-act="hide" title="${S.hide ? 'Beträge zeigen' : 'Beträge verbergen'}" aria-pressed="${S.hide ? 'true' : 'false'}">${svg(S.hide ? 'eyeoff' : 'watch')}</button>
      <button class="iconbtn" id="refresh" data-act="refresh" title="Kurse aktualisieren">${svg('sync')}</button>
      <button class="iconbtn mob" data-act="settings" title="Einstellungen">${svg('gear')}</button></div></header>
    ${strip()}
    ${S.err ? `<div class="banner">${esc(S.err)}</div>` : ''}
    ${stale ? `<div class="banner">Die Kurse sind älter als 45 Minuten (${esc(ago(upd))}). Oben rechts aktualisieren.</div>` : ''}
    ${view}
    <p class="foot">Automatisch berechnet und recherchiert. Keine Anlageberatung. Kurse können verzögert sein.</p>
  </div></main></div>
  <nav class="tabs">${TABS.map(([k, l]) => `<button data-act="tab" data-v="${k}" class="${S.tab === k ? 'on' : ''}">${svg(k)}<span>${l}</span></button>`).join('')}</nav>`;
  requestAnimationFrame(drawCharts);
}
function sideBar(upd, stale) {
  return `<aside class="side"><div class="brand"><div class="logo">${svg('logo')}</div><div><b>Depot</b><span>Privates Portfolio</span></div></div>
    <nav class="nav">${TABS.map(([k, l]) => `<button data-act="tab" data-v="${k}" class="${S.tab === k ? 'on' : ''}">${svg(k)}${l}</button>`).join('')}</nav>
    <div class="sidesec"><div class="eyebrow">Börsen</div>${markets().map(m => `<div class="mkt ${m.open ? 'open' : ''}" title="${esc(m.hours)}"><span><i></i>${m.name}</span><span>${m.open ? 'offen' : 'geschlossen'}</span></div>`).join('')}</div>
    <div class="sidefoot"><div><span class="live ${stale ? 'old' : ''}"></span>&nbsp; Kurse ${esc(ago(upd))}<br>Kennzahlen ${esc(ago(S.daily.updated))}</div>
      <div class="nav"><button data-act="settings">${svg('gear')}Einstellungen</button></div></div></aside>`;
}
function strip() {
  const ix = S.market.indices || [];
  if (!ix.length) return '';
  const val = x => x.sym === 'EURUSD' ? nf(x.price, 4) : x.sym === '^VIX' ? nf(x.price, 2) : nf(x.price, 0) + (x.sym === 'BTC' || x.sym === 'GC=F' ? ' $' : '');
  return `<div class="strip" role="list">${ix.map(x => `<div role="listitem"><div class="n">${esc(x.name)}</div><div class="v num">${val(x)}<span class="c ${x.change_pct >= 0 ? 'pos' : 'neg'}">${pctS(x.change_pct, 2)}</span></div></div>`).join('')}</div>`;
}

/* ---------------------------------------------------------------- Bausteine */
function alertText(a) {
  const cur = a.type.startsWith('price') ? ' ' + (CUR[a.currency || curOf(keyOf(a.kind, a.symbol))] || '') : ' %';
  return `${ALERT_TYPES[a.type].replace(/ \(.*\)/, '')} ${nf(a.value, a.value < 1 ? 4 : 2)}${cur}`;
}
// Punkte von 1 (deutlich überbewertet) bis 10 (deutlich unterbewertet), nur in der Detailansicht. Die Zahl kommt aus tracker/analytics.py (rating).
function score(key, cls = '') {
  const r = ratingOf(key), v = D(key).valuation;
  if (r == null) return `<span class="score none ${cls}" title="${v ? 'Keine Punkte: hier gibt es keine Kennzahlen zum Bewerten' : 'Noch keine Bewertung'}">–</span>`;
  return `<span class="score t${tierOf(r)} ${cls}" title="${r} von 10 Punkten: ${esc(v.label)}">${r}</span>`;
}
const meter = r => r == null ? '' : `<span class="meter t${tierOf(r)}" role="img" aria-label="${r} von 10 Punkten">${Array.from({length: 10}, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</span>`;
const aiScore = ai => ai && ai.score >= 1 && ai.score <= 10 ? Math.round(ai.score) : null;
const aiChip = ai => !ai || !(ai.verdict || aiScore(ai)) ? '' : `<span class="chip ${aiScore(ai) ? (aiScore(ai) >= 7 ? 'good' : aiScore(ai) <= 4 ? 'bad' : '') : valClass(ai.verdict)}">${aiScore(ai) ? aiScore(ai) + ' · ' : ''}${esc(ai.verdict || '')}</span>`;
const chg = (v, d = 2) => v == null || isNaN(v) ? '<span class="muted">–</span>' : `<span class="num ${v >= 0 ? 'pos' : 'neg'}">${pctS(v, d)}</span>`;
const zoneOf = key => { const p = A(key).price; return p == null ? null : (D(key).levels || []).find(l => l.price < p) || null; };
const typeOf = key => isCoin(key) ? 'Krypto' : isFund(key) ? 'ETFs' : 'Aktien';
const flt = (id, opts) => { const cur = (S.flt || {})[id] || opts[0]; return `<div class="seg">${opts.map(o => `<button data-act="flt" data-id="${id}" data-v="${o}" class="${o === cur ? 'on' : ''}">${o}</button>`).join('')}</div>`; };
const fltOn = (id, def = 'Alle') => (S.flt || {})[id] || def;

// Neuer Stil überall (Jakobs Wunsch vom 19.11.2026): Logo, umgangssprachlicher Name, darunter Kürzel und Marktwert bzw. Anbieter
const tick = key => { const s = key.split(':')[1]; return /^\d/.test(s) ? s : s.split('.')[0]; };   // Kürzel ohne Börsenendung (1211.HK bleibt)
const subLine = (key, extra) => [shortName(key) === tick(key) ? '' : tick(key), extra != null ? extra : (mcapTxt(key) || ((isFund(key) || isCommodity(key)) && issuerOf(key)) || '')].filter(Boolean).join(' · ');
const withPre = (pre, txt) => `${pre || ''}${pre && txt ? '<i class="sep"> · </i>' : ''}${esc(txt)}`;
const nameCell = (key, extra, pre = '') => `<div class="nm">${logo(key)}<div class="nmt"><b>${esc(shortName(key))}</b><small>${withPre(pre, subLine(key, extra))}</small></div></div>`;
// Kurzer Hinweis vor der Unterzeile: bei Titeln der Strategie „Top 7“ bzw. die Stärke (Wachstums-Momentum, Jakobs Wunsch vom
// 27.11.2026), sonst das Momentum-Signal (Coins, ETFs). near: auch „fast“ (3 von 4 erfüllt)
const momTag = (key, near) => { const r = scrRow(stratKey(key));
  if (r && r.rs != null) { const n = (idealBook() || {}).n || 7;
    return r.rank && r.rank <= n ? `<span class="mom on" title="Unter den ${n} stärksten im Aufwärtstrend: Rang ${r.rank}, Stärke ${r.rs} von 99">Top ${n}</span>`
      : r.trend && r.rs >= 90 ? `<span class="mom near" title="Im Aufwärtstrend, Rang ${r.rank || '–'}, Stärke ${r.rs} von 99">Stärke ${r.rs}</span>` : ''; }
  const m = momOf(key); if (!m) return '';
  if (m.state === 'on') return `<span class="mom on" title="Momentum-Signal an${m.since < 60 ? ' seit ' + m.since + ' Handelstagen' : ''}: Aufwärtstrend, nahe am Jahreshoch, stärker als der Markt">${m.since <= 10 ? 'Momentum neu' : 'Momentum'}</span>`;
  if (m.state === 'fade') return '<span class="mom fade" title="Momentum lässt nach: Kurs unter die 50-Tage-Linie gefallen">Momentum ↘</span>';
  return near && m.state === 'none' && m.met >= 3 ? '<span class="mom near" title="3 von 4 Prüfungen erfüllt">fast Momentum</span>' : ''; };
// „Deine Regel“ (nur Depot Jakob): Pille in Tabellen, farbiges Wort in Unterzeilen am Handy
const ruleChip = key => { const r = ruleOf(key); return !r ? '' : r.word === 'Warten' ? `<span class="ts" title="${esc(r.why.join(' · '))}">warten</span>` : `<span class="chip ${r.cls}" title="${esc(r.why.join(' · '))}">${r.word}</span>`; };
const ruleTag = key => { const r = ruleOf(key); return r && r.word !== 'Warten' ? `<span class="rw ${r.cls}" title="${esc(r.why.join(' · '))}">${r.word}</span>` : ''; };
const tag = key => `<span class="tg">${logo(key)}<b>${esc(shortName(key))}</b></span>`;   // klein, in Zeilen und Fließtext
const chgA = v => v == null || isNaN(v) ? '<span class="muted">–</span>' : `<span class="num chga ${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '▲' : '▼'} ${nf(Math.abs(v), 2)} %</span>`;
const w7 = key => { const s = (S.market.spark || {})[key], p = A(key).price; return s && s[0] && p != null ? (p / s[0] - 1) * 100 : null; };
const keyBySym = sym => allTracked().find(k => k.split(':')[1] === sym) || 'stock:' + sym;
const COL = {
  score: {id: 'score', label: 'Punkte', cls: 'c-score', num: true, sort: r => ratingOf(r.key), html: r => score(r.key)},
  name: {id: 'name', label: 'Titel', cls: 'c-name', sort: r => shortName(r.key).toLowerCase(), html: r => nameCell(r.key, r.p ? `${nf(r.p.qty, r.p.qty % 1 ? 2 : 0)} Stück` : undefined)},
  rule: {id: 'rule', label: 'Regel', cls: 'c-rule', num: true, sort: r => { const x = r.rj === false ? null : ruleOf(r.key); return x ? RULE_ORDER[x.word] : null; }, html: r => (r.rj === false ? '' : ruleChip(r.key)) || '<span class="ts">–</span>'},
  nameM: {id: 'name', label: 'Titel', cls: 'c-name', sort: r => shortName(r.key).toLowerCase(), html: r => nameCell(r.key, r.p ? `${nf(r.p.qty, r.p.qty % 1 ? 2 : 0)} Stück` : undefined, momTag(r.key))},
  spark: {id: 'w7', label: '7 Tage', cls: 'c-spark hm', num: true, sort: r => w7(r.key), html: r => `<div class="spk">${spark7(r.key)}<small class="num ${sign(w7(r.key))}">${w7(r.key) == null ? '' : pctS(w7(r.key), 1)}</small></div>`},
  price: {id: 'price', label: 'Kurs', cls: 'r hm', html: r => `<span class="num">${px(r.key, A(r.key).price)}</span>`},
  day: {id: 'day', label: 'Heute', cls: 'r', num: true, sort: r => A(r.key).change_pct, html: r => chgA(A(r.key).change_pct)},
  m1: {id: 'm1', label: '1 Monat', cls: 'r hm', num: true, sort: r => (D(r.key).tech || {}).perf_1m, html: r => chg((D(r.key).tech || {}).perf_1m, 1)},
  rng: {id: 'rng', label: '52 Wochen', cls: 'r hm', num: true, sort: r => { const t = D(r.key).tech || {}, p = A(r.key).price; return t.high52 > t.low52 && p != null ? (p - t.low52) / (t.high52 - t.low52) : null; }, html: r => rangeBar(r.key)},
  zone: {id: 'zone', label: 'Nachkauf-Zone', cls: 'r hm', num: true, sort: r => { const l = zoneOf(r.key); return l ? l.price / A(r.key).price - 1 : null; }, html: r => { const l = zoneOf(r.key); return l ? `<div class="num">${px(r.key, l.price)}</div><div class="ts num">${nf((l.price / A(r.key).price - 1) * 100, 1)} %</div>` : '<span class="ts">–</span>'; }},
  value: {id: 'value', label: 'Wert', cls: 'r', num: true, sort: r => r.p.value, html: r => `<div class="num tn">${eur(r.p.value, 0)}</div><div class="ts num hd ${sign(r.p.pnl)}">${pctS(r.p.pnlPct, 1)}</div>`},
  pnl: {id: 'pnl', label: 'Gewinn', cls: 'r hm', num: true, sort: r => r.p.pnlPct, html: r => `<div class="num ${sign(r.p.pnl)}">${eurS(r.p.pnl)}</div><div class="ts num">${pctS(r.p.pnlPct, 1)}</div>`},
  weight: {id: 'weight', label: 'Anteil', cls: 'r hm', num: true, sort: r => r.p.weight, html: r => `<div class="wbar2"><span><i style="width:${Math.min(100, r.p.weight * 2.5)}%"></i></span><b class="num">${nf(r.p.weight, 1)} %</b></div>`},
};
function sortRows(id, cols, rows, def) {
  const st = (S.sort || {})[id] || def, col = cols.find(c => c.id === st[0] && c.sort) || cols.find(c => c.sort);
  const val = r => { const x = col.sort(r); return x == null || (typeof x === 'number' && isNaN(x)) ? null : x; };
  return {st, col, rows: [...rows].sort((a, b) => { const x = val(a), y = val(b); if (x == null || y == null) return (x == null) - (y == null); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * st[1]; })};
}
function tbl(id, cols, rows, def) {
  let st, col; ({st, col, rows} = sortRows(id, cols, rows, def));
  if (!rows.length) return '<p class="empty">Keine Titel in dieser Auswahl.</p>';
  return `<div class="tblwrap"><table class="tbl"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}${c.sort ? ' s' : ''}${col.id === c.id ? ' on' : ''}"${c.sort ? ` data-act="sort" data-id="${id}" data-v="${c.id}" data-num="${c.num ? 1 : 0}"` : ''}>${c.label}${col.id === c.id ? `<span class="ar">${st[1] < 0 ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr data-act="open" data-key="${esc(r.key)}" tabindex="0">${cols.map(c => `<td class="${c.cls || ''}">${c.html(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ---------------------------------------------------------------- Übersicht */
// Feste Farben je Anlageklasse (Reihenfolge der geprüften Palette), Sektoren und Währungen nach Größe, Rest als „Weitere“.
const CLASS_ORDER = ['Aktien', 'ETFs', 'Krypto', 'Rohstoffe'];
function allocation(c, dim) {
  let by = {};
  if (dim === 'Sektor') { // ETFs nach ihrem Inhalt aufgeteilt, wie im Reiter Einblicke
    const m = sectorMix(c);
    Object.entries(m.by).forEach(([s, v]) => { by[SECTOR_DE[s] || s] = v; });
    Object.entries(m.outside).forEach(([s, v]) => { by[s] = (by[s] || 0) + v; });
  } else {
    const keyFn = dim === 'Währung' ? p => (isCoin(p.key) ? 'USD' : curOf(p.key)) : p => assetClass(p.key);
    c.held.forEach(p => { if (p.value > 0) { const k = keyFn(p); by[k] = (by[k] || 0) + p.value; } });
  }
  let groups = Object.entries(by).map(([name, v]) => ({name, v}));
  if (dim === 'Anlageklasse') {
    groups.sort((a, b) => CLASS_ORDER.indexOf(a.name) - CLASS_ORDER.indexOf(b.name));
    groups.forEach(g => g.col = `var(--s${CLASS_ORDER.indexOf(g.name) + 1})`);
  } else {
    groups.sort((a, b) => b.v - a.v);
    if (groups.length > 7) { const rest = groups.splice(6); groups.push({name: 'Weitere', v: rest.reduce((s, g) => s + g.v, 0), n: rest.length}); }
    groups.forEach((g, i) => g.col = g.name === 'Weitere' ? 'var(--s0)' : `var(--s${i + 1})`);
  }
  const tot = groups.reduce((s, g) => s + g.v, 0) || 1;
  return `<div class="alloc">${donut(groups, tot, dim)}
    <div class="legendrows">${groups.map((g, i) => `<div data-slice="${i}"><i style="background:${g.col}"></i><span>${esc(g.name)}${g.n ? ` <span class="muted">(${g.n})</span>` : ''}</span><span class="e num">${eur(g.v, 0)}</span><span class="p num">${nf(g.v / tot * 100, 1)} %</span></div>`).join('')}</div></div>`;
}
// Ring aus Kreissegmenten mit 2 px Fuge in Flächenfarbe. Die Mitte zeigt die Summe, beim Zeigen auf ein Segment dessen Anteil.
function donut(groups, tot, dim) {
  const R = 80, r = 52, cx = 90, cy = 90;
  let a0 = -Math.PI / 2, paths = '';
  const P = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  groups.forEach((g, i) => {
    const frac = g.v / tot, a1 = a0 + frac * Math.PI * 2, big = frac > 0.5 ? 1 : 0;
    const d = frac >= 0.9999 ? `M${P(R, -Math.PI / 2)}A${R} ${R} 0 1 1 ${P(R, Math.PI * 1.5 - 0.0001)}ZM${P(r, -Math.PI / 2)}A${r} ${r} 0 1 0 ${P(r, Math.PI * 1.5 - 0.0001)}Z`
      : `M${P(R, a0)}A${R} ${R} 0 ${big} 1 ${P(R, a1)}L${P(r, a1)}A${r} ${r} 0 ${big} 0 ${P(r, a0)}Z`;
    paths += `<path d="${d}" fill-rule="evenodd" style="fill:${g.col}" data-slice="${i}" data-name="${esc(g.name)}" data-pct="${nf(frac * 100, 1)} %" data-val="${esc(eur(g.v, 0))}"><title>${esc(g.name)}: ${nf(frac * 100, 1)} %</title></path>`;
    a0 = a1;
  });
  return `<div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="Aufteilung nach ${esc(dim)}">${paths}</svg>
    <div class="dc" data-def-n="${esc(dim)}" data-def-v="${esc(eur(tot, 0))}"><span class="n">${esc(dim)}</span><b class="num">${eur(tot, 0)}</b></div></div>`;
}
// Vergleich mit gleichen Käufen: jeder Kauf ganz in den S&P 500 bzw. ganz in Bitcoin (zwei Szenarien)
const eurS0 = v => v == null || isNaN(v) ? '–' : S.hide ? MASK : (v >= 0 ? '+' : '−') + nf(Math.abs(v), 0) + ' €';
function cmpTable(c) {
  const sr = c.series, n = sr.d.length - 1;
  if (n < 0) return '';
  // [Teil, eingesetzt, dein Wert, alles in S&P 500, alles in Bitcoin]
  const rows = [['Aktien &amp; ETFs', sr.ia[n], sr.va[n], sr.as[n], sr.ab[n]], ['Krypto', sr.ik[n], sr.vk[n], sr.ks[n], sr.kb[n]]].filter(r => r[1] > 0.5 || r[2] > 0.5);
  if (rows.length > 1) rows.push(['Gesamt', sr.inv[n], sr.v[n], sr.as[n] + sr.ks[n], sr.ab[n] + sr.kb[n]]);
  const cell = (x, r) => `<td class="r num">${eur(x, 0)}<div class="ts ${sign(r[2] - x)}">du ${eurS0(r[2] - x)}</div></td>`;
  const unknown = c.txs.filter(t => /Kaufdatum unbekannt/i.test(t.note || '')), uday = unknown.length ? dateDe(unknown[0].date) : '';
  const guessed = c.txs.filter(t => /Kaufdatum geschätzt/i.test(t.note || ''));
  return `${sr.bench ? `<div class="tblwrap" style="margin-top:14px"><table class="tbl cmp"><thead><tr><th>Teil</th><th class="r">Eingesetzt</th><th class="r">Dein Wert</th><th class="r">Alles in S&amp;P 500</th><th class="r">Alles in Bitcoin</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r[0] === 'Gesamt' ? 'sum' : ''}"><td><b>${r[0]}</b></td><td class="r num">${eur(r[1], 0)}</td><td class="r num"><b>${eur(r[2], 0)}</b><div class="ts ${sign(r[2] - r[1])}">${eurS0(r[2] - r[1])}</div></td>
      ${cell(r[3], r)}${cell(r[4], r)}</tr>`).join('')}</tbody></table></div>` : ''}
    <p class="hint">Zwei Szenarien: Jeder deiner Käufe geht am selben Tag mit demselben Euro-Betrag ganz in den S&P 500 bzw. ganz in Bitcoin, Verkäufe ziehen denselben Betrag wieder ab. „du“ ist dein Vorsprung (+) oder Rückstand (−). S&P 500 als Kursindex ohne Dividenden, alles in Euro.</p>
    ${unknown.length ? `<div class="note"><b>${unknown.length} Buchungen ohne echtes Kaufdatum.</b> Diese Positionen stehen mit dem ${uday} im Depot, weil das Kaufdatum fehlt. Für sie rechnet der Vergleich mit den Kursen von diesem Tag: Ihr Gewinn aus der Zeit davor erscheint deshalb als Vorsprung gegenüber dem Index. Mit den echten Kaufdaten wird der Vergleich genau.</div>` : ''}
    ${guessed.length ? `<p class="hint">${guessed.length} Kaufdaten aus comdirect sind geschätzt: der letzte Tag vor dem 18.11.2024, an dem der Kurs bei deinem Einstandskurs lag. Bei mehreren Käufen zu verschiedenen Preisen stimmt das nur ungefähr.</p>` : ''}`;
}
function attribution(c) {
  const ps = c.held.filter(p => p.dayEur != null && Math.abs(p.dayEur) >= 0.005);
  if (!ps.length) return '<p class="empty">Noch keine Tagesbewegung.</p>';
  const ups = ps.filter(p => p.dayEur > 0).sort((a, b) => b.dayEur - a.dayEur).slice(0, 5);
  const dns = ps.filter(p => p.dayEur < 0).sort((a, b) => a.dayEur - b.dayEur).slice(0, 5);
  const mx = Math.max(...ups.concat(dns).map(p => Math.abs(p.dayEur))) || 1;
  const row = p => { const w = Math.abs(p.dayEur) / mx * 100, up = p.dayEur >= 0;
    return `<button data-act="open" data-key="${esc(p.key)}" title="${esc(p.name)}: ${pctS(p.dayPct)}">${tag(p.key)}
      <span class="dv"><span>${up ? '' : `<i style="width:${w}%;background:var(--down)"></i>`}</span><span>${up ? `<i style="width:${w}%;background:var(--up)"></i>` : ''}</span></span>
      <span class="v num ${up ? 'pos' : 'neg'}">${eurS(p.dayEur)}</span></button>`; };
  return `<div class="attr">${ups.map(row).join('')}${ups.length && dns.length ? '<hr>' : ''}${dns.map(row).join('')}</div>`;
}
// Risiko in Euro: Rückschläge, Szenarien, Klumpen und was ansteht (riskStats in app.js)
const CLASS_COL = {Aktien: 'var(--s1)', ETFs: 'var(--s3)', Krypto: 'var(--s4)', Rohstoffe: 'var(--s7)'};
function riskCard(c) {
  const r = riskStats();
  if (!r) return card('Risiko', 'Für deine heutigen Positionen', '<p class="empty">Kommt mit der nächsten täglichen Aktualisierung.</p>', '', 'span12');
  const row = (l, v, note = '', cls = 'neg') => `<div class="rk"><span class="l">${l}${note ? `<small>${note}</small>` : ''}</span><span class="v num ${cls}">${v}</span></div>`;
  const e0 = v => v == null ? '–' : S.hide ? MASK : (v >= 0 ? '+' : '−') + nf(Math.abs(v), 0) + ' €';
  const months = (a, b) => { const m = Math.round((b - a) / 30.44); return m < 1 ? 'unter einem Monat' : m === 1 ? 'einem Monat' : m + ' Monaten'; };
  const pc = v => nf(v, v < 1 ? 1 : 0) + ' %';
  const syms = l => l.slice(0, 4).map(esc).join(', ') + (l.length > 4 ? ` und ${l.length - 4} weitere` : '');
  const fh = r.fromHigh, dd = r.maxDD;
  const loss = `<div class="rkhead"><div class="eyebrow">Abstand zum Hoch</div>
      <div class="big num ${fh.pct < -0.5 ? 'neg' : ''}">${fh.pct < -0.5 ? pctS(fh.pct, 1) : 'auf dem Hoch'}</div>
      <div class="small muted">${fh.pct < -0.5 ? `${e0(fh.eur)} seit dem Hoch am ${dateDe(dayIso(fh.day))}` : 'höchster Stand der letzten 12 Monate'}</div></div>
    ${row('Schlechter Tag', e0(r.badDay), 'jeder 20. Handelstag war mindestens so schlecht')}
    ${r.worstDay ? row('Schlechtester Tag', e0(r.worstDay.eur), `${dateDe(dayIso(r.worstDay.day))}, ${pctS(r.worstDay.pct, 1)}`) : ''}
    ${row('Schlechter Monat', e0(r.badMonth), 'jeder 20. Monat war mindestens so schlecht')}
    ${r.worstMonth ? row('Schlechtester Monat', e0(r.worstMonth.eur), `30 Tage bis ${dateDe(dayIso(r.worstMonth.day))}, ${pctS(r.worstMonth.pct, 1)}`) : ''}
    ${dd ? row(`Größter Rückgang seit ${new Date(dd.since * DAY).getFullYear()}`, pctS(dd.pct, 1),
      `heute ${e0(dd.eur)} · ${dateDe(dayIso(dd.peak))} bis ${dateDe(dayIso(dd.trough))} · ${dd.back ? 'wieder erholt nach ' + months(dd.trough, dd.back) : 'noch nicht wieder erreicht'}`) : ''}`;
  const scen = r.scen.map(s => `<div class="rk"><span class="l">${s.label}${s.top.length ? `<small>am meisten: ${s.top.map(z => `${esc(shortName(z.o.key))} ${e0(z.x)}`).join(' · ')}</small>` : ''}</span>
    <span class="v num neg">${e0(s.eur)}<small>${pctS(s.pct, 1)}</small></span></div>`).join('');
  const what = `${scen}${row('Dollar-Anteil', nf(r.usdShare, 0) + ' %', 'wie stark dein Depot am Dollar hängt, auch über ETFs', '')}
    <p class="hint">Geschätzt aus dem Verhalten jeder Position in den letzten drei Jahren (Coins: einem Jahr).${r.est.length ? ` Ohne genug Verlauf, deshalb Faustwert: ${syms(r.est)}.` : ''}</p>`;
  const mixBar = `<div class="mixbar">${r.classes.map(k => `<i style="width:${k.pct}%;background:${CLASS_COL[k.name] || 'var(--s0)'}" title="${k.name} ${nf(k.pct, 0)} %"></i>`).join('')}</div>
    <div class="mixlg">${r.classes.map(k => `<span><b style="background:${CLASS_COL[k.name] || 'var(--s0)'}"></b>${k.name} ${nf(k.pct, 0)} %</span>`).join('')}</div>`;
  const ts = r.topStock, sec = r.topSector;
  const lump = `${mixBar}
    ${ts ? row(`Größte Einzelaktie: ${esc(shortName(ts.key))}`, e0(ts.half), `${nf(ts.pct, 1)} % vom Depot · so viel kostet es, wenn sie sich halbiert`) : ''}
    ${row('Fünf größte Einzelaktien', nf(r.top5, 0) + ' %', 'vom Depot', '')}
    ${sec ? row(`Größte Branche: ${esc(sec.name)}`, nf(sec.ofEq, 0) + ' %', `deiner Aktien und Aktien-ETFs${sec.world != null ? ` · in der Welt (MSCI World) ${nf(sec.world, 0)} %` : ''}`, sec.world != null && sec.ofEq > sec.world + 10 ? 'neg' : '') : ''}`;
  const soon = [
    r.earnings.length ? row('Quartalszahlen in 3 Wochen', pc(r.earnings.reduce((s, e) => s + e.pct, 0)), r.earnings.map(e => `${esc(shortName(e.key))} ${dateDe(e.date).replace(/ \d{4}$/, '')}`).join(' · '), '') : '',
    r.expensive.list.length ? row('Nach Punkten teuer (1 bis 3)', pc(r.expensive.pct), syms(r.expensive.list), '') : '',
    r.estDown.list.length ? row('Gewinnschätzung gesenkt', pc(r.estDown.pct), syms(r.estDown.list) + ' · um 5 % oder mehr in 90 Tagen', '') : '',
    r.losers.list.length ? row('Mehr als 20 % im Minus', pc(r.losers.pct), syms(r.losers.list), '') : ''].join('');
  return card('Risiko', 'Für deine heutigen Positionen, in Euro', `<div class="riskgrid">
    <div><p class="sh">Was ein Rückschlag kostet</p>${loss}</div>
    <div><p class="sh">Wenn …</p>${what}</div>
    <div><p class="sh">Klumpen</p>${lump}${soon ? `<p class="sh">Im Blick behalten</p>${soon}` : ''}</div></div>
    <p class="hint">Rückschläge: die heutigen Positionen mit den Kursen der Vergangenheit zurückgerechnet${r.vol != null ? ` · Schwankung ${nf(r.vol, 1)} % pro Jahr` : ''} · Beta ${nf(r.beta, 2)} zum S&amp;P 500 (bei 1 bewegt sich das Depot wie der Markt). Vergangene Schwankungen sagen nichts Sicheres über die Zukunft. Keine Anlageberatung.</p>`, '', 'span12');
}
// Smart Money / Dumb Money (eigene Berechnung, smart.json aus dem Tageslauf): Profis gegen Masse, Aktien oder Bitcoin
function smartCard() {
  const sm = S.smart || {}, which = sm[S.smk] ? S.smk : sm.stocks ? 'stocks' : 'btc', x = sm[which];
  if (!x) return '';
  const diff = x.smart - x.dumb;
  const read = diff >= 30 ? ['good', 'Profis zuversichtlich, Masse vorsichtig. Solche Lagen waren in der Vergangenheit eher günstige Zeitpunkte.']
    : diff <= -30 ? ['bad', 'Masse zuversichtlich, Profis vorsichtig. Solche Lagen gingen in der Vergangenheit öfter Rückschlägen voraus.']
    : ['', 'Kein klares Signal: Profis und Masse liegen nicht weit auseinander.'];
  const g = (t, v, prev, sub) => `<div class="fgbox"><div class="l">${t}</div><div class="v num">${v}<span>${v >= 70 ? 'zuversichtlich' : v <= 30 ? 'vorsichtig' : 'neutral'}</span></div>
    <div class="fgbar" role="img" aria-label="${v} von 100"><b style="left:${v}%"></b></div><div class="fgax"><span>vorsichtig</span><span>zuversichtlich</span></div>
    <div class="n">${sub}${prev != null ? ` · Vorwoche ${prev}` : ''}</div></div>`;
  return card('Smart Money und Dumb Money', `Profis gegen Masse am Terminmarkt, 0 bis 100 · Stand ${dateDe(x.day)}`, `<div class="fggrid">
    ${g('Smart Money', x.smart, (x.prev || {}).smart, 'Hedgefonds, Investmentbanken, große Fonds')}${g('Dumb Money', x.dumb, (x.prev || {}).dumb, 'Kleinanleger und Stimmung')}</div>
    <div class="note ${read[0]}" style="margin-top:12px">${read[1]}</div>
    ${(x.groups || []).length ? `<div class="tblwrap" style="margin-top:12px"><table class="tbl sdg"><thead><tr><th>Wer</th><th>Tut gerade</th><th class="r">Position</th><th class="r hm">1 Woche</th><th class="r hm">4 Wochen</th><th class="r">Rang 3 J.</th></tr></thead><tbody>
      ${x.groups.map(gr => `<tr><td><b>${esc(gr.label)}</b><div class="ts">${gr.smart ? 'Smart Money' : 'Dumb Money'}</div></td>
        <td><span class="chip ${gr.action === 'kauft' ? 'good' : gr.action === 'verkauft' ? 'bad' : ''}">${gr.action === 'kauft' ? 'kauft zu' : gr.action}</span></td>
        <td class="r num">${gr.share >= 0 ? 'netto long' : 'netto short'}<div class="ts">${nf(Math.abs(gr.share), 1)} % des Marktes</div></td>
        <td class="r num hm ${sign(gr.chg1)}">${gr.chg1 >= 0 ? '+' : '−'}${nf(Math.abs(gr.chg1), 1)} Pkt.</td><td class="r num hm ${sign(gr.chg4)}">${gr.chg4 >= 0 ? '+' : '−'}${nf(Math.abs(gr.chg4), 1)} Pkt.</td>
        <td class="r num">${gr.idx}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="chart" id="ch-smart" style="margin-top:8px"></div><div id="lg-smart"></div>
    <p class="hint">Eigene Berechnung aus der wöchentlichen Statistik der US-Terminmarktaufsicht CFTC (${which === 'btc' ? 'Bitcoin-Future' : 'E-mini-S&amp;P-500-Future'}): Smart Money = Hedgefonds, Investmentbanken und große Fondsgesellschaften, Dumb Money = Kleinanleger, zur Hälfte gemischt mit Angst und Gier. Rang: Netto-Position im Vergleich zu den letzten drei Jahren (0 = so vorsichtig wie nie, 100 = so zuversichtlich wie nie). „Kauft zu“ oder „verkauft“: Netto-Position in einer Woche um mindestens 1 Prozentpunkt des Marktes oder in vier Wochen um 2,5 Punkte verändert. Netto short heißt: mehr auf fallende als auf steigende Kurse gesetzt, oft auch zur Absicherung. Wagniskapitalgeber (VCs) melden keine solchen Daten, sie fehlen deshalb. Nicht der kostenpflichtige Index von Sentimentrader. Ein Stimmungsbild, kein Kaufsignal.</p>`,
    seg('smk', ['Aktien', 'Bitcoin'], which === 'btc' ? 'Bitcoin' : 'Aktien'), 'span12');
}
// Bitcoin: Kurzfrist- und Langfrist-Anleger im Plus oder Minus (smart.json → holders, Einstandspreise von BGeometrics)
function holderData() {
  const h = (S.smart || {}).holders;
  if (!h) return null;
  const q = (S.market.assets || {})['crypto:BTC'], p = q && q.price ? q.price : h.price;   // wenn vorhanden mit dem aktuellen Kurs
  return Object.assign({}, h, {price: p, sth_pct: (p / h.sth - 1) * 100, lth_pct: (p / h.lth - 1) * 100});
}
function holderCard() {
  const h = holderData();
  if (!h) return '';
  const view = S.hv || 'Einstand';
  const usd = v => nf(v, 0) + ' $', days = n => n === 1 ? 'einem Tag' : nf(n, 0) + ' Tagen';
  const box = (title, about, pct, cost, n, flip) => `<div class="fgbox"><div class="l">${title}</div>
    <div class="v num"><span class="${sign(pct)}" style="font-size:inherit;color:var(--${pct >= 0 ? 'up' : 'down'})">${pctS(pct, 1)}</span><span>${pct >= 0 ? 'im Plus' : 'im Minus'}</span></div>
    <div class="hbar" role="img" aria-label="${pctS(pct, 1)} zum Einstand"><i class="${pct >= 0 ? 'u' : 'd'}" style="${pct >= 0 ? 'left:50%' : 'right:50%'};width:${Math.min(50, Math.abs(pct))}%"></i><b></b></div>
    <div class="fgax"><span>−50 %</span><span>Einstand</span><span>+50 %</span></div>
    <div class="n">Einstand im Schnitt ${usd(cost)} · ${flip ? `seit ${days(n)} ${pct >= 0 ? 'im Plus' : 'im Minus'}` : `seit über ${days(n)} ${pct >= 0 ? 'im Plus' : 'im Minus'}`}</div>
    <div class="n">${about}</div></div>`;
  const s = h.sth_pct, l = h.lth_pct;
  const read = s < 0 && l < 0 ? ['bad', 'Beide Gruppen liegen im Minus. Das kam bisher fast nur in tiefen Bärenmärkten vor, zuletzt 2022. Solche Phasen lagen oft nahe am Tief, konnten aber Monate dauern.']
    : s < 0 ? ['warn', `Wer in den letzten fünf Monaten gekauft hat, liegt im Schnitt ${nf(Math.abs(s), Math.abs(s) < 10 ? 1 : 0)} % im Minus, die Langfrist-Anleger noch ${nf(l, l < 10 ? 1 : 0)} % im Plus. Neue Käufer verkaufen in solchen Lagen öfter mit Verlust. In Aufwärtsphasen waren das Rücksetzer, am Beginn von Bärenmärkten ging es weiter abwärts.`]
    : l < 0 ? ['good', 'Kurzfrist-Anleger wieder im Plus, Langfrist-Anleger noch im Minus. Das war bisher typisch für den Beginn einer Erholung nach einem Bärenmarkt.']
    : s > 30 ? ['warn', `Kurzfrist-Anleger liegen im Schnitt ${nf(s, 0)} % im Plus. Je größer der Gewinn, desto eher nehmen sie ihn mit.`]
    : ['good', 'Beide Gruppen liegen im Plus. Das ist typisch für einen intakten Aufwärtstrend. Der Einstand der Kurzfrist-Anleger galt dabei oft als Unterstützung.'];
  return card('Bitcoin: Wer liegt im Plus?', `Kurs ${usd(h.price)} gegen den Einstand der Anleger · Einstand Stand ${dateDe(h.asof)}`, `<div class="fggrid">
    ${box('Kurzfrist-Anleger', 'Coins seit weniger als 155 Tagen nicht bewegt', s, h.sth, h.sth_days, h.sth_flip)}
    ${box('Langfrist-Anleger', 'Coins seit 155 Tagen oder länger nicht bewegt', l, h.lth, h.lth_days, h.lth_flip)}</div>
    <div class="note ${read[0]}" style="margin-top:12px">${read[1]}</div>
    <div class="chart" id="ch-hold" style="margin-top:8px"></div><div id="lg-hold"></div>
    <p class="hint">Einstand: der Durchschnittspreis, zu dem die Coins der Gruppe zuletzt bewegt wurden (on-chain, „Realized Price“). Liegt der Kurs darüber, ist die Gruppe im Schnitt im Plus. Daten von BGeometrics, frei nur mit einer Woche Verzögerung; die letzten Tage rechnen mit dem letzten bekannten Einstand, der sich nur langsam ändert. Ein Stimmungsbild, kein Kaufsignal. Keine Anlageberatung.</p>`,
    seg('hv', ['Einstand', 'Plus/Minus'], view), 'span12');
}
// Angst und Gier: Aktienmarkt (eigene Berechnung nach CNN-Vorbild, update.market_fg) und Krypto (alternative.me)
function fgCard() {
  const m = marketFg(), k = S.daily.crypto_fg;
  if (!m && !k) return '';
  const gauge = (title, v, label, sub) => `<div class="fgbox"><div class="l">${title}</div><div class="v num">${v}<span>${esc(label)}</span></div>
    <div class="fgbar" role="img" aria-label="${v} von 100"><b style="left:${Math.max(0, Math.min(100, v))}%"></b></div><div class="fgax"><span>Angst</span><span>Gier</span></div>
    ${sub ? `<div class="n">${sub}</div>` : ''}</div>`;
  const parts = m ? `<div class="fgparts">${m.parts.map(p => `<div title="${esc(p.about)}"><span class="pn">${esc(p.name)}</span><span class="pb"><i style="width:${p.value}%"></i></span><span class="pv num">${p.value}</span></div>`).join('')}</div>` : '';
  return card('Angst und Gier', 'Stimmung am Markt, 0 bis 100', `<div class="fggrid">
    ${m ? gauge('Aktien', m.value, m.label, [m.week != null ? 'vor einer Woche ' + m.week : '', m.month != null ? 'vor einem Monat ' + m.month : ''].filter(Boolean).join(' · ')) : ''}
    ${k ? gauge('Krypto', k.value, FG_DE[k.label] || k.label, k.prev != null ? 'gestern ' + k.prev : '') : ''}</div>
    ${ansOf('fear') === 'buy' && (m && m.value < FEAR || k && k.value < FEAR && ansOf('crypto') === 'part') ? `<div class="note warn" style="margin-top:12px"><b>Extreme Angst.</b> Nach deiner Regel ein Kaufzeitpunkt: in Teilen und nur Titel mit intakten Gewinnschätzungen. Details im Reiter Strategie.</div>` : ''}
    ${parts}<p class="hint">Aktien: eigene Berechnung nach dem Vorbild von CNN aus fünf Bausteinen, jeder mit seinem letzten Jahr verglichen. Krypto: alternative.me. ${ansOf('fear') === 'buy' ? 'Deine Regel: unter 25 (extreme Angst) kaufen. Extreme Angst kann Wochen dauern. Keine Anlageberatung.' : 'Ein Stimmungsbild, kein Kaufsignal.'}</p>`, '', 'o5');
}
function vHome(c) {
  if (!c.txs.length) return `<div class="grid">${card('Willkommen', 'Trag deine ersten Käufe ein, dann rechnet das Dashboard los.',
    `<p class="body">Du gibst Aktien und Coins mit Kaufdatum, Stückzahl und Preis ein. Kurse, Dividenden, Quartalstermine,
    Krypto-Flows und Nachkauf-Zonen kommen automatisch dazu.</p><div class="btnrow"><button class="btn" data-act="addtx">Ersten Kauf eintragen</button>
    <button class="btn ghost" data-act="addwatch">Titel beobachten</button></div>`)}</div>`;
  const ps = perfStats(), ap = S.analysis.portfolio;
  const cal = (S.digest.calendar || []).filter(e => isMine(e) || e.category === 'Fed' || e.category === 'Makro').slice(0, 6);
  const alloc = S.alloc || 'Anlageklasse', hm = S.hm || 'Heute';
  const perf = ps ? `<div class="eyebrow" style="margin-top:18px">Wertentwicklung der heutigen Positionen</div><div class="perf">${ps.periods.map(x => `<div><div class="l">${x.label}</div><div class="v num ${sign(x.v)}">${x.v == null ? '–' : pctS(x.v, 1)}</div><div class="b num">${x.b == null ? '&nbsp;' : 'S&amp;P ' + pctS(x.b, 1)}</div></div>`).join('')}</div>` : '';
  return `${depSeg() ? `<div class="depbar">${depSeg()}</div>` : ''}<div class="g12"><div class="colstack span8">
    <section class="card hero o1"><div class="herotop"><div><div class="eyebrow">${S.dep === 'all' ? 'Depotwert' : 'Depotwert · ' + esc(depName(S.dep))}</div><div class="nav-value num">${eur(c.value)}</div>
      <div class="chgrow">${pill(c.dayPct)}<span class="num ${sign(c.dayEur)}">${eurS(c.dayEur)}</span><span class="muted">heute</span></div></div>
      <div class="heroside"><div class="eyebrow">Gewinn offen</div><div class="num ${sign(c.pnl)}" style="font-size:20px;font-weight:650;margin-top:4px">${eurS(c.pnl)}</div><div class="small muted num">${pctS(c.pnlPct, 1)} auf ${eur(c.cost, 0)}</div></div></div>
      ${perf}
      <div class="charthead"><div style="display:flex;gap:8px;flex-wrap:wrap">${seg('mode', Object.values(MODES), MODES[S.mode])}${S.mode === 'kauf' ? seg('cmp', Object.keys(CMP), CMP[S.cmp] ? S.cmp : 'Gesamt') : ''}</div>${seg('range', Object.keys(RANGES), S.range)}</div>
      <div class="chart" id="ch-main"></div><div id="lg-main"></div>
      ${S.mode === 'kauf' && c.series.d.length > 1 ? cmpTable(c) : `<p class="hint">${S.mode === 'kauf' ? 'Seit Kauf gibt es erst ab dem zweiten Tag einen Verlauf. Bis dahin: ' : ''}Deine heutigen Bestände, mit den Kursen der Vergangenheit zurückgerechnet. So sieht man, wie sich das Depot in seiner jetzigen Zusammensetzung entwickelt hätte.</p>`}</section>
    ${card('Heatmap', 'Fläche nach Anteil am Depot, Farbe nach ' + (hm === 'Heute' ? 'Tagesbewegung' : 'Gewinn seit Kauf'), `<div class="tm" id="tm"></div>
      <div class="scale"><span class="num">${hm === 'Heute' ? '−3 %' : '−50 %'}</span><i></i><span class="num">${hm === 'Heute' ? '+3 %' : '+50 %'}</span><span style="margin-left:auto">Krypto-Skala doppelt so weit</span></div>`, seg('hm', ['Heute', 'Seit Kauf'], hm), 'o4')}
    </div>
    <div class="colstack span4">
      ${card('Beitrag heute', 'Wer den Tag bewegt hat, in Euro', attribution(c), '', 'o3')}
      ${card('Kennzahlen', '', `<div class="kpis">
        <div><span class="l">Gewinn offen</span><span class="v num ${sign(c.pnl)}">${eurS(c.pnl)}<small>${pctS(c.pnlPct, 1)}</small></span></div>
        <div><span class="l">Eingesetzt</span><span class="v num">${eur(c.cost, 0)}</span></div>
        <div><span class="l">Realisiert<small>aus Verkäufen</small></span><span class="v num ${sign(c.realized)}">${eurS(c.realized)}</span></div>
        <div><span class="l">Dividenden pro Jahr<small>erwartet, brutto</small></span><span class="v num">${eur(c.divYear, 0)}<small class="muted">${c.value ? nf(c.divYear / c.value * 100, 2) + ' % Rendite' : ''}</small></span></div>
        <div><span class="l">Positionen</span><span class="v num">${c.held.length}<small class="muted">${CLASS_ORDER.map(k => [k, c.held.filter(p => assetClass(p.key) === k).length]).filter(x => x[1]).map(x => x[1] + ' ' + x[0]).join(' · ')}</small></span></div></div>`, '', 'o6')}
      ${fgCard()}
    </div>
    ${riskCard(c)}
    ${smartCard()}
    ${holderCard()}
    ${card('Allokation', '', allocation(c, alloc), seg('alloc', ['Anlageklasse', 'Sektor', 'Währung'], alloc), 'span7')}
    ${card('Nächste Termine', 'Deine Titel, Fed und Konjunktur', cal.length ? calCompact(cal) + `<div class="btnrow" style="margin-top:10px"><button class="btn sm ghost" data-act="tab" data-v="cal">Alle Termine</button></div>` : '<p class="empty">Keine Termine bekannt.</p>', '', 'span5')}
    ${ap ? `<details class="card fold span12"><summary><div><h2>Einschätzung der Recherche</h2><p class="sub">${esc(ap.headline)} · ${esc(ago(ap.at))}</p></div><span class="chev"></span></summary>
      <div class="grid half"><div><p class="body">${esc(ap.summary)}</p>${(ap.risks || []).length ? `<p class="sh">Risiken</p><ul class="dots">${ap.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</div>
      ${(ap.buy_candidates || []).length ? `<div><p class="sh" style="margin-top:0">Nachkauf-Kandidaten</p><div class="rows">${ap.buy_candidates.map(b => `<div class="row"><div class="l"><div class="t">${tag(keyBySym(b.symbol))}<span>${esc(b.level)}</span></div><div class="x">${esc(b.reason)}</div></div></div>`).join('')}</div></div>` : ''}</div>
      <p class="hint">Recherche von Claude. Keine Anlageberatung.</p></details>` : ''}
  </div>`;
}
function drawCharts() {
  const c = calc();
  if ($('#ch-main')) {
    if (S.mode === 'positionen' || c.series.d.length < 2) {   // am ersten Tag gibt es noch keinen Verlauf seit Kauf
      const bc = backcast();
      if (bc && bc.d.length > 1) {
        const from = bc.d[bc.d.length - 1] - RANGES[S.range];
        let i0 = bc.d.findIndex(d => d >= from); if (i0 < 0) i0 = 0;
        const s = [{name: 'Heutige Positionen', color: 'var(--accent)', area: true, pts: bc.d.slice(i0).map((x, i) => [x, bc.v[i0 + i]])}];
        lineChart('#ch-main', s, {fmt: v => eur(v, 0), label: 'Wert der heutigen Positionen, zurückgerechnet', height: 260});
        $('#lg-main').innerHTML = legend(s);
      } else $('#ch-main').innerHTML = '<p class="empty">Die Rückrechnung kommt mit der nächsten täglichen Aktualisierung.</p>';
    } else if (c.series.d.length > 1) {
      const sr = c.series, cm = CMP[S.cmp] ? S.cmp : 'Gesamt';
      const from = sr.d[sr.d.length - 1] - RANGES[S.range];
      let i0 = sr.d.findIndex(d => d >= from); if (i0 < 0) i0 = 0;
      const d = sr.d.slice(i0), at = f => d.map((x, i) => [x, f(i0 + i)]);
      const [val, bs, bb, inv] = {Gesamt: [i => sr.v[i], i => sr.as[i] + sr.ks[i], i => sr.ab[i] + sr.kb[i], i => sr.inv[i]],
        Aktien: [i => sr.va[i], i => sr.as[i], i => sr.ab[i], i => sr.ia[i]], Krypto: [i => sr.vk[i], i => sr.ks[i], i => sr.kb[i], i => sr.ik[i]]}[cm];
      const s = [{name: CMP[cm], color: 'var(--accent)', area: true, pts: at(val)}];
      if (sr.bench) s.push({name: 'Alles in S&P 500', color: 'var(--s2)', pts: at(bs)}, {name: 'Alles in Bitcoin', color: 'var(--s7)', pts: at(bb)});
      s.push({name: 'Eingesetzt', color: 'var(--ink3)', dash: true, thin: true, pts: at(inv)});
      lineChart('#ch-main', s, {fmt: v => eur(v, 0), label: 'Depotwert seit Kauf im Vergleich mit gleichen Käufen', height: 260});
      $('#lg-main').innerHTML = legend(s);
    }
  }
  const cj = $('#ch-jk');
  if (cj) drawJakob(cj);
  const cr = $('#ch-rule');
  if (cr && S._rsim) drawRuleChart(cr, S._rsim);
  const chs = $('#ch-smart'), smx = (S.smart || {})[(S.smart || {})[S.smk] ? S.smk : 'stocks'];
  if (chs && smx && smx.hist && smx.hist.length > 1) {
    const s2 = [{name: 'Smart Money', color: 'var(--s1)', pts: smx.hist.map(h => [isoToDay(h[0]), h[1]])}, {name: 'Dumb Money', color: 'var(--s2)', pts: smx.hist.map(h => [isoToDay(h[0]), h[2]])}];
    lineChart(chs, s2, {fmt: v => nf(v, 0), height: 200, label: 'Smart Money und Dumb Money, zwei Jahre', hlines: [{y: 50, label: '', color: 'var(--line2)'}]});
    $('#lg-smart').innerHTML = legend(s2);
  }
  const cbt = $('#ch-bt');
  if (cbt && S.bt && S.bt.curves) {
    const cv = S.bt.curves, col = {best: 'var(--accent)', qg: 'var(--s2)', jakob: 'var(--s3)', QQQ: 'var(--s4)', SPY: 'var(--ink3)'};
    const sb = Object.keys(col).filter(id => cv[id]).map(id => ({name: (S.bt.strategies.find(x => x.id === id) || {}).short || id, color: col[id], dash: id === 'SPY', pts: cv.d.map((d, i) => [d, cv[id][i] * 10000])}));
    lineChart(cbt, sb, {fmt: v => v >= 1e6 ? nf(v / 1e6, 1) + ' Mio.' : nf(Math.max(0, v) / 1000, 0) + ' Tsd.', height: 260, label: 'Aus 10.000 Dollar nach verschiedenen Regeln, mit Dividenden'});
    $('#lg-bt').innerHTML = legend(sb);
  }
  const cmo = $('#ch-model');
  if (cmo) drawModel(cmo);
  const chh = $('#ch-hold'), hd = holderData();
  if (chh && hd && hd.hist && hd.hist.length > 1) {
    const H = hd.hist, pc = S.hv === 'Plus/Minus';
    const s3 = pc ? [{name: 'Kurzfrist-Anleger', color: 'var(--s2)', pts: H.map(r => [r[0], (r[1] / r[2] - 1) * 100])}, {name: 'Langfrist-Anleger', color: 'var(--s3)', pts: H.map(r => [r[0], (r[1] / r[3] - 1) * 100])}]
      : [{name: 'Bitcoin-Kurs', color: 'var(--s1)', pts: H.map(r => [r[0], r[1]])}, {name: 'Einstand Kurzfrist-Anleger', color: 'var(--s2)', pts: H.map(r => [r[0], r[2]])}, {name: 'Einstand Langfrist-Anleger', color: 'var(--s3)', pts: H.map(r => [r[0], r[3]])}];
    lineChart(chh, s3, {fmt: pc ? (v => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), 0) + ' %') : (v => nf(v / 1000, 0) + ' Tsd.'), height: 220,
      label: pc ? 'Gewinn oder Verlust der Anleger in Prozent, drei Jahre' : 'Bitcoin-Kurs und Einstand der Anleger, drei Jahre', hlines: pc ? [{y: 0, label: 'Einstand', color: 'var(--line2)'}] : []});
    $('#lg-hold').innerHTML = legend(s3);
  }
  const tm = $('#tm');
  if (tm) {
    const W = tm.clientWidth, H = tm.clientHeight, mode = S.hm || 'Heute';
    const rects = squarify(c.held.filter(p => p.value > 0).map(p => ({key: p.key, v: p.value, p})), 0, 0, W, H);
    tm.innerHTML = rects.map(r => {
      const p = r.p, val = mode === 'Heute' ? p.dayPct : p.pnlPct, lim = mode === 'Heute' ? (p.kind === 'crypto' ? 6 : 3) : (p.kind === 'crypto' ? 100 : 50);
      const t = val == null ? 0 : Math.max(-1, Math.min(1, val / lim)), k = Math.round(Math.pow(Math.abs(t), 0.75) * 100);
      const cls = [t >= 0 ? 'u' : 'd', k > 50 ? 'strong' : '', r.w < 58 || r.h < 40 ? 'xs' : '', r.w < 30 || r.h < 20 ? 'xxs' : ''].join(' ');
      return `<button data-act="open" data-key="${esc(p.key)}" class="${cls}" style="left:${(r.x + 1).toFixed(1)}px;top:${(r.y + 1).toFixed(1)}px;width:${Math.max(0, r.w - 2).toFixed(1)}px;height:${Math.max(0, r.h - 2).toFixed(1)}px;--k:${k}%"
        title="${esc(p.symbol)} · ${esc(p.name)}: ${pctS(val, 2)} · ${nf(p.weight, 1)} % vom Depot"><span class="s">${esc(r.w > 92 ? shortName(p.key) : p.symbol)}</span><span><span class="p num">${pctS(val, 2)}</span><br><span class="w num">${nf(p.weight, 1)} %</span></span></button>`;
    }).join('');
  }
  const el = $('#ch-asset');
  if (el) {
    const key = el.dataset.key, h = D(key).hist, c2 = calc();
    const wk = (S.market.spark || {})[key], wt = (S.market.spark_t || {})[key];
    if ((S.assetRange || '1J') === '1W' && wk && wt && wt.length === wk.length && wk.length > 4) {
      // Woche aus Stundenkursen (market.json → spark, spark_t), dazu der aktuelle Kurs
      const times = wt.map(x => x * 3600000), vals = wk.slice(), live = A(key).price;
      if (live != null && !A(key).error && Date.now() > times[times.length - 1] - 1800000) { vals.push(live); times.push(Math.max(Date.now(), times[times.length - 1] + 1)); }
      const pts = vals.map((v, i) => [i, toShow(key, v)]), lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])), near = y => y > lo - (hi - lo) && y < hi + (hi - lo);
      const p = c2.pos.find(x => x.key === key), hl = [];
      const avg = p && p.qty > 1e-12 ? (showCur(key) === 'EUR' ? p.cost / p.qty : p.avgNative) : null;
      if (avg && near(avg)) hl.push({y: avg, label: 'Dein Einstand ' + money(avg, showCur(key)), color: 'var(--accent)'});
      (D(key).levels || []).slice(0, 2).forEach(l => { const y = toShow(key, l.price); if (near(y)) hl.push({y, label: 'Nachkauf-Zone ' + px(key, l.price), color: 'var(--up)'}); });
      const mk = c2.txs.filter(t => t.key === key && t.day * 864e5 >= times[0]).map(t => { const i = times.findIndex(x => x >= t.day * 864e5);
        return i < 0 ? null : {x: i, y: pts[i][1], color: t.type === 'buy' ? 'var(--up)' : 'var(--down)', title: `${t.type === 'buy' ? 'Kauf' : 'Verkauf'} ${nf(t.qty, 4)} zu ${money(t.price, t.currency)}`}; }).filter(Boolean);
      const up = pts[pts.length - 1][1] >= pts[0][1];
      lineChart(el, [{name: shortName(key), color: up ? 'var(--up)' : 'var(--down)', area: true, pts}], {fmt: v => money(v, showCur(key)), hlines: hl, markers: mk, height: 230, label: 'Kursverlauf der letzten 7 Tage', times});
    } else if (h && h.d.length > 1) {
      const from = h.d[h.d.length - 1] - (RANGES[S.assetRange || '1J'] || 7);
      const pts = h.d.map((x, i) => [x, toShow(key, h.c[i], x)]).filter(p => p[0] >= from);
      const p = c2.pos.find(x => x.key === key), hl = [];
      const avg = p && p.qty > 1e-12 ? (showCur(key) === 'EUR' ? p.cost / p.qty : p.avgNative) : null;
      if (avg) hl.push({y: avg, label: 'Dein Einstand ' + money(avg, showCur(key)), color: 'var(--accent)'});
      (D(key).levels || []).slice(0, 2).forEach(l => hl.push({y: toShow(key, l.price), label: 'Nachkauf-Zone ' + px(key, l.price), color: 'var(--up)'}));
      const mk = c2.txs.filter(t => t.key === key).map(t => ({x: t.day, y: toShow(key, priceAt(key, t.day), t.day), color: t.type === 'buy' ? 'var(--up)' : 'var(--down)',
        title: `${t.type === 'buy' ? 'Kauf' : 'Verkauf'} ${nf(t.qty, 4)} zu ${money(t.price, t.currency)}`}));
      const up = pts.length > 1 && pts[pts.length - 1][1] >= pts[0][1];
      lineChart(el, [{name: key.split(':')[1], color: up ? 'var(--up)' : 'var(--down)', area: true, pts}], {fmt: v => money(v, showCur(key)), hlines: hl.filter(x => x.y > 0), markers: mk, height: 230, label: 'Kursverlauf'});
    } else el.innerHTML = '<p class="empty">Der Kursverlauf kommt mit der nächsten täglichen Aktualisierung.</p>';
  }
}

/* ---------------------------------------------------------------- Positionen */
function vDepot(c) {
  const jh = jakobHeld(), f = fltOn('depot'), rows = c.held.filter(p => f === 'Alle' || typeOf(p.key) === f).map(p => ({key: p.key, p, rj: !!jh[p.key]}));
  const rcol = rows.some(r => r.rj) ? [COL.rule] : [];
  const sumV = rows.reduce((s, r) => s + (r.p.value || 0), 0), sumP = rows.reduce((s, r) => s + (r.p.pnl || 0), 0), sumD = rows.reduce((s, r) => s + (r.p.dayEur || 0), 0);
  const txs = [...c.txs].reverse();
  return `${depSeg() ? `<div class="depbar">${depSeg()}</div>` : ''}<div class="grid">
    <section class="card"><div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${stat('Wert', eur(sumV, 0), rows.length + (rows.length === 1 ? ' Position' : ' Positionen'))}
      ${stat('Gewinn offen', eurS(sumP), sumV - sumP > 0 ? pctS(sumP / (sumV - sumP) * 100, 1) : '', sign(sumP))}${stat('Heute', eurS(sumD), '', sign(sumD))}${stat('Dividenden pro Jahr', eur(c.divYear, 0), 'erwartet, brutto')}</div></section>
    <section class="card"><div class="toolbar"><div>${flt('depot', ['Alle', 'Aktien', 'ETFs', 'Krypto'])}</div>
      <div class="sumline">Punkte: 10 deutlich unterbewertet, 1 deutlich überbewertet · Spalten per Klick sortieren, Zeile antippen für die Gründe.</div>
      <button class="btn" data-act="addtx">Kauf oder Verkauf</button></div>
      ${c.held.length ? `<div class="wl-wide">${tbl('depot', [COL.score, ...rcol, COL.nameM, COL.spark, COL.price, COL.day, COL.value, COL.pnl, COL.weight], rows, ['value', -1])}</div>
      <div class="wl-narrow">${posList('depot', rows, ['value', -1])}</div>` : '<p class="empty">Trag oben deinen ersten Kauf ein.</p>'}</section>
    ${divCard(c)}
    <details class="card fold"><summary><div><h2>Buchungen</h2><p class="sub">${txs.length} eingetragene Käufe und Verkäufe</p></div><span class="chev"></span></summary>
      ${txs.length ? `<div class="rows">${txs.map(t => `<button class="row" data-act="edittx" data-id="${esc(t.id)}"><div class="l">
      <div class="t">${tag(t.key)}<span>${t.type === 'buy' ? 'Kauf' : 'Verkauf'}${t.source && t.source !== 'manual' ? ' · ' + esc(t.source) : ''}${depots().length > 1 && S.dep === 'all' ? ' · ' + esc(depName(depOf(t))) : ''}</span></div><div class="m num">${dateDe(t.date)} · ${nf(t.qty, t.qty % 1 ? 4 : 0)} × ${money(t.price, t.currency)}</div></div>
      <div class="r"><span class="chip ${t.type === 'buy' ? 'good' : 'bad'}">${t.type === 'buy' ? '−' : '+'}${S.hide ? MASK : money(t.qty * t.price, t.currency)}</span></div></button>`).join('')}</div>` : '<p class="empty">Noch keine Buchungen.</p>'}
      <p class="hint">Der direkte Import aus Trade Republic oder comdirect ist vorbereitet, aber noch nicht aktiv. Jede Buchung merkt sich ihre Herkunft.</p></details>
  </div>`;
}

// Änderung der Gewinnschätzung in 90 Tagen (dieselbe Rechnung wie tracker/analytics.py est_change)
const estChg = f => { const v = f.est_chg_90d != null ? f.est_chg_90d : (f.est_eps != null && f.est_eps_90d ? (f.est_eps - f.est_eps_90d) / Math.abs(f.est_eps_90d) * 100 : null); return v == null ? null : Math.max(-100, Math.min(100, v)); };

function divCard(c) {
  const divs = c.held.filter(p => D(p.key).div && D(p.key).div.annual);
  return card('Dividenden', `Erwartet pro Jahr: ${eur(c.divYear)} brutto`, divs.length ? `<div class="rows tight two">${divs.sort((a, b) => (b.divYear || 0) - (a.divYear || 0)).map(p => { const d = D(p.key).div; return `<button class="row" data-act="open" data-key="${esc(p.key)}"><div class="l">
      <div class="t">${tag(p.key)}<span>${nf(d.yield_pct, 2)} % Rendite</span></div><div class="m num">${px(p.key, d.annual)} je Aktie · ${d.per_year || '–'}× jährlich${d.next_ex ? ' · Ex-Tag ' + dateDe(d.next_ex) + (d.next_ex_estimated ? ' (geschätzt)' : '') : ''}</div></div>
      <div class="r"><div class="v num">${eur(p.divYear)}</div><span class="muted tiny">pro Jahr</span></div></button>`; }).join('')}</div>` : '<p class="empty">Keine Dividendentitel im Depot.</p>');
}

function flowBlock(key) {
  const a = A(key), f = a.flow || {}, w = S.flowWin, rd = (a.flow_read || {})[w], sym = key.split(':')[1];
  const sp = (f.spot || {})[w], fu = (f.fut || {})[w], ch = w === '4' ? f.px_chg_4h : a.change_pct;
  const dv = r => { const p = Math.min(Math.abs(r || 0) / 0.12, 1) * 100; return `<div class="div2"><span>${r < 0 ? `<i style="width:${p}%;background:var(--down)"></i>` : ''}</span><span>${r >= 0 ? `<i style="width:${p}%;background:var(--up)"></i>` : ''}</span></div>`; };
  const fund = Object.entries(f.funding || {}).map(([v, x]) => `${esc(v)} ${nf(x, 4)} %`).join(' · ');
  return `<div><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div style="font-size:15px;font-weight:600">${tag(key)}</div>
    <div class="muted small num">${money(a.price, 'USD')} · ${pctS(ch)} in ${w} Std.</div></div>${rd ? `<span class="chip ${toneClass(rd.tone)}">${esc(rd.label)}</span>` : ''}</div>
    ${rd ? `<p class="body" style="margin-top:8px">${esc(rd.text)}</p>` : ''}
    <div class="flowgrid">${sp ? `<span>Spot-Käufe</span>${dv(sp.ratio)}<span class="v num">${pctS(sp.ratio * 100, 1)}</span>` : ''}
    ${fu ? `<span>Futures-Käufe</span>${dv(fu.ratio)}<span class="v num">${pctS(fu.ratio * 100, 1)}</span>` : ''}</div>
    <p class="hint">Netto-Kaufdruck: Anteil der Käufe minus Verkäufe am gehandelten Volumen${f.spot_source ? ` (Spot: ${esc(f.spot_source)}, Futures: ${esc(f.fut_source || '–')})` : ''}.</p>
    <div class="kv">${tile('Open Interest', f.oi_total ? big(f.oi_total) + ' $' : '–', (f.oi_chg || {})[w] != null ? pctS(f.oi_chg[w], 1) + ' in ' + w + ' Std.' : Object.keys(f.oi || {}).join(', '))}
    ${tile('Funding je 8 Std.', f.funding_avg != null ? nf(f.funding_avg, 4) + ' %' : '–', f.funding_apr != null ? nf(f.funding_apr, 1) + ' % aufs Jahr' : '', f.funding_avg > 0.03 ? 'neg' : '')}</div>
    ${fund ? `<p class="hint">Funding je Börse: ${fund}</p>` : ''}
    <p class="small" style="margin:8px 0 0"><a href="https://velo.xyz/futures/${encodeURIComponent(sym)}" target="_blank" rel="noopener">Auf Velo öffnen ›</a></p></div>`;
}

/* ---------------------------------------------------------------- Watchlist und Alerts */
// Watchlist am Handy als Liste im Stil von Krypto-Apps (Jakobs Wunsch vom 19.11.2026): Punkte, Logo, Kürzel mit Marktwert,
// Kurs, rechts der 7-Tage-Verlauf mit der Tagesänderung. Sortierung teilt sich den Zustand mit der Tabelle.
const LCOL = [COL.score, {id: 'day', label: 'Heute', num: true, sort: COL.day.sort}, {id: 'w7', label: '7 Tage', num: true, sort: r => { const s = (S.market.spark || {})[r.key], p = A(r.key).price; return s && s[0] && p != null ? p / s[0] - 1 : null; }},
  {id: 'mcap', label: 'Marktwert', num: true, sort: r => { const v = mcapOf(r.key); return v ? v / (isCoin(r.key) ? (fxNow('USD') || 1) : 1) : null; }},
  {id: 'name', label: 'Name', sort: r => shortName(r.key).toLowerCase()}];
// Liste am Handy (Watchlist und Positionen): Punkte, Logo, Name mit Unterzeile, Kurs bzw. Wert, rechts 7 Tage und heute
function listView(id, cols, rows, def, o) {
  const {st, col, rows: rs} = sortRows(id, cols, rows, def);
  if (!rs.length) return '<p class="empty">Keine Titel in dieser Auswahl.</p>';
  const sorter = `<div class="wl-sort"><div class="seg">${cols.map(c => `<button data-act="sort" data-id="${id}" data-v="${c.id}" data-num="${c.num ? 1 : 0}" class="${c.id === col.id ? 'on' : ''}">${c.label}${c.id === col.id ? (st[1] < 0 ? ' ↓' : ' ↑') : ''}</button>`).join('')}</div></div>`;
  return sorter + `<div class="wl">${rs.map(row => { const key = row.key, r = ratingOf(key);
    return `<button class="wl-row" data-act="open" data-key="${esc(key)}">
      <span class="wl-sc${r == null ? ' none' : ' t' + tierOf(r)}" title="${r == null ? 'keine Punkte' : r + ' von 10 Punkten'}">${r == null ? '–' : r}</span>${logo(key)}
      <span class="wl-nm"><b>${esc(shortName(key))}</b><small>${withPre((o.pre ? o.pre(row) : ruleTag(key)) || momTag(key), o.sub ? o.sub(row) : subLine(key))}</small></span>
      <span class="wl-px num">${o.mid(row)}</span>
      <span class="wl-ch">${spark7(key)}${chgA(A(key).change_pct).replace('chga', 'chga sm')}</span></button>`; }).join('')}</div>
    <p class="wl-hint">${o.hint || ''}Links die Punkte: 10 deutlich unterbewertet, 1 deutlich überbewertet. Rechts der Verlauf über 7 Tage (gestrichelt: Stand vor 7 Tagen) und die Änderung heute. „Top 7“: unter den stärksten im Aufwärtstrend nach deiner Strategie; „Momentum“ bei Coins und ETFs: Aufwärtstrend, nahe am Jahreshoch, stärker als der Markt (↘ lässt nach). Antippen für die Gründe. · Version ${esc(APP_V)}</p>`;
}
const watchList = (id, rows, def) => listView(id, LCOL, rows, def, {mid: r => px(r.key, A(r.key).price)});
const PCOL = [COL.score, {id: 'day', label: 'Heute', num: true, sort: COL.day.sort}, {id: 'value', label: 'Wert', num: true, sort: r => r.p.value},
  {id: 'pnl', label: 'Gewinn', num: true, sort: r => r.p.pnlPct}, {id: 'name', label: 'Name', sort: r => shortName(r.key).toLowerCase()}];
const posList = (id, rows, def) => listView(id, PCOL, rows, def, {
  pre: r => r.rj ? ruleTag(r.key) : '',
  sub: r => [shortName(r.key) === tick(r.key) ? '' : tick(r.key), nf(r.p.weight, 1) + ' %'].filter(Boolean).join(' · '),
  mid: r => `${eur(r.p.value, 0)}<small class="${sign(r.p.pnl)}" title="${r.p.pnl == null ? '' : eurS(r.p.pnl)}">${r.p.pnl == null ? '–' : pctS(r.p.pnlPct, 1)}</small>`,
  hint: 'Mitte: Wert und Gewinn seit Kauf in Prozent. '});
function vWatch() {
  const wl = S.pf.watchlist || [], al = S.pf.alerts || [], st = S.state.alerts || {}, f = fltOn('watch');
  const rows = wl.map(w => ({key: keyOf(w.kind, w.symbol)})).filter(r => f === 'Alle' || typeOf(r.key) === f);
  return `<div class="grid">
    <section class="card"><div class="toolbar"><div>${flt('watch', ['Alle', 'Aktien', 'ETFs', 'Krypto'])}</div>
      <div class="sumline"><b>${rows.length}</b> Titel beobachtet<span class="hm"> · Punkte: 10 deutlich unterbewertet, 1 deutlich überbewertet · Zeile antippen für die Gründe</span></div><button class="btn" data-act="addwatch">Titel hinzufügen</button></div>
      ${wl.length ? `<div class="wl-wide">${tbl('watch', [COL.score, ...(idealBook() ? [COL.rule] : []), COL.nameM, COL.spark, COL.price, COL.day, COL.m1], rows, ['name', 1])}</div>
      <div class="wl-narrow">${watchList('watch', rows, ['name', 1])}</div>` : '<p class="empty">Noch nichts auf der Watchlist.</p>'}</section>
    <div class="grid half">
    ${card('Alerts', 'Push aufs Handy, sobald eine Schwelle erreicht ist', (al.length ? `<div class="rows tight">${al.map(a => { const fd = st[a.id];
      return `<div class="row"><div class="l"><div class="t">${tag(keyOf(a.kind, a.symbol))}<span>${esc(alertText(a))}</span></div>
      <div class="m">${fd ? 'Ausgelöst ' + esc(ago(fd.fired)) : 'Aktiv'}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
      <div class="r" style="display:flex;gap:6px;align-items:center"><span class="chip ${fd ? 'warn' : 'good'}">${fd ? 'ausgelöst' : 'aktiv'}</span>
      ${fd ? `<button class="btn sm ghost" data-act="rearm" data-id="${esc(a.id)}">Wieder scharf</button>` : ''}<button class="xbtn" data-act="delalert" data-id="${esc(a.id)}" title="Löschen">×</button></div></div>`; }).join('')}</div>` : '<p class="empty">Noch keine Alerts.</p>')
      + `<div class="btnrow"><button class="btn" data-act="addalert">Alert anlegen</button></div>
      ${(S.pf.settings || {}).ntfy_topic ? '' : '<div class="note">Für Push aufs Handy fehlt noch der ntfy-Kanal. Du richtest ihn in den Einstellungen ein.</div>'}`)}
    ${card('Automatische Meldungen', 'Starke Tagesbewegungen', `<p class="body">Bewegt sich ein Titel an einem Tag um mehr als ${nf((S.pf.settings || {}).move_stock ?? 5, 0)} % (Aktien) oder ${nf((S.pf.settings || {}).move_crypto ?? 8, 0)} % (Krypto), kommt eine Meldung mit Punkten und nächster Nachkauf-Zone. Die Schwellen änderst du in den Einstellungen.</p>`)}
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- Einblicke: Sektoren, Analysten, Insider */
// Daten aus daily.json: sectors (Aktien-ETFs), analyst (Urteile und Änderungen), insider (US-Meldungen nach Form 4). Quelle Yahoo.
const REC = ['Starker Kauf', 'Kaufen', 'Halten', 'Verkaufen', 'Starker Verkauf'];
const sumN = n => n ? n.reduce((a, b) => a + b, 0) : 0;
const recMean = n => sumN(n) ? n.reduce((s, x, i) => s + x * (i + 1), 0) / sumN(n) : null;
const recWord = m => m == null ? '–' : REC[Math.min(4, Math.max(0, Math.round(m) - 1))];
const buyShare = n => sumN(n) ? (n[0] + n[1]) / sumN(n) * 100 : null;
const GRADE_DE = {'Strong Buy': 'Starker Kauf', Buy: 'Kaufen', 'Conviction Buy': 'Kaufen', 'Long-Term Buy': 'Langfristig kaufen', 'Speculative Buy': 'Spekulativ kaufen',
  Accumulate: 'Aufstocken', Add: 'Aufstocken', Outperform: 'Besser als der Markt', 'Market Outperform': 'Besser als der Markt', 'Sector Outperform': 'Besser als die Branche',
  Overweight: 'Übergewichten', Positive: 'Positiv', Hold: 'Halten', Neutral: 'Neutral', 'Equal-Weight': 'Marktgewichten', 'Equal Weight': 'Marktgewichten',
  'Market Perform': 'Wie der Markt', 'Sector Perform': 'Wie die Branche', 'Sector Weight': 'Wie die Branche', 'In-Line': 'Wie der Markt', 'Peer Perform': 'Wie die Vergleichsgruppe',
  Mixed: 'Gemischt', Underweight: 'Untergewichten', Underperform: 'Schlechter als der Markt', 'Market Underperform': 'Schlechter als der Markt',
  'Sector Underperform': 'Schlechter als die Branche', Reduce: 'Reduzieren', Negative: 'Negativ', Sell: 'Verkaufen', 'Strong Sell': 'Starker Verkauf'};
const gradeDe = g => GRADE_DE[g] || g || '–';
const ACTION_DE = {up: 'hebt auf', down: 'senkt auf', init: 'startet mit', main: 'bleibt bei', reit: 'bleibt bei'};
const ROLE_DE = {Director: 'Board-Mitglied', Officer: 'Führungskraft', 'Officer and Director': 'Führungskraft und Board', 'Chief Executive Officer': 'Vorstandschef',
  'Chief Financial Officer': 'Finanzchef', 'Chief Operating Officer': 'Leiter operatives Geschäft', 'Chief Technology Officer': 'Technikchef', President: 'Präsident',
  'General Counsel': 'Chefjurist', 'Chairman of the Board': 'Board-Vorsitz'};
const roleDe = r => ROLE_DE[r] || (/Beneficial Owner/i.test(r || '') ? 'Großaktionär (über 10 %)' : r || '–');
const INS_HINT = 'Verkäufe sind oft lange geplant (Vergütung, Steuern, feste Verkaufspläne) und sagen wenig. Käufe mit eigenem Geld sind seltener und das stärkere Zeichen. Zuteilungen und Optionen sind nicht enthalten. Einzeln melden müssen nur US-Firmen.';
const an = key => D(key).analyst || {};
const ins = key => D(key).insider;
const dShort = d => d ? `${+d.slice(8, 10)}.${+d.slice(5, 7)}.` : '';
// Beträge und Kurse für die Anzeige gerundet, Aktien in Euro
const amt = (key, v) => { const x = toShow(key, v); return x == null || isNaN(x) ? '–' : big(x) + ' ' + (CUR[showCur(key)] || showCur(key)); };
const pxR = (key, v) => { const x = toShow(key, v); return x == null || isNaN(x) ? '–' : nf(x, x >= 100 ? 0 : x >= 10 ? 1 : 2) + ' ' + (CUR[showCur(key)] || showCur(key)); };
const upside = key => { const t = (D(key).fund || {}).target_mean, p = A(key).price; return t && p ? (t / p - 1) * 100 : null; };
const recBar = (n, wide) => `<span class="recbar${wide ? ' wide' : ''}" role="img" aria-label="${n.map((x, i) => x + ' ' + REC[i]).join(', ')}">${n.map((x, i) => x ? `<i class="r${i}" style="flex:${x}" title="${REC[i]}: ${x}"></i>` : '').join('')}</span>`;
function changeText(key, c) {
  if (!c) return '<span class="ts">–</span>';
  const pt = c.pt ? (c.pt_prev && Math.abs(c.pt_prev - c.pt) > 1e-9 ? `Ziel ${pxR(key, c.pt_prev)} → ${pxR(key, c.pt)}` : `Ziel ${pxR(key, c.pt)}`) : '';
  return `<div class="tl"><b>${esc(c.firm)}</b> ${esc(ACTION_DE[c.action] || '')} ${esc(gradeDe(c.to))}</div><div class="ts">${dShort(c.d)}${pt ? ' · ' + pt : ''}</div>`;
}
const ACOL = {
  rec: {id: 'rec', label: 'Urteil', cls: 'c-rec', num: true, sort: r => recMean(an(r.key).now), html: r => { const n = an(r.key).now; return n ? `<div class="recc">${recBar(n)}<span>${recWord(recMean(n))}</span></div>` : '<span class="ts">–</span>'; }},
  n: {id: 'n', label: 'Analysten', cls: 'r hm', num: true, sort: r => sumN(an(r.key).now) || null, html: r => `<span class="num">${sumN(an(r.key).now) || '–'}</span>`},
  buy: {id: 'buy', label: 'Kaufurteile', cls: 'r hm', num: true, sort: r => buyShare(an(r.key).now), html: r => { const x = an(r.key); return x.now ? `<div class="num">${nf(buyShare(x.now), 0)} %</div>${x.before ? `<div class="ts num">vor 3 Mon. ${nf(buyShare(x.before), 0)} %</div>` : ''}` : '<span class="ts">–</span>'; }},
  tgt: {id: 'tgt', label: 'Kursziel', cls: 'r', num: true, sort: r => upside(r.key), html: r => { const t = (D(r.key).fund || {}).target_mean, u = upside(r.key); return t ? `<div class="num">${pxR(r.key, t)}</div>${u != null ? `<div class="ts num">${pctS(u, 0)} zum Kurs</div>` : ''}` : '<span class="ts">–</span>'; }},
  last: {id: 'last', label: 'Letzte Änderung', cls: 'hm c-last', sort: r => ((an(r.key).changes || [])[0] || {}).d || null, html: r => changeText(r.key, (an(r.key).changes || [])[0])},
};
const insAmt = (key, typ) => { const i = ins(key), n = i['n_' + typ + '_6m']; return n ? `<div class="num">${amt(key, i[typ + '_6m'])}</div><div class="ts">${n} ${n === 1 ? 'Meldung' : 'Meldungen'}</div>` : '<span class="ts">–</span>'; };
const ICOL = {
  buy: {id: 'ibuy', label: 'Käufe<span class="hm"> 6 Mon.</span>', cls: 'r', num: true, sort: r => ins(r.key).buy_6m, html: r => insAmt(r.key, 'buy')},
  sell: {id: 'isell', label: 'Verkäufe<span class="hm"> 6 Mon.</span>', cls: 'r', num: true, sort: r => ins(r.key).sell_6m, html: r => insAmt(r.key, 'sell')},
  last: {id: 'ilast', label: 'Zuletzt', cls: 'r hm', sort: r => ((ins(r.key).rows || [])[0] || {}).d || null, html: r => { const x = (ins(r.key).rows || [])[0];
    return x ? `<div class="num">${dShort(x.d)}</div><div class="ts">${x.type === 'buy' ? 'Kauf' : 'Verkauf'}</div>` : '<span class="ts">–</span>'; }},
};
const insRow = (key, r, sym) => `<${sym ? `button data-act="open" data-key="${esc(key)}"` : 'div'} class="row"><div class="l"><div class="t">${sym ? tag(key) : ''}<span${sym ? '' : ' style="margin:0;color:var(--ink)"'}>${esc(r.who)}</span></div>
  <div class="m">${esc(roleDe(r.role))} · ${dateDe(r.d)}${r.shares ? ` · <span class="num">${nf(r.shares, 0)}</span> Aktien` : ''}</div></div>
  <div class="r"><span class="chip ${r.type === 'buy' ? 'good' : 'bad'}">${r.type === 'buy' ? 'Kauf' : 'Verkauf'}</span><div class="v num" style="margin-top:3px">${amt(key, r.value)}</div></div></${sym ? 'button' : 'div'}>`;

function sectorCard(c) {
  const m = sectorMix(c), sb = S.daily.sector_bench || {}, names = Object.keys(sb), bn = names.includes(S.secb) ? S.secb : names[0], bw = sb[bn] || {};
  if (!m.eq) return card('Sektoren', '', '<p class="empty">Noch keine Aktien oder Aktien-ETFs im Depot.</p>', '', 'span12');
  const rows = [...new Set([...Object.keys(m.by), ...Object.keys(bw)])].map(s => ({s, me: (m.by[s] || 0) / m.eq * 100, ix: bw[s] != null ? bw[s] * 100 : null}))
    .sort((a, b) => b.me - a.me || (b.ix || 0) - (a.ix || 0));
  const mx = Math.max(...rows.map(r => Math.max(r.me, r.ix || 0))) || 1, pct = v => v == null ? '–' : nf(v, 1) + ' %';
  const diff = r => r.ix == null ? '–' : (r.me - r.ix >= 0 ? '+' : '−') + nf(Math.abs(r.me - r.ix), 1);
  const body = `<div class="secrows"><div class="sechead"><span>Branche</span><span class="hm"></span><span class="r">Du</span><span class="r"><span class="hm">${esc(bn || 'Index')}</span><span class="hd">Index</span></span><span class="r"><span class="hm">Unterschied</span><span class="hd">±</span></span></div>
    ${rows.map(r => { const parts = (m.parts[r.s] || []).sort((a, b) => b.v - a.v);
      return `<details><summary title="${esc(SECTOR_DE[r.s] || r.s)}: du ${pct(r.me)}${r.ix != null ? `, ${esc(bn)} ${pct(r.ix)}` : ''}"><span class="nm">${esc(SECTOR_DE[r.s] || r.s)}</span>
        <span class="sbar"><i style="width:${(r.me / mx * 100).toFixed(1)}%"></i>${r.ix != null ? `<b style="left:${(r.ix / mx * 100).toFixed(1)}%"></b>` : ''}</span>
        <span class="r num">${pct(r.me)}</span><span class="r num muted">${pct(r.ix)}</span><span class="r num">${diff(r)}<span class="hm"> Pkt.</span></span></summary>
        ${parts.length ? `<div class="secparts">${parts.slice(0, 10).map(p => `<button data-act="open" data-key="${esc(p.key)}">${tag(p.key)}<span class="ts">${p.via ? 'über den ETF' : esc(tick(p.key))}</span><span class="num">${eur(p.v, 0)}</span></button>`).join('')}
          ${parts.length > 10 ? `<p class="hint">und ${parts.length - 10} weitere</p>` : ''}</div>` : '<p class="hint" style="margin:0 0 10px">In deinem Depot nicht vertreten.</p>'}</details>`; }).join('')}</div>`;
  const out = Object.entries(m.outside).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${nf(v / m.total * 100, 1)} %`).join(', ');
  const legend = `<div class="seclegend"><span><i class="me"></i>Dein Depot</span>${bn ? `<span><i class="ix"></i>${esc(bn)}</span>` : ''}</div>`;
  return card('Sektoren', `Aktien und Aktien-ETFs, zusammen ${nf(m.eq / m.total * 100, 0)} % des Depots. ETFs sind nach ihrem Inhalt aufgeteilt.`,
    body + `<p class="hint">Zeile antippen zeigt, welche Titel in der Branche stecken. Unterschied in Prozentpunkten.${out ? ' Nicht enthalten: ' + esc(out) + ' des Depots.' : ''}</p>`,
    `<div class="headr">${legend}${names.length > 1 ? seg('secb', names, bn) : ''}</div>`, 'span12');
}
/* Stimmung: Reddit (ApeWisdom) und Angst-und-Gier für Krypto kommen täglich automatisch. Die Stimmung auf X liefert Grok:
   kostenlos über das eigene Konto (Frage kopieren, Antwort einfügen, gespeichert in portfolio.json → grok) oder mit XAI_API_KEY im Tageslauf. */
const sentCls = s => /bull/i.test(s || '') ? 'good' : /bär|baer|bear/i.test(s || '') ? 'bad' : '';
function grokOf(key) {
  const a = AI(key).grok, p = ((S.pf.grok || {}).assets || {})[key];
  if (!p || !a) return p || a || null;
  return (p.at || '') >= (a.at || '') ? p : a;
}
const FG_DE = {'Extreme Fear': 'Extreme Angst', Fear: 'Angst', Neutral: 'Neutral', Greed: 'Gier', 'Extreme Greed': 'Extreme Gier'};
const GROK_MAX = 35;
const grokParts = c => { const k = insightKeys(c).filter(x => !isFund(x)), out = []; for (let i = 0; i < k.length; i += GROK_MAX) out.push(k.slice(i, i + GROK_MAX)); return out; };
function grokPrompt(keys) {
  const lab = k => { const s = k.split(':')[1], n = nameOf(k); return n && n.toUpperCase() !== s ? `${s} (${n})` : s; };
  const st = keys.filter(k => !isCoin(k)), cr = keys.filter(isCoin), d = new Date();
  return `Heute ist der ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}. Suche auf X und im Web nach der aktuellen Stimmung zu diesen Titeln.
${st.length ? 'Aktien: ' + st.map(lab).join(', ') + '\n' : ''}${cr.length ? 'Kryptowährungen: ' + cr.map(lab).join(', ') + '\n' : ''}
Bewerte je Titel die Stimmung der letzten 48 Stunden und fasse zusammen, worüber gesprochen wird. Schreib auf Deutsch, sachlich und in kurzen Sätzen.
Antworte nur mit JSON, ohne weiteren Text. Als symbol das Kürzel genau wie oben vor der Klammer. Struktur:
{"market_mood": "1 bis 2 Sätze zur Gesamtstimmung", "assets": [{"symbol": "", "sentiment": "bullisch oder neutral oder bärisch", "summary": "1 bis 2 Sätze", "topics": ["2 bis 3 Stichworte"]}]}`;
}
// Antwort von Grok lesen und in portfolio.json → grok ablegen. Gibt die Zahl der erkannten Titel zurück.
function saveGrok(text, c) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('In der Antwort steht kein JSON. Kopiere bitte die ganze Antwort von Grok.');
  let j; try { j = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new Error('Die Antwort ließ sich nicht lesen. Kopiere sie bitte vollständig.'); }
  const all = [...new Set([...(S.pf.watchlist || []).map(w => keyOf(w.kind, w.symbol)), ...c.held.map(p => p.key)])];
  const now = new Date().toISOString(), g = {assets: {}, ...(S.pf.grok || {})}, cut = (x, n) => String(x == null ? '' : x).slice(0, n);
  g.assets = {...g.assets};
  let n = 0;
  (Array.isArray(j.assets) ? j.assets : []).forEach(x => {
    const sym = String((x || {}).symbol || '').toUpperCase().replace(/\s*\(.*$/, '').trim();
    let cand = all.filter(k => k.split(':')[1] === sym);
    if (cand.length > 1 && S.grokKeys) cand = cand.filter(k => S.grokKeys.includes(k));
    if (cand.length !== 1) return;
    g.assets[cand[0]] = {sentiment: /bull/i.test(x.sentiment) ? 'bullisch' : /bär|baer|bear/i.test(x.sentiment) ? 'bärisch' : 'neutral', summary: cut(x.summary, 400),
      topics: (Array.isArray(x.topics) ? x.topics : []).slice(0, 4).map(t => cut(t, 40)), at: now};
    n++;
  });
  if (!n) throw new Error('In der Antwort steht keiner deiner Titel.');
  if (j.market_mood) g.market_mood = cut(j.market_mood, 500);
  g.at = now; S.pf.grok = g;
  return n;
}
const SCOL = {
  x: {id: 'x', label: 'Auf X', cls: 'c-x', num: true, sort: r => { const g = grokOf(r.key); return g ? ({bad: 0, '': 1, good: 2})[sentCls(g.sentiment)] : null; }, html: r => { const g = grokOf(r.key); return g ? `<span class="chip ${sentCls(g.sentiment)}">${esc(g.sentiment)}</span><div class="ts">${esc(ago(g.at))}</div>` : '<span class="ts">–</span>'; }},
  about: {id: 'about', label: 'Worüber gesprochen wird', cls: 'hm c-about', html: r => { const g = grokOf(r.key); return g && g.summary ? `<div class="ab">${esc(g.summary)}</div>` : '<span class="ts">–</span>'; }},
  rd: {id: 'rd', label: 'Reddit 24 Std.', cls: 'r', num: true, sort: r => (D(r.key).reddit || {}).mentions, html: r => { const x = D(r.key).reddit; return x ? `<div class="num">${nf(x.mentions, 0)}</div><div class="ts num">Vortag ${nf(x.prev, 0)}</div>` : '<span class="ts">–</span>'; }},
};
function moodCard(keys, sw) {
  const c = calc(), fg = S.daily.crypto_fg, g = S.pf.grok || {}, parts = grokParts(c);
  const rows = keys.filter(k => !isFund(k) && (grokOf(k) || D(k).reddit)).map(key => ({key}));
  const none = keys.filter(k => !isFund(k)).length - rows.length;
  const fgBox = fg ? `<div class="fgbox"><div class="l">Krypto: Angst und Gier</div><div class="v num">${fg.value}<span>${esc(FG_DE[fg.label] || fg.label)}</span></div>
    <div class="fgbar" role="img" aria-label="${fg.value} von 100"><b style="left:${Math.max(0, Math.min(100, fg.value))}%"></b></div><div class="fgax"><span>Angst</span><span>Gier</span></div>
    ${fg.prev != null ? `<div class="n">Gestern ${fg.prev}</div>` : ''}</div>` : '';
  const grokBox = `<div class="grokbox"><div class="gt"><b>Stimmung auf X über Grok, kostenlos</b>${g.at ? `<span class="ts">Zuletzt ${esc(ago(g.at))}</span>` : ''}</div>
    <ol><li>Frage kopieren. Grok öffnet sich in einem neuen Fenster.</li><li>Dort einfügen und absenden. Das geht mit deinem kostenlosen X- oder Grok-Konto.</li><li>Groks ganze Antwort kopieren, hier einfügen und speichern.</li></ol>
    <div class="btnrow" style="margin-top:10px">${parts.map((p, i) => `<button class="btn" data-act="grokcopy" data-v="${i}">Frage kopieren${parts.length > 1 ? ` (Teil ${i + 1} von ${parts.length})` : ''}</button>`).join('')}</div>
    <textarea id="grokans" rows="3" placeholder="Antwort von Grok hier einfügen" aria-label="Antwort von Grok"></textarea>
    <div class="btnrow" style="margin-top:8px"><button class="btn ghost" data-act="groksave">Antwort speichern</button></div></div>`;
  return card('Stimmung', 'Was auf X und Reddit über deine Titel gesagt wird. Ohne Kosten.', `<div class="moodtop${fgBox ? '' : ' one'}">${fgBox}${grokBox}</div>
    ${g.market_mood ? `<div class="note"><b>Grok zur Gesamtstimmung</b> (${esc(ago(g.at))}): ${esc(g.market_mood)}</div>` : ''}
    ${rows.length ? `<div style="margin-top:14px">${tbl('mood', [COL.name, SCOL.x, SCOL.about, SCOL.rd], rows, ['rd', -1])}</div>` : '<p class="empty" style="margin-top:12px">Noch keine Stimmung für diese Auswahl.</p>'}
    <p class="hint">Reddit: wie oft ein Titel in 24 Stunden in den großen Börsen-Foren genannt wurde (ApeWisdom, täglich, nur US-Kürzel und Coins).${none > 0 ? ` ${none} Titel ohne Daten.` : ''} Viel Gerede heißt nicht, dass ein Kurs steigt. Stimmung ist kein Kaufgrund. Keine Anlageberatung.</p>`, sw, 'span12');
}
const insightKeys = c => [...new Set(fltOn('ein', 'Depot') === 'Depot' ? c.held.filter(p => p.value > 0).map(p => p.key) : (S.pf.watchlist || []).map(w => keyOf(w.kind, w.symbol)))];
/* ---------------------------------------------------------------- Strategie Wachstums-Momentum (Jakobs Wunsch vom 27.11.2026)
   Reiter Heute, Regeln, Kandidaten, Backtest, Profil. Rechnungen in app.js (idealBook, ruleOf, stopOf), Rangfolge und
   Ideal-Depot als Modell in tracker/screen.py (screen.json), Backtest und Recherche in backtest.json (tracker/backtest.py). */
const rsBadge = (r, cls = '') => !r || r.rs == null ? '<span class="score none">–</span>' : `<span class="score t${tierOf(Math.max(1, Math.ceil(r.rs / 10)))} ${cls}" title="Stärke ${r.rs} von 99: relative Stärke wie bei IBD">${r.rs}</span>`;
const stIcon = st => `<span class="st ${st}">${{ok: '✓', warn: '!', bad: '✕', info: 'i', open: '?'}[st] || ''}</span>`;
function questionsCard() {
  const open = QUESTIONS.filter(q => ansOf(q.id) == null), done = QUESTIONS.filter(q => ansOf(q.id) != null);
  const qhtml = q => `<div class="qq"><div class="qt">${esc(q.q)}${q.lesson ? ' <span class="chip warn">Lehre aus FTX</span>' : ''}</div>${q.why ? `<div class="qw">${esc(q.why)}</div>` : ''}
    <div class="qo">${q.o.map(([v, l]) => `<button class="pillbtn ${String(ansOf(q.id)) === String(v) ? 'on' : ''}" data-act="ans" data-id="${q.id}" data-v="${esc(String(v))}">${esc(l)}</button>`).join('')}</div></div>`;
  return card('Fragen an dich', open.length ? `${open.length} offen · jede Antwort wirkt sofort auf Ideal-Depot und Regeln` : 'Alle beantwortet · du kannst jede Antwort ändern',
    `${open.slice(0, 4).map(qhtml).join('')}${open.length > 4 ? `<p class="hint">Noch ${open.length - 4} weitere Fragen, sobald diese beantwortet sind.</p>` : ''}
    <details class="qdone"><summary>Deine Antworten (${done.length})</summary>${done.map(qhtml).join('')}</details>`, '', 'span5');
}
const rcMode = () => S.rcm || (Object.keys(jakobHeld()).length ? 'depot' : 'ideal');
const ruleRows = rows => `<div class="rules">${rows.map(r => `<div class="rule">${stIcon(r.state)}<div><b>${esc(r.title)}</b><div class="x">${esc(r.text)}</div></div></div>`).join('')}</div>`;
function checkCard() {
  const mode = rcMode(), rc = ruleCheck(mode);
  const body = rc.rows.length ? ruleRows(rc.rows) : '<p class="empty">Keine Positionen für diese Auswahl.</p>';
  return card('Regel-Check', 'Ideal-Depot oder Depot Jakob gegen dein Profil', body + `<p class="hint">Gezählt werden Aktien und Länder-ETFs der Regel${ansOf('etf') === 'base' ? ', dazu deine ETFs' : ''}${ansOf('crypto') === 'part' ? ' und Krypto' : ''}. Hauptdepot und Fenja zählen nicht mit. Keine Anlageberatung.</p>`,
    seg('rcm', ['Ideal-Depot', 'Depot Jakob'], mode === 'ideal' ? 'Ideal-Depot' : 'Depot Jakob'), 'span7');
}
function guardCard() {
  const g = guardRails(ruleCheck(rcMode()));
  return card('Leitplanken', 'Erwartungswert ja, Totalverlust nein', ruleRows(g) + `
    <p class="hint">Sam Bankman-Fried (FTX, Alameda) entschied nach dem Erwartungswert: Er setzte auf alles, was im Schnitt mehr bringt, auch wenn ein Totalverlust möglich war, und wollte mehr setzen, als das Kelly-Maß erlaubt. Dazu kamen Hebel, Geld der Kunden und wenig Prüfung vor Beteiligungen. 2023 wurde er wegen Betrugs verurteilt. Seine Fehler stehen hier als Regeln.</p>`, '', 'span5');
}
function playCard() {
  const pb = playbook(ruleCheck(rcMode()));
  return card('Wenn … dann', 'Deine Regeln und was davon heute zutrifft', `<div class="rules">${pb.map(r => `<div class="rule ${r.on ? 'on' : ''}">${stIcon(r.on ? 'warn' : 'ok')}<div><b>Wenn ${esc(r.when)}</b><div class="x">Dann: ${esc(r.then)}</div>${r.now ? `<div class="m">Heute: ${esc(r.now)}</div>` : ''}</div></div>`).join('')}</div>
    <p class="hint">Gelb heißt: trifft gerade zu. Keine Anlageberatung.</p>`, '', 'span12');
}
// Kandidaten: die stärksten Titel im Aufwärtstrend (screen.json → list), dazu Depot Jakob und Watchlist
const idxTxt = r => r.market ? 'Schwellenland' : r.idx === 'sp,ndx' ? 'S&P 500 · Nasdaq-100' : r.idx === 'ndx' ? 'Nasdaq-100' : r.idx === 'sp' ? 'S&P 500' : r.idx === 'welt' ? (r.land || 'Ausland') + ' · MSCI ACWI' : 'nicht in der Auswahl';
const trendTxt = r => r.trend ? 'Aufwärtstrend' : r.p200 != null && r.p200 < 0 ? 'unter der 200-Tage-Linie' : '50 unter 200';
function candCard() {
  const sc = S.screen || {}, all = sc.rule === RULE_V ? sc.list || [] : [];
  if (!all.length) return card('Kandidaten', 'Die stärksten Aktien im Aufwärtstrend', '<p class="empty">Der Filter läuft mit dem nächsten Tageslauf.</p>', '', 'span12');
  const ib = idealBook() || {n: 7, items: []}, held = new Set(Object.keys(jakobHeld())), plan = new Set(ib.items.map(x => x.key));
  const watch = new Set((S.pf.watchlist || []).map(w => keyOf(w.kind, w.symbol)));
  const fl = ['Stärkste', 'Neu für dich', 'Watchlist', 'Länder'].includes(S.scf) ? S.scf : 'Stärkste';
  let xs = all.filter(r => fl === 'Watchlist' ? watch.has(r.key) : fl === 'Länder' ? r.market : fl === 'Neu für dich' ? r.rank && !held.has(r.key) && !plan.has(r.key) : !!r.rank);
  xs.sort((a, b) => (a.rank || 999) - (b.rank || 999) || (b.rs || 0) - (a.rs || 0));
  const more = xs.length > 15 && !S.scAll; if (more) xs = xs.slice(0, 15);
  const tagOf = k => held.has(k) ? '<span class="chip">im Depot Jakob</span>' : plan.has(k) ? '<span class="chip blue">im Ideal-Depot</span>' : '';
  const bar = (l, v, mx) => `<div class="fb"><span>${l}</span><i><b style="width:${Math.max(0, Math.min(100, (v || 0) / mx * 100))}%${v < 0 ? ';background:var(--down)' : ''}"></b></i><em class="num">${v == null ? '–' : pctS(v, 0)}</em></div>`;
  const rows = xs.map(r => {
    const open = S.scx === r.key, tracked = !!(D(r.key).hist || A(r.key).price), mx = Math.max(10, ...[r.r3, r.r6, r.r9, r.r12].map(v => Math.abs(v || 0)));
    return `<tr data-act="scx" data-key="${esc(r.key)}" class="${open ? 'open' : ''}"><td>${rsBadge(r)}</td><td>${nameCell(r.key, r.market ? 'Länder-ETF' : r.sector || '', ruleTag(r.key))} ${tagOf(r.key)}</td>
      <td class="r num">${r.rank || '–'}</td><td class="r num ${sign(r.r3)}">${r.r3 == null ? '–' : pctS(r.r3, 0)}</td><td class="r num hm ${sign(r.r12)}">${r.r12 == null ? '–' : pctS(r.r12, 0)}</td>
      <td class="r num hm">${r.from_high == null ? '–' : pctS(r.from_high, 0)}</td><td class="r num hm">${r.rev_g == null ? '–' : pctS(r.rev_g, 0)}</td><td class="r">${chgA(r.chg5)}</td></tr>
      ${open ? `<tr class="xrow"><td colspan="8"><div class="cx"><div><p class="sh" style="margin-top:0">Rendite mit Dividenden${r.cur ? ' in Dollar' : ''} (Gewicht in der Stärke)</p><div class="fbars wide">${bar('3 Monate (40 %)', r.r3, mx)}${bar('6 Monate (20 %)', r.r6, mx)}${bar('9 Monate (20 %)', r.r9, mx)}${bar('12 Monate (20 %)', r.r12, mx)}</div>
        <ul class="dots" style="margin-top:10px"><li>${esc(idxTxt(r))}${r.industry ? ' · ' + esc(r.industry) : ''}</li>${r.rev_g != null ? `<li>Umsatz ${pctS(r.rev_g, 0)} zum Vorjahr${r.est90 != null ? `, Gewinnschätzung ${pctS(r.est90, 0)} in 90 Tagen` : ''}</li>` : ''}${r.earnings ? `<li>Quartalszahlen ${dateDe(r.earnings)}</li>` : ''}</ul></div>
        <div><p class="sh" style="margin-top:0">Aufwärtstrend</p><div class="rules">${[[r.p200 > 0, 'Kurs über der 200-Tage-Linie', pctS(r.p200, 0)], [r.p50 < r.p200, '50-Tage-Linie über der 200-Tage-Linie', ''], [r.rank && r.rank <= ib.n, `Unter den ${ib.n} stärksten im Aufwärtstrend`, r.rank ? 'Rang ' + r.rank : '']].map(([ok, t, x]) => `<div class="rule">${stIcon(ok ? 'ok' : 'bad')}<div><b>${t}</b>${x ? `<div class="x">${x}</div>` : ''}</div></div>`).join('')}</div>
        <div class="btnrow" style="margin-top:12px">${tracked ? `<button class="btn sm" data-act="open" data-key="${esc(r.key)}">Details</button>` : ''}${watch.has(r.key) || held.has(r.key) ? '' : `<button class="btn sm ghost" data-act="scwatch" data-key="${esc(r.key)}">Auf die Watchlist</button>`}</div></div></div></td></tr>` : ''}`;
  }).join('');
  const b = sc.breadth || {}, m = sc.members || {};
  const empty = !xs.length ? `<p class="empty">${fl === 'Länder' ? 'Kein Länder-ETF unter den stärksten Titeln im Aufwärtstrend.' : fl === 'Watchlist' ? 'Keine Aktie deiner Watchlist in der Auswahl.' : 'Keine Titel in dieser Auswahl.'}</p>` : '';
  return card('Kandidaten', `Die stärksten im Aufwärtstrend aus ${m.sp || 500} Aktien des S&P 500, ${m.ndx || 100} des Nasdaq-100, ${m.welt != null ? m.welt + ' aus Europa, China und Hongkong' : 'Europa, China und Hongkong'} und ${m.markets || 18} Länder-ETFs · ${b.trend || '–'} von ${b.n || '–'} im Aufwärtstrend · ${stampDe(sc.updated)}`,
    `<div class="tblwrap"><table class="tbl cand"><thead><tr><th>Stärke</th><th>Titel</th><th class="r">Rang</th><th class="r">3 Mon.</th><th class="r hm">12 Mon.</th><th class="r hm">vom Hoch</th><th class="r hm">Umsatz</th><th class="r">5 Tage</th></tr></thead><tbody>${rows}</tbody></table></div>${empty}
    ${more ? `<div class="btnrow"><button class="btn sm ghost" data-act="scall">Alle zeigen</button></div>` : ''}
    <p class="hint">Stärke 1 bis 99: Rang der relativen Stärke unter allen Titeln der Auswahl, wie das RS-Rating von IBD. Gerechnet aus der Rendite mit Dividenden: 3 Monate zählen 40 %, 6, 9 und 12 Monate je 20 %. Rang: Platz unter den Titeln im Aufwärtstrend (Kurs über der 200-Tage-Linie, 50-Tage-Linie darüber); die ersten ${ib.n} bilden das Ideal-Depot. Umsatz: Wachstum zum Vorjahr, nur zur Info, die Regel braucht ihn nicht. Zeile antippen für Details. Eine Auswahl, keine Kaufempfehlung. Keine Anlageberatung.</p>`,
    seg('scf', ['Stärkste', 'Neu für dich', 'Watchlist', 'Länder'], fl), 'span12');
}
/* ---------------------------------------------------------------- Backtest und Recherche (Jakobs Wunsch vom 26. und 27.11.2026)
   backtest.json (tracker/backtest.py): bekannte Strategien von Hedgefonds und Wachstums-Investoren, nachgebaut und über 10 Jahre
   getestet, mit S&P 500, Nasdaq-100 und MSCI ACWI (Europa, China, Hongkong) so, wie sie damals zusammengesetzt waren. Ansichten S.btv. Diagramm #ch-bt. */
const pc = (v, d = 0) => v == null ? '–' : pctS(v, d);
const btMain = b => (b.strategies || []).find(x => x.id === (stopPct() ? 'best_stop' : 'best')) || (b.strategies || [])[0];
const GRP = {vorlage: 'Vorlage', bisher: 'bisher', index: 'Index'};
const grpChip = x => x.id === (stopPct() ? 'best_stop' : 'best') ? ' <span class="chip good">deine Regel</span>' : GRP[x.group] ? ` <span class="chip">${GRP[x.group]}</span>` : '';
function btResult(b) {
  const te = b.period.train_end.slice(0, 4), ids = ['best', 'best_stop', 'prev27', 'calm', 'qg', 'jakob', 'QQQ', 'SPY'], S2 = Object.fromEntries(b.strategies.map(x => [x.id, x]));
  const rows = ids.map(id => S2[id]).filter(Boolean).map(x => `<tr class="${x.id === btMain(b).id ? 'strong' : ''}"><td><b>${esc(x.name)}</b>${grpChip(x)}<div class="ts hm">${esc(x.desc || '')}</div></td>
    <td class="r num">${pc(x.cagr, 1)}</td><td class="r num hm">${x.min === x.max ? '–' : `${nf(x.min, 1)} bis ${nf(x.max, 1)}`}</td><td class="r num">${pc(x.dd)}</td><td class="r num hm">${pc(x.train, 1)}</td><td class="r num hm">${pc(x.test, 1)}</td></tr>`).join('');
  return `<div class="btf">${(b.findings || []).map(f => `<div><b>${esc(f.t)}</b><p>${esc(f.x)}</p></div>`).join('')}</div>
    <p class="sh">Aus 10.000 $ seit ${dateDe(b.period.start)}</p><div class="chart" id="ch-bt"></div><div id="lg-bt"></div>
    <div class="tblwrap"><table class="tbl bt"><thead><tr><th>Regeln</th><th class="r">pro Jahr</th><th class="r hm">je nach Stichtag</th><th class="r">größter Rückgang</th><th class="r hm">bis ${te}</th><th class="r hm">ab ${te}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Pro Jahr und Rückgang: Schnitt aus ${b.offsets || 6} Stichtagen rund ums Monatsende (15 Handelstage davor bis 10 danach), weil der Tag im Monat mehrere Prozentpunkte ausmacht. „Bis ${te}“ und „ab ${te}“: die beiden Hälften des Zeitraums; übernommen wurde nur, was in beiden besser war.</p>`;
}
function btStrats(b) {
  const te = b.period.train_end.slice(0, 4), xs = b.strategies.slice().sort((a, c) => c.cagr - a.cagr);
  const rows = xs.map(x => `<tr class="${x.id === btMain(b).id ? 'strong' : ''}"><td><b>${esc(x.name)}</b>${grpChip(x)}<div class="ts">${esc(x.desc || '')}</div></td>
    <td class="r num">${pc(x.cagr, 1)}</td><td class="r num">${pc(x.dd)}</td><td class="r num hm">${pc(x.train, 1)}</td><td class="r num hm">${pc(x.test, 1)}</td><td class="r num hm">${x.trades ? nf(x.trades / (b.years || 10), 0) : '–'}</td></tr>`).join('');
  return `<p class="body small" style="margin-top:0">Alle Strategien mit denselben Bedingungen: 7 Titel, gleich gewichtet, Prüfung zum Monatsende, 0,1 % Kosten je Kauf und Verkauf, in Dollar mit Dividenden. Nachgebaut nach den Veröffentlichungen ihrer Erfinder, vereinfacht auf frei verfügbare Daten (Kurse von Yahoo, Umsatz und Gewinn aus den Berichten an die SEC ab dem Tag der Veröffentlichung).</p>
    <div class="tblwrap"><table class="tbl bt"><thead><tr><th>Strategie</th><th class="r">pro Jahr</th><th class="r">Rückgang</th><th class="r hm">bis ${te}</th><th class="r hm">ab ${te}</th><th class="r hm">Handel pro Jahr</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Deine Regel verbindet zwei davon, die relative Stärke von William O'Neil (IBD, CAN SLIM) als Rangfolge und den Aufwärtstrend von Mark Minervini als Filter, mit 6 Titeln aus deiner Quality-Growth-Vorlage. Danach alle Stellschrauben einzeln und in Kombination geprüft: ohne Stopp, Gewinner laufen weiter, höchstens 30 % je Titel. Gewählt Schritt für Schritt: Ein Baustein kam nur dazu, wenn er bis ${te} und danach besser war. Die Filter der Vorlage (Wachstum, Qualität, Bewertung), ihre Punkte als Rangfolge und das Warten auf Rücksetzer kosteten viel Rendite: Sie ließen meist nur wenige Aktien übrig.</p>`;
}
function btProbes(b) {
  const rows = (b.probes || []).map(x => `<tr><td><b>${esc(x.name)}</b><div class="ts">${esc(x.note || '')}</div></td><td class="r num">${pc(x.cagr, 1)}</td><td class="r num">${pc(x.dd)}</td><td class="r num hm">${pc(x.train, 1)}</td><td class="r num hm">${pc(x.test, 1)}</td></tr>`).join('');
  const te = b.period.train_end.slice(0, 4), m = btMain(b);
  return `<p class="body small" style="margin-top:0">Gegenproben zu deiner Regel (${pc(m.cagr, 1)} pro Jahr): Was passiert, wenn man einen Baustein ändert? Wo ein anderer Bezug gilt, steht er dabei.</p>
    <div class="tblwrap"><table class="tbl bt"><thead><tr><th>Änderung</th><th class="r">pro Jahr</th><th class="r">Rückgang</th><th class="r hm">bis ${te}</th><th class="r hm">ab ${te}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note" style="margin-top:12px"><b>Grenzen:</b> ${esc((b.limits || []).join(' '))}</div>`;
}
function btYears(b) {
  const S2 = Object.fromEntries(b.strategies.map(x => [x.id, x])), ids = ['best', 'best_stop', 'qg', 'jakob', 'QQQ', 'SPY'].filter(id => S2[id]);
  const ys = Object.keys(S2.best.years || {}).sort();
  return `<div class="tblwrap"><table class="tbl bt"><thead><tr><th>Jahr</th>${ids.map(id => `<th class="r">${esc(S2[id].short || S2[id].name)}</th>`).join('')}</tr></thead>
    <tbody>${ys.map(y => `<tr><td class="num">${y}</td>${ids.map(id => { const v = (S2[id].years || {})[y]; return `<td class="r num ${sign(v)}">${pc(v, 0)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="hint">Rendite je Kalenderjahr mit dem Stichtag Monatsende. ${esc(ys[0])} und ${esc(ys[ys.length - 1])} sind nur Teiljahre.</p>`;
}
function btMix(b) {
  const mx = Math.max(...(b.sectors || []).map(x => x[1]), 1);
  const sec = (b.sectors || []).map(([n, v]) => `<div class="fb"><span>${esc(n)}</span><i><b style="width:${v / mx * 100}%"></b></i><em class="num">${nf(v, 0)} %</em></div>`).join('');
  const held = (b.held || []).map(([sym, months, name]) => `<div class="row"><div class="l"><div class="t">${esc(name || sym)} <span class="muted small">${esc(sym)}</span></div></div><div class="r small num">${months} Monate</div></div>`).join('');
  return `<div class="cx"><div><p class="sh" style="margin-top:0">Branchen im Depot, Anteil der Monate</p><div class="fbars sec">${sec}</div>
    <p class="hint">${nf(b.n_titles || 0, 0)} verschiedene Titel in 10 Jahren. Länder-ETFs durften immer rein und kamen in ${nf(b.market_share || 0, 1)} % der Fälle zum Zug. In ${nf(b.growth_share || 0, 0)} % der Monate wuchs der Umsatz eines gehaltenen Titels um mindestens 15 %: Die stärksten Aktien sind meist schnell wachsende Firmen.</p></div>
    <div><p class="sh" style="margin-top:0">Am längsten gehalten</p><div class="rows tight">${held}</div></div></div>`;
}
function btSources(b) {
  return `<p class="body small" style="margin-top:0">Recherche vom ${dateDe(b.made)}: bekannte Strategien von Hedgefonds und Wachstums-Investoren, ihre Regeln und belegten Ergebnisse. Daten für den Test:</p>
    <ul class="dots">${(b.sources || []).map(s => `<li>${s.url ? `<a href="${esc(safeUrl(s.url) || '#')}" target="_blank" rel="noopener">${esc(s.t)}</a>` : esc(s.t)}${s.x ? ` <span class="muted">· ${esc(s.x)}</span>` : ''}</li>`).join('')}</ul>`;
}
// Ideal-Depot nachgerechnet: das Modell aus screen.json (heutige Auswahl, seit Beginn der Kurse) gegen S&P 500 und Nasdaq-100
function modelCard() {
  const m = (S.screen || {}).ideal || {}, tr = m.track || [];
  if (tr.length < 20) return '';
  const r = (tr[tr.length - 1][1] / tr[0][1] - 1) * 100, sp = benchIndex('SP500', [tr[0][0], tr[tr.length - 1][0]]), nd = benchIndex('NDX', [tr[0][0], tr[tr.length - 1][0]]);
  let peak = 0, dd = 0; for (const [, v] of tr) { peak = Math.max(peak, v); dd = Math.min(dd, (v / peak - 1) * 100); }
  const kpi = (l, v, n, cls = '') => `<div class="sx-kpi"><span>${l}</span><b class="num ${cls}">${v}</b>${n ? `<small>${n}</small>` : ''}</div>`;
  return `<section class="card span12"><div class="head"><div><h2>Ideal-Depot nachgerechnet</h2><p class="sub">Die Regel Tag für Tag seit ${dateDe(dayIso(tr[0][0]))}, mit der heutigen Auswahl</p></div></div>
    <div class="sx-kpis">${kpi('Ideal-Depot', pctS(r, 0), 'seit ' + dateDe(dayIso(tr[0][0])), sign(r))}${sp ? kpi('S&P 500', pctS((sp[1] - 1) * 100, 0), 'ohne Dividenden', sign(sp[1] - 1)) : ''}${nd ? kpi('Nasdaq-100', pctS((nd[1] - 1) * 100, 0), 'ohne Dividenden', sign(nd[1] - 1)) : ''}${kpi('Größter Rückgang', pctS(dd, 0), 'im Zeitraum')}${kpi('Stopps', String((m.stops || []).length), 'ausgelöst')}</div>
    <div class="chart" id="ch-model"></div><div id="lg-model"></div>
    <p class="hint">Mit der heutigen Auswahl zurückgerechnet: Wer heute dazugehört, lief oft vorher gut. Das schönt diese Zahl; ehrlicher ist der Backtest darunter mit der damaligen Zusammensetzung. Ab heute läuft das Modell jeden Tag weiter. Keine Anlageberatung.</p></section>`;
}
function drawModel(el) {
  const tr = ((S.screen || {}).ideal || {}).track || [];
  if (tr.length < 2) return;
  const d = tr.map(x => x[0]), s = [{name: 'Ideal-Depot', color: 'var(--accent)', area: true, pts: tr.map(x => [x[0], (x[1] / tr[0][1] - 1) * 100])}];
  const sp = benchIndex('SP500', d), nd = benchIndex('NDX', d);
  if (nd) s.push({name: 'Nasdaq-100', color: 'var(--s2)', pts: d.map((x, i) => [x, (nd[i] - 1) * 100])});
  if (sp) s.push({name: 'S&P 500', color: 'var(--ink3)', pts: d.map((x, i) => [x, (sp[i] - 1) * 100])});
  lineChart(el, s, {fmt: v => pctS(v, 0), height: 220, label: 'Ideal-Depot nach der Regel gegen die Indizes, in Prozent', hlines: [{y: 0, label: '', color: 'var(--line2)'}]});
  $('#lg-model').innerHTML = legend(s);
}
const BTV = ['Ergebnis', 'Strategien', 'Gegenproben', 'Jahre', 'Streuung', 'Quellen'];
function btCard() {
  const b = S.bt;
  if (b === undefined) { setTimeout(loadBacktest, 0); return card('Backtest: 10 Jahre', 'Wird geladen …', '<p class="empty">Lädt …</p>', '', 'span12'); }
  if (!b || b.rule !== RULE_V) return card('Backtest: 10 Jahre', 'Welche Strategie hätte am meisten gebracht?', '<p class="empty">Noch kein Backtest für Wachstums-Momentum gerechnet.</p>', '', 'span12');
  const v = BTV.includes(S.btv) ? S.btv : 'Ergebnis', fn = {Ergebnis: btResult, Strategien: btStrats, Gegenproben: btProbes, Jahre: btYears, Streuung: btMix, Quellen: btSources}[v];
  return card('Backtest: 10 Jahre', `${dateDe(b.period.start)} bis ${dateDe(b.period.end)} · S&P 500, Nasdaq-100 und die Aktien aus Europa, China und Hongkong im MSCI ACWI so, wie sie damals zusammengesetzt waren, dazu ${b.universe.markets} Länder-ETFs · nur Daten von damals`,
    fn(b) + `<p class="hint">Ohne Steuern. Vergangene Renditen sagen nichts Sicheres über die Zukunft. Keine Anlageberatung.</p>`, seg('btv', BTV, v), 'span12');
}
/* ---------------------------------------------------------------- Strategie, Ansicht „Heute“ (Aufbau vom 24.11.2026, Jakobs Wunsch)
   Depot Jakob (Wert, Lage, Kennzahlen, Diagramm gegen S&P 500 und Nasdaq-100), Plan (Ideal-Depot als Ziel je Titel mit Bestand
   und Wort deiner Regel, daneben die nächsten Schritte), Lage (Prüfungen und Hinweise). Bausteine mit Präfix sx- (app.css). */
function stratState(ib) {
  const b = ib.breadth || {};
  return ib.items.length < ib.n ? ['warn', 'Teilweise Reserve', `Nur ${ib.items.length} Titel sind im Aufwärtstrend vorn. Freie Plätze bleiben Reserve, bis neue Titel in den Trend kommen.`]
    : ['good', 'Wachstums-Momentum', `${b.trend ?? '–'} von ${b.n ?? '–'} Titeln aus S&P 500, Nasdaq-100, Europa, China, Hongkong und den Länder-ETFs sind im Aufwärtstrend. Gehalten werden die ${ib.n} stärksten; getauscht wird zum Monatsende, Gewinner laufen weiter${capPct() ? ` bis ${capPct()} % je Titel` : ''}${stopPct() ? `, sofort verkauft bei −${stopPct()} % vom Hoch seit Kauf` : ''}.`];
}
// Prüfungen „Hat sich Grundlegendes geändert?“: Stopp, Aufwärtstrend, Rang, neue Titel, Quartalszahlen
function stratChecks(ib) {
  const jh = jakobHeld(), keys = Object.keys(jh), nm = k => shortName(k), list = ks => ks.map(nm).join(', '), sr = k => scrRow(k) || {};
  const chk = [], so = Object.fromEntries(keys.map(k => [k, stopOf(k)]));
  const hit = keys.filter(k => so[k] && so[k].hit), near = keys.filter(k => so[k] && so[k].near && !so[k].hit);
  const worst = keys.filter(k => so[k] && so[k].dd != null).sort((a, b) => so[a].dd - so[b].dd)[0];
  chk.push(!stopPct() ? ['info', 'Ohne Stopp', 'Nach deiner Antwort verkauft die Regel nur zum Monatsende.']
    : hit.length ? ['bad', 'Stopp erreicht', `${hit.map(k => `${nm(k)} (${pctS(so[k].dd, 0)})`).join(', ')} unter dem Hoch seit Kauf: nach deiner Regel sofort verkaufen. Der Platz bleibt bis zum Monatsende frei.`]
    : near.length ? ['warn', 'Nahe am Stopp', `${near.map(k => `${nm(k)} ${pctS(so[k].dd, 0)}`).join(', ')} vom Hoch seit Kauf. Verkauft wird ab −${stopPct()} %.`]
    : ['ok', 'Kein Stopp in Sicht', worst ? `Am weitesten unter dem Hoch seit Kauf: ${nm(worst)} ${pctS(so[worst].dd, 0)}. Verkauft wird ab −${stopPct()} %.` : 'Noch keine Kurse seit dem Kauf.']);
  const outside = keys.filter(k => scrRow(k) && !sr(k).member && !hit.includes(k)), broke = keys.filter(k => sr(k).member && sr(k).trend === false && !hit.includes(k));
  if (outside.length) chk.push(['bad', 'Nicht in der Auswahl', `${list(outside)}: nicht in der Auswahl (S&P 500, Nasdaq-100, Europa, China, Hongkong). Nach deiner Regel zum Monatsende (${meTxt()}) verkaufen.`]);
  chk.push(broke.length ? ['bad', 'Aufwärtstrend gebrochen', `${list(broke)}: Kurs unter der 200-Tage-Linie oder 50-Tage-Linie unter der 200-Tage-Linie. Nach deiner Regel zum Monatsende (${meTxt()}) verkaufen.`]
    : ['ok', 'Aufwärtstrend hält', `Alle Titel aus der Auswahl liegen über ihrer 200-Tage-Linie, die 50-Tage-Linie darüber.`]);
  const inIb = new Set(ib.items.map(x => x.key)), outR = keys.filter(k => sr(k).trend && sr(k).member && !inIb.has(k) && !hit.includes(k));
  chk.push(outR.length ? ['warn', `Nicht mehr unter den ${ib.n} stärksten`, `${outR.map(k => `${nm(k)} (Rang ${sr(k).rank || '–'})`).join(', ')}. Nach deiner Regel Tausch zum Monatsende (${meTxt()}), wenn das so bleibt.`]
    : ['ok', `Alle unter den ${ib.n} stärksten`, 'Kein Tausch nötig, solange das bis zum Monatsende hält.']);
  const fresh = ib.items.filter(x => !jh[x.key]);
  if (fresh.length) chk.push(['info', 'Neu im Ideal-Depot', `${fresh.map(x => `${nm(x.key)} (Rang ${x.rank})`).join(', ')}: Kaufen zum Monatsende (${meTxt()}), wenn sie dann noch vorn liegen.`]);
  const d0 = new Date().toISOString().slice(0, 10), d21 = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  const ed = k => sr(k).earnings || D(k).earnings_date || '';
  const soon = keys.filter(k => ed(k) >= d0 && ed(k) <= d21).sort((a, b) => ed(a).localeCompare(ed(b)));
  if (soon.length) chk.push(['info', 'Quartalszahlen bald', soon.map(k => `${nm(k)} am ${dateDe(ed(k))}`).join(', ') + '. Die Regel reagiert erst über Stopp, Trend oder Rang.']);
  const nb = chk.filter(x => x[0] === 'bad').length, nw = chk.filter(x => x[0] === 'warn').length;
  return {chk, head: nb ? ['bad', 'Handeln nach deinen Regeln'] : nw ? ['warn', nw === 1 ? '1 Punkt beobachten' : nw + ' Punkte beobachten'] : ['good', 'Nichts Grundlegendes geändert']};
}
// Nächste Schritte im Depot Jakob: Stopp sofort, Startkäufe oder Rest vom Startbetrag, Tausch zum Monatsende, Monatsrate, Halten
function stratSteps(ib) {
  const jh = jakobHeld(), empty = !Object.keys(jh).length, keys = [...new Set([...ib.items.map(x => x.key), ...Object.keys(jh)])];
  const rs = keys.map(k => ({key: k, r: ruleOf(k)})).filter(x => x.r), grp = w => rs.filter(x => x.r.word === w);
  const lines = xs => `<div class="srows">${xs.map(x => `<button class="srow" data-act="open" data-key="${esc((jh[x.key] && jh[x.key].via ? jh[x.key].via[0] : x.key))}">${tag(x.key)}<b class="num">${x.r.eur ? eur(x.r.eur, 0) : ''}</b></button>`).join('')}</div>`;
  const steps = [], now = grp('Verkaufen').filter(x => x.r.when === 'sofort'), later = grp('Verkaufen').filter(x => x.r.when !== 'sofort');
  if (now.length) steps.push(['Verkaufen', 'sofort, Stopp', lines(now)]);
  // Rest vom Startbetrag (Jakobs Wunsch vom 24.11.2026): Stehen zum Monatsende Käufe an, bezahlen Verkäufe und Rest sie; sonst
  // werden fehlende Titel und Lücken auf gleiches Gewicht in einem Schritt aufgefüllt
  const rest = empty ? 0 : Math.max(0, (+ansOf('capital') || 0) - jakobBook().cost), buys = grp('Kaufen');
  const gaps = !buys.length && !later.length && rest >= ib.minp ? ib.items.map(it => ({key: it.key, gap: Math.max(0, it.eur - ((jh[it.key] || {}).value || 0))})).filter(x => x.gap > 0) : [];
  const gsum = gaps.reduce((a, x) => a + x.gap, 0);
  if (empty && buys.length) steps.push(['Startkäufe', `${buys.length} Titel, je ${eur(ib.items[0].eur, 0)}`, `<div class="tgs">${buys.map(x => tag(x.key)).join('')}</div><p class="small muted" style="margin:6px 0 0">Zum Monatsende (${meTxt()}) kaufen, wie im Backtest. Im Depot „Jakob“ eintragen.</p>`]);
  if (later.length) steps.push(['Verkaufen', 'zum Monatsende, ' + meTxt(), lines(later)]);
  if (!empty && buys.length) steps.push(['Kaufen', 'zum Monatsende, ' + meTxt(), lines(buys) + `<p class="small muted" style="margin:4px 0 0">Je ${eur(ib.items[0].eur, 0)}, gleich gewichtet${later.length || rest >= 1 ? `; bezahlt aus ${later.length ? 'den Verkäufen' : ''}${later.length && rest >= 1 ? ' und ' : ''}${rest >= 1 ? `dem Rest vom Startbetrag (${eur(rest, 0)})` : ''}` : ''}.</p>`]);
  if (gaps.length) steps.push(['Startbetrag auffüllen', `${eur(rest, 0)} offen`, `<div class="srows">${gaps.sort((a, b) => b.gap - a.gap).map(x => `<button class="srow" data-act="open" data-key="${esc(x.key)}">${tag(x.key)}<b class="num">${eur(Math.round(x.gap * Math.min(1, rest / gsum) / 10) * 10, 0)}</b></button>`).join('')}</div><p class="small muted" style="margin:4px 0 0">Auf gleiches Gewicht.</p>`]);
  if (grp('Nachkaufen').length && !gaps.length) steps.push(['Nachkaufen', 'Startbetrag anlegen', lines(grp('Nachkaufen'))]);
  const over = ib.items.filter(it => jh[it.key] && overCap(jh[it.key].value, ib) >= ib.minp / 2);
  if (over.length) steps.push(['Teilverkauf', `über ${capPct()} %, zum Monatsende`, `<div class="srows">${over.map(it => `<button class="srow" data-act="open" data-key="${esc(jh[it.key].via ? jh[it.key].via[0] : it.key)}">${tag(it.key)}<b class="num">−${eur(overCap(jh[it.key].value, ib), 0)}</b></button>`).join('')}</div><p class="small muted" style="margin:4px 0 0">Erlös auf die übrigen Titel verteilen.</p>`]);
  const r = gaps.length || rest >= ib.minp ? null : monthlyRate();   // Monatsrate erst, wenn der Startbetrag angelegt ist
  if (r) steps.push([`Monatsrate ${new Date().toLocaleDateString('de-DE', {month: 'long'})}`, eur(r.m, 0) + (r.reserve ? ` · ${eur(r.reserve, 0)} Reserve` : ''),
    r.pick.length ? `<div class="srows">${r.pick.map(x => `<button class="srow" data-act="open" data-key="${esc(x.key)}">${tag(x.key)}<b class="num">${eur(x.eur, 0)}</b></button>`).join('')}</div>` : `<p class="small muted" style="margin:0">${esc(r.why)}</p>`]);
  if (!grp('Verkaufen').length) steps.push(['Monatsende prüfen', meTxt(), `<p class="small muted" style="margin:0">Rangfolge neu: Was nicht mehr unter den ${ib.n} stärksten im Aufwärtstrend ist, wird getauscht.${capPct() ? ` Titel über ${capPct()} % werden gekürzt.` : ''}</p>`]);
  if (grp('Halten').length) steps.push(['Halten', '', `<div class="tgs">${grp('Halten').map(x => tag(x.key)).join('')}</div>`]);
  return steps;
}
// Diagramm Depot Jakob: seit Kauf (Gewinn in % gegen gleiche Käufe im S&P 500) oder die heutigen Positionen zurückgerechnet
// gegen S&P 500 und Nasdaq-100, in Prozent ab Beginn des Zeitraums
const JK_DAYS = {'1M': 30, '3M': 91, '1J': 365};
const jkRanges = () => ((jakobBook().series || {d: []}).d.length > 1 ? ['Seit Kauf'] : []).concat(Object.keys(JK_DAYS));
const jkRange = () => { const rs = jkRanges(); return rs.includes(S.jkr) ? S.jkr : rs[0] === 'Seit Kauf' && jakobBook().series.d.length >= 5 ? 'Seit Kauf' : '3M'; };
function drawJakob(el) {
  const jb = jakobBook(), r = jkRange();
  let s, label;
  if (r === 'Seit Kauf') {
    const sr = jb.series, at = f => sr.d.map((d, i) => [d, f(i)]);
    s = [{name: 'Depot Jakob', color: 'var(--accent)', area: true, pts: at(i => sr.inv[i] ? (sr.v[i] / sr.inv[i] - 1) * 100 : 0)}];
    if (sr.bench) s.push({name: 'Gleiche Käufe im S&P 500', color: 'var(--ink3)', pts: at(i => sr.inv[i] ? ((sr.as[i] + sr.ks[i]) / sr.inv[i] - 1) * 100 : 0)});
    label = 'Gewinn seit Kauf in Prozent, verglichen mit gleichen Käufen im S&P 500';
  } else {
    const bc = backcast(jb);
    if (!bc || bc.d.length < 2) { el.innerHTML = '<p class="empty">Die Rückrechnung kommt mit der nächsten täglichen Aktualisierung.</p>'; return; }
    const from = bc.d[bc.d.length - 1] - JK_DAYS[r];
    let i0 = bc.d.findIndex(d => d >= from); if (i0 < 0) i0 = 0;
    const d = bc.d.slice(i0), v = bc.v.slice(i0), pct = x => d.map((dd, i) => [dd, (x[i] - 1) * 100]);
    s = [{name: 'Depot Jakob, heutige Positionen', color: 'var(--accent)', area: true, pts: d.map((dd, i) => [dd, v[0] ? (v[i] / v[0] - 1) * 100 : 0])}];
    const sp = benchIndex('SP500', d), nd = benchIndex('NDX', d);
    if (nd) s.push({name: 'Nasdaq-100', color: 'var(--s2)', pts: pct(nd)});
    if (sp) s.push({name: 'S&P 500', color: 'var(--ink3)', pts: pct(sp)});
    label = 'Heutige Positionen mit den Kursen der Vergangenheit zurückgerechnet, in Prozent';
  }
  lineChart(el, s, {fmt: v => pctS(v, 0), height: 220, label, hlines: [{y: 0, label: '', color: 'var(--line2)'}]});
  $('#lg-jk').innerHTML = legend(s);
}
// Karte 1: Depot Jakob auf einen Blick
function stratTop(ib) {
  const jb = jakobBook(), has = jb.held.some(p => p.value > 0), st = stratState(ib), ck = has ? stratChecks(ib).head : null;
  const fg = (marketFg() || {}).value, cap = +ansOf('capital') || 0, b = ib.breadth || {};
  const so = Object.keys(jakobHeld()).map(k => [k, stopOf(k)]).filter(x => x[1] && x[1].dd != null).sort((a, c) => a[1].dd - c[1].dd)[0];
  const kpi = (l, v, n, extra = '') => `<div class="sx-kpi"><span>${l}</span><b class="num">${v}</b>${n ? `<small>${n}</small>` : ''}${extra}</div>`;
  const stamp = S.screen && S.screen.updated ? stampDe(S.screen.updated) : 'heute';
  const lead = has ? `<div class="sx-val num">${eur(jb.value, 0)}</div>
      <div class="sx-chgs"><span class="num ${sign(jb.pnl)}">${eurS(jb.pnl)} · ${pctS(jb.pnlPct, 1)}<small>seit Kauf</small></span><span class="num ${sign(jb.dayEur)}">${pctS(jb.dayPct, 1)}<small>heute</small></span></div>`
    : `<div class="sx-val sm">${esc(st[1])}</div><p class="sx-lead">${esc(st[2])}</p>`;
  const status = ck || [st[0], st[1]];
  const kpis = `<div class="sx-kpis">
      ${cap ? kpi('Angelegt', `${eur(jb.cost || 0, 0)}<small> / ${eur(cap, 0)}</small>`, `Startbetrag, ${nf(Math.min(100, (jb.cost || 0) / cap * 100), 0)} %`, `<i class="sx-bar"><i style="width:${Math.min(100, (jb.cost || 0) / cap * 100)}%"></i></i>`) : ''}
      ${kpi('Im Aufwärtstrend', `${b.trend ?? '–'}<small> / ${b.n ?? '–'}</small>`, b.n ? `${nf(b.trend / b.n * 100, 0)} % der Auswahl` : '')}
      ${kpi('Stopp-Abstand', so ? `<span class="${so[1].near ? 'neg' : ''}">${pctS(so[1].dd, 0)}</span>` : '–', so ? `${esc(shortName(so[0]))}, Stopp bei −${stopPct() || '–'} %` : 'vom Hoch seit Kauf')}
      ${kpi('Stimmung', `<span class="${fg != null && fg < FEAR ? 'neg' : ''}">${fg ?? '–'}</span>`, fg == null ? '' : fg < FEAR ? 'extreme Angst' : fg < 45 ? 'Angst' : fg <= 55 ? 'neutral' : 'Gier')}
      ${kpi('Nächste Prüfung', meTxt(), 'zum Monatsende')}</div>`;
  const chart = has ? `<div class="sx-charthead"><h3>Wertentwicklung</h3>${seg('jkr', jkRanges(), jkRange())}</div><div class="chart" id="ch-jk"></div><div id="lg-jk"></div>` : '';
  return `<section class="card span12 sx-top"><div class="sx-row"><div><div class="eyebrow">Depot Jakob · Stand ${stamp}</div>${lead}</div>
      <span class="sx-status"><i class="sdot ${status[0]}"></i>${esc(status[1])}</span></div>${kpis}${chart}</section>`;
}
// Karte 2: Plan – Ideal-Depot als Ziel je Titel mit Bestand und Wort deiner Regel, daneben die nächsten Schritte
function planCard(ib) {
  const jh = jakobHeld(), st = stratState(ib), keys = [...new Set([...ib.items.map(x => x.key), ...Object.keys(jh)])];
  const m = S.bt && S.bt.rule === RULE_V ? btMain(S.bt) : null;
  const meta = `Ideal-Depot: ${ib.items.length} Titel · je ${ib.items.length ? eur(ib.items[0].eur, 0) : '–'} · ${nf(ib.share * 100, 0)} % investiert${ib.reserve >= 0.005 ? ' · ' + eur(ib.base * ib.reserve, 0) + ' Reserve' : ''}${m ? ` · im Backtest ${pctS(m.cagr, 0)} pro Jahr, Rückgang ${pctS(m.dd, 0)}` : ''}`;
  const rows = keys.map(k => {
    const it = ib.items.find(x => x.key === k), h = jh[k], r = ruleOf(k) || {}, sr = scrRow(k) || {}, show = h && h.via ? h.via[0] : k;
    const v = h ? h.value : 0, tgt = it ? it.eur : 0, fill = tgt ? Math.min(1, v / tgt) : 1;
    const pnl = h && h.cost ? (h.value / h.cost - 1) * 100 : null, day = h && h.dayEur != null && h.value - h.dayEur > 0 ? h.dayEur / (h.value - h.dayEur) * 100 : null;
    const sub = [sr.market ? 'Länder-ETF' : sr.sector, it ? `Rang ${it.rank}` : sr.rank ? `Rang ${sr.rank}` : sr.member === false ? 'nicht in der Auswahl' : 'kein Aufwärtstrend'].filter(Boolean).join(' · ');
    return `<button class="sx-prow" data-act="open" data-key="${esc(show)}">${rsBadge(sr.rs != null ? sr : null)}${logo(show)}
      <span class="sx-pn"><b>${esc(shortName(k))}</b><small class="d">${esc(sub)}</small><small class="m">${r.word ? `<span class="rw ${r.cls}">${r.word}</span> · ` : ''}${h ? `<span class="${sign(day)}">${pctS(day, 1)}</span> heute` : esc(sub)}</small></span>
      <span class="sx-pw">${r.word ? `<span class="chip ${r.cls}" title="${esc((r.why || []).join(' · '))}">${r.word}</span>` : ''}</span>
      <span class="sx-pc num ${sign(day)}">${h ? pctS(day, 1) : '–'}</span><span class="sx-pc num ${sign(pnl)}">${h ? pctS(pnl, 1) : '–'}</span>
      <span class="sx-pv num"><b>${h ? eur(v, 0) : 'offen'}</b><small class="d">${tgt ? 'Ziel ' + eur(tgt, 0) : 'kein Ziel'}</small><small class="m">${h ? `<span class="${sign(pnl)}">${pctS(pnl, 1)}</span> seit Kauf` : tgt ? 'Ziel ' + eur(tgt, 0) : ''}</small><i class="sx-bar${it ? '' : ' off'}"><i style="width:${fill * 100}%"></i></i></span></button>`;
  }).join('');
  const done = ib.items.filter(x => jh[x.key]).length;
  const alloc = ib.items.length ? `<div class="sx-alloc" role="img" aria-label="${done} von ${ib.items.length} Titeln gekauft">${ib.items.map(it => `<i title="${esc(shortName(it.key))}: ${eur((jh[it.key] || {}).value || 0, 0)} von ${eur(it.eur, 0)}"><b style="width:${Math.min(100, ((jh[it.key] || {}).value || 0) / it.eur * 100)}%"></b></i>`).join('')}${ib.reserve >= 0.005 ? `<i class="res" style="flex:${ib.reserve / (ib.items[0].w || 1)}" title="Reserve ${nf(ib.reserve * 100, 0)} %"></i>` : ''}</div>
    <div class="sx-allocl"><span>${done} von ${ib.items.length} Titeln im Depot</span><span>je Feld ein Titel, gefüllt = Bestand am Ziel</span></div>` : '';
  const steps = stratSteps(ib);
  return `<section class="card span12 sx-plan"><div class="sx-cols"><div class="sx-main">
      <div class="head"><div><h2>Plan</h2><p class="sub">${esc(meta)}</p></div><span class="sx-mode"><i class="sdot ${st[0]}"></i>${esc(st[1])}</span></div>
      <p class="sx-lead">${esc(st[2])}</p>${alloc}
      ${keys.length ? `<div class="sx-th"><span>Titel</span><span>Deine Regel</span><span class="r">Heute</span><span class="r">Seit Kauf</span><span class="r">Bestand / Ziel</span></div><div class="sx-plist">${rows}</div>`
        : '<p class="empty">Gerade leer: kein Titel im Aufwärtstrend vorn. Das Geld bleibt Reserve.</p>'}</div>
    <div class="sx-side"><h3>Nächste Schritte</h3><ol class="steps">${steps.map((x, i) => `<li><span class="sn">${i + 1}</span><div><div class="sh2"><b>${x[0]}</b>${x[1] ? `<span>${x[1]}</span>` : ''}</div>${x[2]}</div></li>`).join('')}</ol></div></div></section>`;
}
// Karte 3: Lage – Prüfungen links, Hinweise rechts. Hinweise nach Art: Info, Deine Regel, Warnung, Handeln
function evLevel(e) {
  if (e.type === 'stop' || (e.type === 'rule' && /Verkaufen/.test(e.text))) return ['act', 'Handeln'];
  if (['rule', 'monat', 'neu', 'ideal'].includes(e.type)) return ['rule', 'Deine Regel'];
  if (e.type === 'istop') return ['warn', 'Warnung'];
  return ['info', 'Info'];
}
function lageCard(ib) {
  const has = Object.keys(jakobHeld()).length, ck = has ? stratChecks(ib) : null, sc = S.screen || {}, ev = (sc.rule === RULE_V ? sc.events || [] : []).slice(0, 12);
  const evRow = e => { const [cls, lbl] = evLevel(e), own = /^(fg|depot|ideal):/.test(e.key);
    return `<${own ? 'div' : `button data-act="${D(e.key).hist ? 'open' : 'scx'}" data-key="${esc(e.key)}"`} class="sx-ev"><div class="sx-evh"><span class="sx-lvl ${cls}">${lbl}</span>${own ? `<b>${esc(e.symbol)}</b>` : tag(e.key)}<span class="sx-evd">${dateDe(e.day)}${e.important ? ' · Push' : ''}</span></div><p>${esc(e.text)}</p></${own ? 'div' : 'button'}>`; };
  const checks = ck ? ruleRows(ck.chk.map(([state, title, text]) => ({state, title, text})))
    : '<p class="empty">Sobald Käufe im Depot Jakob stehen, prüft die App hier Stopp, Aufwärtstrend und Rang.</p>';
  return `<section class="card span12 sx-lage"><div class="sx-cols"><div class="sx-main"><h3>Hat sich Grundlegendes geändert?</h3>${checks}
      <p class="hint">Rechnet alle 15 Minuten mit aktuellen Kursen neu. Gehandelt wird zum Monatsende, nur der Stopp gilt sofort.</p></div>
    <div class="sx-side"><h3>Hinweise</h3>${ev.length ? `<div class="sx-evs">${ev.slice(0, 6).map(evRow).join('')}</div>` : '<p class="empty">Noch keine Hinweise.</p>'}
      <p class="hint">Die letzten Meldungen, Push markiert. Keine Anlageberatung.</p></div></div></section>`;
}
// Reiter der Strategie: Name und darunter, was dort steht
function stratNav(v, open) {
  const b = (S.screen || {}).breadth || {};
  const meta = {Heute: 'Lage und Plan', Regeln: 'Kauf und Verkauf erklärt', Kandidaten: b.trend ? `${b.trend} im Aufwärtstrend` : 'die stärksten Titel', Backtest: '10 Jahre, mit deiner Vorlage', Profil: open ? `${open} ${open === 1 ? 'Frage' : 'Fragen'} offen` : 'Antworten und Regeln'};
  return `<nav class="sx-tabs" role="tablist">${SV.map(x => `<button role="tab" aria-selected="${x === v}" data-act="sv" data-v="${x}" class="${x === v ? 'on' : ''}"><b>${x}</b><small>${esc(meta[x])}</small></button>`).join('')}</nav>`;
}
/* ---------------------------------------------------------------- Reiter „Regeln“ (Jakobs Wunsch vom 25.11.2026)
   So funktioniert deine Strategie: Ablauf (an jedem Tag der Stopp, zum Monatsende Trend und Rang) und ein Beispiel mit echten
   Kursen, wann das Ideal-Depot gekauft und verkauft hat (ruleSim in app.js, Diagramm #ch-rule). */
function ruleFlowCard(key) {
  const ib = idealBook() || {n: 7}, r = key ? scrRow(key) : null, so = key && jakobHeld()[key] ? stopOf(key) : null, stop = stopPct();
  const out = (cls, w, t) => `<span class="rf-out ${cls}"><b>${w}</b>${t ? `<small>${t}</small>` : ''}</span>`;
  const step = (n, q, sub, yes, live) => `<li class="rf-step"><span class="rf-n">${n}</span><div class="rf-q"><b>${q}</b>${sub ? `<small>${sub}</small>` : ''}${live ? `<em>${live}</em>` : ''}</div>
    <div class="rf-yes"><span class="rf-lbl">ja</span><div class="rf-outs">${yes}</div></div></li>`;
  const no = '<li class="rf-no" aria-hidden="true"><span>nein</span></li>';
  let k = 0;
  const nx = () => ++k;
  const b = (S.screen || {}).breadth || {};
  const ladder = `<ol class="rf-ladder">
    ${stop ? step(nx(), `${stop} % unter dem Hoch seit Kauf?`, 'Schlusskurs; gilt sofort, an jedem Tag', out('bad', 'Verkaufen', 'sofort') + out('', 'Platz frei', 'bis zum Monatsende')) + no : ''}
    ${step(nx(), 'Aufwärtstrend gebrochen?', 'Kurs unter der 200-Tage-Linie oder 50-Tage-Linie unter der 200-Tage-Linie', out('bad', 'Verkaufen', 'zum Monatsende') + out('', 'Nicht kaufen', ''), b.n ? `Heute im Aufwärtstrend: ${b.trend} von ${b.n}` : '')}${no}
    ${step(nx(), `Unter den ${ib.n} stärksten?`, 'Rangfolge nach relativer Stärke unter allen Titeln im Aufwärtstrend', out('blue', 'Halten', 'Gewicht läuft weiter') + out('good', 'Kaufen', 'gleicher Betrag je Titel'))}${no}
    <li class="rf-step end"><span class="rf-n">${nx()}</span><div class="rf-q"><b>Sonst</b><small>im Trend, aber nicht vorn genug</small></div><div class="rf-yes"><span class="rf-lbl"></span><div class="rf-outs">${out('bad', 'Verkaufen', 'zum Monatsende') + out('', 'Warten', 'nicht im Depot')}</div></div></li></ol>`;
  const daily = [...(stop ? [['Stopp erreicht', `Schlusskurs ${stop} % unter dem Hoch seit Kauf`, out('bad', 'Verkaufen', '')]] : []),
    ...(capPct() ? [['Zum Monatsende über ' + capPct() + ' %', 'ein Titel ist über deine Grenze gewachsen', out('blue', 'Teil verkaufen', 'auf die übrigen verteilen')]] : []),
    ['Sonst', 'Kursschwankungen allein zählen nicht', out('', 'Nichts tun', 'bis ' + meTxt())]];
  const CK = r ? [[r.p200 > 0, 'Kurs über der 200-Tage-Linie', pctS(r.p200, 0)], [r.p50 < r.p200, '50-Tage-Linie über der 200-Tage-Linie', ''],
    [!!(r.rank && r.rank <= ib.n), `Unter den ${ib.n} stärksten im Aufwärtstrend`, r.rank ? `Rang ${r.rank}` : 'kein Rang'], ...(so && so.stop ? [[!so.hit, 'Stopp nicht erreicht', `${pctS(so.dd, 0)} zum Hoch seit Kauf`]] : [])] : [];
  const checks = r ? `<ul class="rf-ck">${CK.map(([ok, t, x]) => `<li>${stIcon(ok ? 'ok' : 'bad')}<span>${t}${x ? ` <em class="muted">${x}</em>` : ''}</span></li>`).join('')}</ul>
    <p class="small muted" style="margin:6px 0 0">${esc(shortName(key))} heute: Stärke ${r.rs} von 99.</p>` : '<p class="small muted">Wähle unten einen Titel.</p>';
  const parts = r ? [['3 Monate', r.r3, 40], ['6 Monate', r.r6, 20], ['9 Monate', r.r9, 20], ['12 Monate', r.r12, 20]] : [];
  const formula = r ? `<div class="fbars wide" style="margin-top:8px">${parts.map(([l, v, w]) => `<div class="fb"><span>${l} · ${w} %</span><i><b style="width:${Math.max(0, Math.min(100, Math.abs(v || 0) / Math.max(10, ...parts.map(p => Math.abs(p[1] || 0))) * 100))}%${v < 0 ? ';background:var(--down)' : ''}"></b></i><em class="num">${pctS(v, 0)}</em></div>`).join('')}</div>` : '';
  return `<section class="card span12 rf"><div class="head"><div><h2>So entscheiden deine Regeln</h2><p class="sub">Depot Jakob · Wachstums-Momentum · ${ib.n} Plätze, gleich gewichtet</p></div></div>
    <div class="sx-cols"><div class="sx-main"><h3>Zum Monatsende, für jeden Titel</h3><p class="rf-hint">Von oben nach unten prüfen. Die erste Frage mit „ja“ entscheidet. Nächste Prüfung: ${meTxt()}</p>${ladder}</div>
      <div class="sx-side"><h3>An jedem Tag sofort</h3><div class="rf-daily">${daily.map(([t, s, o]) => `<div class="rf-d"><div><b>${t}</b><small>${s}</small></div>${o}</div>`).join('')}</div>
        <h3 style="margin-top:22px">Prüfungen${r ? ': ' + esc(shortName(key)) : ''}</h3>${checks}
        <h3 style="margin-top:22px">Stärke: so wird gerechnet</h3><p class="rf-hint" style="margin:0">Rendite mit Dividenden, gewichtet wie bei IBD. Daraus der Rang unter allen ${b.n || 'rund 530'} Titeln: 99 heißt stärker als 99 % der Auswahl.</p>${formula}
        <p class="rf-hint" style="margin-top:14px">Auswahl: alle Aktien aus S&P 500 und Nasdaq-100, dazu die großen Aktien aus Europa, China und Hongkong (MSCI ACWI) und 18 Länder-ETFs der Schwellenländer; Rangfolge in Dollar. Weltweit (auch Japan, Kanada, Australien, Schwellenländer) war im Backtest schlechter. Aus deiner Quality-Growth-Vorlage übernommen: ${ib.n} Titel. ${stopPct() ? '' : 'Kein Stopp (deine Wahl). '}Gewinner laufen weiter, keine regelmäßige Gleichgewichtung. Nicht übernommen, weil es im Backtest viel Rendite kostete: ihre Filter auf Wachstum, Qualität und Bewertung, Punkte statt Kursstärke und das Warten auf Rücksetzer. Keine Ausnahmen bei Angst oder Crash, kein Marktfilter.</p></div></div></section>`;
}
const ruleKeys = () => { const ib = idealBook() || {items: [], model: {}}; return [...new Set([...Object.keys(jakobHeld()), ...ib.items.map(x => x.key), ...((ib.model || {}).model || []).map(x => x.key)])].filter(k => (D(k).hist || {}).d); };
function ruleExCard(key) {
  if (!key) return '';
  const sim = S._rsim = ruleSim(key), ks = ruleKeys();
  const pick = `<div class="seg rf-pick">${ks.map(k => `<button data-act="rsk" data-v="${esc(k)}" class="${k === key ? 'on' : ''}">${esc(shortName(k))}</button>`).join('')}</div>`;
  if (!sim) return card('Am Beispiel', 'Wann das Ideal-Depot gekauft und verkauft hat', pick + '<p class="empty" style="margin-top:12px">Für diesen Titel gibt es noch zu wenig Kursverlauf.</p>', '', 'span12');
  const cur = showCur(key), buys = sim.trades.filter(t => t.t === 'buy').length, sells = sim.trades.length - buys, from = dateDe(dayIso(sim.d[0]));
  const sw = (cls, t) => `<span><i class="rf-sw ${cls}"></i>${t}</span>`;
  const leg = `<div class="legend rf-leg">${sw('on', 'Aufwärtstrend')}${sw('px', 'Kurs')}${sw('m50', '50-Tage-Linie')}${sw('m200', '200-Tage-Linie')}${sw('buy', 'Kauf')}${sw('sell', 'Verkauf')}${sw('hd', 'Im Ideal-Depot')}</div>`;
  const kpi = (l, v, n, cls = '') => `<div class="sx-kpi"><span>${l}</span><b class="num ${cls}">${v}</b>${n ? `<small>${n}</small>` : ''}</div>`;
  const kpis = `<div class="sx-kpis rf-kpis">${kpi('Im Ideal-Depot', pctS(sim.rule, 0), 'nur dieser Titel', sign(sim.rule))}${kpi('Immer gehalten', pctS(sim.hold, 0), 'zum Vergleich', sign(sim.hold))}
    ${kpi('Gehalten', nf(sim.inv, 0) + ' %', 'der Zeit')}${kpi('Käufe / Verkäufe', `${buys}<small> / ${sells}</small>`, 'seit ' + from)}</div>`;
  const tr = sim.trades.slice().reverse().map(t => `<div class="rf-tr"><span class="rf-mk ${t.t}" aria-hidden="true"></span><span class="num rf-trd">${dateDe(dayIso(t.day))}</span><b>${t.t === 'buy' ? 'Kauf' : 'Verkauf'}</b><span class="num rf-trp">${money(t.px, cur)}</span><small>${esc(t.why)}</small></div>`).join('');
  const now = `${sim.now.held ? 'Heute im Ideal-Depot' : 'Heute nicht im Ideal-Depot'}: ${sim.now.st === 'on' ? 'Aufwärtstrend' : sim.now.st === 'down' ? 'Kurs unter der 200-Tage-Linie' : 'kein Aufwärtstrend'}${sim.now.rank ? `, Rang ${sim.now.rank}` : ''}.`;
  return `<section class="card span12 rfx"><div class="head"><div><h2>Am Beispiel: wann gekauft und verkauft wird</h2><p class="sub">${esc(shortName(key))} im Ideal-Depot seit ${from}, Prüfung zum Monatsende und Stopp wie oben</p></div></div>
    ${pick}<div class="rf-chart" id="ch-rule"></div>${leg}<p class="rf-now">${esc(now)}</p>${kpis}
    ${tr ? `<h3 style="margin-top:20px">Käufe und Verkäufe</h3><div class="rf-trs">${tr}</div>` : '<p class="empty" style="margin-top:12px">In diesem Zeitraum hat das Ideal-Depot diesen Titel weder gekauft noch verkauft.</p>'}
    <p class="hint">Aus dem Ideal-Depot, das die App Tag für Tag nach der Regel führt (zu Beginn mit den Kursen der letzten Monate nachgerechnet, mit der heutigen Auswahl). Ein Titel bekommt nur einen Platz, wenn er unter den stärksten ist; darum kann er im Aufwärtstrend sein und trotzdem fehlen. Vergangene Kurse sagen nichts Sicheres über die Zukunft. Keine Anlageberatung.</p></section>`;
}
function drawRuleChart(el, sim) {
  const W = Math.max(300, el.clientWidth), mob = W < 560, H = mob ? 240 : 290, pl = 4, pr = mob ? 50 : 62, pt = 10, pb = 40;
  const n = sim.d.length, X0 = sim.d[0], X1 = sim.d[n - 1], ph = H - pt - pb;
  const vals = [...sim.px, ...sim.m50, ...sim.m200].filter(v => v != null);
  let y0 = Math.min(...vals), y1 = Math.max(...vals); const pad = (y1 - y0) * 0.06 || 1; y0 -= pad; y1 += pad;
  const sx = x => pl + (x - X0) / (X1 - X0 || 1) * (W - pl - pr), sy = y => pt + (1 - (y - y0) / (y1 - y0)) * ph;
  const runs = f => { const r = []; let a = null; for (let i = 0; i < n; i++) { if (f(i)) { if (a == null) a = i; } else if (a != null) { r.push([a, i]); a = null; } } if (a != null) r.push([a, n - 1]); return r; };
  const rect = (r, cls, y, h) => r.map(([a, b]) => `<rect class="${cls}" x="${sx(sim.d[a]).toFixed(1)}" y="${y}" width="${Math.max(1.5, sx(sim.d[b]) - sx(sim.d[a])).toFixed(1)}" height="${h}"/>`).join('');
  const path = arr => { let s = '', pen = false; arr.forEach((v, i) => { if (v == null) { pen = false; return; } s += (pen ? 'L' : 'M') + sx(sim.d[i]).toFixed(1) + ',' + sy(v).toFixed(1); pen = true; }); return s; };
  const cur = showCur(sim.key), fmt = v => money(v, cur).replace(/,\d+(?=\s)/, '');
  const step = niceStep((y1 - y0) / 4); let yt = '';
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) yt += `<line class="rf-grid" x1="${pl}" x2="${W - pr}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}"/><text class="rf-ax" x="${W - pr + 8}" y="${(sy(v) + 4).toFixed(1)}">${fmt(v)}</text>`;
  const every = (X1 - X0) > 500 ? 3 : 2;
  let xt = '', lastM = null, lastX = -1e9;
  for (let i = 0; i < n; i++) { const dt = new Date(sim.d[i] * DAY), m = dt.getUTCMonth(), key = dt.getUTCFullYear() * 12 + m, x = sx(sim.d[i]);
    if (lastM !== null && key !== lastM && m % every === 0 && x - lastX >= 64 && x > 24 && x < W - pr - 18) {   // Beschriftungen nie überlappen
      xt += `<text class="rf-ax" text-anchor="middle" x="${x.toFixed(1)}" y="${H - 6}">${MON[m].slice(0, 3)} ${String(dt.getUTCFullYear()).slice(2)}</text>`; lastX = x; }
    lastM = key; }
  const hy = pt + ph + 8;
  const mk = sim.trades.map(t => { const x = sx(t.day), y = sy(t.px), up = t.t === 'buy';
    return `<g class="rf-m ${t.t}"><title>${t.t === 'buy' ? 'Kauf' : 'Verkauf'} am ${dateDe(dayIso(t.day))} zu ${money(t.px, cur)}. ${esc(t.why)}</title><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8"/>
      <path d="${up ? `M${(x - 3.6).toFixed(1)},${(y + 2).toFixed(1)}L${x.toFixed(1)},${(y - 2.8).toFixed(1)}L${(x + 3.6).toFixed(1)},${(y + 2).toFixed(1)}Z` : `M${(x - 3.6).toFixed(1)},${(y - 2).toFixed(1)}L${x.toFixed(1)},${(y + 2.8).toFixed(1)}L${(x + 3.6).toFixed(1)},${(y - 2).toFixed(1)}Z`}"/></g>`; }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Kurs mit Phasen im Aufwärtstrend, Käufe und Verkäufe des Ideal-Depots">
    ${rect(runs(i => sim.st[i] === 'on'), 'rf-bon', pt, ph)}${yt}
    <path class="rf-l200" d="${path(sim.m200)}"/><path class="rf-l50" d="${path(sim.m50)}"/><path class="rf-lpx" d="${path(sim.px)}"/>
    <rect class="rf-hb" x="${pl}" y="${hy}" width="${W - pl - pr}" height="6" rx="3"/>${rect(runs(i => sim.held[i]), 'rf-hd', hy, 6)}
    <text class="rf-ax" x="${W - pr + 8}" y="${hy + 6}">Depot</text>${xt}${mk}
    <line class="rf-cross" x1="0" x2="0" y1="${pt}" y2="${pt + ph}" style="display:none"/><rect class="rf-hit" x="${pl}" y="${pt}" width="${W - pl - pr}" height="${ph + 16}"/></svg><div class="rf-tip" hidden></div>`;
  const svg = el.querySelector('svg'), cross = el.querySelector('.rf-cross'), tip = el.querySelector('.rf-tip');
  const ST = {on: 'Aufwärtstrend', down: 'unter der 200-Tage-Linie', none: 'kein Aufwärtstrend'};
  const move = ev => { const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * W / r.width, day = X0 + (x - pl) / (W - pl - pr) * (X1 - X0);
    let i = bisect(sim.d, day); i = Math.max(0, Math.min(n - 1, i)); if (i < n - 1 && day - sim.d[i] > sim.d[i + 1] - day) i++;
    const cx = sx(sim.d[i]); cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
    tip.hidden = false; tip.innerHTML = `<b>${dateDe(dayIso(sim.d[i]))}</b><span>${money(sim.px[i], cur)}</span><span>${ST[sim.st[i]] || ''}</span><span>${sim.held[i] ? 'im Ideal-Depot' : 'nicht im Ideal-Depot'}</span>`;
    const left = cx / W * r.width; tip.style.left = Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth) + 'px'; };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { cross.style.display = 'none'; tip.hidden = true; });
}
// Alle Regeln im Wortlaut
function howCard() {
  const ib = idealBook() || {}, mdd = +ansOf('max_dd') || 35, stop = stopPct();
  const pts = ['Nur das Depot Jakob. Hauptdepot und Fenja zählen nicht.',
    'Auswahl: alle Aktien aus S&P 500 und Nasdaq-100 (bei zwei Aktiengattungen nur eine), dazu die großen Aktien aus Europa, China und Hongkong im MSCI ACWI (über deutsche Broker handelbar) und 18 Länder-ETFs der Schwellenländer. Kurse in Dollar umgerechnet, damit ein Plus nur aus der Heimatwährung nicht als Stärke zählt.',
    'Stärke wie bei IBD: Rendite mit Dividenden der letzten 3 Monate zu 40 %, der letzten 6, 9 und 12 Monate zu je 20 %.',
    'Aufwärtstrend wie bei Minervini: Kurs über der 200-Tage-Linie, die 50-Tage-Linie über der 200-Tage-Linie.',
    `Zum Monatsende: die ${ib.n || 6} stärksten Titel im Aufwärtstrend kaufen bzw. halten. Was nicht mehr dazugehört, wird verkauft. Neue Titel bekommen den gleichen Betrag, die übrigen laufen weiter (keine regelmäßige Gleichgewichtung; im Backtest besser als jährlich oder monatlich). Weniger Titel im Trend: der Rest bleibt Reserve.`,
    capPct() ? `Obergrenze ${capPct()} % je Titel: Liegt ein Titel zum Monatsende darüber, wird der Teil darüber verkauft und auf die übrigen verteilt. 15 % wäre zu eng (schon 6 gleiche Teile sind 16,7 %) und kostete im Backtest gut 6 Punkte pro Jahr.` : 'Keine Obergrenze je Titel (deine Antwort): Im Backtest wuchs ein Titel so bis 55 % des Depots.',
    stop ? `Stopp: Schließt ein Titel ${stop} % unter seinem Hoch seit dem Kauf, wird er sofort verkauft. Der Platz bleibt bis zum Monatsende frei; danach darf der Titel wieder rein, wenn er vorn liegt.` : 'Kein Stopp (deine Wahl): verkauft wird nur zum Monatsende. Im Backtest 34,8 % pro Jahr bei −52 % größtem Rückgang, mit Stopp 31,8 % bei −49 %.',
    `Aktienanteil nach deiner Grenze für Rückgänge (−${mdd} %): ${nf((ib.share || 1) * 100, 0)} %. Betrag: Startbetrag ${eur(+ansOf('capital') || 5000, 0)} oder Depot Jakob, das Größere.`,
    'Aus der Quality-Growth-Vorlage nicht übernommen: Filter auf Wachstum, Qualität und Bewertung, Punkte als Rangfolge, Kauf erst nach Rücksetzern, kein Stopp. Im Backtest brachte die Vorlage so 1,6 % pro Jahr.',
    'Keine Ausnahmen bei Angst oder Crash, kein Marktfilter, keine Grenze je Branche: Das alles kostete im Backtest Rendite.'];
  return `<details class="card fold span12 how"><summary><div><h2>Alle Regeln im Wortlaut</h2><p class="sub">Grundlage: Backtest über 10 Jahre und deine Antworten</p></div><span class="chev"></span></summary>
    <ul class="dots">${pts.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="hint">Regelbasierte Auswahl nach deinen eigenen Angaben. Keine Anlageberatung und keine Kaufempfehlung.</p></details>`;
}
// Detailansicht: was deine Regel für diesen Titel sagt, mit dem passenden Ergebnis aus dem Backtest
function ruleCard(key) {
  const r = ruleOf(key), ib = idealBook();
  if (!r) return '';
  const held = jakobHeld()[stratKey(key)], it = ib.items.find(x => x.key === stratKey(key)), b = S.bt && S.bt.rule === RULE_V ? S.bt : null;
  const S2 = b ? Object.fromEntries(b.strategies.map(x => [x.id, x])) : {}, m = b ? btMain(b) : null;
  const note = !b ? '' : r.word === 'Kaufen' || r.word === 'Halten' ? `Im Backtest brachte die Regel ${pctS(m.cagr, 0)} pro Jahr, der S&P 500 ${pctS((S2.SPY || {}).cagr, 0)}.`
    : r.word === 'Verkaufen' && r.when === 'sofort' && S2.best_stop ? `Im Backtest senkte der Stopp den größten Rückgang von ${pctS(S2.best.dd, 0)} auf ${pctS(S2.best_stop.dd, 0)}.` : '';
  return card('Deine Regel', `Depot Jakob${r.when ? ' · ' + (r.when === 'sofort' ? 'sofort' : 'zum Monatsende, ' + r.when) : ''}`, `<div class="ratehead"><span class="chip big ${r.cls}">${r.word}</span><div class="ratemain">${r.eur ? `<div class="ratelabel num">${eur(r.eur, 0)}</div>` : ''}
    <div class="muted small">${held ? 'Im Depot Jakob: ' + eur(held.value, 0) : 'Nicht im Depot Jakob'}${it ? ' · Ziel im Ideal-Depot ' + eur(it.eur, 0) : ''}</div></div></div>
    <ul class="dots" style="margin-top:10px">${r.why.map(x => `<li>${esc(x)}</li>`).join('')}</ul>${note ? `<p class="small muted" style="margin:6px 0 0">${esc(note)}</p>` : ''}
    <p class="tiny muted" style="margin:8px 0 0">Was deine Regeln sagen, keine Empfehlung. Keine Anlageberatung.</p>`);
}
// Strategie in fünf Bereichen (Jakobs Wunsch vom 22.11.2026: übersichtlicher): Heute, Regeln, Kandidaten, Backtest, Profil
const SV = ['Heute', 'Regeln', 'Kandidaten', 'Backtest', 'Profil'];
try { S.sv = localStorage.getItem('depot_sv') || 'Heute'; } catch (e) { S.sv = 'Heute'; }
function vStrat(c) {
  const pr = prof();
  if (!pr.answers) return `<div class="grid">${card('Deine Strategie', 'Noch kein Profil', `<p class="body">Beantworte ein paar Fragen. Danach rechnet die App dein Ideal-Depot nach Wachstums-Momentum und prüft dein Depot gegen deine Regeln.</p>
    <div class="btnrow"><button class="btn" data-act="startprof">Profil anlegen</button></div>`)}</div>`;
  if (S.bt === undefined) setTimeout(loadBacktest, 0);   // für den Backtest-Hinweis im Plan und in der Detailansicht
  const v = SV.includes(S.sv) ? S.sv : 'Heute', open = QUESTIONS.filter(q => ansOf(q.id) == null).length;
  const nav = stratNav(v, open), ib = idealBook();
  let body;
  if (!ib && v !== 'Profil' && v !== 'Backtest') body = card('Strategie', 'Wachstums-Momentum', '<p class="empty">Das Ideal-Depot nach der neuen Regel kommt mit dem nächsten Tageslauf.</p>', '', 'span12');
  else if (v === 'Regeln') { const ks = ruleKeys();   // Vorgabe: der Titel, mit dem das Ideal-Depot am meisten gehandelt hat
    if (!ks.includes(S.rsk)) S.rsk = ks.map(k => [k, (ruleSim(k) || {trades: []}).trades.length]).sort((a, b) => b[1] - a[1]).map(x => x[0])[0];
    body = ruleFlowCard(S.rsk) + ruleExCard(S.rsk) + howCard(); }
  else if (v === 'Kandidaten') body = candCard();
  else if (v === 'Backtest') body = modelCard() + btCard();
  else if (v === 'Profil') { const sum = strategySummary();
    body = card('Deine Strategie', `Depot Jakob · ${esc(pr.source || 'Profil')}${pr.updated ? ' · geändert ' + dateDe(pr.updated) : ''}`, `<p class="body strong">${esc(sum.s[1] || '')}</p>
      <p class="body small" style="margin-top:6px">${esc(sum.s[0].replace(/^Depot Jakob: /, ''))} ${esc(sum.s[2] || '')}</p>
      ${sum.t.length ? `<details class="qdone"><summary>Spannungen in deinem Profil (${sum.t.length})</summary><div class="rules">${sum.t.map(t => `<div class="rule">${stIcon('warn')}<div class="x">${esc(t)}</div></div>`).join('')}</div></details>` : ''}
      ${pr.text ? `<details class="qdone"><summary>Dein Profil im Wortlaut</summary><p class="body small">${esc(pr.text)}</p></details>` : ''}`, '', 'span7')
      + questionsCard() + checkCard() + guardCard() + playCard(); }
  else body = stratTop(ib) + planCard(ib) + lageCard(ib) + `<button class="card span12 sx-link" data-act="sv" data-v="Regeln"><div><h2>So funktioniert deine Strategie</h2><p class="sub">Ablauf und Beispiel: wann gekauft, wann verkauft wird</p></div><span class="chev"></span></button>`;
  return `<div class="strat">${nav}<div class="g12">${body}</div>${v === 'Heute' ? '' : '<p class="hint" style="margin-top:14px">Regelbasierte Auswahl nach deinen eigenen Angaben, nur für das Depot Jakob. Keine Anlageberatung.</p>'}</div>`;
}
function vInsight(c) {
  const keys = insightKeys(c);
  const stocks = keys.filter(k => !isCoin(k) && !isFund(k)).map(key => ({key}));
  const aRows = stocks.filter(r => an(r.key).now || (D(r.key).fund || {}).target_mean), iRows = stocks.filter(r => ins(r.key));
  const sw = flt('ein', ['Depot', 'Watchlist']);
  const tot = k => aRows.reduce((s, r) => s + (an(r.key)[k] || 0), 0);
  const moves = [[tot('up_90d'), 'Hochstufung', 'Hochstufungen'], [tot('down_90d'), 'Abstufung', 'Abstufungen'], [tot('pt_up_90d'), 'erhöhtes Kursziel', 'erhöhte Kursziele'], [tot('pt_down_90d'), 'gesenktes Kursziel', 'gesenkte Kursziele']]
    .map(([n, one, many]) => `<b>${n}</b> ${n === 1 ? one : many}`).join(', ');
  const feed = iRows.flatMap(r => (ins(r.key).rows || []).map(x => ({x, key: r.key}))).sort((a, b) => b.x.d.localeCompare(a.x.d)).slice(0, 14);
  const noData = stocks.filter(r => !ins(r.key)).map(r => r.key.split(':')[1]);
  return `<div class="g12">${sectorCard(c)}
    ${card('Was sagen Analysten', 'Urteile und Kursziele für 12 Monate, zusammengetragen von Yahoo Finance. Nur Aktien: ETFs und Krypto haben keine Analysten.',
      aRows.length ? `<div class="sumline" style="margin-bottom:10px">Letzte 90 Tage: ${moves}</div>${tbl('analyst', [COL.name, ACOL.rec, ACOL.n, ACOL.buy, ACOL.tgt, ACOL.last], aRows, ['rec', 1])}
      <p class="hint">Analysten liegen oft daneben, und Kursziele folgen meist dem Kurs. Ein hohes Kursziel ist deshalb kein Kaufgrund. Zeile antippen für alle Änderungen. Keine Anlageberatung.</p>` : '<p class="empty">Keine Analystendaten für diese Auswahl.</p>', sw, 'span12')}
    ${moodCard(keys, sw)}
    ${card('Insider je Titel', 'Käufe und Verkäufe von Management, Board und Großaktionären in den letzten 6 Monaten',
      iRows.length ? tbl('insider', [COL.name, ICOL.buy, ICOL.sell, ICOL.last], iRows, ['ibuy', -1]) + `<p class="hint">${INS_HINT}${noData.length ? ' Ohne Meldungen: ' + esc(noData.join(', ')) + '.' : ''}</p>` : '<p class="empty">Keine Insider-Meldungen für diese Auswahl. Einzeln melden müssen nur US-Firmen.</p>', sw, 'span7')}
    ${card('Letzte Insider-Meldungen', 'Neueste zuerst, nur Käufe und Verkäufe', feed.length ? `<div class="rows tight">${feed.map(e => insRow(e.key, e.x, true)).join('')}</div>` : '<p class="empty">Keine Meldungen in den letzten 12 Monaten.</p>', '', 'span5')}
  </div>`;
}
function analystDetail(key, f, x) {
  const n = x.now, t = f.target_mean, u = upside(key);
  const before = x.before ? ` · vor 3 Monaten ${nf(buyShare(x.before), 0)} %` : '';
  return card('Analysten', `${sumN(n) ? sumN(n) + ' Urteile' : ''}${f.analysts ? (sumN(n) ? ' · ' : '') + nf(f.analysts, 0) + ' mit Kursziel' : ''} · Quelle: Yahoo Finance`,
    `${n ? `<div class="recsum"><b>${recWord(recMean(n))}</b><span class="muted small">${nf(buyShare(n), 0)} % raten zum Kauf${before}</span></div>${recBar(n, true)}
      <div class="reclegend">${n.map((v, i) => `<span><i class="r${i}"></i>${REC[i]} <b class="num">${v}</b></span>`).join('')}</div>` : ''}
    ${t ? `<div class="tiles" style="margin-top:12px">${tile('Kursziel im Schnitt', pxR(key, t), u != null ? pctS(u, 0) + ' zum Kurs' : '')}${tile('Niedrigstes Ziel', pxR(key, f.target_low))}${tile('Höchstes Ziel', pxR(key, f.target_high))}
      ${tile('Änderungen, 90 Tage', x.n_90d ? `${x.up_90d || 0} ↑ · ${x.down_90d || 0} ↓` : '–', x.n_90d ? `Ziele: ${x.pt_up_90d || 0} erhöht, ${x.pt_down_90d || 0} gesenkt` : '')}</div>` : ''}
    ${(x.changes || []).length ? `<p class="sh">Letzte Änderungen</p><div class="rows tight">${x.changes.slice(0, 8).map(c => `<div class="row"><div class="l">${changeText(key, c)}</div></div>`).join('')}</div>` : ''}
    <p class="hint">↑ Hochstufung, ↓ Abstufung. Analysten liegen oft daneben, Kursziele gelten für 12 Monate. Keine Anlageberatung.</p>`);
}
function insiderDetail(key, x) {
  const n = k => x['n_' + k + '_6m'] || 0;
  return card('Insider', 'Käufe und Verkäufe von Management, Board und Großaktionären, letzte 12 Monate',
    `<div class="tiles two" style="margin:0">${tile('Käufe, 6 Monate', n('buy') ? amt(key, x.buy_6m) : '–', n('buy') + (n('buy') === 1 ? ' Meldung' : ' Meldungen'))}${tile('Verkäufe, 6 Monate', n('sell') ? amt(key, x.sell_6m) : '–', n('sell') + (n('sell') === 1 ? ' Meldung' : ' Meldungen'))}</div>
    ${(x.rows || []).length ? `<div class="rows tight" style="margin-top:8px">${x.rows.map(r => insRow(key, r, false)).join('')}</div>` : '<p class="empty" style="margin-top:10px">Keine Käufe oder Verkäufe, nur Zuteilungen und Optionen.</p>'}
    <p class="hint">${INS_HINT}</p>`);
}

/* ---------------------------------------------------------------- Termine */
function calList(events) {
  const by = {}; events.forEach(e => (by[e.date] = by[e.date] || []).push(e));
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `<div class="cal">${Object.keys(by).sort().map(d => { const dt = new Date(d + 'T12:00:00');
    return `<div class="day"><div class="badge ${d === today ? 'today' : ''}"><div class="w">${d === today ? 'Heute' : WT[dt.getDay()]}</div><div class="d">${dt.getDate()}</div><div class="mo">${MON_K[dt.getMonth()]}</div></div>
    <div style="min-width:0">${by[d].map(e => { const [cls, lab] = CAT[e.category] || ['', e.category];
      return `<div class="ev ${e.market ? '' : 'mine'}"><div class="meta"><span class="chip ${cls}">${esc(lab)}</span>${e.time ? `<span class="tiny muted num">${esc(e.time)}${/^\d/.test(e.time) ? ' Uhr' : ''}</span>` : ''}${e.estimated ? '<span class="tiny muted">geschätzt</span>' : ''}${e.market ? '' : '<span class="tiny mine-tag">dein Titel</span>'}</div>
      <div class="ti">${calTitle(e)}${e.expected ? ` <span class="muted">· für dich etwa ${fxNow(e.currency) ? eur(e.expected / fxNow(e.currency)) : money(e.expected, e.currency)} brutto</span>` : ''}</div></div>`; }).join('')}</div></div>`; }).join('')}</div>`;
}
// Eigene Titel im Kalender mit Logo und Kurznamen statt „Apple Inc.: …“
const calTitle = e => { const own = e.key && A(e.key).name; return own && /:/.test(e.title) ? `${logo(e.key)}${esc(shortName(e.key) + e.title.slice(e.title.indexOf(':')))}` : esc(e.title); };
function calCompact(events) {
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `<div class="calc">${events.map(e => { const dt = new Date(e.date + 'T12:00:00'), [cls, lab] = CAT[e.category] || ['', e.category];
    return `<div class="${e.market ? '' : 'mine'}"><span class="dt num ${e.date === today ? 'today' : ''}">${e.date === today ? 'Heute' : WT[dt.getDay()] + ' ' + dt.getDate() + '.' + (dt.getMonth() + 1) + '.'}</span>
      <span class="chip ${cls}">${esc(lab)}</span><span class="ti" title="${esc(e.title)}">${calTitle(Object.assign({}, e, {title: e.title.replace(/: Quartalszahlen$/, '')}))}${e.time ? ` <span class="muted">· ${esc(e.time)}</span>` : ''}</span></div>`; }).join('')}</div>`;
}
function vCal() {
  const all = S.digest.calendar || [], f = S.calFilter;
  const FL = {alle: () => true, 'Meine Titel': isMine, Zahlen: e => e.category === 'Earnings', Konjunktur: e => e.category === 'Makro' || e.category === 'Fed',
    Dividenden: e => /Dividende|Zahltag/.test(e.category), Krypto: e => e.category === 'Krypto', IPOs: e => e.category === 'IPO'};
  const ev = all.filter(FL[f] || FL.alle);
  return `<div class="grid">${card('Kalender', 'Quartalszahlen großer US-Firmen, Konjunktur, Fed und EZB, Börsengänge, dazu Zahlen, Dividenden und Krypto-Termine deiner Titel. Uhrzeiten in deutscher Zeit.',
    ev.length ? calList(ev) : '<p class="empty">Keine Termine gefunden. Der Kalender füllt sich mit der täglichen Aktualisierung.</p>', seg('calf', Object.keys(FL), f))}
    <p class="hint" style="margin:0 4px">Quellen: Nasdaq (Quartalszahlen ab 40 Mrd. $ Börsenwert, Börsengänge), Forex Factory (Konjunktur und Notenbanken, nur die laufende Woche), Yahoo und die Recherche für deine Titel.</p></div>`;
}

/* ---------------------------------------------------------------- Detailansicht */
function openSheet(html) { $('#sheet-box').innerHTML = html; $('#sheet').hidden = false; $('#sheet-box').scrollTop = 0; document.body.style.overflow = 'hidden'; }
function closeSheet() { $('#sheet').hidden = true; document.body.style.overflow = ''; S.sheetKey = null; }
const sheetTop = (title, sub) => `<div class="sheet-top"><div><h2>${title}</h2>${sub ? `<p class="muted small" style="margin:4px 0 0">${sub}</p>` : ''}</div><button class="xbtn" data-act="close">×</button></div>`;
// Was die Firma (der Coin, der ETF) tut und womit sie Geld verdient: Recherche (analysis → business), sonst profiles.json, sonst Yahoo auf Englisch
function profileCard(key) {
  const b = (AI(key).claude || {}).business, pr = (S.profiles || {})[key], en = (D(key).fund || {}).summary_en;
  const x = b && (b.what || b.money) ? b : pr && (pr.what || pr.money) ? pr : null;
  const title = isCoin(key) ? 'Was ist das?' : isFund(key) || isCommodity(key) ? 'Was steckt drin?' : 'Was macht die Firma?';
  if (x) return card(title, '', `<div class="prof">${x.what ? `<p><b>Was ${isCoin(key) ? 'es' : 'sie'} tut</b>${esc(x.what)}</p>` : ''}${x.money ? `<p><b>${isFund(key) || isCommodity(key) ? 'Wie es Ertrag bringt' : 'Womit ' + (isCoin(key) ? 'es' : 'sie') + ' Geld verdient'}</b>${esc(x.money)}</p>` : ''}</div>`);
  if (en) return card(title, 'Beschreibung von Yahoo, auf Englisch. Die deutsche Fassung kommt mit der nächsten Recherche.', `<p class="body">${esc(en)}</p>`);
  return '';
}
// Detailansicht: Wachstum und Vision (eingepreist gegen erwartet, Plan der Firma laut Recherche)
function fitCard(key, v, ai) {
  const vis = (v || {}).vision || {}, pl = (ai || {}).plan;
  if (vis.implied == null && !pl) return '';
  const vz = vis.implied != null ? `<div class="tiles" style="margin:0">${tile('Im Kurs steckt', pctS(vis.implied, 0) + ' pro Jahr', 'Gewinnwachstum, das der Kurs voraussetzt')}${tile('Erwartet', pctS(vis.expected, 0) + ' pro Jahr', esc(vis.source || ''))}
    ${tile('Abstand', pctS(vis.diff, 0), vis.diff >= 3 ? 'weniger eingepreist als erwartet' : vis.diff > -3 ? 'passt zur Erwartung' : 'mehr eingepreist als erwartet', sign(vis.diff))}</div>` : '';
  const pz = pl ? `<div class="rows" style="margin-top:8px">${pl.goal ? `<div class="row"><div class="l"><div class="t">Plan der Firma</div><div class="x">${esc(pl.goal)}</div></div></div>` : ''}
    ${pl.analysts ? `<div class="row"><div class="l"><div class="t">Was Analysten sagen</div><div class="x">${esc(pl.analysts)}</div></div></div>` : ''}
    <div class="row"><div class="l"><div class="t">Realistisch? <span class="chip ${pl.realistic === 'ja' ? 'good' : pl.realistic === 'nein' ? 'bad' : 'warn'}">${esc(pl.realistic || '–')}</span> <span class="chip">${esc({'zu wenig': 'noch nicht voll eingepreist', passend: 'angemessen eingepreist', 'zu viel': 'mehr als eingepreist'}[pl.priced_in] || '')}</span></div>${pl.why ? `<div class="x">${esc(pl.why)}</div>` : ''}</div></div></div>` : '';
  return card('Wachstum und Vision', '', vz + pz +
    `<p class="tiny muted" style="margin:10px 0 0">Im Kurs steckt: welches Gewinnwachstum pro Jahr nötig ist, damit sich der heutige Kurs in 5 Jahren mit 9 % im Jahr lohnt, wenn die Aktie dann das 20-Fache ihres Gewinns wert ist (Reverse-DCF nach Mauboussin). Vision darf eingepreist sein, wenn sie realistisch ist: Dann zählen hohe Bewertungskennzahlen nur halb. Keine Anlageberatung.</p>`);
}
// Detailansicht: Stärke und Aufwärtstrend nach Wachstums-Momentum (Titel der Auswahl, Depot Jakob, Watchlist);
// sonst das Momentum-Signal (Coins, ETFs außerhalb der Auswahl)
function momCard(key) {
  const k = stratKey(key), r = scrRow(k);
  const row = (ok, t, x) => `<div class="rule">${stIcon(ok ? 'ok' : 'bad')}<div><b>${t}</b>${x ? `<div class="x">${x}</div>` : ''}</div></div>`;
  if (r && r.rs != null) {
    const ib = idealBook() || {n: 7}, so = jakobHeld()[k] ? stopOf(k) : null;
    return card('Wachstums-Momentum', `Stärke ${r.rs} von 99${r.rank ? ` · Rang ${r.rank} im Aufwärtstrend` : ''}${r.member ? '' : ' · nicht in der Auswahl'}`,
      `<div class="tiles" style="margin:0">${tile('3 Monate', pctS(r.r3, 0), 'zählt 40 %', sign(r.r3))}${tile('6 Monate', pctS(r.r6, 0), 'zählt 20 %', sign(r.r6))}${tile('9 Monate', pctS(r.r9, 0), 'zählt 20 %', sign(r.r9))}${tile('12 Monate', pctS(r.r12, 0), 'zählt 20 %', sign(r.r12))}</div>
      <div class="rules" style="margin-top:10px">${row(r.p200 > 0, 'Kurs über der 200-Tage-Linie', pctS(r.p200, 0) + ' zur Linie')}${row(r.p50 < r.p200, '50-Tage-Linie über der 200-Tage-Linie', '')}
      ${row(!!(r.rank && r.rank <= ib.n), `Unter den ${ib.n} stärksten im Aufwärtstrend`, r.rank ? `Rang ${r.rank}` : 'ohne Aufwärtstrend kein Rang')}
      ${so && so.stop ? row(!so.hit, `Stopp bei −${so.stop} % nicht erreicht`, `${pctS(so.dd, 0)} zum Hoch seit Kauf`) : ''}</div>
      <p class="tiny muted" style="margin:10px 0 0">Rendite mit Dividenden. Stärke: Rang unter allen Titeln der Auswahl (S&P 500, Nasdaq-100, Europa, China, Hongkong, Länder-ETFs) in Dollar, wie das RS-Rating von IBD. Keine Anlageberatung.</p>`);
  }
  const m = momOf(key);
  if (!m || !m.checks) return '';
  const ck = m.checks, bn = isCoin(key) ? 'Bitcoin' : 'S&P 500';
  const [cls, head] = {on: ['good', m.since <= 10 ? 'Signal neu an' : 'Signal an'], fade: ['warn', 'Momentum lässt nach'], down: ['bad', 'Kein Momentum: Abwärtstrend'], none: ['', 'Kein Signal']}[m.state] || ['', ''];
  return card('Momentum', `${m.met} von 4 erfüllt${m.state === 'on' ? (m.since < 60 ? ' · seit ' + m.since + ' Handelstagen' : ' · seit über 60 Handelstagen') : ''}`,
    `<div style="margin-bottom:10px"><span class="chip ${cls}">${head}</span></div><div class="rules">
    ${row(ck.trend, 'Aufwärtstrend', `Kurs ${pctS(m.ma50, 0)} zur 50-Tage-Linie, ${pctS(m.ma200, 0)} zur 200-Tage-Linie. Nötig: Kurs über der 50, die 50 über der 200`)}
    ${row(ck.rising, '200-Tage-Linie steigt', 'gegenüber vor einem Monat')}
    ${row(ck.high, 'Nahe am Jahreshoch', `${m.from_high ? pctS(m.from_high, 0) + ' zum Hoch der letzten 12 Monate' : 'am Hoch der letzten 12 Monate'}, erlaubt bis −15 %`)}
    ${row(ck.rel, m.bench ? 'Stärker als ' + bn : 'Kurs im Plus', m.rel6 != null ? `${pctS(m.rel6, 0)} gegenüber ${bn} in 6 Monaten` : `${pctS(m.r6, 0)} in 6 Monaten`)}</div>
    <p class="tiny muted" style="margin:10px 0 0">Signal an, wenn alle vier zutreffen. Gängige Trendfolge-Regel, kein Blick in die Zukunft. Gehört nicht zu deiner Strategie (die gilt für Aktien aus S&P 500, Nasdaq-100, Europa, China und Hongkong). Keine Anlageberatung.</p>`);
}
function vAsset(key) {
  S.sheetKey = key;
  const a = A(key), d = D(key), ai = AI(key).claude, gr = grokOf(key), c = calc(), p = c.pos.find(x => x.key === key && x.qty > 1e-12);
  const [kind, sym] = key.split(':'), cur = curOf(key), f = d.fund || {}, t = d.tech || {}, v = d.valuation, dv = d.div;
  const watched = (S.pf.watchlist || []).some(w => keyOf(w.kind, w.symbol) === key);
  const ir = safeUrl((ai || {}).ir_url) || safeUrl(f.ir_website) || safeUrl(f.website);
  let h = sheetTop(`<span class="ahead">${logo(key)}<span><small>${esc(tick(key))} · ${esc(assetClass(key))}</small>${esc(shortName(key))}</span></span>`,
    [nameOf(key) !== shortName(key) ? nameOf(key) : '', SECTOR_DE[f.sector] || f.sector, f.industry].filter(Boolean).map(esc).join(' · '));
  h += `<section class="card"><div class="pricehead"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="p num">${px(key, a.price)}</span> ${pill(a.change_pct)}${a.venue ? `<span class="small muted" title="${a.us_close ? `Vor US-Börsenbeginn: Kurs von ${esc(a.venue)}, Änderung gegen den letzten US-Schluss` : `Heimatbörse geschlossen: Kurs von ${esc(a.venue)}, Änderung gegen den Vortag dort`}">${esc(a.venue)}</span>` : ''} ${v ? score(key) : ''}</div>${seg('arange', ['1W', '1M', '3M', '1J', '3J', 'Max'], S.assetRange || '1J')}</div>
    <div class="chart" id="ch-asset" data-key="${esc(key)}"></div>
    <div class="tiles">${tile('1 Monat', pctS(t.perf_1m, 1), '', sign(t.perf_1m))}${tile('1 Jahr', pctS(t.perf_1y, 1), '', sign(t.perf_1y))}
    ${tile('52-Wochen-Spanne', t.low52 ? px(key, t.low52) + ' – ' + px(key, t.high52) : '–')}${tile('Abstand zum Hoch', t.from_high != null ? nf(t.from_high, 1) + ' %' : '–')}</div></section>`;
  h += ruleCard(key);
  h += momCard(key);
  h += profileCard(key);
  if (v) { const r = ratingOf(key);
    h += `<section class="card rate"><div class="ratehead">${score(key, 'big')}<div class="ratemain"><div class="ratelabel">${esc(v.label)}</div><div class="muted small">${r == null ? '' : r + ' von 10 Punkten · '}${esc(v.basis)}</div>${meter(r)}</div>
      ${aiChip(ai) ? `<div class="rateai"><div class="tiny muted">Recherche</div>${aiChip(ai)}</div>` : ''}</div>
      <div class="reasons">${(v.reasons || []).map(x => `<div class="${x.p > 0 ? 'plus' : x.p < 0 ? 'minus' : 'zero'}"><i>${x.p > 0 ? '+' : x.p < 0 ? '−' : '○'}</i><span>${esc(x.text)}${x.w != null && x.w > 0 && x.w < 1 && x.p ? ` <em>${x.w >= 0.5 ? 'zählt halb' : 'zählt wenig'}</em>` : ''}</span></div>`).join('')}</div>
      <p class="tiny muted" style="margin:10px 0 0">${r == null ? 'Ohne Kennzahlen gibt es keine Punkte, nur ein Wort zur Kurslage. ' : 'Plus spricht für günstig, Minus für teuer. Kennzahlen zählen voll. Ein gefallener Kurs zählt nur, wenn die Kennzahlen positiv sind und der Markt überreagiert hat: Der Kurs fiel deutlich stärker als die Gewinnschätzungen (bei Coins: die Einnahmen). Wurden die Schätzungen stark gesenkt, gibt es höchstens 5 oder 6 Punkte. '}Faustregel, keine Anlageberatung.</p></section>`; }
  h += fitCard(key, v, ai);
  if (p) h += card('Deine Position', '', `<div class="tiles" style="margin:0">${tile('Wert', eur(p.value), nf(p.weight, 1) + ' % vom Depot')}${tile('Gewinn', eurS(p.pnl), pctS(p.pnlPct), sign(p.pnl))}
    ${tile('Stück', nf(p.qty, p.qty % 1 ? 4 : 0), 'Einstand ' + eur(p.cost / p.qty) + ' je Stück')}${tile('Heute', eurS(p.dayEur), '', sign(p.dayEur))}</div>`);
  if ((d.levels || []).length || (ai && (ai.buy_zones || []).length)) h += card('Nachkauf-Zonen', 'Kurse, an denen ein Nachkauf naheliegt',
    `<div class="rows">${(d.levels || []).map(l => `<div class="row"><div class="l"><div class="t num">${px(key, l.price)}<span>${nf(l.dist_pct, 1)} %</span></div><div class="m">${esc(l.label)}</div></div>
      <div class="r"><button class="btn sm ghost" data-act="levelalert" data-key="${esc(key)}" data-v="${l.price}">Alert setzen</button></div></div>`).join('')}
    ${((ai || {}).buy_zones || []).filter(z => z.price > 0).map(z => `<div class="row"><div class="l"><div class="t num">${px(key, z.price)}<span>Claude</span></div><div class="x">${esc(z.reason)}</div></div>
      <div class="r"><button class="btn sm ghost" data-act="levelalert" data-key="${esc(key)}" data-v="${+z.price}">Alert setzen</button></div></div>`).join('')}</div>`);
  if (kind === 'crypto' && a.flow) h += card('Spot oder Futures?', '', flowBlock(key), seg('flowwin', ['4 Std.', '24 Std.'], S.flowWin === '4' ? '4 Std.' : '24 Std.'));
  const oc = d.onchain;
  if (kind === 'crypto' && oc) { const usd = v => v == null ? '–' : big(v) + ' $', x = v => v == null ? '–' : v > 999 ? 'über 999-fach' : nf(v, v < 10 ? 1 : 0) + '-fach';
    h += card(oc.type === 'chain' ? 'Gebühren der Blockchain' : 'Einnahmen des Protokolls', 'Quelle: DeFi Llama · letzte 30 Tage, aufs Jahr hochgerechnet',
      `<div class="tiles" style="margin:0">${tile('Gebühren, 30 Tage', usd(oc.fees_30d), oc.fees_chg != null ? pctS(oc.fees_chg, 0) + ' zum Vormonat' : 'zahlen die Nutzer')}${tile('Einnahmen, 30 Tage', usd(oc.rev_30d), oc.rev_chg != null ? pctS(oc.rev_chg, 0) + ' zum Vormonat' : 'behält das Protokoll')}
      ${tile('Marktwert', usd(oc.mcap), oc.fdv ? 'mit allen Token ' + usd(oc.fdv) : '')}${tile('Marktwert zu Gebühren', x(oc.ps), 'wie das KUV einer Aktie')}
      ${tile('Marktwert zu Einnahmen', x(oc.pe), oc.pe_fdv ? 'mit allen Token ' + x(oc.pe_fdv) : 'wie das KGV einer Aktie')}${tile('An Token-Halter', oc.holder_yield != null ? nf(oc.holder_yield, 1) + ' % pro Jahr' : '–', oc.holders_30d ? usd(oc.holders_30d) + ' in 30 Tagen' : 'nichts ausgeschüttet')}</div>
      <p class="hint">${oc.type === 'chain' ? 'Blockchains verdienen im Verhältnis zum Marktwert wenig Gebühren. Die Zahlen stehen hier zur Einordnung und fließen nicht in die Einstufung ein.' : 'Gebühren sind der Umsatz, Einnahmen der Teil, den das Protokoll behält. Ein niedriges Verhältnis spricht für eine günstige Bewertung, sagt aber nichts darüber, ob die Einnahmen anhalten.'} Keine Anlageberatung.</p>`); }
  if (kind === 'stock' && Object.keys(f).length) h += card('Kennzahlen', 'Quelle: Yahoo Finance', `<div class="tiles" style="margin:0">${tile('KGV', nf(f.pe, 1), f.forward_pe ? 'erwartet ' + nf(f.forward_pe, 1) : '')}${tile('PEG', nf(f.peg, 2), 'KGV im Verhältnis zum Wachstum')}
    ${tile('Analystenziel', px(key, f.target_mean), f.analysts ? nf(f.analysts, 0) + ' Analysten' : '')}${tile('Gewinnmarge', f.margin != null ? nf(f.margin * 100, 1) + ' %' : '–')}
    ${tile('Umsatzwachstum', f.revenue_growth != null ? pctS(f.revenue_growth * 100, 1) : '–', 'zum Vorjahr')}${tile('Gewinnschätzung', estChg(f) != null ? pctS(estChg(f), 0) : '–', 'Änderung in 3 Monaten' + (f.est_year ? ', für ' + f.est_year : ''))}
    ${tile('Börsenwert', f.market_cap ? big(f.market_cap) + ' ' + (CUR[cur] || cur) : '–')}</div>
    <p class="hint">Die Gewinnschätzung zeigt, ob sich am inneren Wert etwas geändert hat. Fällt der Kurs deutlich stärker als die Schätzung, hat der Markt wohl überreagiert. Nur dann zählt ein niedriger Kurs in den Punkten.</p>`);
  if (kind === 'stock' && !isFund(key) && ((d.analyst || {}).now || f.target_mean)) h += analystDetail(key, f, d.analyst || {});
  if (kind === 'stock' && d.insider) h += insiderDetail(key, d.insider);
  if (dv) h += card('Dividende', '', `<div class="tiles" style="margin:0">${tile('Pro Aktie und Jahr', px(key, dv.annual), dv.per_year ? dv.per_year + ' Zahlungen' : '')}${tile('Rendite', dv.yield_pct != null ? nf(dv.yield_pct, 2) + ' %' : '–', dv.yield_5y_avg ? '5-Jahres-Schnitt ' + nf(dv.yield_5y_avg, 2) + ' %' : '')}
    ${tile('Nächster Ex-Tag', dv.next_ex ? dateDe(dv.next_ex) : '–', dv.next_ex_estimated ? 'geschätzt aus dem Rhythmus' : dv.next_pay ? 'Zahltag ' + dateDe(dv.next_pay) : '')}${tile('Wachstum', dv.growth_pct != null ? pctS(dv.growth_pct, 1) : '–', dv.payout_pct != null ? 'Ausschüttung ' + nf(dv.payout_pct, 0) + ' % vom Gewinn' : '')}</div>
    ${p && p.divYear ? `<div class="note">Bei deinem Bestand sind das etwa <b>${eur(p.divYear)}</b> brutto im Jahr.</div>` : ''}`);
  if (ai) {
    const q = ai.last_quarter || {};
    h += card('Recherche', `Von Claude, ${esc(ago(ai.at))}`, `${aiChip(ai)}${ai.confidence ? ` <span class="tiny muted">Sicherheit: ${esc(ai.confidence)}</span>` : ''}
      <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:var(--ink2)">${esc(ai.summary)}</p><p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:var(--ink2)">${esc(ai.valuation_reasoning)}</p>
      ${ai.flow_comment ? `<p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:var(--ink2)">${esc(ai.flow_comment)}</p>` : ''}
      ${q.period ? `<p class="sh">Letzte Quartalszahlen: ${esc(q.period)}</p><div class="tiles" style="margin-top:8px">${tile('Umsatz', esc(q.revenue || '–'), esc(q.revenue_growth || ''))}${tile('Gewinn je Aktie', esc(q.eps || '–'), esc(q.vs_expectations || ''))}</div>
        ${q.guidance ? `<div class="note"><b>Ausblick:</b> ${esc(q.guidance)}</div>` : ''}${(q.highlights || []).length ? `<ul class="dots">${q.highlights.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` : ''}
      ${(ai.catalysts || []).length ? `<p class="sh">Was den Kurs treiben kann</p><ul class="dots">${ai.catalysts.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${(ai.risks || []).length ? `<p class="sh">Risiken</p><ul class="dots">${ai.risks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${(ai.sources || []).filter(s => safeUrl(s.url)).length ? `<p class="small" style="margin:12px 0 0">${ai.sources.filter(s => safeUrl(s.url)).slice(0, 5).map(s => `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${esc(s.name || 'Quelle')} ›</a>`).join(' &nbsp; ')}</p>` : ''}`);
  }
  if (gr || d.reddit) h += card('Stimmung', gr ? `Auf X, von Grok ${esc(ago(gr.at))}` : 'Reddit, letzte 24 Stunden', `${gr ? `<span class="chip ${sentCls(gr.sentiment)}" style="font-size:14px;padding:5px 12px">${esc(gr.sentiment || '')}</span>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:var(--ink2)">${esc(gr.summary)}</p>${(gr.topics || []).length ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${gr.topics.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}` : ''}
    ${d.reddit ? `<div class="note">Reddit: <b class="num">${nf(d.reddit.mentions, 0)}</b> Erwähnungen in 24 Stunden (am Vortag ${nf(d.reddit.prev, 0)}), Platz ${d.reddit.rank} der meistgenannten ${isCoin(key) ? 'Coins' : 'Aktien'}.</div>` : ''}
    ${gr ? '' : '<p class="hint">Die Stimmung auf X holst du kostenlos über Grok: Reiter Einblicke, Bereich Stimmung.</p>'}`);
  h += `<section class="card"><div class="btnrow" style="margin:0"><button class="btn" data-act="addtx" data-key="${esc(key)}">Kauf oder Verkauf</button><button class="btn ghost" data-act="addalert" data-key="${esc(key)}">Alert</button>
    ${watched ? '' : `<button class="btn ghost" data-act="watchkey" data-key="${esc(key)}">Auf die Watchlist</button>`}${watched ? `<button class="btn danger" data-act="unwatch" data-key="${esc(key)}">Von der Watchlist nehmen</button>` : ''}</div>
    <p class="small" style="margin:14px 0 0">${ir ? `<a href="${ir}" target="_blank" rel="noopener">Investor Relations ›</a> &nbsp; ` : ''}${kind === 'stock' ? `<a href="https://finance.yahoo.com/quote/${encodeURIComponent(sym)}" target="_blank" rel="noopener">Yahoo Finance ›</a>` : `<a href="https://velo.xyz/futures/${encodeURIComponent(sym)}" target="_blank" rel="noopener">Velo ›</a>`}</p></section>`;
  openSheet(h); requestAnimationFrame(drawCharts);
}

/* ---------------------------------------------------------------- Formulare */
const opt = (v, l, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`;
const symField = (kind, sym) => `<div class="f2"><div class="f"><label>Art</label><select name="kind">${opt('stock', 'Aktie / ETF', kind)}${opt('crypto', 'Krypto', kind)}</select></div>
  <div class="f"><label>Kürzel</label><input name="symbol" required autocapitalize="characters" autocomplete="off" placeholder="z. B. AAPL" value="${esc(sym || '')}"></div></div>
  <p class="hint" style="margin:-6px 2px 12px">US-Aktien: AAPL, NVDA · Xetra: SAP.DE, ALV.DE · Coins: BTC, SOL. <a href="https://finance.yahoo.com/lookup" target="_blank" rel="noopener">Kürzel nachschlagen ›</a></p>`;
function formTx(t, key) {
  const e = t || {}, [k0, s0] = key ? key.split(':') : [e.kind || 'stock', e.symbol || ''];
  openSheet(sheetTop(t ? 'Buchung ändern' : 'Kauf oder Verkauf') + `<section class="card"><form id="f-tx" data-id="${esc(e.id || '')}">
    <div class="f"><label>Vorgang</label><select name="type">${opt('buy', 'Kauf', e.type || 'buy')}${opt('sell', 'Verkauf', e.type)}</select></div>
    ${depots().length > 1 ? `<div class="f"><label>Depot</label><select name="depot">${depots().map(d => opt(d.id, d.name, t ? depOf(e) : (S.dep !== 'all' ? S.dep : 'main'))).join('')}</select></div>` : ''}${symField(k0, s0)}
    <div class="f2"><div class="f"><label>Datum</label><input type="date" name="date" required value="${esc(e.date || new Date().toISOString().slice(0, 10))}"></div>
    <div class="f"><label>Stückzahl</label><input name="qty" required inputmode="decimal" placeholder="10" value="${e.qty ?? ''}"></div></div>
    <div class="f2"><div class="f"><label>Preis je Stück</label><input name="price" required inputmode="decimal" placeholder="150,00" value="${e.price ?? ''}"></div>
    <div class="f"><label>Währung</label><select name="currency">${['EUR', 'USD', 'CHF', 'GBP'].map(c => opt(c, c, e.currency || (k0 === 'crypto' ? 'USD' : 'EUR'))).join('')}</select></div></div>
    <div class="f2"><div class="f"><label>Gebühr</label><input name="fee" inputmode="decimal" placeholder="1,00" value="${e.fee ?? ''}"></div>
    <div class="f"><label>Notiz</label><input name="note" value="${esc(e.note || '')}"></div></div>
    <p class="hint">Preis und Gebühr so, wie sie auf deiner Abrechnung stehen. Die Umrechnung in Euro macht das Dashboard.</p>
    <div class="btnrow"><button class="btn" type="submit">Speichern</button>${t ? `<button class="btn danger" type="button" data-act="deltx" data-id="${esc(t.id)}">Löschen</button>` : ''}</div></form></section>`);
}
function formWatch() {
  openSheet(sheetTop('Titel beobachten') + `<section class="card"><form id="f-watch">${symField('stock', '')}<div class="f"><label>Notiz</label><input name="note"></div>
    <div class="btnrow"><button class="btn" type="submit">Hinzufügen</button></div></form></section>`);
}
function formAlert(key, value) {
  const [k0, s0] = key ? key.split(':') : ['stock', ''];
  openSheet(sheetTop('Alert anlegen') + `<section class="card"><form id="f-alert">${symField(k0, s0)}
    <div class="f"><label>Bedingung</label><select name="type">${Object.entries(ALERT_TYPES).map(([v, l]) => opt(v, l, value ? 'price_below' : 'price_above')).join('')}</select></div>
    <div class="f"><label>Schwelle</label><input name="value" required inputmode="decimal" value="${value ?? ''}" placeholder="z. B. 120"></div>
    <p class="hint">Kurs-Schwellen bei Aktien in Euro, bei Coins in US-Dollar${key && A(key).price != null ? ` (aktuell ${px(key, A(key).price)})` : ''}. Funding-Alerts gibt es nur für Coins.</p>
    <div class="f" style="margin-top:12px"><label>Notiz</label><input name="note" placeholder="z. B. erste Tranche nachkaufen"></div>
    <div class="btnrow"><button class="btn" type="submit">Speichern</button></div></form></section>`);
}
function vSettings() {
  const s = S.pf.settings || {}, src = S.market.sources || {};
  const th = document.documentElement.dataset.theme || '';
  openSheet(sheetTop('Einstellungen') + card('Darstellung', 'Gilt nur auf diesem Gerät', seg('theme', ['System', 'Hell', 'Dunkel'], th === 'light' ? 'Hell' : th === 'dark' ? 'Dunkel' : 'System') +
    `<p class="hint">Das Auge oben verbirgt alle Euro-Beträge, etwa wenn jemand mitschaut; Kurse und Prozente bleiben sichtbar. Tastenkürzel am PC: / Suche, 1 bis 5 Reiter, B Beträge verbergen, Esc schließt die Detailansicht. · Version ${esc(APP_V)}</p><div class="btnrow"><button class="btn sm ghost" data-act="reloadapp">Neueste Version laden</button></div>`)
  + card('Push aufs Handy', 'Über die kostenlose App ntfy', `<form id="f-ntfy"><div class="f"><label>Geheimer Kanalname</label><input name="topic" value="${esc(s.ntfy_topic || '')}" placeholder="noch keiner" autocomplete="off" autocapitalize="off"></div>
    <p class="hint">In der ntfy-App auf „Thema abonnieren“ tippen und genau diesen Namen eintragen. Wer den Namen kennt, kann die Alerts mitlesen: also zufällig wählen und nicht weitergeben.</p>
    <div class="btnrow"><button class="btn" type="submit">Speichern</button><button class="btn ghost" type="button" data-act="gentopic">Zufälligen Namen erzeugen</button><button class="btn ghost" type="button" data-act="testpush">Test senden</button></div></form>`)
  + card('Starke Bewegungen', 'Meldung aufs Handy mit Einordnung der Bewertung', `<form id="f-moves"><div class="f2"><div class="f"><label>Aktien ab ± %</label><input name="stock" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(s.move_stock ?? 5)}"></div><div class="f"><label>Krypto ab ± %</label><input name="crypto" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(s.move_crypto ?? 8)}"></div></div>
    <p class="hint">Bewegt sich ein Titel aus Depot oder Watchlist an einem Tag stärker, kommt eine Meldung, und bei jeder weiteren vollen Stufe (etwa 10 % und 15 %) noch eine: ob er nach Faustregel unter- oder überbewertet ist und wo die nächste Nachkauf-Zone liegt. 0 schaltet die Meldung aus. Keine Anlageberatung.</p>
    <div class="btnrow"><button class="btn" type="submit">Speichern</button></div></form>`)
  + card('Daten', '', `<div class="rows"><div class="row"><div class="l"><div class="t" style="font-size:15px">Kurse</div><div class="m">${esc(ago(S.market.updated))}</div></div></div>
    <div class="row"><div class="l"><div class="t" style="font-size:15px">Kennzahlen und Verläufe</div><div class="m">${esc(ago(S.daily.updated))}</div></div></div>
    <div class="row"><div class="l"><div class="t" style="font-size:15px">KI-Recherche</div><div class="m">${S.analysis.updated ? esc(ago(S.analysis.updated)) : 'noch nicht gelaufen'}</div></div></div></div>
    <p class="tiny muted" style="margin:10px 0 0">Quellen beim letzten Lauf: ${Object.entries(src).map(([n, x]) => `${esc(n)} ${x.fehler ? '(' + x.fehler + ' Fehler)' : 'ok'}`).join(' · ') || '–'}</p>
    <div class="btnrow"><button class="btn ghost" data-act="refreshall">Alles neu laden und berechnen</button><button class="btn ghost" data-act="export">Depot als Datei sichern</button></div>`)
  + (LOCAL ? '' : card('Verbindung', 'Privates Daten-Repo auf GitHub', `<p class="empty">${esc(cfg.owner)}/${esc(cfg.dataRepo)}</p><div class="btnrow"><button class="btn danger" data-act="logout">Auf diesem Gerät abmelden</button></div>`)));
}
function renderSetup() {
  const host = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '', repo = location.pathname.split('/').filter(Boolean)[0] || 'depot';
  $('#app').innerHTML = `<div class="wrap" style="max-width:560px"><header class="top"><div><h1>Depot verbinden</h1><p class="sub">Einmal pro Gerät. Die Angaben bleiben in diesem Browser.</p></div></header>
    <section class="card"><form id="f-setup"><div class="f"><label>GitHub-Benutzername</label><input name="owner" required value="${esc(host)}" autocapitalize="off" autocomplete="off"></div>
    <div class="f2"><div class="f"><label>Daten-Repo (privat)</label><input name="dataRepo" required value="depot-daten" autocapitalize="off"></div><div class="f"><label>App-Repo</label><input name="appRepo" required value="${esc(repo)}" autocapitalize="off"></div></div>
    <div class="f"><label>Zugangsschlüssel (Fine-grained Token)</label><input name="token" type="password" required autocomplete="off" placeholder="github_pat_…"></div>
    <p class="hint">Der Schlüssel braucht nur Zugriff auf diese beiden Repos. Wie du ihn anlegst, steht in der Anleitung.</p>
    <div class="btnrow"><button class="btn" type="submit">Verbinden</button></div></form></section></div>`;
}

/* ---------------------------------------------------------------- Bedienung */
const numIn = v => { const s = String(v || '').trim().replace(/\s/g, ''); return parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); };
const cleanSym = (kind, s) => { s = String(s || '').toUpperCase().trim().replace(/\s+/g, ''); return kind === 'crypto' ? s.replace(/[-/]?(USDT?|EUR)$/, '') || s : s; };
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, v = b.dataset.v, id = b.dataset.id, key = b.dataset.key;
  if (act === 'tab') { S.tab = v; closeSheet(); render(); window.scrollTo(0, 0); }
  else if (act === 'flt') { S.flt[id] = v; render(); }
  else if (act === 'sort') { const cur = S.sort[id]; S.sort[id] = cur && cur[0] === v ? [v, -cur[1]] : [v, b.dataset.num === '1' ? -1 : 1]; render(); }
  else if (act === 'range') { S.range = v; render(); }
  else if (act === 'mode') { S.mode = Object.keys(MODES).find(k => MODES[k] === v) || 'positionen'; render(); }
  else if (act === 'hm') { S.hm = v; render(); }
  else if (act === 'cmp') { S.cmp = v; render(); }
  else if (act === 'reloadapp') location.replace(location.pathname + '?r=' + Date.now().toString(36));   // umgeht jeden Zwischenspeicher
  else if (act === 'hide') { S.hide = !S.hide; try { localStorage.setItem('depot_hide', S.hide ? '1' : ''); } catch (e) { /* egal */ } render(); if (S.sheetKey) vAsset(S.sheetKey); }
  else if (act === 'hv') { S.hv = v; render(); }
  else if (act === 'jkr') { S.jkr = v; render(); }
  else if (act === 'rsk') { S.rsk = v; render(); }
  else if (act === 'rsy') { S.rsy = v; render(); }
  else if (act === 'ans') { const q = QUESTIONS.find(x => x.id === id); if (q) { const val = q.o.find(o => String(o[0]) === v)[0]; S.pf.profile = S.pf.profile || {}; S.pf.profile.answers = Object.assign({}, S.pf.profile.answers, {[id]: val}); S.pf.profile.updated = new Date().toISOString().slice(0, 10); await savePf('Antwort gespeichert'); } }
  else if (act === 'startprof') { S.pf.profile = {answers: {}, updated: new Date().toISOString().slice(0, 10), source: 'Eigene Antworten'}; await savePf('Profil angelegt'); }
  else if (act === 'rcm') { S.rcm = v === 'Ideal-Depot' ? 'ideal' : 'depot'; render(); }
  else if (act === 'sv') { S.sv = v; try { localStorage.setItem('depot_sv', v); } catch (e) { /* egal */ } render(); window.scrollTo(0, 0); }
  else if (act === 'scf') { S.scf = v; S.scAll = false; render(); }
  else if (act === 'btv') { S.btv = v; render(); }
  else if (act === 'scall') { S.scAll = true; render(); }
  else if (act === 'scx') { S.scx = S.scx === key ? null : key; if (S.tab !== 'strat') { S.tab = 'strat'; S.scf = 'Alle'; S.scAll = true; } render(); }
  else if (act === 'scwatch') { const [k, sy] = key.split(':'); S.pf.watchlist.push({id: uid(), kind: k, symbol: sy, name: nameOf(key)}); await savePf('Auf der Watchlist. Kennzahlen und Recherche kommen mit dem nächsten Tageslauf.'); }
  else if (act === 'smk') { S.smk = v === 'Bitcoin' ? 'btc' : 'stocks'; render(); }
  else if (act === 'dep') { setDep(v); render(); }
  else if (act === 'alloc') { S.alloc = v; render(); }
  else if (act === 'secb') { S.secb = v; render(); }
  else if (act === 'grokcopy') { // Kopieren und Öffnen im selben Tipp, sonst blockt Safari das neue Fenster
    const keys = grokParts(calc())[+v] || [], txt = grokPrompt(keys); S.grokKeys = keys;
    const manual = () => openSheet(sheetTop('Frage für Grok', 'Text markieren, kopieren und bei Grok einfügen') + `<textarea rows="14" readonly>${esc(txt)}</textarea>`);
    try { navigator.clipboard.writeText(txt).then(() => toast('Frage kopiert. Bei Grok einfügen und absenden.', 4000), manual); } catch (e) { manual(); }
    window.open('https://grok.com/', '_blank', 'noopener'); }
  else if (act === 'groksave') { const t = ($('#grokans') || {}).value || '';
    try { const n = saveGrok(t, calc()); await savePf(`Stimmung für ${n} Titel gespeichert`); } catch (e) { toast(e.message || 'Speichern fehlgeschlagen', 4500); } }
  else if (act === 'theme') { applyTheme(v === 'Hell' ? 'light' : v === 'Dunkel' ? 'dark' : 'system'); vSettings(); render(); }
  else if (act === 'searchopen') { const t = $('.top'); t.classList.add('searching'); $('#q').focus(); }
  else if (act === 'calf') { S.calFilter = v; render(); }
  else if (act === 'flowwin') { S.flowWin = v.startsWith('4') ? '4' : '24'; if (S.sheetKey) vAsset(S.sheetKey); else render(); }
  else if (act === 'arange') { S.assetRange = v; vAsset(S.sheetKey); }
  else if (act === 'open') { const q = $('#qres'); if (q) q.hidden = true; vAsset(key); }
  else if (act === 'close') closeSheet();
  else if (act === 'refresh') refresh('fast');
  else if (act === 'refreshall') { closeSheet(); toast('Berechne neu, das dauert einen Moment'); refresh('all'); }
  else if (act === 'settings') vSettings();
  else if (act === 'addtx') formTx(null, key);
  else if (act === 'edittx') formTx(S.pf.transactions.find(t => t.id === id));
  else if (act === 'deltx') { if (confirm('Diese Buchung löschen?')) { S.pf.transactions = S.pf.transactions.filter(t => t.id !== id); closeSheet(); await savePf('Buchung gelöscht'); } }
  else if (act === 'addwatch') formWatch();
  else if (act === 'watchkey') { const [k, s] = key.split(':'); S.pf.watchlist.push({id: uid(), kind: k, symbol: s, name: nameOf(key)}); await savePf('Auf der Watchlist'); vAsset(key); }
  else if (act === 'unwatch') { S.pf.watchlist = S.pf.watchlist.filter(w => keyOf(w.kind, w.symbol) !== key); closeSheet(); await savePf('Entfernt'); }
  else if (act === 'addalert') formAlert(key);
  else if (act === 'levelalert') { const x = toShow(key, parseFloat(v)); formAlert(key, isNaN(x) ? v : +x.toFixed(x < 1 ? 4 : 2)); }
  else if (act === 'delalert') { if (confirm('Diesen Alert löschen?')) { S.pf.alerts = S.pf.alerts.filter(a => a.id !== id); await savePf('Alert gelöscht'); } }
  else if (act === 'rearm') { const a = S.pf.alerts.find(x => x.id === id); if (a) { a.id = uid(); await savePf('Alert ist wieder aktiv'); } }
  else if (act === 'gentopic') { const a = new Uint8Array(12); crypto.getRandomValues(a); document.querySelector('#f-ntfy [name=topic]').value = 'depot-' + [...a].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 20); }
  else if (act === 'testpush') {
    const topic = document.querySelector('#f-ntfy [name=topic]').value.trim(); if (!topic) return toast('Erst einen Kanalnamen eintragen');
    try { const r = await fetch('https://ntfy.sh', {method: 'POST', body: JSON.stringify({topic, title: 'Depot: Test', message: 'Push funktioniert. So kommen deine Alerts an.', tags: ['white_check_mark']})}); toast(r.ok ? 'Test gesendet' : 'ntfy hat abgelehnt'); }
    catch (e) { toast('ntfy nicht erreichbar'); }
  }
  else if (act === 'export') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.pf, null, 1)], {type: 'application/json'})); a.download = 'depot-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); }
  else if (act === 'logout') { if (confirm('Verbindung auf diesem Gerät entfernen?')) { localStorage.removeItem('depot_cfg'); location.reload(); } }
});
document.addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target, d = Object.fromEntries(new FormData(f).entries());
  if (f.id === 'f-setup') {
    cfg = {owner: d.owner.trim(), dataRepo: d.dataRepo.trim(), appRepo: d.appRepo.trim(), token: d.token.trim()};
    $('#app').innerHTML = '<div class="wrap"><p class="empty">Verbinde …</p></div>';
    await loadAll();
    if (S.err) { const m = S.err; cfg = null; renderSetup(); return toast(m, 5000); }
    localStorage.setItem('depot_cfg', JSON.stringify(cfg)); return render();
  }
  if (f.id === 'f-moves') { S.pf.settings = Object.assign({}, S.pf.settings, {move_stock: Math.max(0, parseFloat(d.stock) || 0), move_crypto: Math.max(0, parseFloat(d.crypto) || 0)}); return savePf('Gespeichert'); }
  if (f.id === 'f-ntfy') { S.pf.settings = Object.assign({}, S.pf.settings, {ntfy_topic: d.topic.trim()}); return savePf('Kanal gespeichert'); }
  const kind = d.kind, symbol = cleanSym(kind, d.symbol);
  if (!symbol) return toast('Kürzel fehlt');
  if (f.id === 'f-tx') {
    const qty = numIn(d.qty), price = numIn(d.price), fee = numIn(d.fee) || 0;
    if (!(qty > 0) || !(price >= 0)) return toast('Stückzahl und Preis prüfen');
    const t = {id: f.dataset.id || uid(), type: d.type, kind, symbol, date: d.date, qty, price, currency: d.currency, fee, note: d.note.trim(), source: 'manual'};
    if (d.depot) t.depot = d.depot;
    if (d.type === 'sell') { const keep = S.dep; setDep(t.depot || 'main');   // Bestand im Depot der Buchung prüfen
      const p = calc().pos.find(x => x.key === keyOf(kind, symbol)), old = S.pf.transactions.find(x => x.id === t.id);
      setDep(keep);
      if (!p || p.qty + (old && old.type === 'sell' ? old.qty : 0) < qty - 1e-9) return toast('So viele Stück hast du in diesem Depot nicht'); }
    const i = S.pf.transactions.findIndex(x => x.id === t.id);
    if (i >= 0) S.pf.transactions[i] = Object.assign({}, S.pf.transactions[i], t); else S.pf.transactions.push(t);
  } else if (f.id === 'f-watch') {
    if (S.pf.watchlist.some(w => keyOf(w.kind, w.symbol) === keyOf(kind, symbol))) return toast('Steht schon auf der Watchlist');
    S.pf.watchlist.push({id: uid(), kind, symbol, note: d.note.trim()});
  } else if (f.id === 'f-alert') {
    const value = numIn(d.value); if (isNaN(value)) return toast('Schwelle prüfen');
    if (d.type.startsWith('funding') && kind !== 'crypto') return toast('Funding-Alerts gibt es nur für Coins');
    const al = {id: uid(), kind, symbol, type: d.type, value, note: d.note.trim(), created: new Date().toISOString()};
    if (d.type.startsWith('price')) al.currency = kind === 'crypto' ? 'USD' : 'EUR';
    S.pf.alerts.push(al);
  } else return;
  closeSheet();
  const fresh = !(S.market.assets || {})[keyOf(kind, symbol)] || !(S.daily.assets || {})[keyOf(kind, symbol)];
  if (await savePf() && fresh) refresh('all', true);
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.matches('tr[data-act]')) ev.target.click();
  if (ev.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  if (ev.key === '/' && !ev.target.matches('input,textarea,select') && $('#q')) { ev.preventDefault(); $('#q').focus(); }
  // Tastenkürzel am PC: 1 bis 6 wechseln den Reiter, B verbirgt oder zeigt die Beträge
  if (!ev.target.matches('input,textarea,select') && !ev.metaKey && !ev.ctrlKey && !ev.altKey && $('#sheet').hidden) {
    const t = TABS[+ev.key - 1];
    if (t) { S.tab = t[0]; render(); window.scrollTo(0, 0); }
    else if (ev.key === 'b' || ev.key === 'B') { const b = document.querySelector('[data-act="hide"]'); if (b) b.click(); }
  }
});
document.addEventListener('focusout', ev => { if (ev.target.id === 'q' && !ev.target.value) setTimeout(() => { const t = $('.top'); if (t) t.classList.remove('searching'); }, 150); });
document.addEventListener('input', ev => {
  if (ev.target.id !== 'q') return;
  const q = ev.target.value.trim().toLowerCase(), box = $('#qres');
  const hits = !q ? [] : allTracked().filter(k => k.split(':')[1].toLowerCase().includes(q) || nameOf(k).toLowerCase().includes(q) || shortName(k).toLowerCase().includes(q))
    .sort((a, b) => (b.split(':')[1].toLowerCase().startsWith(q) - a.split(':')[1].toLowerCase().startsWith(q))).slice(0, 8);
  box.hidden = !q;
  box.innerHTML = hits.length ? hits.map(k => `<button data-act="open" data-key="${esc(k)}">${logo(k)}<span class="ts"><b>${esc(shortName(k))}</b> <span class="muted">${esc(tick(k))}</span></span>${chgA(A(k).change_pct)}</button>`).join('') : '<p class="empty" style="padding:10px 12px">Kein Titel gefunden. Neue Titel fügst du in der Watchlist hinzu.</p>';
});
// Kuchendiagramm: Anteil des Segments in der Mitte zeigen, solange der Zeiger darauf liegt
document.addEventListener('mouseover', ev => {
  const sl = ev.target.closest('[data-slice]'), box = ev.target.closest('.alloc');
  if (!box) return;
  const dc = box.querySelector('.dc'), path = sl && box.querySelector(`path[data-slice="${sl.dataset.slice}"]`);
  box.querySelectorAll('path').forEach(p => p.style.opacity = path && p !== path ? '.35' : '');
  dc.innerHTML = path ? `<span class="n">${esc(path.dataset.name)}</span><b class="num">${esc(path.dataset.pct)}</b><span class="n num">${esc(path.dataset.val)}</span>` : `<span class="n">${esc(dc.dataset.defN)}</span><b class="num">${esc(dc.dataset.defV)}</b>`;
});
document.addEventListener('mouseleave', ev => { if (ev.target.classList && ev.target.classList.contains('alloc')) { ev.target.querySelectorAll('path').forEach(p => p.style.opacity = ''); const dc = ev.target.querySelector('.dc'); dc.innerHTML = `<span class="n">${esc(dc.dataset.defN)}</span><b class="num">${esc(dc.dataset.defV)}</b>`; } }, true);
document.addEventListener('click', ev => { const q = $('#qres'); if (q && !ev.target.closest('.search')) q.hidden = true; });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawCharts, 150); });
setInterval(() => { if (!document.hidden) checkVersion(); }, 5 * 6e4);   // offene Tabs am PC: alle 5 Minuten nach neuer Version sehen
document.addEventListener('visibilitychange', async () => { if (document.hidden) return; checkVersion(); if (!S.pf) return; if (Date.now() - (S.loaded || 0) > 6e4 && $('#sheet').hidden && !S.auto) { await loadAll(); S.loaded = Date.now(); render(); } autoRefresh(); });
(async function start() {
  if (!LOCAL && !cfg) return render();
  $('#app').innerHTML = '<div class="wrap"><p class="empty">Lade Depot …</p></div>';
  await loadAll(); S.loaded = Date.now(); render();
  autoRefresh(); loadLogos(); checkVersion();
})();
