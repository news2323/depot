"""Strategie (Jakobs Wunsch vom 22.11.2026): Filter für Aktien, die zu seinem Profil passen könnten, und Hinweise aufs Handy.

Das Profil steht in portfolio.json → profile (answers). Der Filter läuft im Tageslauf über eine feste Auswahl von
Titeln aus dem KI- und Halbleiterumfeld plus alle beobachteten Aktien. Je Titel entstehen Bausteine von 0 bis 1, daraus die
„Passung für dich“ (0 bis 100). Die App rechnet die Passung mit denselben Gewichten nach (web/app.js fitOf), damit
Antworten im Profil sofort wirken: beide Stellen ändern.

Faustregel, keine Anlageberatung. Im öffentlichen Protokoll stehen keine Ticker, nur Zahlen.
"""
import datetime
import re

from . import analytics, sources
from .common import asset_key, log, now_iso

# Thema, Gewicht für den Schwerpunkt „KI und Halbleiter“, Titel. Bewusst nur große, gehandelte Firmen.
UNIVERSE = (
    ("Rechenchips", 1.0, ("NVDA", "AMD", "AVGO", "MRVL", "ARM", "QCOM")),
    ("Speicher", 1.0, ("MU", "000660.KS", "005930.KS", "SNDK", "WDC", "STX")),
    ("Chipfertigung", 1.0, ("TSM", "INTC")),
    ("Chip-Ausrüstung", 0.9, ("ASML", "AMAT", "LRCX", "KLAC", "TER")),
    ("Netzwerk und Optik", 0.9, ("ANET", "CRDO", "ALAB", "COHR", "CIEN", "LITE")),
    ("Server und Rechenzentren", 0.8, ("DELL", "SMCI", "VRT", "ETN")),
    ("KI-Rechenzentren", 0.7, ("CRWV", "NBIS")),
    ("Cloud und KI-Plattformen", 0.8, ("GOOGL", "MSFT", "AMZN", "META", "ORCL")),
    ("Strom für KI", 0.6, ("GEV", "CEG", "VST")),
    ("KI-Software", 0.6, ("PLTR", "NOW", "CRWD", "SNOW", "DDOG")),
)
THEME_OF = {sym: (name, w) for name, w, syms in UNIVERSE for sym in syms}
# Thema für beobachtete Titel außerhalb der Auswahl, nach Yahoo-Branche
INDUSTRY_THEME = (("Semiconductor Equipment", "Chip-Ausrüstung", 0.9), ("Semiconductors", "Halbleiter", 1.0),
                  ("Software", "Software", 0.5), ("Internet Content", "Internet", 0.5), ("Communication Equipment", "Netzwerk", 0.6),
                  ("Computer Hardware", "Hardware", 0.6), ("Information Technology Services", "IT-Dienste", 0.4))
USD_PER = {"USD": 1.0, "EUR": 1.08, "KRW": 1 / 1400.0, "TWD": 1 / 32.0, "JPY": 1 / 150.0, "GBP": 1.27, "HKD": 0.128, "CHF": 1.12}

# Faktoren (Jakobs Vorgabe vom 22.11.2026): Hauptfaktoren Momentum (Kurs und Gewinnschätzungen), Wachstum (beschleunigtes
# zählt extra) und Qualität; dazu relative Stärke innerhalb von KI und Halbleitern; Bewertung nur als Sicherheitsnetz.
# Gewichte je Vorrang (Frage „priority“). Dieselben Zahlen in web/app.js (FIT_W).
# „ev“: Erwartungswert und Chance zu Risiko aus der Spanne der Analystenziele (das Brauchbare aus dem Denken von
# Sam Bankman-Fried; seine Fehler stehen als Leitplanken im Regel-Check der App).
WEIGHTS = {
    "upside": {"momentum": .23, "revisions": .21, "growth": .21, "quality": .14, "rs": .09, "value": .06, "ev": .06},
    "rr":     {"momentum": .17, "revisions": .17, "growth": .15, "quality": .19, "rs": .07, "value": .17, "ev": .08},
    "safe":   {"momentum": .11, "revisions": .15, "growth": .09, "quality": .28, "rs": .04, "value": .25, "ev": .08},
}


# Rangfolge „Kursstärke zuerst“ (Frage „rank“, aus dem Backtest vom 22.11.2026: im KI-Umfeld traf die Kursstärke
# in beiden Hälften der 10 Jahre besser als die heutigen Gewichte). Wachstum und Marge wirken dann nur als Filter.
# Dieselben Zahlen in web/app.js (PRICE_W).
PRICE_W = {"momentum": .45, "rs": .20, "revisions": .25, "value": .05, "ev": .05, "growth": 0.0, "quality": 0.0}

