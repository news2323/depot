"""Kennzahlen aus Kursverläufen: Trend, Nachkauf-Zonen, Dividenden und eine regelbasierte Bewertung.

Die Bewertung ist eine nachvollziehbare Faustregel aus öffentlichen Kennzahlen, keine Anlageberatung.
"""
import datetime
import math
import statistics


def day_to_iso(d):
    return (datetime.date(1970, 1, 1) + datetime.timedelta(days=int(d))).isoformat()


def ts_to_iso(ts):
    return datetime.datetime.fromtimestamp(int(ts), datetime.timezone.utc).date().isoformat()


def technicals(closes, crypto=False):
    n = len(closes)
    if n < 20:
        return None
    last = closes[-1]
    year = 365 if crypto else 252
    win = closes[-year:]

    def sma(k):
        return statistics.mean(closes[-k:]) if n >= k else None

    gains, losses = [], []
    for a, b in zip(closes[-15:-1], closes[-14:]):
        gains.append(max(b - a, 0))
        losses.append(max(a - b, 0))
    ag, al = statistics.mean(gains), statistics.mean(losses)
    rsi = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    rets = [math.log(b / a) for a, b in zip(win[:-1], win[1:]) if a > 0 and b > 0]
    hi, lo = max(win), min(win)

    def perf(k):
        return (last / closes[-1 - k] - 1) * 100 if n > k and closes[-1 - k] else None

    month, quarter = (30, 91) if crypto else (21, 63)
    return {"sma50": sma(50), "sma200": sma(200), "high52": hi, "low52": lo,
            "from_high": (last / hi - 1) * 100, "range_pos": (last - lo) / (hi - lo) if hi > lo else 0.5,
            "rsi": rsi, "vol": statistics.pstdev(rets) * math.sqrt(year) * 100 if len(rets) > 5 else None,
            "perf_1m": perf(month), "perf_3m": perf(quarter), "perf_1y": perf(year)}


def swing_lows(days, closes, lookback=420, w=10):
    """Markante Tiefs der letzten Monate, nahe beieinander liegende zusammengefasst."""
    start = max(w, len(closes) - lookback)
    lows = []
    for i in range(start, len(closes) - w):
        if closes[i] == min(closes[i - w:i + w + 1]):
            lows.append((closes[i], days[i]))
    lows.sort()
    merged = []
    for v, d in lows:
        if merged and v <= merged[-1][0] * 1.03:
            continue
        merged.append((v, d))
    return merged


def buy_levels(price, tech, lows):
    """Bis zu drei Zonen unter dem aktuellen Kurs, an denen Nachkäufe technisch naheliegen."""
    if not tech or not price:
        return []
    cand = []
    if tech.get("sma50"):
        cand.append((tech["sma50"], "50-Tage-Linie"))
    if tech.get("sma200"):
        cand.append((tech["sma200"], "200-Tage-Linie"))
    for v, d in lows:
        dt = datetime.date.fromisoformat(day_to_iso(d))
        cand.append((v, "Unterstützung, Tief vom %02d.%02d.%d" % (dt.day, dt.month, dt.year)))
    if tech.get("low52"):
        cand.append((tech["low52"], "52-Wochen-Tief"))
    cand = sorted((c for c in cand if c[0] < price * 0.985), reverse=True)
    out = []
    for v, label in cand:
        if out and v > out[-1]["price"] * 0.96:
            continue
        out.append({"price": round(v, 6 if v < 1 else 2), "label": label, "dist_pct": round((v / price - 1) * 100, 1)})
        if len(out) == 3:
            break
    return out


