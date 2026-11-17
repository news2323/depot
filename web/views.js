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
  logo: '<path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/>',
};
const svg = n => `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`;
const TABS = [['home', 'Übersicht'], ['depot', 'Positionen'], ['watch', 'Watchlist'], ['cal', 'Termine']];
const CAT = {Earnings: ['blue', 'Quartalszahlen'], Makro: ['teal', 'Konjunktur'], Fed: ['purple', 'Notenbank'], IPO: ['pink', 'IPO'], Dividende: ['good', 'Ex-Dividende'], Zahltag: ['good', 'Zahltag'], Krypto: ['warn', 'Krypto'], Event: ['', 'Event']};
const isMine = e => !e.market;
const ALERT_TYPES = {price_above: 'Kurs steigt über', price_below: 'Kurs fällt unter', change_above: 'Tagesplus größer als (%)',
  change_below: 'Tagesminus größer als (%)', funding_above: 'Funding über (% je 8 Std.)', funding_below: 'Funding unter (% je 8 Std.)'};
const valClass = l => !l ? '' : /unter|niedrig|abgekühlt/.test(l) ? 'good' : /über|hoch/.test(l) ? 'bad' : '';
const toneClass = t => ({good: 'good', bad: 'bad', warn: 'warn'}[t] || '');
const card = (title, sub, inner, extra = '', cls = '') => `<section class="card ${cls}"><div class="head"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${extra}</div>${inner}</section>`;
const tile = (l, v, n = '', cls = '') => `<div class="tile"><div class="l">${l}</div><div class="v num ${cls}">${v}</div>${n ? `<div class="n">${n}</div>` : ''}</div>`;
const stat = (l, v, n = '', cls = '') => `<div class="stat"><div class="l">${l}</div><div class="v num ${cls}">${v}</div>${n ? `<div class="n">${n}</div>` : ''}</div>`;
const seg = (act, opts, cur) => `<div class="seg">${opts.map(o => `<button data-act="${act}" data-v="${o}" class="${o === cur ? 'on' : ''}">${o}</button>`).join('')}</div>`;
const MODES = {positionen: 'Heutige Positionen', kauf: 'Seit Kauf'};

