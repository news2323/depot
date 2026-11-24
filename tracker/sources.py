"""Datenquellen: Yahoo (Aktien, Währungen), Binance/OKX/Hyperliquid/Bybit (Krypto, Spot und Futures).

Jede Funktion gibt bei einem Ausfall None zurück. Welche Quelle geantwortet hat, steht in STATUS
(nur Quellenname und Zähler, keine Ticker).
"""
import datetime
import http.cookiejar
import re
import statistics
import time
import urllib.parse
import urllib.request

from .common import SourceError, UA, fnum, http_json

STATUS = {}


def _mark(source, ok):
    s = STATUS.setdefault(source, {"ok": 0, "fehler": 0})
    s["ok" if ok else "fehler"] += 1


def _try(source, url, **kw):
    try:
        r = http_json(url, **kw)
        _mark(source, True)
        return r
    except SourceError:
        _mark(source, False)
        return None


# ----------------------------------------------------------------- Yahoo
def yahoo_chart(symbol, rng="5d", interval="1d", events=False):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=%s" % (
        urllib.parse.quote(symbol), rng, interval)
    if events:
        url += "&events=div%2Csplit"
    r = _try("Yahoo Kurse", url)
    try:
        return r["chart"]["result"][0]
    except (TypeError, KeyError, IndexError):
        return None


