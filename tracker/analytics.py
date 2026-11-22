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


MOM_NEAR_HIGH = 15     # Momentum: höchstens so viele Prozent unter dem Jahreshoch
MOM_FADE_DAYS = 20     # „lässt nach“: Signal war in so vielen Handelstagen zuletzt noch an


def momentum(closes, bench=None, crypto=False):
    """Momentum-Signal (Jakobs Wunsch vom 22.11.2026: mehr nach Momentum kaufen statt in fallende Kurse).

    An, wenn alle vier Prüfungen zutreffen (Trendfolge nach gängigen Regeln, z. B. Faber, Minervini):
      trend   Kurs über der 50-Tage-Linie, diese über der 200-Tage-Linie
      rising  die 200-Tage-Linie steigt (gegen vor einem Monat)
      high    höchstens 15 % unter dem Hoch der letzten 12 Monate
      rel     in 6 Monaten besser als der Markt (Aktien und ETFs: S&P 500, Coins: Bitcoin; ohne Vergleich: Kurs im Plus)
    state: on (an), fade (war in den letzten 20 Handelstagen an, Kurs jetzt unter der 50-Tage-Linie, aber über der
    200-Tage-Linie), down (unter der 200-Tage-Linie), none (sonst). since: so viele Handelstage ist das Signal ohne Pause an.
    bench wird vom Ende her ausgerichtet (gleicher Abstand zum letzten Kurs). Faustregel, keine Anlageberatung."""
    year, month = (365, 30) if crypto else (252, 21)
    half, n = year // 2, len(closes)
    if n < 200 + month + 1 or not closes[-1]:
        return None
    ps = [0.0]
    for x in closes:
        ps.append(ps[-1] + x)

    def sma(i, k):
        return (ps[i + 1] - ps[i + 1 - k]) / k if i + 1 >= k else None

    def at(i):
        p, s50, s200, s200m = closes[i], sma(i, 50), sma(i, 200), sma(i - month, 200)
        hi = max(closes[max(0, i - year + 1):i + 1])
        r6 = (p / closes[i - half] - 1) * 100 if i >= half and closes[i - half] else None
        rel = None
        if bench and r6 is not None:
            j = len(bench) - (n - i)
            if j >= half and bench[j - half] and bench[j]:
                rel = r6 - (bench[j] / bench[j - half] - 1) * 100
        chk = {"trend": bool(s50 and s200 and p > s50 > s200), "rising": bool(s200m and s200 > s200m),
               "high": p >= hi * (1 - MOM_NEAR_HIGH / 100.0),
               "rel": (rel > 0) if rel is not None else (r6 is not None and r6 > 0)}
        return chk, p, s50, s200, hi, rel, r6

    look = min(60, n - 200 - month - 1)
    hist = [all(at(n - 1 - k)[0].values()) for k in range(look + 1)]   # hist[0] = heute
    chk, p, s50, s200, hi, rel, r6 = at(n - 1)
    since = 0
    while since < len(hist) and hist[since]:
        since += 1
    if hist[0]:
        state = "on"
    elif p < s200:
        state = "down"
    elif p < s50 and any(hist[:MOM_FADE_DAYS + 1]):
        state = "fade"
    else:
        state = "none"
    r = lambda x, d=1: None if x is None else round(x, d)
    return {"state": state, "since": since, "met": sum(chk.values()), "checks": chk,
            "ma50": r((p / s50 - 1) * 100), "ma200": r((p / s200 - 1) * 100), "from_high": r((p / hi - 1) * 100),
            "rel6": r(rel), "r6": r(r6), "bench": bool(bench)}


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
    # Rhythmus aus den Abständen erkennen und die letzten Zahlungen eines vollen Jahres zählen. Ein starres
    # 365-Tage-Fenster verliert Zahlungen, wenn sich der Ex-Tag um ein paar Tage verschiebt oder Yahoo eine Zahlung spät meldet (oft bei ETFs).
    freq, recent = len(last12), ttm
    if len(divs) >= 3:
        gaps = [b[0] - a[0] for a, b in zip(divs[-9:-1], divs[-8:])]
        gap = statistics.median(gaps) if gaps else 0
        if gap >= 20:
            freq = max(1, min(12, round(365.0 / gap)))
            if divs[-1][0] > today - (gap * 1.5 + 60):      # zahlt noch
                recent = sum(a for _, a in divs[-freq:])
            else:
                recent = 0.0
    if fund.get("div_rate"):
        out["annual"] = fund["div_rate"]
    elif recent:
        out["annual"] = round(recent, 4)
    if out.get("annual") and price:
        out["yield_pct"] = round(out["annual"] / price * 100, 2)
    out["per_year"] = freq
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


