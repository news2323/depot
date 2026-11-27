"""Strategie Wachstums-Momentum (Jakobs Wunsch vom 27.11.2026; ersetzt die Strategie vom 22.11.2026 mit KI-Auswahl und Passung).

Die Regel stammt aus dem Test bekannter Strategien von Hedgefonds und Wachstums-Investoren (26.11.2026, tracker/backtest.py),
dem Vergleich mit Jakobs Quality-Growth-Vorlage (27.11.2026: übernommen 6 Titel; Filter auf Wachstum, Qualität und Bewertung,
Punkte statt Kursstärke und Kauf erst nach Rücksetzern kosteten viel Rendite) und der Prüfung aller Stellschrauben ohne
Stopp (27.11.2026 abends, Jakobs Wunsch): keine regelmäßige Gleichgewichtung, Obergrenze 30 % je Titel.
- Auswahl (Jakobs Wunsch vom 28.11.2026: weltweit; nach dem Backtest gewählt): die heutigen Mitglieder von S&P 500 und
  Nasdaq-100, dazu die Aktien aus Europa, China und Hongkong im MSCI ACWI (world.py, INCLUDE), TSMC und SK Hynix (PICK) und 18 Länder-ETFs der
  Schwellenländer. Rangfolge in Dollar umgerechnet.
- Relative Stärke wie bei IBD (CAN SLIM): Rendite der letzten 3 Monate zu 40 %, der letzten 6, 9 und 12 Monate zu je 20 %,
  mit Dividenden.
- Aufwärtstrend wie bei Minervini: Kurs über der 200-Tage-Linie, 50-Tage-Linie über der 200-Tage-Linie.
- Zum Monatsende 5 Titel (Jakobs Wahl vom 28.11.2026): Ein gehaltener Titel bleibt, solange er im Aufwärtstrend unter den
  7 stärksten ist (KEEP_EXTRA); freie Plätze bekommen die stärksten, die noch fehlen. Neue Titel bekommen ein gleiches
  Gewicht (Depot ÷ 5), die übrigen laufen weiter (keine regelmäßige Gleichgewichtung).
- Obergrenze je Titel (Frage „maxpos“, Standard 30 %): Liegt ein Titel zum Monatsende darüber, wird der Überschuss verkauft
  und auf die Titel darunter verteilt (enforce_cap).
- Kein Stopp (Jakobs Wunsch vom 27.11.2026). Wahlweise Nachlauf-Stopp 25 % ab Hoch seit Kauf (Frage „stop“): Dann wird ein
  Titel sofort verkauft und der Platz bleibt bis zum Monatsende frei.

Das Ideal-Depot ist ein Modell, das Tag für Tag nach dieser Regel weiterläuft: Käufe zum Monatsende, Stopps an jedem Tag,
Wert in `track`. Beim ersten Lauf wird es mit den Kursen der letzten Monate nachgerechnet. Die Wörter je Titel für das
Depot Jakob (Kaufen, Halten, Verkaufen, Warten) rechnet web/app.js mit Beträgen nach (idealBook, ruleOf): beide Stellen ändern.

Faustregel, keine Anlageberatung. Im öffentlichen Protokoll stehen keine Ticker, nur Zahlen.
"""
import bisect
import concurrent.futures
import datetime
import re
import time

from . import sources, world
from .common import SourceError, asset_key, http_json, log, now_iso

RULE_V = "wm5"           # Version der Regel; ändert sie sich, wird das Ideal-Depot neu nachgerechnet
N_POS = 5                # Jakobs Wahl vom 28.11.2026 nach dem Backtest (Frage positions; vorher 6)
KEEP_EXTRA = 2           # gehalten wird bis Rang n + 2 (bei 5 Titeln bis Rang 7), gekauft die stärksten bis n Titel
CAP_PCT = 30             # Obergrenze je Titel zum Monatsende (Frage maxpos); 15 % kostete im Backtest gut 5 Punkte pro Jahr
STOP_PCT = 25            # Nachlauf-Stopp ab Hoch seit Kauf
COST = 0.001             # Kosten je Kauf und Verkauf im Modell (wie im Backtest)
RS_W = ((63, 0.4), (126, 0.2), (189, 0.2), (252, 0.2))   # relative Stärke wie IBD: 3, 6, 9, 12 Monate
MIN_BARS = 274           # 12 Monate Rendite plus Puffer (wie im Backtest)
KEEP_DAYS = 520          # so viele Handelstage hebt screen_base.json auf (gut 2 Jahre)
CAL = "SPY"              # Kalender und Vergleich (S&P 500 mit Dividenden)
STRAT_DEP = "jakob"      # Strategie nur für das Teildepot Jakob (Jakobs Wunsch vom 22.11.2026), nicht Hauptdepot oder Fenja

# Wachstumsmärkte: Länder-ETFs der Schwellenländer (wie im Backtest; dort selten gewählt, aber immer zugelassen)
MARKETS = {"EEM": "Schwellenländer", "INDA": "Indien", "EWT": "Taiwan", "EWY": "Südkorea", "MCHI": "China", "KWEB": "China Internet",
           "EWZ": "Brasilien", "EWW": "Mexiko", "EIDO": "Indonesien", "VNM": "Vietnam", "THD": "Thailand", "EPHE": "Philippinen",
           "TUR": "Türkei", "ARGT": "Argentinien", "EPOL": "Polen", "EZA": "Südafrika", "ECH": "Chile", "EPU": "Peru"}
