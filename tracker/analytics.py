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


def stock_valuation(price, tech, fund, div):
    """Punkte pro Kennzahl: positiv = günstig, negativ = teuer. Ergebnis mit Begründungen."""
    fund = fund or {}
    pts, reasons, fundamental = [], [], 0

    def add(p, text):
        pts.append(p)
        reasons.append({"p": p, "text": text.replace(".", ",")})

    peg, pe, fpe = fund.get("peg"), fund.get("pe"), fund.get("forward_pe")
    if peg and peg > 0:
        fundamental += 1
        if peg < 1:
            add(2, "PEG %.1f: Wachstum ist günstig bewertet" % peg)
        elif peg < 1.5:
            add(1, "PEG %.1f: Bewertung passt zum Wachstum" % peg)
        elif peg > 2.5:
            add(-2, "PEG %.1f: viel Wachstum eingepreist" % peg)
        elif peg > 2:
            add(-1, "PEG %.1f: eher teuer für das Wachstum" % peg)
        else:
            add(0, "PEG %.1f: neutral" % peg)
    if fpe and fpe > 0:
        fundamental += 1
        if fpe < 12:
            add(1, "Erwartetes KGV %.0f: niedrig" % fpe)
        elif fpe > 35:
            add(-2, "Erwartetes KGV %.0f: sehr hoch" % fpe)
        elif fpe > 25:
            add(-1, "Erwartetes KGV %.0f: hoch" % fpe)
        else:
            add(0, "Erwartetes KGV %.0f: im üblichen Rahmen" % fpe)
        if pe and pe > 0:
            if fpe < pe * 0.85:
                add(1, "Gewinne sollen deutlich steigen (KGV %.0f, erwartet %.0f)" % (pe, fpe))
            elif fpe > pe * 1.05:
                add(-1, "Gewinne sollen sinken (KGV %.0f, erwartet %.0f)" % (pe, fpe))
    elif pe and pe > 0:
        fundamental += 1
        add(1 if pe < 12 else -1 if pe > 30 else 0, "KGV %.0f" % pe)
    tm = fund.get("target_mean")
    if tm and price:
        fundamental += 1
        up = (tm / price - 1) * 100
        n = int(fund.get("analysts") or 0)
        txt = "Analystenziel im Mittel %+.0f %% zum Kurs" % up + (" (%d Analysten)" % n if n else "")
        add(2 if up > 25 else 1 if up > 10 else -2 if up < -5 else -1 if up < 0 else 0, txt)
    if div and div.get("yield_pct") and div.get("yield_5y_avg"):
        fundamental += 1
        y, avg = div["yield_pct"], div["yield_5y_avg"]
        if y > avg * 1.15:
            add(1, "Dividendenrendite %.1f %% über dem 5-Jahres-Schnitt (%.1f %%)" % (y, avg))
        elif y < avg * 0.8:
            add(-1, "Dividendenrendite %.1f %% unter dem 5-Jahres-Schnitt (%.1f %%)" % (y, avg))
    if tech:
        if tech.get("sma200"):
            r = price / tech["sma200"]
            if r < 0.9:
                add(1, "Kurs %.0f %% unter der 200-Tage-Linie" % ((1 - r) * 100))
            elif r > 1.25:
                add(-1, "Kurs %.0f %% über der 200-Tage-Linie" % ((r - 1) * 100))
        if tech["range_pos"] < 0.25:
            add(1, "Nahe am 52-Wochen-Tief")
        elif tech["range_pos"] > 0.9:
            add(-1, "Nahe am 52-Wochen-Hoch")
    if not pts:
        if not tech:
            return None
        add(0, "Kurs im mittleren Bereich der 52-Wochen-Spanne, nahe der 200-Tage-Linie")
    score = sum(pts) / max(len(pts), 3)
    if fundamental >= 2:
        label = "eher unterbewertet" if score >= 0.5 else "eher überbewertet" if score <= -0.5 else "fair bewertet"
        basis = "Kennzahlen und Kurslage"
    else:
        label = "Kurs niedrig" if score >= 0.5 else "Kurs hoch" if score <= -0.5 else "Kurs im Mittelfeld"
        basis = "nur Kurslage, Kennzahlen fehlen"
    return {"score": round(score, 2), "label": label, "basis": basis, "reasons": reasons}


def crypto_valuation(price, tech, flow):
    """Für Coins gibt es keine Gewinne: hier zählt Marktlage (Trend, Abstand zum Hoch, Hebel)."""
    if not tech:
        return None
    pts, reasons = [], []

    def add(p, text):
        pts.append(p)
        reasons.append({"p": p, "text": text.replace(".", ",")})

    if tech.get("sma200"):
        r = price / tech["sma200"]
        if r > 1.6:
            add(-2, "Kurs %.0f %% über der 200-Tage-Linie" % ((r - 1) * 100))
        elif r > 1.25:
            add(-1, "Kurs %.0f %% über der 200-Tage-Linie" % ((r - 1) * 100))
        elif r < 0.75:
            add(2, "Kurs %.0f %% unter der 200-Tage-Linie" % ((1 - r) * 100))
        elif r < 0.95:
            add(1, "Kurs %.0f %% unter der 200-Tage-Linie" % ((1 - r) * 100))
    if tech["from_high"] < -50:
        add(1, "%.0f %% unter dem Jahreshoch" % -tech["from_high"])
    elif tech["from_high"] > -8:
        add(-1, "Nahe am Jahreshoch")
    if tech.get("rsi") is not None:
        if tech["rsi"] > 75:
            add(-1, "RSI %.0f: kurzfristig überkauft" % tech["rsi"])
        elif tech["rsi"] < 28:
            add(1, "RSI %.0f: kurzfristig überverkauft" % tech["rsi"])
    f = (flow or {}).get("funding_avg")
    if f is not None:
        if f > 0.03:
            add(-1, "Funding %.3f %% je 8 Std.: viele gehebelte Longs" % f)
        elif f < -0.005:
            add(1, "Funding %.3f %% je 8 Std.: Markt ist short positioniert" % f)
    if not pts:
        if not tech:
            return None
        add(0, "Kurs im mittleren Bereich der 52-Wochen-Spanne, nahe der 200-Tage-Linie")
    score = sum(pts) / max(len(pts), 3)
    label = "abgekühlt" if score >= 0.5 else "überhitzt" if score <= -0.5 else "neutral"
    return {"score": round(score, 2), "label": label, "basis": "Trend, Abstand zum Hoch und Hebel", "reasons": reasons}


def move_read(chg, valuation, kind="stock"):
    """Ordnet eine Tagesbewegung nach der Bewertung ein. Dieselben Sätze stehen in web/views.js (moveRead)."""
    if chg is None or not valuation or valuation.get("score") is None:
        return ""
    sc, up = valuation["score"], chg >= 0
    cheap, dear = sc >= 0.5, sc <= -0.5
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