# Eingepreiste Erwartungen (Reverse-DCF nach Mauboussin/Rappaport, „Expectations Investing“): nicht schätzen, was die Firma
# wert ist, sondern ausrechnen, welches Wachstum der heutige Kurs voraussetzt, und das mit den Erwartungen vergleichen.
VISION_YEARS, VISION_EXIT_PE, VISION_RATE = 5, 20.0, 0.09


def implied_growth(forward_pe):
    """Gewinnwachstum pro Jahr (in %), das der Kurs voraussetzt: In 5 Jahren soll die Aktie noch das 20-Fache ihres Gewinns
    wert sein (übliches KGV einer reifen Tech-Firma) und bis dahin 9 % im Jahr bringen. Rechnet mit dem erwarteten KGV."""
    if not forward_pe or forward_pe <= 0:
        return None
    need = forward_pe * (1 + VISION_RATE) ** VISION_YEARS / VISION_EXIT_PE
    return (need ** (1.0 / (VISION_YEARS - 1)) - 1) * 100


def expected_growth(fund):
    """Gewinnwachstum pro Jahr, das Analysten erwarten (in %): Langfrist-Schätzung über 5 Jahre, sonst die Schätzung fürs
    nächste Jahr abgeschwächt (hohes Wachstum lässt meist nach), sonst das Umsatzwachstum abgeschwächt. (Wert, Quelle)."""
    if fund.get("est_g_5y") is not None:
        return min(fund["est_g_5y"], 60.0), "Analysten, 5 Jahre"
    if fund.get("est_g_1y") is not None:
        return min(fund["est_g_1y"], 80.0) * 0.75, "Analysten, nächstes Jahr, abgeschwächt"
    if fund.get("revenue_growth") is not None:
        return min(fund["revenue_growth"] * 100, 80.0) * 0.75, "Umsatzwachstum, abgeschwächt"
    return None, ""


PLAN_POINTS = {("ja", "zu wenig"): 2, ("ja", "passend"): 1, ("ja", "zu viel"): 0, ("teilweise", "zu wenig"): 1,
               ("teilweise", "passend"): 0, ("teilweise", "zu viel"): -1, ("nein", "zu wenig"): 0, ("nein", "passend"): -1,
               ("nein", "zu viel"): -2}


def vision_check(fund, research=None):
    """Wachstum und Vision: Wie viel Zukunft steckt im Kurs, und ist der Plan der Firma realistisch?
    Ergebnis: {"implied", "expected", "source", "diff", "plan"} oder None."""
    imp = implied_growth(fund.get("forward_pe"))
    exp, src = expected_growth(fund)
    out = {}
    if imp is not None and exp is not None:
        out.update(implied=round(imp, 1), expected=round(exp, 1), source=src, diff=round(exp - imp, 1))
    plan = (research or {}).get("plan") if isinstance(research, dict) else None
    if isinstance(plan, dict) and plan.get("realistic") in ("ja", "teilweise", "nein"):
        try:
            age = (datetime.date.today() - datetime.date.fromisoformat(str(research.get("at") or "")[:10])).days
        except ValueError:
            age = 999
        if age <= 150:
            out["plan"] = {k: plan.get(k) for k in ("goal", "analysts", "realistic", "priced_in", "why") if plan.get(k)}
    return out or None