SKIP = {"GOOG", "FOX", "NWS"}    # zweite Aktiengattung: nur GOOGL, FOXA, NWSA zählen (wie im Backtest)
GICS_DE = {"Information Technology": "Technik", "Health Care": "Gesundheit", "Financials": "Finanzen",
           "Consumer Discretionary": "Konsum zyklisch", "Communication Services": "Kommunikation", "Industrials": "Industrie",
           "Consumer Staples": "Konsum Basis", "Energy": "Energie", "Utilities": "Versorger", "Real Estate": "Immobilien",
           "Materials": "Rohstoffe"}
YF_SECTOR_DE = {"Technology": "Technik", "Healthcare": "Gesundheit", "Financial Services": "Finanzen", "Consumer Cyclical": "Konsum zyklisch",
                "Communication Services": "Kommunikation", "Industrials": "Industrie", "Consumer Defensive": "Konsum Basis",
                "Energy": "Energie", "Utilities": "Versorger", "Real Estate": "Immobilien", "Basic Materials": "Rohstoffe"}
SHARE_BY_DD = {15: 30, 25: 50, 35: 75, 50: 100}   # Aktienanteil nach deiner Grenze für Rückgänge (gleich in web/app.js)


def answers(pf):
    return ((pf.get("profile") or {}).get("answers") or {})


def n_slots(ans):
    """Zahl der Titel: Antwort positions (4 bis 8). Alte Antworten als Spanne („6-8“) nehmen die kleinste Zahl ab 6
    (Jakobs Vorgabe vom 27.11.2026; seit 28.11.2026 gilt seine Antwort 5)."""
    v = ans.get("positions")
    try:
        return max(1, int(v))
    except (TypeError, ValueError):
        lo_hi = [int(x) for x in str(v or "6-8").split("-")]
        return min(max(6, lo_hi[0]), lo_hi[-1]) if lo_hi[-1] >= 6 else lo_hi[-1]


def stop_pct(ans):
    """Nachlauf-Stopp nur, wenn die Frage „stop“ mit „mit Stopp“ beantwortet ist (Standard seit 27.11.2026: ohne)."""
    return STOP_PCT if ans.get("stop") == "t25" else None


def cap_pct(ans):
    """Obergrenze je Titel in Prozent (Frage maxpos: 15 bis 35, „none“ = keine)."""
    v = ans.get("maxpos")
    if v == "none":
        return None
    try:
        return float(v) if v is not None else CAP_PCT
    except (TypeError, ValueError):
        return CAP_PCT


def enforce_cap(pos, cash, cap, cost=COST):
    """Obergrenze je Titel (Anteil cap am Depot): Überschuss verkaufen und auf die Titel darunter verteilen (bis zur Grenze),
    der Rest bleibt Kasse. pos: Titel -> Wert, wird geändert. Ergebnis: (Kasse, Zahl der Teilverkäufe). Gleich im Backtest."""
    k = 0
    for _ in range(5):
        V = cash + sum(pos.values())
        over = {x: v - cap * V for x, v in pos.items() if v > cap * V * 1.001}
        if not over:
            break
        ex = 0.0
        for x, e in over.items():
            pos[x] -= e
            ex += e * (1 - cost)
            k += 1
        room = {x: cap * V - v for x, v in pos.items() if x not in over and v < cap * V}
        tot = sum(room.values())
        if tot > 0:
            give = min(ex, tot)
            for x, r in room.items():
                pos[x] += give * r / tot * (1 - cost)
            ex -= give
        cash += ex
    return cash, k


# ----------------------------------------------------------------- Auswahl: heutige Mitglieder der Indizes
def _sp500():
    """S&P 500 aus der Liste der Wikipedia (Kürzel, Name, Sektor nach GICS). Leer, wenn die Liste nicht passt."""
    url = ("https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies&prop=wikitext&section=1"
           "&format=json&formatversion=2")
    try:
        txt = http_json(url, headers={"User-Agent": "DepotTracker/1.0"}, timeout=30)["parse"]["wikitext"]
    except (SourceError, KeyError, TypeError):
        return {}
    out = {}
    for row in txt.split("\n|-")[1:]:
        m = re.search(r"\{\{\w*Symbol\|([A-Z0-9.\-]+)", row)
        if not m:
            continue
        cells = []
        for line in row.split("\n"):
            if line.startswith("|") and not line.startswith("|}"):
                cells += [c.strip() for c in line.lstrip("|").split("||")]
        cells = [c for c in cells if c]
        if len(cells) < 3:
            continue
        name = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", cells[1]).strip()
        out[m.group(1).replace(".", "-")] = [name, GICS_DE.get(cells[2], "")]
    return out if len(out) >= 450 else {}


def _ndx():
    try:
        rows = http_json("https://api.nasdaq.com/api/quote/list-type/nasdaq100", headers=sources.NASDAQ_H, timeout=30)["data"]["data"]["rows"]
    except (SourceError, KeyError, TypeError):
        return {}
    out = {}
    for x in rows or []:
        sym = str(x.get("symbol") or "").strip().replace(".", "-").replace("/", "-")
        if sym:
            name = re.sub(r"\s+(Common Stock|Class [A-C]\b.*|Ordinary Shares.*|American Depositary.*|New York Registry.*|Common Shares.*|Registered Shares.*)$",
                          "", x.get("companyName") or "")
            out[sym] = [name.strip(), ""]
    return out if len(out) >= 90 else {}