def _series(res):
    """(Tage seit 1970, Schlusskurse) ohne Lücken."""
    ts = res.get("timestamp") or []
    cl = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    off = (res.get("meta") or {}).get("gmtoffset") or 0
    days, closes = [], []
    for t, c in zip(ts, cl):
        if c is None:
            continue
        d = int((t + off) // 86400)
        if days and days[-1] == d:
            closes[-1] = c
        else:
            days.append(d)
            closes.append(c)
    return days, closes


def _scale(currency):
    """Londoner Titel notieren in Pence (GBp): auf Pfund umrechnen."""
    return ("GBP", 0.01) if currency in ("GBp", "GBX") else (currency, 1.0)


def stock_quote(symbol):
    res = yahoo_chart(symbol)
    if not res:
        return None
    m = res.get("meta") or {}
    days, closes = _series(res)
    price = fnum(m.get("regularMarketPrice")) or (closes[-1] if closes else None)
    if price is None:
        return None
    chg = fnum(m.get("regularMarketChangePercent"))
    if chg is None and len(closes) >= 2 and closes[-2]:
        chg = (price / closes[-2] - 1) * 100
    cur, k = _scale(m.get("currency") or "USD")
    return {"price": price * k, "change_pct": chg, "currency": cur,
            "name": m.get("longName") or m.get("shortName") or "", "exchange": m.get("fullExchangeName") or "",
            "type": m.get("instrumentType") or "", "time": m.get("regularMarketTime")}


# Deutsche Börse für US-Aktien (Jakobs Wunsch vom 23.11.2026): Vor US-Börsenbeginn (15:30 Uhr) gelten die Kurse von
# Xetra bzw. Frankfurt, damit ab 9 Uhr aktuelle Kurse da sind. Das Kürzel sucht Yahoo über den Namen; geprüft wird,
# ob der Kurs in Dollar umgerechnet zum US-Kurs passt (höchstens 12 % Abstand), sonst gilt es als falscher Treffer.
DE_EXCHANGES = ("GER", "FRA", "TDG", "STU", "MUN", "DUS", "BER", "HAM")


DE_KNOWN = {"GOOGL": "ABEA.DE", "GOOG": "ABEC.DE", "TSM": "TSFA.F"}   # findet die Yahoo-Suche nicht


LEGAL = {"inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "n", "v", "nv", "sa", "se",
         "ag", "holdings", "holding", "the", "com", "class", "a", "b", "adr"}


def _name_queries(name, symbol):
    """Suchwörter der Reihe nach: Name ohne Rechtsform („Muster Group N.V.“ → „Muster Group“), voller Name, erstes Wort,
    Kürzel. Die Yahoo-Suche liefert nur wenige Treffer und mit dem vollen Namen oft keinen deutschen."""
    words = re.sub(r"[,.()]", " ", name or "").split()
    full = " ".join(words)
    while words and words[-1].lower() in LEGAL:
        words.pop()
    out = []
    for q in (" ".join(words), full, words[0] if words and len(words[0]) >= 4 else "", symbol.split("-")[0]):
        if q and q not in out:
            out.append(q)
    return out


def german_listing(symbol, name, us_price, eurusd):
    """Deutsches Kürzel oder "" (keins gefunden). None, wenn die Suche selbst scheiterte (dann nichts merken)."""
    tried, failed = set(), False

    def check(sym):
        if sym in tried or len(tried) >= 8:
            return False
        tried.add(sym)
        dq = stock_quote(sym)
        return bool(dq and dq.get("currency") == "EUR" and us_price and eurusd and abs(dq["price"] * eurusd / us_price - 1) < 0.12)

    if symbol in DE_KNOWN and check(DE_KNOWN[symbol]):
        return DE_KNOWN[symbol]
    for q in _name_queries(name, symbol):
        r = _try("Yahoo Suche", "https://query2.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=20&newsCount=0"
                 "&lang=de-DE&region=DE" % urllib.parse.quote(q))
        if r is None:
            failed = True
            continue
        hits = sorted([x for x in r.get("quotes") or [] if x.get("exchange") in DE_EXCHANGES and x.get("quoteType") == "EQUITY"],
                      key=lambda x: DE_EXCHANGES.index(x["exchange"]))
        for x in hits:
            if check(x["symbol"]):
                return x["symbol"]
    return None if failed and not tried else ""


def stock_history(symbol, rng="5y"):
    res = yahoo_chart(symbol, rng=rng, events=True)
    if not res:
        return None
    m = res.get("meta") or {}
    cur, k = _scale(m.get("currency") or "USD")
    days, closes = _series(res)
    off = m.get("gmtoffset") or 0
    divs = sorted((int((int(v.get("date") or t) + off) // 86400), (fnum(v.get("amount")) or 0) * k)
                  for t, v in (((res.get("events") or {}).get("dividends")) or {}).items())
    return {"d": days, "c": [round(c * k, 4) for c in closes], "div": divs, "currency": cur,
            "name": m.get("longName") or m.get("shortName") or ""}


def fx_rate(cur):
    """Wie viele Einheiten der Währung ein Euro kostet (EUR=1)."""
    if cur == "EUR":
        return 1.0
    q = stock_quote("EUR%s=X" % cur)
    return q["price"] if q else None


def fx_history(cur, rng="5y"):
    res = yahoo_chart("EUR%s=X" % cur, rng=rng)
    if not res:
        return None
    days, closes = _series(res)
    return {"d": days, "c": [round(c, 5) for c in closes]}


class YahooFundamentals:
    """Kennzahlen über quoteSummary. Yahoo sperrt Rechenzentren gelegentlich aus: dann bleibt alles leer
    und die KI-Recherche liefert die Zahlen."""

    MODULES = ("summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile,earningsTrend,earningsHistory,"
               "recommendationTrend,upgradeDowngradeHistory,insiderTransactions,topHoldings")

    def __init__(self):
        self.crumb = None
        self.dead = False
        self.extra = {}   # je Symbol: insider, analyst, sectors (aus demselben Abruf)
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def _login(self):
        try:
            http_json("https://fc.yahoo.com", opener=self.opener, raw=True, timeout=10)
        except SourceError:
            pass  # antwortet mit 404, setzt aber das Cookie
        try:
            self.crumb = http_json("https://query1.finance.yahoo.com/v1/test/getcrumb",
                                   opener=self.opener, raw=True, timeout=10).strip()
        except SourceError:
            self.crumb = None
        if not self.crumb or len(self.crumb) > 40:
            self.dead = True

    def get(self, symbol):
        if self.dead:
            return None
        if not self.crumb:
            self._login()
            if self.dead:
                _mark("Yahoo Kennzahlen", False)
                return None
        url = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/%s?modules=%s&crumb=%s" % (
            urllib.parse.quote(symbol), self.MODULES, urllib.parse.quote(self.crumb))
        r = _try("Yahoo Kennzahlen", url, opener=self.opener)
        try:
            d = r["quoteSummary"]["result"][0]
        except (TypeError, KeyError, IndexError):
            return None

        def raw(mod, key):
            v = (d.get(mod) or {}).get(key)
            return fnum(v.get("raw")) if isinstance(v, dict) else fnum(v)

        cal = d.get("calendarEvents") or {}
        earn = [x.get("raw") for x in ((cal.get("earnings") or {}).get("earningsDate") or []) if isinstance(x, dict)]
        prof = d.get("assetProfile") or {}
        out = {
            "pe": raw("summaryDetail", "trailingPE"), "forward_pe": raw("summaryDetail", "forwardPE"),
            "peg": raw("defaultKeyStatistics", "pegRatio"), "pb": raw("defaultKeyStatistics", "priceToBook"),
            "ev_ebitda": raw("defaultKeyStatistics", "enterpriseToEbitda"),
            "eps": raw("defaultKeyStatistics", "trailingEps"), "forward_eps": raw("defaultKeyStatistics", "forwardEps"),
            "market_cap": raw("summaryDetail", "marketCap"),
            "div_rate": raw("summaryDetail", "dividendRate"), "div_yield": raw("summaryDetail", "dividendYield"),
            "div_yield_5y": raw("summaryDetail", "fiveYearAvgDividendYield"),
            "payout": raw("summaryDetail", "payoutRatio"),
            "target_mean": raw("financialData", "targetMeanPrice"), "target_low": raw("financialData", "targetLowPrice"),
            "target_high": raw("financialData", "targetHighPrice"),
            "analysts": raw("financialData", "numberOfAnalystOpinions"),
            "recommendation": (d.get("financialData") or {}).get("recommendationKey"),
            "revenue_growth": raw("financialData", "revenueGrowth"),
            "earnings_growth": raw("financialData", "earningsGrowth"),
            "margin": raw("financialData", "profitMargins"),
            "op_margin": raw("financialData", "operatingMargins"), "roe": raw("financialData", "returnOnEquity"),
            "fcf": raw("financialData", "freeCashflow"), "debt_equity": raw("financialData", "debtToEquity"),
            "fin_currency": (d.get("financialData") or {}).get("financialCurrency"),
            "quote_currency": (d.get("summaryDetail") or {}).get("currency"),
            "ex_div": raw("calendarEvents", "exDividendDate"), "div_pay": raw("calendarEvents", "dividendDate"),
            "earnings_date": earn[0] if earn else None,
            "sector": prof.get("sector"), "industry": prof.get("industry"),
            "website": prof.get("website"), "ir_website": prof.get("irWebsite"),
            "summary_en": (prof.get("longBusinessSummary") or "")[:900] or None,
        }
        out.update(_eps_trend(d.get("earningsTrend")))
        out.update(_surprises(d.get("earningsHistory")))
        extra = {"insider": _insider(d.get("insiderTransactions")),
                 "analyst": _analyst(d.get("recommendationTrend"), d.get("upgradeDowngradeHistory")),
                 "sectors": _sectors(d.get("topHoldings"))}
        self.extra[symbol] = {k: v for k, v in extra.items() if v}
        return {k: v for k, v in out.items() if v not in (None, "")}


def _raw(v):
    return fnum(v.get("raw")) if isinstance(v, dict) else fnum(v)


def _day(ts):
    return datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")


def _insider(mod, days=365):
    """Käufe und Verkäufe von Vorständen, Direktoren und Großaktionären (US-Meldungen, Form 4).
    Zuteilungen, Optionen und Schenkungen sind kein Signal und bleiben weg. Ohne Meldungen (europäische Firmen): None."""
    tx = (mod or {}).get("transactions") or []
    if not tx:
        return None
    now = time.time()
    rows = []
    for t in tx:
        text = t.get("transactionText") or ""
        typ = "buy" if text.startswith("Purchase") else "sell" if text.startswith("Sale") else None
        ts = _raw(t.get("startDate"))
        if not typ or not ts or ts < now - days * 86400:
            continue
        shares, value = _raw(t.get("shares")), _raw(t.get("value"))
        if not value and shares:
            m = re.search(r"price ([\d.]+)", text)
            value = shares * float(m.group(1)) if m else None
        rows.append({"d": _day(ts), "who": _person(t.get("filerName")), "role": t.get("filerRelation") or "",
                     "type": typ, "shares": shares, "value": round(value) if value else None})
    rows.sort(key=lambda r: r["d"], reverse=True)
    half = _day(now - 182 * 86400)
    # Käufe sind seltener und aussagekräftiger: sie bleiben in der Liste, Verkäufe füllen bis 12 Zeilen auf
    buys = [r for r in rows if r["type"] == "buy"][:8]
    keep = buys + [r for r in rows if r["type"] == "sell"][:12 - len(buys)]
    out = {"rows": sorted(keep, key=lambda r: r["d"], reverse=True)}
    for typ in ("buy", "sell"):
        sel = [r for r in rows if r["type"] == typ and r["d"] >= half]
        out[typ + "_6m"] = round(sum(r["value"] or 0 for r in sel))
        out["n_" + typ + "_6m"] = len(sel)
    return out


_FIRM = re.compile(r"\b(INC|LLC|LP|L\.P\.|CORP|CORPORATION|LTD|TRUST|FUND|CAPITAL|PARTNERS|HOLDINGS|GROUP|MANAGEMENT|CO|AG|SA|PLC|FOUNDATION)\b", re.I)


def _person(name):
    """Form 4 nennt Personen als „NACHNAME VORNAME MITTELNAME“. Für die Anzeige: „Vorname M. Nachname“. Firmen bleiben, wie sie sind."""
    name = " ".join((name or "").split())
    parts = name.split(" ")
    if _FIRM.search(name) or not 2 <= len(parts) <= 4:
        return name.title()
    last, rest = parts[0], parts[1:]
    rest = [r + "." if len(r) == 1 else r for r in rest]
    return " ".join(rest + [last]).title()


def _analyst(rt, ud, days=90):
    """Urteile der Analysten heute und vor drei Monaten (Anzahl je Stufe) und ihre letzten Änderungen."""
    trend = {t.get("period"): t for t in ((rt or {}).get("trend") or []) if isinstance(t, dict)}
    cols = ("strongBuy", "buy", "hold", "sell", "strongSell")
    row = lambda t: [int(t.get(c) or 0) for c in cols] if t else None
    out = {}
    now, before = row(trend.get("0m")), row(trend.get("-3m"))
    if now and sum(now):
        out["now"] = now
    if before and sum(before):
        out["before"] = before
    cut = time.time() - days * 86400
    changes = []
    for h in (ud or {}).get("history") or []:
        ts = fnum(h.get("epochGradeDate"))
        if not ts or ts < cut:
            continue
        changes.append({"d": _day(ts), "firm": h.get("firm") or "", "action": h.get("action") or "",
                        "to": h.get("toGrade") or "", "from": h.get("fromGrade") or "",
                        "pt": fnum(h.get("currentPriceTarget")) or None, "pt_prev": fnum(h.get("priorPriceTarget")) or None,
                        "pt_action": h.get("priceTargetAction") or ""})
    changes.sort(key=lambda c: c["d"], reverse=True)
    if changes:
        out["changes"] = changes[:10]
        out["n_90d"] = len(changes)
        for a in ("up", "down", "init"):
            out[a + "_90d"] = sum(1 for c in changes if c["action"] == a)
        out["pt_up_90d"] = sum(1 for c in changes if c["pt_action"] == "Raises")
        out["pt_down_90d"] = sum(1 for c in changes if c["pt_action"] == "Lowers")
    return out or None


SECTOR_KEYS = {"technology": "Technology", "financial_services": "Financial Services", "healthcare": "Healthcare",
               "consumer_cyclical": "Consumer Cyclical", "consumer_defensive": "Consumer Defensive",
               "communication_services": "Communication Services", "industrials": "Industrials", "energy": "Energy",
               "utilities": "Utilities", "realestate": "Real Estate", "basic_materials": "Basic Materials"}


def _sectors(th):
    """Branchen eines Aktien-ETFs (Anteile 0 bis 1). Rohstoff- und Swap-ETFs (kaum Aktien im Bestand): None."""
    th = th or {}
    stock = _raw(th.get("stockPosition"))
    w = {}
    for x in th.get("sectorWeightings") or []:
        for k, v in x.items():
            val = _raw(v)
            if val and val > 0 and k in SECTOR_KEYS:
                w[SECTOR_KEYS[k]] = round(val, 4)
    if not w or (stock is not None and stock < 0.5):
        return None
    return w


def _surprises(mod):
    """Überraschungen bei den letzten (bis zu 4) Quartalszahlen: Gewinn je Aktie gegen die Erwartung."""
    rows = []
    for h in (mod or {}).get("history") or []:
        g = lambda k: fnum(h[k].get("raw")) if isinstance(h.get(k), dict) else fnum(h.get(k))
        act, est = g("epsActual"), g("epsEstimate")
        if act is not None and est is not None and est > 0:
            rows.append((act / est - 1) * 100)
    if not rows:
        return {}
    rows = rows[-4:]
    return {"surprise_avg": round(sum(rows) / len(rows), 1), "beats": sum(1 for x in rows if x > 0), "beats_n": len(rows)}


def _eps_trend(mod):
    """Wie sich die Gewinnschätzung der Analysten für das nächste Geschäftsjahr in 30 und 90 Tagen verändert hat.
    Das ist der beste frei verfügbare Hinweis darauf, ob sich am inneren Wert etwas geändert hat."""
    trend = {t.get("period"): t for t in ((mod or {}).get("trend") or []) if isinstance(t, dict)}
    for period in ("+1y", "0y"):
        t = trend.get(period)
        e = (t or {}).get("epsTrend") or {}
        val = lambda k: fnum(e[k].get("raw")) if isinstance(e.get(k), dict) else fnum(e.get(k))
        now, d30, d90 = val("current"), val("30daysAgo"), val("90daysAgo")
        if now is None or d90 is None:
            continue
        rev = t.get("epsRevisions") or {}
        num = lambda k: fnum(rev[k].get("raw")) if isinstance(rev.get(k), dict) else fnum(rev.get(k))
        out = {"est_period": period, "est_year": str(t.get("endDate") or "")[:4], "est_eps": now, "est_eps_90d": d90,
               "est_up_30d": num("upLast30days"), "est_down_30d": num("downLast30days")}
        if d30 is not None:
            out["est_eps_30d"] = d30
        # Erwartetes Wachstum laut Analysten: Gewinn je Aktie nächstes Jahr, Umsatz nächstes Jahr, Gewinn pro Jahr über 5 Jahre
        gr = lambda x: fnum(x.get("raw")) if isinstance(x, dict) else fnum(x)
        for name, per, sub in (("est_g_1y", "+1y", None), ("est_g_5y", "+5y", None), ("rev_g_1y", "+1y", "revenueEstimate"),
                               ("rev_g_0y", "0y", "revenueEstimate")):
            src = trend.get(per) or {}
            v = gr((src.get(sub) or {}).get("growth")) if sub else gr(src.get("growth"))
            if v is not None and -1 < v < 10:
                out[name] = round(v * 100, 1)
        # Prozent nur, wenn beide Werte positiv sind. Bei Verlusten ist eine Prozentänderung irreführend.
        if now > 0 and d90 > 0:
            out["est_chg_90d"] = (now / d90 - 1) * 100
        return out
    return {}


# ----------------------------------------------------------------- Stimmung (frei nutzbar, ohne Schlüssel)
APEWISDOM = "https://apewisdom.io/api/v1.0/filter/%s/page/%d"


def reddit_buzz(symbols):
    """Wie oft ein Titel in den letzten 24 Stunden auf Reddit genannt wurde (ApeWisdom zählt die großen Börsen-Foren).
    symbols: (kind, symbol). Aktien nur mit US-Kürzel, europäische Börsenkürzel kennt die Quelle nicht.
    Ergebnis: {"stock:NVDA": {"rank", "mentions", "prev", "upvotes", "rank_prev"}}."""
    want = {"all-stocks": {}, "all-crypto": {}}
    for kind, sym in symbols:
        sym = str(sym).upper()
        if kind == "crypto":
            want["all-crypto"][sym + ".X"] = "crypto:" + sym
        elif "." not in sym:
            want["all-stocks"][sym] = want["all-stocks"][sym.replace("-", ".")] = "stock:" + sym
    out = {}
    for filt, m in want.items():
        if not m:
            continue
        page, pages = 1, 1
        while page <= min(pages, 15):
            r = _try("ApeWisdom (Reddit)", APEWISDOM % (filt, page), timeout=20)
            if not r:
                break
            pages = int(fnum(r.get("pages")) or 1)
            for x in r.get("results") or []:
                key = m.get(str(x.get("ticker") or "").upper())
                if key and key not in out:
                    out[key] = {"rank": int(fnum(x.get("rank")) or 0), "mentions": int(fnum(x.get("mentions")) or 0),
                                "prev": int(fnum(x.get("mentions_24h_ago")) or 0), "upvotes": int(fnum(x.get("upvotes")) or 0),
                                "rank_prev": int(fnum(x.get("rank_24h_ago")) or 0) or None}
            page += 1
    return out


def crypto_fear_greed():
    """Angst-und-Gier-Index für Krypto (alternative.me, 0 = extreme Angst, 100 = extreme Gier), heute und gestern."""
    r = _try("Fear & Greed", "https://api.alternative.me/fng/?limit=2", timeout=20)
    d = (r or {}).get("data") or []
    if not d or fnum(d[0].get("value")) is None:
        return None
    return {"value": int(fnum(d[0]["value"])), "prev": int(fnum(d[1]["value"])) if len(d) > 1 and fnum(d[1].get("value")) is not None else None,
            "label": d[0].get("value_classification") or ""}


# ----------------------------------------------------------------- Krypto
BINANCE_SPOT = "https://data-api.binance.vision/api/v3"   # öffentlicher Marktdaten-Spiegel, weltweit erreichbar
BINANCE_FUT = "https://fapi.binance.com"                  # aus den USA (GitHub-Server) meist gesperrt
OKX = "https://www.okx.com/api/v5"
BYBIT = "https://api.bybit.com/v5/market"

_hl_cache = {}
_closes = {}   # Stundenschlusskurse je Coin (für die 4-Stunden-Änderung)
_blocked = set()


def _opt(source, url, **kw):
    """Quelle, die je nach Standort gesperrt sein kann: nach dem ersten harten Fehler nicht weiter versuchen."""
    if source in _blocked:
        return None
    try:
        r = http_json(url, **kw)
        _mark(source, True)
        return r
    except SourceError as e:
        _mark(source, False)
        if any(c in str(e) for c in ("451", "403", "URLError", "timeout", "TimeoutError")):
            _blocked.add(source)
        return None


def hyperliquid():
    """Alle Perps auf Hyperliquid mit Funding, Open Interest und Kurs in einem Abruf."""
    if "d" not in _hl_cache:
        out = {}
        try:
            meta, ctxs = http_json("https://api.hyperliquid.xyz/info", body={"type": "metaAndAssetCtxs"})
            for u, c in zip(meta["universe"], ctxs):
                if u.get("isDelisted"):
                    continue
                name = u["name"].upper()
                mult = 1.0
                if u["name"].startswith("k") and len(u["name"]) > 1 and u["name"][1:].isupper():
                    name, mult = u["name"][1:].upper(), 1000.0   # kPEPE = 1000 PEPE
                px = fnum(c.get("markPx"))
                oi = fnum(c.get("openInterest"))
                out[name] = {"price": px / mult if px else None,
                             "prev": (fnum(c.get("prevDayPx")) or 0) / mult or None,
                             "funding_8h": (fnum(c.get("funding")) or 0) * 8 * 100,
                             "oi_usd": oi * px if oi and px else None,
                             "vol_usd": fnum(c.get("dayNtlVlm"))}
            _mark("Hyperliquid", True)
        except (SourceError, KeyError, TypeError, ValueError):
            _mark("Hyperliquid", False)
        _hl_cache["d"] = out
    return _hl_cache["d"]


def crypto_quote(sym):
    r = _try("Binance Spot", "%s/ticker/24hr?symbol=%sUSDT" % (BINANCE_SPOT, sym))
    if r and fnum(r.get("lastPrice")):
        return {"price": fnum(r["lastPrice"]), "change_pct": fnum(r.get("priceChangePercent")),
                "volume_usd": fnum(r.get("quoteVolume")), "currency": "USD"}
    r = _try("OKX", "%s/market/ticker?instId=%s-USDT" % (OKX, sym))
    try:
        t = r["data"][0]
        last, o = fnum(t["last"]), fnum(t.get("open24h"))
        return {"price": last, "change_pct": (last / o - 1) * 100 if o else None,
                "volume_usd": fnum(t.get("volCcy24h")), "currency": "USD"}
    except (TypeError, KeyError, IndexError):
        pass
    h = hyperliquid().get(sym)
    if h and h["price"]:
        return {"price": h["price"], "change_pct": (h["price"] / h["prev"] - 1) * 100 if h["prev"] else None,
                "volume_usd": h["vol_usd"], "currency": "USD"}
    q = stock_quote(sym + "-USD")
    if q:
        return {"price": q["price"], "change_pct": q["change_pct"], "volume_usd": None, "currency": "USD"}
    return None


COIN_NAMES = {"BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "HYPE": "Hyperliquid", "SUI": "Sui", "XRP": "XRP",
              "BNB": "BNB", "DOGE": "Dogecoin", "ADA": "Cardano", "AVAX": "Avalanche", "LINK": "Chainlink",
              "DOT": "Polkadot", "TON": "Toncoin", "TRX": "Tron", "LTC": "Litecoin", "NEAR": "Near", "APT": "Aptos",
              "ARB": "Arbitrum", "OP": "Optimism", "AAVE": "Aave", "UNI": "Uniswap", "PEPE": "Pepe", "ENA": "Ethena",
              "TAO": "Bittensor", "SEI": "Sei", "TIA": "Celestia", "JUP": "Jupiter", "ONDO": "Ondo", "WIF": "dogwifhat",
              "BONK": "Bonk", "XLM": "Stellar", "HBAR": "Hedera", "ATOM": "Cosmos", "INJ": "Injective", "RENDER": "Render"}


def crypto_history(sym):
    """Tagesschlusskurse: Binance, bei kurzer Historie (neu gelistet) zusätzlich Hyperliquid, zuletzt Yahoo."""
    import time
    best = None
    r = _try("Binance Spot", "%s/klines?symbol=%sUSDT&interval=1d&limit=1000" % (BINANCE_SPOT, sym))
    if isinstance(r, list) and len(r) > 5:
        best = {"d": [int(k[0] // 86400000) for k in r], "c": [fnum(k[4]) for k in r], "div": [], "currency": "USD"}
    if not best or len(best["d"]) < 400:
        now = int(time.time() * 1000)
        r = _try("Hyperliquid", "https://api.hyperliquid.xyz/info", body={
            "type": "candleSnapshot", "req": {"coin": sym, "interval": "1d", "startTime": now - 1000 * 86400000, "endTime": now}})
        if isinstance(r, list) and len(r) > (len(best["d"]) if best else 5):
            best = {"d": [int(k["t"] // 86400000) for k in r], "c": [fnum(k["c"]) for k in r], "div": [], "currency": "USD"}
    if not best:
        best = stock_history(sym + "-USD")
        if best:
            best["name"] = ""
    return best


def _spot_bars(sym):
    """Stundenbalken Spot: (Volumen in USD, Netto-Kaufdruck in USD). Neueste zuletzt."""
    r = _try("Binance Spot", "%s/klines?symbol=%sUSDT&interval=1h&limit=25" % (BINANCE_SPOT, sym))
    if not isinstance(r, list) or len(r) < 5:
        return None
    _closes[sym] = [fnum(k[4]) for k in r]
    return [(fnum(k[7]) or 0, 2 * (fnum(k[10]) or 0) - (fnum(k[7]) or 0)) for k in r]


def _fut_bars_binance(sym):
    r = _opt("Binance Futures", "%s/fapi/v1/klines?symbol=%sUSDT&interval=1h&limit=25" % (BINANCE_FUT, sym))
    if not isinstance(r, list) or len(r) < 5:
        return None
    return [(fnum(k[7]) or 0, 2 * (fnum(k[10]) or 0) - (fnum(k[7]) or 0)) for k in r]


def _okx_rows(path):
    r = _try("OKX", OKX + path)
    try:
        rows = r["data"]
        return rows if rows else None
    except (TypeError, KeyError):
        return None


def _okx_taker(sym, inst):
    """OKX Taker-Volumen je Stunde: [ts, Verkauf, Kauf], neueste zuerst."""
    rows = _okx_rows("/rubik/stat/taker-volume?ccy=%s&instType=%s&period=1H" % (sym, inst))
    if not rows:
        return None
    bars = [((fnum(x[1]) or 0) + (fnum(x[2]) or 0), (fnum(x[2]) or 0) - (fnum(x[1]) or 0)) for x in rows[:25]]
    return bars[::-1]


def _window(bars, hours):
    if not bars:
        return None
    part = bars[-hours:]
    vol = sum(b[0] for b in part)
    delta = sum(b[1] for b in part)
    return {"vol": vol, "delta": delta, "ratio": delta / vol if vol else 0.0}


def crypto_flow(sym, oi_memory=None):
    """Spot- gegen Futures-Kaufdruck, Open Interest und Funding für einen Coin.

    oi_memory: frühere eigene OI-Messungen [(unix, usd)], falls keine Börse einen Verlauf liefert.
    """
    spot = _spot_bars(sym)
    spot_src = "Binance" if spot else None
    if not spot:
        spot = _okx_taker(sym, "SPOT")
        spot_src = "OKX" if spot else None
    fut = _fut_bars_binance(sym)
    fut_src = "Binance" if fut else None
    okx_fut = _okx_taker(sym, "CONTRACTS")
    if not fut and okx_fut:
        fut, fut_src = okx_fut, "OKX"

    # Funding je Börse, auf 8 Stunden normiert, in Prozent
    funding = {}
    r = _okx_rows("/public/funding-rate?instId=%s-USDT-SWAP" % sym)
    if r and fnum(r[0].get("fundingRate")) is not None:
        nxt, cur = fnum(r[0].get("nextFundingTime")), fnum(r[0].get("fundingTime"))
        hours = (nxt - cur) / 3600000 if nxt and cur and nxt > cur else 8
        funding["OKX"] = fnum(r[0]["fundingRate"]) * 100 * 8 / hours
    hl = hyperliquid().get(sym)
    if hl:
        funding["Hyperliquid"] = hl["funding_8h"]
    r = _opt("Binance Futures", "%s/fapi/v1/premiumIndex?symbol=%sUSDT" % (BINANCE_FUT, sym))
    if isinstance(r, dict) and fnum(r.get("lastFundingRate")) is not None:
        funding["Binance"] = fnum(r["lastFundingRate"]) * 100
    by = _opt("Bybit", "%s/tickers?category=linear&symbol=%sUSDT" % (BYBIT, sym))
    try:
        by = by["result"]["list"][0]
    except (TypeError, KeyError, IndexError):
        by = None
    if by and fnum(by.get("fundingRate")) is not None:
        funding["Bybit"] = fnum(by["fundingRate"]) * 100

    # Open Interest je Börse in USD
    oi = {}
    r = _okx_rows("/public/open-interest?instType=SWAP&instId=%s-USDT-SWAP" % sym)
    if r and fnum(r[0].get("oiUsd")):
        oi["OKX"] = fnum(r[0]["oiUsd"])
    if hl and hl["oi_usd"]:
        oi["Hyperliquid"] = hl["oi_usd"]
    if by and fnum(by.get("openInterestValue")):
        oi["Bybit"] = fnum(by["openInterestValue"])
    oi_chg = {}
    bh = _opt("Binance Futures", "%s/futures/data/openInterestHist?symbol=%sUSDT&period=1h&limit=25" % (BINANCE_FUT, sym))
    if isinstance(bh, list) and len(bh) >= 5:
        vals = [fnum(x.get("sumOpenInterestValue")) or 0 for x in bh]
        oi["Binance"] = vals[-1]
        for h in (4, 24):
            base = vals[-1 - h] if len(vals) > h else vals[0]
            if base:
                oi_chg[h] = (vals[-1] / base - 1) * 100
    if not oi_chg:
        rows = _okx_rows("/rubik/stat/contracts/open-interest-volume?ccy=%s&period=1H" % sym)
        if rows and len(rows) >= 5:
            vals = [fnum(x[1]) or 0 for x in rows]   # neueste zuerst
            for h in (4, 24):
                base = vals[h] if len(vals) > h else vals[-1]
                if base:
                    oi_chg[h] = (vals[0] / base - 1) * 100
    total_oi = sum(oi.values()) if oi else None
    if not oi_chg and oi_memory and total_oi:
        import time
        now = time.time()
        for h in (4, 24):
            old = [v for t, v in oi_memory if abs((now - t) - h * 3600) < 1800 and v]
            if old:
                oi_chg[h] = (total_oi / old[-1] - 1) * 100

    if not (spot or fut or funding or oi):
        return None
    f_avg = statistics.mean(funding.values()) if funding else None
    out = {
        "spot": {str(h): _window(spot, h) for h in (4, 24)} if spot else None, "spot_source": spot_src,
        "fut": {str(h): _window(fut, h) for h in (4, 24)} if fut else None, "fut_source": fut_src,
        "funding": {k: round(v, 5) for k, v in funding.items()},
        "funding_avg": round(f_avg, 5) if f_avg is not None else None,
        "funding_apr": round(f_avg * 3 * 365, 2) if f_avg is not None else None,
        "oi": {k: round(v) for k, v in oi.items()}, "oi_total": round(total_oi) if total_oi else None,
        "oi_chg": {str(k): round(v, 2) for k, v in oi_chg.items()},
    }
    cl = _closes.get(sym)
    if cl and len(cl) > 4 and cl[-5]:
        out["px_chg_4h"] = round((cl[-1] / cl[-5] - 1) * 100, 2)
    return out


def classify_flow(change_pct, flow, hours=24):
    """Ordnet eine Kursbewegung ein: von Spot oder von Futures getragen? Gibt Etikett, Ton und Erklärung zurück."""
    if not flow or change_pct is None:
        return None
    h = str(hours)
    s = ((flow.get("spot") or {}).get(h) or {}).get("ratio")
    f = ((flow.get("fut") or {}).get(h) or {}).get("ratio")
    oi = (flow.get("oi_chg") or {}).get(h)
    fund = flow.get("funding_avg")
    if s is None and f is None:
        return None
    s0, f0, oi0 = s or 0.0, f or 0.0, oi or 0.0
    T = 0.01   # ab 1 % Netto-Überhang am Volumen gilt eine Seite als aktiv
    up = change_pct >= 0
    if abs(change_pct) < 0.7:
        label, tone = "Seitwärts", "neutral"
        text = "Kaum Kursbewegung."
    elif up:
        if s is not None and s0 > T and s0 >= f0:
            label, tone = "Spot-getrieben", "good"
            text = "Der Anstieg kommt aus echten Käufen am Spotmarkt. Das gilt als tragfähiger."
        elif f0 > T and oi0 > 1:
            label, tone = "Futures-getrieben", "warn"
            text = "Der Anstieg kommt aus neuen gehebelten Long-Positionen. Anfälliger für Rücksetzer."
        elif oi0 < -1:
            label, tone = "Short-Eindeckung", "warn"
            text = "Der Kurs steigt, während Positionen geschlossen werden: Shorts kaufen zurück."
        elif f0 > T:
            label, tone = "Futures-getrieben", "warn"
            text = "Käufe kommen vor allem aus dem Terminmarkt, der Spotmarkt zieht kaum mit."
        else:
            label, tone = "Gemischt", "neutral"
            text = "Kein klarer Käuferüberhang, weder am Spot- noch am Terminmarkt."
    else:
        if s is not None and s0 < -T and s0 <= f0:
            label, tone = "Spot-Verkäufe", "bad"
            text = "Der Rückgang kommt aus echten Verkäufen am Spotmarkt."
        elif f0 < -T and oi0 > 1:
            label, tone = "Neue Shorts", "warn"
            text = "Der Rückgang kommt aus neu eröffneten Short-Positionen. Bei einer Erholung droht ein Squeeze."
        elif oi0 < -1:
            label, tone = "Long-Abbau", "neutral"
            text = "Der Kurs fällt, während Hebel abgebaut wird: Longs schließen oder werden liquidiert."
        elif f0 < -T:
            label, tone = "Futures-Verkäufe", "warn"
            text = "Verkäufe kommen vor allem aus dem Terminmarkt, der Spotmarkt hält sich."
        else:
            label, tone = "Gemischt", "neutral"
            text = "Kein klarer Verkäuferüberhang, weder am Spot- noch am Terminmarkt."
    if fund is not None:
        if fund > 0.03:
            text += " Funding ist hoch: Longs zahlen deutlich, der Markt ist einseitig long."
        elif fund < -0.005:
            text += " Funding ist negativ: Shorts zahlen, der Markt ist eher short positioniert."
    return {"label": label, "tone": tone, "text": text}


# ----------------------------------------------------------------- Protokoll-Umsätze (DeFi Llama)
LLAMA = "https://api.llama.fi"
# Coins einer Blockchain: Name der Chain bei DeFi Llama. Alles andere wird über das Token-Kürzel gefunden.
LLAMA_CHAINS = {"BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "AVAX": "Avalanche", "SUI": "Sui", "BNB": "BSC",
                "TRX": "Tron", "TON": "TON", "NEAR": "Near", "APT": "Aptos", "ARB": "Arbitrum", "OP": "OP Mainnet",
                "SEI": "Sei", "TIA": "Celestia", "POL": "Polygon", "ADA": "Cardano", "S": "Sonic", "BERA": "Berachain"}


def _llama(path):
    try:
        r = http_json(LLAMA + path, timeout=90)
        _mark("DeFi Llama", True)
        return r
    except SourceError:
        _mark("DeFi Llama", False)
        return None


def onchain_revenue(symbols):
    """Gebühren und Einnahmen je Coin aus DeFi Llama, dazu Marktwert und die Verhältnisse daraus.

    Gebühren = was Nutzer zahlen (wie Umsatz). Einnahmen = was das Protokoll davon behält (wie Gewinn).
    Halter = was davon an Token-Halter fließt. Hochgerechnet aus den letzten 30 Tagen auf ein Jahr.
    """
    symbols = [s.upper() for s in symbols]
    if not symbols:
        return {}
    lite = _llama("/lite/protocols2")
    if not lite:
        return {}
    parents = {}
    for p in lite.get("parentProtocols") or []:
        sym = (p.get("symbol") or "").upper()
        if sym in symbols and sym not in LLAMA_CHAINS and p.get("mcap"):
            if sym not in parents or p["mcap"] > parents[sym]["mcap"]:
                parents[sym] = {"id": p["id"], "name": p.get("name"), "mcap": p["mcap"], "gecko": p.get("gecko_id")}
    singles, chain_cap, gecko = {}, {}, {}
    for p in lite.get("protocols") or []:
        sym = (p.get("symbol") or "").upper()
        if sym not in symbols or not p.get("mcap"):
            continue
        if sym in LLAMA_CHAINS:
            if p["mcap"] > chain_cap.get(sym, 0):
                chain_cap[sym] = p["mcap"]
                gecko[sym] = p.get("gecko_id")
        elif sym not in parents and not p.get("parentProtocol"):
            if sym not in singles or p["mcap"] > singles[sym]["mcap"]:
                singles[sym] = {"name": p.get("name"), "mcap": p["mcap"], "gecko": p.get("gecko_id")}
    tables = {}
    for field, dtype in (("fees", "dailyFees"), ("rev", "dailyRevenue"), ("holders", "dailyHoldersRevenue")):
        r = _llama("/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=" + dtype)
        tables[field] = (r or {}).get("protocols") or []
    out = {}
    for sym in symbols:
        if sym in LLAMA_CHAINS:
            name, mcap, kind = LLAMA_CHAINS[sym], chain_cap.get(sym), "chain"
            match = lambda x, n=name: x.get("protocolType") == "chain" and x.get("name") == n
        elif sym in parents:
            name, mcap, kind = parents[sym]["name"], parents[sym]["mcap"], "protocol"
            match = lambda x, i=parents[sym]["id"]: x.get("parentProtocol") == i
        elif sym in singles:
            name, mcap, kind = singles[sym]["name"], singles[sym]["mcap"], "protocol"
            match = lambda x, n=name: x.get("name") == n and x.get("protocolType") != "chain"
        else:
            continue
        d = {"name": name, "type": kind, "mcap": mcap}
        for field, rows in tables.items():
            hit = [x for x in rows if match(x)]
            if not hit:
                continue
            now30 = sum(x.get("total30d") or 0 for x in hit)
            prev30 = sum(x.get("total60dto30d") or 0 for x in hit)
            d[field + "_30d"] = now30
            d[field + "_1y"] = sum(x.get("total1y") or 0 for x in hit) or None
            if prev30 > 0:
                d[field + "_chg"] = (now30 / prev30 - 1) * 100
        if not d.get("fees_30d") and not d.get("rev_30d"):
            continue
        year = 365 / 30.0
        if mcap:
            if d.get("fees_30d"):
                d["ps"] = mcap / (d["fees_30d"] * year)       # Marktwert zu Gebühren (wie KUV)
            if d.get("rev_30d"):
                d["pe"] = mcap / (d["rev_30d"] * year)        # Marktwert zu Einnahmen (wie KGV)
            if d.get("holders_30d"):
                d["holder_yield"] = d["holders_30d"] * year / mcap * 100
        d["gecko"] = gecko.get(sym) or (parents.get(sym) or singles.get(sym) or {}).get("gecko")
        out[sym] = d
    # Voll verwässerter Wert (alle Token, auch noch gesperrte) von CoinGecko: optional, fehlt bei Sperre einfach
    ids = sorted({d["gecko"] for d in out.values() if d.get("gecko")})
    fdv = {}
    if ids:
        r = _try("CoinGecko", "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&ids=" + ",".join(ids), timeout=30)
        for x in r or []:
            if x.get("fully_diluted_valuation"):
                fdv[x.get("id")] = x["fully_diluted_valuation"]
    for d in out.values():
        v = fdv.get(d.pop("gecko", None))
        if v:
            d["fdv"] = v
            if d.get("rev_30d"):
                d["pe_fdv"] = v / (d["rev_30d"] * 365 / 30.0)
    return out


# ----------------------------------------------------------------- Marktkalender (wie im Newsletter)
NASDAQ_H = {"User-Agent": "Mozilla/5.0", "Accept": "application/json", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
BIG_CAP = 40e9          # Quartalszahlen ab diesem Börsenwert kommen in den Kalender, eigene Titel immer
MACRO_DE = [            # häufige US-Termine auf Deutsch; Rest bleibt im Original
    ("Federal Funds Rate", "Fed-Zinsentscheid"), ("FOMC Statement", "Fed-Zinsentscheid: Erklärung"),
    ("FOMC Press Conference", "Fed-Pressekonferenz"), ("FOMC Meeting Minutes", "Fed-Protokoll der letzten Sitzung"),
    ("FOMC Economic Projections", "Fed-Prognosen"), ("Fed Chairman", "Rede von Fed-Chef"), ("Fed Chair", "Rede von Fed-Chef"),
    ("FOMC Member", "Rede von Fed-Mitglied"), ("ECB President", "Rede von EZB-Chefin"),
    ("Core CPI", "Kerninflation (CPI)"), ("CPI", "Verbraucherpreise (CPI)"), ("Core PCE", "Kerninflation (PCE)"),
    ("Core PPI", "Erzeugerpreise ohne Energie (PPI)"), ("PPI", "Erzeugerpreise (PPI)"),
    ("Non-Farm Employment Change", "Arbeitsmarktbericht: neue Stellen"), ("Unemployment Rate", "Arbeitslosenquote"),
    ("Average Hourly Earnings", "Stundenlöhne"), ("Unemployment Claims", "Erstanträge Arbeitslosenhilfe"),
    ("JOLTS Job Openings", "Offene Stellen (JOLTS)"), ("ADP Non-Farm", "ADP-Arbeitsmarktbericht"),
    ("Advance GDP", "BIP, erste Schätzung"), ("Prelim GDP", "BIP, zweite Schätzung"), ("Final GDP", "BIP, endgültig"), ("GDP", "BIP"),
    ("Core Retail Sales", "Einzelhandelsumsatz ohne Autos"), ("Retail Sales", "Einzelhandelsumsatz"),
    ("ISM Manufacturing PMI", "ISM-Industrie-Einkaufsmanager"), ("ISM Services PMI", "ISM-Dienstleister-Einkaufsmanager"),
    ("Flash Manufacturing PMI", "Einkaufsmanager Industrie (vorläufig)"), ("Flash Services PMI", "Einkaufsmanager Dienstleister (vorläufig)"),
    ("Prelim UoM Consumer Sentiment", "Verbraucherstimmung Uni Michigan"), ("CB Consumer Confidence", "Verbrauchervertrauen"),
    ("Durable Goods Orders", "Aufträge langlebiger Güter"), ("Main Refinancing Rate", "EZB-Zinsentscheid"),
    ("Monetary Policy Statement", "EZB-Erklärung"), ("ECB Financial Stability Review", "EZB-Finanzstabilitätsbericht"), ("ECB Press Conference", "EZB-Pressekonferenz"),
    ("German Flash", "Deutschland: Einkaufsmanager (vorläufig)"), ("German ifo", "Deutschland: ifo-Geschäftsklima"),
]


def _de_macro(title):
    title = title.replace(" Speaks", "").strip()
    for en, de in MACRO_DE:
        if title.startswith(en) or (" " + en) in title:
            rest = title.replace(en, "").strip()
            rest = {"m/m": "zum Vormonat", "y/y": "zum Vorjahr", "q/q": "zum Vorquartal"}.get(rest, rest)
            return (de + (" " + rest if rest else "")).strip()
    return title


def _firm(name):
    """Firmennamen kürzen: 'Walt Disney Company (The)' -> 'Walt Disney Company'."""
    n = (name or "").replace(" (The)", "")
    for tail in (", PBC", ", Inc.", " Inc.", " Incorporated", " Corporation", " Corp.", " Limited", " Ltd", " plc", " N.V.", " S.A.", ", Inc", " Inc"):
        if n.endswith(tail):
            n = n[: -len(tail)]
    return n.strip(" ,")


def market_calendar(own_symbols=(), days=7):
    """Termine der nächsten Tage für den ganzen Markt: Quartalszahlen großer US-Firmen (Nasdaq), US-Konjunktur, Fed und EZB
    (Wirtschaftskalender von Forex Factory), Börsengänge (Nasdaq). Uhrzeiten in deutscher Zeit."""
    from zoneinfo import ZoneInfo
    berlin = ZoneInfo("Europe/Berlin")
    today = datetime.date.today()
    own = {s.upper() for s in own_symbols}
    out = []
    # Quartalszahlen
    for i in range(days):
        d = today + datetime.timedelta(days=i)
        if d.weekday() >= 5:
            continue
        r = _try("Nasdaq Kalender", "https://api.nasdaq.com/api/calendar/earnings?date=" + d.isoformat(), headers=NASDAQ_H)
        for row in (((r or {}).get("data") or {}).get("rows") or []):
            sym = (row.get("symbol") or "").upper()
            cap = fnum(str(row.get("marketCap") or "").replace("$", "").replace(",", "")) or 0
            if cap < BIG_CAP and sym not in own:
                continue
            when = {"time-pre-market": "vorbörslich", "time-after-hours": "nachbörslich"}.get(row.get("time"), "")
            out.append({"date": d.isoformat(), "time": when, "category": "Earnings", "symbol": sym, "cap": cap, "own": sym in own,
                        "title": "%s (%s): Quartalszahlen" % (_firm(row.get("name")) or sym, sym)})
    # Konjunktur, Fed, EZB
    r = _try("Wirtschaftskalender", "https://nfs.faireconomy.media/ff_calendar_thisweek.json")
    for e in r or []:
        if not isinstance(e, dict):
            continue
        cur, imp, title = e.get("country"), e.get("impact"), e.get("title") or ""
        fed = cur == "USD" and any(w in title for w in ("FOMC", "Federal Funds", "Fed Chair"))
        ecb = cur == "EUR" and any(w in title for w in ("ECB", "Main Refinancing", "Monetary Policy"))
        if (fed or ecb) and imp == "Low":
            continue    # Reden ohne Gewicht für den Markt weglassen
        if not (fed or ecb or (cur == "USD" and imp == "High") or (cur == "EUR" and imp == "High" and "German" in title)):
            continue
        try:
            t = datetime.datetime.fromisoformat(e["date"]).astimezone(berlin)
        except (KeyError, ValueError):
            continue
        if t.date() < today or t.date() >= today + datetime.timedelta(days=days):
            continue
        de = lambda v: str(v).replace(".", ",").replace("%", " %")
        extra = [x for x in ("Prognose %s" % de(e["forecast"]) if e.get("forecast") else "", "zuvor %s" % de(e["previous"]) if e.get("previous") else "") if x]
        out.append({"date": t.date().isoformat(), "time": t.strftime("%H:%M") if t.hour or t.minute else "",
                    "category": "Fed" if fed or ecb else "Makro",
                    "title": ("USA: " if cur == "USD" and not fed else "") + _de_macro(title) + (" (%s)" % ", ".join(extra) if extra else "")})
    # Börsengänge
    r = _try("Nasdaq Kalender", "https://api.nasdaq.com/api/ipo/calendar?date=" + today.strftime("%Y-%m"), headers=NASDAQ_H)
    for row in ((((r or {}).get("data") or {}).get("upcoming") or {}).get("upcomingTable") or {}).get("rows") or []:
        try:
            d = datetime.datetime.strptime(row.get("expectedPriceDate") or "", "%m/%d/%Y").date()
        except ValueError:
            continue
        val = fnum(str(row.get("dollarValueOfSharesOffered") or "").replace("$", "").replace(",", "")) or 0
        if d < today or d >= today + datetime.timedelta(days=days) or val < 100e6:
            continue
        size = ("%.1f" % (val / 1e9)).replace(".", ",") + " Mrd. $" if val >= 1e9 else "%d Mio. $" % (val / 1e6)
        out.append({"date": d.isoformat(), "time": "", "category": "IPO",
                    "title": "Börsengang: %s (%s), %s, Volumen %s" % (_firm(row.get("companyName")), row.get("proposedTickerSymbol"),
                                                                        row.get("proposedExchange") or "", size)})
    return out


# ----------------------------------------------------------------- Watchlist am Handy: 7-Tage-Verlauf, Logos, Marktwert von Coins
def _sig(x, n=5):
    """Auf n gültige Stellen runden (spart Platz in market.json)."""
    return float("%.*g" % (n, x)) if x else x


def spark_7d(kind, sym):
    """Stundenkurse der letzten 7 Tage (Aktien: Handelsstunden), höchstens etwa 90 Punkte.
    Gibt (Stunden seit 1970, Schlusskurse) zurück; die Stunde ist das Ende des Zeitabschnitts."""
    now = int(time.time())
    t = c = None
    if kind == "crypto":
        r = _try("Binance Spot", "%s/klines?symbol=%sUSDT&interval=1h&limit=168" % (BINANCE_SPOT, sym))
        if isinstance(r, list) and len(r) > 24:
            t, c = [int(k[0] // 3600000) + 1 for k in r], [fnum(k[4]) for k in r]
        else:
            r = _try("Hyperliquid", "https://api.hyperliquid.xyz/info", body={
                "type": "candleSnapshot", "req": {"coin": sym, "interval": "1h", "startTime": (now - 7 * 86400) * 1000, "endTime": now * 1000}})
            if isinstance(r, list) and len(r) > 24:
                t, c = [int(k["t"] // 3600000) + 1 for k in r], [fnum(k["c"]) for k in r]
        if not c:
            return None
        if len(c) > 100:
            t, c = t[::2], c[::2]
    else:
        r = _try("Yahoo Kurse", "https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1h" % (
            urllib.parse.quote(sym), now - 7 * 86400, now))
        try:
            ts, cs = r["chart"]["result"][0]["timestamp"], r["chart"]["result"][0]["indicators"]["quote"][0]["close"]
        except (TypeError, KeyError, IndexError):
            return None
        pairs = [(int(a // 3600) + 1, b) for a, b in zip(ts, cs) if b]
        if len(pairs) < 5:
            return None
        t, c = [p[0] for p in pairs], [p[1] for p in pairs]
    pairs = [(a, _sig(b)) for a, b in zip(t, c) if b]
    return [p[0] for p in pairs], [p[1] for p in pairs]


def coin_meta(symbols):
    """Marktwert, Rang und Logo-Adresse je Coin von CoinGecko (ein Abruf). Bei gleichem Kürzel zählt der größte Marktwert."""
    if not symbols:
        return {}
    r = _try("CoinGecko", "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&symbols=" +
             ",".join(sorted(s.lower() for s in symbols)), timeout=30)
    out = {}
    for x in r or []:
        s = str(x.get("symbol") or "").upper()
        if s and (s not in out or (x.get("market_cap") or 0) > (out[s].get("mcap") or 0)):
            out[s] = {"mcap": x.get("market_cap"), "rank": x.get("market_cap_rank"), "image": x.get("image")}
    return out


def coin_spark(symbols):
    """Ersatz für Coins ohne Stundenkurse bei Binance und Hyperliquid: 7-Tage-Verlauf von CoinGecko (ein Abruf)."""
    if not symbols:
        return {}
    r = _try("CoinGecko", "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&sparkline=true&symbols=" +
             ",".join(sorted(s.lower() for s in symbols)), timeout=30)
    best, now_h = {}, int(time.time() // 3600)
    for x in r or []:
        s, c = str(x.get("symbol") or "").upper(), ((x.get("sparkline_in_7d") or {}).get("price") or [])
        if s and len(c) > 24 and (s not in best or (x.get("market_cap") or 0) > best[s][0]):
            c = [v for v in c[::2] if v]   # CoinGecko: Stundenwerte bis jetzt, ohne Zeitangabe
            best[s] = (x.get("market_cap") or 0, ([now_h - 2 * (len(c) - 1 - k) for k in range(len(c))], [_sig(v) for v in c]))
    return {s: v[1] for s, v in best.items()}


def _image(url, limit=40000):
    """Bild als data-URI, oder None (zu groß, kein Bild, Fehler)."""
    import base64
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as f:
            ctype = (f.headers.get("Content-Type") or "").split(";")[0].strip()
            b = f.read(limit + 1)
    except Exception:
        return None
    if not ctype.startswith("image/") or len(b) > limit or len(b) < 300:
        return None
    return "data:%s;base64,%s" % (ctype, base64.b64encode(b).decode("ascii"))


# Anbieter-Logos für ETFs ohne eigenes Bild: ein bekannter Fonds desselben Anbieters
ISSUER_LOGO = (("iShares", "EUNL.DE"), ("Amundi", "LYYA.DE"), ("Lyxor", "LYYA.DE"), ("Xtrackers", "XDWD.DE"),
               ("Vanguard", "VWCE.DE"), ("SPDR", "SPY"), ("Invesco", "IVZ"), ("HSBC", "HSBC"), ("WisdomTree", "WT"))


def logo(kind, sym, name="", website="", coin_image=None):
    """Logo als data-URI: Coins von CoinGecko, Aktien und ETFs von Financial Modeling Prep, sonst Favicon der Firmenseite."""
    if kind == "crypto":
        return _image(coin_image.replace("/large/", "/small/")) if coin_image else None
    # Große Bilder (über 16 KB) überspringen: dann lieber das kleinere Favicon der Firmenseite
    img = _image("https://financialmodelingprep.com/image-stock/%s.png" % urllib.parse.quote(sym), 16000)
    if img:
        return img
    dom = re.sub(r"^https?://(www\.)?", "", website or "").split("/")[0]
    img = _image("https://www.google.com/s2/favicons?domain=%s&sz=128" % urllib.parse.quote(dom), 16000) if dom else None
    if img:
        return img
    for word, proxy in ISSUER_LOGO:
        if word.lower() in (name or "").lower():
            img = _image("https://financialmodelingprep.com/image-stock/%s.png" % proxy, 16000)
            if img:
                return img
    return _image("https://financialmodelingprep.com/image-stock/%s.png" % urllib.parse.quote(sym))


# ----------------------------------------------------------------- Smart Money / Dumb Money
CFTC_TFF = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"   # Traders in Financial Futures, wöchentlich, frei
COT_MARKETS = {"stocks": "13874A", "btc": "133741"}                       # E-mini S&P 500, Bitcoin (CME)


def cftc_tff(code, weeks=170):
    """Wöchentliche Positionen je Händlergruppe für einen Terminkontrakt, älteste zuerst."""
    q = urllib.parse.urlencode({"$where": "cftc_contract_market_code='%s'" % code, "$order": "report_date_as_yyyy_mm_dd DESC",
                                "$limit": str(weeks)})
    r = _try("CFTC", CFTC_TFF + "?" + q, timeout=30)
    out = []
    for x in r or []:
        n = lambda k: fnum(x.get(k)) or 0
        oi = n("open_interest_all")
        if not oi:
            continue
        out.append({"d": str(x.get("report_date_as_yyyy_mm_dd", ""))[:10], "oi": oi,
                    "dealer": n("dealer_positions_long_all") - n("dealer_positions_short_all"),
                    "asset": n("asset_mgr_positions_long") - n("asset_mgr_positions_short"),
                    "lev": n("lev_money_positions_long") - n("lev_money_positions_short"),
                    "small": n("nonrept_positions_long_all") - n("nonrept_positions_short_all")})
    return sorted(out, key=lambda x: x["d"])


def holder_cost():
    """Einstandspreis der Kurzfrist- und Langfrist-Anleger bei Bitcoin (BGeometrics, frei: 15 Abrufe am Tag,
    letzte 7 Tage nur gegen Bezahlung). Kurzfrist = Coins seit weniger als 155 Tagen nicht bewegt.
    Ergebnis {Datum: [kurz, lang]}, nur Tage mit beiden Werten."""
    out = {}
    for i, (path, field) in enumerate((("sth-realized-price", "sthRealizedPrice"), ("lth-realized-price", "lthRealizedPrice"))):
        r = _try("BGeometrics", "https://bitcoin-data.com/v1/" + path, timeout=40)
        if not isinstance(r, list):
            return {}
        for x in r:
            v = fnum(x.get(field))
            if x.get("d") and v:
                out.setdefault(x["d"], [None, None])[i] = v
    return {d: v for d, v in out.items() if None not in v}


def crypto_fear_greed_hist(days=1200):
    """Krypto-Angst-und-Gier je Tag (alternative.me), als {Datum: Wert}."""
    r = _try("Fear & Greed", "https://api.alternative.me/fng/?limit=%d" % days, timeout=30)
    out = {}
    for x in (r or {}).get("data") or []:
        v, ts = fnum(x.get("value")), fnum(x.get("timestamp"))
        if v is not None and ts:
            out[datetime.datetime.utcfromtimestamp(int(ts)).date().isoformat()] = v
    return out