function render() {
  if (!LOCAL && !cfg) return renderSetup();
  const c = calc(), now = new Date(), upd = S.market.updated;
  const stale = upd && Date.now() - Date.parse(upd) > 45 * 6e4;
  if (!TABS.some(t => t[0] === S.tab)) S.tab = 'home';
  if (!MODES[S.mode]) S.mode = 'positionen';
  const view = {home: vHome, depot: vDepot, watch: vWatch, cal: vCal}[S.tab](c);
  const title = Object.fromEntries(TABS)[S.tab];
  $('#app').innerHTML = `<div class="shell">${sideBar(upd, stale)}
  <main class="main"><div class="inner">
    <header class="top"><div><h1>${title}</h1>
      <p class="sub"><span class="live ${stale ? 'old' : ''}"></span><span>Kurse ${esc(ago(upd))}<span class="hm"> · ${WT_LANG[now.getDay()]}, ${now.getDate()}. ${MON[now.getMonth()]}</span></span></p></div>
      <div class="topact"><div class="search">${svg('search')}<input id="q" type="search" placeholder="Titel suchen" autocomplete="off" aria-label="Titel suchen"><kbd>/</kbd><div id="qres" class="qres" hidden></div></div>
      <button class="iconbtn mobs" data-act="searchopen" title="Suchen">${svg('search')}</button>
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

const COL = {
  name: {id: 'name', label: 'Titel', cls: 'c-name', sort: r => r.key.split(':')[1], html: r => `<span class="sym">${esc(r.key.split(':')[1])}</span><div class="ts">${esc(nameOf(r.key))}</div>`},
  spark: {id: 'spark', label: '30 Tage', cls: 'c-spark hm', html: r => spark(r.key)},
  price: {id: 'price', label: 'Kurs', cls: 'r hm', html: r => `<span class="num">${px(r.key, A(r.key).price)}</span>`},
  day: {id: 'day', label: 'Heute', cls: 'r', num: true, sort: r => A(r.key).change_pct, html: r => chg(A(r.key).change_pct)},
  m1: {id: 'm1', label: '1 Monat', cls: 'r hm', num: true, sort: r => (D(r.key).tech || {}).perf_1m, html: r => chg((D(r.key).tech || {}).perf_1m, 1)},
  rng: {id: 'rng', label: '52 Wochen', cls: 'r hm', num: true, sort: r => { const t = D(r.key).tech || {}, p = A(r.key).price; return t.high52 > t.low52 && p != null ? (p - t.low52) / (t.high52 - t.low52) : null; }, html: r => rangeBar(r.key)},
  zone: {id: 'zone', label: 'Nachkauf-Zone', cls: 'r hm', num: true, sort: r => { const l = zoneOf(r.key); return l ? l.price / A(r.key).price - 1 : null; }, html: r => { const l = zoneOf(r.key); return l ? `<div class="num">${px(r.key, l.price)}</div><div class="ts num">${nf((l.price / A(r.key).price - 1) * 100, 1)} %</div>` : '<span class="ts">–</span>'; }},
  value: {id: 'value', label: 'Wert', cls: 'r', num: true, sort: r => r.p.value, html: r => `<div class="num tn">${eur(r.p.value, 0)}</div><div class="ts num hd ${sign(r.p.pnl)}">${pctS(r.p.pnlPct, 1)}</div>`},
  pnl: {id: 'pnl', label: 'Gewinn', cls: 'r hm', num: true, sort: r => r.p.pnlPct, html: r => `<div class="num ${sign(r.p.pnl)}">${eurS(r.p.pnl)}</div><div class="ts num">${pctS(r.p.pnlPct, 1)}</div>`},
  weight: {id: 'weight', label: 'Anteil', cls: 'r hm', num: true, sort: r => r.p.weight, html: r => `<div class="wbar2"><span><i style="width:${Math.min(100, r.p.weight * 2.5)}%"></i></span><b class="num">${nf(r.p.weight, 1)} %</b></div>`},
};
function tbl(id, cols, rows, def) {
  const st = (S.sort || {})[id] || def, col = cols.find(c => c.id === st[0] && c.sort) || cols.find(c => c.sort);
  const val = r => { const x = col.sort(r); return x == null || (typeof x === 'number' && isNaN(x)) ? null : x; };
  rows = [...rows].sort((a, b) => { const x = val(a), y = val(b); if (x == null || y == null) return (x == null) - (y == null); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * st[1]; });
  if (!rows.length) return '<p class="empty">Keine Titel in dieser Auswahl.</p>';
  return `<div class="tblwrap"><table class="tbl"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}${c.sort ? ' s' : ''}${col.id === c.id ? ' on' : ''}"${c.sort ? ` data-act="sort" data-id="${id}" data-v="${c.id}" data-num="${c.num ? 1 : 0}"` : ''}>${c.label}${col.id === c.id ? `<span class="ar">${st[1] < 0 ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr data-act="open" data-key="${esc(r.key)}" tabindex="0">${cols.map(c => `<td class="${c.cls || ''}">${c.html(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ---------------------------------------------------------------- Übersicht */
