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
    let tried = ''; try { tried = sessionStorage.getItem('depot_v') || ''; } catch (e) { /* egal */ }
    if (tried === v) return;
    try { sessionStorage.setItem('depot_v', v); } catch (e) { /* egal */ }
    location.replace(location.pathname + '?v=' + v + location.hash);
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
  const lots = {}, realized = {}, native = {};
  for (const t of txs) {
    const rate = fxAt(t.currency, t.day) || 1, q = lots[t.key] = lots[t.key] || [];
    if (t.type === 'buy') {
      q.push([t.qty, (t.qty * t.price + t.fee) / rate]);
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
    return {key, kind: key.split(':')[0], symbol: key.split(':')[1], name: nameOf(key), qty, cost, value, price, cur: curOf(key),
      realized: realized[key] || 0, pnl: value == null ? null : value - cost, pnlPct: value != null && cost > 0 ? (value / cost - 1) * 100 : null,
      dayPct: chg, dayEur: value != null && chg != null && chg > -100 ? value - value / (1 + chg / 100) : null,
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
function backcast() {
  const c = calc();
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

/* ---------------------------------------------------------------- Strategie (Jakobs Wunsch vom 22.11.2026)
   Profil und Antworten: portfolio.json → profile (answers, text, plan). Filter: screen.json (tracker/screen.py).
   Die Passung „Für dich“ rechnet hier mit denselben Gewichten wie tracker/screen.py (fit), damit Antworten sofort wirken:
   beide Stellen ändern. Faktoren nach Jakobs Vorgabe: Momentum, Schätzungsänderungen, Wachstum, Qualität, relative Stärke
   im KI-Umfeld; Bewertung nur als Sicherheitsnetz; dazu Erwartungswert (Chance zu Risiko). Keine Anlageberatung. */
const FIT_W = {
  upside: {momentum: .23, revisions: .21, growth: .21, quality: .14, rs: .09, value: .06, ev: .06},
  rr: {momentum: .17, revisions: .17, growth: .15, quality: .19, rs: .07, value: .17, ev: .08},
  safe: {momentum: .11, revisions: .15, growth: .09, quality: .28, rs: .04, value: .25, ev: .08}};
const FACTOR_DE = {momentum: 'Momentum', revisions: 'Schätzungen', growth: 'Wachstum', quality: 'Qualität', rs: 'Stärke im Thema', value: 'Bewertung', ev: 'Chance-Risiko'};
// Fragen ans Profil. core = aus Jakobs Grok-Profil vorbelegt; lesson = Leitplanke aus dem FTX-Fall.
const QUESTIONS = [
  {id: 'risk', core: 1, q: 'Wie viel Risiko willst du eingehen?', o: [['low', 'Niedrig'], ['mid', 'Mittel'], ['high', 'Hoch']]},
  {id: 'horizon', core: 1, q: 'Wie lange willst du anlegen?', o: [['lt2', 'Unter 2 Jahre'], ['2to5', '2 bis 5 Jahre'], ['gt5', 'Über 5 Jahre']]},
  {id: 'max_dd', core: 1, q: 'Welchen Rückgang des Depots hältst du aus, ohne zu verkaufen?', o: [[15, '−15 %'], [25, '−25 %'], [35, '−35 %'], [50, '−50 %']]},
  {id: 'on_loss', core: 1, q: 'Was tust du bei starken Verlusten?', o: [['buy', 'Nachkaufen, wenn die These hält'], ['hold', 'Halten'], ['sell', 'Verkaufen']]},
  {id: 'style', q: 'Nach welcher Regel kaufst du neu?', why: 'Momentum: kaufen, wenn der Trend steht, statt in fallende Kurse.', o: [['first', 'Momentum zuerst'], ['only', 'Nur Momentum'], ['dip', 'Rücksetzer kaufen']]},
  {id: 'fear', q: 'Was tust du bei extremer Angst am Markt (Angst und Gier unter 25)?', why: 'Ausnahme von der Momentum-Regel: kaufen, wenn andere verkaufen.', o: [['buy', 'Kaufen'], ['wait', 'Abwarten'], ['ignore', 'Spielt keine Rolle']]},
  {id: 'priority', core: 1, q: 'Was ist dir wichtiger?', o: [['upside', 'Möglichst viel Upside'], ['rr', 'Gutes Chance-Risiko'], ['safe', 'Sicherheit']]},
  {id: 'positions', core: 1, q: 'Wie viele Einzelaktien willst du halten?', o: [['3-5', '3 bis 5'], ['6-8', '6 bis 8'], ['9-12', '9 bis 12'], ['13-40', 'mehr']]},
  {id: 'min_pos', core: 1, q: 'Wie groß soll eine Position mindestens sein?', o: [[250, '250 €'], [500, '500 €'], [1000, '1.000 €']]},
  {id: 'themes', core: 1, q: 'Welchen Schwerpunkt hat dein Depot?', o: [['ai', 'KI und Halbleiter'], ['tech', 'Tech allgemein'], ['none', 'Keinen']]},
  {id: 'defensive', core: 1, q: 'Defensive Titel wie Microsoft?', o: [['reduce', 'Reduzieren oder weglassen'], ['keep', 'Als Ausgleich behalten']]},
  {id: 'spec', core: 1, q: 'Junge KI-Firmen, die noch keinen Gewinn machen (z. B. CoreWeave, Nebius)?', o: [['nein', 'Nein'], ['wenig', 'Kleiner Anteil'], ['ja', 'Ja']]},
  {id: 'need', q: 'Brauchst du dieses Geld in den nächsten 2 Jahren für etwas Bestimmtes?', why: 'Fest eingeplantes Geld verträgt keinen Rückgang von 35 %.', o: [['yes', 'Ja, fest eingeplant'], ['maybe', 'Vielleicht'], ['no', 'Nein']]},
  {id: 'cash', q: 'Hast du Geld zurückgelegt, um bei Schwäche nachzukaufen?', why: 'Nachkaufen bei Schwäche geht nur mit Reserve.', o: [['yes', 'Ja'], ['some', 'Etwas'], ['no', 'Nein']]},
  {id: 'crash', q: 'Halbleiter fallen wie 2022 um rund 45 %, die Gewinnschätzungen halten. Was tust du?', why: 'Prüft, ob dein Plan bei Verlusten auch im Ernstfall gilt.', o: [['buy', 'Nachkaufen'], ['hold', 'Halten'], ['sell', 'Verkaufen']]},
  {id: 'maxpos', q: 'Wie groß darf eine einzelne Aktie höchstens werden?', why: 'Grenze für Klumpen.', o: [[15, '15 %'], [20, '20 %'], [25, '25 %'], [30, '30 %']]},
  {id: 'share', q: 'Welcher Teil deines Vermögens steckt in Aktien und Krypto?', why: 'Je größer der Anteil, desto mehr zählt ein Rückgang.', o: [['lt25', 'Unter 25 %'], ['25-50', '25 bis 50 %'], ['50-75', '50 bis 75 %'], ['gt75', 'Über 75 %']]},
  {id: 'lever', lesson: 1, q: 'Nutzt du Hebel, Optionen oder Kredit?', why: 'Lehre aus FTX: Hebel macht aus einem Rückgang einen Totalverlust.', o: [['no', 'Nein'], ['some', 'Manchmal'], ['yes', 'Ja']]},
  {id: 'wallet', lesson: 1, q: 'Wo liegen deine Coins?', why: 'Lehre aus FTX: Auf einer Krypto-Börse sind Coins im Ernstfall weg.', o: [['self', 'Eigene Wallet'], ['broker', 'Beim Broker'], ['exchange', 'Auf einer Krypto-Börse']]},
  {id: 'region', q: 'Nur US-Aktien oder auch Asien und Europa (SK Hynix, Samsung, ASML)?', o: [['all', 'Auch Asien und Europa'], ['usa', 'Nur USA']]},
  {id: 'profit', q: 'Was tust du bei großen Gewinnen?', o: [['run', 'Laufen lassen'], ['50', 'Ab +50 % einen Teil verkaufen'], ['100', 'Ab +100 % einen Teil verkaufen']]},
  {id: 'sell', q: 'Wann verkaufst du eine Aktie?', o: [['thesis', 'Wenn die These bricht'], ['trend', 'Wenn der Trend bricht'], ['stop', 'Bei festem Verlust (−20 %)'], ['better', 'Wenn es Besseres gibt']]},
  {id: 'etf', q: 'Gehören deine ETFs zur Strategie?', why: 'Sonst zählen nur die Einzelaktien.', o: [['apart', 'Nein, getrennt'], ['base', 'Ja, als Basis']]},
  {id: 'crypto', q: 'Und Krypto?', o: [['apart', 'Getrennt'], ['part', 'Gehört dazu']]},
  {id: 'rebalance', q: 'Wie oft willst du umschichten?', o: [['need', 'Bei Bedarf'], ['month', 'Monatlich'], ['quarter', 'Vierteljährlich']]},
  {id: 'monthly', q: 'Wie viel legst du jeden Monat neu an?', o: [[0, 'Nichts'], [250, '250 €'], [500, '500 €'], [1000, '1.000 €'], [2000, '2.000 €']]},
  {id: 'rate', q: 'Wohin soll die Monatsrate gehen?', o: [['mom', 'Momentum zuerst'], ['gap', 'Was am meisten fehlt'], ['split', 'Nach Plan-Gewicht']]},
  {id: 'push', q: 'Wann sollen Hinweise aufs Handy kommen?', o: [['important', 'Nur Wichtiges'], ['all', 'Alles'], ['none', 'Gar nicht']]}];
const prof = () => S.pf.profile || {};
const ansOf = id => (prof().answers || {})[id];
const ansLabel = id => { const q = QUESTIONS.find(x => x.id === id), v = ansOf(id); const o = q && q.o.find(x => String(x[0]) === String(v)); return o ? o[1] : null; };
const scrRow = key => (S.scr || {})[key];
// Kaufstil: Zu- und Abschlag je Zustand des Momentum-Signals (gleich in tracker/screen.py STYLE_MULT)
const STYLE_MULT = {first: {on: 1.06, down: 0.9}, only: {on: 1.08, fade: 0.9, none: 0.85, down: 0.75}};
// Momentum-Signal (tracker/analytics.momentum, Jakobs Wunsch vom 22.11.2026): on, fade, down, none
const momOf = key => D(key).mom || (scrRow(key) || {}).mom || null;
const momStyle = () => ['first', 'only'].includes(ansOf('style'));
// Ausnahmen von „Momentum zuerst“: extreme Angst am Aktienmarkt (Frage fear) oder Halbleiter-Crash (Frage crash)
const FEAR = 25;
function buyException() {
  const fg = (S.daily.market_fg || {}).value, sm = ((S.screen || {}).semis || {}).from_high;
  const fear = ansOf('fear') === 'buy' && fg != null && fg < FEAR, crash = (ansOf('crash') || ansOf('on_loss')) === 'buy' && sm != null && sm <= -20;
  const text = [fear ? `extreme Angst am Aktienmarkt (${fg} von 100)` : '', crash ? `Halbleiter ${pctS(sm, 0)} unter dem Hoch` : ''].filter(Boolean).join(' und ');
  return {on: fear || crash, fear, crash, text};
}
function fitOf(r) {
  if (!r) return null;
  const w = FIT_W[ansOf('priority')] || FIT_W.upside, c = r.c, fl = r.flags || {};
  if (ansOf('region') === 'usa' && !fl.us) return null;
  if (fl.spec && ansOf('spec') === 'nein') return null;
  let x = Object.keys(w).reduce((s, k) => s + (c[k] ?? 0.5) * w[k], 0) * 100;
  const th = ansOf('themes') || 'ai', t = th === 'ai' ? c.theme : th === 'tech' ? Math.max(c.theme, 0.7) : 1;
  x *= 0.55 + 0.45 * t;
  if (c.quality < 0.3) x *= 0.85;
  if (fl.pricey) x *= 0.85;
  if (fl.spec && ansOf('spec') !== 'ja') x *= 0.85;
  if (fl.def && (ansOf('defensive') || 'reduce') === 'reduce') x *= 0.8;
  if (fl.cut) x = Math.min(x, 45);
  if ((ansOf('horizon') || 'lt2') === 'lt2' && (r.vol || 0) > 70) x *= 0.9;
  x *= (STYLE_MULT[ansOf('style')] || {})[(r.mom || {}).state] || 1;
  return Math.round(Math.min(100, x));
}
const fitPts = f => f == null ? null : Math.max(1, Math.min(10, Math.round(f / 10)));
const fitKey = key => fitPts(fitOf(scrRow(key)));
const planDay = () => { const d = (prof().plan || {}).date; return d ? isoToDay(d) : null; };
function calcFor(dep) { const sd = S.dep, sc = S.calc; S.dep = dep; S.calc = null; const r = calc(); S.dep = sd; S.calc = sc; return r; }
// Geplante Käufe: Wert heute, wenn am Plantag gekauft
function planRows() {
  const pl = prof().plan; if (!pl || !(pl.items || []).length) return [];
  const pd = planDay();
  return pl.items.map(it => {
    const key = keyOf(it.kind || 'stock', it.symbol), now = A(key).price ?? priceAt(key, todayDay()), then = pd != null ? priceAt(key, pd) : null;
    const chg = now != null && then ? (toShow(key, now, todayDay()) / toShow(key, then, pd) - 1) * 100 : null;   // beide mit Tageskursen der Währung, sonst entsteht ein Scheinunterschied
    return {key, it, eur: +it.eur || 0, pct: +it.pct || 0, chg, value: (+it.eur || 0) * (1 + (chg || 0) / 100)};
  });
}
// Monatsrate (Fragen monthly, rate, min_pos): wohin das neue Geld nach deiner Regel geht. Ziel ist das Plan-Gewicht,
// gemessen am Hauptdepot. „Momentum zuerst“: Plan-Titel mit Signal; ohne Signal greift die Ausnahme (extreme Angst,
// Halbleiter-Crash) mit den im Thema stärksten Titeln, sonst Titel über der 200-Tage-Linie, sonst Reserve.
function monthlyRate() {
  const m = +ansOf('monthly') || 0, rows = planRows();
  if (!m || !rows.length) return null;
  const rule = ansOf('rate') || 'mom', held = {}, ex = buyException();
  for (const p of calcFor('main').held) held[p.key] = p.value;
  const tot = rows.reduce((s, r) => s + (held[r.key] || 0), 0) + m;
  const xs = rows.map(r => { const sr = scrRow(r.key) || {}, have = held[r.key] || 0;
    return {key: r.key, pct: r.pct, have, gap: Math.max(0, tot * r.pct / 100 - have), mom: momOf(r.key) || {}, rs: sr.c ? sr.c.rs : null,
      cut: !!(sr.flags && sr.flags.cut) || (sr.est90 != null && sr.est90 <= -5)}; });
  const k = Math.max(1, Math.floor(m / (+ansOf('min_pos') || 500))), ok = xs.filter(x => !x.cut && x.gap > 0), byGap = (a, b) => b.gap - a.gap;
  let pick = [], why = '', by = 'gap', viaEx = false;
  if (rule === 'split') { pick = xs.filter(x => !x.cut); by = 'pct'; why = 'Nach Plan-Gewicht auf alle Plan-Titel, deren Gewinnschätzungen halten.'; }
  else if (rule === 'gap') { pick = ok.sort(byGap).slice(0, k); why = 'Die Plan-Titel, die am weitesten unter ihrem Plan-Gewicht liegen.'; }
  else {
    const on = ok.filter(x => x.mom.state === 'on').sort(byGap);
    if (on.length) { pick = on.slice(0, k); why = 'Plan-Titel mit Momentum-Signal, die noch unter ihrem Plan-Gewicht liegen.'; }
    else if (ex.on) { pick = ok.sort((a, b) => (b.rs ?? 0) - (a.rs ?? 0) || byGap(a, b)).slice(0, k); why = 'Kein Plan-Titel hat ein Momentum-Signal, aber deine Ausnahme greift. Darum die im KI-Umfeld relativ stärksten Plan-Titel, deren Gewinnschätzungen halten.'; viaEx = true; }
    else { pick = ok.filter(x => x.mom.state && x.mom.state !== 'down').sort(byGap).slice(0, k);
      why = pick.length ? 'Kein Plan-Titel hat ein Momentum-Signal. Darum Titel über der 200-Tage-Linie, die am weitesten unter ihrem Plan-Gewicht liegen.' : 'Kein Plan-Titel hat ein Momentum-Signal, keiner liegt über der 200-Tage-Linie, und keine Ausnahme greift. Nach deiner Regel: Rate als Reserve parken, bis ein Signal kommt.'; }
  }
  const wsum = pick.reduce((s, x) => s + (by === 'pct' ? x.pct : x.gap), 0);
  let left = m;
  pick = pick.map((x, i) => { const v = i === pick.length - 1 ? left : Math.round(m * (by === 'pct' ? x.pct : x.gap) / (wsum || 1) / 10) * 10; left -= v; return Object.assign({}, x, {eur: v}); });
  return {m, k, rule, rows: xs, pick, why, ex, viaEx};
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
// Positionen für den Regel-Check: Plan, Hauptdepot heute oder beides; ETFs und Krypto nur, wenn sie laut Antwort dazugehören
function strategyBook(mode) {
  const out = {};
  const add = (key, v) => { if (!v) return; out[key] = (out[key] || 0) + v; };
  if (mode !== 'plan') for (const p of calcFor('main').held) {
    if (isCoin(p.key) && ansOf('crypto') !== 'part') continue;
    if ((isFund(p.key) || isCommodity(p.key)) && ansOf('etf') !== 'base') continue;
    add(p.key, p.value);
  }
  if (mode !== 'depot') for (const r of planRows()) add(r.key, mode === 'plan' ? r.value : r.eur);
  const tot = Object.values(out).reduce((s, v) => s + v, 0);
  return Object.entries(out).map(([key, v]) => ({key, v, w: tot ? v / tot * 100 : 0})).sort((a, b) => b.v - a.v);
}
const isStockOnly = key => !isCoin(key) && !isFund(key) && !isCommodity(key);
function themeOf(key) { const r = scrRow(key); if (r) return [r.theme, r.c.theme]; const f = D(key).fund || {}; return [isCoin(key) ? 'Krypto' : isFund(key) ? 'ETF' : f.industry || f.sector || '–', /Semicond/.test(f.industry || '') ? 1 : 0.2]; }
function ruleCheck(mode) {
  const book = strategyBook(mode), stocks = book.filter(x => isStockOnly(x.key)), rows = [];
  const add = (state, title, text, lesson) => rows.push({state, title, text, lesson});
  if (!book.length) return {rows, book};
  const [lo, hi] = String(ansOf('positions') || '6-8').split('-').map(Number), n = stocks.length;
  add(n >= lo && n <= hi ? 'ok' : 'warn', `${n} Einzelaktien`, n < lo ? `Weniger als deine ${lo} bis ${hi}: einzelne Titel wiegen schwer.` : n > hi ? `Mehr als deine ${lo} bis ${hi}: ${n - hi} zu viel, die schwächsten nach Passung zuerst prüfen.` : `Passt zu deinen ${lo} bis ${hi}.`);
  const minp = +ansOf('min_pos') || 500, small = book.filter(x => x.v < minp);
  if (small.length) add('warn', `${small.length} unter ${eur(minp, 0)}`, small.map(x => shortName(x.key)).join(', ') + ': kleiner als deine Mindestgröße.');
  const top = book[0], maxpos = +ansOf('maxpos') || 25;
  add(top.w > maxpos ? 'warn' : 'ok', `Größte Position ${nf(top.w, 0)} %`, `${shortName(top.key)}. ${top.w > maxpos ? 'Über' : 'Innerhalb'} deiner Grenze von ${maxpos} %${ansOf('maxpos') ? '' : ' (angenommen, Frage offen)'}.`, 1);
  const aiShare = stocks.filter(x => themeOf(x.key)[1] >= 0.8).reduce((s, x) => s + x.w, 0), stockShare = stocks.reduce((s, x) => s + x.w, 0);
  if ((ansOf('themes') || 'ai') === 'ai' && stockShare) add(aiShare / stockShare >= 0.7 ? 'ok' : 'warn', `KI und Halbleiter ${nf(aiShare / stockShare * 100, 0)} %`, `Anteil an deinen Einzelaktien. ${aiShare / stockShare >= 0.7 ? 'Passt zu deinem Schwerpunkt.' : 'Weniger Schwerpunkt, als dein Profil sagt.'}`);
  const byTheme = {}; for (const x of stocks) { const t = themeOf(x.key)[0]; byTheme[t] = (byTheme[t] || 0) + x.w; }
  const [bt, bw] = Object.entries(byTheme).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  if (bt) add(bw > 40 ? 'warn' : 'ok', `Größtes Thema: ${bt} ${nf(bw, 0)} %`, bw > 40 ? 'Titel aus einem Thema fallen meist gemeinsam.' : 'Kein einzelnes Thema dominiert.');
  const def = stocks.filter(x => (scrRow(x.key) || {flags: {}}).flags.def);
  if (def.length && (ansOf('defensive') || 'reduce') === 'reduce') add('warn', 'Defensive Titel', def.map(x => shortName(x.key)).join(', ') + ': wenig Wachstum. Laut deinem Profil eher reduzieren.');
  const cut = stocks.filter(x => (scrRow(x.key) || {}).est90 != null && scrRow(x.key).est90 <= -10);
  if (cut.length) add('bad', 'These prüfen', cut.map(x => `${shortName(x.key)} (Schätzung ${pctS(scrRow(x.key).est90, 0)})`).join(', ') + ': Gewinnschätzungen deutlich gesenkt.');
  const bd = basketDD(book.map(x => ({key: x.key, w: x.w}))), mdd = +ansOf('max_dd') || 35;
  if (bd) add(bd.dd < -mdd ? 'bad' : bd.dd < -mdd * 0.8 ? 'warn' : 'ok', `Größter Rückgang ${pctS(bd.dd, 0)}`, `So weit wäre diese Mischung in den letzten ${nf(bd.years, 0)} Jahren gefallen (${dateDe(dayToDate(bd.peak).toISOString())} bis ${dateDe(dayToDate(bd.trough).toISOString())}${bd.n < bd.of ? `, ${bd.of - bd.n} Titel ohne langen Verlauf` : ''}). Deine Grenze: −${mdd} %.`, 1);
  const fits = stocks.map(x => [x, fitOf(scrRow(x.key))]).filter(x => x[1] != null).sort((a, b) => a[1] - b[1]);
  const best = (S.screen && S.screen.list || []).map(r => [r, fitOf(r)]).filter(x => x[1] != null && !book.some(b => b.key === x[0].key)).sort((a, b) => b[1] - a[1])[0];
  if (fits.length && best && best[1] - fits[0][1] >= 15) add('info', 'Tausch prüfen', `${shortName(fits[0][0].key)} passt am schwächsten (${fitPts(fits[0][1])} von 10), ${shortName(best[0].key)} deutlich besser (${fitPts(best[1])} von 10).`);
  if (mode === 'depot' && ['50', '100'].includes(ansOf('profit'))) {
    const c = calcFor('main'), g = c.held.filter(p => isStockOnly(p.key) && p.pnlPct >= +ansOf('profit'));
    if (g.length) add('info', 'Gewinnregel', g.map(p => `${shortName(p.key)} ${pctS(p.pnlPct, 0)}`).join(', ') + `: über deiner Schwelle von +${ansOf('profit')} %.`);
  }
  return {rows, book, bd};
}
// Leitplanken: das Brauchbare aus dem Denken von Sam Bankman-Fried (Erwartungswert) und seine Fehler als Regeln
function guardRails(rc) {
  const g = [], a = id => ansOf(id);
  const add = (state, title, text) => g.push({state, title, text});
  add(a('lever') === 'yes' ? 'bad' : a('lever') === 'some' ? 'warn' : a('lever') ? 'ok' : 'open', 'Kein Hebel, kein Kredit', a('lever') ? (a('lever') === 'no' ? 'Du nutzt keinen Hebel.' : 'Mit Hebel kann ein Rückgang alles kosten. Genau das hat FTX und Alameda ruiniert.') : 'Frage offen: Nutzt du Hebel?');
  add(a('need') === 'yes' ? 'bad' : a('need') ? 'ok' : 'open', 'Nur Geld, das du nicht brauchst', a('need') === 'yes' ? 'Fest eingeplantes Geld gehört nicht in ein Depot, das 35 % fallen darf.' : a('need') ? 'Kein fest eingeplantes Geld im Depot.' : 'Frage offen: Brauchst du das Geld bald?');
  const mp = +a('maxpos') || 25, top = (rc.book || [])[0];
  add(top && top.w > mp ? 'warn' : 'ok', 'Kein Einsatz über die Hälfte des Kelly-Maßes', `Auch bei einer guten Wette nie alles auf einen Titel: höchstens ${mp} % je Aktie${top ? `, größte heute ${nf(top.w, 0)} %` : ''}. Sam Bankman-Fried wollte sogar mehr als das volle Kelly-Maß setzen.`);
  const bd = rc.bd, mdd = +a('max_dd') || 35;
  add(!bd ? 'open' : bd.dd < -mdd ? 'bad' : 'ok', 'Totalverlust vermeiden', bd ? `Größter Rückgang dieser Mischung: ${pctS(bd.dd, 0)}, deine Grenze −${mdd} %. Ein Erwartungswert hilft nichts, wenn man vorher aufgeben muss.` : 'Noch kein Verlauf für die Rechnung.');
  if (calcFor('main').held.some(p => isCoin(p.key))) add(a('wallet') === 'exchange' ? 'warn' : a('wallet') ? 'ok' : 'open', 'Coins nicht auf der Börse lassen', a('wallet') === 'exchange' ? 'Auf einer Krypto-Börse gehören die Coins im Ernstfall der Börse, wie bei FTX.' : a('wallet') ? 'Gut: nicht auf einer Krypto-Börse.' : 'Frage offen: Wo liegen deine Coins?');
  add(a('on_loss') === 'buy' && a('cash') === 'no' ? 'warn' : a('cash') ? 'ok' : 'open', 'Reserve für Nachkäufe', a('cash') === 'no' && a('on_loss') === 'buy' ? 'Du willst bei Schwäche nachkaufen, hast aber keine Reserve.' : a('cash') ? 'Reserve vorhanden.' : 'Frage offen: Hast du Geld zum Nachkaufen?');
  return g;
}
// Wenn … dann: Regeln aus deinem Profil mit dem heutigen Stand
function playbook(rc) {
  const sm = (S.screen || {}).semis || {}, list = (S.screen || {}).list || [], book = rc.book || [], inBook = new Set(book.map(x => x.key));
  const mine = list.filter(r => inBook.has(r.key)), soon = todayDay() + 14, mdd = +ansOf('max_dd') || 35;
  const names = xs => xs.map(r => shortName(r.key)).join(', ');
  const dipOk = mine.filter(r => (r.from_high || 0) <= -20 && (r.est90 == null || r.est90 >= 0) && (r.c.rs >= 0.4));
  const broken = mine.filter(r => r.est90 != null && r.est90 <= -10);
  const fg = (S.daily.market_fg || {}).value, kfg = (S.daily.crypto_fg || {}).value, ms = momStyle();
  const watch = (S.pf.watchlist || []).map(w => keyOf(w.kind, w.symbol)), planK = planRows().map(r => r.key);
  const own = new Set([...book.map(x => x.key), ...planK, ...calcFor('main').held.map(p => p.key)]), isOn = k => (momOf(k) || {}).state === 'on';
  const sigOn = [...own].filter(isOn), sigW = [...new Set(watch)].filter(k => !own.has(k) && isOn(k));
  const broke = book.map(x => x.key).filter(k => (momOf(k) || {}).state === 'down');
  const fearThen = {buy: 'Kaufzeitpunkt nach deiner Regel, auch ohne Momentum-Signal: in Teilen, Reserve einsetzen, nur Titel mit intakten Gewinnschätzungen, die im Thema stärksten zuerst. Extreme Angst kann Wochen dauern.', wait: 'Nach deiner Regel abwarten, bis die Angst nachlässt.', ignore: 'Spielt für dich keine Rolle.'}[ansOf('fear')] || 'Frage offen: Was tust du bei extremer Angst?';
  const kn = ks => ks.map(k => shortName(k)).join(', ');
  const earn = mine.filter(r => r.earnings && isoToDay(r.earnings) >= todayDay() && isoToDay(r.earnings) <= soon);
  const bd = rc.bd;
  return [
    {on: sm.from_high != null && sm.from_high <= -20, when: 'Halbleiter 20 % oder mehr unter ihr Hoch fallen und die Schätzungen halten', then: (ansOf('crash') || ansOf('on_loss')) === 'buy' ? 'Nach deiner Regel nachkaufen, in Teilen: zuerst Titel, deren Schätzungen steigen und die im Thema relativ stark bleiben.' : 'Nach deiner Regel halten.', now: sm.from_high != null ? `Halbleiter-ETF ${pctS(sm.from_high, 0)} unter dem Hoch${dipOk.length ? ' · in Frage: ' + names(dipOk) : ''}` : ''},
    {on: broken.length > 0, when: 'die Gewinnschätzung einer Position sinkt in 90 Tagen um 10 % oder mehr', then: 'These gebrochen: Position prüfen, Ersatz aus den Kandidaten.', now: broken.length ? names(broken) : 'keine'},
    {on: fg != null && fg < FEAR || ansOf('crypto') === 'part' && kfg != null && kfg < FEAR, when: 'extreme Angst am Markt herrscht: Angst und Gier unter 25', then: fearThen, now: [fg != null ? `Aktien ${fg}` : '', ansOf('crypto') === 'part' && kfg != null ? `Krypto ${kfg}` : ''].filter(Boolean).join(' · ')},
    {on: sigOn.length + sigW.length > 0, when: 'ein Titel aus Plan, Depot oder Watchlist das Momentum-Signal hat', then: ms ? 'Kauf passt zu deiner Regel „Momentum zuerst“: zuerst Plan-Titel unter ihrem Plan-Gewicht, ab Mindestgröße.' : 'Der Trend steht. Nach deiner Regel kein eigener Kaufgrund.', now: [sigOn.length ? kn(sigOn) : 'Plan und Depot: keiner', sigW.length ? 'Watchlist: ' + kn(sigW.slice(0, 5)) + (sigW.length > 5 ? ` und ${sigW.length - 5} weitere` : '') : ''].filter(Boolean).join(' · ')},
    {on: broke.length > 0, when: 'eine Position unter die 200-Tage-Linie fällt: Trend gebrochen', then: (ms ? 'Nach deiner Momentum-Regel nicht nachkaufen, bis das Signal wieder an ist (Ausnahmen: extreme Angst, Halbleiter-Crash).' : 'Nach deinen Faktoren nicht nachkaufen, bis Momentum oder Schätzungen wieder drehen.') + ({better: ' Verkaufen nur, wenn es Besseres gibt: Tausch im Regel-Check prüfen.', trend: ' Nach deiner Verkaufsregel: verkaufen.', thesis: ' Verkaufen erst, wenn auch die Schätzungen kippen.'}[ansOf('sell')] || ''), now: broke.length ? kn(broke) : 'keine'},
    {on: !!bd && bd.fromHigh <= -mdd * 0.7, when: `die Mischung liegt ${nf(mdd * 0.7, 0)} % unter dem Hoch (70 % deiner Grenze)`, then: 'Risiko prüfen, keine Käufe auf Kredit, Reserve einplanen.', now: bd ? `heute ${pctS(bd.fromHigh, 0)}` : ''},
    {on: book.some(x => x.w > (+ansOf('maxpos') || 25)), when: `eine Position wächst über ${+ansOf('maxpos') || 25} %`, then: 'Nicht weiter aufstocken, bei Bedarf einen Teil verkaufen.', now: book.filter(x => x.w > (+ansOf('maxpos') || 25)).map(x => shortName(x.key) + ' ' + nf(x.w, 0) + ' %').join(', ') || 'keine'},
    {on: earn.length > 0, when: 'in den nächsten 14 Tagen Quartalszahlen anstehen', then: 'Mit großen Ausschlägen rechnen. Nachkauf erst, wenn die Zahlen die These bestätigen.', now: earn.length ? earn.map(r => shortName(r.key) + ' ' + dateDe(r.earnings)).join(', ') : 'keine'}];
}
function strategySummary() {
  const a = id => ansOf(id), L = id => ansLabel(id);
  const s = [`${{high: 'Wachstum mit hohem Risiko', mid: 'Wachstum mit mittlerem Risiko', low: 'Vorsichtiges Wachstum'}[a('risk')] || 'Wachstum'}${a('themes') === 'ai' || !a('themes') ? ', Schwerpunkt KI und Halbleiter' : a('themes') === 'tech' ? ', Schwerpunkt Tech' : ''}, ${L('positions') || '6 bis 8'} Einzelaktien ab ${eur(+a('min_pos') || 500, 0)}.`,
    `Horizont ${{lt2: 'unter 2 Jahren', '2to5': '2 bis 5 Jahre', gt5: 'über 5 Jahre'}[a('horizon') || 'lt2']}, Rückgang bis −${+a('max_dd') || 35} % tragbar.${a('style') === 'first' ? ' Neu gekauft wird nach Momentum, wenn der Trend steht; Rücksetzer nur, solange der Kurs über der 200-Tage-Linie bleibt.' : a('style') === 'only' ? ' Gekauft wird nur mit Momentum-Signal.' : a('on_loss') === 'buy' ? ' Bei Schwäche nachkaufen, solange die Gewinnschätzungen halten.' : ''}${a('fear') === 'buy' || a('crash') === 'buy' ? ` Ausnahme: ${[a('fear') === 'buy' ? 'bei extremer Angst am Markt' : '', a('crash') === 'buy' ? 'bei einem Halbleiter-Crash' : ''].filter(Boolean).join(' und ')} wird gekauft, in Teilen und solange die Gewinnschätzungen halten.` : ''}${+a('monthly') ? ` Jeden Monat ${eur(+a('monthly'), 0)} neu, ${{mom: 'Momentum zuerst', gap: 'dorthin, wo am meisten fehlt', split: 'nach Plan-Gewicht'}[a('rate') || 'mom']}.` : ''}`,
    'Auswahl nach Momentum, Schätzungsänderungen, Wachstum und Qualität, dazu relative Stärke im KI-Umfeld. Bewertung nur als Sicherheitsnetz, Erwartungswert als Chance-Risiko-Prüfung.'];
  const t = [], sm = (S.screen || {}).semis;
  if ((a('horizon') || 'lt2') === 'lt2' && sm && sm.dd) t.push(`Halbleiter fielen zuletzt um ${nf(-sm.dd, 0)} % und brauchten ${sm.months_back ? nf(sm.months_back, 0) + ' Monate' : 'lange'} zurück zum Hoch. Bei unter 2 Jahren Horizont kann so eine Phase fast die ganze Zeit dauern.`);
  if (['first', 'only'].includes(a('style'))) {
    t.push('Du hast bisher eher in fallende Kurse gekauft und willst zu Momentum wechseln. Das Signal geht oft erst an, wenn ein Kurs schon deutlich gestiegen ist. Das fühlt sich anfangs teuer an, dafür kaufst du seltener in einen Abwärtstrend.');
    if (a('fear') === 'buy' || a('crash') === 'buy') t.push('Momentum und Kaufen bei extremer Angst widersprechen sich: Angst herrscht meist dann, wenn kaum ein Titel ein Signal hat. Deine Regel löst das so: Sonst gilt Momentum. Bei extremer Angst oder einem Crash wird in Teilen gekauft, und nur Titel, deren Gewinnschätzungen halten.');
  } else if (a('on_loss') === 'buy') t.push('Momentum und Nachkaufen bei Schwäche ziehen in verschiedene Richtungen. Darum gilt ein Nachkauf nur, wenn die Schätzungen halten und der Titel im Thema relativ stark bleibt.');
  if (a('share') === 'gt75' && (+a('max_dd') || 35) >= 25) t.push(`Über 75 % deines Vermögens stecken in Aktien und Krypto. Ein Rückgang von ${+a('max_dd') || 35} % träfe fast dein ganzes Vermögen.`);
  if (a('need') === 'yes') t.push('Du brauchst das Geld bald, willst aber −35 % aushalten. Das passt nicht zusammen.');
  if (a('crash') && a('on_loss') && a('crash') !== a('on_loss')) t.push(`Du sagst „${L('on_loss')}“, beim Test mit −45 % aber „${L('crash')}“. Im Ernstfall zählt das Zweite.`);
  if (a('on_loss') === 'buy' && a('cash') === 'no') t.push('Nachkaufen bei Schwäche geht nur mit Reserve.');
  return {s, t};
}