# Kaufstil (Frage „style“, Jakobs Wunsch vom 22.11.2026: weg vom Kauf in fallende Kurse, hin zu Momentum):
# Zu- und Abschlag je Zustand des Momentum-Signals. Dieselben Zahlen in web/app.js (STYLE_MULT).
STYLE_MULT = {
    "first": {"on": 1.06, "down": 0.9},
    "only":  {"on": 1.08, "fade": 0.9, "none": 0.85, "down": 0.75},
}


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def _lin(v, a, b):
    """v linear von a (0) bis b (1)."""
    return None if v is None else _clamp((v - a) / (b - a))


def answers(pf):
    return ((pf.get("profile") or {}).get("answers") or {})


def universe_assets():
    return {asset_key("stock", s): {"kind": "stock", "symbol": s, "name": ""} for s in THEME_OF}


def fetch(tracked, yf, market_6m):
    """Kurse und Kennzahlen für die Titel der Auswahl, die nicht ohnehin verfolgt werden (2 Jahre Verlauf reichen)."""
    out = {}
    for key, a in universe_assets().items():
        if key in tracked:
            continue
        h = sources.stock_history(a["symbol"], "2y")
        if not h or len(h["c"]) < 60:
            continue
        tech = analytics.technicals(h["c"], False)
        own = (h["c"][-1] / h["c"][-127] - 1) * 100 if len(h["c"]) > 127 and h["c"][-127] else None
        if tech and own is not None and market_6m.get("stock") is not None:
            tech["rel_6m"] = own - market_6m["stock"]
        fund = yf.get(a["symbol"]) or {}
        div = analytics.dividend_info(h["div"], h["c"][-1], fund)
        out[key] = {"hist": {"d": h["d"], "c": h["c"]}, "currency": h["currency"], "name": h.get("name") or "", "tech": tech,
                    "fund": fund, "div": div, "valuation": analytics.stock_valuation(h["c"][-1], tech, fund, div)}
    log("Strategie: %d zusätzliche Titel geladen" % len(out))
    return out


def theme_of(sym, fund):
    if sym in THEME_OF:
        return THEME_OF[sym]
    ind = (fund or {}).get("industry") or ""
    for part, name, w in INDUSTRY_THEME:
        if part in ind:
            return name, w
    return ((fund or {}).get("sector") or "Sonstiges"), 0.15


def _ret(c, back, skip=0):
    """Rendite in % von vor `back` bis vor `skip` Handelstagen."""
    if len(c) <= back or not c[-1 - back]:
        return None
    return (c[-1 - skip] / c[-1 - back] - 1) * 100


def _mean(xs, default):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else default