def index_members(prev=None):
    """Kürzel (Yahoo) -> [Index ("sp", "ndx", "welt", mit Komma verbunden), Sektor, Name, Land]. Fällt eine Quelle aus,
    bleibt ihr letzter Stand."""
    prev = prev or {}
    sp, ndx, acwi = _sp500(), _ndx(), world.acwi()
    if not sp:
        log("Auswahl: S&P 500 nicht geladen, letzter Stand bleibt")
        sp = {s: [v[2], v[1]] for s, v in prev.items() if "sp" in v[0]}
    if not ndx:
        log("Auswahl: Nasdaq-100 nicht geladen, letzter Stand bleibt")
        ndx = {s: [v[2], v[1]] for s, v in prev.items() if "ndx" in v[0]}
    if not acwi:
        log("Auswahl: MSCI ACWI nicht geladen, letzter Stand bleibt")
        acwi = {s: [v[3] if len(v) > 3 else "", "", v[2], 0] for s, v in prev.items() if "welt" in v[0]}
    out = {}
    for sym in set(sp) | set(ndx) | set(acwi):
        if sym in SKIP:
            continue
        w = acwi.get(sym)
        idx = ",".join(x for x, d in (("sp", sp), ("ndx", ndx)) if sym in d) or "welt"
        if sym in sp or sym in ndx:
            name, sector = sp.get(sym) or ndx.get(sym)
        else:
            name, sector = (prev.get(sym) or ["", "", ""])[2] or w[2].title(), GICS_DE.get(w[1], w[1])
        old = prev.get(sym) or ["", "", "", ""]
        out[sym] = [idx, sector or old[1] or (GICS_DE.get(w[1], "") if w else ""), name, (w[0] if w else "") or (old[3] if len(old) > 3 else "")]
    log("Auswahl: %d Aktien (S&P 500, Nasdaq-100, Europa, China, Hongkong), davon %d außerhalb der US-Indizes, %d Länder-ETFs"
        % (len(out), sum(1 for v in out.values() if v[0] == "welt"), len(MARKETS)))
    return out


def universe(members):
    return sorted(set(members) | set(MARKETS))


