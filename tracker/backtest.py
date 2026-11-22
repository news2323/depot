"""Backtest der Strategie über 10 Jahre (Jakobs Wunsch vom 22.11.2026).

Nachgerechnet wird nur, was es am jeweiligen Tag wirklich gab (keine Daten aus der Zukunft):
- Kurse (Yahoo, Tageskurse mit Dividenden, in US-Dollar), daraus Momentum-Signal, relative Stärke, Rücksetzer,
  Halbleiter-Crash (SOXX)
- Angst und Gier am Aktienmarkt, Tag für Tag wie analytics.market_fear_greed
- Umsatzwachstum und Betriebsmarge aus den Berichten an die US-Börsenaufsicht SEC, ab dem Tag der Veröffentlichung
Nicht nachrechenbar (keine frei verfügbaren alten Stände): Gewinnschätzungen und ihre Änderungen, Analystenziele,
Erwartungswert, Bewertungspunkte. Die Passung verteilt deren Gewicht auf die übrigen Bausteine.

Grenzen: Die Auswahl der Titel ist von heute (Gewinner von heute sind dabei, Pleiten fehlen). Darum zählt vor allem
der Vergleich mit „alle Titel der Auswahl gleich gewichtet“, nicht mit dem S&P 500.

Aufruf:
  python3 -m tracker.backtest sec          SEC-Zahlen holen (braucht SEC_CONTACT: Absender mit E-Mail, verlangt die SEC)
  python3 -m tracker.backtest run [repo]   rechnen und backtest.json ablegen (repo: privates Daten-Repo, Schlüsselbund)

Zwischenspeicher in .cache/ (nicht im Repo). Im Protokoll stehen keine Ticker. Faustregel, keine Anlageberatung.
"""
import datetime
import gzip
import itertools
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".cache")
START = datetime.date(2013, 6, 1)          # Vorlauf für 200-Tage-Linie, 12 Monate Momentum und Angst und Gier
YEARS = 10
TRAIN_END = "2021-10-31"                   # Optimieren bis hier, prüfen danach
COST = 0.001                               # Handelskosten je umgeschichtetem Euro (Spanne, Gebühren)
FEAR = 25

# ----------------------------------------------------------------- SEC: berichtete Zahlen mit Tag der Veröffentlichung
SEC_TAGS = {
    "rev": ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet",
            "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenue"),
    "op": ("OperatingIncomeLoss", "ProfitLossFromOperatingActivities"),
}