def parts(sym, e, sp):
    """Bausteine 0 bis 1 und Merkmale für einen Titel (Eintrag aus daily.json bzw. fetch). sp = Tageskurse des S&P 500."""
    f, t, v = e.get("fund") or {}, e.get("tech") or {}, e.get("valuation") or {}
    hist = (e.get("hist") or {}).get("c") or []
    price = hist[-1] if hist else None
    theme, tw = theme_of(sym, f)
    # Momentum: 12 Monate ohne den letzten Monat (klassisch) und 6 Monate, jeweils gegen den S&P 500
    m12, m6 = _ret(hist, 252, 21), _ret(hist, 126)
    s12, s6 = _ret(sp, 252, 21), _ret(sp, 126)
    r12 = m12 - s12 if m12 is not None and s12 is not None else None
    r6 = m6 - s6 if m6 is not None and s6 is not None else None
    momentum = _mean([_lin(r12, -30, 50), _lin(r6, -20, 35)], 0.4)
    # Gewinn-Momentum: Änderung der Schätzungen, Verhältnis von Anhebungen zu Senkungen, Überraschungen bei den Zahlen
    est = f.get("est_chg_90d")
    up30, dn30 = f.get("est_up_30d") or 0, f.get("est_down_30d") or 0
    breadth = (up30 - dn30) / (up30 + dn30) if up30 + dn30 else None
    revisions = _mean([_lin(est, -15, 15), (breadth + 1) / 2 if breadth is not None else None, _lin(f.get("surprise_avg"), -10, 15)], 0.45)
    # Wachstum: heute und erwartet; beschleunigt es sich, gibt es einen Zuschlag
    rev = f.get("revenue_growth")
    eps_g, rg1, rg0 = f.get("est_g_1y"), f.get("rev_g_1y"), f.get("rev_g_0y")
    growth = _mean([_lin(rev * 100 if rev is not None else None, 0, 50), _lin(eps_g, 0, 60), _lin(rg1, 0, 40)], 0.4)
    accel = None
    if rg1 is not None and rg0 is not None and rg0 > 0:
        accel = "schneller" if rg1 >= rg0 * 0.9 else "langsamer" if rg1 < rg0 * 0.5 else "etwas langsamer"
        growth = _clamp(growth + (0.15 if accel == "schneller" else -0.1 if accel == "langsamer" else 0))
    # Qualität: Marge, Kapitalrendite, freier Geldfluss, Verschuldung
    opm, roe, de = f.get("op_margin"), f.get("roe"), f.get("debt_equity")
    fcf_m = None
    if f.get("fcf") is not None and f.get("market_cap") and f.get("fin_currency", "x") == f.get("quote_currency", "x"):
        fcf_m = f["fcf"] / f["market_cap"] * 100
    quality = _mean([_lin(opm, 0, 0.35), _lin(roe, 0, 0.3), _lin(fcf_m, -1, 5), 1 - _lin(de, 50, 200) if de is not None else None], 0.4)
    if opm is not None and opm < 0:
        quality = min(quality, 0.15)
    # Bewertung als Sicherheitsnetz: Punkte, eingepreistes Wachstum, Analystenziel
    vis = v.get("vision") or {}
    up = (f["target_mean"] / price - 1) * 100 if f.get("target_mean") and price else None
    rating = v.get("rating")
    value = _mean([(rating - 1) / 9.0 if rating else None, _lin(vis.get("diff"), -15, 15), _lin(up, -10, 50)], 0.5)
    # Erwartungswert: schwaches (tiefstes Ziel), mittleres und starkes Szenario (höchstes Ziel) mit 25/50/25 %
    th, tl = f.get("target_high"), f.get("target_low")
    ev_ret = asym = None
    if th and tl and f.get("target_mean") and price:
        ev_ret = (0.25 * (tl / price - 1) + 0.5 * (f["target_mean"] / price - 1) + 0.25 * (th / price - 1)) * 100
        asym = max(0.0, th / price - 1) / max(0.05, 1 - tl / price)
    ev = _mean([_lin(ev_ret, -5, 40), _lin(asym, 0.5, 4)], 0.45)
    pricey = (vis.get("diff") is not None and vis["diff"] <= -15) or (f.get("forward_pe") or 0) > 60
    cut = est is not None and est <= -10
    cap = f.get("market_cap")
    cap_usd = cap * USD_PER.get(f.get("quote_currency") or e.get("currency") or "USD", 1.0) if cap else None
    spec = (cap_usd is not None and cap_usd < 10e9) or (opm is not None and opm < 0) or (f.get("eps") is not None and f["eps"] < 0)
    defensive = rev is not None and rev < 0.08 and tw < 0.9 and (t.get("vol") or 30) < 35
    chg5 = _ret(hist, 5)
    mom = e.get("mom") or analytics.momentum(hist, sp)      # Signal: Trend, Jahreshoch, stärker als der S&P 500
    c = {"theme": tw, "momentum": momentum, "revisions": revisions, "growth": growth, "quality": quality, "value": value, "rs": 0.5, "ev": ev}
    return {"theme": theme, "c": {k: round(x, 3) for k, x in c.items()},
            "flags": {"spec": bool(spec), "def": bool(defensive), "cut": bool(cut), "us": "." not in sym, "pricey": bool(pricey)},
            "price": price, "currency": e.get("currency"), "chg5": round(chg5, 2) if chg5 is not None else None,
            "m6": round(m6, 1) if m6 is not None else None, "m12": round(m12, 1) if m12 is not None else None,
            "r6": round(r6, 1) if r6 is not None else None, "r12": round(r12, 1) if r12 is not None else None,
            "from_high": t.get("from_high"), "est90": round(est, 1) if est is not None else None, "breadth": [up30, dn30],
            "surprise": f.get("surprise_avg"), "beats": [f.get("beats"), f.get("beats_n")] if f.get("beats_n") else None,
            "rating": rating, "upside": round(up, 1) if up is not None else None,
            "ev": round(ev_ret, 1) if ev_ret is not None else None, "asym": round(asym, 1) if asym is not None else None,
            "down": round((tl / price - 1) * 100, 1) if tl and price else None, "cap_usd": cap_usd, "vol": t.get("vol"),
            "implied": vis.get("implied"), "expected": vis.get("expected"), "plan_ok": (vis.get("plan") or {}).get("realistic"),
            "earnings": e.get("earnings_date"), "rev_g": round(rev * 100, 1) if rev is not None else None, "eps_g": eps_g,
            "rev_g1": rg1, "accel": accel, "op_margin": opm, "roe": roe, "fpe": f.get("forward_pe"),
            "mom": mom, "c30": [round(x, 4) for x in hist[-30:]]}


def rel_strength(rows):
    """Relative Stärke innerhalb von KI und Halbleitern: Rang der 6-Monats-Rendite unter den Titeln des Themas (0 bis 1)."""
    peers = sorted(r["m6"] for r in rows if r["c"]["theme"] >= 0.6 and r.get("m6") is not None)
    if len(peers) < 5:
        return
    for r in rows:
        if r.get("m6") is not None:
            r["c"]["rs"] = round(sum(1 for x in peers if x < r["m6"]) / float(len(peers)), 3)