def dividend_info(divs, price, fund=None):
    """divs: [(Tag, Betrag)] aufsteigend. Liefert Rendite, Rhythmus und den nächsten erwarteten Termin."""
    fund = fund or {}
    today = (datetime.date.today() - datetime.date(1970, 1, 1)).days
    out = {"history": [{"date": day_to_iso(d), "amount": round(a, 4)} for d, a in divs[-12:]]}
    last12 = [a for d, a in divs if d > today - 365]
    prev12 = [a for d, a in divs if today - 730 < d <= today - 365]
    ttm = sum(last12)
    if fund.get("div_rate"):
        out["annual"] = fund["div_rate"]
    elif ttm:
        out["annual"] = round(ttm, 4)
    if out.get("annual") and price:
        out["yield_pct"] = round(out["annual"] / price * 100, 2)
    out["per_year"] = len(last12)
    if ttm and prev12 and sum(prev12):
        out["growth_pct"] = round((ttm / sum(prev12) - 1) * 100, 1)
    if fund.get("div_yield_5y"):
        out["yield_5y_avg"] = fund["div_yield_5y"]
    if fund.get("payout") is not None:
        out["payout_pct"] = round(fund["payout"] * 100, 1)
    if fund.get("ex_div") and ts_to_iso(fund["ex_div"]) >= datetime.date.today().isoformat():
        out["next_ex"] = ts_to_iso(fund["ex_div"])
        out["next_ex_estimated"] = False
    elif len(divs) >= 2 and last12:
        gaps = [b[0] - a[0] for a, b in zip(divs[-6:-1], divs[-5:])]
        gap = statistics.median(gaps) if gaps else 0
        if gap >= 20:
            nxt = divs[-1][0] + gap
            while nxt < today:
                nxt += gap
            out["next_ex"] = day_to_iso(nxt)
            out["next_ex_estimated"] = True   # aus dem bisherigen Rhythmus hochgerechnet
    if fund.get("div_pay") and ts_to_iso(fund["div_pay"]) >= datetime.date.today().isoformat():
        out["next_pay"] = ts_to_iso(fund["div_pay"])
    if divs:
        out["last_amount"] = round(divs[-1][1], 4)
    return out if (divs or out.get("annual")) else None


RATING_WORDS = {
    "stock": ["deutlich überbewertet", "eher überbewertet", "fair bewertet", "eher unterbewertet", "deutlich unterbewertet"],
    "price": ["Kurs sehr hoch", "Kurs hoch", "Kurs im Mittelfeld", "Kurs niedrig", "Kurs sehr niedrig"],
    "crypto": ["stark überhitzt", "überhitzt", "neutral", "abgekühlt", "stark abgekühlt"],
}


def rating(score):
    """Punkte von 1 (deutlich überbewertet) bis 10 (deutlich unterbewertet). Dieselbe Formel in web/app.js (ratingOf)."""
    return max(1, min(10, int(math.floor(6 + 3 * score))))


def rating_label(points, kind):
    tier = 0 if points <= 2 else 1 if points <= 4 else 2 if points <= 6 else 3 if points <= 8 else 4
    return RATING_WORDS[kind][tier]


class _Points:
    """Sammelt gewichtete Punkte. Gewicht 0 heißt: wird gezeigt, zählt aber nicht."""

    def __init__(self):
        self.items = []

    def add(self, p, text, w=1.0, group="wert"):
        self.items.append({"p": p if w > 0 else 0, "w": w, "g": group, "text": text.replace(".", ",")})

    def score(self, groups=None):
        it = [x for x in self.items if x["w"] > 0 and (groups is None or x["g"] in groups)]
        if not it:
            return None
        return sum(x["p"] * x["w"] for x in it) / max(sum(x["w"] for x in it), 3.0)

    def count(self, groups):
        return sum(1 for x in self.items if x["g"] in groups and x["w"] > 0)