def stock_valuation(price, tech, fund, div, research=None):
    """Kennzahlen zählen voll, Analystenziel und Dividende halb, die Kurslage nur gestützt (siehe _price_points).
    Dazu Wachstum und Vision (vision_check): Vision darf eingepreist sein, wenn sie realistisch ist."""
    fund = fund or {}
    pts = _Points()
    vis = vision_check(fund, research) or {}
    plan = vis.get("plan") or {}
    if vis.get("diff") is not None:
        d, imp = vis["diff"], vis["implied"]
        word = ("kaum Zukunft eingepreist" if d >= 8 else "weniger eingepreist als erwartet" if d >= 3
                else "eingepreist, was realistisch erwartet wird" if d > -3 else "etwas mehr eingepreist als erwartet" if d > -10
                else "deutlich mehr Vision eingepreist, als Analysten erwarten")
        pts.add(2 if d >= 8 else 1 if d >= 3 else 0 if d > -3 else -1 if d > -10 else -2,
                ("Kurs setzt %+.0f %% Gewinnwachstum pro Jahr voraus" % imp if imp >= 0 else "Kurs setzt sinkende Gewinne voraus (−%.0f %% pro Jahr)" % -imp)
                + ", erwartet werden %+.0f %% (%s): %s" % (vis["expected"], vis["source"], word), 1.0, "vision")
    if plan:
        p = PLAN_POINTS.get((plan.get("realistic"), plan.get("priced_in")), 0)
        pts.add(p, "Plan der Firma laut Recherche %s, %s" % (
            {"ja": "realistisch", "teilweise": "teilweise realistisch", "nein": "kaum realistisch"}[plan["realistic"]],
            {"zu wenig": "im Kurs noch nicht voll enthalten", "passend": "im Kurs angemessen enthalten",
             "zu viel": "im Kurs schon mehr als enthalten"}.get(plan.get("priced_in"), "Einpreisung offen")), 0.5, "vision")
    # Vision darf eingepreist sein: Setzt der Kurs nicht mehr voraus, als erwartet wird, und hält die Recherche den Plan
    # nicht für unrealistisch, zählen hohe Bewertungskennzahlen nur halb.
    vision_ok = vis.get("diff") is not None and vis["diff"] > -3 and plan.get("realistic") != "nein"
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
    if vision_ok:
        for x in pts.items:
            if x["g"] == "wert" and x["p"] < 0 and x["w"] == 1.0 and x["text"].startswith(("PEG", "Erwartetes KGV", "KGV", "Unternehmenswert")):
                x["w"] = 0.5
                x["text"] += " – durch realistisches Wachstum gedeckt"
    est = _intrinsic_points(pts, fund)
    core = pts.score(("wert", "qual", "vision"))
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
    out = {"score": round(score, 2), "rating": points, "label": rating_label(points, "stock"),
           "basis": "Kennzahlen und eingepreistes Wachstum voll, Kursziele und Recherche halb, gefallener Kurs nur bei Überreaktion",
           "reasons": pts.items}
    if vis:
        out["vision"] = vis
    return out


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


# ----------------------------------------------------------------- Angst und Gier (Aktienmarkt, eigene Berechnung)
FG_PARTS = (
    ("momentum", "Schwung", "S&P 500 gegenüber seinem 125-Tage-Schnitt"),
    ("vola", "Schwankung", "VIX gegenüber seinem 50-Tage-Schnitt (hoch = Angst)"),
    ("haven", "Sichere Häfen", "Aktien gegen Staatsanleihen, Rendite 20 Tage"),
    ("junk", "Ramschanleihen", "Hochzinsanleihen gegen Staatsanleihen, Rendite 20 Tage"),
    ("breadth", "Marktbreite", "durchschnittliche Aktie: gleichgewichteter S&P 500 gegenüber seinem 50-Tage-Schnitt"),
)


def fg_label(v):
    return "Extreme Angst" if v < 25 else "Angst" if v < 45 else "Neutral" if v <= 55 else "Gier" if v <= 75 else "Extreme Gier"