def _sec_get(url):
    contact = os.environ.get("SEC_CONTACT")
    if not contact:
        raise SystemExit("SEC_CONTACT fehlt: Absender mit E-Mail-Adresse, z. B. SEC_CONTACT=\"depot name@beispiel.de\"")
    req = urllib.request.Request(url, headers={"User-Agent": contact, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as f:
        b = f.read()
        if f.headers.get("Content-Encoding") == "gzip":
            b = gzip.decompress(b)
    return json.loads(b)


def _sec_compact(facts):
    """Nur Umsatz und Betriebsergebnis: je Zeitraum Beginn, Ende, Wert, Tag der ersten Veröffentlichung."""
    out = {}
    for name, tags in SEC_TAGS.items():
        rows = {}
        for tax in ("us-gaap", "ifrs-full"):
            g = (facts.get("facts") or {}).get(tax) or {}
            for tag in tags:
                for unit, xs in ((g.get(tag) or {}).get("units") or {}).items():
                    for x in xs:
                        if not x.get("start") or not x.get("end") or x.get("val") is None or not x.get("filed"):
                            continue
                        k = (x["start"], x["end"])
                        if k not in rows or x["filed"] < rows[k][3]:
                            rows[k] = [x["start"], x["end"], x["val"], x["filed"]]
        out[name] = sorted(rows.values(), key=lambda r: (r[1], r[0]))
    return out


def sec_fetch(symbols):
    os.makedirs(os.path.join(CACHE, "sec"), exist_ok=True)
    if "@" not in os.environ.get("SEC_CONTACT", ""):
        raise SystemExit("In SEC_CONTACT fehlt eine echte E-Mail-Adresse, z. B. SEC_CONTACT=\"depot-backtest name@beispiel.de\"")
    try:
        tick = _sec_get("https://www.sec.gov/files/company_tickers.json")
    except urllib.error.HTTPError as e:
        raise SystemExit("Die SEC hat den Abruf abgelehnt (%d). Steht in SEC_CONTACT eine echte E-Mail-Adresse?" % e.code)
    cik = {v["ticker"].upper(): int(v["cik_str"]) for v in tick.values()}
    ok = 0
    for sym in symbols:
        c = cik.get(sym.upper().replace("-", "."))
        if not c:
            continue
        try:
            data = _sec_compact(_sec_get("https://data.sec.gov/api/xbrl/companyfacts/CIK%010d.json" % c))
        except Exception as e:
            print("SEC: Fehler " + type(e).__name__)
            continue
        with open(os.path.join(CACHE, "sec", sym + ".json"), "w") as f:
            json.dump(data, f)
        ok += 1
        time.sleep(0.2)   # die SEC erlaubt höchstens 10 Abrufe je Sekunde
    print("SEC: %d von %d Firmen geladen" % (ok, len(symbols)))


def _d(iso):
    return datetime.date.fromisoformat(iso)


def sec_quarters(sym):
    """Quartale (Ende, Umsatz, Betriebsergebnis, veröffentlicht am) und Jahre, so wie zuerst berichtet.
    Viertes Quartal = Geschäftsjahr minus neun Monate."""
    path = os.path.join(CACHE, "sec", sym + ".json")
    if not os.path.exists(path):
        return None
    data = json.load(open(path))

    def periods(rows):
        q, ann, nine = {}, {}, {}
        for st, en, val, filed in rows:
            dur = (_d(en) - _d(st)).days
            if 80 <= dur <= 100:
                q.setdefault(en, (val, filed))
            elif 350 <= dur <= 380:
                ann.setdefault(en, (val, filed, st))
            elif 260 <= dur <= 285:
                nine.setdefault(st, (val, filed, en))
        for en, (val, filed, st) in ann.items():
            n9 = nine.get(st)
            if en not in q and n9 and n9[2] < en:
                q[en] = (val - n9[0], filed)
        return q, ann

    rq, ra = periods(data.get("rev") or [])
    oq, oa = periods(data.get("op") or [])
    quarters = [(en, v, (oq.get(en) or (None,))[0], max(f, (oq.get(en) or (None, f))[1])) for en, (v, f) in rq.items()]
    years = [(en, v, (oa.get(en) or (None,))[0], f) for en, (v, f, _) in ra.items()]
    return {"q": sorted(quarters), "y": sorted(years)}


def fundamentals_at(fq, day_iso):
    """Umsatzwachstum (Jahr zu Jahr, in %), Beschleunigung und Betriebsmarge mit dem Stand vom Tag `day_iso`."""
    if not fq:
        return None
    lim = (_d(day_iso) - datetime.timedelta(days=200)).isoformat()
    qs = [x for x in fq["q"] if x[3] <= day_iso]
    if len(qs) >= 8 and qs[-1][0] >= lim and 600 <= (_d(qs[-1][0]) - _d(qs[-8][0])).days <= 700:
        last4, prev4 = qs[-4:], qs[-8:-4]
        r_now, r_prev = sum(x[1] for x in last4), sum(x[1] for x in prev4)
        g = (r_now / r_prev - 1) * 100 if r_prev > 0 else None
        g_q = (qs[-1][1] / qs[-5][1] - 1) * 100 if qs[-5][1] > 0 else None
        g_q1 = (qs[-2][1] / qs[-6][1] - 1) * 100 if qs[-6][1] > 0 else None
        ops = [x[2] for x in last4]
        opm = sum(ops) / r_now if r_now > 0 and all(o is not None for o in ops) else None
        accel = None
        if g_q is not None and g_q1 is not None and g_q1 > 0:
            accel = "schneller" if g_q >= g_q1 * 0.9 else "langsamer" if g_q < g_q1 * 0.5 else "etwas langsamer"
        return {"g": g, "opm": opm, "accel": accel}
    ys = [x for x in fq["y"] if x[3] <= day_iso]
    lim_y = (_d(day_iso) - datetime.timedelta(days=500)).isoformat()
    if len(ys) >= 2 and ys[-1][0] >= lim_y and ys[-2][1] > 0:
        opm = ys[-1][2] / ys[-1][1] if ys[-1][2] is not None and ys[-1][1] > 0 else None
        return {"g": (ys[-1][1] / ys[-2][1] - 1) * 100, "opm": opm, "accel": None}
    return None


# ----------------------------------------------------------------- Kurse
def _chart(sym):
    os.makedirs(os.path.join(CACHE, "prices"), exist_ok=True)
    path = os.path.join(CACHE, "prices", sym.replace("^", "_") + ".json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 20 * 3600:
        return json.load(open(path))
    from . import sources
    p1 = int(datetime.datetime(START.year, START.month, START.day).timestamp())
    u = "https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d&events=div%%2Csplit" % (
        urllib.parse.quote(sym), p1, int(time.time()))
    r = sources._try("Yahoo Kurse", u)
    try:
        res = r["chart"]["result"][0]
    except (TypeError, KeyError, IndexError):
        return None
    off = (res.get("meta") or {}).get("gmtoffset") or 0
    adj = ((res.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose")
    cl = adj or ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    out = {"d": [], "c": [], "cur": (res.get("meta") or {}).get("currency") or "USD"}
    for t, c in zip(res.get("timestamp") or [], cl):
        if c is None or c <= 0:
            continue
        d = int((t + off) // 86400)
        if out["d"] and out["d"][-1] == d:
            out["c"][-1] = c
        else:
            out["d"].append(d)
            out["c"].append(c)
    json.dump(out, open(path, "w"))
    time.sleep(0.15)
    return out


def _align(series, days):
    """Auf die Handelstage des S&P 500 legen; fehlende Tage mit dem letzten Kurs, vor dem ersten Kurs None."""
    out, j, last = [], 0, None
    d, c = series["d"], series["c"]
    for day in days:
        while j < len(d) and d[j] <= day:
            last = c[j]
            j += 1
        out.append(last)
    return out


def _iso(day):
    return (datetime.date(1970, 1, 1) + datetime.timedelta(days=day)).isoformat()


class Stock:
    """Kurs in Dollar und gleitende Werte je Handelstag."""

    def __init__(self, sym, px, theme, tw):
        self.sym, self.p, self.theme, self.tw = sym, px, theme, tw
        n = len(px)
        self.first = next((i for i, x in enumerate(px) if x is not None), n)
        ps = [0.0] * (n + 1)
        for i in range(n):
            ps[i + 1] = ps[i] + (px[i] or 0.0)
        self.ps = ps
        self.hi = [None] * n
        win = []
        for i in range(self.first, n):     # Hoch der letzten 252 Handelstage (monoton fallende Schlange)
            while win and px[win[-1]] <= px[i]:
                win.pop()
            win.append(i)
            if win[0] <= i - 252:
                win.pop(0)
            self.hi[i] = px[win[0]]

    def ok(self, i, need):
        return i - self.first >= need

    def sma(self, i, k):
        return (self.ps[i + 1] - self.ps[i + 1 - k]) / k if i - self.first + 1 >= k else None

    def ret(self, i, back, skip=0):
        if i - back < self.first:
            return None
        return self.p[i - skip] / self.p[i - back] - 1


# ----------------------------------------------------------------- Momentum-Signal und Angst und Gier
P0 = {"near": 15, "trend": "50_200", "rel": 6}     # wie analytics.momentum heute


def mom_on(s, i, P, bench):
    """Signal an am Tag i mit den Regeln P (Trend, Abstand zum Jahreshoch, Stärke gegenüber dem S&P 500)."""
    if not s.ok(i, 252):
        return False
    p, s200, s200m = s.p[i], s.sma(i, 200), s.sma(i - 21, 200)
    if P["trend"] == "50_200":
        t = p > s.sma(i, 50) > s200
    elif P["trend"] == "p_100":
        t = p > s.sma(i, 100) and p > s200
    else:
        t = p > s200
    if not (t and s200m and s200 > s200m and p >= s.hi[i] * (1 - P["near"] / 100.0)):
        return False
    if P["rel"]:
        k = {3: 63, 6: 126, 12: 252}[P["rel"]]
        r = s.ret(i, k)
        return r is not None and r - (bench[i] / bench[i - k] - 1) > 0
    return True


def mom_state(s, i, bench, on_hist):
    """Zustand wie analytics.momentum: on, fade, down, none (on_hist: Signal der letzten Tage, neuester zuletzt)."""
    if not s.ok(i, 252):
        return None
    if on_hist[-1]:
        return "on"
    if s.p[i] < s.sma(i, 200):
        return "down"
    if s.p[i] < s.sma(i, 50) and any(on_hist[-21:]):
        return "fade"
    return "none"


def fear_greed(c, window=252):
    """Angst und Gier für jeden Tag (Liste wie die Kalendertage, None ohne genug Vorlauf). c: Kürzel -> Kurse."""
    n = len(c["^GSPC"])

    def ma(xs, i, k):
        if i < k - 1 or any(x is None for x in xs[i - k + 1:i + 1]):
            return None
        return sum(xs[i - k + 1:i + 1]) / k

    def r20(xs, i):
        return xs[i] / xs[i - 20] - 1 if i >= 20 and xs[i] and xs[i - 20] else None

    raw = {k: [None] * n for k in ("momentum", "vola", "haven", "junk", "breadth")}
    for i in range(n):
        m = ma(c["^GSPC"], i, 125)
        raw["momentum"][i] = c["^GSPC"][i] / m - 1 if m else None
        m = ma(c["^VIX"], i, 50)
        raw["vola"][i] = -(c["^VIX"][i] / m - 1) if m else None
        a, b = r20(c["SPY"], i), r20(c["TLT"], i)
        raw["haven"][i] = a - b if a is not None and b is not None else None
        a, b = r20(c["HYG"], i), r20(c["IEF"], i)
        raw["junk"][i] = a - b if a is not None and b is not None else None
        m = ma(c["RSP"], i, 50)
        raw["breadth"][i] = c["RSP"][i] / m - 1 if m else None
    out = [None] * n
    for i in range(n):
        vals = []
        for xs in raw.values():
            if xs[i] is None:
                break
            h = [x for x in xs[max(0, i - window + 1):i + 1] if x is not None]
            if len(h) < 60:
                break
            vals.append(100.0 * sum(1 for x in h if x < xs[i]) / (len(h) - 1))
        if len(vals) == 5:
            out[i] = round(sum(vals) / 5)
    return out


# ----------------------------------------------------------------- Passung für dich, nachgerechnet
def _lin(v, a, b):
    return None if v is None else max(0.0, min(1.0, (v - a) / (b - a)))


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


# Gewichtungen zum Vergleich (nur die nachrechenbaren Bausteine; Schätzungen, Bewertung, Erwartungswert fehlen)
SCHEMES = (
    ("heute", "Heutige Gewichte", None, False),
    ("momentum", "Mehr Momentum", {"momentum": .30, "rs": .13, "growth": .14, "quality": .10}, False),
    ("kurs", "Nur Kursstärke", {"momentum": .23, "rs": .09}, False),
    ("kurs_filter", "Kursstärke, Wachstum und Marge als Filter", {"momentum": .23, "rs": .09}, True),
    ("qualitaet", "Mehr Wachstum und Qualität", {"momentum": .15, "rs": .05, "growth": .21, "quality": .25}, False),
)


def fit_at(s, i, ctx, ans, P=P0, state=None, w_over=None, filt=False):
    """Passung 0 bis 100 wie screen.fit, aber nur mit Bausteinen, die es am Tag i gab. Fehlende Bausteine
    (Schätzungen, Bewertung, Erwartungswert) bekommen kein Gewicht. Gibt (Passung, Bausteine, Merkmale) zurück."""
    from . import screen
    b = ctx["bench"]
    if not s.ok(i, 273):
        return None
    r12, r6 = s.ret(i, 252, 21), s.ret(i, 126)
    b12, b6 = b[i - 21] / b[i - 252] - 1, b[i] / b[i - 126] - 1
    c = {"momentum": _mean([_lin((r12 - b12) * 100, -30, 50), _lin((r6 - b6) * 100, -20, 35)]),
         "rs": ctx["rs"].get((s.sym, i))}
    f = fundamentals_at(ctx["sec"].get(s.sym), ctx["iso"][i])
    if f and f.get("g") is not None:
        g = _lin(f["g"], 0, 50)
        g += 0.15 if f["accel"] == "schneller" else -0.1 if f["accel"] == "langsamer" else 0
        c["growth"] = max(0.0, min(1.0, g))
    if f and f.get("opm") is not None:
        c["quality"] = min(_lin(f["opm"], 0, 0.35), 0.15 if f["opm"] < 0 else 1.0)
    w = w_over or screen.WEIGHTS.get(ans.get("priority") or "upside")
    ws = {k: w[k] for k in c if c[k] is not None and k in w}
    x = sum(c[k] * ws[k] for k in ws) / sum(ws.values()) * 100
    if filt and f and ((f.get("g") is not None and f["g"] < 0) or (f.get("opm") is not None and f["opm"] < 0)):
        x *= 0.7                                  # Filter: schrumpfender Umsatz oder Verlust
    x *= 0.55 + 0.45 * s.tw
    if c.get("quality") is not None and c["quality"] < 0.3:
        x *= 0.85
    spec = f is not None and f.get("opm") is not None and f["opm"] < 0
    if spec and ans.get("spec") != "ja":
        x *= 0.85
    rets = [math.log(s.p[j] / s.p[j - 1]) for j in range(i - 251, i + 1)]
    mu = sum(rets) / len(rets)
    vol = math.sqrt(sum((r - mu) ** 2 for r in rets) / len(rets)) * math.sqrt(252) * 100
    if f and f.get("g") is not None and f["g"] < 8 and s.tw < 0.9 and vol < 35 and (ans.get("defensive") or "reduce") == "reduce":
        x *= 0.8
    if (ans.get("horizon") or "lt2") == "lt2" and vol > 70:
        x *= 0.9
    if state:
        x *= screen.STYLE_MULT.get(ans.get("style"), {}).get(state, 1.0)
    return min(100.0, x), c, {"g": f and f.get("g"), "opm": f and f.get("opm"), "vol": vol}


# ----------------------------------------------------------------- Kennzahlen einer Wertreihe
def stats(nav, days):
    """nav: Werte je Tag (Start 1), days: Tage seit 1970. Jährliche Rendite, größter Rückgang, Schwankung."""
    if len(nav) < 2:
        return None
    yrs = (days[-1] - days[0]) / 365.25
    cagr = (nav[-1] / nav[0]) ** (1 / yrs) - 1 if yrs > 0 and nav[0] > 0 else None
    peak, dd, pk, best = nav[0], 0.0, days[0], (0.0, days[0], days[0])
    for v, d in zip(nav, days):
        if v > peak:
            peak, pk = v, d
        x = v / peak - 1
        if x < best[0]:
            best = (x, pk, d)
    rets = [nav[k] / nav[k - 1] - 1 for k in range(1, len(nav))]
    per = len(rets) / yrs if yrs > 0 else 252
    mu = sum(rets) / len(rets)
    sd = math.sqrt(sum((r - mu) ** 2 for r in rets) / len(rets))
    return {"cagr": round(cagr * 100, 1) if cagr is not None else None, "dd": round(best[0] * 100, 1),
            "dd_from": _iso(best[1]), "dd_to": _iso(best[2]), "vol": round(sd * math.sqrt(per) * 100, 1),
            "sharpe": round(mu / sd * math.sqrt(per), 2) if sd > 0 else None, "total": round((nav[-1] / nav[0] - 1) * 100, 1)}


# ----------------------------------------------------------------- Laden und vorbereiten
def prepare():
    from . import screen
    syms = sorted(screen.THEME_OF)
    master = _chart("^GSPC")
    t0 = (START - datetime.date(1970, 1, 1)).days
    days = [d for d in master["d"] if d >= t0]
    raw = {}
    for sym in syms + ["SOXX", "QQQ", "^VIX", "SPY", "TLT", "HYG", "IEF", "RSP", "EURUSD=X"]:
        x = _chart(sym)
        if x and len(x["d"]) > 50:
            raw[sym] = x
    fx = {}
    for sym in syms:
        cur = (raw.get(sym) or {}).get("cur")
        if cur and cur != "USD" and cur not in fx:
            x = _chart(cur + "=X")
            fx[cur] = _align(x, days) if x else None
    bench = _align(master, days)
    stocks = {}
    for sym in syms:
        if sym not in raw:
            continue
        px = _align(raw[sym], days)
        cur = raw[sym]["cur"]
        if cur != "USD":
            f = fx.get(cur)
            if not f:
                continue
            px = [None if p is None or not f[i] else p / f[i] for i, p in enumerate(px)]
        theme, tw = screen.THEME_OF[sym]
        stocks[sym] = Stock(sym, px, theme, tw)
    al = {k: _align(raw[k], days) for k in ("SOXX", "QQQ", "^VIX", "SPY", "TLT", "HYG", "IEF", "RSP", "EURUSD=X") if k in raw}
    al["^GSPC"] = bench
    return days, bench, stocks, al


def month_ends(days, start_iso):
    out = []
    for i in range(len(days) - 1):
        if _iso(days[i])[:7] != _iso(days[i + 1])[:7] and _iso(days[i]) >= start_iso:
            out.append(i)
    out.append(len(days) - 1)
    return out


# ----------------------------------------------------------------- Depot-Simulation
def simulate(ctx, months, pick, exit_rule, n_pos, empty, cost=COST, daily=False, scale=None):
    """Monatlich umschichten. pick(i, held) -> Liste der Titel (beste zuerst). exit_rule: wann gehaltene Titel gehen.
    empty: 'cash' (Reserve ohne Zins) oder 'index' (S&P 500) für freie Plätze. Rückgabe: Monatsrenditen (und Tageswerte)."""
    st, bench = ctx["stocks"], ctx["bench"]
    held, rets, nav_d, nav, invested = [], [], [], 1.0, []
    w_old = {}
    for t in range(len(months) - 1):
        i, j = months[t], months[t + 1]
        keep = [x for x in held if exit_rule(x, i)]
        new = [x for x in pick(i, keep) if x not in keep]
        held = (keep + new)[:n_pos]
        f = scale(i) if scale else 1.0
        w = {x: f / n_pos for x in held}
        if empty == "index" and len(held) < n_pos:
            w["^idx"] = f * (n_pos - len(held)) / float(n_pos)
        turn = sum(abs(w.get(k, 0) - w_old.get(k, 0)) for k in set(w) | set(w_old))
        px = lambda k, d: bench[d] if k == "^idx" else st[k].p[d]
        r = sum(wt * (px(k, j) / px(k, i) - 1) for k, wt in w.items()) - cost * turn
        if daily:
            for d in range(i + 1, j + 1):
                v = 1.0 - sum(w.values()) + sum(wt * px(k, d) / px(k, i) for k, wt in w.items())
                nav_d.append(nav * (v - cost * turn * (1 if d == j else 0)))
        nav *= 1 + r
        rets.append(r)
        invested.append(min(1.0, sum(wt for k, wt in w.items() if k != "^idx")))
        w_old = {k: wt * px(k, j) / px(k, i) / (1 + r + cost * turn) for k, wt in w.items()}
    return {"rets": rets, "nav_d": nav_d, "invested": invested}


def save_plan(rets, months, days, fx, monthly=1000.0):
    """Sparplan: jeden Monatsanfang `monthly` Euro, Renditen in Dollar mit dem Euro-Kurs umgerechnet."""
    val, inv, curve = 0.0, 0.0, []
    for t, r in enumerate(rets):
        i, j = months[t], months[t + 1]
        val += monthly
        inv += monthly
        fx_r = fx[i] / fx[j] if fx and fx[i] and fx[j] else 1.0    # EURUSD: Dollar je Euro
        val *= (1 + r) * fx_r
        curve.append([days[j], round(val), round(inv)])
    return curve


def sub_stats(rets, months, days, a_iso, b_iso):
    nav, ds = [1.0], [None]
    for t, r in enumerate(rets):
        if a_iso < _iso(days[months[t + 1]]) <= b_iso:
            if ds[0] is None:
                ds[0] = days[months[t]]
            nav.append(nav[-1] * (1 + r))
            ds.append(days[months[t + 1]])
    return stats(nav, ds) if len(nav) > 12 else None


# ----------------------------------------------------------------- Hauptlauf
def run(ans, plan_syms):
    days, bench, stocks, al = prepare()
    iso = [_iso(d) for d in days]
    n = len(days)
    sec = {s: sec_quarters(s) for s in stocks}
    sec = {k: v for k, v in sec.items() if v}
    fg = fear_greed(al)
    soxx = al.get("SOXX")
    soxx_dd = [None] * n
    for i in range(n):           # Abstand zum Hoch der letzten 5 Jahre
        if soxx and soxx[i]:
            hi = max(x for x in soxx[max(0, i - 1260):i + 1] if x)
            soxx_dd[i] = (soxx[i] / hi - 1) * 100
    # gleich gewichtete Auswahl als Maßstab (täglich neu gewichtet über alle verfügbaren Titel)
    ew = [1.0] * n
    for i in range(1, n):
        rs = [s.p[i] / s.p[i - 1] - 1 for s in stocks.values() if i - 1 >= s.first]
        ew[i] = ew[i - 1] * (1 + (sum(rs) / len(rs) if rs else 0))
    start_iso = (datetime.date.fromisoformat(iso[-1]) - datetime.timedelta(days=int(YEARS * 365.25))).isoformat()
    months = month_ends(days, start_iso)
    # relative Stärke im Thema an jedem Monatsende und an Signal-Tagen
    rs = {}

    def rs_at(i):
        peers = [(s.sym, s.p[i] / s.p[i - 126] - 1) for s in stocks.values() if s.tw >= 0.6 and s.ok(i, 126)]
        if len(peers) >= 5:
            vals = sorted(v for _, v in peers)
            for sym, v in peers:
                rs[(sym, i)] = sum(1 for x in vals if x < v) / float(len(vals))
    ctx = {"stocks": stocks, "bench": bench, "iso": iso, "sec": sec, "rs": rs}

    # ------------------------------------------------- tägliches Signal mit den heutigen Regeln
    on = {s: [False] * n for s in stocks}
    state = {s: [None] * n for s in stocks}
    for sym, s in stocks.items():
        for i in range(s.first + 252, n):
            on[sym][i] = mom_on(s, i, P0, bench)
            state[sym][i] = mom_state(s, i, bench, on[sym][max(0, i - 20):i + 1])

    def fwd(series, i, h):
        return series[i + h] / series[i] - 1 if i + h < n and series[i] and series[i + h] else None

    H = (21, 63, 126, 252)
    t_start = months[0]

    def summarize(obs):
        """obs: Liste von (Titel-Rendite je h, S&P je h, Auswahl je h)."""
        out = {}
        for k, h in enumerate(H):
            xs = [o for o in obs if o[0][k] is not None]
            if not xs:
                continue
            r = sorted(o[0][k] * 100 for o in xs)
            ex_ew = [(o[0][k] - o[2][k]) * 100 for o in xs if o[2][k] is not None]
            ex_sp = [(o[0][k] - o[1][k]) * 100 for o in xs if o[1][k] is not None]
            out[str(h)] = {"n": len(xs), "avg": round(sum(r) / len(r), 1), "med": round(r[len(r) // 2], 1),
                           "hit": round(100.0 * sum(1 for x in r if x > 0) / len(r)),
                           "ex_ew": round(sum(ex_ew) / len(ex_ew), 1) if ex_ew else None,
                           "hit_ew": round(100.0 * sum(1 for x in ex_ew if x > 0) / len(ex_ew)) if ex_ew else None,
                           "ex_sp": round(sum(ex_sp) / len(ex_sp), 1) if ex_sp else None}
        return out

    def obs_stock(sym, i):
        p = stocks[sym].p
        return ([fwd(p, i, h) for h in H], [fwd(bench, i, h) for h in H], [fwd(ew, i, h) for h in H])

    events = {"mom_on": [], "trend_break": [], "dip_up": [], "dip_down": []}
    timeline = {s: [] for s in stocks}
    for sym, s in stocks.items():
        last_dip = last_tb = -99
        for i in range(max(t_start, s.first + 253), n):
            st0, st1 = state[sym][i - 1], state[sym][i]
            if st1 == "on" and not any(on[sym][i - 6:i]):
                events["mom_on"].append((sym, i))
                timeline[sym].append(("mom", i))
            if st1 == "down" and st0 in ("on", "fade", "none") and i - last_tb >= 21:
                last_tb = i
                events["trend_break"].append((sym, i))
                timeline[sym].append(("down", i))
            r5 = s.ret(i, 5)
            if r5 is not None and r5 <= -0.08 and i - last_dip >= 5:
                events["dip_up" if s.p[i] >= s.sma(i, 200) else "dip_down"].append((sym, i))
                last_dip = i
    sig = []
    names = {"mom_on": "Momentum-Signal geht an", "trend_break": "Trend bricht (unter 200-Tage-Linie)",
             "dip_up": "Rücksetzer −8 % in 5 Tagen, über der 200-Tage-Linie", "dip_down": "Rücksetzer −8 % in 5 Tagen, unter der 200-Tage-Linie"}
    for k, evs in events.items():
        sig.append({"id": k, "name": names[k], "h": summarize([obs_stock(sym, i) for sym, i in evs])})
    # alle Tage als Vergleich (was ein Kauf an einem beliebigen Tag brachte)
    base = []
    for sym, s in stocks.items():
        for i in range(max(t_start, s.first + 253), n, 5):
            base.append(obs_stock(sym, i))
    sig.append({"id": "any", "name": "Zum Vergleich: Kauf an einem beliebigen Tag", "h": summarize(base)})

    # Marktsignale: extreme Angst, Halbleiter-Crash
    def market_events(cond, gap=21):
        out, last = [], -999
        for i in range(max(t_start, 1), n):
            if cond(i) and not cond(i - 1) and i - last >= gap:
                out.append(i)
                last = i
        return out

    def obs_mkt(i):
        return {k: {str(h): (round(fwd(ser, i, h) * 100, 1) if fwd(ser, i, h) is not None else None) for h in H}
                for k, ser in (("sp", bench), ("soxx", soxx), ("ew", ew))}

    market = []
    for thr in (10, 20, 25, 35):
        evs = market_events(lambda i, t=thr: fg[i] is not None and fg[i] < t)
        market.append({"id": "fear%d" % thr, "name": "Angst und Gier fällt unter %d" % thr, "events": [{"day": iso[i], "v": fg[i], "r": obs_mkt(i)} for i in evs]})
    sp200 = [None] * n
    for i in range(199, n):
        sp200[i] = bench[i] >= sum(bench[i - 199:i + 1]) / 200
    for name, extra in (("up", lambda i: sp200[i]), ("down", lambda i: sp200[i] is False), ("semis", lambda i: soxx_dd[i] is not None and soxx_dd[i] <= -20)):
        evs = market_events(lambda i, e=extra: fg[i] is not None and fg[i] < FEAR and e(i))
        label = {"up": "Angst unter 25, S&P 500 über der 200-Tage-Linie", "down": "Angst unter 25, S&P 500 unter der 200-Tage-Linie",
                 "semis": "Angst unter 25 und Halbleiter 20 % unter dem Hoch"}[name]
        market.append({"id": "fear_" + name, "name": label, "events": [{"day": iso[i], "v": fg[i], "r": obs_mkt(i)} for i in evs]})
    for thr in (-20, -30, -40):
        evs = market_events(lambda i, t=thr: soxx_dd[i] is not None and soxx_dd[i] <= t, 63)
        market.append({"id": "semis%d" % -thr, "name": "Halbleiter %d %% unter dem Hoch" % thr, "events": [{"day": iso[i], "v": round(soxx_dd[i]), "r": obs_mkt(i)} for i in evs]})
    base_m = [obs_mkt(i) for i in range(t_start, n, 5)]

    def avg_m(rows, k, h):
        xs = [r[k][str(h)] for r in rows if r[k][str(h)] is not None]
        return round(sum(xs) / len(xs), 1) if xs else None
    for m in market + [{"id": "any", "events": [{"r": r} for r in base_m]}]:
        rows = [e["r"] for e in m["events"]]
        m["avg"] = {k: {str(h): avg_m(rows, k, h) for h in H} for k in ("sp", "soxx", "ew")}
        m["hit"] = {k: {str(h): (round(100.0 * sum(1 for r in rows if (r[k][str(h)] or 0) > 0) / max(1, sum(1 for r in rows if r[k][str(h)] is not None))))
                        for h in H} for k in ("sp", "soxx", "ew")}
    market_any = market_any = {"avg": m["avg"], "hit": m["hit"]}

    # ------------------------------------------------- Passung je Monat (nachgerechnet) und Punkte-Gruppen
    for i in months:
        rs_at(i)
    fits_by = {}
    for sid, _, w_over, filt in SCHEMES:
        fb = {}
        for i in months:
            for sym, s in stocks.items():
                f = fit_at(s, i, ctx, ans, P0, state[sym][i], w_over, filt)
                if f:
                    fb[(sym, i)] = f
        fits_by[sid] = fb
    fits = fits_by["heute"]
    F = {"fits": fits}
    buckets = {}
    for (sym, i), (x, c, m) in fits.items():
        pts = max(1, min(10, int(x / 10 + 0.5)))
        buckets.setdefault(pts, []).append(obs_stock(sym, i))
    bucket_out = [{"pts": k, "h": summarize(v)} for k, v in sorted(buckets.items())]
    hi_obs = [o for k, v in buckets.items() if k >= 8 for o in v]
    lo_obs = [o for k, v in buckets.items() if k <= 5 for o in v]
    groups = [{"id": "8-10", "h": summarize(hi_obs)}, {"id": "6-7", "h": summarize([o for k, v in buckets.items() if k in (6, 7) for o in v])},
              {"id": "1-5", "h": summarize(lo_obs)}]

    # ------------------------------------------------- Depots: heutige Regeln und Varianten
    def ranked(i, cands):
        return sorted(cands, key=lambda sym: -(F["fits"].get((sym, i)) or (0,))[0])

    def avail(i):
        return [sym for sym, s in stocks.items() if (sym, i) in F["fits"]]

    def exc(i, fear_thr, crash_thr):
        """Ausnahme von „Momentum zuerst“: Angst unter fear_thr ("c25": unter 25 und Halbleiter 20 % unter dem Hoch) oder Halbleiter-Crash."""
        f = bool(fear_thr) and fg[i] is not None and fg[i] < (25 if fear_thr == "c25" else fear_thr)
        if fear_thr == "c25":
            f = f and soxx_dd[i] is not None and soxx_dd[i] <= -20
        return f or bool(crash_thr and soxx_dd[i] is not None and soxx_dd[i] <= crash_thr)

    def make_pick(mode, P, fear_thr, crash_thr, n_pos):
        def pick(i, keep):
            cands = avail(i)
            if mode == "fit":
                return ranked(i, cands)[:n_pos]
            if mode == "dip":
                return ranked(i, [x for x in cands if stocks[x].p[i] <= stocks[x].hi[i] * 0.8])[:n_pos]
            sel = ranked(i, [x for x in cands if mom_on(stocks[x], i, P, bench)])
            free = n_pos - len([x for x in keep]) - len([x for x in sel if x not in keep])
            if mode == "mom_ex" and exc(i, fear_thr, crash_thr) and free > 0:
                pool = [x for x in cands if x not in sel and x not in keep and (F["fits"][(x, i)][2]["g"] is None or F["fits"][(x, i)][2]["g"] > 0)]
                pool.sort(key=lambda x: -(rs.get((x, i)) or 0))
                sel += pool[:free]
            return sel
        return pick

    def make_exit(rule, P, n_pos):
        def ex(sym, i):
            s = stocks[sym]
            if not s.ok(i, 252):
                return False
            if rule == "signal":
                return mom_on(s, i, P, bench)
            if rule == "trend":
                return s.p[i] >= s.sma(i, 200)
            rank = ranked(i, avail(i))
            return sym in rank[:2 * n_pos]
        return ex

    def run_strat(mode, P=P0, fear_thr=FEAR, crash_thr=-20, n_pos=7, exit_rule="better", empty="cash", daily=False):
        ex = make_exit("signal" if mode == "fit" else exit_rule, P, n_pos) if mode != "fit" else (lambda sym, i: False)
        return simulate(ctx, months, make_pick(mode, P, fear_thr, crash_thr, n_pos), ex, n_pos, empty, daily=daily)

    def bench_rets(ser):
        return [ser[months[t + 1]] / ser[months[t]] - 1 for t in range(len(months) - 1)]

    def bench_daily(ser):
        return [ser[d] / ser[months[0]] for d in range(months[0] + 1, months[-1] + 1)]

    eur = al.get("EURUSD=X")
    d_days = days[months[0] + 1:months[-1] + 1]
    strategies = []

    def add_strat(sid, name, desc, res=None, rets=None, nav_d=None):
        rets = rets if rets is not None else res["rets"]
        nav_d = nav_d if nav_d is not None else res["nav_d"]
        full = stats([1.0] + nav_d, [days[months[0]]] + d_days)
        sp = save_plan(rets, months, days, eur)
        strategies.append({"id": sid, "name": name, "desc": desc, "all": full,
                           "train": sub_stats(rets, months, days, "", TRAIN_END), "test": sub_stats(rets, months, days, TRAIN_END, "9999"),
                           "invested": round(100 * sum(res["invested"]) / len(res["invested"])) if res else 100,
                           "save": sp[-1][1:], "curve": [[days[months[t + 1]], round(v)] for t, (_, v, _) in enumerate(sp)]})

    add_strat("sp", "S&P 500", "Index mit Dividenden", rets=bench_rets(bench), nav_d=bench_daily(bench))
    if soxx:
        add_strat("soxx", "Halbleiter-ETF (SOXX)", "Index mit Dividenden", rets=bench_rets(soxx), nav_d=bench_daily(soxx))
    # gleich gewichtet: alle verfügbaren Titel, monatlich neu gewichtet (99 Plätze, Gewicht 1/Anzahl)
    ew_rets, ew_nav, nav = [], [], 1.0
    for t in range(len(months) - 1):
        i, j = months[t], months[t + 1]
        cs = avail(i)
        r = sum(stocks[x].p[j] / stocks[x].p[i] - 1 for x in cs) / len(cs)
        for d in range(i + 1, j + 1):
            ew_nav.append(nav * sum(stocks[x].p[d] / stocks[x].p[i] for x in cs) / len(cs))
        nav *= 1 + r
        ew_rets.append(r)
    add_strat("ew", "Alle Titel der Auswahl", "gleich gewichtet, monatlich ausgeglichen", rets=ew_rets, nav_d=ew_nav)
    add_strat("fit", "Beste Passung", "jeden Monat die 7 mit der höchsten Passung, ohne Signal", run_strat("fit", daily=True))
    add_strat("dip", "Rücksetzer kaufen (alter Stil)", "die 7 mit der höchsten Passung, die 20 % oder mehr unter dem Hoch liegen", run_strat("dip", exit_rule="better", daily=True))
    add_strat("mom", "Nur Momentum", "Kauf nur mit Signal, freie Plätze als Reserve, Verkauf wenn es Besseres gibt", run_strat("mom", daily=True))
    add_strat("now", "Deine Regeln heute", "Momentum zuerst, Ausnahmen bei Angst unter 25 und Halbleiter −20 %, Verkauf wenn es Besseres gibt", run_strat("mom_ex", daily=True))

    limit = float(ans.get("max_dd") or 35)

    def calmar(x):
        """Ziel der Optimierung (Jakobs Vorgabe vom 22.11.2026: Rendite zählt, die Grenze für Rückgänge ist kein Gesetz):
        Rendite pro Jahr in Prozent; jeder Prozentpunkt Rückgang über seiner Grenze (Frage max_dd) kostet 2 Punkte."""
        if not x or x["cagr"] is None:
            return -99
        dd = abs(x["dd"])
        return round(x["cagr"] - (2.0 * (dd - limit) if dd > limit else 0), 2)

    # ------------------------------------------------- Gewichtung der Faktoren: welche Rangfolge traf besser?
    schemes = []
    for sid, name, w_over, filt in SCHEMES:
        F["fits"] = fits_by[sid]
        res = simulate(ctx, months, lambda i, keep: ranked(i, avail(i))[:7], lambda sym, i: False, 7, "cash")
        tr = sub_stats(res["rets"], months, days, "", TRAIN_END)
        te = sub_stats(res["rets"], months, days, TRAIN_END, "9999")
        spread = {}
        for part, (a, b) in (("train", ("", TRAIN_END)), ("test", (TRAIN_END, "9999"))):
            for h in (126, 252):     # oberstes gegen unterstes Fünftel je Monat, jeweils gegenüber der ganzen Auswahl
                top, bot = [], []
                for i in months:
                    if not (a < iso[i] <= b) or i + h >= n:
                        continue
                    xs = sorted(((F["fits"][(x, i)][0], x) for x in avail(i)), reverse=True)
                    k, e = max(1, len(xs) // 5), fwd(ew, i, h)
                    top += [fwd(stocks[x].p, i, h) - e for _, x in xs[:k]]
                    bot += [fwd(stocks[x].p, i, h) - e for _, x in xs[-k:]]
                spread["%s%d" % (part, h)] = round((sum(top) / len(top) - sum(bot) / len(bot)) * 100, 1) if top and bot else None
                spread["top_%s%d" % (part, h)] = round(sum(top) / len(top) * 100, 1) if top else None
        schemes.append({"id": sid, "name": name, "w": w_over, "filter": filt, "train": tr, "test": te,
                        "s_train": calmar(tr), "s_test": calmar(te), "spread": spread})
    b0 = schemes[0]
    better = [x for x in schemes[1:] if x["s_train"] > b0["s_train"] and x["s_test"] > b0["s_test"]
              and (x["spread"]["train252"] or -99) > (b0["spread"]["train252"] or -99) and (x["spread"]["test252"] or -99) > (b0["spread"]["test252"] or -99)]
    # live kommt nur „Mehr Momentum“ in Frage (Wachstum und Qualität bleiben Jakobs Faktoren), und nur, wenn es in beiden Hälften besser ist
    scheme = "momentum" if any(x["id"] == "momentum" for x in better) else "heute"
    F["fits"] = fits_by[scheme]
    buckets_new = None
    if scheme != "heute":
        bk = {}
        for (sym, i), (x, c, m) in fits_by[scheme].items():
            bk.setdefault(max(1, min(10, int(x / 10 + 0.5))), []).append(obs_stock(sym, i))
        buckets_new = [{"pts": k, "h": summarize(v)} for k, v in sorted(bk.items())]

    # ------------------------------------------------- Optimierung: Regeln im Trainingszeitraum wählen, danach prüfen
    grid = {"near": (10, 15, 20, 30, 100), "trend": ("50_200", "p_200"), "rel": (0, 6), "n_pos": (5, 7, 10),
            "fear": (0, 25, 35, "c25"), "crash": (0, -20, -30), "exit": ("signal", "trend", "better"), "empty": ("cash", "index"),
            "regime": ("none", "half"), "ex_sort": ("rs", "fit"), "cap": (0, 2, 3)}
    soxx200 = [None] * n
    for i in range(199, n):
        if soxx and all(soxx[i - 199:i + 1]):
            soxx200[i] = soxx[i] >= sum(soxx[i - 199:i + 1]) / 200

    def regime_scale(kind, fear_thr, crash_thr):
        """Marktfilter: Liegt der Halbleiter-ETF unter seiner 200-Tage-Linie, nur halb investiert (außer eine Ausnahme greift)."""
        if kind == "none":
            return None

        def f(i):
            return 0.5 if soxx200[i] is False and not exc(i, fear_thr, crash_thr) else 1.0
        return f
    cache_on = {}

    def P_on(sym, i, P):
        k = (sym, i, P["near"], P["trend"], P["rel"])
        if k not in cache_on:
            cache_on[k] = mom_on(stocks[sym], i, P, bench)
        return cache_on[k]

    def fast_pick(P, fear_thr, crash_thr, n_pos, ex_sort="rs", cap=0):
        """Neue Titel für freie Plätze. cap: höchstens so viele Titel je Thema (gehaltene zählen mit), 0 = keine Grenze."""
        def pick(i, keep):
            cands = avail(i)
            cnt = {}
            for x in keep:
                cnt[stocks[x].theme] = cnt.get(stocks[x].theme, 0) + 1
            out = []

            def add(xs, limit):
                for x in xs:
                    if len(out) >= limit:
                        break
                    if x in keep or x in out or (cap and cnt.get(stocks[x].theme, 0) >= cap):
                        continue
                    cnt[stocks[x].theme] = cnt.get(stocks[x].theme, 0) + 1
                    out.append(x)
            add(ranked(i, [x for x in cands if P_on(x, i, P)]), 999 if not cap else n_pos - len(keep))
            free = n_pos - len(keep) - len(out)
            if exc(i, fear_thr, crash_thr) and free > 0:
                pool = [x for x in cands if x not in out and x not in keep and (F["fits"][(x, i)][2]["g"] is None or F["fits"][(x, i)][2]["g"] > 0)]
                pool.sort(key=lambda x: -(rs.get((x, i)) or 0) if ex_sort == "rs" else -F["fits"][(x, i)][0])
                add(pool, len(out) + free)
            return out
        return pick

    rank_cache = {}

    def fast_exit(rule, P, n_pos):
        def ex(sym, i):
            s = stocks[sym]
            if rule == "signal":
                return P_on(sym, i, P)
            if rule == "trend":
                return s.p[i] >= s.sma(i, 200)
            if i not in rank_cache:
                rank_cache[i] = ranked(i, avail(i))
            return sym in rank_cache[i][:2 * n_pos]
        return ex

    results = []
    keys = list(grid)
    for combo in itertools.product(*(grid[k] for k in keys)):
        g = dict(zip(keys, combo))
        P = {"near": g["near"], "trend": g["trend"], "rel": g["rel"]}
        res = simulate(ctx, months, fast_pick(P, g["fear"], g["crash"], g["n_pos"], g["ex_sort"], g["cap"]), fast_exit(g["exit"], P, g["n_pos"]), g["n_pos"], g["empty"],
                       scale=regime_scale(g["regime"], g["fear"], g["crash"]))
        tr = sub_stats(res["rets"], months, days, "", TRAIN_END)
        te = sub_stats(res["rets"], months, days, TRAIN_END, "9999")
        results.append({"p": g, "train": tr, "test": te, "invested": round(100 * sum(res["invested"]) / len(res["invested"]))})

    score = calmar
    cur = {"near": 15, "trend": "50_200", "rel": 6, "n_pos": 7, "fear": 25, "crash": -20, "exit": "better", "empty": "cash", "regime": "none", "ex_sort": "rs", "cap": 0}
    for r in results:
        r["s_train"], r["s_test"] = round(score(r["train"]), 3), round(score(r["test"]), 3)
    results.sort(key=lambda r: -r["s_train"])
    # robust: je Regel der Mittelwert über alle Kombinationen (zeigt, welche Einstellung allgemein besser ist)
    effect = {}
    for k in keys:
        effect[k] = []
        for v in grid[k]:
            xs = [r for r in results if r["p"][k] == v]
            effect[k].append({"v": v, "train": round(sum(r["s_train"] for r in xs) / len(xs), 3), "test": round(sum(r["s_test"] for r in xs) / len(xs), 3),
                              "cagr_test": round(sum(r["test"]["cagr"] for r in xs if r["test"]) / len(xs), 1),
                              "dd_test": round(sum(r["test"]["dd"] for r in xs if r["test"]) / len(xs), 1)})
    # Auswahl Schritt für Schritt von deinen Regeln aus: je Schritt eine Regel ändern, aber nur, wenn genau diese Kombination
    # in beiden Hälften besser wird (der größte Gewinn in der schwächeren Hälfte zuerst). So zählt, wie Regeln zusammenwirken;
    # die Mittelwerte oben zeigen nur die Richtung.
    by_p = {tuple(sorted(r["p"].items())): r for r in results}
    get = lambda p: by_p.get(tuple(sorted(p.items())))
    lo_hi = [int(x) for x in str(ans.get("positions") or "6-8").split("-")]

    def climb(allowed):
        ch, steps = dict(cur), []
        while True:
            here, best = get(ch), None
            for k in keys:
                for v in grid[k]:
                    r = get(dict(ch, **{k: v})) if v != ch[k] and allowed(k, v) else None
                    if r:
                        gain = min(r["s_train"] - here["s_train"], r["s_test"] - here["s_test"])
                        if gain > 0 and (best is None or gain > best[0]):
                            best = (gain, k, v, r)
            if not best:
                return ch, steps
            ch[best[1]] = best[2]
            steps.append({"k": best[1], "v": best[2], "train": best[3]["s_train"], "test": best[3]["s_test"]})
    # gewählt wird nur innerhalb deines Profils (Zahl der Titel); die freie Variante steht als Hinweis daneben
    chosen, path = climb(lambda k, v: k != "n_pos" or min(lo_hi) <= v <= max(lo_hi))
    free, free_path = climb(lambda k, v: True)
    # Reihenfolge bei Ausnahmen: nach Passung (Jakobs eigene Faktoren), außer die Stärke im Thema ist in beiden Hälften besser
    here, alt = get(chosen), get(dict(chosen, ex_sort="fit"))
    if chosen["ex_sort"] == "rs" and alt and not (here["s_train"] > alt["s_train"] and here["s_test"] > alt["s_test"]):
        chosen["ex_sort"] = "fit"
        path.append({"k": "ex_sort", "v": "fit", "train": alt["s_train"], "test": alt["s_test"], "tie": True})
    now = next(x for x in strategies if x["id"] == "now")
    opt = {"current": {"p": cur, "train": now["train"], "test": now["test"], "s_train": calmar(now["train"]), "s_test": calmar(now["test"])}, "path": path, "free": dict(get(free), desc=None) if free != chosen and get(free) else None,
           "scheme": scheme, "schemes": schemes, "buckets_new": buckets_new, "chosen": next(r for r in results if r["p"] == chosen), "best_train": results[0], "top": results[:15], "effect": effect,
           "n": len(results), "train_end": TRAIN_END}

    def desc(g):
        return "%d Titel, Kauf %s, Ausnahmen: %s, Verkauf %s%s" % (
            g["n_pos"], "über der 200-Tage-Linie" if g["near"] >= 100 else "mit Signal (höchstens %d %% unter dem Jahreshoch)" % g["near"],
            ", ".join(x for x in ("Angst unter 25 zusammen mit Halbleitern 20 % unter dem Hoch" if g["fear"] == "c25" else "Angst unter %d" % g["fear"] if g["fear"] else "",
                                  "Halbleiter %d %% unter dem Hoch" % -g["crash"] if g["crash"] else "") if x) or "keine",
            {"better": "wenn es Besseres gibt", "signal": "wenn das Signal ausgeht", "trend": "unter der 200-Tage-Linie"}[g["exit"]],
            ", halb Reserve, wenn Halbleiter unter ihrer 200-Tage-Linie" if g["regime"] == "half" else "") + (
            ", bei Ausnahmen die Titel mit der besten Passung" if g.get("ex_sort") == "fit" else "") + (
            ", höchstens %d Titel je Thema" % g["cap"] if g.get("cap") else "")

    for sid, name, g, sc in (("now_half", "Deine Regeln mit Marktfilter", dict(cur, regime="half"), "heute"), ("opt", "Optimierte Regeln", chosen, scheme)):
        F["fits"] = fits_by[sc]
        rank_cache.clear()
        Pg = {"near": g["near"], "trend": g["trend"], "rel": g["rel"]}
        res = simulate(ctx, months, fast_pick(Pg, g["fear"], g["crash"], g["n_pos"], g["ex_sort"], g["cap"]), fast_exit(g["exit"], Pg, g["n_pos"]),
                       g["n_pos"], g["empty"], daily=True, scale=regime_scale(g["regime"], g["fear"], g["crash"]))
        add_strat(sid, name, desc(g), res)
        if sid == "opt":
            opt_nav = [1.0] + res["nav_d"]
    opt["desc_current"], opt["desc_chosen"] = desc(cur), desc(chosen)
    if opt.get("free"):
        opt["free"]["desc"] = desc(opt["free"]["p"])
    # Wie viel in der Strategie, damit der größte Rückgang höchstens 35 % beträgt (Rest Reserve, täglich ausgeglichen)
    exposure = []
    for e in (1.0, 0.9, 0.8, 0.75, 0.7, 0.6, 0.5):
        nav = [1.0]
        for k in range(1, len(opt_nav)):
            nav.append(nav[-1] * (1 + e * (opt_nav[k] / opt_nav[k - 1] - 1)))
        st_e = stats(nav, [days[months[0]]] + d_days)
        exposure.append({"share": int(e * 100), "cagr": st_e["cagr"], "dd": st_e["dd"]})
    opt["exposure"] = exposure

    # ------------------------------------------------- Plan-Titel: Punkte je Monat und Signale mit Ergebnis
    titles = []
    for sym in plan_syms:
        if sym not in stocks:
            continue
        strip = []
        for i in months:
            f = fits.get((sym, i))
            strip.append([days[i], max(1, min(10, int(f[0] / 10 + 0.5))) if f else None, state[sym][i]])
        evs = []
        for typ, i in timeline[sym]:
            r6, r12 = fwd(stocks[sym].p, i, 126), fwd(stocks[sym].p, i, 252)
            e6 = fwd(ew, i, 126)
            evs.append({"day": iso[i], "type": typ, "r6": round(r6 * 100, 1) if r6 is not None else None,
                        "r12": round(r12 * 100, 1) if r12 is not None else None,
                        "ex6": round((r6 - e6) * 100, 1) if r6 is not None and e6 is not None else None})
        titles.append({"sym": sym, "strip": strip, "events": evs})
    out = {"updated": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z", "limit": limit,
            "period": {"start": iso[months[0]], "end": iso[months[-1]], "train_end": TRAIN_END},
            "universe": len(stocks), "sec": len(sec), "signals": sig, "market": market, "market_any": market_any,
            "buckets": bucket_out, "groups": groups, "strategies": strategies, "opt": opt, "titles": titles,
            "fg_now": fg[-1]}
    out["findings"] = findings(out)
    return out


def _p(x, d=0):
    """Prozent mit Vorzeichen und Komma, wie in der App."""
    if x is None:
        return "–"
    s = ("%." + str(d) + "f") % abs(x)
    return ("+" if x > 0 else "−" if x < 0 else "") + s.replace(".", ",") + " %"


def _n(x, d=1):
    """Prozent ohne Vorzeichen."""
    return "–" if x is None else (("%." + str(d) + "f") % abs(x)).replace(".", ",") + " %"


def _e(x):
    return "{:,.0f} €".format(x).replace(",", ".")


def findings(b):
    """Die wichtigsten Ergebnisse in einfachen Sätzen (für die Karte in der App)."""
    S = {x["id"]: x for x in b["strategies"]}
    sig = {x["id"]: x["h"] for x in b["signals"]}
    mk = {x["id"]: x for x in b["market"]}
    anyd = b["market_any"]["avg"]
    o, out = b["opt"], []
    yr = b["period"]["start"][:4]
    if "now" in S and "sp" in S:
        out.append(("Sparplan", "1.000 € im Monat seit %s (%s eingezahlt): Deine heutigen Regeln %s, optimiert %s, alle Titel der Auswahl %s, "
                    "Halbleiter-ETF %s, S&P 500 %s. Die hohen Werte kommen vor allem daher, dass die Auswahl die Gewinner von heute enthält. "
                    "Aussagekräftig ist der Vergleich mit allen Titeln der Auswahl. Ohne Steuern, Kosten 0,1 %% je Umschichtung." % (
                        yr, _e(S["now"]["save"][1]), _e(S["now"]["save"][0]), _e(S["opt"]["save"][0]), _e(S["ew"]["save"][0]),
                        _e(S["soxx"]["save"][0]) if "soxx" in S else "–", _e(S["sp"]["save"][0]))))
    lim = b.get("limit") or 35
    ok = next((x for x in o.get("exposure") or [] if x["dd"] >= -lim), None)
    full = (o.get("exposure") or [{}])[0]
    out.append(("Rückgang", "Größter Rückgang deiner Regeln %s, optimiert %s, S&P 500 %s. Deine Grenze: −%d %%.%s" % (
        _p(S["now"]["all"]["dd"]), _p(S["opt"]["all"]["dd"]), _p(S["sp"]["all"]["dd"]), lim,
        " Voll investiert blieben die optimierten Regeln darin, bei %s pro Jahr." % _p(full.get("cagr")) if ok and ok["share"] == 100 else
        " Mit %d %% in der Strategie und %d %% Reserve wären es %s gewesen, bei %s pro Jahr." % (ok["share"], 100 - ok["share"], _p(ok["dd"]), _p(ok["cagr"])) if ok else "")))
    m, d_up, d_dn, tb = sig["mom_on"].get("126") or {}, sig["dip_up"].get("126") or {}, sig["dip_down"].get("126") or {}, sig["trend_break"].get("252") or {}
    base6, base12 = sig["any"].get("126") or {}, sig["any"].get("252") or {}
    out.append(("Signale je Titel", "Geht das Momentum-Signal an, lief der Titel danach etwa so wie nach einem beliebigen Tag "
                "(6 Monate %s gegenüber der Auswahl, beliebiger Tag %s). Rücksetzer über der 200-Tage-Linie waren der beste Einstieg (%s), "
                "unter der Linie %s. Nach einem Trendbruch lag ein Titel 12 Monate später %s hinter der Auswahl (beliebiger Tag %s)." % (
                    _p(m.get("ex_ew"), 1), _p(base6.get("ex_ew"), 1), _p(d_up.get("ex_ew"), 1), _p(d_dn.get("ex_ew"), 1),
                    _n(tb.get("ex_ew")), _n(base12.get("ex_ew")))))
    f25, fs, c30 = mk.get("fear25"), mk.get("fear_semis"), mk.get("semis30")
    if f25 and fs and c30:
        out.append(("Angst und Crash", "Angst unter 25 allein war kein besserer Einstieg: S&P 500 12 Monate danach %s, an einem beliebigen Tag %s. "
                    "Zusammen mit Halbleitern 20 %% unter dem Hoch stieg die Auswahl danach um %s statt %s. Halbleiter 30 %% unter dem Hoch: "
                    "Halbleiter-ETF 12 Monate später %s statt %s (%d Fälle, wenige)." % (
                        _p(f25["avg"]["sp"]["252"]), _p(anyd["sp"]["252"]), _p(fs["avg"]["ew"]["252"]), _p(anyd["ew"]["252"]),
                        _p(c30["avg"]["soxx"]["252"]), _p(anyd["soxx"]["252"]), len(c30["events"]))))
    g = {x["id"]: x["h"].get("252") or {} for x in b["groups"]}
    sc = {x["id"]: x for x in o.get("schemes") or []}
    if g and sc:
        out.append(("Punkte", "Titel mit 8 bis 10 Punkten (nachgerechnet, ohne Schätzungen) lagen 12 Monate später im Schnitt %s gegenüber der Auswahl, "
                    "Titel mit 1 bis 5 Punkten %s. Die Punkte trennten also kaum. Am treffsichersten war die reine Kursstärke: bestes gegen schwächstes Fünftel %s in 12 Monaten "
                    "(heutige Gewichte %s)." % (_p(g["8-10"].get("ex_ew"), 1), _p(g["1-5"].get("ex_ew"), 1),
                                                _p(sc["kurs"]["spread"]["test252"]), _p(sc["heute"]["spread"]["test252"]))))
    ch, cu = o["chosen"], o["current"]
    out.append(("Optimiert", "Aus %s Varianten, gewählt mit den Jahren bis Oktober %s und geprüft mit den Jahren danach: %s. Bis %s %s pro Jahr statt %s, danach %s statt %s; "
                "größter Rückgang danach %s statt %s." % (
                    "{:,}".format(o["n"]).replace(",", "."), o["train_end"][:4], o["desc_chosen"], o["train_end"][:4], _p(ch["train"]["cagr"]), _p(cu["train"]["cagr"]),
                    _p(ch["test"]["cagr"]), _p(cu["test"]["cagr"]), _p(ch["test"]["dd"]), _p(cu["test"]["dd"]))))
    return [{"t": t, "x": x} for t, x in out]


def main(repo=None):
    from .common import asset_key, get_store, log
    if repo:
        from . import abo
        store = abo.connect(repo)
    else:
        store = get_store()
    pf = store.get("portfolio.json") or {}
    prof = pf.get("profile") or {}
    plan = [str(x.get("symbol") or "").upper() for x in (prof.get("plan") or {}).get("items") or []]
    t = time.time()
    out = run(prof.get("answers") or {}, plan)
    store.put("backtest.json", out)
    log("Backtest: %d Titel, %d Varianten, %.0f s" % (out["universe"], out["opt"]["n"], time.time() - t))


def _universe():
    from . import screen
    return sorted(screen.THEME_OF)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "sec":
        sec_fetch(_universe())
    else:
        main(sys.argv[2] if len(sys.argv) > 2 else None)