# ----------------------------------------------------------------- Kurse (mit Dividenden)
def history(sym, rng="2y"):
    """Tageskurse mit Dividenden (adjclose von Yahoo): {d: Tage seit 1970, c: Kurse, name}."""
    res = sources.yahoo_chart(sym, rng=rng)
    if not res:
        return None
    m = res.get("meta") or {}
    ind = res.get("indicators") or {}
    adj = ((ind.get("adjclose") or [{}])[0] or {}).get("adjclose") or ((ind.get("quote") or [{}])[0] or {}).get("close") or []
    off = m.get("gmtoffset") or 0
    d, c = [], []
    for t, x in zip(res.get("timestamp") or [], adj):
        if x is None or x <= 0:
            continue
        day = int((t + off) // 86400)
        if d and d[-1] == day:
            c[-1] = x
        else:
            d.append(day)
            c.append(x)
    return {"d": d, "c": c, "name": m.get("longName") or m.get("shortName") or "", "cur": m.get("currency") or "USD"}


UNIT = {"GBp": ("GBP", 0.01), "GBX": ("GBP", 0.01), "ILA": ("ILS", 0.01), "ZAc": ("ZAR", 0.01)}   # Kurse in Pence, Agorot, Cent


def fx_usd(cur, rng="2y"):
    """Dollar je Einheit der Währung, Tageskurse von Yahoo ({d, c})."""
    res = sources.yahoo_chart("%sUSD=X" % cur, rng=rng)
    if not res:
        return None
    d, c = sources._series(res)
    return {"d": d, "c": c} if c else None


def fetch_universe(syms, workers=6):
    """Kurse aller Titel der Auswahl, parallel (Yahoo verträgt das in Maßen), dazu SPY als Kalender und Vergleich."""
    out = {}
    syms = list(syms) + [CAL]

    def one(s):
        for attempt in range(2):
            h = history(s)
            if h:
                return s, h
            time.sleep(2)
        return s, None
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for s, h in ex.map(one, syms):
            if h and len(h["c"]) >= 30:
                out[s] = h
    log("Strategie: Kurse für %d von %d Titeln" % (len(out), len(syms)))
    curs = {UNIT.get(h["cur"], (h["cur"], 1))[0] for h in out.values()} - {"USD"}
    fx = {}
    for c in sorted(curs):
        x = fx_usd(c)
        if x:
            fx[c] = x
    out["_fx"] = fx
    return out


def _r(x):
    return round(x, 2) if x >= 100 else round(x, 3) if x >= 1 else round(x, 5)


def pack(H):
    """Kompakt für screen_base.json: ein gemeinsamer Kalender (Handelstage von SPY) und je Titel die Kurse ab seinem ersten
    Tag, Lücken mit dem letzten Kurs gefüllt. Titel, deren Kurse vor mehr als 5 Handelstagen enden, fallen weg."""
    cal = H[CAL]["d"][-KEEP_DAYS:]
    px, cur = {}, {}
    fx = H.get("_fx") or {}
    for s, h in H.items():
        if s == "_fx":
            continue
        c0 = UNIT.get(h.get("cur") or "USD", (h.get("cur") or "USD", 1))[0]
        if c0 != "USD":
            if c0 not in fx:
                continue       # ohne Wechselkurs keine faire Rangfolge
            cur[s] = h["cur"]
        d, c = h["d"], h["c"]
        if not d or d[-1] < cal[max(0, len(cal) - 6)]:
            continue
        j = bisect.bisect_left(d, cal[0])
        if j >= len(d):
            continue
        k0 = bisect.bisect_left(cal, d[j])
        arr, last = [], c[j]
        for day in cal[k0:]:
            while j < len(d) and d[j] <= day:
                last = c[j]
                j += 1
            arr.append(_r(last))
        if arr:
            px[s] = [k0, arr]
    fxp = {}
    for c, h in fx.items():
        d, v, j, last, arr = h["d"], h["c"], 0, h["c"][0], []
        for day in cal:
            while j < len(d) and d[j] <= day:
                last = v[j]
                j += 1
            arr.append(round(last, 6))
        fxp[c] = arr
    return {"days": cal, "px": px, "cur": cur, "fx": fxp}


def unpack(base, live=None):
    """Kalender und Reihen aus screen_base.json; live = {Kürzel: (Tag, Kurs)} hängt den heutigen Kurs an (bzw. ersetzt ihn,
    wenn der Tag schon da ist). Titel ohne aktuellen Kurs behalten den letzten Schlusskurs."""
    cal = list(base["days"])
    px = {s: [k0, list(a)] for s, (k0, a) in base["px"].items()}
    live = {s: v for s, v in (live or {}).items() if s in px and v and v[1]}
    new = max([d for d, p in live.values() if d > cal[-1]] or [0])
    if new:
        cal.append(new)
        for s, (k0, a) in px.items():
            a.append(a[-1])
    for s, (day, p) in live.items():
        if day == cal[-1]:
            px[s][1][-1] = p
    # Kurse in Heimatwährung -> Dollar (für die Rangfolge; ein Plus nur aus schwacher Heimatwährung zählt nicht)
    fx = base.get("fx") or {}
    for s, c in (base.get("cur") or {}).items():
        c0, f = UNIT.get(c, (c, 1))
        v = fx.get(c0)
        if s not in px or not v:
            px.pop(s, None)
            continue
        k0, a = px[s]
        px[s] = [k0, [x * f * v[min(len(v) - 1, k0 + i)] for i, x in enumerate(a)]]
    return cal, px


# ----------------------------------------------------------------- Kennzahlen je Titel
def feats(c, i):
    """Relative Stärke, Trend und Renditen am Index i einer Kursreihe (None, wenn der Verlauf zu kurz ist)."""
    if i < MIN_BARS - 1 or i >= len(c) or not c[i]:
        return None
    p = c[i]

    def ret(k):
        x = c[i - k]
        return p / x - 1 if x else None
    rs = {k: ret(k) for k, _ in RS_W}
    s50 = sum(c[i - 49:i + 1]) / 50.0
    s200 = sum(c[i - 199:i + 1]) / 200.0
    hi = max(c[i - 251:i + 1])
    return {"p": p, "rs_raw": sum(w * (rs[k] or 0) for k, w in RS_W), "r3": rs[63], "r6": rs[126], "r9": rs[189], "r12": rs[252],
            "s50": s50, "s200": s200, "trend": p > s200 and s50 > s200, "hi": p / hi - 1,
            "chg5": p / c[i - 5] - 1 if c[i - 5] else None}


def snapshot(px, uni, k):
    """Kennzahlen aller Titel der Auswahl am Kalendertag k, dazu Stärke 1 bis 99 (Rang unter allen, wie bei IBD)."""
    F = {}
    for s in uni:
        x = px.get(s)
        if x:
            f = feats(x[1], k - x[0])
            if f:
                F[s] = f
    vals = sorted(f["rs_raw"] for f in F.values())
    for f in F.values():
        f["rs"] = rs_rating(vals, f["rs_raw"])
    return F


def rs_rating(vals, v):
    return int(round(1 + 98 * bisect.bisect_left(vals, v) / max(1, len(vals) - 1)))


def ranked(F):
    """Kandidaten: Titel im Aufwärtstrend, stärkste zuerst."""
    return [s for s, f in sorted(F.items(), key=lambda x: -x[1]["rs_raw"]) if f["trend"]]


# ----------------------------------------------------------------- Ideal-Depot: Modell nach der Regel
def _date(day):
    return datetime.date(1970, 1, 1) + datetime.timedelta(days=day)


def _month(day):
    return _date(day).strftime("%Y-%m")


def _iso(day):
    return _date(day).isoformat()


def _today():
    return int(time.time() // 86400)


def _fresh(n, stop):
    return {"rule": RULE_V, "asof": None, "items": [], "cash": 1.0, "stopped": [], "log": [], "stops": [], "track": [], "n": n, "stop": stop}


def advance(state, cal, px, uni, n, stop, today=None, cap=None):
    """Führt das Modell bis zum letzten abgeschlossenen Handelstag weiter (wie simulate in tracker/backtest.py). Ein Tag gilt
    als abgeschlossen, wenn er vor heute liegt. Den letzten Tag eines Monats entscheidet der Lauf erst, wenn klar ist, dass
    er der letzte war (nächster Kurs im neuen Monat oder heute schon ein neuer Monat). Ohne Stand wird nachgerechnet."""
    today = today or _today()
    st = state if state and state.get("rule") == RULE_V and state.get("asof") in cal else _fresh(n, stop)
    st["n"], st["stop"] = n, stop

    def price(s, k):
        x = px.get(s)
        return x[1][k - x[0]] if x and k >= x[0] else None
    prev_k = cal.index(st["asof"]) if st["asof"] else None
    for k, d in enumerate(cal):
        if d >= today:
            break
        if st["asof"] and d <= st["asof"]:
            continue
        nxt = cal[k + 1] if k + 1 < len(cal) and cal[k + 1] < today else None
        if nxt is None:
            if _month(d) == _month(today):
                break                            # noch offen, ob das der letzte Handelstag des Monats war
            me = True
        else:
            me = _month(nxt) != _month(d)
        if st["asof"] is None and (not me or len(snapshot(px, uni, k)) < 100):
            continue                             # Start erst zu einem Monatsende mit genug Verlauf
        if st["asof"] is not None:
            for it in st["items"]:
                p0, p1 = price(it["sym"], prev_k), price(it["sym"], k)
                if p0 and p1:
                    it["v"] *= p1 / p0
                    it["hi"] = max(it["hi"], p1)
            if stop and not me:
                for it in list(st["items"]):
                    p1 = price(it["sym"], k)
                    if p1 and p1 < it["hi"] * (1 - stop / 100.0):
                        st["cash"] += it["v"] * (1 - COST)
                        st["items"].remove(it)
                        ev = {"sym": it["sym"], "day": d, "px": p1, "hi": it["hi"], "since": it["since"]}
                        st["stopped"].append(ev)
                        st["stops"].append(ev)
        if me:
            rk = ranked(snapshot(px, uni, k))
            top, hold = rk[:n], set(rk[:n + KEEP_EXTRA])
            keep = [it for it in st["items"] if it["sym"] in hold]
            out = [it for it in st["items"] if it["sym"] not in hold]
            for it in out:
                st["cash"] += it["v"] * (1 - COST)
            w = (st["cash"] + sum(it["v"] for it in keep)) / n      # keine regelmäßige Gleichgewichtung: Gewinner laufen weiter
            have = {it["sym"] for it in keep}
            new = []
            for s in [x for x in rk if x not in have][:max(0, n - len(keep))]:
                p = price(s, k)
                amt = min(st["cash"], w)
                if s in have or not p or amt <= 0.1 * w:
                    continue
                st["cash"] -= amt
                new.append({"sym": s, "since": d, "entry": p, "hi": p, "v": amt * (1 - COST)})
            st["items"] = keep + new
            if cap:                               # Obergrenze je Titel: Überschuss auf die Titel darunter verteilen
                vals = {it["sym"]: it["v"] for it in st["items"]}
                st["cash"], _ = enforce_cap(vals, st["cash"], cap / 100.0)
                for it in st["items"]:
                    it["v"] = vals[it["sym"]]
            st["stopped"] = []
            st["log"].append({"day": d, "in": [x["sym"] for x in new], "out": [x["sym"] for x in out], "keep": sorted(have), "top": top})
        st["track"].append([d, round(st["cash"] + sum(it["v"] for it in st["items"]), 5)])
        st["asof"], prev_k = d, k
    st["track"] = st["track"][-KEEP_DAYS:]
    st["log"] = st["log"][-24:]
    st["stops"] = st["stops"][-40:]
    return st


# ----------------------------------------------------------------- Depot Jakob
def alias_sources(pf):
    """Titel, die per `alias` als eine andere Aktie zählen (z. B. Hinterlegungsschein): nie eigene Kandidaten."""
    return {asset_key(t.get("kind"), str(t.get("symbol") or "").upper()) for t in pf.get("transactions") or [] if t.get("alias")}


def _held(pf):
    """Gehaltene Titel im Depot Jakob mit dem Tag, an dem die heutige Position begann (für den Stopp ab Hoch seit Kauf).
    Eine Buchung mit `alias` (z. B. Hinterlegungsschein) zählt als die Aktie mit diesem Kürzel (Jakobs Wunsch vom
    24.11.2026; gleiche Regel in web/app.js stratKey)."""
    qty, since = {}, {}
    txs = sorted((t for t in pf.get("transactions") or [] if (t.get("depot") or "main") == STRAT_DEP), key=lambda t: str(t.get("date") or ""))
    for t in txs:
        if t.get("type") not in ("buy", "sell"):
            continue
        k = asset_key(t.get("kind"), str(t.get("alias") or t.get("symbol") or "").upper())
        q = float(t.get("qty") or 0)
        if t["type"] == "buy" and qty.get(k, 0) <= 1e-9:
            since[k] = str(t.get("date") or "")[:10]
        qty[k] = qty.get(k, 0) + (q if t["type"] == "buy" else -q)
    return {k: since.get(k) for k, q in qty.items() if q > 1e-9}


def _day_of(iso):
    try:
        return (datetime.date.fromisoformat(str(iso)[:10]) - datetime.date(1970, 1, 1)).days
    except (TypeError, ValueError):
        return None


def stop_state(d, c, since_day, stop):
    """Abstand zum Hoch seit Kauf in Prozent und ob der Stopp greift (Schlusskurse ab dem Kauftag, dazu der aktuelle Kurs)."""
    if not d or since_day is None:
        return None
    j = min(bisect.bisect_left(d, since_day), len(c) - 1)
    hi = max(c[j:])
    dd = (c[-1] / hi - 1) * 100 if hi else None
    return {"hi": _r(hi), "dd": round(dd, 1) if dd is not None else None, "hit": bool(stop and dd is not None and dd <= -stop)}


def last_weekday_of_month(d):
    nxt = (d.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
    last = nxt - datetime.timedelta(days=1)
    while last.weekday() >= 5:
        last -= datetime.timedelta(days=1)
    return last


def rule_words(rows, held, top, stopped):
    """Wort je Aktie für das Depot Jakob, ohne Beträge (gleiche Rechnung wie ruleOf in web/app.js): Verkaufen sofort beim
    Stopp; zum Monatsende, wenn ein Titel nicht mehr zu den stärksten im Aufwärtstrend gehört (bis Rang n + 2); Halten,
    solange er dazugehört; Kaufen zum Monatsende, was dazukommt (auch ein Titel, den der Stopp im Ideal-Depot in diesem
    Monat verkauft hat). top = Ziel für das Depot Jakob (target in build)."""
    out = {}
    for k in set(held) | set(top):
        r = rows.get(k)
        if k in held:
            if not r:
                continue                        # keine Kurse: kein Wort
            if (r.get("stop") or {}).get("hit"):
                out[k] = ["Verkaufen", "stop"]
            elif not r.get("member"):
                out[k] = ["Verkaufen", "auswahl"]
            elif not r.get("trend"):
                out[k] = ["Verkaufen", "trend"]
            elif k not in top:
                out[k] = ["Verkaufen", "rang"]
            else:
                out[k] = ["Halten", "top"]
        elif k in stopped:
            out[k] = ["Kaufen", "wieder"]       # im Ideal-Depot gestoppt, zum Monatsende wieder dabei, wenn weiter vorn
        else:
            out[k] = ["Kaufen", "top"]
    return out


# ----------------------------------------------------------------- Hinweise aufs Handy
WHY = {"stop": "Kurs %d %% unter dem Hoch seit Kauf" % STOP_PCT, "auswahl": "nicht in der Auswahl (S&P 500, Nasdaq-100, Europa, China)",
       "trend": "Aufwärtstrend gebrochen", "rang": "nicht mehr unter den %d stärksten im Aufwärtstrend" % (N_POS + KEEP_EXTRA),
       "top": "neu unter den stärksten im Aufwärtstrend", "wieder": "im Ideal-Depot gestoppt, zum Monatsende wieder unter den stärksten"}
WT = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def events(prev, words, names, st, first, today):
    """Neue Hinweise: Wort springt auf Kaufen oder Verkaufen, Stopp, neue Auswahl im Ideal-Depot, Übersicht am Monatsende.
    Jeder Hinweis höchstens einmal in 7 Tagen. Beim Wechsel der Strategie nur eine Übersicht."""
    seen = {(e["type"], e["key"]): e["day"] for e in (prev or {}).get("events") or []}
    old, why_old = (prev or {}).get("rules") or {}, (prev or {}).get("why") or {}
    out = []

    def add(key, symbol, typ, text, important=True):
        last = seen.get((typ, key))
        if last and (today - datetime.date.fromisoformat(last)).days < 7:
            return
        out.append({"day": today.isoformat(), "type": typ, "key": key, "symbol": symbol, "text": text, "important": important})
    me = last_weekday_of_month(today)
    me_txt = "%s %d.%d." % (WT[me.weekday()], me.day, me.month)
    nm = lambda ks: ", ".join(sorted(names.get(k, k.split(":", 1)[-1]) for k in ks))
    by = lambda w: [k for k, x in words.items() if x[0] == w]
    if first:
        parts = ["%s: %s" % (w, nm(by(w))) for w in ("Verkaufen", "Kaufen", "Halten") if by(w)]
        head = "Regel angepasst: 5 Titel, gehalten bis Rang 7; TSMC und SK Hynix gehören zur Auswahl" if str((prev or {}).get("rule") or "").startswith("wm") \
            else "Wachstums-Momentum ersetzt deine bisherigen Regeln"
        add("depot:jakob", "Depot Jakob", "neu", "%s. Zum Monatsende (%s): %s" % (head, me_txt, "; ".join(parts) if parts else "nichts zu tun"))
        return out
    for k, (w, why) in words.items():
        if w == "Verkaufen" and why == "stop":
            if old.get(k) != "Verkaufen" or why_old.get(k) != "stop":
                add(k, names.get(k, k), "stop", "Deine Regel: Verkaufen sofort, %s" % WHY["stop"])
        elif w in ("Kaufen", "Verkaufen") and old.get(k) != w:
            add(k, names.get(k, k), "rule", "Deine Regel: %s zum Monatsende (%s), %s" % (w, me_txt, WHY.get(why, "")))
    plog = ((prev or {}).get("ideal") or {}).get("log") or []
    if st["log"] and (not plog or plog[-1]["day"] != st["log"][-1]["day"]):
        x = st["log"][-1]
        ks = lambda ss: [asset_key("stock", s) for s in ss]
        add("ideal:" + _iso(x["day"]), "Ideal-Depot", "ideal", "Neue Auswahl zum Monatsende: %s%s" % (
            ("neu " + nm(ks(x["in"]))) if x["in"] else "keine Änderung", ("; raus " + nm(ks(x["out"]))) if x["out"] else ""))
    pst = {(e["sym"], e["day"]) for e in ((prev or {}).get("ideal") or {}).get("stops") or []}
    for e in st["stops"]:
        if (e["sym"], e["day"]) not in pst and e["day"] >= _today() - 5:
            k = asset_key("stock", e["sym"])
            add(k, names.get(k, e["sym"]), "istop", "Stopp im Ideal-Depot: %.0f %% unter dem Hoch seit Kauf, Platz bis Monatsende frei" % (
                (1 - e["px"] / e["hi"]) * 100), k in words)
    if today == me:
        parts = ["%s: %s" % (w, nm(by(w))) for w in ("Verkaufen", "Kaufen") if by(w)]
        add("depot:jakob", "Depot Jakob", "monat", "Monatsende: " + ("; ".join(parts) if parts else "nichts zu tun, alles halten"))
    return out


# ----------------------------------------------------------------- Kennzahlen für die Anzeige (Tageslauf)
def fund_info(syms, yf, out, prev=None):
    """Umsatzwachstum, Schätzungen, Quartalszahlen, Branche für die angezeigten Titel (nur Anzeige, die Regel braucht sie
    nicht). Verfolgte Titel nehmen ihre Kennzahlen aus daily.json, die anderen fragen Yahoo."""
    prev = prev or {}
    info = {}
    for s in syms:
        e = out.get(asset_key("stock", s)) or {}
        f = e.get("fund")
        if f is None and s not in MARKETS and yf is not None:
            f = yf.get(s)
        if not f:
            if s in prev:
                info[s] = prev[s]
            continue
        rg, ed = f.get("revenue_growth"), f.get("earnings_date")
        info[s] = {k: v for k, v in {
            "rev_g": round(rg * 100, 1) if rg is not None else None, "est90": f.get("est_chg_90d"),
            "earnings": e.get("earnings_date") or (datetime.datetime.utcfromtimestamp(ed).date().isoformat() if ed else None),
            "industry": f.get("industry"), "sector": YF_SECTOR_DE.get(f.get("sector") or "", "")}.items() if v not in (None, "")}
    return info


def extra_hist(pf, assets, members):
    """Gehaltene und beobachtete Aktien außerhalb der Auswahl (z. B. SK Hynix): Tageskurse aus daily.json für Stärke und Stopp."""
    keys = set(_held(pf)) | {asset_key(w.get("kind") or "stock", str(w.get("symbol") or "").upper()) for w in pf.get("watchlist") or []}
    out = {}
    for k in keys:
        kind, sym = k.split(":", 1)
        e = assets.get(k) or {}
        h = e.get("hist") or {}
        if kind == "stock" and sym not in members and sym not in MARKETS and len(h.get("c") or []) >= MIN_BARS:
            out[sym] = {"d": h["d"], "c": h["c"], "name": e.get("name") or ""}
    return out


def watch_syms(prev, pf, members, extra=40):
    """Titel, die der Kurslauf mit aktuellen Kursen neu rechnet: die stärksten vom letzten Lauf, Ideal-Depot, Depot Jakob und
    Watchlist (soweit in der Auswahl). Die übrigen behalten den letzten Schlusskurs."""
    prev = prev or {}
    uni = set(members) | set(MARKETS)
    keys = list((prev.get("ranked") or [])[:extra]) + [x.get("key", "") for x in (prev.get("ideal") or {}).get("model") or []]
    keys += list(_held(pf)) + [asset_key(w.get("kind") or "stock", str(w.get("symbol") or "").upper()) for w in pf.get("watchlist") or []]
    out = []
    for k in keys:
        s = k.split(":", 1)[-1]
        if s in uni and s not in out:
            out.append(s)
    return out


# ----------------------------------------------------------------- screen.json
SHORT = {"000660.KS": "SK Hynix", "005930.KS": "Samsung", "TSM": "TSMC", "GOOGL": "Google"}


def short_name(name):
    """Firmenname ohne Zusätze, wie man ihn sagt (grob wie shortName in web/app.js)."""
    n = name or ""
    for _ in range(4):
        n = re.sub(r"[,.]?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|Limited|plc|SE|AG|N\.V\.|NV|Holdings?|Holding|Technologies|Technology|Platforms|Group)$", "", n.strip(), flags=re.I)
    return n.strip()


def _pct(x, d=1):
    return round(x * 100, d) if x is not None else None


def _row(key, sym, f, members, info, rank, extra_name="", cur_of=None):
    cur_of = cur_of or {}
    m = members.get(sym)
    inf = info.get(sym) or {}
    return {k: v for k, v in {
        "key": key, "symbol": sym, "name": (m[2] if m else MARKETS.get(sym)) or extra_name or "",
        "sector": (m[1] if m else "Land" if sym in MARKETS else "") or inf.get("sector") or "", "industry": inf.get("industry"),
        "idx": m[0] if m else "markt" if sym in MARKETS else "", "member": bool(m) or sym in MARKETS, "market": sym in MARKETS,
        "land": world.COUNTRY_DE.get(m[3], m[3]) if m and len(m) > 3 and m[3] and m[3] != "United States" else None,
        "cur": cur_of.get(sym),
        "rs": f.get("rs"), "score": round(f["rs_raw"] * 100, 1), "rank": rank, "trend": bool(f["trend"]),
        "p50": _pct(f["p"] / f["s50"] - 1), "p200": _pct(f["p"] / f["s200"] - 1), "r3": _pct(f["r3"]), "r6": _pct(f["r6"]),
        "r9": _pct(f["r9"]), "r12": _pct(f["r12"]), "from_high": _pct(f["hi"]), "chg5": _pct(f["chg5"], 2),
        "rev_g": inf.get("rev_g"), "est90": inf.get("est90"), "earnings": inf.get("earnings")}.items() if v is not None}


def build(store, pf, base, push, fg=None, mfg=None, extra=None, live=None, today=None):
    """screen.json schreiben und neue Hinweise aufs Handy schicken.
    base = screen_base.json (Kalender, Kurse mit Dividenden, Mitglieder, Kennzahlen); live = {Kürzel: (Tag, Kurs)} aktuelle
    Kurse; extra = {Kürzel: {d, c, name}} gehaltene oder beobachtete Aktien außerhalb der Auswahl (Kurse aus daily.json)."""
    ans = answers(pf)
    today = today or _today()
    prev = store.get("screen.json") or {}
    members, info = base.get("members") or {}, base.get("info") or {}
    cal, px = unpack(base, live)
    uni = universe(members)
    n, stop, cap = n_slots(ans), stop_pct(ans), cap_pct(ans)
    # Modell weiterführen (nur abgeschlossene Tage), dann die Lage heute mit aktuellen Kursen
    pst = prev.get("ideal") if prev.get("rule") == RULE_V else None
    state = dict(pst, items=[dict(x) for x in pst.get("model") or []]) if pst else None
    st = advance(state, cal, px, uni, n, stop, today, cap)
    F = snapshot(px, uni, len(cal) - 1)
    R = ranked(F)
    rank = {s: i + 1 for i, s in enumerate(R)}
    top = R[:n]
    held, alias = _held(pf), alias_sources(pf)
    watch = [asset_key(w.get("kind") or "stock", str(w.get("symbol") or "").upper()) for w in pf.get("watchlist") or []]
    want = [asset_key("stock", s) for s in R[:40]] + [asset_key("stock", it["sym"]) for it in st["items"]]
    want += [asset_key("stock", e["sym"]) for e in st["stopped"]] + list(held) + watch
    vals = sorted(f["rs_raw"] for f in F.values())
    rows = {}
    for key in want:
        kind, sym = key.split(":", 1)
        if kind != "stock" or key in rows or key in alias:
            continue
        if sym in F:
            r = _row(key, sym, F[sym], members, info, rank.get(sym), cur_of=base.get("cur"))
            d, c = cal[px[sym][0]:], px[sym][1]
        else:
            h = (extra or {}).get(sym)
            f = feats(h["c"], len(h["c"]) - 1) if h and h.get("c") else None
            if not f:
                continue
            f["rs"] = rs_rating(vals, f["rs_raw"])
            r = _row(key, sym, f, members, info, None, h.get("name") or "")
            r["member"] = False
            d, c = h["d"], h["c"]
        if key in held:
            r["stop"] = stop_state(d, c, _day_of(held[key]), stop)
            r["since"] = held[key]
        rows[key] = r
    stopped = {asset_key("stock", e["sym"]) for e in st["stopped"]}
    # Ziel für das Depot Jakob: gehaltene Titel bis Rang n + 2 bleiben, die freien Plätze bekommen die stärksten
    kept = [k for k in held if rank.get(k.split(":", 1)[1], 999) <= n + KEEP_EXTRA and (rows.get(k) or {}).get("member")]
    target = kept + [k for k in (asset_key("stock", s) for s in R) if k not in kept][:max(0, n - len(kept))]
    words = rule_words(rows, held, target, stopped)
    names = {k: SHORT.get(r["symbol"]) or short_name(r.get("name")) or r["symbol"] for k, r in rows.items()}
    first = prev.get("rule") != RULE_V
    day = datetime.date.today()
    new = events(prev, words, names, st, first, day)
    keep = (day - datetime.timedelta(days=45)).isoformat()
    evs = (new + ([] if first else [e for e in prev.get("events") or [] if e["day"] >= keep]))[:80]
    doc = {"updated": now_iso(), "rule": RULE_V, "n": n, "stop": stop, "cap": cap, "asof": _iso(cal[-1]),
           "list": sorted(rows.values(), key=lambda r: (r.get("rank") or 999, -(r.get("rs") or 0))),
           "ranked": [asset_key("stock", s) for s in R[:25]], "top": [asset_key("stock", s) for s in top], "target": target,
           "keep_rank": n + KEEP_EXTRA,
           "ideal": {"items": [{"key": asset_key("stock", s), "rank": i + 1} for i, s in enumerate(top)],
                     "model": [dict(it, key=asset_key("stock", it["sym"])) for it in st["items"]],
                     "asof": st["asof"], "cash": round(st["cash"], 5), "stopped": st["stopped"], "log": st["log"], "stops": st["stops"],
                     "track": st["track"], "n": n, "stop": stop, "rule": RULE_V},
           "rules": {k: w[0] for k, w in words.items()}, "why": {k: w[1] for k, w in words.items()}, "events": evs,
           "breadth": {"n": len(F), "trend": len(R), "stocks": sum(1 for s in F if s not in MARKETS)},
           "members": {"n": len(members), "sp": sum(1 for v in members.values() if "sp" in v[0]),
                       "ndx": sum(1 for v in members.values() if "ndx" in v[0]), "welt": sum(1 for v in members.values() if v[0] == "welt"),
                       "abroad": sum(1 for v in members.values() if len(v) > 3 and v[3] and v[3] != "United States"),
                       "markets": len(MARKETS), "at": base.get("members_at")},
           "fg": {k: v for k, v in (fg or {}).items() if v is not None}}
    if mfg:
        doc["mfg"] = {k: v for k, v in mfg.items() if k != "hist"}
    store.put("screen.json", doc)
    mode = ans.get("push") or "important"
    send = [e for e in new if mode == "all" or (mode == "important" and e["important"])]
    if send:
        body = "\n".join("%s: %s" % (names.get(e["key"], e["symbol"]), e["text"]) for e in send[:5])
        push(pf, "Strategie: %d %s" % (len(send), "Hinweis" if len(send) == 1 else "Hinweise"), body + "\nKeine Anlageberatung.")
    log("Strategie: %d Titel bewertet, %d im Aufwärtstrend, %d neue Hinweise" % (len(F), len(R), len(new)))
    return doc