def _price_points(pts, price, tech, backed, rel, market_name, crypto=False, intrinsic=None):
    """Kurslage. Ein gefallener Kurs ist allein kein Grund. Er zählt nur, wenn die Kennzahlen positiv sind und der Markt
    überreagiert hat: Der Kurs fiel deutlich stärker als der innere Wert (Gewinnschätzungen bzw. Einnahmen).
    intrinsic = (Änderung des inneren Werts in %, Kursänderung im selben Zeitraum in %, was, Zeitraum)."""
    if not tech:
        return
    low = []
    if tech.get("sma200"):
        r = price / tech["sma200"]
        if r < (0.85 if crypto else 0.9):
            low.append("Kurs %.0f %% unter der 200-Tage-Linie" % ((1 - r) * 100))
        elif r > (1.6 if crypto else 1.25):
            pts.add(-1, "Kurs %.0f %% über der 200-Tage-Linie" % ((r - 1) * 100), 0.5, "kurs")
    if tech.get("range_pos") is not None and tech["range_pos"] < 0.2:
        low.append("nahe am 52-Wochen-Tief")
    elif tech.get("range_pos") is not None and tech["range_pos"] > 0.92:
        pts.add(-1, "Nahe am 52-Wochen-Hoch", 0.25, "kurs")
    if not low:
        return
    text = low[0] + (" und " + low[1] if len(low) > 1 else "")
    if not backed:
        pts.add(0, text + ": zählt nicht, weil die Kennzahlen den Rückgang nicht als Chance stützen", 0, "kurs")
        return
    val, px, what, win = intrinsic or (None, None, "", "")
    if val is not None:
        cut, drop, gap = (-15, -15, -20) if crypto else (-5, -10, -15)
        if val <= cut:
            pts.add(0, text + ": zählt nicht, %s sanken %s um %.0f %%, der Rückgang ist begründet" % (what, win, -val), 0, "kurs")
        elif px is not None and px <= drop and px - val <= gap:
            pts.add(1, text + ": zählt, der Kurs fiel %s um %.0f %%, %s %s, der Markt hat wohl überreagiert"
                    % (win, -px, what, "stiegen um %.0f %%" % val if val >= 1 else "blieben stabil"), 0.75, "kurs")
        else:
            pts.add(0, text + ": zählt nicht, kein Zeichen für eine Übertreibung (Kurs %s %+.0f %%, %s %+.0f %%)"
                    % (win, px or 0, what, val), 0, "kurs")
        return
    # Ohne Daten zum inneren Wert: nur der Vergleich mit dem Gesamtmarkt, und nur mit kleinem Gewicht
    limit = -20 if crypto else -15
    if rel is not None and rel < limit:
        pts.add(0, text + ": zählt nicht, der Titel fiel in 6 Monaten %.0f Punkte stärker als %s" % (-rel, market_name), 0, "kurs")
    elif rel is not None:
        pts.add(1, text + ", im Gleichschritt mit %s gefallen (ohne Daten zum inneren Wert, zählt wenig)" % market_name, 0.25, "kurs")
    else:
        pts.add(0, text + ": zählt nicht, ohne Daten zum inneren Wert lässt sich keine Übertreibung erkennen", 0, "kurs")


def est_change(fund):
    """Änderung der Gewinnschätzung für das nächste Geschäftsjahr in 90 Tagen, in Prozent, begrenzt auf ±100.
    Bei Verlusten oder Gewinnen nahe null bezogen auf den Betrag, damit die Richtung stimmt."""
    fund = fund or {}
    if fund.get("est_chg_90d") is not None:
        return max(-100.0, min(100.0, fund["est_chg_90d"]))
    now, old = fund.get("est_eps"), fund.get("est_eps_90d")
    if now is None or not old:
        return None
    return max(-100.0, min(100.0, (now - old) / abs(old) * 100))


def _intrinsic_points(pts, fund):
    """Hat sich am inneren Wert etwas geändert? Gemessen an den Gewinnschätzungen der Analysten. Zählt voll."""
    chg = est_change(fund)
    if chg is None:
        return None
    yr = fund.get("est_year") or "das nächste Jahr"
    raw = fund.get("est_chg_90d")
    if raw is not None and abs(raw) <= 100:
        how = "um %.0f %%" % abs(chg)
    else:   # Verlust, Vorzeichenwechsel oder winzige Basis: Betrag je Aktie statt Prozent
        how = "von %s auf %s je Aktie" % (("%.2f" % fund["est_eps_90d"]), ("%.2f" % fund["est_eps"]))
    if chg >= 5:
        pts.add(1, "Gewinnschätzung für %s in 3 Monaten %s angehoben" % (yr, how), 1.0, "qual")
    elif chg <= -10:
        pts.add(-2, "Gewinnschätzung für %s in 3 Monaten %s gesenkt: der innere Wert ist gesunken, deshalb höchstens %d Punkte"
                % (yr, how, 5 if chg <= -25 else 6), 1.0, "qual")
    elif chg <= -3:
        pts.add(-1, "Gewinnschätzung für %s in 3 Monaten %s gesenkt" % (yr, how), 1.0, "qual")
    else:
        pts.add(0, "Gewinnschätzung für %s in 3 Monaten kaum verändert (%+.0f %%)" % (yr, chg), 1.0, "qual")
    return chg