// Feste Farben je Anlageklasse (Reihenfolge der geprüften Palette), Sektoren und Währungen nach Größe, Rest als „Weitere“.
const CLASS_ORDER = ['Aktien', 'ETFs', 'Krypto', 'Rohstoffe'];
function allocation(c, dim) {
  const by = {};
  const keyFn = dim === 'Sektor' ? p => sectorOf(p.key) : dim === 'Währung' ? p => (isCoin(p.key) ? 'USD' : curOf(p.key)) : p => assetClass(p.key);
  c.held.forEach(p => { if (p.value > 0) { const k = keyFn(p); by[k] = (by[k] || 0) + p.value; } });
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
  return `<div class="stack" role="img" aria-label="Aufteilung nach ${esc(dim)}">${groups.map(g => `<i style="width:${g.v / tot * 100}%;background:${g.col}" title="${esc(g.name)} ${nf(g.v / tot * 100, 1)} %"></i>`).join('')}</div>
    <div class="legendrows">${groups.map(g => `<div><i style="background:${g.col}"></i><span>${esc(g.name)}${g.n ? ` <span class="muted">(${g.n})</span>` : ''}</span><span class="e num">${eur(g.v, 0)}</span><span class="p num">${nf(g.v / tot * 100, 1)} %</span></div>`).join('')}</div>`;
}
function attribution(c) {
  const ps = c.held.filter(p => p.dayEur != null && Math.abs(p.dayEur) >= 0.005);
  if (!ps.length) return '<p class="empty">Noch keine Tagesbewegung.</p>';
  const ups = ps.filter(p => p.dayEur > 0).sort((a, b) => b.dayEur - a.dayEur).slice(0, 5);
  const dns = ps.filter(p => p.dayEur < 0).sort((a, b) => a.dayEur - b.dayEur).slice(0, 5);
  const mx = Math.max(...ups.concat(dns).map(p => Math.abs(p.dayEur))) || 1;
  const row = p => { const w = Math.abs(p.dayEur) / mx * 100, up = p.dayEur >= 0;
    return `<button data-act="open" data-key="${esc(p.key)}" title="${esc(p.name)}: ${pctS(p.dayPct)}"><span class="sym">${esc(p.symbol)}</span>
      <span class="dv"><span>${up ? '' : `<i style="width:${w}%;background:var(--down)"></i>`}</span><span>${up ? `<i style="width:${w}%;background:var(--up)"></i>` : ''}</span></span>
      <span class="v num ${up ? 'pos' : 'neg'}">${eurS(p.dayEur)}</span></button>`; };
  return `<div class="attr">${ups.map(row).join('')}${ups.length && dns.length ? '<hr>' : ''}${dns.map(row).join('')}</div>`;
}
function vHome(c) {
  if (!c.txs.length) return `<div class="grid">${card('Willkommen', 'Trag deine ersten Käufe ein, dann rechnet das Dashboard los.',
    `<p class="body">Du gibst Aktien und Coins mit Kaufdatum, Stückzahl und Preis ein. Kurse, Dividenden, Quartalstermine,
    Krypto-Flows und Nachkauf-Zonen kommen automatisch dazu.</p><div class="btnrow"><button class="btn" data-act="addtx">Ersten Kauf eintragen</button>
    <button class="btn ghost" data-act="addwatch">Titel beobachten</button></div>`)}</div>`;
  const ps = perfStats(), ap = S.analysis.portfolio;
  const stocks = c.held.filter(p => assetClass(p.key) === 'Aktien' || p.kind === 'crypto'), topOne = stocks[0];
  const top5 = c.held.slice(0, 5).reduce((s, p) => s + p.weight, 0);
  const cal = (S.digest.calendar || []).filter(e => isMine(e) || e.category === 'Fed' || e.category === 'Makro').slice(0, 6);
  const alloc = S.alloc || 'Anlageklasse', hm = S.hm || 'Heute';
  const perf = ps ? `<div class="perf">${ps.periods.map(x => `<div><div class="l">${x.label}</div><div class="v num ${sign(x.v)}">${x.v == null ? '–' : pctS(x.v, 1)}</div><div class="b num">${x.b == null ? '&nbsp;' : 'S&amp;P ' + pctS(x.b, 1)}</div></div>`).join('')}</div>` : '';
  return `<div class="g12"><div class="colstack span8">
    <section class="card hero"><div class="herotop"><div><div class="eyebrow">Depotwert</div><div class="nav-value num">${eur(c.value)}</div>
      <div class="chgrow">${pill(c.dayPct)}<span class="num ${sign(c.dayEur)}">${eurS(c.dayEur)}</span><span class="muted">heute</span></div></div>
      <div class="heroside"><div class="eyebrow">Gewinn offen</div><div class="num ${sign(c.pnl)}" style="font-size:20px;font-weight:650;margin-top:4px">${eurS(c.pnl)}</div><div class="small muted num">${pctS(c.pnlPct, 1)} auf ${eur(c.cost, 0)}</div></div></div>
      ${perf}
      <div class="charthead">${seg('mode', Object.values(MODES), MODES[S.mode])}${seg('range', Object.keys(RANGES), S.range)}</div>
      <div class="chart" id="ch-main"></div><div id="lg-main"></div>
      <p class="hint">${S.mode === 'positionen' ? 'Wertentwicklung und Diagramm: deine heutigen Bestände, mit den Kursen der Vergangenheit zurückgerechnet. S&P 500 und Bitcoin mit gleichem Startwert, alles in Euro.' : 'Depotwert und eingesetztes Geld seit deinen eingetragenen Käufen.'}</p></section>
    ${card('Heatmap', 'Fläche nach Anteil am Depot, Farbe nach ' + (hm === 'Heute' ? 'Tagesbewegung' : 'Gewinn seit Kauf'), `<div class="tm" id="tm"></div>
      <div class="scale"><span class="num">${hm === 'Heute' ? '−3 %' : '−50 %'}</span><i></i><span class="num">${hm === 'Heute' ? '+3 %' : '+50 %'}</span><span style="margin-left:auto">Krypto-Skala doppelt so weit</span></div>`, seg('hm', ['Heute', 'Seit Kauf'], hm))}
    </div>
    <div class="colstack span4">
      ${card('Kennzahlen', '', `<div class="kpis">
        <div><span class="l">Gewinn offen</span><span class="v num ${sign(c.pnl)}">${eurS(c.pnl)}<small>${pctS(c.pnlPct, 1)}</small></span></div>
        <div><span class="l">Eingesetzt</span><span class="v num">${eur(c.cost, 0)}</span></div>
        <div><span class="l">Realisiert<small>aus Verkäufen</small></span><span class="v num ${sign(c.realized)}">${eurS(c.realized)}</span></div>
        <div><span class="l">Dividenden pro Jahr<small>erwartet, brutto</small></span><span class="v num">${eur(c.divYear, 0)}<small class="muted">${c.value ? nf(c.divYear / c.value * 100, 2) + ' % Rendite' : ''}</small></span></div>
        <div><span class="l">Positionen</span><span class="v num">${c.held.length}<small class="muted">${CLASS_ORDER.map(k => [k, c.held.filter(p => assetClass(p.key) === k).length]).filter(x => x[1]).map(x => x[1] + ' ' + x[0]).join(' · ')}</small></span></div></div>`)}
      ${card('Risiko', 'Heutige Positionen, letztes Jahr', `<div class="stats">
        ${stat('Schwankung', ps && ps.vol != null ? nf(ps.vol, 1) + ' %' : '–', 'pro Jahr')}${stat('Größter Rückgang', ps && ps.maxDD != null ? nf(ps.maxDD, 1) + ' %' : '–', 'vom Hoch', 'neg')}
        ${stat('Beta', ps && ps.beta != null ? nf(ps.beta, 2) : '–', 'zum S&P 500')}${stat('Krypto-Anteil', nf(c.cryptoShare || 0, 1) + ' %')}
        ${stat('Größte Einzelposition', topOne ? nf(topOne.weight, 1) + ' %' : '–', topOne ? esc(topOne.symbol) + ' · ohne ETFs' : '')}${stat('Fünf größte', nf(top5, 0) + ' %', 'vom Depot')}</div>`)}
      ${card('Beitrag heute', 'Wer den Tag bewegt hat, in Euro', attribution(c))}
    </div>
    ${card('Allokation', '', allocation(c, alloc), seg('alloc', ['Anlageklasse', 'Sektor', 'Währung'], alloc), 'span7')}
    ${card('Nächste Termine', 'Deine Titel, Fed und Konjunktur', cal.length ? calCompact(cal) + `<div class="btnrow" style="margin-top:10px"><button class="btn sm ghost" data-act="tab" data-v="cal">Alle Termine</button></div>` : '<p class="empty">Keine Termine bekannt.</p>', '', 'span5')}
    ${ap ? `<details class="card fold span12"><summary><div><h2>Einschätzung der Recherche</h2><p class="sub">${esc(ap.headline)} · ${esc(ago(ap.at))}</p></div><span class="chev"></span></summary>
      <div class="grid half"><div><p class="body">${esc(ap.summary)}</p>${(ap.risks || []).length ? `<p class="sh">Risiken</p><ul class="dots">${ap.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</div>
      ${(ap.buy_candidates || []).length ? `<div><p class="sh" style="margin-top:0">Nachkauf-Kandidaten</p><div class="rows">${ap.buy_candidates.map(b => `<div class="row"><div class="l"><div class="t"><span class="sym" style="margin:0;color:var(--ink)">${esc(b.symbol)}</span><span>${esc(b.level)}</span></div><div class="x">${esc(b.reason)}</div></div></div>`).join('')}</div></div>` : ''}</div>
      <p class="hint">Recherche von Claude. Keine Anlageberatung.</p></details>` : ''}
  </div>`;
}
function drawCharts() {
  const c = calc();
  if ($('#ch-main')) {
    if (S.mode === 'positionen') {
      const bc = backcast();
      if (bc && bc.d.length > 1) {
        const from = bc.d[bc.d.length - 1] - RANGES[S.range];
        let i0 = bc.d.findIndex(d => d >= from); if (i0 < 0) i0 = 0;
        const d = bc.d.slice(i0), base = bc.v[i0], eu = v => nf(v, 0) + ' €';
        const s = [{name: 'Heutige Positionen', color: 'var(--accent)', area: true, pts: d.map((x, i) => [x, bc.v[i0 + i]])}];
        const sp = benchIndex('SP500', d), bt = benchIndex('BTC', d);
        if (sp) s.push({name: 'S&P 500', color: 'var(--s3)', thin: true, pts: d.map((x, i) => [x, base * sp[i]])});
        if (bt) s.push({name: 'Bitcoin', color: 'var(--s2)', thin: true, pts: d.map((x, i) => [x, base * bt[i]])});
        lineChart('#ch-main', s, {fmt: eu, label: 'Wertentwicklung der heutigen Positionen im Vergleich', height: 260});
        $('#lg-main').innerHTML = legend(s);
      } else $('#ch-main').innerHTML = '<p class="empty">Die Rückrechnung kommt mit der nächsten täglichen Aktualisierung.</p>';
    } else if (c.series.d.length > 1) {
      const from = c.series.d[c.series.d.length - 1] - RANGES[S.range];
      let i0 = c.series.d.findIndex(d => d >= from); if (i0 < 0) i0 = 0;
      const d = c.series.d.slice(i0);
      const s = [{name: 'Depotwert', color: 'var(--accent)', area: true, pts: d.map((x, i) => [x, c.series.v[i0 + i]])},
        {name: 'Eingesetzt', color: 'var(--ink3)', dash: true, thin: true, pts: d.map((x, i) => [x, c.series.inv[i0 + i]])}];
      lineChart('#ch-main', s, {fmt: v => nf(v, 0) + ' €', label: 'Depotwert seit Kauf', height: 260});
      $('#lg-main').innerHTML = legend(s);
    }
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
        title="${esc(p.symbol)} · ${esc(p.name)}: ${pctS(val, 2)} · ${nf(p.weight, 1)} % vom Depot"><span class="s">${esc(p.symbol)}</span><span><span class="p num">${pctS(val, 2)}</span><br><span class="w num">${nf(p.weight, 1)} %</span></span></button>`;
    }).join('');
  }
  const el = $('#ch-asset');
  if (el) {
    const key = el.dataset.key, h = D(key).hist, c2 = calc();
    if (h && h.d.length > 1) {
      const from = h.d[h.d.length - 1] - RANGES[S.assetRange || '1J'];
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
  const f = fltOn('depot'), rows = c.held.filter(p => f === 'Alle' || typeOf(p.key) === f).map(p => ({key: p.key, p}));
  const sumV = rows.reduce((s, r) => s + (r.p.value || 0), 0), sumP = rows.reduce((s, r) => s + (r.p.pnl || 0), 0), sumD = rows.reduce((s, r) => s + (r.p.dayEur || 0), 0);
  const txs = [...c.txs].reverse();
  return `<div class="grid">
    <section class="card"><div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${stat('Wert', eur(sumV, 0), rows.length + (rows.length === 1 ? ' Position' : ' Positionen'))}
      ${stat('Gewinn offen', eurS(sumP), sumV - sumP > 0 ? pctS(sumP / (sumV - sumP) * 100, 1) : '', sign(sumP))}${stat('Heute', eurS(sumD), '', sign(sumD))}${stat('Dividenden pro Jahr', eur(c.divYear, 0), 'erwartet, brutto')}</div></section>
    <section class="card"><div class="toolbar"><div>${flt('depot', ['Alle', 'Aktien', 'ETFs', 'Krypto'])}</div>
      <div class="sumline">Spalten per Klick sortieren, Zeile antippen für Analyse und Kennzahlen.</div>
      <button class="btn" data-act="addtx">Kauf oder Verkauf</button></div>
      ${c.held.length ? tbl('depot', [COL.name, COL.spark, COL.price, COL.day, COL.value, COL.pnl, COL.weight, COL.rng], rows, ['value', -1]) : '<p class="empty">Trag oben deinen ersten Kauf ein.</p>'}</section>
    ${divCard(c)}
    <details class="card fold"><summary><div><h2>Buchungen</h2><p class="sub">${txs.length} eingetragene Käufe und Verkäufe</p></div><span class="chev"></span></summary>
      ${txs.length ? `<div class="rows">${txs.map(t => `<button class="row" data-act="edittx" data-id="${esc(t.id)}"><div class="l">
      <div class="t"><span class="sym" style="margin:0;color:inherit">${esc(t.symbol)}</span><span>${t.type === 'buy' ? 'Kauf' : 'Verkauf'}${t.source && t.source !== 'manual' ? ' · ' + esc(t.source) : ''}</span></div><div class="m num">${dateDe(t.date)} · ${nf(t.qty, t.qty % 1 ? 4 : 0)} × ${money(t.price, t.currency)}</div></div>
      <div class="r"><span class="chip ${t.type === 'buy' ? 'good' : 'bad'}">${t.type === 'buy' ? '−' : '+'}${money(t.qty * t.price, t.currency)}</span></div></button>`).join('')}</div>` : '<p class="empty">Noch keine Buchungen.</p>'}
      <p class="hint">Der direkte Import aus Trade Republic oder comdirect ist vorbereitet, aber noch nicht aktiv. Jede Buchung merkt sich ihre Herkunft.</p></details>
  </div>`;
}

// Änderung der Gewinnschätzung in 90 Tagen (dieselbe Rechnung wie tracker/analytics.py est_change)
const estChg = f => { const v = f.est_chg_90d != null ? f.est_chg_90d : (f.est_eps != null && f.est_eps_90d ? (f.est_eps - f.est_eps_90d) / Math.abs(f.est_eps_90d) * 100 : null); return v == null ? null : Math.max(-100, Math.min(100, v)); };

function divCard(c) {
  const divs = c.held.filter(p => D(p.key).div && D(p.key).div.annual);
  return card('Dividenden', `Erwartet pro Jahr: ${eur(c.divYear)} brutto`, divs.length ? `<div class="rows tight two">${divs.sort((a, b) => (b.divYear || 0) - (a.divYear || 0)).map(p => { const d = D(p.key).div; return `<button class="row" data-act="open" data-key="${esc(p.key)}"><div class="l">
      <div class="t"><span class="sym" style="margin:0;color:inherit">${esc(p.symbol)}</span><span>${nf(d.yield_pct, 2)} % Rendite</span></div><div class="m num">${px(p.key, d.annual)} je Aktie · ${d.per_year || '–'}× jährlich${d.next_ex ? ' · Ex-Tag ' + dateDe(d.next_ex) + (d.next_ex_estimated ? ' (geschätzt)' : '') : ''}</div></div>
      <div class="r"><div class="v num">${eur(p.divYear)}</div><span class="muted tiny">pro Jahr</span></div></button>`; }).join('')}</div>` : '<p class="empty">Keine Dividendentitel im Depot.</p>');
}

function flowBlock(key) {
  const a = A(key), f = a.flow || {}, w = S.flowWin, rd = (a.flow_read || {})[w], sym = key.split(':')[1];
  const sp = (f.spot || {})[w], fu = (f.fut || {})[w], ch = w === '4' ? f.px_chg_4h : a.change_pct;
  const dv = r => { const p = Math.min(Math.abs(r || 0) / 0.12, 1) * 100; return `<div class="div2"><span>${r < 0 ? `<i style="width:${p}%;background:var(--down)"></i>` : ''}</span><span>${r >= 0 ? `<i style="width:${p}%;background:var(--up)"></i>` : ''}</span></div>`; };
  const fund = Object.entries(f.funding || {}).map(([v, x]) => `${esc(v)} ${nf(x, 4)} %`).join(' · ');
  return `<div><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div style="font-size:15px;font-weight:600"><span class="sym">${esc(sym)}</span> <span class="muted" style="font-weight:400">${esc(a.name || '')}</span></div>
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
function vWatch() {
  const wl = S.pf.watchlist || [], al = S.pf.alerts || [], st = S.state.alerts || {}, f = fltOn('watch');
  const rows = wl.map(w => ({key: keyOf(w.kind, w.symbol)})).filter(r => f === 'Alle' || typeOf(r.key) === f);
  return `<div class="grid">
    <section class="card"><div class="toolbar"><div>${flt('watch', ['Alle', 'Aktien', 'ETFs', 'Krypto'])}</div>
      <div class="sumline"><b>${rows.length}</b> Titel beobachtet · Zeile antippen für Analyse und Kennzahlen</div><button class="btn" data-act="addwatch">Titel hinzufügen</button></div>
      ${wl.length ? tbl('watch', [COL.name, COL.spark, COL.price, COL.day, COL.m1, COL.rng, COL.zone], rows, ['name', 1]) : '<p class="empty">Noch nichts auf der Watchlist.</p>'}</section>
    <div class="grid half">
    ${card('Alerts', 'Push aufs Handy, sobald eine Schwelle erreicht ist', (al.length ? `<div class="rows tight">${al.map(a => { const fd = st[a.id];
      return `<div class="row"><div class="l"><div class="t"><span class="sym" style="margin:0;color:inherit">${esc(a.symbol)}</span><span>${esc(alertText(a))}</span></div>
      <div class="m">${fd ? 'Ausgelöst ' + esc(ago(fd.fired)) : 'Aktiv'}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
      <div class="r" style="display:flex;gap:6px;align-items:center"><span class="chip ${fd ? 'warn' : 'good'}">${fd ? 'ausgelöst' : 'aktiv'}</span>
      ${fd ? `<button class="btn sm ghost" data-act="rearm" data-id="${esc(a.id)}">Wieder scharf</button>` : ''}<button class="xbtn" data-act="delalert" data-id="${esc(a.id)}" title="Löschen">×</button></div></div>`; }).join('')}</div>` : '<p class="empty">Noch keine Alerts.</p>')
      + `<div class="btnrow"><button class="btn" data-act="addalert">Alert anlegen</button></div>
      ${(S.pf.settings || {}).ntfy_topic ? '' : '<div class="note">Für Push aufs Handy fehlt noch der ntfy-Kanal. Du richtest ihn in den Einstellungen ein.</div>'}`)}
    ${card('Automatische Meldungen', 'Starke Tagesbewegungen', `<p class="body">Bewegt sich ein Titel an einem Tag um mehr als ${nf((S.pf.settings || {}).move_stock ?? 5, 0)} % (Aktien) oder ${nf((S.pf.settings || {}).move_crypto ?? 8, 0)} % (Krypto), kommt eine Meldung mit Punkten und nächster Nachkauf-Zone. Die Schwellen änderst du in den Einstellungen.</p>`)}
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- Termine */
function calList(events) {
  const by = {}; events.forEach(e => (by[e.date] = by[e.date] || []).push(e));
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `<div class="cal">${Object.keys(by).sort().map(d => { const dt = new Date(d + 'T12:00:00');
    return `<div class="day"><div class="badge ${d === today ? 'today' : ''}"><div class="w">${d === today ? 'Heute' : WT[dt.getDay()]}</div><div class="d">${dt.getDate()}</div><div class="mo">${MON_K[dt.getMonth()]}</div></div>
    <div style="min-width:0">${by[d].map(e => { const [cls, lab] = CAT[e.category] || ['', e.category];
      return `<div class="ev ${e.market ? '' : 'mine'}"><div class="meta"><span class="chip ${cls}">${esc(lab)}</span>${e.time ? `<span class="tiny muted num">${esc(e.time)}${/^\d/.test(e.time) ? ' Uhr' : ''}</span>` : ''}${e.estimated ? '<span class="tiny muted">geschätzt</span>' : ''}${e.market ? '' : '<span class="tiny mine-tag">dein Titel</span>'}</div>
      <div class="ti">${esc(e.title)}${e.expected ? ` <span class="muted">· für dich etwa ${fxNow(e.currency) ? eur(e.expected / fxNow(e.currency)) : money(e.expected, e.currency)} brutto</span>` : ''}</div></div>`; }).join('')}</div></div>`; }).join('')}</div>`;
}
function calCompact(events) {
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `<div class="calc">${events.map(e => { const dt = new Date(e.date + 'T12:00:00'), [cls, lab] = CAT[e.category] || ['', e.category];
    return `<div class="${e.market ? '' : 'mine'}"><span class="dt num ${e.date === today ? 'today' : ''}">${e.date === today ? 'Heute' : WT[dt.getDay()] + ' ' + dt.getDate() + '.' + (dt.getMonth() + 1) + '.'}</span>
      <span class="chip ${cls}">${esc(lab)}</span><span class="ti" title="${esc(e.title)}">${esc(e.title.replace(/: Quartalszahlen$/, ''))}${e.time ? ` <span class="muted">· ${esc(e.time)}</span>` : ''}</span></div>`; }).join('')}</div>`;
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
function vAsset(key) {
  S.sheetKey = key;
  const a = A(key), d = D(key), ai = AI(key).claude, gr = AI(key).grok, c = calc(), p = c.pos.find(x => x.key === key && x.qty > 1e-12);
  const [kind, sym] = key.split(':'), cur = curOf(key), f = d.fund || {}, t = d.tech || {}, v = d.valuation, dv = d.div;
  const watched = (S.pf.watchlist || []).some(w => keyOf(w.kind, w.symbol) === key);
  const ir = safeUrl((ai || {}).ir_url) || safeUrl(f.ir_website) || safeUrl(f.website);
  let h = sheetTop(`<span class="sym" style="font-size:13px;color:var(--ink3);display:block;margin-bottom:2px">${esc(sym)} · ${esc(assetClass(key))}</span>${esc(nameOf(key))}`, [SECTOR_DE[f.sector] || f.sector, f.industry].filter(Boolean).map(esc).join(' · '));
  h += `<section class="card"><div class="pricehead"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="p num">${px(key, a.price)}</span> ${pill(a.change_pct)} ${v ? score(key) : ''}</div>${seg('arange', ['3M', '1J', '3J', 'Max'], S.assetRange || '1J')}</div>
    <div class="chart" id="ch-asset" data-key="${esc(key)}"></div>
    <div class="tiles">${tile('1 Monat', pctS(t.perf_1m, 1), '', sign(t.perf_1m))}${tile('1 Jahr', pctS(t.perf_1y, 1), '', sign(t.perf_1y))}
    ${tile('52-Wochen-Spanne', t.low52 ? px(key, t.low52) + ' – ' + px(key, t.high52) : '–')}${tile('Abstand zum Hoch', t.from_high != null ? nf(t.from_high, 1) + ' %' : '–')}</div></section>`;
  if (v) { const r = ratingOf(key);
    h += `<section class="card rate"><div class="ratehead">${score(key, 'big')}<div class="ratemain"><div class="ratelabel">${esc(v.label)}</div><div class="muted small">${r == null ? '' : r + ' von 10 Punkten · '}${esc(v.basis)}</div>${meter(r)}</div>
      ${aiChip(ai) ? `<div class="rateai"><div class="tiny muted">Recherche</div>${aiChip(ai)}</div>` : ''}</div>
      <div class="reasons">${(v.reasons || []).map(x => `<div class="${x.p > 0 ? 'plus' : x.p < 0 ? 'minus' : 'zero'}"><i>${x.p > 0 ? '+' : x.p < 0 ? '−' : '○'}</i><span>${esc(x.text)}${x.w != null && x.w > 0 && x.w < 1 && x.p ? ` <em>${x.w >= 0.5 ? 'zählt halb' : 'zählt wenig'}</em>` : ''}</span></div>`).join('')}</div>
      <p class="tiny muted" style="margin:10px 0 0">${r == null ? 'Ohne Kennzahlen gibt es keine Punkte, nur ein Wort zur Kurslage. ' : 'Plus spricht für günstig, Minus für teuer. Kennzahlen zählen voll. Ein gefallener Kurs zählt nur, wenn die Kennzahlen positiv sind und der Markt überreagiert hat: Der Kurs fiel deutlich stärker als die Gewinnschätzungen (bei Coins: die Einnahmen). Wurden die Schätzungen stark gesenkt, gibt es höchstens 5 oder 6 Punkte. '}Faustregel, keine Anlageberatung.</p></section>`; }
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
  if (gr) h += card('Stimmung auf X', `Von Grok, ${esc(ago(gr.at))}`, `<span class="chip ${/bull/.test(gr.sentiment) ? 'good' : /bär/.test(gr.sentiment) ? 'bad' : ''}" style="font-size:14px;padding:5px 12px">${esc(gr.sentiment || '')}</span>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:var(--ink2)">${esc(gr.summary)}</p>${(gr.topics || []).length ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${gr.topics.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}`);
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
    <div class="f"><label>Vorgang</label><select name="type">${opt('buy', 'Kauf', e.type || 'buy')}${opt('sell', 'Verkauf', e.type)}</select></div>${symField(k0, s0)}
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
  openSheet(sheetTop('Einstellungen') + card('Darstellung', 'Gilt nur auf diesem Gerät', seg('theme', ['System', 'Hell', 'Dunkel'], th === 'light' ? 'Hell' : th === 'dark' ? 'Dunkel' : 'System'))
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
  else if (act === 'alloc') { S.alloc = v; render(); }
  else if (act === 'theme') { applyTheme(v === 'Hell' ? 'light' : v === 'Dunkel' ? 'dark' : ''); vSettings(); render(); }
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
    if (d.type === 'sell') { const p = calc().pos.find(x => x.key === keyOf(kind, symbol)), old = S.pf.transactions.find(x => x.id === t.id);
      if (!p || p.qty + (old && old.type === 'sell' ? old.qty : 0) < qty - 1e-9) return toast('So viele Stück hast du nicht im Bestand'); }
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
});
document.addEventListener('focusout', ev => { if (ev.target.id === 'q' && !ev.target.value) setTimeout(() => { const t = $('.top'); if (t) t.classList.remove('searching'); }, 150); });
document.addEventListener('input', ev => {
  if (ev.target.id !== 'q') return;
  const q = ev.target.value.trim().toLowerCase(), box = $('#qres');
  const hits = !q ? [] : allTracked().filter(k => k.split(':')[1].toLowerCase().includes(q) || nameOf(k).toLowerCase().includes(q))
    .sort((a, b) => (b.split(':')[1].toLowerCase().startsWith(q) - a.split(':')[1].toLowerCase().startsWith(q))).slice(0, 8);
  box.hidden = !q;
  box.innerHTML = hits.length ? hits.map(k => `<button data-act="open" data-key="${esc(k)}"><span class="sym" style="min-width:64px">${esc(k.split(':')[1])}</span><span class="ts">${esc(nameOf(k))}</span>${chg(A(k).change_pct, 1)}</button>`).join('') : '<p class="empty" style="padding:10px 12px">Kein Titel gefunden. Neue Titel fügst du in der Watchlist hinzu.</p>';
});
document.addEventListener('click', ev => { const q = $('#qres'); if (q && !ev.target.closest('.search')) q.hidden = true; });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawCharts, 150); });
document.addEventListener('visibilitychange', async () => { if (document.hidden || !S.pf) return; if (Date.now() - (S.loaded || 0) > 6e4 && $('#sheet').hidden && !S.auto) { await loadAll(); S.loaded = Date.now(); render(); } autoRefresh(); });
(async function start() {
  if (!LOCAL && !cfg) return render();
  $('#app').innerHTML = '<div class="wrap"><p class="empty">Lade Depot …</p></div>';
  await loadAll(); S.loaded = Date.now(); render();
  autoRefresh();
})();
