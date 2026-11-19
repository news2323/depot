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
const eur = (v, d = 2) => v == null || isNaN(v) ? '–' : nf(v, d) + ' €';
const eurS = v => v == null || isNaN(v) ? '–' : (v >= 0 ? '+' : '−') + nf(Math.abs(v)) + ' €';
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
// Darstellung: 'light', 'dark' oder leer (folgt dem System). Nur eine Bequemlichkeit pro Gerät.
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { if (t) localStorage.setItem('depot_theme', t); else localStorage.removeItem('depot_theme'); } catch (e) { /* egal */ }
}
try { applyTheme(localStorage.getItem('depot_theme') || ''); } catch (e) { /* egal */ }
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
    const [pf, market, daily, analysis, digest, state] = await Promise.all(
      ['portfolio.json', 'market.json', 'daily.json', 'analysis.json', 'digest.json', 'state.json'].map(n => store.get(n)));
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
const nameOf = key => A(key).name || D(key).name || key.split(':')[1];
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
  for (let i = 0; i <= n; i++) {
    const x = x0 + span * i / n, dt = dayToDate(Math.round(x));
    const lab = span > 500 ? `${MON_K[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}` : `${dt.getUTCDate()}. ${MON_K[dt.getUTCMonth()]}`;
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
      if (cx == null) { cx = sx(p[0]); const dt = dayToDate(p[0]); html = `<b>${dt.getUTCDate()}. ${MON[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</b>`; }
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
  // Helle Logos auf durchsichtigem Grund (weiße Schrift) brauchen einen dunklen Kreis, alle anderen einen weißen
  await Promise.all(Object.entries(S.logos).map(async ([key, v]) => {
    if (!v || !v.img) return;
    try {
      const im = new Image(); im.src = v.img; await im.decode();
      const cv = document.createElement('canvas'); cv.width = cv.height = 24;
      const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, 24, 24);
      const px = cx.getImageData(0, 0, 24, 24).data; let clear = 0, n = 0, lum = 0;
      for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 100) { clear++; continue; } n++; lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; }
      if (clear > 576 * 0.15 && n && lum / n > 215) S.logoDark[key] = true;
    } catch (e) { /* Bild nicht lesbar: weißer Kreis */ }
  }));
  document.querySelectorAll('.lg[data-key]').forEach(el => { const h = logoImg(el.dataset.key); if (h) el.innerHTML = h; });
}
const logoImg = key => { const x = ((S.logos || {})[key] || {}).img; return x && /^data:image\//.test(x) ? `<img src="${x}" alt="" loading="lazy"${(S.logoDark || {})[key] ? ' class="dk"' : ''}>` : ''; };
const logo = key => `<span class="lg" data-key="${esc(key)}">${logoImg(key) || `<b>${esc(String(key.split(':')[1] || '?').replace(/[^A-Z0-9]/gi, '').slice(0, 1))}</b>`}</span>`;
// 7 Tage aus Stundenkursen (market.json → spark, stündlich erneuert), dazu der aktuelle Kurs; Fläche mit Verlauf wie in Krypto-Apps
let sparkN = 0;
function spark7(key) {
  const s = (S.market.spark || {})[key];
  if (!s || s.length < 5) return spark(key, 7);
  const c = s.slice(), live = A(key).price;
  if (live != null && !A(key).error) c.push(live);
  const lo = Math.min(...c), hi = Math.max(...c), W = 96, H = 34, k = (W - 2) / (c.length - 1);
  const y = v => hi === lo ? H / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (H - 5);
  const pts = c.map((v, i) => [(1 + i * k).toFixed(1), y(v).toFixed(1)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join('');
  const up = c[c.length - 1] >= c[0], col = `var(--${up ? 'up' : 'down'})`, id = 'sg' + (++sparkN);
  return `<svg class="spark7" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${pts[pts.length - 1][0]} ${H}L${pts[0][0]} ${H}Z" fill="url(#${id})" stroke="none"/><path d="${d}" fill="none" style="stroke:${col}"/></svg>`;
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
  r.est = pos.filter(o => o.est).map(o => o.symbol);
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
  const pick = f => { const l = c.held.filter(p => p.value > 0 && f(p)); return {pct: l.reduce((s, p) => s + p.weight, 0), list: l.map(p => p.symbol)}; };
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
