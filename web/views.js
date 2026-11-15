/* Ansichten und Bedienung. */
'use strict';
const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  depot: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M8 6V4h8v2M3 12h18"/>',
  analyse: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  watch: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.5a7 7 0 0 0-2.2 1.3l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.5a7 7 0 0 0 2.2-1.3l2.3 1 2-3.4-2-1.5c.07-.4.1-.9.1-1.3z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
};
const svg = n => `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`;
const TABS = [['home', 'Übersicht'], ['depot', 'Depot'], ['analyse', 'Analyse'], ['watch', 'Watchlist'], ['cal', 'Kalender']];
const CAT = {Earnings: ['blue', 'Quartalszahlen'], Dividende: ['teal', 'Ex-Dividende'], Zahltag: ['purple', 'Zahltag'], Krypto: ['warn', 'Krypto']};
const ALERT_TYPES = {price_above: 'Kurs steigt über', price_below: 'Kurs fällt unter', change_above: 'Tagesplus größer als (%)',
  change_below: 'Tagesminus größer als (%)', funding_above: 'Funding über (% je 8 Std.)', funding_below: 'Funding unter (% je 8 Std.)'};
const valClass = l => !l ? '' : /unter|niedrig|abgekühlt/.test(l) ? 'good' : /über|hoch/.test(l) ? 'bad' : '';
const toneClass = t => ({good: 'good', bad: 'bad', warn: 'warn'}[t] || '');
const card = (title, sub, inner, extra = '') => `<section class="card"><div class="head"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${extra}</div>${inner}</section>`;
const tile = (l, v, n = '', cls = '') => `<div class="tile"><div class="l">${l}</div><div class="v num ${cls}">${v}</div>${n ? `<div class="n">${n}</div>` : ''}</div>`;
const seg = (act, opts, cur) => `<div class="seg">${opts.map(o => `<button data-act="${act}" data-v="${o}" class="${o === cur ? 'on' : ''}">${o}</button>`).join('')}</div>`;

function render() {
  if (!LOCAL && !cfg) return renderSetup();
  const c = calc(), now = new Date(), upd = S.market.updated;
  const stale = upd && Date.now() - Date.parse(upd) > 45 * 6e4;
  const view = {home: vHome, depot: vDepot, analyse: vAnalyse, watch: vWatch, cal: vCal}[S.tab](c);
  $('#app').innerHTML = `<nav class="tabs">${TABS.map(([k, l]) => `<button data-act="tab" data-v="${k}" class="${S.tab === k ? 'on' : ''}">${svg(k)}<span>${l}</span></button>`).join('')}</nav>
  <div class="wrap">
    <header class="top"><div><p class="date">${WT_LANG[now.getDay()]}, ${now.getDate()}. ${MON[now.getMonth()]} ${now.getFullYear()}</p>
      <h1>${{home: 'Dein Depot', depot: 'Positionen', analyse: 'Analyse', watch: 'Watchlist', cal: 'Termine'}[S.tab]}</h1>
      <p class="sub">Kurse ${esc(ago(upd))}${S.daily.updated ? ' · Kennzahlen ' + esc(ago(S.daily.updated)) : ''}</p></div>
      <div style="display:flex;gap:8px"><button class="iconbtn" id="refresh" data-act="refresh" title="Aktualisieren">${svg('sync')}</button>
      <button class="iconbtn" data-act="settings" title="Einstellungen">${svg('gear')}</button></div></header>
    ${S.err ? `<div class="banner">${esc(S.err)}</div>` : ''}
    ${stale ? `<div class="banner">Die Kurse sind älter als 45 Minuten (${esc(ago(upd))}). Oben rechts aktualisieren.</div>` : ''}
    ${view}
    <p class="foot">Automatisch berechnet und recherchiert. Keine Anlageberatung. Kurse können verzögert sein.</p>
  </div>`;
  requestAnimationFrame(drawCharts);
}