def market_fear_greed(hist, window=252):
    """Angst-und-Gier-Index nach dem Vorbild von CNN aus frei verfügbaren Kursen. hist: Kürzel -> (Tage, Schlusskurse).
    Jeder Baustein wird mit seinem eigenen letzten Jahr verglichen (Rang 0 bis 100), der Index ist der Schnitt."""
    need = ("^GSPC", "^VIX", "SPY", "TLT", "HYG", "IEF", "RSP")
    if any(not hist.get(s) or len(hist[s][0]) < 200 for s in need):
        return None
    days = sorted(set.intersection(*(set(hist[s][0]) for s in need)))
    px = {s: dict(zip(*hist[s])) for s in need}
    c = {s: [px[s][d] for d in days] for s in need}

    def ma(xs, i, n):
        return sum(xs[i - n + 1:i + 1]) / n if i >= n - 1 else None

    def ret(xs, i, n=20):
        return xs[i] / xs[i - n] - 1 if i >= n and xs[i - n] else None

    raw = {k: [] for k, _, _ in FG_PARTS}
    for i in range(len(days)):
        m = ma(c["^GSPC"], i, 125)
        raw["momentum"].append(c["^GSPC"][i] / m - 1 if m else None)
        m = ma(c["^VIX"], i, 50)
        raw["vola"].append(-(c["^VIX"][i] / m - 1) if m else None)
        a, b = ret(c["SPY"], i), ret(c["TLT"], i)
        raw["haven"].append(a - b if a is not None and b is not None else None)
        a, b = ret(c["HYG"], i), ret(c["IEF"], i)
        raw["junk"].append(a - b if a is not None and b is not None else None)
        m = ma(c["RSP"], i, 50)
        raw["breadth"].append(c["RSP"][i] / m - 1 if m else None)

    def score(i):
        parts = {}
        for k, xs in raw.items():
            if xs[i] is None:
                return None
            hist_k = [x for x in xs[max(0, i - window + 1):i + 1] if x is not None]
            if len(hist_k) < 60:
                return None
            parts[k] = round(100 * sum(1 for x in hist_k if x < xs[i]) / (len(hist_k) - 1)) if len(hist_k) > 1 else 50
        return parts

    def at(back):
        i = len(days) - 1 - back
        p = score(i) if i >= 0 else None
        return (round(sum(p.values()) / len(p)), p) if p else (None, None)

    v, parts = at(0)
    if v is None:
        return None
    week, _ = at(5)
    month, _ = at(21)
    hist = [[day_to_iso(days[len(days) - 1 - b]), at(b)[0]] for b in range(0, min(len(days) - 1, 800), 5)]
    return {"value": v, "label": fg_label(v), "week": week, "month": month, "day": day_to_iso(days[-1]),
            "hist": [h for h in reversed(hist) if h[1] is not None],
            "parts": [{"key": k, "name": n, "about": a, "value": parts[k], "label": fg_label(parts[k])} for k, n, a in FG_PARTS]}


# ----------------------------------------------------------------- Smart Money / Dumb Money (eigene Berechnung)
def _cot_index(vals, i, look=156):
    """Stand im Vergleich zu den letzten drei Jahren: 0 = niedrigster, 100 = höchster Wert."""
    win = [x for x in vals[max(0, i - look + 1):i + 1] if x is not None]
    if len(win) < 26 or vals[i] is None:
        return None
    lo, hi = min(win), max(win)
    return 50.0 if hi == lo else (vals[i] - lo) / (hi - lo) * 100


SMART_GROUPS = (("lev", "Hedgefonds"), ("dealer", "Investmentbanken"), ("asset", "Große Fondsgesellschaften"))
DUMB_GROUPS = (("small", "Kleinanleger"),)


def _action(chg1, chg4):
    """Was eine Gruppe gerade tut, aus der Änderung ihrer Netto-Position in Prozent des offenen Interesses."""
    if chg1 >= 1.0 or (chg4 >= 2.5 and chg1 > -0.5):
        return "kauft"
    if chg1 <= -1.0 or (chg4 <= -2.5 and chg1 < 0.5):
        return "verkauft"
    return "hält"