def stock_valuation(price, tech, fund, div):
    """Kennzahlen zählen voll, Analystenziel und Dividende halb, die Kurslage nur gestützt (siehe _price_points)."""
    fund = fund or {}
    pts = _Points()
    peg, pe, fpe = fund.get("peg"), fund.get("pe"), fund.get("forward_pe")
    # --- Bewertung: was man für Gewinn und Geldfluss zahlt
    if peg and peg > 0:
        pts.add(2 if peg < 1 else 1 if peg < 1.5 else -2 if peg > 2.5 else -1 if peg > 2 else 0,
                "PEG %.1f: %s" % (peg, "Wachstum ist günstig bewertet" if peg < 1 else "Bewertung passt zum Wachstum" if peg < 1.5
                                  else "viel Wachstum eingepreist" if peg > 2.5 else "eher teuer für das Wachstum" if peg > 2 else "neutral"))
    if fpe and fpe > 0:
        pts.add(1 if fpe < 12 else -2 if fpe > 35 else -1 if fpe > 25 else 0,
                "Erwartetes KGV %.0f: %s" % (fpe, "niedrig" if fpe < 12 else "sehr hoch" if fpe > 35 else "hoch" if fpe > 25 else "im üblichen Rahmen"))
    elif pe and pe > 0:
        pts.add(1 if pe < 12 else -1 if pe > 30 else 0, "KGV %.0f" % pe)
    # Bei Titeln, die in anderer Währung bilanzieren als sie notieren (ADRs), passen diese beiden Kennzahlen nicht zusammen
    same_cur = not fund.get("fin_currency") or not fund.get("quote_currency") or fund["fin_currency"] == fund["quote_currency"]
    ev = fund.get("ev_ebitda") if same_cur else None
    if ev and ev > 0:
        pts.add(1 if ev < 10 else -2 if ev > 40 else -1 if ev > 25 else 0,
                "Unternehmenswert ist das %.0f-Fache des Betriebsgewinns (EV/EBITDA)" % ev)
    fcf, cap = fund.get("fcf"), fund.get("market_cap")
    if fcf is not None and cap and same_cur:
        y = fcf / cap * 100
        pts.add(2 if y > 6 else 1 if y > 4 else -2 if y < 0 else -1 if y < 1.5 else 0,
                ("Freier Geldfluss %.1f %% vom Börsenwert" % y) if y >= 0 else "Freier Geldfluss ist negativ")
    # --- Qualität und Wachstum
    if fpe and fpe > 0 and pe and pe > 0:
        if fpe < pe * 0.85:
            pts.add(1, "Gewinne sollen deutlich steigen (KGV %.0f, erwartet %.0f)" % (pe, fpe), 1.0, "qual")
        elif fpe > pe * 1.05:
            pts.add(-1, "Gewinne sollen sinken (KGV %.0f, erwartet %.0f)" % (pe, fpe), 1.0, "qual")
    g = fund.get("revenue_growth")
    if g is not None:
        g *= 100
        pts.add(1 if g > 15 else -2 if g < -10 else -1 if g < 0 else 0,
                "Umsatz %+.0f %% zum Vorjahr" % (round(g) or 0.0), 1.0, "qual")
    m = fund.get("margin")
    loss = (m is not None and m < 0) or (fund.get("eps") is not None and fund["eps"] < 0)
    if loss:
        pts.add(-2, "Das Unternehmen schreibt Verlust", 1.0, "qual")
    elif m is not None:
        pts.add(1 if m > 0.2 else 0, "Gewinnmarge %.0f %%" % (m * 100), 1.0, "qual")
    roe = fund.get("roe")
    if roe is not None and not loss and roe > 0.2:
        pts.add(1, "Eigenkapitalrendite %.0f %%" % (roe * 100), 0.5, "qual")
    # --- Sicht des Marktes: zählt halb, weil Kursziele dem Kurs oft hinterherlaufen
    tm = fund.get("target_mean")
    if tm and price:
        up = (tm / price - 1) * 100
        n = int(fund.get("analysts") or 0)
        pts.add(2 if up > 25 else 1 if up > 10 else -2 if up < -5 else -1 if up < 0 else 0,
                "Analystenziel im Mittel %+.0f %% zum Kurs" % up + (" (%d Analysten)" % n if n else ""), 0.5, "markt")
    if div and div.get("yield_pct") and div.get("yield_5y_avg"):
        y, avg = div["yield_pct"], div["yield_5y_avg"]
        if y > avg * 1.15:
            pts.add(1, "Dividendenrendite %.1f %% über dem 5-Jahres-Schnitt (%.1f %%)" % (y, avg), 0.5, "markt")
        elif y < avg * 0.8:
            pts.add(-1, "Dividendenrendite %.1f %% unter dem 5-Jahres-Schnitt (%.1f %%)" % (y, avg), 0.5, "markt")
    est = _intrinsic_points(pts, fund)
    core = pts.score(("wert", "qual"))
    has_core = pts.count(("wert", "qual")) >= 2
    _price_points(pts, price, tech, has_core and core is not None and core > 0, (tech or {}).get("rel_6m"), "der Gesamtmarkt",
                  intrinsic=(est, (tech or {}).get("perf_3m"), "die Gewinnschätzungen", "in 3 Monaten") if est is not None else None)
    if not has_core:
        # ETFs, ETCs und Titel ohne Kennzahlen: keine Punkte, nur die Kurslage als Wort
        lage = _lage(price, tech)
        if lage is None:
            return None
        return {"score": None, "rating": None, "label": rating_label(rating(lage), "price"), "basis": "nur Kurslage, keine Kennzahlen zum Bewerten",
                "reasons": _plain([x for x in pts.items if x["g"] == "kurs"]) or [{"p": 0, "w": 0, "g": "kurs", "text": "Kurs im mittleren Bereich der 52-Wochen-Spanne"}]}
    score = pts.score()
    if loss:
        score = min(score, -0.2)      # Verlustbringer gelten nie als günstig
    if est is not None and est <= -10:
        score = min(score, -0.2 if est <= -25 else 0.3)   # innerer Wert gesunken: niedriger Kurs ist kein Schnäppchen
    points = rating(score)
    return {"score": round(score, 2), "rating": points, "label": rating_label(points, "stock"),
            "basis": "Kennzahlen voll, Kursziele halb, gefallener Kurs nur bei Überreaktion", "reasons": pts.items}