def fit(row, ans):
    """Passung für dich, 0 bis 100 (None = passt nach deinen Antworten nicht). Gleiche Rechnung in web/app.js (fitOf)."""
    w = PRICE_W if ans.get("rank") == "price" else WEIGHTS.get(ans.get("priority") or "upside", WEIGHTS["upside"])
    c, fl = row["c"], row["flags"]
    if ans.get("region") == "usa" and not fl["us"]:
        return None
    if fl["spec"] and ans.get("spec") == "nein":
        return None
    x = sum(c[k] * w[k] for k in w) * 100
    if ans.get("rank") == "price" and ((row.get("rev_g") is not None and row["rev_g"] < 0) or (row.get("op_margin") is not None and row["op_margin"] < 0)):
        x *= 0.7                                  # Wachstum und Marge als Filter: schrumpfender Umsatz oder Verlust
    theme = c["theme"] if (ans.get("themes") or "ai") == "ai" else max(c["theme"], 0.7) if ans.get("themes") == "tech" else 1.0
    x *= 0.55 + 0.45 * theme                      # Schwerpunkt KI und Halbleiter
    if c["quality"] < 0.3:
        x *= 0.85                                 # Qualität als Filter
    if fl["pricey"]:
        x *= 0.85                                 # Sicherheitsnetz: extrem teuer
    if fl["spec"] and ans.get("spec") != "ja":
        x *= 0.85
    if fl["def"] and (ans.get("defensive") or "reduce") == "reduce":
        x *= 0.8
    if fl["cut"]:
        x = min(x, 45)
    if (ans.get("horizon") or "lt2") == "lt2" and (row.get("vol") or 0) > 70:
        x *= 0.9
    x *= STYLE_MULT.get(ans.get("style"), {}).get((row.get("mom") or {}).get("state"), 1.0)
    return int(round(min(100, x)))


def semis_stats(h=None):
    """Halbleiter-ETF (SOXX) über 5 Jahre: größter Rückgang, wie lange die Erholung dauerte, Abstand zum Hoch heute.
    h = Verlauf (d, c), sonst wird er geholt."""
    h = h or sources.stock_history("SOXX", "5y")
    if not h or len(h["c"]) < 250:
        return None
    d, c = h["d"], h["c"]
    peak_i, best = 0, (0.0, 0, 0)
    for i, x in enumerate(c):
        if x > c[peak_i]:
            peak_i = i
        dd = x / c[peak_i] - 1
        if dd < best[0]:
            best = (dd, peak_i, i)
    dd, pi, ti = best
    rec = next((j for j in range(ti, len(c)) if c[j] >= c[pi]), None)
    hi = max(c)
    return {"dd": round(dd * 100, 1), "peak": d[pi], "trough": d[ti], "recovered": d[rec] if rec is not None else None,
            "months_down": round((d[ti] - d[pi]) / 30.4, 1), "months_back": round((d[rec] - d[ti]) / 30.4, 1) if rec is not None else None,
            "from_high": round((c[-1] / hi - 1) * 100, 1),
            "above200": c[-1] >= sum(c[-200:]) / 200.0,      # Marktfilter (Frage „regime“): unter der Linie halb Reserve
            "ma200": round((c[-1] / (sum(c[-200:]) / 200.0) - 1) * 100, 1)}


STRAT_DEP = "jakob"     # Strategie nur für das Teildepot Jakob (Jakobs Wunsch vom 22.11.2026), nicht Hauptdepot oder Fenja


def _held(pf):
    """Gehaltene Titel im Depot Jakob. Eine Buchung mit `alias` (z. B. Hinterlegungsschein) zählt als die Aktie mit diesem
    Kürzel, mit der die Strategie rechnet (Jakobs Wunsch vom 24.11.2026; gleiche Regel in web/app.js stratKey)."""
    qty = {}
    for t in pf.get("transactions") or []:
        if (t.get("depot") or "main") != STRAT_DEP:
            continue
        k = asset_key(t.get("kind"), str(t.get("alias") or t.get("symbol") or "").upper())
        q = float(t.get("qty") or 0)
        if t.get("type") in ("buy", "sell"):
            qty[k] = qty.get(k, 0) + (q if t["type"] == "buy" else -q)
    return {k for k, q in qty.items() if q > 1e-9}


FEAR = 25   # Angst und Gier unter 25: extreme Angst (wie bei CNN und alternative.me)