def smart_dumb(rows, crowd):
    """Smart Money: Hedgefonds, Investmentbanken und große Fondsgesellschaften, je Gruppe als Rang ihrer Netto-Position
    in drei Jahren (0 bis 100), dann gemittelt. Dumb Money: Kleinanleger (nicht meldepflichtig) als Rang, zur Hälfte mit
    Angst und Gier gemischt. Dazu je Gruppe, ob sie zuletzt gekauft, gehalten oder verkauft hat (Änderung in Prozent des
    offenen Interesses, eine und vier Wochen). rows: cftc_tff, älteste zuerst. crowd: {Datum: 0..100}."""
    if len(rows) < 30:
        return None
    share = {g: [r[g] / r["oi"] * 100 for r in rows] for g, _ in SMART_GROUPS + DUMB_GROUPS}
    ck = sorted(crowd)

    def crowd_at(d):
        import bisect
        j = bisect.bisect_right(ck, d) - 1
        return crowd[ck[j]] if j >= 0 and (datetime.date.fromisoformat(d) - datetime.date.fromisoformat(ck[j])).days <= 10 else None

    hist = []
    for i, r in enumerate(rows):
        idx = [_cot_index(share[g], i) for g, _ in SMART_GROUPS]
        k = _cot_index(share["small"], i)
        if any(x is None for x in idx) or k is None:
            continue
        c = crowd_at(r["d"])
        hist.append([r["d"], round(sum(idx) / len(idx)), round(k if c is None else (k + c) / 2), round(k), None if c is None else round(c)])
    if not hist:
        return None
    n = len(rows) - 1
    groups = []
    for g, label in SMART_GROUPS + DUMB_GROUPS:
        v = share[g]
        c1, c4 = v[n] - v[n - 1], v[n] - v[max(0, n - 4)]
        groups.append({"key": g, "label": label, "smart": g != "small", "net": rows[n][g], "share": round(v[n], 1),
                       "idx": round(_cot_index(v, n)), "chg1": round(c1, 2), "chg4": round(c4, 2), "action": _action(c1, c4)})
    last = hist[-1]
    return {"day": last[0], "smart": last[1], "dumb": last[2], "small": last[3], "crowd": last[4],
            "prev": {"smart": hist[-2][1], "dumb": hist[-2][2]} if len(hist) > 1 else None,
            "groups": groups, "hist": [h[:3] for h in hist[-104:]]}


def holder_stats(cost, days, closes, years=3):
    """Bitcoin: liegen Kurzfrist- und Langfrist-Anleger im Schnitt im Plus oder Minus?
    cost {ISO-Datum: [Einstand kurz, Einstand lang]} (BGeometrics, 7 Tage verzögert), days/closes Tageskurse in Dollar
    (Tage seit 1970). Für die letzten Tage ohne Einstandspreis gilt der letzte bekannte (er ändert sich langsam)."""
    if not cost or not days or not closes:
        return None
    byday = {}
    for d, v in cost.items():
        try:
            byday[(datetime.date.fromisoformat(d) - datetime.date(1970, 1, 1)).days] = v
        except ValueError:
            continue
    if not byday:
        return None
    last_cost = max(byday)
    rows, cur = [], None
    for d, c in zip(days, closes):
        if d in byday:
            cur = byday[d]
        elif cur is None or d - last_cost > 14 or d < min(byday):
            continue
        if c:
            rows.append([d, round(c, 2), round(cur[0], 2), round(cur[1], 2)])
    if not rows:
        return None
    d, p, s, l = rows[-1]
    pct = lambda a, b: round((a / b - 1) * 100, 1)

    def since(i):   # wie viele Tage schon auf derselben Seite (Plus oder Minus)
        up, n = rows[-1][1] >= rows[-1][i], 0
        for r in reversed(rows):
            if (r[1] >= r[i]) != up:
                return n, r[0]
            n += 1
        return n, None

    def chg(i, back):   # Änderung des Einstandspreises in Prozent
        old = [r for r in rows if r[0] <= d - back]
        return pct(rows[-1][i], old[-1][i]) if old else None

    sn, sl = since(2)
    ln, ll = since(3)
    month = [r for r in rows if r[0] <= d - 30]
    return {"day": d, "asof": (datetime.date(1970, 1, 1) + datetime.timedelta(days=last_cost)).isoformat(),
            "price": p, "sth": s, "lth": l, "sth_pct": pct(p, s), "lth_pct": pct(p, l),
            "sth_month": pct(month[-1][1], month[-1][2]) if month else None, "lth_month": pct(month[-1][1], month[-1][3]) if month else None,
            "sth_days": sn, "lth_days": ln, "sth_flip": sl, "lth_flip": ll, "sth_chg30": chg(2, 30), "lth_chg30": chg(3, 30),
            "hist": [r for r in rows if r[0] > d - 365 * years]}