def _plain(items):
    """Ohne Kennzahlen: der Hinweis zur Kurslage ohne Bezug auf Kennzahlen."""
    old = ": zählt nicht, weil die Kennzahlen den Rückgang nicht als Chance stützen"
    return [dict(x, text=x["text"].replace(old, ": gibt allein keine Punkte")) for x in items]


def _lage(price, tech):
    """Reine Kurslage als Zahl, nur für die Wortwahl bei Titeln ohne Kennzahlen."""
    if not tech or not price:
        return None
    s = 0.0
    if tech.get("sma200"):
        r = price / tech["sma200"]
        s += 0.7 if r < 0.9 else -0.7 if r > 1.25 else 0
    if tech.get("range_pos") is not None:
        s += 0.5 if tech["range_pos"] < 0.25 else -0.5 if tech["range_pos"] > 0.9 else 0
    return s


def crypto_valuation(price, tech, flow, onchain=None):
    """Protokolle mit Einnahmen bekommen Punkte aus Marktwert zu Einnahmen. Coins ohne Einnahmen nur ein Wort zur Marktlage."""
    if not tech:
        return None
    pts = _Points()
    oc = onchain or {}
    has_rev = oc.get("type") == "protocol" and oc.get("pe")
    if has_rev:
        pe = oc["pe"]
        txt = "Marktwert ist das %.0f-Fache der Jahreseinnahmen" % pe
        if pe > 100 and (oc.get("ps") or 999) < 25:
            pts.add(-1, "Das Protokoll behält nur einen kleinen Teil der Gebühren, " + txt[0].lower() + txt[1:])
        else:
            pts.add(2 if pe < 10 else 1 if pe < 25 else -2 if pe > 100 else -1 if pe > 50 else 0,
                    txt + (": niedrig" if pe < 25 else ": hoch" if pe > 50 else ": im Mittelfeld"))
        if oc.get("pe_fdv") and oc["pe_fdv"] > pe * 2:
            pts.add(-1, "Mit allen noch gesperrten Token wäre es das %.0f-Fache" % oc["pe_fdv"])
        chg = oc.get("rev_chg")
        if chg is not None and abs(chg) > 25:
            pts.add(1 if chg > 0 else -1, "Einnahmen %.0f %% %s dem Vormonat" % (abs(chg), "über" if chg > 0 else "unter"), 1.0, "qual")
        hy = oc.get("holder_yield")
        if hy is not None:
            pts.add(1 if hy > 5 else 0, "%.1f %% der Einnahmen pro Jahr fließen an Token-Halter" % hy if hy else "Token-Halter bekommen nichts von den Einnahmen", 1.0, "qual")
    f = (flow or {}).get("funding_avg")
    if f is not None:
        if f > 0.03:
            pts.add(-1, "Funding %.3f %% je 8 Std.: viele gehebelte Longs" % f, 0.5, "markt")
        elif f < -0.005:
            pts.add(1, "Funding %.3f %% je 8 Std.: Markt ist short positioniert" % f, 0.5, "markt")
    if tech.get("rsi") is not None and tech["rsi"] > 75:
        pts.add(-1, "RSI %.0f: kurzfristig überkauft" % tech["rsi"], 0.25, "kurs")
    core = pts.score(("wert", "qual"))
    rc = oc.get("rev_chg") if has_rev else None
    _price_points(pts, price, tech, bool(has_rev) and core is not None and core > 0, tech.get("rel_6m"), "Bitcoin", crypto=True,
                  intrinsic=(rc, tech.get("perf_1m"), "die Einnahmen", "im letzten Monat") if rc is not None else None)
    if not has_rev:
        lage = _lage(price, tech) or 0.0
        why = ("Blockchains werden nicht über Gebühren bewertet" if oc.get("type") == "chain" else "Keine Einnahmen bekannt, die sich bewerten lassen")
        return {"score": None, "rating": None, "label": rating_label(rating(lage), "crypto"), "basis": "nur Marktlage, keine Punkte",
                "reasons": [{"p": 0, "w": 0, "g": "wert", "text": why + ": deshalb keine Punkte"}] + _plain([x for x in pts.items if x["g"] != "wert"])}
    score = pts.score()
    points = rating(score)
    return {"score": round(score, 2), "rating": points, "label": rating_label(points, "stock"),
            "basis": "Einnahmen des Protokolls voll, Hebel halb, gefallener Kurs nur bei Überreaktion", "reasons": pts.items}