def events(rows, prev, pf, ans, others=None, fg=None, ideal_keys=()):
    """Neue Hinweise gegenüber dem letzten Lauf. Jeder Hinweis höchstens einmal in 7 Tagen."""
    today = datetime.date.today()
    held = _held(pf)
    watch = {asset_key(w.get("kind") or "stock", str(w.get("symbol") or "").upper()) for w in pf.get("watchlist") or []}
    tmin = {"ai": 0.6, "tech": 0.4, "none": 0.0}.get(ans.get("themes") or "ai", 0.6)
    style = ans.get("style") or "dip"
    plan = set(ideal_keys)      # Titel des Ideal-Depots Jakob
    old = {r["key"]: r for r in ((prev or {}).get("list") or []) + ((prev or {}).get("other") or [])}
    seen = {(e["type"], e["key"]): e["day"] for e in (prev or {}).get("events") or []}
    top = [r for r in rows if r.get("fit") is not None and r["key"] not in held]
    top = {r["key"] for r in sorted(top, key=lambda r: -r["fit"])[:10]}
    new, first = [], not (prev or {}).get("list")   # beim ersten Lauf ist alles „neu“: dann nur Rücksetzer und gesenkte Schätzungen

    def add(r, typ, text, important):
        if first and typ in ("neu", "up"):
            return
        last = seen.get((typ, r["key"]))
        if last and (today - datetime.date.fromisoformat(last)).days < 7:
            return
        new.append({"day": today.isoformat(), "type": typ, "key": r["key"], "symbol": r["symbol"], "text": text, "important": important})

    for r in rows:
        o, mine = old.get(r["key"]), r["key"] in held or r["key"] in plan
        if r["key"] in top and r["fit"] >= 70 and (not o or (o.get("fit") or 0) < 65):
            add(r, "neu", "passt jetzt gut zu deinem Profil (%d von 100)" % r["fit"], r["fit"] >= 75)
        if (mine or r["key"] in top) and r.get("chg5") is not None and r["chg5"] <= -8 and not r["flags"]["cut"] and (r.get("est90") is None or r["est90"] > -2):
            ms = (r.get("mom") or {}).get("state")
            trend = "" if style == "dip" or not ms else ", Aufwärtstrend hält (über der 200-Tage-Linie)" if ms != "down" else \
                ", aber unter der 200-Tage-Linie: nach deiner Momentum-Regel erst bei neuem Signal"
            add(r, "dip", "−%.0f %% in 5 Tagen, Gewinnschätzungen halten%s%s" % (-r["chg5"], trend, " (Ideal-Depot)" if r["key"] in plan else ""), mine)
        if mine and r.get("est90") is not None and r["est90"] <= -5 and (not o or o.get("est90") is None or o["est90"] > -5):
            add(r, "cut", "Gewinnschätzung in 90 Tagen um %.0f %% gesenkt: These prüfen" % -r["est90"], True)
        if (mine or r["key"] in top) and r.get("est90") is not None and r["est90"] >= 10 and (not o or o.get("est90") is None or o["est90"] < 10):
            add(r, "up", "Gewinnschätzung in 90 Tagen um %.0f %% angehoben" % r["est90"], False)
    # Momentum-Signal: geht an (frisch, höchstens 5 Handelstage) oder bricht (unter die 200-Tage-Linie)
    for r in rows + (others or []):
        m, o = r.get("mom") or {}, old.get(r["key"]) or {}
        om = o.get("mom") or {}
        stock = "c" in r       # Watchlist nur im Schwerpunkt (KI-Umfeld), wie das Ideal-Depot
        mine = r["key"] in held or r["key"] in plan or (r["key"] in watch and stock and r["c"]["theme"] >= tmin)
        if m.get("state") == "on" and m.get("since", 99) <= 5 and om.get("state") != "on" and (mine or r["key"] in top) \
                and not (r.get("flags") or {}).get("cut"):
            est = r.get("est90")
            add(r, "mom", "Momentum-Signal an: über 50- und 200-Tage-Linie, %s unter dem Jahreshoch, %s%s" % (
                ("%.0f %%" % -m["from_high"]) if m.get("from_high") else "am Hoch",
                "stärker als der Markt" if m.get("bench") else "Kurs im Plus",
                (", Schätzungen steigen" if est is not None and est >= 3 else "") + (" (Ideal-Depot)" if r["key"] in plan else "")), mine)
        if mine and m.get("state") == "down" and om.get("state") in ("on", "fade", "none") and (stock or o):
            add(r, "momoff", "Trend gebrochen: Kurs unter der 200-Tage-Linie%s" % (
                ", nach deiner Momentum-Regel nicht nachkaufen" if style in ("first", "only") else ""), r["key"] in held)
    # Extreme Angst (Jakobs Wunsch vom 22.11.2026: dann kaufen): Hinweis, sobald der Index unter 25 fällt
    was = (prev or {}).get("fg") or {}
    for name, label in (("stocks", "Aktienmarkt"), ("crypto", "Krypto")):
        v = (fg or {}).get(name)
        if v is None or v >= FEAR or (was.get(name) is not None and was[name] < FEAR):
            continue
        if name == "crypto" and ans.get("crypto") != "part":
            continue
        rule = ans.get("fear") == "buy"
        add({"key": "fg:" + name, "symbol": label}, "fear", "extreme Angst (%d von 100)%s" % (
            v, ": nach deiner Regel ein Kaufzeitpunkt, in Teilen und nur Titel mit intakten Gewinnschätzungen" if rule else ""), rule)
    return new


# ----------------------------------------------------------------- Ideal-Depot Jakob und Wort je Titel
# Gleiche Rechnung wie idealBook und ruleOf in web/app.js: beide Stellen ändern. Hier nur für die Hinweise aufs Handy
# (die App rechnet mit den aktuellen Antworten und Beträgen selbst).
SHARE_BY_DD = {15: 30, 25: 50, 35: 75, 50: 100}
FEAR_LIMIT = 25


