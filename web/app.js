/* Depot-Tracker: Daten laden, rechnen, Diagramme. Die Ansichten stehen in views.js. */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? esc(u) : '';
const DAY = 864e5;
const todayDay = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / DAY);
const isoToDay = iso => Math.floor(Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / DAY);
const dayToDate = d => new Date(d * DAY);
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WT_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MON_K = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const CUR = {EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', JPY: '¥'};

const nf = (v, d = 2) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('de-DE', {minimumFractionDigits: d, maximumFractionDigits: d});
// Beträge verbergen (Augen-Knopf oben): Euro-Beträge des Depots werden zu Punkten, Kurse und Prozente bleiben sichtbar
const MASK = '•••• €';
const eur = (v, d = 2) => v == null || isNaN(v) ? '–' : S.hide ? MASK : nf(v, d) + ' €';
const eurS = v => v == null || isNaN(v) ? '–' : S.hide ? MASK : (v >= 0 ? '+' : '−') + nf(Math.abs(v)) + ' €';
function money(v, cur) {
  if (v == null || isNaN(v)) return '–';
  const a = Math.abs(v), d = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return nf(v, d) + ' ' + (CUR[cur] || cur || '');
}
const pctS = (v, d = 2) => v == null || isNaN(v) ? '–' : (v >= 0 ? '+' : '−') + nf(Math.abs(v), d) + ' %';
const pill = (v, d = 2) => v == null || isNaN(v) ? '' : `<span class="pill ${v >= 0 ? 'up' : 'down'} num">${pctS(v, d).replace(' %', '&nbsp;%')}</span>`;
const sign = v => v == null ? '' : v >= 0 ? 'pos' : 'neg';
function big(v) {
  if (v == null || isNaN(v)) return '–';
  const a = Math.abs(v);
  return a >= 1e12 ? nf(v / 1e12, 2) + ' Bio.' : a >= 1e9 ? nf(v / 1e9, 2) + ' Mrd.' : a >= 1e6 ? nf(v / 1e6, 1) + ' Mio.' : nf(v, 0);
}
const dateDe = iso => { const p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? `${+p[2]}. ${MON_K[+p[1] - 1]} ${p[0]}` : '–'; };
function ago(iso) {
  if (!iso) return 'noch nie';
  const m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
  return m < 2 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : `vor ${Math.round(m / 1440)} Tagen`;
}
// Zeitpunkt kurz: heute „17:20 Uhr“, sonst „23. Nov. 17:20 Uhr“
function stampDe(iso) {
  const d = new Date(iso); if (isNaN(d)) return '–';
  const t = d.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'}) + ' Uhr';
  return d.toDateString() === new Date().toDateString() ? t : `${d.getDate()}. ${MON_K[d.getMonth()]} ${t}`;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).slice(0, 12);
const keyOf = (kind, symbol) => kind + ':' + String(symbol || '').toUpperCase().trim();
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }

/* ---------------------------------------------------------------- Datenablage
   Lokal (Mac): kleiner Server neben der Seite. Cloud: privates GitHub-Repo über die GitHub-API.
   Der Zugangsschlüssel bleibt nur in diesem Browser gespeichert. */
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
// Darstellung: 'light' (Standard seit Jakobs Wunsch vom 21.11.2026), 'dark' oder 'system'. Nur eine Bequemlichkeit pro Gerät.
function applyTheme(t) {
  t = t === 'dark' || t === 'system' ? t : 'light';
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('depot_theme', t); } catch (e) { /* egal */ }
}
try { applyTheme(localStorage.getItem('depot_theme') || 'light'); } catch (e) { applyTheme('light'); }
let cfg = null;
try { cfg = JSON.parse(localStorage.getItem('depot_cfg') || 'null'); } catch (e) { cfg = null; }
const b64 = s => { const b = new TextEncoder().encode(s); let o = ''; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(o); };
const gh = (path, opt = {}) => fetch('https://api.github.com' + path, Object.assign({cache: 'no-store'}, opt, {
  headers: Object.assign({Authorization: 'Bearer ' + cfg.token, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json'}, opt.headers || {})}));
const store = LOCAL ? {
  async get(name) { const r = await fetch('/api/data/' + name, {cache: 'no-store'}); return r.ok ? r.json() : null; },
  async put(name, obj) { const r = await fetch('/api/data/' + name, {method: 'PUT', body: JSON.stringify(obj)}); if (!r.ok) throw new Error('Speichern fehlgeschlagen'); },
  async refresh(mode) { const r = await fetch('/api/update?mode=' + mode, {method: 'POST'}); if (!r.ok) throw new Error('Aktualisierung fehlgeschlagen'); return true; },
} : {
  async get(name) {
    const r = await gh(`/repos/${cfg.owner}/${cfg.dataRepo}/contents/data/${name}`, {headers: {Accept: 'application/vnd.github.raw+json'}});
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error('Zugang abgelehnt. Bitte den Zugangsschlüssel prüfen.');
    if (!r.ok) throw new Error('GitHub antwortet nicht (' + r.status + ')');
    return r.json();
  },
  async put(name, obj) {
    const path = `/repos/${cfg.owner}/${cfg.dataRepo}/contents/data/${name}`;
    const cur = await gh(path);
    const body = {message: 'Depot geändert', content: b64(JSON.stringify(obj))};
    if (cur.ok) body.sha = (await cur.json()).sha;
    const r = await gh(path, {method: 'PUT', body: JSON.stringify(body)});
    if (!r.ok) throw new Error('Speichern fehlgeschlagen (' + r.status + ')');
  },
  async refresh(mode) {
    const wf = mode === 'fast' ? 'kurse.yml' : 'analyse.yml';
    const r = await gh(`/repos/${cfg.owner}/${cfg.appRepo}/actions/workflows/${wf}/dispatches`, {method: 'POST', body: JSON.stringify({ref: 'main'})});
    return r.ok ? 'queued' : false;
  },
};

const S = {flt: {}, sort: {}, tab: 'home', range: '1J', mode: 'kauf', flowWin: '24', calFilter: 'alle', pf: null, market: {}, daily: {}, analysis: {}, digest: {}, state: {}, loading: false, err: ''};
const emptyPf = () => ({version: 1, base_currency: 'EUR', transactions: [], watchlist: [], alerts: [], settings: {ntfy_topic: ''}});

async function loadAll() {
  S.loading = true; S.err = '';
  try {
    const [pf, market, daily, analysis, digest, state, profiles, smart, screen] = await Promise.all(
      ['portfolio.json', 'market.json', 'daily.json', 'analysis.json', 'digest.json', 'state.json', 'profiles.json', 'smart.json', 'screen.json']
        .map(n => /^(profiles|smart|screen)\.json$/.test(n) ? store.get(n).catch(() => null) : store.get(n)));   // nur die Zusatzdateien dürfen fehlen
    S.profiles = profiles || {}; S.smart = smart || null;
    S.screen = screen || null; S.scr = Object.fromEntries(((screen || {}).list || []).map(r => [r.key, r]));
    S.pf = Object.assign(emptyPf(), pf || {});
    S.pf.settings = S.pf.settings || {};
    S.market = market || {}; S.daily = daily || {}; S.analysis = analysis || {}; S.digest = digest || {}; S.state = state || {};
  } catch (e) { S.err = e.message || String(e); if (!S.pf) S.pf = emptyPf(); }
  S.loading = false; S.calc = null;
}
// Backtest (tracker/backtest.py → backtest.json): groß und selten neu, darum erst beim Öffnen des Reiters Strategie
async function loadBacktest() {
  if (S.btLoading) return;
  S.btLoading = true;
  try { S.bt = (await store.get('backtest.json')) || null; } catch (e) { S.bt = null; }
  render();
}
async function savePf(msg) {
  try {
    await store.put('portfolio.json', S.pf);
    S.calc = null; render(); toast(msg || 'Gespeichert');
    return true;
  } catch (e) { toast(e.message || 'Speichern fehlgeschlagen', 4000); return false; }
}
async function refresh(mode, quiet) {
  const b = $('#refresh'); if (b) b.classList.add('spin');
  try {
    const r = await store.refresh(mode);
    if (r === 'queued') { if (!quiet) toast('Aktualisierung gestartet. Neue Daten in ein bis zwei Minuten.', 4000); setTimeout(async () => { await loadAll(); render(); }, 75000); }
    else if (r) { await loadAll(); render(); if (!quiet) toast('Aktualisiert'); }
    else { await loadAll(); render(); if (!quiet) toast('Daten neu geladen'); }
  } catch (e) { toast(e.message || 'Fehler', 4000); }
  const b2 = $('#refresh'); if (b2) b2.classList.remove('spin');
}

/* Beim Öffnen: Sind die Kurse älter als 3 Minuten, startet ein Kurslauf. Die Seite lädt neu, sobald er fertig ist.
   Ein Lauf, der vor kurzem schon angestoßen wurde (auch aus einem anderen Fenster), wird nicht doppelt gestartet. */
const STALE = 3 * 6e4;
async function autoRefresh() {
  if (S.auto || !S.pf || S.err) return;
  const age = Date.now() - (Date.parse(S.market.updated || '') || 0);
  if (age < STALE) return;
  S.auto = true;
  const spin = on => { const b = $('#refresh'); if (b) b.classList.toggle('spin', on); };
  spin(true);
  try {
    let last = 0;
    try { last = +localStorage.getItem('depot_auto') || 0; } catch (e) { last = 0; }
    let r = 'queued';
    if (LOCAL || Date.now() - last > 4 * 6e4) {
      r = await store.refresh('fast');
      try { localStorage.setItem('depot_auto', String(Date.now())); } catch (e) { /* egal */ }
    }
    if (r === 'queued') {
      const before = S.market.updated || '';
      for (let i = 0; i < 12; i++) {             // höchstens 4 Minuten warten
        await new Promise(ok => setTimeout(ok, 20000));
        const m = await store.get('market.json').catch(() => null);
        if (m && m.updated && m.updated !== before) break;
      }
    }
    if (r) { await loadAll(); S.loaded = Date.now(); if ($('#sheet').hidden) render(); else S.calc = null; toast('Kurse aktualisiert'); }
  } catch (e) { /* still: dann bleiben die zuletzt geladenen Kurse stehen */ }
  S.auto = false; spin(false);
}

/* Neue Version der Seite: Browser und Home-Bildschirm-Apps heben index.html bis zu 10 Minuten (iOS oft länger) auf.
   Beim Öffnen und Zurückkehren die aktuelle Fassung ohne Zwischenspeicher holen; ist sie neuer, mit eigener Adresse neu laden
   (eine neue Adresse umgeht jeden Zwischenspeicher). Je Version nur ein Versuch, damit nichts in Schleife lädt. */
const APP_V = (((document.currentScript || {}).src || '').match(/[?&]v=(\w+)/) || [])[1] || 'dev';
let verAt = 0;
async function checkVersion() {
  if (APP_V === 'dev' || LOCAL || Date.now() - verAt < 6e4) return;
  verAt = Date.now();
  try {
    const r = await fetch('index.html?t=' + Date.now(), {cache: 'no-store'});
    const v = ((await r.text()).match(/app\.js\?v=(\w+)/) || [])[1];
    if (!v || v === APP_V || v === 'dev') return;
    // gegen Schleifen: dieselbe Version höchstens alle 2 Minuten neu laden. Vorher nur einmal je Sitzung: Bekam das Neuladen
    // noch die alte Seite (Zwischenspeicher von GitHub oder iOS), blieb die App bis zum Schließen alt (25.11.2026)
    let tried = {}; try { tried = JSON.parse(sessionStorage.getItem('depot_v2') || '{}'); } catch (e) { /* egal */ }
    if (tried.v === v && Date.now() - tried.t < 12e4) return;
    try { sessionStorage.setItem('depot_v2', JSON.stringify({v, t: Date.now()})); } catch (e) { /* egal */ }
    location.replace(location.pathname + '?v=' + v + '&r=' + Date.now().toString(36) + location.hash);
  } catch (e) { /* offline: alte Fassung bleibt */ }
}

/* ---------------------------------------------------------------- Rechnen */
function bisect(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo - 1; }
const fxNow = cur => cur === 'EUR' ? 1 : ((S.market.fx || {})[cur] || null);
function fxAt(cur, day) {
  if (cur === 'EUR') return 1;
  const h = (S.daily.fx || {})[cur];
  if (h && h.d.length) { const i = bisect(h.d, day); if (i >= 0) return h.c[i]; return h.c[0]; }
  return fxNow(cur) || 1;
}
const A = key => (S.market.assets || {})[key] || {};
const D = key => (S.daily.assets || {})[key] || {};
const AI = key => (S.analysis.assets || {})[key] || {};
const curOf = key => A(key).currency || D(key).currency || 'USD';
// Anzeige: Aktien immer in Euro, Krypto in US-Dollar. Die Daten bleiben in der Handelswährung (dieselbe Regel in tracker/update.py: show_price).
const isCoin = key => String(key).startsWith('crypto:');
const showCur = key => isCoin(key) ? 'USD' : (curOf(key) === 'EUR' || fxNow(curOf(key)) ? 'EUR' : curOf(key));
function toShow(key, v, day) {
  if (v == null || isNaN(v) || isCoin(key) || showCur(key) !== 'EUR' || curOf(key) === 'EUR') return v;
  return v / ((day != null ? fxAt(curOf(key), day) : null) || fxNow(curOf(key)));
}
const px = (key, v, day) => money(toShow(key, v, day), showCur(key));
// Punkte 1 bis 10 aus der Bewertung (dieselbe Formel in tracker/analytics.py: rating)
function ratingOf(key) { const v = D(key).valuation; return !v || v.score == null ? null : (v.rating ?? Math.max(1, Math.min(10, Math.floor(6 + 3 * v.score)))); }
const tierOf = r => r == null ? null : r <= 2 ? 0 : r <= 4 ? 1 : r <= 6 ? 2 : r <= 8 ? 3 : 4;
const isFund = key => !isCoin(key) && (A(key).type === 'ETF' || /\b(ETF|ETC|UCITS)\b/i.test(A(key).name || D(key).name || ''));
const nameOf = key => A(key).name || D(key).name || ((S.scr || {})[key] || {}).name || key.split(':')[1];
/* Umgangssprachlicher Name (Jakobs Wunsch vom 19.11.2026): „Apple“ statt „Apple Inc.“ oder AAPL, Kürzel nur, wo man sie so sagt
   (AMD, SAP, UBS). Firmenzusätze werden abgeschnitten, einige Namen fest vorgegeben. ETFs nach ihrem Index bzw. Thema. */
const SHORT = {'stock:GOOGL': 'Google', 'stock:GOOG': 'Google', 'stock:AMD': 'AMD', 'stock:MC.PA': 'LVMH', 'stock:LHA.DE': 'Lufthansa',
  'stock:1211.HK': 'BYD', 'stock:HIMS': 'Hims & Hers', 'stock:BMNR': 'Bitmine', 'stock:ANT': 'Anthropic', 'stock:IBM': 'IBM',
  'stock:TSM': 'TSMC', 'stock:BRK-B': 'Berkshire', 'stock:BRK-A': 'Berkshire', 'stock:000660.KS': 'SK Hynix', 'stock:005930.KS': 'Samsung'};
const FUND_THEME = [[/MSCI World/i, 'MSCI World'], [/NASDAQ[- ]?100/i, 'Nasdaq 100'], [/S&P 500/i, 'S&P 500'], [/All[- ]World/i, 'All-World'],
  [/Emerging Markets/i, 'Schwellenländer'], [/Gold/i, 'Gold'], [/Silver|Silber/i, 'Silber'], [/Commodit/i, 'Rohstoffe'],
  [/Clean Energy/i, 'Saubere Energie'], [/Electric Vehicles/i, 'Elektroautos'], [/Asia Pacific Ex Japan/i, 'Asien-Pazifik'], [/DAX/i, 'DAX'],
  [/Europe|Stoxx/i, 'Europa'], [/Semiconductor/i, 'Halbleiter'], [/Bitcoin/i, 'Bitcoin']];
const ISSUERS = ['iShares', 'Amundi', 'Lyxor', 'Xtrackers', 'Vanguard', 'SPDR', 'Invesco', 'WisdomTree', 'VanEck', 'HSBC', 'UBS', 'Franklin', 'Global X'];
const issuerOf = key => ISSUERS.find(w => nameOf(key).toLowerCase().includes(w.toLowerCase())) || '';
function shortName(key) {
  if (SHORT[key]) return SHORT[key];
  const sym = key.split(':')[1], name = nameOf(key);
  if (!name || name === sym) return sym;
  if (isCoin(key)) return name.replace(/\s+(Finance|Protocol|Network|Token|Coin)$/i, '');
  if (isFund(key) || isCommodity(key)) { const t = FUND_THEME.find(([re]) => re.test(name)); if (t) return t[1]; }
  let n = name.replace(/^The\s+/i, '').split(/\s+-\s+/)[0], prev;
  do {
    prev = n;
    n = n.replace(/[,.]?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|Limited|plc|SE|AG|N\.V\.|NV|S\.A\.?|SA|A\/S|PBC|Holdings?|Group|Global|International|Technologies|Technology|Platforms|Internet|UCITS|ETF|ETC|and)$/i, '').replace(/[,\s]+$/, '');
  } while (n !== prev && n.length > 2);
  n = n.replace(/\.com$/i, '');
  return n.split(' ').map(w => w.length > 4 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w[0] + w.slice(1).toLowerCase() : w).join(' ') || sym;
}
function priceAt(key, day) {
  const h = D(key).hist;
  if (!h || !h.d.length) return A(key).price ?? null;
  const i = bisect(h.d, day);
  return i >= 0 ? h.c[i] : h.c[0];
}

// Teildepots: jede Buchung trägt `depot` (ohne Feld: Hauptdepot). Die Auswahl gilt nur auf diesem Gerät.
const depots = () => (S.pf.depots && S.pf.depots.length ? S.pf.depots : [{id: 'main', name: 'Hauptdepot'}]);
const depOf = t => t.depot || 'main';
const depName = id => (depots().find(d => d.id === id) || {}).name || id;
try { S.dep = localStorage.getItem('depot_dep') || 'all'; } catch (e) { S.dep = 'all'; }
try { S.hide = localStorage.getItem('depot_hide') === '1'; } catch (e) { S.hide = false; }
function setDep(id) { S.dep = id; S.calc = null; try { localStorage.setItem('depot_dep', id); } catch (e) { /* egal */ } }
function calc() {
  if (S.calc) return S.calc;
  if (S.dep !== 'all' && !depots().some(d => d.id === S.dep)) S.dep = 'all';
  const txs = (S.pf.transactions || []).filter(t => S.dep === 'all' || depOf(t) === S.dep).map(t => Object.assign({}, t, {day: isoToDay(t.date), key: keyOf(t.kind, t.symbol),
    qty: +t.qty || 0, price: +t.price || 0, fee: +t.fee || 0, currency: t.currency || 'EUR'}))
    .filter(t => !isNaN(t.day)).sort((a, b) => a.day - b.day || (a.type === 'buy' ? -1 : 1));
  // Positionen (FIFO)
  const lots = {}, realized = {}, native = {}, boughtToday = {}, td0 = todayDay();
  for (const t of txs) {
    const rate = fxAt(t.currency, t.day) || 1, q = lots[t.key] = lots[t.key] || [];
    if (t.type === 'buy') {
      q.push([t.qty, (t.qty * t.price + t.fee) / rate]);
      if (t.day === td0) { const b = boughtToday[t.key] = boughtToday[t.key] || {q: 0, c: 0}; b.q += t.qty; b.c += (t.qty * t.price + t.fee) / rate; }
      const n = native[t.key] = native[t.key] || {q: 0, c: 0};
      n.q += t.qty; n.c += t.qty * t.price / rate * (fxAt(curOf(t.key), t.day) || 1);
    } else {
      let left = t.qty, cost = 0;
      while (left > 1e-12 && q.length) {
        const [lq, lc] = q[0], take = Math.min(lq, left);
        cost += lc * take / lq; q[0] = [lq - take, lc - lc * take / lq];
        if (q[0][0] <= 1e-12) q.shift();
        left -= take;
      }
      realized[t.key] = (realized[t.key] || 0) + (t.qty * t.price - t.fee) / rate - cost;
    }
  }
  const pos = Object.keys(lots).map(key => {
    const a = A(key), qty = lots[key].reduce((s, x) => s + x[0], 0), cost = lots[key].reduce((s, x) => s + x[1], 0);
    const avgNative = native[key] && native[key].q ? native[key].c / native[key].q : null;
    let price = a.error ? null : a.price ?? null, noQuote = false, chg = a.change_pct;
    // Noch kein Kurs (z. B. Börsengang am selben Tag): bis zum ersten Kurs mit dem Kaufkurs rechnen
    if (price == null && !(D(key).hist || {}).d && avgNative != null) { price = avgNative; noQuote = true; chg = null; }
    const rate = fxNow(curOf(key)) || 1, value = price == null ? null : qty * price / rate;
    // Heute gekauft: zählt ab dem Kaufkurs, nicht ab dem Schluss von gestern (wie im Broker)
    const bt = boughtToday[key], tq = bt && qty > 0 ? Math.min(bt.q, qty) : 0, vNew = value == null ? null : value * tq / (qty || 1), vOld = value == null ? null : value - vNew;
    const dayEur = value == null || chg == null || chg <= -100 ? (tq && value != null ? vNew - bt.c * tq / bt.q : null) : vOld - vOld / (1 + chg / 100) + (tq ? vNew - bt.c * tq / bt.q : 0);
    return {key, kind: key.split(':')[0], symbol: key.split(':')[1], name: nameOf(key), qty, cost, value, price, cur: curOf(key),
      realized: realized[key] || 0, pnl: value == null ? null : value - cost, pnlPct: value != null && cost > 0 ? (value / cost - 1) * 100 : null,
      dayPct: chg, dayEur,
      avgNative, noQuote};
  });
  const held = pos.filter(p => p.qty > 1e-12).sort((a, b) => (b.value || 0) - (a.value || 0));
  const value = held.reduce((s, p) => s + (p.value || 0), 0), cost = held.reduce((s, p) => s + p.cost, 0);
  const dayEur = held.reduce((s, p) => s + (p.dayEur || 0), 0);
  held.forEach(p => p.weight = value ? (p.value || 0) / value * 100 : 0);

  // Dividenden: bisher erhalten (aus Beständen am Ex-Tag) und erwartet pro Jahr, brutto
  let divGot = 0, divYear = 0;
  for (const p of pos) {
    const d = D(p.key);
    for (const [day, amt] of d.divs || []) {
      let q = 0;
      for (const t of txs) if (t.key === p.key && t.day < day) q += t.type === 'buy' ? t.qty : -t.qty;
      if (q > 1e-12) divGot += q * amt / (fxAt(p.cur, day) || 1);
    }
    if (p.qty > 1e-12 && d.div && d.div.annual) { p.divYear = p.qty * d.div.annual / (fxNow(p.cur) || 1); divYear += p.divYear; }
  }

  // Verlauf: Wert, eingesetztes Geld und zeitgewichtete Rendite (Einzahlungen herausgerechnet).
  // Dazu der Vergleich mit gleichen Käufen in zwei Szenarien: jeder Kauf geht am selben Tag mit demselben Euro-Betrag
  // ganz in den S&P 500 (s) bzw. ganz in Bitcoin (b). Verkäufe ziehen denselben Betrag wieder ab.
  // Getrennt nach Teil (a = Aktien und ETFs, k = Krypto), damit die Ansichten Aktien und Krypto einzeln rechnen.
  const series = {d: [], v: [], inv: [], twr: [], va: [], vk: [], ia: [], ik: [], as: [], ab: [], ks: [], kb: [], bench: false};
  if (txs.length) {
    const end = todayDay(), qty = {}; let ti = 0, inv = 0, prev = 0, idx = 1;
    const part = k => k.startsWith('crypto:') ? 'k' : 'a', units = {a: {s: 0, b: 0}, k: {s: 0, b: 0}}, net = {a: 0, k: 0};
    const bp = {s: d => benchAt('SP500', d), b: d => benchAt('BTC', d)};
    series.bench = !!(bp.s(end) && bp.b(end));
    for (let day = txs[0].day; day <= end; day++) {
      let cf = 0;
      while (ti < txs.length && txs[ti].day <= day) {
        const t = txs[ti++], rate = fxAt(t.currency, t.day) || 1, p = part(t.key);
        qty[t.key] = (qty[t.key] || 0) + (t.type === 'buy' ? t.qty : -t.qty);
        const amt = t.type === 'buy' ? (t.qty * t.price + t.fee) / rate : -(t.qty * t.price - t.fee) / rate;
        cf += amt; net[p] += amt;
        for (const b of ['s', 'b']) {
          const bpx = bp[b](day), u = units[p];
          if (!bpx) continue;
          if (amt > 0) u[b] += amt / bpx;
          else { const val = u[b] * bpx; u[b] = val > 0 ? u[b] * Math.max(0, 1 + amt / val) : 0; }
        }
      }
      let v = 0; const vp = {a: 0, k: 0};
      for (const k in qty) {
        if (qty[k] <= 1e-12) continue;
        const px = day === end && A(k).price != null && !A(k).error ? A(k).price : priceAt(k, day);
        if (px != null) { const x = qty[k] * px / ((day === end && fxNow(curOf(k))) || fxAt(curOf(k), day) || 1); v += x; vp[part(k)] += x; }
      }
      inv += cf;
      if (prev > 0) idx *= (v - cf) / prev;
      prev = v;
      series.d.push(day); series.v.push(v); series.inv.push(inv); series.twr.push(idx);
      series.va.push(vp.a); series.vk.push(vp.k); series.ia.push(net.a); series.ik.push(net.k);
      const ps = bp.s(day) || 0, pb = bp.b(day) || 0;
      series.as.push(units.a.s * ps); series.ab.push(units.a.b * pb); series.ks.push(units.k.s * ps); series.kb.push(units.k.b * pb);
    }
  }
  // Risiko aus der zeitgewichteten Rendite
  let vol = null, maxDD = null;
  if (series.twr.length > 20) {
    const r = []; let peak = 0; maxDD = 0;
    for (let i = 1; i < series.twr.length; i++) {
      if (series.twr[i - 1] > 0) r.push(series.twr[i] / series.twr[i - 1] - 1);
      peak = Math.max(peak, series.twr[i]); if (peak > 0) maxDD = Math.min(maxDD, series.twr[i] / peak - 1);
    }
    const m = r.reduce((s, x) => s + x, 0) / r.length;
    vol = Math.sqrt(r.reduce((s, x) => s + (x - m) * (x - m), 0) / r.length) * Math.sqrt(365) * 100; maxDD *= 100;
  }
  const cryptoV = held.filter(p => p.kind === 'crypto').reduce((s, p) => s + (p.value || 0), 0);
  S.calc = {txs, pos, held, value, cost, pnl: value - cost, pnlPct: cost ? (value / cost - 1) * 100 : null, dayEur,
    dayPct: value - dayEur > 0 ? dayEur / (value - dayEur) * 100 : null, realized: pos.reduce((s, p) => s + p.realized, 0),
    divGot, divYear, series, vol, maxDD, cryptoShare: value ? cryptoV / value * 100 : null};
  return S.calc;
}
// Kurs eines Vergleichsindex an einem Tag, in Euro (S&P 500 als Kursindex ohne Dividenden, Bitcoin)
function benchAt(name, day) {
  const b = (S.daily.bench || {})[name];
  if (!b || !b.d.length) return null;
  const i = bisect(b.d, day), ix = (S.market.indices || []).find(x => x.sym === (name === 'BTC' ? 'BTC' : '^GSPC'));
  const live = day >= todayDay() && ix && ix.price ? ix.price : null;   // heute: aktueller Stand aus der Marktleiste
  return (live || (i >= 0 ? b.c[i] : b.c[0])) / ((live && fxNow(b.currency || 'USD')) || fxAt(b.currency || 'USD', day) || 1);
}
function benchIndex(name, days) {
  const b = (S.daily.bench || {})[name];
  if (!b || !b.d.length || !days.length) return null;
  const at = d => { const i = bisect(b.d, d); return (i >= 0 ? b.c[i] : b.c[0]) / (fxAt(b.currency || 'USD', d) || 1); };
  const base = at(days[0]);
  return base ? days.map(d => at(d) / base) : null;
}
function allTracked() {
  const m = new Map();
  for (const g of ['transactions', 'watchlist', 'alerts']) for (const x of S.pf[g] || []) if (x.symbol && x.kind) m.set(keyOf(x.kind, x.symbol), true);
  return [...m.keys()];
}

/* ---------------------------------------------------------------- Liniendiagramm (SVG)
   Eine Achse, dünne Linien, Fadenkreuz mit Tooltip, Beschriftung in Textfarbe. */
function lineChart(host, series, opt = {}) {
  const el = typeof host === 'string' ? $(host) : host;
  if (!el) return;
  series = series.filter(s => s.pts && s.pts.length > 1);
  if (!series.length) { el.innerHTML = '<p class="empty">Noch zu wenig Daten für ein Diagramm.</p>'; return; }
  const W = Math.max(280, el.clientWidth), H = opt.height || 240, pl = 4, pr = 58, pt = 10, pb = 24;
  const fmt = opt.fmt || (v => nf(v, 0));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of series) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (const h of opt.hlines || []) { y0 = Math.min(y0, h.y); y1 = Math.max(y1, h.y); }
  if (y1 === y0) { y1 += 1; y0 -= 1; }
  const padY = (y1 - y0) * 0.08; y0 -= padY; y1 += padY;
  const sx = x => pl + (x - x0) / (x1 - x0 || 1) * (W - pl - pr), sy = y => pt + (1 - (y - y0) / (y1 - y0)) * (H - pt - pb);
  const step = niceStep((y1 - y0) / 4);
  let g = '';
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) {
    g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${sy(v)}" y2="${sy(v)}"/>` +
      `<text class="ax num" x="${W - pr + 8}" y="${sy(v) + 4}">${esc(fmt(v))}</text>`;
  }
  const span = x1 - x0, n = Math.min(5, Math.max(2, Math.floor(W / 110)));
  // opt.times: Stundenkurse (x = laufende Nummer, gleichmäßig verteilt; Nächte und Wochenenden ohne Handel fallen weg)
  const T = opt.times, WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  for (let i = 0; i <= n; i++) {
    const x = x0 + span * i / n, dt = T ? new Date(T[Math.min(T.length - 1, Math.max(0, Math.round(x)))]) : dayToDate(Math.round(x));
    const lab = T ? `${WD[dt.getDay()]} ${dt.getDate()}.` : span > 500 ? `${MON_K[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}` : `${dt.getUTCDate()}. ${MON_K[dt.getUTCMonth()]}`;
    g += `<text class="ax" x="${sx(x)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}">${lab}</text>`;
  }
  const used = [];   // Beschriftungen dicht beieinander liegender Linien nicht übereinander schreiben
  for (const h of [...(opt.hlines || [])].sort((a, b) => b.y - a.y)) {
    let ly = sy(h.y) - 5;
    while (used.some(u => Math.abs(u - ly) < 13)) ly += 13;
    used.push(ly);
    g += `<line x1="${pl}" x2="${W - pr}" y1="${sy(h.y)}" y2="${sy(h.y)}" style="stroke:${h.color || 'var(--ink3)'}" stroke-width="1.5" stroke-dasharray="4 4"/>` +
      `<text class="hl" x="${pl + 4}" y="${ly}">${esc(h.label)}</text>`;
  }
  const gid = 'g' + Math.random().toString(36).slice(2, 8);
  series.forEach((s, i) => {
    const d = s.pts.map(([x, y], j) => (j ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(y).toFixed(1)).join('');
    if (s.area) g += `<defs><linearGradient id="${gid}${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:.22"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient></defs>` +
      `<path d="${d}L${sx(s.pts[s.pts.length - 1][0])} ${H - pb}L${sx(s.pts[0][0])} ${H - pb}Z" fill="url(#${gid}${i})"/>`;
    g += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="${s.thin ? 1.5 : 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="4 4"' : ''}/>`;
  });
  for (const m of opt.markers || []) {
    if (m.x < x0 || m.x > x1) continue;
    g += `<circle cx="${sx(m.x)}" cy="${sy(m.y)}" r="5" style="fill:${m.color};stroke:var(--surface)" stroke-width="2"><title>${esc(m.title)}</title></circle>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(opt.label || 'Diagramm')}">${g}` +
    `<line class="xh" y1="${pt}" y2="${H - pb}" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>` +
    series.map((s, i) => `<circle class="dot${i}" r="4.5" style="fill:${s.color};stroke:var(--surface)" stroke-width="2" visibility="hidden"/>`).join('') +
    `<rect x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent"/></svg><div class="tip" hidden></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('.xh');
  const move = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
    const x = x0 + (Math.min(Math.max(px, pl), W - pr) - pl) / (W - pl - pr) * (x1 - x0);
    let html = '', cx = null;
    series.forEach((s, i) => {
      const xs = s.pts.map(p => p[0]); let j = bisect(xs, x); if (j < 0) j = 0;
      if (j + 1 < xs.length && Math.abs(xs[j + 1] - x) < Math.abs(xs[j] - x)) j++;
      const p = s.pts[j], dot = el.querySelector('.dot' + i);
      dot.setAttribute('cx', sx(p[0])); dot.setAttribute('cy', sy(p[1])); dot.setAttribute('visibility', 'visible');
      if (cx == null) { cx = sx(p[0]);
        if (T) { const dt = new Date(T[p[0]]); html = `<b>${WD[dt.getDay()]}, ${dt.getDate()}. ${MON[dt.getMonth()]}, ${String(dt.getHours()).padStart(2, '0')}:00 Uhr</b>`; }
        else { const dt = dayToDate(p[0]); html = `<b>${dt.getUTCDate()}. ${MON[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</b>`; } }
      html += `<br><i style="background:${s.color}"></i>${esc(s.name)}: <b>${esc((s.fmt || fmt)(p[1]))}</b>`;
    });
    xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth, left = cx / W * r.width;
    tip.style.left = Math.min(Math.max(left + (left > r.width / 2 ? -tw - 12 : 12), 0), r.width - tw) + 'px';
  };
  const leave = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); el.querySelectorAll('circle[class^=dot]').forEach(c => c.setAttribute('visibility', 'hidden')); };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
const legend = items => `<div class="legend">${items.map(s => `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
const RANGES = {'1M': 30, '3M': 91, '6M': 182, '1J': 365, '3J': 1096, 'Max': 1e6};

/* ---------------------------------------------------------------- Logos und 7-Tage-Verlauf (Watchlist am Handy)
   Logos liegen als data-URI in logos.json im privaten Daten-Repo (holt der Tageslauf), damit der Browser keine fremden
   Bildserver fragt. Einmal pro Seitenaufruf nachgeladen; vorhandene Platzhalter werden danach ersetzt. */
async function loadLogos() {
  if (S.logos) return;
  try { S.logos = (await store.get('logos.json')) || {}; } catch (e) { S.logos = {}; }
  S.logoDark = {};
  // Logos frei stehend wie in Broker-Apps; nur wo ein freigestelltes Logo im aktuellen Farbschema verschwinden würde, ein Hintergrund
  await Promise.all(Object.entries(S.logos).map(async ([key, v]) => {
    if (!v || !v.img) return;
    try {
      const im = new Image(); im.src = v.img; await im.decode();
      const cv = document.createElement('canvas'); cv.width = cv.height = 24;
      const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, 24, 24);
      const px = cx.getImageData(0, 0, 24, 24).data; let clear = 0, n = 0, lum = 0;
      for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 100) { clear++; continue; } n++; lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; }
      // op: Bild mit eigenem Hintergrund (wie ein App-Symbol); tl/td: freigestelltes helles bzw. dunkles Logo
      S.logoDark[key] = clear > 576 * 0.15 && n ? (lum / n > 200 ? 'tl' : lum / n < 70 ? 'td' : 'tm') : 'op';
    } catch (e) { /* Bild nicht lesbar: weißer Kreis */ }
  }));
  document.querySelectorAll('.lg[data-key]').forEach(el => { const h = logoImg(el.dataset.key); if (h) el.innerHTML = h; });
}
const logoImg = key => { const x = ((S.logos || {})[key] || {}).img; return x && /^data:image\//.test(x) ? `<img src="${x}" alt="" loading="lazy" class="${(S.logoDark || {})[key] || 'op'}">` : ''; };
const logo = key => `<span class="lg" data-key="${esc(key)}">${logoImg(key) || `<b>${esc(String(key.split(':')[1] || '?').replace(/[^A-Z0-9]/gi, '').slice(0, 1))}</b>`}</span>`;
// 7 Tage aus Stundenkursen (market.json → spark, stündlich erneuert), dazu der aktuelle Kurs. Gestaltet wie in Börsen-Apps:
// geglättete Kurve (Mittel über Zeitblöcke, weiche Bögen), Fläche mit Farbverlauf, gestrichelte Linie beim Stand von vor 7 Tagen,
// Punkt am aktuellen Kurs. Grün oder rot nach der Änderung über die 7 Tage.
let sparkN = 0;
function spark7(key) {
  const s = (S.market.spark || {})[key];
  if (!s || s.length < 5) return spark(key, 7);
  let c = s.slice(); const live = A(key).price;
  if (live != null && !A(key).error) c.push(live);
  const first = c[0], last = c[c.length - 1], N = 34;
  if (c.length > N) { const st = c.length / N; c = Array.from({length: N}, (_, b) => { const seg = c.slice(Math.floor(b * st), Math.max(Math.floor((b + 1) * st), Math.floor(b * st) + 1)); return seg.reduce((a, x) => a + x, 0) / seg.length; }); }
  c[0] = first; c[c.length - 1] = last;
  const W = 66, H = 22, x0 = 1, x1 = W - 4, lo = Math.min(...c, first), hi = Math.max(...c, first);
  const y = v => hi === lo ? H / 2 : 2.5 + (1 - (v - lo) / (hi - lo)) * (H - 6);
  const P = c.map((v, i) => [x0 + i * (x1 - x0) / (c.length - 1), y(v)]);
  const cl = v => Math.max(1, Math.min(H - 1, v)).toFixed(1);
  let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {      // Catmull-Rom als Bézier-Bögen
    const a = P[i - 1] || P[i], b = P[i], e = P[i + 1], f = P[i + 2] || e;
    d += `C${(b[0] + (e[0] - a[0]) / 6).toFixed(1)} ${cl(b[1] + (e[1] - a[1]) / 6)} ${(e[0] - (f[0] - b[0]) / 6).toFixed(1)} ${cl(e[1] - (f[1] - b[1]) / 6)} ${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
  }
  const up = last >= first, col = `var(--${up ? 'up' : 'down'})`, id = 'sg' + (++sparkN), yb = y(first).toFixed(1), E = P[P.length - 1];
  return `<svg class="spark7" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${col}" stop-opacity=".34"/><stop offset=".85" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${x0}" x2="${x1}" y1="${yb}" y2="${yb}" class="base"/>
    <path d="${d}L${x1} ${H}L${x0} ${H}Z" fill="url(#${id})" stroke="none"/><path d="${d}" class="ln" style="stroke:${col}"/>
    <circle cx="${E[0].toFixed(1)}" cy="${E[1].toFixed(1)}" r="3.4" style="fill:${col}" opacity=".22"/><circle cx="${E[0].toFixed(1)}" cy="${E[1].toFixed(1)}" r="1.7" style="fill:${col}"/></svg>`;
}
// Marktwert kurz, in der Anzeigewährung (Aktien in Euro, Coins in Dollar)
function mcapOf(key) {
  const v = isCoin(key) ? D(key).mcap : (D(key).fund || {}).market_cap;
  return v ? toShow(key, v) : null;
}
function mcapTxt(key) {
  const v = mcapOf(key); if (!v) return null;
  const [d, u] = v >= 1e12 ? [1e12, 'Bio.'] : v >= 1e9 ? [1e9, 'Mrd.'] : [1e6, 'Mio.'];
  const x = v / d;
  return nf(x, x >= 100 ? 0 : x >= 10 ? 1 : 2) + ' ' + u + ' ' + (CUR[showCur(key)] || showCur(key));
}

/* ---------------------------------------------------------------- Mini-Verlauf (Sparkline) */
function spark(key, n = 30) {
  const h = D(key).hist;
  if (!h || h.c.length < 3) return '<span class="ts">–</span>';
  const c = h.c.slice(-n), live = A(key).price;
  if (live != null && !A(key).error) c.push(live);
  const lo = Math.min(...c), hi = Math.max(...c), W = 84, H = 26, k = (W - 2) / (c.length - 1);
  const y = v => hi === lo ? H / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (H - 4);
  const d = c.map((v, i) => (i ? 'L' : 'M') + (1 + i * k).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
  const up = c[c.length - 1] >= c[0];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" style="stroke:var(--${up ? 'up' : 'down'})"/></svg>`;
}
function rangeBar(key) {
  const t = D(key).tech || {}, p = A(key).price;
  if (!t.low52 || !t.high52 || p == null || t.high52 <= t.low52) return '<span class="ts">–</span>';
  const pos = Math.max(0, Math.min(1, (p - t.low52) / (t.high52 - t.low52)));
  return `<div class="rng" title="52 Wochen: ${esc(px(key, t.low52))} bis ${esc(px(key, t.high52))}"><i style="left:${(pos * 100).toFixed(1)}%"></i></div><div class="ts num">${nf(pos * 100, 0)} % der Spanne</div>`;
}

/* ---------------------------------------------------------------- Heatmap: Flächen nach Gewicht (squarified treemap) */
function squarify(items, x, y, w, h) {
  const out = [], rest = items.filter(i => i.v > 0).sort((a, b) => b.v - a.v);
  const total = rest.reduce((s, i) => s + i.v, 0); if (!total) return out;
  const scale = w * h / total; rest.forEach(i => i.a = i.v * scale);
  const worst = (row, side) => { const s = row.reduce((t, i) => t + i.a, 0), mx = Math.max(...row.map(i => i.a)), mn = Math.min(...row.map(i => i.a)); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
  let row = [];
  while (rest.length) {
    const side = Math.min(w, h), it = rest[0];
    if (!row.length || worst(row.concat(it), side) <= worst(row, side)) { row.push(rest.shift()); continue; }
    ({x, y, w, h} = lay(row, x, y, w, h, out)); row = [];
  }
  if (row.length) lay(row, x, y, w, h, out);
  return out;
  function lay(r, x, y, w, h, out) {
    const s = r.reduce((t, i) => t + i.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; r.forEach(i => { const ih = i.a / cw; out.push(Object.assign({}, i, {x, y: cy, w: cw, h: ih})); cy += ih; }); return {x: x + cw, y, w: w - cw, h}; }
    const ch = s / w; let cx = x; r.forEach(i => { const iw = i.a / ch; out.push(Object.assign({}, i, {x: cx, y, w: iw, h: ch})); cx += iw; }); return {x, y: y + ch, w, h: h - ch};
  }
}

/* ---------------------------------------------------------------- Einordnung der Titel */
const SECTOR_DE = {Technology: 'Technologie', 'Financial Services': 'Finanzen', Healthcare: 'Gesundheit', 'Consumer Cyclical': 'Zyklischer Konsum',
  'Consumer Defensive': 'Basiskonsum', 'Communication Services': 'Kommunikation', Industrials: 'Industrie', Energy: 'Energie', Utilities: 'Versorger',
  'Real Estate': 'Immobilien', 'Basic Materials': 'Grundstoffe'};
const isCommodity = key => !isCoin(key) && /\b(ETC|Gold|Commodit|Rohstoff)/i.test(nameOf(key));
const assetClass = key => isCoin(key) ? 'Krypto' : isCommodity(key) ? 'Rohstoffe' : isFund(key) ? 'ETFs' : 'Aktien';
const sectorOf = key => isCoin(key) ? 'Krypto' : isCommodity(key) ? 'Rohstoffe' : isFund(key) ? 'Breite ETFs' : SECTOR_DE[(D(key).fund || {}).sector] || (D(key).fund || {}).sector || 'Ohne Angabe';
// Branchen des Depots in Euro. Aktien-ETFs werden nach ihrem Inhalt aufgeteilt (daily.json → sectors, aus Yahoo topHoldings).
// Krypto, Rohstoffe und Titel ohne Angabe stehen getrennt in outside.
function sectorMix(c) {
  const by = {}, parts = {}, outside = {};
  let eq = 0, total = 0;
  c.held.forEach(p => {
    if (!(p.value > 0)) return;
    total += p.value;
    const cls = assetClass(p.key), d = D(p.key);
    const w = cls === 'Krypto' || cls === 'Rohstoffe' ? null : isFund(p.key) ? d.sectors : (d.fund || {}).sector ? {[d.fund.sector]: 1} : null;
    const sum = w ? Object.values(w).reduce((a, b) => a + b, 0) : 0;
    if (!sum) { const k = cls === 'Krypto' || cls === 'Rohstoffe' ? cls : 'Ohne Angabe'; outside[k] = (outside[k] || 0) + p.value; return; }
    eq += p.value;
    Object.entries(w).forEach(([s, x]) => { const v = p.value * x / sum; by[s] = (by[s] || 0) + v; (parts[s] = parts[s] || []).push({key: p.key, v, via: isFund(p.key)}); });
  });
  return {by, parts, outside, eq, total};
}

/* ---------------------------------------------------------------- Rückrechnung der heutigen Positionen
   Wie ein Fonds-Factsheet: Was hätten die heutigen Bestände in der Vergangenheit gemacht? Grundlage für
   Wertentwicklung, Schwankung, größten Rückgang und Beta, solange die echten Kaufdaten noch kurz zurückreichen. */
function backcast(c = calc()) {   // c: Ergebnis von calc (auch für ein Teildepot, z. B. jakobBook)
  if (c.bc !== undefined) return c.bc;
  const held = c.held.filter(p => p.value > 0 && D(p.key).hist && D(p.key).hist.d.length > 1);
  if (!held.length) return (c.bc = null);
  const end = todayDay(), big = held.filter(p => p.weight >= 2);
  let start = Math.max(end - 1826, ...big.map(p => D(p.key).hist.d[0]));
  const d = [], v = [];
  for (let day = start; day <= end; day++) {
    let s = 0;
    for (const p of held) {
      const pr = day === end && p.price != null ? p.price : priceAt(p.key, day);
      if (pr != null) s += p.qty * pr / (fxAt(p.cur, day) || 1);
    }
    d.push(day); v.push(s);
  }
  return (c.bc = {d, v});
}
function seriesAt(ser, day) { const i = bisect(ser.d, day); return i >= 0 ? ser.v[i] : null; }
function perfStats() {
  const bc = backcast(), c = calc();
  if (!bc || bc.d.length < 2) return null;
  const end = bc.d[bc.d.length - 1], last = bc.v[bc.v.length - 1];
  const yStart = isoToDay(new Date().getFullYear() + '-01-01') - 1;
  const sp = (S.daily.bench || {}).SP500;
  const spAt = day => { if (!sp || !sp.d.length) return null; const i = bisect(sp.d, day); return i < 0 ? null : sp.c[i] / (fxAt(sp.currency || 'USD', day) || 1); };
  const per = (label, from) => {
    if (from < bc.d[0]) return {label, v: null, b: null};
    const a = seriesAt(bc, from), s0 = spAt(from), s1 = spAt(end);
    return {label, v: a ? (last / a - 1) * 100 : null, b: s0 && s1 ? (s1 / s0 - 1) * 100 : null};
  };
  const out = [{label: 'Heute', v: c.dayPct, b: ((S.market.indices || []).find(x => x.sym === '^GSPC') || {}).change_pct}, per('1 Woche', end - 7), per('1 Monat', end - 30), per('Seit 1. Januar', yStart), per('1 Jahr', end - 365), per('3 Jahre', end - 1095)];
  // Risiko über das letzte Jahr
  const i0 = Math.max(1, bc.d.length - 365), r = [], m = [];
  let peak = 0, dd = 0;
  for (let i = i0; i < bc.d.length; i++) {
    if (bc.v[i - 1] > 0) r.push(bc.v[i] / bc.v[i - 1] - 1);
    const a = spAt(bc.d[i - 1]), b = spAt(bc.d[i]); m.push(a && b ? b / a - 1 : 0);
    peak = Math.max(peak, bc.v[i]); if (peak > 0) dd = Math.min(dd, bc.v[i] / peak - 1);
  }
  const mean = x => x.reduce((s, y) => s + y, 0) / (x.length || 1);
  const mr = mean(r), mm = mean(m.slice(-r.length));
  const vol = r.length > 20 ? Math.sqrt(mean(r.map(x => (x - mr) ** 2))) * Math.sqrt(365) * 100 : null;
  const mx = m.slice(-r.length), cov = mean(r.map((x, i) => (x - mr) * (mx[i] - mm))), vm = mean(mx.map(x => (x - mm) ** 2));
  return {periods: out, vol, maxDD: r.length > 20 ? dd * 100 : null, beta: vm > 0 && r.length > 60 ? cov / vm : null, since: bc.d[0]};
}

/* ---------------------------------------------------------------- Risiko in Euro
   Alles für die heutigen Positionen (backcast) bzw. je Position aus Wochenrenditen (Wochen statt Tage, weil Börsen in
   Europa, den USA und der Devisenmarkt zu verschiedenen Zeiten schließen). Szenarien über Betas je Position:
   Aktienmarkt (S&P 500 in Dollar) und Dollar (Wert eines Dollars in Euro) gemeinsam geschätzt, Coins gegen Bitcoin. */
const dayIso = d => new Date(d * DAY).toISOString().slice(0, 10);
function ols2(y, x1, x2) {
  const n = y.length, m = a => a.reduce((s, v) => s + v, 0) / n, my = m(y), m1 = m(x1), m2 = m(x2);
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0;
  for (let i = 0; i < n; i++) { const a = x1[i] - m1, b = x2[i] - m2, c = y[i] - my; s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * c; s2y += b * c; }
  const det = s11 * s22 - s12 * s12;
  return det > 0 ? [(s22 * s1y - s12 * s2y) / det, (s11 * s2y - s12 * s1y) / det] : [null, null];
}
function ols1(y, x) {
  const n = y.length, my = y.reduce((s, v) => s + v, 0) / n, mx = x.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  return sxx > 0 ? sxy / sxx : null;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function riskStats() {
  const c = calc();
  if (c.risk !== undefined) return c.risk;
  const bc = backcast(), V = c.value, end = todayDay();
  if (!bc || bc.d.length < 60 || !(V > 0)) return (c.risk = null);
  const at = day => seriesAt(bc, day);
  const r = {};
  // Abstand zum Hoch der letzten 12 Monate
  let pk = -1, pkDay = null;
  for (let i = Math.max(0, bc.d.length - 366); i < bc.d.length; i++) if (bc.v[i] > pk) { pk = bc.v[i]; pkDay = bc.d[i]; }
  r.fromHigh = {pct: (bc.v[bc.v.length - 1] / pk - 1) * 100, eur: bc.v[bc.v.length - 1] - pk, day: pkDay};
  // Schlechter Tag: jeder 20. Handelstag im letzten Jahr war mindestens so schlecht (Wochenenden ohne Kurse ausgelassen)
  const dr = [];
  let worstDay = {v: 0, day: null};
  for (let i = Math.max(1, bc.d.length - 365); i < bc.d.length; i++) {
    const dow = (bc.d[i] + 4) % 7;
    if (dow === 0 || dow === 6) continue;
    let j = i - 1; while (j > 0 && [0, 6].includes((bc.d[j] + 4) % 7)) j--;
    if (bc.v[j] > 0) { const x = bc.v[i] / bc.v[j] - 1; dr.push(x); if (x < worstDay.v) worstDay = {v: x, day: bc.d[i]}; }
  }
  const q05 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.05)] : null; };
  r.badDay = dr.length > 100 ? q05(dr) * V : null;
  if (dr.length > 100) { const m = dr.reduce((a, x) => a + x, 0) / dr.length; r.vol = Math.sqrt(dr.reduce((a, x) => a + (x - m) ** 2, 0) / dr.length) * Math.sqrt(252) * 100; }
  r.worstDay = worstDay.day ? {eur: worstDay.v * V, pct: worstDay.v * 100, day: worstDay.day} : null;
  // Schlechter Monat (30 Tage): aus allen 30-Tage-Abschnitten der Rückrechnung, dazu der schlechteste im letzten Jahr
  const mr = [];
  let worstMonth = {v: 0, day: null};
  for (let i = 30; i < bc.d.length; i++) if (bc.v[i - 30] > 0) {
    const x = bc.v[i] / bc.v[i - 30] - 1; mr.push(x);
    if (bc.d[i] > end - 365 && x < worstMonth.v) worstMonth = {v: x, day: bc.d[i]};
  }
  r.badMonth = mr.length > 200 ? q05(mr) * V : null;
  r.worstMonth = worstMonth.day ? {eur: worstMonth.v * V, pct: worstMonth.v * 100, day: worstMonth.day} : null;
  // Größter Rückgang über die ganze Rückrechnung und wie lange die Erholung dauerte
  let peak = bc.v[0], peakD = bc.d[0], best = {dd: 0};
  for (let i = 1; i < bc.d.length; i++) {
    if (bc.v[i] > peak) { peak = bc.v[i]; peakD = bc.d[i]; }
    const dd = bc.v[i] / peak - 1;
    if (dd < best.dd) best = {dd, peakD, peakV: peak, troughD: bc.d[i]};
  }
  if (best.peakD != null) {
    const k = bc.d.findIndex((d, i) => d > best.troughD && bc.v[i] >= best.peakV);
    r.maxDD = {pct: best.dd * 100, eur: best.dd * V, peak: best.peakD, trough: best.troughD, back: k >= 0 ? bc.d[k] : null, since: bc.d[0]};
  }
  // Betas je Position aus Wochenrenditen der letzten drei Jahre (Coins: ein Jahr)
  const sp = (S.daily.bench || {}).SP500, btc = (S.daily.bench || {}).BTC;
  const raw = (b, day) => { if (!b) return null; const i = bisect(b.d, day); return i < 0 ? null : b.c[i]; };
  const usdEur = day => 1 / (fxAt('USD', day) || 1);
  const wk = n => Array.from({length: n + 1}, (_, i) => end - 7 * (n - i));
  const pos = c.held.filter(p => p.value > 0).map(p => {
    const h = D(p.key).hist, coin = isCoin(p.key), weeks = wk(coin ? 52 : 156);
    const o = {key: p.key, symbol: p.symbol, v: p.value, coin, cls: assetClass(p.key), bMkt: null, bUsd: null, bBtc: null, est: false};
    if (h && h.d.length > 2) {
      const pe = day => { if (day < h.d[0]) return null; const pr = day === end && p.price != null ? p.price : priceAt(p.key, day); return pr == null ? null : pr / (fxAt(p.cur, day) || 1); };
      const y = [], x1 = [], x2 = [], xb = [], yu = [];
      for (let i = 1; i < weeks.length; i++) {
        const a = pe(weeks[i - 1]), b = pe(weeks[i]), s0 = raw(sp, weeks[i - 1]), s1 = raw(sp, weeks[i]), f0 = usdEur(weeks[i - 1]), f1 = usdEur(weeks[i]);
        if (!a || !b || !s0 || !s1) continue;
        y.push(b / a - 1); x1.push(s1 / s0 - 1); x2.push(f1 / f0 - 1);
        if (coin) { const c0 = raw(btc, weeks[i - 1]), c1 = raw(btc, weeks[i]); xb.push(c0 && c1 ? c1 / c0 - 1 : 0); yu.push((b * f0) / (a * f1) - 1); }
      }
      if (y.length >= (coin ? 20 : 40)) {
        const [b1, b2] = ols2(y, x1, x2); o.bMkt = b1 == null ? null : clamp(b1, -1, 3); o.bUsd = b2 == null ? null : clamp(b2, -0.5, 1.5);
        if (coin) { const b = ols1(yu, xb); o.bBtc = b == null ? null : clamp(b, 0, 3); }
      }
    }
    // Ohne genug Verlauf (z. B. neu an der Börse): Faustwerte, als geschätzt markiert
    if (o.bMkt == null) { o.bMkt = coin ? 0.5 : o.cls === 'Rohstoffe' ? 0.2 : 1; o.est = true; }
    if (o.bUsd == null) { o.bUsd = coin || curOf(p.key) === 'USD' ? 1 : 0; o.est = true; }
    if (coin && o.bBtc == null) { o.bBtc = p.symbol === 'BTC' ? 1 : 1.5; o.est = true; }
    return o;
  });
  const scen = (label, f, top = true) => { const parts = pos.map(o => ({o, x: f(o)})).filter(z => z.x).sort((a, b) => a.x - b.x);
    const sum = parts.reduce((s, z) => s + z.x, 0); return {label, eur: sum, pct: sum / V * 100, top: top ? parts.slice(0, 3) : []}; };
  r.scen = [
    scen('Aktienmarkt −10 %', o => o.v * o.bMkt * -0.10),
    scen('Aktienmarkt −25 %', o => o.v * o.bMkt * -0.25, false),
    ...(pos.some(o => o.coin) ? [scen('Bitcoin −30 %', o => o.coin ? o.v * o.bBtc * -0.30 : 0)] : []),
    scen('Dollar −10 % zum Euro', o => o.v * o.bUsd * -0.10)];
  r.usdShare = pos.reduce((s, o) => s + o.v * o.bUsd, 0) / V * 100;
  r.beta = pos.reduce((s, o) => s + o.v * o.bMkt, 0) / V;
  r.est = pos.filter(o => o.est).map(o => shortName(o.key));
  // Klumpen
  const cls = {}; pos.forEach(o => { cls[o.cls] = (cls[o.cls] || 0) + o.v; });
  r.classes = Object.entries(cls).map(([name, v]) => ({name, pct: v / V * 100}));
  const stocks = c.held.filter(p => p.value > 0 && assetClass(p.key) === 'Aktien');
  r.topStock = stocks[0] ? {symbol: stocks[0].symbol, key: stocks[0].key, pct: stocks[0].weight, half: -stocks[0].value / 2} : null;
  r.top5 = stocks.slice(0, 5).reduce((s, p) => s + p.weight, 0);
  const mix = sectorMix(c), wb = ((S.daily.sector_bench || {})['MSCI World']) || {};
  const sec = Object.entries(mix.by).sort((a, b) => b[1] - a[1])[0];
  r.topSector = sec && mix.eq ? {name: SECTOR_DE[sec[0]] || sec[0], pct: sec[1] / V * 100, ofEq: sec[1] / mix.eq * 100, world: wb[sec[0]] != null ? wb[sec[0]] * 100 : null} : null;
  // Was demnächst ansteht oder auffällt
  const held = new Map(c.held.filter(p => p.value > 0).map(p => [p.key, p]));
  r.earnings = (S.digest.calendar || []).filter(e => e.category === 'Earnings' && held.has(e.key) && isoToDay(e.date) >= end && isoToDay(e.date) <= end + 21)
    .map(e => ({symbol: e.symbol, key: e.key, date: e.date, pct: held.get(e.key).weight}));
  const pick = f => { const l = c.held.filter(p => p.value > 0 && f(p)); return {pct: l.reduce((s, p) => s + p.weight, 0), list: l.map(p => shortName(p.key))}; };
  r.expensive = pick(p => { const x = ratingOf(p.key); return x != null && x <= 3; });
  r.estDown = pick(p => { const f = D(p.key).fund; if (!f) return false; const v = f.est_chg_90d != null ? f.est_chg_90d : (f.est_eps != null && f.est_eps_90d ? (f.est_eps - f.est_eps_90d) / Math.abs(f.est_eps_90d) * 100 : null); return v != null && v <= -5; });
  r.losers = pick(p => p.pnlPct != null && p.pnlPct <= -20);
  return (c.risk = r);
}

/* ---------------------------------------------------------------- Börsenzeiten */
function marketState(tz, open, close) {
  const f = new Intl.DateTimeFormat('en-GB', {timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false}).formatToParts(new Date());
  const g = t => (f.find(p => p.type === t) || {}).value, wd = g('weekday'), mins = +g('hour') * 60 + +g('minute');
  return !['Sat', 'Sun'].includes(wd) && mins >= open && mins < close;
}
function markets() {
  const idx = sym => (S.market.indices || []).find(x => x.sym === sym) || {};
  // Feiertag: laut Uhrzeit offen, aber der Index hat seit über 40 Minuten keinen neuen Kurs
  const fresh = sym => { const t = idx(sym).time, u = Date.parse(S.market.updated || ''); return !t || !u || u / 1000 - t < 2400; };
  return [
    {name: 'New York', open: marketState('America/New_York', 570, 960) && fresh('^GSPC'), hours: '15:30–22:00'},
    {name: 'Xetra', open: marketState('Europe/Berlin', 540, 1050) && fresh('^GDAXI'), hours: '9:00–17:30'},
    {name: 'Krypto', open: true, hours: 'rund um die Uhr'},
  ];
}

/* ---------------------------------------------------------------- Strategie Wachstums-Momentum (Jakobs Wunsch vom 27.11.2026)
   Ersetzt die Strategie vom 22.11.2026 (KI-Auswahl, Passung „Für dich“, Ausnahmen bei Angst und Halbleiter-Crash).
   Regel aus dem Test bekannter Strategien von Hedgefonds und Wachstums-Investoren (tracker/backtest.py, 26.11.2026) und dem
   Vergleich mit Jakobs Quality-Growth-Vorlage (27.11.2026): Auswahl S&P 500 und Nasdaq-100 (heutige Mitglieder) und 18
   Länder-ETFs der Schwellenländer; relative Stärke wie bei IBD (Rendite 3 Monate zu 40 %, 6, 9 und 12 Monate zu je 20 %); nur
   Titel im Aufwärtstrend (Kurs über der 200-Tage-Linie, 50-Tage-Linie darüber); zum Monatsende die 6 stärksten, neue Titel
   mit gleichem Betrag, danach laufen Gewinner weiter (keine regelmäßige Gleichgewichtung); Obergrenze je Titel zum
   Monatsende (Frage maxpos, Standard 30 %); kein Stopp (Jakobs Wunsch vom 27.11.2026), wahlweise 25 % ab Hoch seit Kauf. Rangfolge und Ideal-Depot (Modell) rechnet tracker/screen.py (screen.json, alle 15 Minuten
   mit aktuellen Kursen). Hier nur Beträge, das Wort je Titel und die Prüfungen für das Depot Jakob; gleiche Regeln in
   tracker/screen.py (rule_words): beide Stellen ändern. Keine Anlageberatung. */
const RULE_V = 'wm4';
const STOP_PCT = 25;
// Fragen ans Profil. core = aus Jakobs Grok-Profil vorbelegt; lesson = Leitplanke aus dem FTX-Fall.
const QUESTIONS = [
  {id: 'risk', core: 1, q: 'Wie viel Risiko willst du eingehen?', o: [['low', 'Niedrig'], ['mid', 'Mittel'], ['high', 'Hoch']]},
  {id: 'horizon', core: 1, q: 'Wie lange willst du anlegen?', o: [['lt2', 'Unter 2 Jahre'], ['2to5', '2 bis 5 Jahre'], ['gt5', 'Über 5 Jahre']]},
  {id: 'max_dd', core: 1, q: 'Welchen Rückgang des Depots hältst du aus, ohne zu verkaufen?', why: 'Bestimmt den Aktienanteil. Voll investiert fiel die Regel im Backtest um bis zu 52 % (je nach Stichtag bis 57 %).', o: [[15, '−15 %'], [25, '−25 %'], [35, '−35 %'], [50, '−50 %']]},
  {id: 'stop', q: 'Verkaufen, wenn ein Titel 25 % unter sein Hoch seit dem Kauf fällt?', why: 'Backtest über 10 Jahre: ohne Stopp 34,8 % pro Jahr und −52 % größter Rückgang, mit Stopp 31,8 % und −49 %.', o: [['none', 'Nein, ohne Stopp'], ['t25', 'Ja, mit Stopp']]},
  {id: 'positions', core: 1, q: 'Wie viele Aktien willst du halten?', why: 'Backtest ohne Stopp, höchstens 30 % je Titel: 4 Titel 37,3 %, 5 Titel 36,2 %, 6 Titel 34,8 %, 7 Titel 34,7 %, 8 Titel 32,6 % pro Jahr. Weniger Titel heißt größere Einzelpositionen.', o: [[4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8']]},
  {id: 'min_pos', core: 1, q: 'Wie groß soll eine Position mindestens sein?', o: [[250, '250 €'], [500, '500 €'], [1000, '1.000 €']]},
  {id: 'capital', q: 'Mit wie viel startest du das Depot Jakob?', why: 'Grundlage für die Beträge im Ideal-Depot, bis das Depot größer ist.', o: [[2500, '2.500 €'], [5000, '5.000 €'], [10000, '10.000 €'], [20000, '20.000 €']]},
  {id: 'monthly', q: 'Wie viel legst du jeden Monat neu an?', o: [[0, 'Nichts'], [250, '250 €'], [500, '500 €'], [1000, '1.000 €'], [2000, '2.000 €']]},
  {id: 'rate', q: 'Wohin soll die Monatsrate gehen?', o: [['gap', 'Was am meisten fehlt'], ['split', 'Gleich auf alle']]},
  {id: 'on_loss', core: 1, q: 'Was tust du bei starken Verlusten?', o: [['buy', 'Nachkaufen, wenn die These hält'], ['hold', 'Halten'], ['sell', 'Verkaufen']]},
  {id: 'need', q: 'Brauchst du dieses Geld in den nächsten 2 Jahren für etwas Bestimmtes?', why: 'Fest eingeplantes Geld verträgt keinen Rückgang von 40 %.', o: [['yes', 'Ja, fest eingeplant'], ['maybe', 'Vielleicht'], ['no', 'Nein']]},
  {id: 'maxpos', q: 'Wie groß darf eine einzelne Aktie höchstens werden?', why: 'Zum Monatsende geprüft: Was darüber liegt, wird verkauft und auf die übrigen Titel verteilt. Backtest mit 6 Titeln: 15 % 28,5 %, 20 % 33,2 %, 25 % 34,6 %, 30 % 34,8 %, 35 % 35,4 %, ohne Grenze 35,5 % pro Jahr (dann über die Hälfte in einem Titel).', o: [[15, '15 %'], [20, '20 %'], [25, '25 %'], [30, '30 %'], [35, '35 %'], ['none', 'Keine Grenze']]},
  {id: 'share', q: 'Welcher Teil deines Vermögens steckt in Aktien und Krypto?', why: 'Je größer der Anteil, desto mehr zählt ein Rückgang.', o: [['lt25', 'Unter 25 %'], ['25-50', '25 bis 50 %'], ['50-75', '50 bis 75 %'], ['gt75', 'Über 75 %']]},
  {id: 'lever', lesson: 1, q: 'Nutzt du Hebel, Optionen oder Kredit?', why: 'Lehre aus FTX: Hebel macht aus einem Rückgang einen Totalverlust.', o: [['no', 'Nein'], ['some', 'Manchmal'], ['yes', 'Ja']]},
  {id: 'wallet', lesson: 1, q: 'Wo liegen deine Coins?', why: 'Lehre aus FTX: Auf einer Krypto-Börse sind Coins im Ernstfall weg.', o: [['self', 'Eigene Wallet'], ['broker', 'Beim Broker'], ['exchange', 'Auf einer Krypto-Börse']]},
  {id: 'profit', q: 'Was tust du bei großen Gewinnen?', o: [['run', 'Laufen lassen'], ['50', 'Ab +50 % einen Teil verkaufen'], ['100', 'Ab +100 % einen Teil verkaufen']]},
  {id: 'etf', q: 'Gehören deine ETFs zur Strategie?', why: 'Sonst zählen nur die Einzelaktien.', o: [['apart', 'Nein, getrennt'], ['base', 'Ja, als Basis']]},
  {id: 'crypto', q: 'Und Krypto?', o: [['apart', 'Getrennt'], ['part', 'Gehört dazu']]},
  {id: 'push', q: 'Wann sollen Hinweise aufs Handy kommen?', o: [['important', 'Nur Wichtiges'], ['all', 'Alles'], ['none', 'Gar nicht']]}];
const prof = () => S.pf.profile || {};
const ansOf = id => (prof().answers || {})[id];
const ansLabel = id => { const q = QUESTIONS.find(x => x.id === id), v = ansOf(id); const o = q && q.o.find(x => String(x[0]) === String(v)); return o ? o[1] : null; };
const scrRow = key => (S.scr || {})[key];
const stopPct = () => ansOf('stop') === 't25' ? STOP_PCT : null;   // seit 27.11.2026 ohne Stopp, außer die Antwort sagt „mit Stopp“
// Obergrenze je Titel in Prozent (Frage maxpos, Standard 30; gleich in tracker/screen.py cap_pct)
const capPct = () => { const v = ansOf('maxpos'); return v === 'none' ? null : v != null && !isNaN(+v) ? +v : 30; };
// Momentum-Signal (tracker/analytics.momentum) bleibt als Kurs-Hinweis für Titel außerhalb der Auswahl (Coins, ETFs)
const momOf = key => D(key).mom || null;
// Angst und Gier: aus screen.json, wenn es neuer ist als daily.json (der Kurslauf rechnet alle 15 Minuten neu)
const marketFg = () => (S.screen && (S.screen.updated || '') > (S.daily.updated || '') && S.screen.mfg) || S.daily.market_fg;
const FEAR = 25;
function calcFor(dep) { const sd = S.dep, sc = S.calc; S.dep = dep; S.calc = null; const r = calc(); S.dep = sd; S.calc = sc; return r; }
// Strategie nur für das Teildepot Jakob (Jakobs Wunsch vom 22.11.2026): Ideal-Depot, Wort je Titel, Monatsrate, Regel-Check.
// Hauptdepot und Fenja bleiben außen vor. Zwischenergebnisse gelten für eine Darstellung (render setzt sie zurück).
const STRAT_DEP = 'jakob';
function jakobBook() {
  if (!S._jb) S._jb = depots().some(d => d.id === STRAT_DEP) ? calcFor(STRAT_DEP) : {held: [], value: 0};
  return S._jb;
}
// Eine Buchung mit `alias` (z. B. Hinterlegungsschein) zählt als die Aktie mit diesem Kürzel, mit der die Strategie rechnet.
// Gleiche Regel in tracker/screen.py (_held): beide Stellen ändern.
function stratKey(key) {
  if (!S._alias) { S._alias = {}; for (const t of S.pf.transactions || []) if (t.alias) S._alias[keyOf(t.kind, t.symbol)] = keyOf(t.kind, t.alias); }
  return S._alias[key] || key;
}
function jakobHeld() {
  const jb = jakobBook();
  if (!jb._held) {
    const out = {};
    for (const p of jb.held.filter(p => p.value > 0)) {
      const k = stratKey(p.key), o = out[k];
      out[k] = o ? Object.assign({}, o, {value: o.value + p.value, cost: o.cost + p.cost, dayEur: (o.dayEur || 0) + (p.dayEur || 0), via: [...(o.via || [o.key]), p.key]}) : (k === p.key ? p : Object.assign({}, p, {via: [p.key]}));
    }
    jb._held = out;
  }
  return jb._held;
}
// Tag, an dem die heutige Position begann (erster Kauf, nachdem der Bestand zuletzt null war): Grundlage für den Stopp
function jakobSince() {
  if (!S._since) {
    const q = {}, s = {};
    const txs = (S.pf.transactions || []).filter(t => (t.depot || 'main') === STRAT_DEP && (t.type === 'buy' || t.type === 'sell')).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const t of txs) { const k = stratKey(keyOf(t.kind, t.symbol)), x = +t.qty || 0;
      if (t.type === 'buy' && (q[k] || 0) <= 1e-9) s[k] = String(t.date).slice(0, 10);
      q[k] = (q[k] || 0) + (t.type === 'buy' ? x : -x); }
    S._since = s;
  }
  return S._since;
}
// Nachlauf-Stopp für eine Position im Depot Jakob: Hoch der Schlusskurse seit dem Kauf (und der aktuelle Kurs) gegen jetzt.
// Gerechnet mit dem gehaltenen Wertpapier selbst (bei einem Hinterlegungsschein dessen Kurs).
function stopOf(key) {
  const h0 = jakobHeld()[key], since = jakobSince()[key];
  if (!h0 || !since) return null;
  const k = (h0.via || [h0.key || key])[0], h = D(k).hist, p = A(k).price, stop = stopPct();
  let hi = null, last = p;
  if (h && h.d && h.d.length) { const d0 = isoToDay(since); for (let i = 0; i < h.d.length; i++) if (h.d[i] >= d0) hi = Math.max(hi ?? -Infinity, h.c[i]); last = p ?? h.c[h.c.length - 1]; }
  if (last != null) hi = Math.max(hi ?? last, last);
  if (!hi || last == null) { const sr = scrRow(key); return sr && sr.stop ? Object.assign({}, sr.stop, {stop, near: stop != null && sr.stop.dd <= -(stop - 5)}) : null; }
  const dd = (last / hi - 1) * 100;
  return {hi, dd, stop, hit: stop != null && dd <= -stop, near: stop != null && dd <= -(stop - 5)};
}
const isStockOnly = key => !isCoin(key) && !isFund(key) && !isCommodity(key) || !!(scrRow(key) || {}).market;
// Ideal-Depot Jakob: die n stärksten Titel im Aufwärtstrend (screen.json → ranked), gleich gewichtet. n nach deiner Zahl der
// Positionen, höchstens Betrag ÷ Mindestgröße; Aktienanteil nach deiner Grenze für Rückgänge. Hinterlegungsscheine zählen als
// ihre Aktie. Das Modell (screen.json → ideal.model) läuft daneben nach der Regel weiter und zeigt Stopps und Verlauf.
const SHARE_BY_DD = {15: 30, 25: 50, 35: 75, 50: 100};
// Zahl der Titel (gleich in tracker/screen.py n_slots): 6, 7 oder 8; alte Antworten als Spanne („6-8“) nehmen die kleinste Zahl ab 6
function nSlots() {
  const v = ansOf('positions');
  if (v != null && !isNaN(+v)) return Math.max(1, +v);
  const [lo, hi] = String(v || '6-8').split('-').map(Number), h = hi || lo;
  return h >= 6 ? Math.min(Math.max(6, lo), h) : h;
}
// Teil über der Obergrenze (in Euro) für einen Titel im Depot Jakob; Grundlage ist der Betrag des Ideal-Depots
const overCap = (v, ib) => capPct() ? Math.max(0, v - capPct() / 100 * ib.base) : 0;
function idealBook() {
  if (S._ideal !== undefined) return S._ideal;
  const sc = S.screen;
  if (!sc || sc.rule !== RULE_V || !prof().answers) return (S._ideal = null);
  const N = nSlots(), minp = +ansOf('min_pos') || 500, share = (SHARE_BY_DD[+ansOf('max_dd') || 35] || 75) / 100;
  const jb = jakobBook(), base = Math.max(+ansOf('capital') || 5000, jb.value || 0);   // Startbetrag, bis das Depot Jakob größer ist
  const n = Math.max(1, Math.min(N, Math.floor(base * share / minp)));
  const model = sc.ideal || {}, stopped = new Set((model.stopped || []).map(e => 'stock:' + e.sym)), inModel = new Set((model.model || []).map(x => x.key));
  const keys = (sc.ranked || []).filter(k => stratKey(k) === k).slice(0, n), w = share / n;
  const items = keys.map((key, i) => ({key, rank: i + 1, w, eur: base * w, stopped: stopped.has(key), inModel: inModel.has(key)}));
  return (S._ideal = {n, N, share, base, items, reserve: 1 - w * items.length, minp, model, breadth: sc.breadth || {}});
}
// „Deine Regel“: ein Wort je Aktie für das Depot Jakob. Keine Empfehlung, nur deine Regeln (gleich in tracker/screen.py rule_words).
const RULE_CLS = {Kaufen: 'good', Nachkaufen: 'teal', Halten: 'blue', Verkaufen: 'bad', Warten: ''};
const RULE_ORDER = {Verkaufen: 0, Kaufen: 1, Nachkaufen: 2, Halten: 3, Warten: 4};
function monthEnd() { const d = new Date(); d.setMonth(d.getMonth() + 1, 0); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); return d; }
const meTxt = () => { const me = monthEnd(); return `${WT[me.getDay()]} ${me.getDate()}.${me.getMonth() + 1}.`; };
const rankTxt = (sr, n) => sr && sr.rank ? `Rang ${sr.rank} im Aufwärtstrend, Stärke ${sr.rs} von 99` : sr ? `Stärke ${sr.rs ?? '–'} von 99, kein Aufwärtstrend` : '';
function ruleOf(key) {
  key = stratKey(key);
  S._rules = S._rules || {};
  if (key in S._rules) return S._rules[key];
  const ib = idealBook(), sr = scrRow(key);
  if (!ib || !isStockOnly(key)) return (S._rules[key] = null);
  const out = (word, why, amount, when) => (S._rules[key] = {word, cls: RULE_CLS[word], why: why.filter(Boolean), eur: amount, when});
  const held = jakobHeld()[key], it = ib.items.find(x => x.key === key), me = meTxt();
  if (held) {
    const v = held.value, so = stopOf(key);
    if (so && so.hit) return out('Verkaufen', [`Stopp: ${pctS(so.dd, 0)} unter dem Hoch seit Kauf, deine Grenze −${so.stop} %`, 'Platz bleibt bis zum Monatsende frei'], v, 'sofort');
    if (!sr) return out('Halten', ['Noch keine Daten aus dem Filter'], null);
    if (!sr.member) return out('Verkaufen', ['nicht in der Auswahl der Regel (S&P 500, Nasdaq-100, Europa, China, Hongkong)'], v, me);
    if (!sr.trend) return out('Verkaufen', [`Aufwärtstrend gebrochen: Kurs ${pctS(sr.p200, 0)} zur 200-Tage-Linie${sr.p200 > 0 ? ', 50-Tage-Linie unter der 200-Tage-Linie' : ''}`, `Stärke ${sr.rs} von 99`], v, me);
    if (!it) return out('Verkaufen', [`nicht mehr unter den ${ib.n} stärksten: ${rankTxt(sr)}`], v, me);
    const stopTxt = so && so.stop ? `${pctS(so.dd, 0)} zum Hoch seit Kauf, Stopp bei −${so.stop} %` : '';
    // Gewinner laufen weiter (keine regelmäßige Gleichgewichtung); nachgekauft wird nur, solange der Startbetrag nicht angelegt ist
    const startOpen = (+ansOf('capital') || 0) - (jakobBook().cost || 0) >= ib.minp, oc = overCap(v, ib);
    if (it.eur - v >= ib.minp && startOpen) return out('Nachkaufen', [`Startbetrag noch nicht angelegt: Ziel ${eur(it.eur, 0)}, im Depot ${eur(v, 0)}`, rankTxt(sr), stopTxt], it.eur - v, me);
    return out('Halten', [rankTxt(sr), stopTxt, oc >= ib.minp / 2 ? `über deiner Grenze von ${capPct()} %: zum Monatsende etwa ${eur(oc, 0)} verkaufen und auf die übrigen Titel verteilen` : `im Depot ${eur(v, 0)}; Gewinner laufen weiter${capPct() ? ` bis ${capPct()} % je Titel` : ''}`], null);
  }
  if (it) return out('Kaufen', [rankTxt(sr), it.stopped ? 'im Ideal-Depot in diesem Monat gestoppt: erst zum Monatsende wieder' : ''], it.eur, me);
  if (sr && sr.member) return out('Warten', [sr.rank && sr.rank <= ib.n * 2 ? `knapp hinter den ${ib.n} stärksten: ${rankTxt(sr)}` : rankTxt(sr)], null);
  return (S._rules[key] = null);
}
// Monatsrate (Fragen monthly, rate, min_pos): Aktienanteil des Ideal-Depots in die Titel, die am weitesten unter ihrem Ziel
// liegen (bei „Gleich auf alle“ auf alle), der Rest bleibt Reserve. Ziel und Bestand nur im Depot Jakob.
function monthlyRate() {
  const m = +ansOf('monthly') || 0, ib = idealBook();
  if (!m || !ib) return null;
  const rule = ansOf('rate') === 'split' ? 'split' : 'gap', held = jakobHeld();
  const mm = ib.items.length ? Math.round(m * ib.share / 10) * 10 : 0;
  const k = Math.max(1, Math.floor(mm / ib.minp));
  const xs = ib.items.map(it => { const have = (held[it.key] || {}).value || 0; return {key: it.key, pct: it.w * 100, have, target: it.eur, gap: Math.max(0, it.eur - have)}; });
  let pick = [], by = 'gap', why;
  if (!xs.length) why = 'Kein Titel ist gerade im Aufwärtstrend vorn. Nach deiner Regel bleibt die Rate Reserve.';
  else if (rule === 'split') { pick = xs; by = 'pct'; why = 'Gleich auf alle Titel des Ideal-Depots.'; }
  else { pick = xs.filter(x => x.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, k); why = pick.length ? 'Die Titel des Ideal-Depots, die am weitesten unter ihrem Ziel liegen.' : 'Alle Titel sind am Ziel: Die Rate geht zum Monatsende gleich auf alle.'; if (!pick.length) { pick = xs; by = 'pct'; } }
  const wsum = pick.reduce((s, x) => s + (by === 'pct' ? x.pct : x.gap), 0);
  let left = mm;
  pick = pick.map((x, i) => { const v = i === pick.length - 1 ? left : Math.round(mm * (by === 'pct' ? x.pct : x.gap) / (wsum || 1) / 10) * 10; left -= v; return Object.assign({}, x, {eur: v}); });
  return {m, mm, reserve: m - (pick.length ? mm : 0), k, rule, rows: xs, pick, why, share: ib.share};
}
// Rückgang eines Korbs mit festen Gewichten über die letzten Jahre (heutige Gewichte zurückgerechnet, in Euro)
function basketDD(items, years = 5) {
  const xs = items.filter(x => (D(x.key).hist || {}).d && D(x.key).hist.d.length > 200 && x.w > 0);
  if (!xs.length) return null;
  const end = todayDay(), start = Math.max(end - years * 365, ...xs.map(x => D(x.key).hist.d[0]));
  const base = xs[0].key, days = D(base).hist.d.filter(d => d >= start);
  const tw = xs.reduce((s, x) => s + x.w, 0);
  const last = xs.map(x => toShow(x.key, D(x.key).hist.c[D(x.key).hist.c.length - 1], end));
  let peak = -Infinity, pk = days[0], best = {dd: 0, peak: days[0], trough: days[0]};
  const ser = days.map(d => { const v = xs.reduce((s, x, i) => s + x.w / tw * toShow(x.key, priceAt(x.key, d), d) / last[i], 0); return [d, v]; });
  for (const [d, v] of ser) { if (v > peak) { peak = v; pk = d; } const dd = (v / peak - 1) * 100; if (dd < best.dd) best = {dd, peak: pk, trough: d}; }
  const hi = Math.max(...ser.map(s => s[1]));
  return {dd: best.dd, peak: best.peak, trough: best.trough, fromHigh: (ser[ser.length - 1][1] / hi - 1) * 100, years: Math.round((end - start) / 365 * 10) / 10, n: xs.length, of: items.length};
}
// Positionen für den Regel-Check: Ideal-Depot oder Depot Jakob heute; ETFs und Krypto nur, wenn sie laut Antwort dazugehören
function strategyBook(mode) {
  const out = {};
  const add = (key, v) => { if (!v) return; out[key] = (out[key] || 0) + v; };
  if (mode === 'ideal') for (const it of (idealBook() || {items: []}).items) add(it.key, it.eur);
  else for (const p of jakobBook().held) {
    if (isCoin(p.key) && ansOf('crypto') !== 'part') continue;
    if ((isFund(p.key) || isCommodity(p.key)) && ansOf('etf') !== 'base' && !(scrRow(p.key) || {}).market) continue;
    add(p.key, p.value);
  }
  const tot = Object.values(out).reduce((s, v) => s + v, 0);
  return Object.entries(out).map(([key, v]) => ({key, v, w: tot ? v / tot * 100 : 0})).sort((a, b) => b.v - a.v);
}
const sectorTxt = key => { const r = scrRow(stratKey(key)); return (r && (r.market ? 'Land: ' + r.name : r.sector)) || sectorOf(key); };
function ruleCheck(mode) {
  const book = strategyBook(mode), stocks = book.filter(x => isStockOnly(x.key)), rows = [];
  const add = (state, title, text, lesson) => rows.push({state, title, text, lesson});
  if (!book.length) return {rows, book};
  const N = nSlots(), n = stocks.length;
  add(n === N ? 'ok' : 'warn', `${n} Aktien`, n < N ? `Weniger als deine ${N}: einzelne Titel wiegen schwer.` : n > N ? `Mehr als deine ${N}.` : `Passt zu deinen ${N}.`);
  const minp = +ansOf('min_pos') || 500, small = book.filter(x => x.v < minp);
  if (small.length) add('warn', `${small.length} unter ${eur(minp, 0)}`, small.map(x => shortName(x.key)).join(', ') + ': kleiner als deine Mindestgröße.');
  const top = book[0], maxpos = capPct() || 100;
  add(top.w > maxpos ? 'warn' : 'ok', `Größte Position ${nf(top.w, 0)} %`, `${shortName(top.key)}. ${capPct() ? `${top.w > maxpos ? 'Über' : 'Innerhalb'} deiner Grenze von ${maxpos} %${ansOf('maxpos') ? '' : ' (angenommen, Frage offen)'}. Zum Monatsende wird der Teil darüber verkauft und auf die übrigen Titel verteilt.` : 'Keine Grenze je Titel nach deiner Antwort.'}`, 1);
  const bySec = {}; for (const x of stocks) { const t = sectorTxt(x.key); bySec[t] = (bySec[t] || 0) + x.w; }
  const [bt, bw] = Object.entries(bySec).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  if (bt) add(bw > 50 ? 'warn' : 'ok', `Größter Sektor: ${bt} ${nf(bw, 0)} %`, bw > 50 ? 'Titel aus einem Sektor fallen meist gemeinsam. Die Regel lässt das zu, wenn ein Sektor vorn liegt; der Stopp begrenzt den Schaden.' : 'Kein einzelner Sektor dominiert.');
  if (mode === 'depot') {
    const ib = idealBook(), inIb = new Set(((ib || {}).items || []).map(x => x.key)), outK = stocks.map(x => stratKey(x.key)).filter(k => !inIb.has(k));
    if (ib) add(outK.length ? 'warn' : 'ok', outK.length ? `${outK.length} außerhalb des Ideal-Depots` : 'Alle Titel im Ideal-Depot', outK.length ? outK.map(k => shortName(k)).join(', ') + `: nach deiner Regel zum Monatsende (${meTxt()}) tauschen.` : 'Alle gehören zu den stärksten im Aufwärtstrend.');
    const near = stocks.map(x => [x.key, stopOf(stratKey(x.key))]).filter(x => x[1] && x[1].near);
    if (near.length) add(near.some(x => x[1].hit) ? 'bad' : 'warn', 'Nahe am Stopp', near.map(([k, s]) => `${shortName(k)} ${pctS(s.dd, 0)}`).join(', ') + ` vom Hoch seit Kauf, Stopp bei −${stopPct()} %.`);
  }
  const bd = basketDD(book.map(x => ({key: x.key, w: x.w}))), mdd = +ansOf('max_dd') || 35;
  if (bd) add(bd.dd < -mdd ? 'bad' : bd.dd < -mdd * 0.8 ? 'warn' : 'ok', `Größter Rückgang ${pctS(bd.dd, 0)}`, `So weit wäre diese Mischung in den letzten ${nf(bd.years, 0)} Jahren gefallen, wenn man sie fest gehalten hätte (${dateDe(dayToDate(bd.peak).toISOString())} bis ${dateDe(dayToDate(bd.trough).toISOString())}${bd.n < bd.of ? `, ${bd.of - bd.n} Titel ohne langen Verlauf` : ''}). Die Regel tauscht monatlich und hat einen Stopp. Deine Grenze: −${mdd} %.`, 1);
  if (mode === 'depot' && ['50', '100'].includes(ansOf('profit'))) {
    const c = jakobBook(), g = c.held.filter(p => isStockOnly(p.key) && p.pnlPct >= +ansOf('profit'));
    if (g.length) add('info', 'Gewinnregel', g.map(p => `${shortName(p.key)} ${pctS(p.pnlPct, 0)}`).join(', ') + `: über deiner Schwelle von +${ansOf('profit')} %. Teilverkäufe sind nicht Teil der getesteten Regel.`);
  }
  return {rows, book, bd};
}
// Leitplanken: das Brauchbare aus dem Denken von Sam Bankman-Fried (Erwartungswert) und seine Fehler als Regeln
function guardRails(rc) {
  const g = [], a = id => ansOf(id);
  const add = (state, title, text) => g.push({state, title, text});
  add(a('lever') === 'yes' ? 'bad' : a('lever') === 'some' ? 'warn' : a('lever') ? 'ok' : 'open', 'Kein Hebel, kein Kredit', a('lever') ? (a('lever') === 'no' ? 'Du nutzt keinen Hebel.' : 'Mit Hebel kann ein Rückgang alles kosten. Genau das hat FTX und Alameda ruiniert.') : 'Frage offen: Nutzt du Hebel?');
  add(a('need') === 'yes' ? 'bad' : a('need') ? 'ok' : 'open', 'Nur Geld, das du nicht brauchst', a('need') === 'yes' ? 'Fest eingeplantes Geld gehört nicht in ein Depot, das 40 % fallen darf.' : a('need') ? 'Kein fest eingeplantes Geld im Depot.' : 'Frage offen: Brauchst du das Geld bald?');
  const mp = capPct() || 100, top = (rc.book || [])[0];
  add(top && top.w > mp ? 'warn' : 'ok', 'Kein Einsatz über die Hälfte des Kelly-Maßes', `Auch bei einer guten Wette nie alles auf einen Titel: höchstens ${mp} % je Aktie${top ? `, größte heute ${nf(top.w, 0)} %` : ''}. Sam Bankman-Fried wollte sogar mehr als das volle Kelly-Maß setzen.`);
  const bd = rc.bd, mdd = +a('max_dd') || 35;
  add(!bd ? 'open' : bd.dd < -mdd ? 'bad' : 'ok', 'Totalverlust vermeiden', bd ? `Größter Rückgang dieser Mischung: ${pctS(bd.dd, 0)}, deine Grenze −${mdd} %. Ein Erwartungswert hilft nichts, wenn man vorher aufgeben muss.` : 'Noch kein Verlauf für die Rechnung.');
  add(stopPct() ? 'ok' : 'warn', 'Verluste begrenzen', stopPct() ? `Der Stopp verkauft jeden Titel, der ${stopPct()} % unter sein Hoch seit Kauf fällt. Im Backtest senkte er den größten Rückgang von −52 auf −49 %.` : 'Ohne Stopp (deine Wahl): im Backtest größter Rückgang −52 %, je nach Stichtag −57 %, statt −49 % mit Stopp. Verkauft wird erst zum Monatsende.');
  if (jakobBook().held.some(p => isCoin(p.key))) add(a('wallet') === 'exchange' ? 'warn' : a('wallet') ? 'ok' : 'open', 'Coins nicht auf der Börse lassen', a('wallet') === 'exchange' ? 'Auf einer Krypto-Börse gehören die Coins im Ernstfall der Börse, wie bei FTX.' : a('wallet') ? 'Gut: nicht auf einer Krypto-Börse.' : 'Frage offen: Wo liegen deine Coins?');
  return g;
}
// Wenn … dann: deine Regeln mit dem heutigen Stand
function playbook(rc) {
  const ib = idealBook() || {items: [], n: 7, breadth: {}}, jh = jakobHeld(), keys = Object.keys(jh), n = ib.n;
  const kn = ks => ks.map(k => shortName(k)).join(', '), sr = k => scrRow(k) || {}, inIb = new Set(ib.items.map(x => x.key));
  const near = keys.filter(k => { const s = stopOf(k); return s && s.near; });
  const broke = keys.filter(k => sr(k).member && sr(k).trend === false), outR = keys.filter(k => sr(k).trend && !inIb.has(k)), newK = ib.items.filter(x => !jh[x.key]).map(x => x.key);
  const fg = (marketFg() || {}).value, soon = todayDay() + 14, mdd = +ansOf('max_dd') || 35, bd = rc.bd;
  const earn = keys.map(k => [k, sr(k).earnings || (D(k).earnings_date || '')]).filter(([k, e]) => e && isoToDay(e) >= todayDay() && isoToDay(e) <= soon);
  const book = rc.book || [], mp = capPct() || 100, b = ib.breadth || {};
  return [
    {on: near.length > 0, when: `eine Position ${stopPct() || 25} % unter ihr Hoch seit dem Kauf fällt`, then: stopPct() ? 'Sofort verkaufen. Der Platz bleibt bis zum Monatsende frei.' : 'Ohne Stopp: halten bis zum Monatsende.', now: near.length ? near.map(k => `${shortName(k)} ${pctS(stopOf(k).dd, 0)}`).join(', ') : 'keine in der Nähe'},
    {on: broke.length > 0, when: 'eine Position aus dem Aufwärtstrend fällt (unter die 200-Tage-Linie oder 50 unter 200)', then: `Zum Monatsende (${meTxt()}) verkaufen.`, now: broke.length ? kn(broke) : 'keine'},
    {on: outR.length > 0, when: `eine Position nicht mehr unter den ${n} stärksten ist`, then: `Zum Monatsende gegen den stärksten neuen Titel tauschen.`, now: outR.length ? outR.map(k => `${shortName(k)} (Rang ${sr(k).rank || '–'})`).join(', ') : 'keine'},
    {on: newK.length > 0, when: `ein Titel neu unter die ${n} stärksten im Aufwärtstrend kommt`, then: 'Zum Monatsende kaufen.', now: newK.length ? kn(newK) : 'keine'},
    {on: ib.items.length < n, when: `weniger als ${n} Titel im Aufwärtstrend sind`, then: 'Freie Plätze bleiben Reserve, bis neue Titel in den Trend kommen. So ging die Regel 2022 teilweise aus dem Markt.', now: b.n ? `${b.trend} von ${b.n} Titeln im Aufwärtstrend` : ''},
    {on: fg != null && fg < FEAR, when: 'extreme Angst herrscht (Angst und Gier unter 25)', then: 'Die Regel ändert nichts: Gekauft wird nur, was im Aufwärtstrend vorn liegt. Die frühere Ausnahme „bei Angst kaufen“ gilt nicht mehr.', now: fg != null ? `Aktien ${fg}` : ''},
    {on: !!bd && bd.fromHigh <= -mdd * 0.7, when: `die Mischung ${nf(mdd * 0.7, 0)} % unter dem Hoch liegt (70 % deiner Grenze)`, then: 'Risiko prüfen, keine Käufe auf Kredit.', now: bd ? `heute ${pctS(bd.fromHigh, 0)}` : ''},
    {on: book.some(x => x.w > mp), when: `eine Position über ${mp} % wächst`, then: 'Zum Monatsende den Teil über der Grenze verkaufen und auf die übrigen Titel verteilen, wie im Backtest.', now: book.filter(x => x.w > mp).map(x => shortName(x.key) + ' ' + nf(x.w, 0) + ' %').join(', ') || 'keine'},
    {on: earn.length > 0, when: 'in den nächsten 14 Tagen Quartalszahlen anstehen', then: 'Mit großen Ausschlägen rechnen. Die Regel reagiert erst über Stopp, Trend oder Rang.', now: earn.length ? earn.map(([k, e]) => shortName(k) + ' ' + dateDe(e)).join(', ') : 'keine'}];
}
function strategySummary() {
  const a = id => ansOf(id), L = id => ansLabel(id), ib = idealBook() || {n: 7};
  const s = [`Depot Jakob: Wachstums-Momentum mit Bausteinen aus deiner Quality-Growth-Vorlage, ${ib.n} Aktien ab ${eur(+a('min_pos') || 500, 0)}.`,
    `Zum Monatsende gekauft werden die ${ib.n} stärksten Aktien aus S&P 500, Nasdaq-100, Europa, China und Hongkong (dazu Länder-ETFs der Schwellenländer), die im Aufwärtstrend sind, jede mit gleichem Betrag; danach laufen Gewinner weiter${capPct() ? `, höchstens ${capPct()} % je Titel` : ''}. ${stopPct() ? `Fällt ein Titel ${stopPct()} % unter sein Hoch seit dem Kauf, wird er sofort verkauft.` : 'Ohne Stopp.'} Horizont ${{lt2: 'unter 2 Jahren', '2to5': '2 bis 5 Jahre', gt5: 'über 5 Jahre'}[a('horizon') || 'lt2']}, Rückgang bis −${+a('max_dd') || 35} % tragbar.${+a('monthly') ? ` Jeden Monat ${eur(+a('monthly'), 0)} neu, ${a('rate') === 'split' ? 'gleich auf alle' : 'dorthin, wo am meisten fehlt'}.` : ''}`,
    'Relative Stärke wie bei IBD: Rendite der letzten 3 Monate zählt 40 %, der letzten 6, 9 und 12 Monate je 20 %. Aufwärtstrend wie bei Minervini: Kurs über der 200-Tage-Linie, die 50-Tage-Linie darüber.'];
  const t = [];
  if ((a('horizon') || 'lt2') === 'lt2') t.push('Momentum braucht Geduld: Im Backtest brachte die Regel 2018 −20 % und 2021 nur +1 %. Bei unter 2 Jahren Horizont kann so ein Jahr den Großteil der Zeit ausmachen.');
  if (a('on_loss') === 'buy') t.push('Du willst bei Verlusten nachkaufen. Die Regel macht das Gegenteil: Was fällt, verliert an Stärke und wird verkauft. Nachgekauft wird nur, was im Aufwärtstrend vorn bleibt.');
  if (['50', '100'].includes(a('profit'))) t.push('Du willst ab einem großen Gewinn teilweise verkaufen. Die Regel lässt Gewinner laufen, solange sie vorn liegen; Teilverkäufe sind nicht Teil des Tests.');
  if (a('share') === 'gt75' && (+a('max_dd') || 35) >= 25) t.push(`Über 75 % deines Vermögens stecken in Aktien und Krypto. Ein Rückgang von ${+a('max_dd') || 35} % träfe fast dein ganzes Vermögen.`);
  if (a('need') === 'yes') t.push('Du brauchst das Geld bald, willst aber −40 % aushalten. Das passt nicht zusammen.');
  const bm = S.bt && S.bt.rule === RULE_V ? (S.bt.strategies || []).find(x => x.id === (stopPct() ? 'best_stop' : 'best')) : null;
  t.push(`Die Regel kauft und verkauft im Backtest ${bm ? 'etwa ' + nf(bm.trades / (S.bt.years || 10), 0) + '-mal' : 'oft'} im Jahr. Gewinne fallen damit fast jedes Jahr an und werden versteuert; der Backtest rechnet ohne Steuern.`);
  if (a('positions') != null && isNaN(+a('positions'))) t.push(`Deine Antwort „${a('positions')}“ Aktien zählt als ${ib.n}: Im Backtest brachten 6 Titel am meisten. Du kannst 6, 7 oder 8 wählen.`);
  return {s, t};
}

/* ---------------------------------------------------------------- Deine Regeln am Beispiel (Jakobs Wunsch vom 25.11.2026)
   Wie das Ideal-Depot (Modell in screen.json → ideal) einen Titel gehandelt hat: Käufe zum Monatsende, Verkäufe zum
   Monatsende (nicht mehr unter den stärksten oder kein Aufwärtstrend) und Stopps. Dazu Kurs, 50- und 200-Tage-Linie und
   die Phasen im Aufwärtstrend. Nachgerechnet mit der heutigen Auswahl seit Beginn der Kurse (gut ein Jahr ohne Anlauf). */
function ruleSim(key) {
  const h = D(key).hist, m = (S.screen || {}).ideal || {}, log = m.log || [];
  if (!h || !h.d || h.d.length < 260 || !log.length) return null;
  const sym = key.split(':')[1], d = h.d, c = h.c, n = d.length;
  const ps = [0]; for (const x of c) ps.push(ps[ps.length - 1] + (x || 0));
  const sma = (i, k) => i >= k - 1 ? (ps[i + 1] - ps[i + 1 - k]) / k : null;
  let i0 = bisect(d, log[0].day - 25) + 1; i0 = Math.max(i0, 200);
  if (i0 >= n - 20) return null;
  const ev = [];
  for (const x of log) {
    if ((x.in || []).includes(sym)) ev.push({day: x.day, t: 'buy', why: `Monatsende: Rang ${(x.top || []).indexOf(sym) + 1} unter den stärksten im Aufwärtstrend.`});
    if ((x.out || []).includes(sym)) ev.push({day: x.day, t: 'sell', why: 'Monatsende: nicht mehr unter den stärksten im Aufwärtstrend.'});
  }
  for (const e of m.stops || []) if (e.sym === sym) ev.push({day: e.day, t: 'sell', why: `Stopp: ${nf((1 - e.px / e.hi) * 100, 0)} % unter dem Hoch seit Kauf.`});
  ev.sort((a, b) => a.day - b.day || (a.t === 'sell' ? -1 : 1));
  const st = [], hd = [], trades = [];
  let held = false, eq = 1, inDays = 0, j = 0;
  for (let i = i0; i < n; i++) {
    const p = c[i], s50 = sma(i, 50), s200 = sma(i, 200);
    st[i] = s50 && s200 && p > s200 && s50 > s200 ? 'on' : p < s200 ? 'down' : 'none';
    if (held && i > i0) eq *= c[i] / c[i - 1];
    while (j < ev.length && ev[j].day <= d[i]) { const e = ev[j++]; if ((e.t === 'buy') !== held) { held = e.t === 'buy'; trades.push({i, t: e.t, why: e.why}); } }
    hd[i] = held; if (held) inDays++;
  }
  const show = (i, v) => v == null ? null : toShow(key, v, d[i]);
  const idx = []; for (let i = i0; i < n; i++) idx.push(i);
  return {key, d: idx.map(i => d[i]), px: idx.map(i => show(i, c[i])), m50: idx.map(i => show(i, sma(i, 50))), m200: idx.map(i => show(i, sma(i, 200))),
    st: idx.map(i => st[i]), ex: idx.map(() => ''), held: idx.map(i => hd[i]),
    trades: trades.map(t => Object.assign(t, {k: t.i - i0, day: d[t.i], px: show(t.i, c[t.i])})),
    rule: (eq - 1) * 100, hold: (c[n - 1] / c[i0] - 1) * 100, inv: inDays / (n - i0) * 100, now: {st: st[n - 1], held, rank: (scrRow(key) || {}).rank}};
}