def move_read(chg, valuation, kind="stock"):
    """Ordnet eine Tagesbewegung nach der Bewertung ein. Dieselben Sätze stehen in web/views.js (moveRead)."""
    if chg is None or not valuation or valuation.get("score") is None:
        return ""
    points, up = valuation.get("rating") or rating(valuation["score"]), chg >= 0
    cheap, dear = points >= 7, points <= 4
    if kind == "crypto":
        if up:
            return ("Der Anstieg trifft auf einen schon überhitzten Markt." if dear else
                    "Der Anstieg kommt aus einer abgekühlten Lage." if cheap else "Die Marktlage war neutral.")
        return ("Der Rückgang baut Überhitzung ab, günstig ist der Coin dadurch noch nicht." if dear else
                "Rücksetzer in einer schon abgekühlten Lage." if cheap else "Die Marktlage war neutral.")
    if up:
        return ("Der Anstieg macht eine schon teure Aktie noch teurer." if dear else
                "Der Anstieg kommt von niedrigem Bewertungsniveau, laut Kennzahlen ist noch Luft." if cheap else
                "Die Bewertung war fair, mit dem Anstieg wird die Aktie etwas teurer.")
    return ("Der Kurs fällt von hohem Bewertungsniveau, günstig ist die Aktie dadurch noch nicht." if dear else
            "Rücksetzer bei günstiger Bewertung." if cheap else
            "Die Bewertung war fair, der Rückgang macht die Aktie etwas günstiger.")