def exception(ans, semis, fg):
    """Ausnahme von „Momentum zuerst“: extreme Angst am Aktienmarkt (Frage fear) oder Halbleiter 20 % unter dem Hoch (Frage crash)."""
    v, dd = (fg or {}).get("stocks"), (semis or {}).get("from_high")
    fear = ans.get("fear") == "buy" and v is not None and v < FEAR_LIMIT
    crash = (ans.get("crash") or ans.get("on_loss")) == "buy" and dd is not None and dd <= -20
    return fear or crash


# Toleranz (Jakobs Wunsch vom 23.11.2026: nur wechseln, wenn ein Unterschied da ist). Ein Titel im Ideal-Depot wird erst
# ersetzt, wenn ein anderer mindestens KEEP_MARGIN von 100 Punkten besser passt (Jakobs Vorgabe: 2 Punkte). Mit Signal
# aufgenommen bleibt er vorn, solange das Signal nur nachlässt (fade) und der Kurs über der 200-Tage-Linie liegt.
# Gleiche Regel in web/app.js (idealBook).
KEEP_MARGIN = 2


def ideal(rows, pf, ans, semis, fg, prev=()):
    lo_hi = [int(x) for x in str(ans.get("positions") or "6-8").split("-")]
    N = int(round(sum(lo_hi) / float(len(lo_hi))))
    minp = float(ans.get("min_pos") or 500)
    ex = exception(ans, semis, fg)
    filt = ans.get("regime") == "half" and (semis or {}).get("above200") is False and not ex
    share = SHARE_BY_DD.get(int(ans.get("max_dd") or 35), 75) / 100.0 * (0.5 if filt else 1.0)
    base = float(ans.get("capital") or 5000)      # Startbetrag Depot Jakob (Frage capital)
    n = max(1, min(N, int(base * share // minp)))
    tmin = {"ai": 0.6, "tech": 0.4, "none": 0.0}.get(ans.get("themes") or "ai", 0.6)
    held = _held(pf)
    allr = [r for r in rows if r.get("fit") is not None]
    rank = {r["key"]: i for i, r in enumerate(sorted(allr, key=lambda r: -r["fit"]))}
    ok = [r for r in allr if r["c"]["theme"] >= tmin and not r["flags"]["cut"] and not (r.get("est90") is not None and r["est90"] <= -5)]
    st = lambda r: (r.get("mom") or {}).get("state")
    sell = ans.get("sell") or "better"
    was = {x["key"]: x.get("via") for x in prev or [] if x.get("key")}
    order = lambda r: (-(r["fit"] + (KEEP_MARGIN if r["key"] in was else 0)), r["key"] in was)   # gleich: der Bessere wechselt ein

    def keep(r):
        return {"signal": st(r) == "on", "trend": st(r) != "down", "better": rank[r["key"]] < 2 * N}.get(sell, st(r) != "down")
    pick = []

    def take(r, via):        # keine Grenze je Thema: kostete im Backtest Rendite (22.11.2026)
        if len(pick) >= n or any(p["key"] == r["key"] for p in pick):
            return
        pick.append({"key": r["key"], "via": via})
    for r in sorted([r for r in ok if r["key"] in held and (keep(r) or ex)], key=lambda r: -r["fit"]):
        take(r, "halten")
    for r in sorted([r for r in ok if st(r) == "on" or (was.get(r["key"]) == "signal" and st(r) == "fade")], key=order):
        take(r, "signal")
    if ex:
        for r in sorted([r for r in ok if (r.get("est90") is None or r["est90"] > -2) and not (r.get("rev_g") is not None and r["rev_g"] < 0)],
                        key=lambda r: order(r) + (-(r["c"].get("rs") or 0),)):
            take(r, "ausnahme")
    return {"n": n, "share": round(share, 3), "filt": filt, "ex": ex, "items": pick}


def rule_words(rows, pf, ans, ib):
    """Wort je Aktie für das Depot Jakob: Kaufen, Nachkaufen, Halten, Verkaufen, Warten (wie ruleOf in der App, ohne Beträge)."""
    held, inid = _held(pf), {x["key"] for x in ib["items"]}
    sell, out = ans.get("sell") or "better", {}
    for r in rows:
        k = r["key"]
        if k not in held and k not in inid:
            continue
        st = (r.get("mom") or {}).get("state")
        cut = r["flags"]["cut"] or (r.get("est90") is not None and r["est90"] <= -10)
        dip = r.get("chg5") is not None and r["chg5"] <= -8 and st and st != "down" and not (r.get("est90") is not None and r["est90"] < -2)
        if cut:
            w = "Verkaufen" if k in held else "Warten"
        elif k in held:
            if k in inid:
                w = "Nachkaufen" if dip else "Halten"
            elif ib["ex"]:
                w = "Halten"
            else:
                w = "Verkaufen" if sell in ("signal", "trend", "better") else "Halten"
        else:
            w = "Kaufen" if k in inid else "Warten"
        out[k] = w
    return out


def _last_weekday_of_month(d):
    nxt = (d.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
    last = nxt - datetime.timedelta(days=1)
    while last.weekday() >= 5:
        last -= datetime.timedelta(days=1)
    return last


def build(store, pf, out, extra, push, sp, fg=None, semis=None, mfg=None):
    """screen.json schreiben und neue Hinweise aufs Handy schicken. sp = Tageskurse des S&P 500,
    fg = Angst und Gier heute ({"stocks": 0..100, "crypto": 0..100}), semis = semis_stats, mfg = Angst und Gier am
    Aktienmarkt mit Bausteinen (für die App, wenn neuer als daily.json)."""
    ans = answers(pf)
    sp = sp or []
    prev = store.get("screen.json") or {}
    rows = []
    for key, e in list(out.items()) + list(extra.items()):
        kind, sym = key.split(":", 1)
        if kind != "stock" or not e.get("fund") or not (e.get("valuation") or {}).get("rating"):
            continue    # ETFs, ETCs und Titel ohne Kennzahlen bleiben draußen
        r = parts(sym, e, sp)
        r.update(key=key, symbol=sym, name=SHORT.get(sym) or e.get("name") or "", universe=sym in THEME_OF)
        rows.append(r)
    done = {r["key"] for r in rows}
    others = [{"key": k, "symbol": k.split(":", 1)[1], "name": e.get("name") or "", "mom": e["mom"]}
              for k, e in out.items() if k not in done and e.get("mom")]
    rel_strength(rows)
    for r in rows:
        r["fit"] = fit(r, ans)
        r["pros"], r["cons"] = reasons(r)
    rows.sort(key=lambda r: -(r["fit"] if r["fit"] is not None else -1))
    semis = semis or semis_stats() or prev.get("semis")
    ib = ideal(rows, pf, ans, semis, fg, (prev.get("ideal") or {}).get("items"))
    new = events(rows, prev, pf, ans, others, fg, [x["key"] for x in ib["items"]])
    words = rule_words(rows, pf, ans, ib)
    new += rule_events(rows, prev, words, ib)
    keep = (datetime.date.today() - datetime.timedelta(days=45)).isoformat()
    evs = (new + [e for e in prev.get("events") or [] if e["day"] >= keep])[:80]
    doc = {"updated": now_iso(), "list": rows, "other": [{"key": o["key"], "mom": o["mom"]} for o in others],
           "events": evs, "semis": semis, "ideal": ib, "rules": words, "fg": {k: v for k, v in (fg or {}).items() if v is not None}}
    if mfg:
        doc["mfg"] = {k: v for k, v in mfg.items() if k != "hist"}
    store.put("screen.json", doc)
    mode = ans.get("push") or "important"
    send = [e for e in new if mode == "all" or (mode == "important" and e["important"])]
    if send:
        names = {r["key"]: SHORT.get(r["symbol"]) or short_name(r["name"]) or r["symbol"] for r in rows + others}
        body = "\n".join("%s: %s" % (names.get(e["key"], e["symbol"]), e["text"]) for e in send[:5])
        push(pf, "Strategie: %d %s" % (len(send), "Hinweis" if len(send) == 1 else "Hinweise"), body + "\nKeine Anlageberatung.")
    log("Strategie: %d Titel bewertet, %d neue Hinweise" % (len(rows), len(new)))


def rule_events(rows, prev, words, ib):
    """Hinweise zum Depot Jakob: ein Titel springt auf Kaufen, Nachkaufen oder Verkaufen; am letzten Handelstag des Monats
    eine Übersicht. Beim ersten Lauf (noch keine Worte gespeichert) nur die Übersicht am Monatsende."""
    today = datetime.date.today()
    old = (prev or {}).get("rules")
    seen = {(e["type"], e["key"]): e["day"] for e in (prev or {}).get("events") or []}
    sym = {r["key"]: r["symbol"] for r in rows}
    out = []

    def add(key, symbol, typ, text):
        last = seen.get((typ, key))
        if last and (today - datetime.date.fromisoformat(last)).days < 7:
            return
        out.append({"day": today.isoformat(), "type": typ, "key": key, "symbol": symbol, "text": text, "important": True})
    why = {"Kaufen": "Kaufen (Depot Jakob%s)" % (", Ausnahme" if ib["ex"] else ", Momentum-Signal"),
           "Nachkaufen": "Nachkaufen (Depot Jakob, Rücksetzer im Aufwärtstrend)", "Verkaufen": "Verkaufen zum Monatsende (Depot Jakob, deine Verkaufsregel)"}
    if old is not None:
        for k, w in words.items():
            if w in why and old.get(k) != w:
                add(k, sym.get(k, k), "rule", "Deine Regel: " + why[w])
    if today == _last_weekday_of_month(today):
        names = lambda w: ", ".join(SHORT.get(sym.get(k, "")) or sym.get(k, k) for k, x in sorted(words.items()) if x == w)
        parts = ["%s: %s" % (w, names(w)) for w in ("Verkaufen", "Kaufen", "Nachkaufen") if names(w)]
        add("depot:jakob", "Depot Jakob", "monat", "Monatsende: " + ("; ".join(parts) if parts else "nichts zu tun, alles halten"))
    return out


SHORT = {"000660.KS": "SK Hynix", "005930.KS": "Samsung", "TSM": "TSMC", "GOOGL": "Google"}


def short_name(name):
    """Firmenname ohne Zusätze, wie man ihn sagt (grob wie shortName in web/app.js)."""
    n = name or ""
    for _ in range(4):
        n = re.sub(r"[,.]?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|Limited|plc|SE|AG|N\.V\.|NV|Holdings?|Holding|Technologies|Technology|Platforms|Group)$", "", n.strip(), flags=re.I)
    return n.strip()


def reasons(r):
    """Was für und was gegen den Titel spricht, in einfachen Worten, nach den Faktoren geordnet."""
    pros, cons = [], []
    c, fl = r["c"], r["flags"]
    side = lambda good, bad: pros if good else cons if bad else []
    if c["theme"] >= 0.9:
        pros.append("Kernthema: " + r["theme"])
    if r.get("r12") is not None or r.get("r6") is not None:
        rr = r["r12"] if r.get("r12") is not None else r["r6"]
        side(rr >= 15, rr <= -15).append("Kursstärke: %+.0f %% gegenüber dem S&P 500 in %s" % (rr, "12 Monaten ohne den letzten" if r.get("r12") is not None else "6 Monaten"))
    m = r.get("mom") or {}
    if m.get("state") == "on":
        pros.insert(0, "Momentum-Signal an%s: Aufwärtstrend, nahe am Jahreshoch, stärker als der S&P 500" % (
            " seit %d Handelstagen" % m["since"] if m.get("since", 0) < 60 else ""))
    elif m.get("state") == "down":
        cons.append("Momentum-Signal aus: Kurs unter der 200-Tage-Linie, %.0f %% unter dem Jahreshoch" % -(m.get("from_high") or 0))
    elif m.get("state") == "fade":
        cons.append("Momentum lässt nach: Kurs unter die 50-Tage-Linie gefallen")
    if c["rs"] >= 0.75:
        pros.append("relativ stark: besser als %.0f %% der KI- und Halbleitertitel in 6 Monaten" % (c["rs"] * 100))
    elif c["rs"] <= 0.25 and r.get("m6") is not None:
        cons.append("relativ schwach: hinter %.0f %% der KI- und Halbleitertitel in 6 Monaten" % ((1 - c["rs"]) * 100))
    if r.get("est90") is not None:
        side(r["est90"] >= 5, r["est90"] <= -5).append("Gewinnschätzung in 90 Tagen %+.0f %%" % r["est90"])
    if r.get("beats") and r.get("surprise") is not None:
        b, n = r["beats"]
        side(b >= n - 1 and r["surprise"] > 3, b <= n / 2.0).append("Erwartungen %d von %d Mal übertroffen, im Schnitt %+.0f %%" % (b, n, r["surprise"]))
    if r.get("rev_g") is not None:
        side(r["rev_g"] >= 20, r["rev_g"] < 5).append("Umsatz %+.0f %% zum Vorjahr" % r["rev_g"]
                                                      + ({"schneller": ", Wachstum beschleunigt sich", "langsamer": ", Wachstum lässt nach"}.get(r.get("accel"), "")))
    if r.get("op_margin") is not None:
        side(r["op_margin"] >= 0.3, r["op_margin"] < 0.05).append("Betriebsmarge %.0f %%" % (r["op_margin"] * 100))
    if r.get("ev") is not None and r.get("asym") is not None:
        ratio = "Kurs unter dem tiefsten Analystenziel" if r.get("down") is not None and r["down"] >= 0 else \
            "Chance zu Risiko %s : 1" % (("%.1f" % r["asym"]).replace(".", ",") if r["asym"] < 10 else "über 10")
        side(r["ev"] >= 20 and r["asym"] >= 2, r["ev"] < 0 or r["asym"] < 0.8).append(
            "Erwartungswert %+.0f %%, %s (Spanne der Analystenziele)" % (r["ev"], ratio))
    if r.get("implied") is not None and r.get("expected") is not None:
        d = r["expected"] - r["implied"]
        side(d >= 3, d <= -10).append("Kurs setzt %+.0f %% Gewinnwachstum pro Jahr voraus, erwartet werden %+.0f %%" % (r["implied"], r["expected"]))
    if r.get("plan_ok") in ("ja", "nein"):
        side(r["plan_ok"] == "ja", True).append("Plan der Firma laut Recherche " + ("realistisch" if r["plan_ok"] == "ja" else "kaum realistisch"))
    if fl["pricey"]:
        cons.append("sehr teuer: Sicherheitsnetz Bewertung greift")
    if fl["spec"]:
        cons.append("spekulativ: klein oder noch ohne Gewinn")
    if fl["def"]:
        cons.append("eher defensiv: wenig Wachstum")
    if (r.get("vol") or 0) > 60:
        cons.append("schwankt stark (%.0f %% pro Jahr)" % r["vol"])
    return pros[:6], cons[:4]
