"""Datenquellen: Yahoo (Aktien, Währungen), Binance/OKX/Hyperliquid/Bybit (Krypto, Spot und Futures).

Jede Funktion gibt bei einem Ausfall None zurück. Welche Quelle geantwortet hat, steht in STATUS
(nur Quellenname und Zähler, keine Ticker).
"""
import http.cookiejar
import statistics
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

    MODULES = "summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile"

    def __init__(self):
        self.crumb = None
        self.dead = False
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
        }
        return {k: v for k, v in out.items() if v not in (None, "")}


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