/* ---------------------------------------------------------------- Übersicht */
function firedAlerts() {
  const st = S.state.alerts || {};
  return (S.pf.alerts || []).filter(a => st[a.id]).map(a => Object.assign({fired: st[a.id]}, a));
}
function alertText(a) {
  const cur = a.type.startsWith('price') ? ' ' + (CUR[a.currency || curOf(keyOf(a.kind, a.symbol))] || '') : a.type.startsWith('funding') ? ' %' : ' %';
  return `${ALERT_TYPES[a.type].replace(/ \(.*\)/, '')} ${nf(a.value, a.value < 1 ? 4 : 2)}${cur}`;
}
function vHome(c) {
  if (!c.txs.length) return `<div class="grid">${card('Willkommen', 'Trag deine ersten Käufe ein, dann rechnet das Dashboard los.',
    `<p class="x" style="color:var(--ink2);line-height:1.55;margin:0">Du gibst Aktien und Coins mit Kaufdatum, Stückzahl und Preis ein. Kurse, Dividenden, Quartalstermine,
    Krypto-Flows und Nachkauf-Zonen kommen automatisch dazu.</p><div class="btnrow"><button class="btn" data-act="addtx">Ersten Kauf eintragen</button>
    <button class="btn ghost" data-act="addwatch">Titel beobachten</button></div>`)}</div>`;
  const fired = firedAlerts(), ap = S.analysis.portfolio;
  const movers = c.held.filter(p => p.dayPct != null).sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct)).slice(0, 5);
  const cal = (S.digest.calendar || []).slice(0, 5);
  const top = c.held[0];
  return `<div class="grid two"><div class="col">
    <section class="card hero"><div class="label">Gesamtwert</div><div class="value num">${eur(c.value)}</div>
      <div class="row">${pill(c.dayPct)}<span class="num">${eurS(c.dayEur)} heute</span></div>
      <div class="tiles four">${tile('Gewinn offen', eurS(c.pnl), pctS(c.pnlPct), sign(c.pnl))}${tile('Eingesetzt', eur(c.cost))}
      ${tile('Realisiert', eurS(c.realized), 'aus Verkäufen', sign(c.realized))}${tile('Dividenden pro Jahr', eur(c.divYear), 'erwartet, brutto')}</div></section>
    ${fired.length ? card('Ausgelöste Alerts', '', `<div class="rows">${fired.map(a => `<div class="row"><div class="l"><div class="t">${esc(a.symbol)}<span>${esc(alertText(a))}</span></div>
      <div class="m">ausgelöst ${esc(ago(a.fired.fired))}${a.note ? ' · ' + esc(a.note) : ''}</div></div><div class="r"><button class="btn sm ghost" data-act="rearm" data-id="${esc(a.id)}">Wieder scharf</button></div></div>`).join('')}</div>`) : ''}
    ${card('Verlauf', S.mode === 'wert' ? 'Depotwert und eingesetztes Geld in Euro' : 'Rendite ohne Einzahlungen, verglichen mit S&P 500 und Bitcoin (in Euro)',
      `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px">${seg('mode', ['Wert', 'Rendite'], S.mode === 'wert' ? 'Wert' : 'Rendite')}${seg('range', Object.keys(RANGES), S.range)}</div>
      <div class="chart" id="ch-main"></div><div id="lg-main"></div>`)}
    ${ap ? card('Einschätzung', 'Von Claude, ' + esc(ago(ap.at)), `<p style="font-size:18px;font-weight:600;margin:0 0 6px;line-height:1.35">${esc(ap.headline)}</p>
      <p style="margin:0;font-size:15px;line-height:1.55;color:var(--ink2)">${esc(ap.summary)}</p>
      ${(ap.buy_candidates || []).length ? `<p class="sh">Nachkauf-Kandidaten</p><div class="rows">${ap.buy_candidates.map(b => `<div class="row"><div class="l"><div class="t">${esc(b.symbol)}<span>${esc(b.level)}</span></div><div class="x">${esc(b.reason)}</div></div></div>`).join('')}</div>` : ''}
      ${(ap.risks || []).length ? `<p class="sh">Risiken</p><ul class="dots">${ap.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`) : ''}
  </div><div class="col">
    ${card('Heute bewegt', 'Die größten Tagesbewegungen und wie die Titel bewertet sind', movers.length ? `<div class="rows">${movers.map(p => posRow(p, true)).join('')}</div>` : '<p class="empty">Noch keine Kurse.</p>')}
    ${card('Aufteilung und Risiko', 'Wie dein Geld verteilt ist', `
      <div class="bar" style="height:14px">${c.held.map((p, i) => `<i style="width:${p.weight}%;background:${p.kind === 'crypto' ? 'var(--c2)' : 'var(--c1)'};opacity:${1 - Math.min(i, 5) * 0.08}" title="${esc(p.symbol)} ${nf(p.weight, 1)} %"></i>`).join('')}</div>
      ${legend([{name: `Aktien ${nf(100 - (c.cryptoShare || 0), 0)} %`, color: 'var(--c1)'}, {name: `Krypto ${nf(c.cryptoShare || 0, 0)} %`, color: 'var(--c2)'}])}
      <div style="margin-top:14px">${c.held.slice(0, 8).map(p => `<div class="wbar"><div><div class="nm"><span>${esc(p.symbol)} <span class="muted">${esc(p.name)}</span></span><span class="muted num">${eur(p.value, 0)}</span></div>
        <div class="bar"><i style="width:${p.weight}%;background:${p.kind === 'crypto' ? 'var(--c2)' : 'var(--c1)'}"></i></div></div><div class="pc num">${nf(p.weight, 1)} %</div></div>`).join('')}</div>
      <div class="tiles">${tile('Größte Position', top ? nf(top.weight, 0) + ' %' : '–', top ? esc(top.symbol) + (top.weight > 30 ? ' · Klumpenrisiko' : '') : '')}
      ${tile('Schwankung pro Jahr', c.vol == null ? '–' : nf(c.vol, 0) + ' %', 'Volatilität des Depots')}
      ${tile('Größter Rückgang', c.maxDD == null ? '–' : nf(c.maxDD, 0) + ' %', 'vom Hoch, seit Start')}${tile('Dividenden bisher', eur(c.divGot), 'geschätzt, brutto')}</div>`)}
    ${card('Nächste Termine', '', cal.length ? calList(cal) + `<div class="btnrow"><button class="btn sm ghost" data-act="tab" data-v="cal">Alle Termine</button></div>` : '<p class="empty">Keine Termine bekannt.</p>')}
  </div></div>`;
}
// Dieselben Sätze stehen in tracker/analytics.py (move_read).
function moveRead(key, pct) {
  const v = D(key).valuation;
  if (pct == null || !v || v.score == null) return '';
  const up = pct >= 0, cheap = v.score >= 0.5, dear = v.score <= -0.5, cr = key.startsWith('crypto:');
  let t;
  if (cr) t = up ? (dear ? 'Anstieg in schon überhitztem Markt' : cheap ? 'Anstieg aus abgekühlter Lage' : '') : (dear ? 'baut Überhitzung ab, noch nicht günstig' : cheap ? 'Rücksetzer in abgekühlter Lage' : '');
  else t = up ? (dear ? 'wird noch teurer' : cheap ? 'steigt von niedrigem Niveau, noch Luft' : 'wird etwas teurer') : (dear ? 'fällt von hohem Niveau, noch nicht günstig' : cheap ? 'Rücksetzer bei günstiger Bewertung' : 'wird etwas günstiger');
  return v.label + (t ? ' · ' + t : '');
}
function posRow(p, dayOnly) {
  const mr = dayOnly ? moveRead(p.key, p.dayPct) : '';
  return `<button class="row" data-act="open" data-key="${esc(p.key)}"><div class="l"><div class="t">${esc(p.symbol)}<span>${esc(p.name)}</span></div>
    <div class="m num">${dayOnly ? px(p.key, p.price) + ' · ' + eurS(p.dayEur) : nf(p.qty, p.qty % 1 ? 4 : 0) + ' Stück · Einstand ' + eur(p.cost / p.qty)}</div>${mr ? `<div class="m">${esc(mr)}</div>` : ''}</div>
    <div class="r"><div class="v num">${dayOnly ? '' : eur(p.value)}</div>${pill(dayOnly ? p.dayPct : p.pnlPct)}</div></button>`;
}
function drawCharts() {
  const c = calc();
  if ($('#ch-main') && c.series.d.length > 1) {
    const from = c.series.d[c.series.d.length - 1] - RANGES[S.range];
    let i0 = c.series.d.findIndex(d => d >= from); if (i0 < 0) i0 = 0;
    const d = c.series.d.slice(i0);
    if (S.mode === 'wert') {
      const s = [{name: 'Depotwert', color: '#0066cc', area: true, pts: d.map((x, i) => [x, c.series.v[i0 + i]])},
        {name: 'Eingesetzt', color: '#86868b', dash: true, pts: d.map((x, i) => [x, c.series.inv[i0 + i]])}];
      lineChart('#ch-main', s, {fmt: v => nf(v, 0) + ' €', label: 'Depotwert im Zeitverlauf'});
      $('#lg-main').innerHTML = legend(s);
    } else {
      const base = c.series.twr[i0] || 1, pf = v => pctS(v, 1);
      const s = [{name: 'Depot', color: '#0066cc', pts: d.map((x, i) => [x, (c.series.twr[i0 + i] / base - 1) * 100])}];
      const sp = benchIndex('SP500', d), bt = benchIndex('BTC', d);
      if (sp) s.push({name: 'S&P 500', color: '#007d75', pts: d.map((x, i) => [x, (sp[i] - 1) * 100])});
      if (bt) s.push({name: 'Bitcoin', color: '#b35c00', pts: d.map((x, i) => [x, (bt[i] - 1) * 100])});
      lineChart('#ch-main', s, {fmt: pf, label: 'Rendite im Vergleich'});
      $('#lg-main').innerHTML = legend(s);
    }
  }
  const el = $('#ch-asset');
  if (el) {
    const key = el.dataset.key, h = D(key).hist, c2 = calc();
    if (h && h.d.length > 1) {
      const from = h.d[h.d.length - 1] - RANGES[S.assetRange || '1J'], cur = curOf(key);
      const pts = h.d.map((x, i) => [x, toShow(key, h.c[i], x)]).filter(p => p[0] >= from);
      const p = c2.pos.find(x => x.key === key), hl = [];
      const avg = p && p.qty > 1e-12 ? (showCur(key) === 'EUR' ? p.cost / p.qty : p.avgNative) : null;
      if (avg) hl.push({y: avg, label: 'Dein Einstand ' + money(avg, showCur(key)), color: '#0066cc'});
      (D(key).levels || []).slice(0, 2).forEach(l => hl.push({y: toShow(key, l.price), label: 'Nachkauf-Zone ' + px(key, l.price), color: '#1a7f37'}));
      const mk = c2.txs.filter(t => t.key === key).map(t => ({x: t.day, y: toShow(key, priceAt(key, t.day), t.day), color: t.type === 'buy' ? '#1a7f37' : '#d70015',
        title: `${t.type === 'buy' ? 'Kauf' : 'Verkauf'} ${nf(t.qty, 4)} zu ${money(t.price, t.currency)}`}));
      lineChart(el, [{name: key.split(':')[1], color: '#1d1d1f', pts}], {fmt: v => money(v, showCur(key)), hlines: hl.filter(x => x.y > 0), markers: mk, height: 220, label: 'Kursverlauf'});
    } else el.innerHTML = '<p class="empty">Der Kursverlauf kommt mit der nächsten täglichen Aktualisierung.</p>';
  }
}

/* ---------------------------------------------------------------- Depot */
function vDepot(c) {
  const grp = (kind, title) => { const l = c.held.filter(p => p.kind === kind); return l.length ? card(title, `${l.length} ${l.length === 1 ? 'Position' : 'Positionen'} · ${eur(l.reduce((s, p) => s + (p.value || 0), 0))}`, `<div class="rows">${l.map(p => posRow(p)).join('')}</div>`) : ''; };
  const txs = [...c.txs].reverse();
  return `<div class="grid two"><div class="col">
    <section class="card"><div class="btnrow" style="margin:0"><button class="btn" data-act="addtx">Kauf oder Verkauf eintragen</button></div></section>
    ${grp('stock', 'Aktien')}${grp('crypto', 'Krypto')}
    ${!c.held.length ? card('Noch keine Positionen', '', '<p class="empty">Trag oben deinen ersten Kauf ein.</p>') : ''}
  </div><div class="col">
    ${card('Buchungen', 'Alle eingetragenen Käufe und Verkäufe', txs.length ? `<div class="rows">${txs.map(t => `<button class="row" data-act="edittx" data-id="${esc(t.id)}"><div class="l">
      <div class="t">${esc(t.symbol)}<span>${t.type === 'buy' ? 'Kauf' : 'Verkauf'}</span></div><div class="m num">${dateDe(t.date)} · ${nf(t.qty, t.qty % 1 ? 4 : 0)} × ${money(t.price, t.currency)}</div></div>
      <div class="r"><span class="chip ${t.type === 'buy' ? 'good' : 'bad'}">${t.type === 'buy' ? '−' : '+'}${money(t.qty * t.price, t.currency)}</span></div></button>`).join('')}</div>` : '<p class="empty">Noch keine Buchungen.</p>')}
    ${card('Depot verbinden', 'Trade Republic, comdirect und andere', `<p class="empty">Der direkte Import ist vorbereitet, aber noch nicht aktiv. Bis dahin trägst du Käufe von Hand ein.
      Jede Buchung merkt sich ihre Herkunft, sodass ein späterer Import nichts doppelt anlegt.</p>`)}
  </div></div>`;
}

/* ---------------------------------------------------------------- Analyse */
function vAnalyse(c) {
  const keys = allTracked();
  if (!keys.length) return `<div class="grid">${card('Noch nichts zu analysieren', '', '<p class="empty">Trag einen Kauf ein oder setz einen Titel auf die Watchlist.</p>')}</div>`;
  const rows = keys.map(k => ({k, v: D(k).valuation, ai: AI(k).claude, gr: AI(k).grok})).sort((a, b) => ((b.v || {}).score ?? -9) - ((a.v || {}).score ?? -9));
  const valRows = rows.map(({k, v, ai, gr}) => `<button class="row" data-act="open" data-key="${esc(k)}"><div class="l"><div class="t">${esc(k.split(':')[1])}<span>${esc(nameOf(k))}</span></div>
    <div class="x">${v ? esc((v.reasons || []).slice(0, 2).map(r => r.text).join(' · ')) : 'Kennzahlen kommen mit der täglichen Aktualisierung.'}</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${ai && ai.verdict ? `<span class="chip ${valClass(ai.verdict)}">Claude: ${esc(ai.verdict)}</span>` : ''}${gr && gr.sentiment ? `<span class="chip ${/bull/.test(gr.sentiment) ? 'good' : /bär/.test(gr.sentiment) ? 'bad' : ''}">X: ${esc(gr.sentiment)}</span>` : ''}</div></div>
    <div class="r">${v ? `<span class="chip ${valClass(v.label)}">${esc(v.label)}</span>` : '<span class="chip">offen</span>'}</div></button>`).join('');
  const lv = keys.map(k => ({k, l: (D(k).levels || [])[0], p: A(k).price})).filter(x => x.l && x.p).sort((a, b) => b.l.dist_pct - a.l.dist_pct);
  const lvRows = lv.map(({k, l}) => `<button class="row" data-act="open" data-key="${esc(k)}"><div class="l"><div class="t">${esc(k.split(':')[1])}<span>${px(k, l.price)}</span></div>
    <div class="m">${esc(l.label)} · aktuell ${px(k, A(k).price)}</div></div><div class="r"><span class="chip ${l.dist_pct > -5 ? 'good' : ''} num">${nf(l.dist_pct, 1)} % entfernt</span></div></button>`).join('');
  const coins = keys.filter(k => k.startsWith('crypto:') && A(k).flow);
  const divs = c.held.filter(p => D(p.key).div && D(p.key).div.annual);
  return `<div class="grid half"><div class="col">
    ${card('Bewertung', 'Von günstig nach teuer. Regelwerk aus KGV, PEG, Analystenzielen und Kurslage', `<div class="rows">${valRows}</div>
      <div class="note">Die Einstufung ist eine Faustregel aus öffentlichen Kennzahlen. Tippe einen Titel an für alle Gründe${S.analysis.updated ? '' : '. Die KI-Recherche (Quartalszahlen, Investor Relations) läuft, sobald die Schlüssel hinterlegt sind'}.</div>`)}
    ${card('Dividenden', `Erwartet pro Jahr: ${eur(c.divYear)} brutto`, divs.length ? `<div class="rows">${divs.map(p => { const d = D(p.key).div; return `<button class="row" data-act="open" data-key="${esc(p.key)}"><div class="l">
      <div class="t">${esc(p.symbol)}<span>${nf(d.yield_pct, 2)} % Rendite</span></div><div class="m num">${px(p.key, d.annual)} je Aktie · ${d.per_year || '–'}× jährlich${d.next_ex ? ' · nächster Ex-Tag ' + dateDe(d.next_ex) + (d.next_ex_estimated ? ' (geschätzt)' : '') : ''}</div></div>
      <div class="r"><div class="v num">${eur(p.divYear)}</div><span class="muted tiny">pro Jahr</span></div></button>`; }).join('')}</div>` : '<p class="empty">Keine Dividendentitel im Depot.</p>')}
  </div><div class="col">
    ${card('Nachkauf-Zonen', 'Die nächste Unterstützung unter dem aktuellen Kurs', lvRows ? `<div class="rows">${lvRows}</div>` : '<p class="empty">Noch keine Kursverläufe.</p>')}
    ${card('Krypto: Spot oder Futures?', 'Wer hat die Bewegung getragen, wie stehen Funding und Open Interest',
      coins.length ? coins.map(k => flowBlock(k)).join('<div style="height:22px"></div>') : '<p class="empty">Keine Coins im Depot oder auf der Watchlist.</p>',
      coins.length ? seg('flowwin', ['4 Std.', '24 Std.'], S.flowWin === '4' ? '4 Std.' : '24 Std.') : '')}
  </div></div>`;
}
function flowBlock(key) {
  const a = A(key), f = a.flow || {}, w = S.flowWin, rd = (a.flow_read || {})[w], sym = key.split(':')[1];
  const sp = (f.spot || {})[w], fu = (f.fut || {})[w], chg = w === '4' ? f.px_chg_4h : a.change_pct;
  const dv = (r, col) => { const p = Math.min(Math.abs(r || 0) / 0.12, 1) * 100; return `<div class="div2"><span>${r < 0 ? `<i style="width:${p}%;background:var(--down)"></i>` : ''}</span><span>${r >= 0 ? `<i style="width:${p}%;background:var(--up)"></i>` : ''}</span></div>`; };
  const fund = Object.entries(f.funding || {}).map(([v, x]) => `${esc(v)} ${nf(x, 4)} %`).join(' · ');
  return `<div><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div style="font-size:17px;font-weight:600">${esc(sym)} <span class="muted" style="font-weight:400">${esc(a.name || '')}</span></div>
    <div class="m muted small num">${money(a.price, 'USD')} · ${pctS(chg)} in ${w} Std.</div></div>${rd ? `<span class="chip ${toneClass(rd.tone)}">${esc(rd.label)}</span>` : ''}</div>
    ${rd ? `<p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:var(--ink2)">${esc(rd.text)}</p>` : ''}
    <div class="flowgrid">${sp ? `<span>Spot-Käufe</span>${dv(sp.ratio)}<span class="v num">${pctS(sp.ratio * 100, 1)}</span>` : ''}
    ${fu ? `<span>Futures-Käufe</span>${dv(fu.ratio)}<span class="v num">${pctS(fu.ratio * 100, 1)}</span>` : ''}</div>
    <p class="tiny muted" style="margin:6px 0 0">Netto-Kaufdruck: Anteil der Käufe minus Verkäufe am gehandelten Volumen${f.spot_source ? ` (Spot: ${esc(f.spot_source)}, Futures: ${esc(f.fut_source || '–')})` : ''}.</p>
    <div class="kv">${tile('Open Interest', f.oi_total ? big(f.oi_total) + ' $' : '–', (f.oi_chg || {})[w] != null ? pctS(f.oi_chg[w], 1) + ' in ' + w + ' Std.' : Object.keys(f.oi || {}).join(', '))}
    ${tile('Funding je 8 Std.', f.funding_avg != null ? nf(f.funding_avg, 4) + ' %' : '–', f.funding_apr != null ? nf(f.funding_apr, 1) + ' % aufs Jahr' : '', f.funding_avg > 0.03 ? 'neg' : '')}</div>
    ${fund ? `<p class="tiny muted" style="margin:8px 0 0">Funding je Börse: ${fund}</p>` : ''}
    <p class="small" style="margin:8px 0 0"><a href="https://velo.xyz/futures/${encodeURIComponent(sym)}" target="_blank" rel="noopener">Auf Velo öffnen ›</a></p></div>`;
}

/* ---------------------------------------------------------------- Watchlist und Alerts */
function vWatch() {
  const wl = S.pf.watchlist || [], al = S.pf.alerts || [], st = S.state.alerts || {};
  return `<div class="grid half"><div class="col">
    ${card('Beobachtet', 'Titel, die du noch nicht hältst', (wl.length ? `<div class="rows">${wl.map(w => { const k = keyOf(w.kind, w.symbol), a = A(k), v = D(k).valuation, l = (D(k).levels || [])[0];
      return `<button class="row" data-act="open" data-key="${esc(k)}"><div class="l"><div class="t">${esc(w.symbol)}<span>${esc(nameOf(k))}</span></div>
      <div class="m num">${a.price != null ? px(k, a.price) : 'Kurs kommt mit der nächsten Aktualisierung'}${l ? ' · Nachkauf-Zone ' + px(k, l.price) : ''}</div>
      ${v ? `<div style="margin-top:6px"><span class="chip ${valClass(v.label)}">${esc(v.label)}</span></div>` : ''}</div><div class="r">${pill(a.change_pct)}</div></button>`; }).join('')}</div>` : '<p class="empty">Noch nichts auf der Watchlist.</p>')
      + `<div class="btnrow"><button class="btn" data-act="addwatch">Titel hinzufügen</button></div>`)}
  </div><div class="col">
    ${card('Alerts', 'Push aufs Handy, sobald eine Schwelle erreicht ist', (al.length ? `<div class="rows">${al.map(a => { const f = st[a.id];
      return `<div class="row"><div class="l"><div class="t">${esc(a.symbol)}<span>${esc(alertText(a))}</span></div>
      <div class="m">${f ? 'Ausgelöst ' + esc(ago(f.fired)) : 'Aktiv'}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
      <div class="r" style="display:flex;gap:6px;align-items:center"><span class="chip ${f ? 'warn' : 'good'}">${f ? 'ausgelöst' : 'aktiv'}</span>
      ${f ? `<button class="btn sm ghost" data-act="rearm" data-id="${esc(a.id)}">Wieder scharf</button>` : ''}<button class="xbtn" data-act="delalert" data-id="${esc(a.id)}" title="Löschen">×</button></div></div>`; }).join('')}</div>` : '<p class="empty">Noch keine Alerts.</p>')
      + `<div class="btnrow"><button class="btn" data-act="addalert">Alert anlegen</button></div>
      ${(S.pf.settings || {}).ntfy_topic ? '' : '<div class="note">Für Push aufs Handy fehlt noch der ntfy-Kanal. Du richtest ihn in den Einstellungen (Zahnrad oben rechts) ein.</div>'}`)}
  </div></div>`;
}

/* ---------------------------------------------------------------- Kalender */
function calList(events) {
  const by = {}; events.forEach(e => (by[e.date] = by[e.date] || []).push(e));
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="cal">${Object.keys(by).sort().map(d => { const dt = new Date(d + 'T12:00:00');
    return `<div class="day"><div class="badge ${d === today ? 'today' : ''}"><div class="w">${d === today ? 'Heute' : WT[dt.getDay()]}</div><div class="d">${dt.getDate()}</div><div class="mo">${MON_K[dt.getMonth()]}</div></div>
    <div style="min-width:0;flex:1">${by[d].map(e => { const [cls, lab] = CAT[e.category] || ['', e.category];
      return `<div class="ev"><span class="chip ${cls}">${esc(lab)}</span>${e.estimated ? ' <span class="tiny muted">geschätzt</span>' : ''}
      <div class="ti">${esc(e.title)}${e.expected ? ` <span class="muted">· für dich etwa ${fxNow(e.currency) ? eur(e.expected / fxNow(e.currency)) : money(e.expected, e.currency)} brutto</span>` : ''}</div></div>`; }).join('')}</div></div>`; }).join('')}</div>`;
}
function vCal() {
  const all = S.digest.calendar || [], f = S.calFilter;
  const ev = all.filter(e => f === 'alle' || (f === 'Zahlen' && e.category === 'Earnings') || (f === 'Dividenden' && /Dividende|Zahltag/.test(e.category)) || (f === 'Krypto' && e.category === 'Krypto'));
  return `<div class="grid">${card('Kommende Termine', 'Quartalszahlen, Ex-Tage und Zahltage deiner Titel',
    ev.length ? calList(ev) : '<p class="empty">Keine Termine gefunden. Der Kalender füllt sich mit der täglichen Aktualisierung.</p>', seg('calf', ['alle', 'Zahlen', 'Dividenden', 'Krypto'], f))}</div>`;
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
  let h = sheetTop(`${esc(sym)} <span class="muted" style="font-weight:400;font-size:17px">${esc(nameOf(key))}</span>`, [f.sector, f.industry].filter(Boolean).map(esc).join(' · '));
  h += `<section class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px"><div><span style="font-size:30px;font-weight:700;letter-spacing:-.02em" class="num">${px(key, a.price)}</span> ${pill(a.change_pct)}</div>${seg('arange', ['3M', '1J', 'Max'], S.assetRange || '1J')}</div>
    <div class="chart" id="ch-asset" data-key="${esc(key)}"></div>
    <div class="tiles">${tile('1 Monat', pctS(t.perf_1m, 1), '', sign(t.perf_1m))}${tile('1 Jahr', pctS(t.perf_1y, 1), '', sign(t.perf_1y))}
    ${tile('52-Wochen-Spanne', t.low52 ? px(key, t.low52) + ' – ' + px(key, t.high52) : '–')}${tile('Abstand zum Hoch', t.from_high != null ? nf(t.from_high, 1) + ' %' : '–')}</div></section>`;
  if (p) h += card('Deine Position', '', `<div class="tiles" style="margin:0">${tile('Wert', eur(p.value), nf(p.weight, 1) + ' % vom Depot')}${tile('Gewinn', eurS(p.pnl), pctS(p.pnlPct), sign(p.pnl))}
    ${tile('Stück', nf(p.qty, p.qty % 1 ? 4 : 0), 'Einstand ' + eur(p.cost / p.qty) + ' je Stück')}${tile('Heute', eurS(p.dayEur), '', sign(p.dayEur))}</div>`);
  if (v) h += card('Bewertung', esc(v.basis), `<span class="chip ${valClass(v.label)}" style="font-size:14px;padding:5px 12px">${esc(v.label)}</span>
    <div class="rows" style="margin-top:10px">${(v.reasons || []).map(r => `<div class="row"><div class="l x" style="margin:0">${esc(r.text)}</div><div class="r"><span class="chip ${r.p > 0 ? 'good' : r.p < 0 ? 'bad' : ''}">${r.p > 0 ? 'spricht für günstig' : r.p < 0 ? 'spricht für teuer' : 'neutral'}</span></div></div>`).join('')}</div>`);
  if ((d.levels || []).length || (ai && (ai.buy_zones || []).length)) h += card('Nachkauf-Zonen', 'Kurse, an denen ein Nachkauf naheliegt',
    `<div class="rows">${(d.levels || []).map(l => `<div class="row"><div class="l"><div class="t num">${px(key, l.price)}<span>${nf(l.dist_pct, 1)} %</span></div><div class="m">${esc(l.label)}</div></div>
      <div class="r"><button class="btn sm ghost" data-act="levelalert" data-key="${esc(key)}" data-v="${l.price}">Alert setzen</button></div></div>`).join('')}
    ${((ai || {}).buy_zones || []).filter(z => z.price > 0).map(z => `<div class="row"><div class="l"><div class="t num">${px(key, z.price)}<span>Claude</span></div><div class="x">${esc(z.reason)}</div></div>
      <div class="r"><button class="btn sm ghost" data-act="levelalert" data-key="${esc(key)}" data-v="${+z.price}">Alert setzen</button></div></div>`).join('')}</div>`);
  if (kind === 'crypto' && a.flow) h += card('Spot oder Futures?', '', flowBlock(key), seg('flowwin', ['4 Std.', '24 Std.'], S.flowWin === '4' ? '4 Std.' : '24 Std.'));
  if (kind === 'stock' && Object.keys(f).length) h += card('Kennzahlen', 'Quelle: Yahoo Finance', `<div class="tiles" style="margin:0">${tile('KGV', nf(f.pe, 1), f.forward_pe ? 'erwartet ' + nf(f.forward_pe, 1) : '')}${tile('PEG', nf(f.peg, 2), 'KGV im Verhältnis zum Wachstum')}
    ${tile('Analystenziel', px(key, f.target_mean), f.analysts ? nf(f.analysts, 0) + ' Analysten' : '')}${tile('Gewinnmarge', f.margin != null ? nf(f.margin * 100, 1) + ' %' : '–')}
    ${tile('Umsatzwachstum', f.revenue_growth != null ? pctS(f.revenue_growth * 100, 1) : '–', 'zum Vorjahr')}${tile('Börsenwert', f.market_cap ? big(f.market_cap) + ' ' + (CUR[cur] || cur) : '–')}</div>`);
  if (dv) h += card('Dividende', '', `<div class="tiles" style="margin:0">${tile('Pro Aktie und Jahr', px(key, dv.annual), dv.per_year ? dv.per_year + ' Zahlungen' : '')}${tile('Rendite', dv.yield_pct != null ? nf(dv.yield_pct, 2) + ' %' : '–', dv.yield_5y_avg ? '5-Jahres-Schnitt ' + nf(dv.yield_5y_avg, 2) + ' %' : '')}
    ${tile('Nächster Ex-Tag', dv.next_ex ? dateDe(dv.next_ex) : '–', dv.next_ex_estimated ? 'geschätzt aus dem Rhythmus' : dv.next_pay ? 'Zahltag ' + dateDe(dv.next_pay) : '')}${tile('Wachstum', dv.growth_pct != null ? pctS(dv.growth_pct, 1) : '–', dv.payout_pct != null ? 'Ausschüttung ' + nf(dv.payout_pct, 0) + ' % vom Gewinn' : '')}</div>
    ${p && p.divYear ? `<div class="note">Bei deinem Bestand sind das etwa <b>${eur(p.divYear)}</b> brutto im Jahr.</div>` : ''}`);
  if (ai) {
    const q = ai.last_quarter || {};
    h += card('Recherche', `Von Claude, ${esc(ago(ai.at))}`, `<span class="chip ${valClass(ai.verdict)}" style="font-size:14px;padding:5px 12px">${esc(ai.verdict || '')}</span>${ai.confidence ? ` <span class="tiny muted">Sicherheit: ${esc(ai.confidence)}</span>` : ''}
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
  openSheet(sheetTop('Einstellungen') + card('Push aufs Handy', 'Über die kostenlose App ntfy', `<form id="f-ntfy"><div class="f"><label>Geheimer Kanalname</label><input name="topic" value="${esc(s.ntfy_topic || '')}" placeholder="noch keiner" autocomplete="off" autocapitalize="off"></div>
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
  else if (act === 'range') { S.range = v; render(); }
  else if (act === 'mode') { S.mode = v === 'Wert' ? 'wert' : 'rendite'; render(); }
  else if (act === 'calf') { S.calFilter = v; render(); }
  else if (act === 'flowwin') { S.flowWin = v.startsWith('4') ? '4' : '24'; if (S.sheetKey) vAsset(S.sheetKey); else render(); }
  else if (act === 'arange') { S.assetRange = v; vAsset(S.sheetKey); }
  else if (act === 'open') vAsset(key);
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
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawCharts, 150); });
document.addEventListener('visibilitychange', async () => { if (!document.hidden && S.pf && Date.now() - (S.loaded || 0) > 5 * 6e4 && $('#sheet').hidden) { await loadAll(); S.loaded = Date.now(); render(); } });
(async function start() {
  if (!LOCAL && !cfg) return render();
  $('#app').innerHTML = '<div class="wrap"><p class="empty">Lade Depot …</p></div>';
  await loadAll(); S.loaded = Date.now(); render();
})();
