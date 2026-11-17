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

const S = {flt: {}, sort: {}, tab: 'home', range: '1J', mode: 'wert', flowWin: '24', calFilter: 'alle', pf: null, market: {}, daily: {}, analysis: {}, digest: {}, state: {}, loading: false, err: ''};
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
const isFund = key => !isCoin(key) && /\b(ETF|ETC|UCITS)\b/i.test(A(key).name || D(key).name || '');
const nameOf = key => A(key).name || D(key).name || key.split(':')[1];
function priceAt(key, day) {
  const h = D(key).hist;
  if (!h || !h.d.length) return A(key).price ?? null;
  const i = bisect(h.d, day);
  return i >= 0 ? h.c[i] : h.c[0];
}

function calc() {
  if (S.calc) return S.calc;
  const txs = (S.pf.transactions || []).map(t => Object.assign({}, t, {day: isoToDay(t.date), key: keyOf(t.kind, t.symbol),
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
    const price = a.error ? null : a.price ?? null, rate = fxNow(curOf(key)) || 1;
    const value = price == null ? null : qty * price / rate, chg = a.change_pct;
    return {key, kind: key.split(':')[0], symbol: key.split(':')[1], name: nameOf(key), qty, cost, value, price, cur: curOf(key),
      realized: realized[key] || 0, pnl: value == null ? null : value - cost, pnlPct: value != null && cost > 0 ? (value / cost - 1) * 100 : null,
      dayPct: chg, dayEur: value != null && chg != null && chg > -100 ? value - value / (1 + chg / 100) : null,
      avgNative: native[key] && native[key].q ? native[key].c / native[key].q : null};
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

  // Verlauf: Wert, eingesetztes Geld und zeitgewichtete Rendite (Einzahlungen herausgerechnet)
  const series = {d: [], v: [], inv: [], twr: []};
  if (txs.length) {
    const end = todayDay(), qty = {}; let ti = 0, inv = 0, prev = 0, idx = 1;
    for (let day = txs[0].day; day <= end; day++) {
      let cf = 0;
      while (ti < txs.length && txs[ti].day <= day) {
        const t = txs[ti++], rate = fxAt(t.currency, t.day) || 1;
        qty[t.key] = (qty[t.key] || 0) + (t.type === 'buy' ? t.qty : -t.qty);
        cf += t.type === 'buy' ? (t.qty * t.price + t.fee) / rate : -(t.qty * t.price - t.fee) / rate;
      }
      let v = 0;
      for (const k in qty) {
        if (qty[k] <= 1e-12) continue;
        const px = day === end && A(k).price != null && !A(k).error ? A(k).price : priceAt(k, day);
        if (px != null) v += qty[k] * px / (fxAt(curOf(k), day) || 1);
      }
      inv += cf;
      if (prev > 0) idx *= (v - cf) / prev;
      prev = v;
      series.d.push(day); series.v.push(v); series.inv.push(inv); series.twr.push(idx);
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
    g += `<line x1="${pl}" x2="${W - pr}" y1="${sy(v)}" y2="${sy(v)}" stroke="#e8e8ed" stroke-width="1"/>` +
      `<text x="${W - pr + 8}" y="${sy(v) + 4}" font-size="11" fill="#86868b">${esc(fmt(v))}</text>`;
  }
  const span = x1 - x0, n = Math.min(5, Math.max(2, Math.floor(W / 110)));
  for (let i = 0; i <= n; i++) {
    const x = x0 + span * i / n, dt = dayToDate(Math.round(x));
    const lab = span > 500 ? `${MON_K[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}` : `${dt.getUTCDate()}. ${MON_K[dt.getUTCMonth()]}`;
    g += `<text x="${sx(x)}" y="${H - 6}" font-size="11" fill="#86868b" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}">${lab}</text>`;
  }
  for (const h of opt.hlines || []) {
    g += `<line x1="${pl}" x2="${W - pr}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="${h.color || '#86868b'}" stroke-width="1.5" stroke-dasharray="4 4"/>` +
      `<text x="${pl + 4}" y="${sy(h.y) - 5}" font-size="11" fill="#424245">${esc(h.label)}</text>`;
  }
  for (const s of series) {
    const d = s.pts.map(([x, y], i) => (i ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(y).toFixed(1)).join('');
    if (s.area) g += `<path d="${d}L${sx(s.pts[s.pts.length - 1][0])} ${H - pb}L${sx(s.pts[0][0])} ${H - pb}Z" fill="${s.color}" opacity=".07"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="4 4"' : ''}/>`;
  }
  for (const m of opt.markers || []) {
    if (m.x < x0 || m.x > x1) continue;
    g += `<circle cx="${sx(m.x)}" cy="${sy(m.y)}" r="5" fill="${m.color}" stroke="#fff" stroke-width="2"><title>${esc(m.title)}</title></circle>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(opt.label || 'Diagramm')}">${g}` +
    `<line class="xh" y1="${pt}" y2="${H - pb}" stroke="#86868b" stroke-width="1" visibility="hidden"/>` +
    series.map((s, i) => `<circle class="dot${i}" r="4.5" fill="${s.color}" stroke="#fff" stroke-width="2" visibility="hidden"/>`).join('') +
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
const RANGES = {'1M': 30, '3M': 91, '6M': 182, '1J': 365, 'Max': 1e6};
