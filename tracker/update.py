"""Aktualisiert die Daten des Trackers.

    python3 -m tracker.update fast    Kurse, Krypto-Flows, Alerts (alle paar Minuten)
    python3 -m tracker.update loop 50 dasselbe alle 5 Minuten, 50 Minuten lang (für die zeitgesteuerten Läufe)
    python3 -m tracker.update daily   Kursverläufe, Kennzahlen, Dividenden, Nachkauf-Zonen (einmal täglich)
    python3 -m tracker.update all     beides
"""
import datetime
import sys
import time

from . import analytics, screen, sources
from .common import CLOUD, SourceError, asset_key, empty_portfolio, get_store, http_json, log, now_iso, tracked_assets

BENCH = {"SP500": ("stock", "^GSPC", "S&P 500"), "BTC": ("crypto", "BTC", "Bitcoin"),
         "NDX": ("stock", "QQQ", "Nasdaq-100")}   # Nasdaq-100: Vergleich im Diagramm Depot Jakob (Wachstum)


def strategy_assets(store):
    """Titel des Ideal-Depots Jakob (screen.json) zählen mit: die stärksten nach der Regel und die Titel des Modells.
    Kurse, Verlauf und Logos für die App."""
    doc = store.get("screen.json") or {}
    ib = doc.get("ideal") or {}
    keys = list(doc.get("top") or []) + [x.get("key") for x in ib.get("items") or []] + [x.get("key") for x in ib.get("model") or []]
    return {k: {"kind": "stock", "symbol": k.split(":", 1)[1], "name": ""} for k in keys if k and k.startswith("stock:")}


def us_session(ts):
    """Läuft gerade der reguläre US-Handel (Mo bis Fr, 9:30 bis 16 Uhr New Yorker Zeit)?"""
    try:
        from zoneinfo import ZoneInfo
        t = datetime.datetime.fromtimestamp(ts, ZoneInfo("America/New_York"))
    except Exception:
        t = datetime.datetime.utcfromtimestamp(ts) - datetime.timedelta(hours=5)
    return t.weekday() < 5 and (9, 30) <= (t.hour, t.minute) < (16, 0)


DE_SEARCH_V = 2   # Suche verbessert (24.11.2026): ältere Fehlschläge neu suchen


def german_quote(sym, q, de_map, fx, name):
    """Neuerer Kurs von Xetra oder Frankfurt, in die Handelswährung umgerechnet (fx = Einheiten je Euro).
    US-Aktien außerhalb des US-Handels: Änderung gegen den letzten US-Schluss. Asiatische Aktien (`sources.DE_LATE`),
    wenn ihre Börse geschlossen ist: Änderung der deutschen Notiz gegen ihren Vortag, so wie in Jakobs Broker; der
    Heimatschluss vom Morgen ist dort schon im Kurs von gestern Abend enthalten.
    Das deutsche Kürzel wird einmal gesucht und gemerkt (leer = keins gefunden, nach 2 Tagen neu; scheiterte die Suche
    selbst, beim nächsten Lauf)."""
    if not fx or not q.get("price"):
        return q
    late = q.get("currency") in sources.DE_LATE
    if late and time.time() - (q.get("time") or 0) < 1800:      # Heimatbörse handelt noch
        return q
    m = de_map.get(sym)
    if m is None or (not m.get("s") and (m.get("v") != DE_SEARCH_V or time.time() - m.get("t", 0) > 2 * 86400)):
        found = sources.german_listing(sym, name or q.get("name"), q["price"], fx)
        if found is None:
            return q
        m = de_map[sym] = {"s": found, "t": int(time.time()), "v": DE_SEARCH_V}
    if not m.get("s"):
        return q
    dq = sources.stock_quote(m["s"])
    if not dq or dq.get("currency") != "EUR" or not dq.get("time") or dq["time"] <= (q.get("time") or 0):
        return q
    p = dq["price"] * fx / sources.DE_RATIO.get(m["s"], 1)
    if late:
        if dq.get("change_pct") is None or abs(p / q["price"] - 1) > 0.25:   # unplausibel: Heimatkurs behalten
            return q
        return dict(q, price=p, change_pct=dq["change_pct"], time=dq["time"], venue=dq.get("exchange") or "Deutsche Börse",
                    home_close=q["price"])
    return dict(q, price=p, change_pct=(p / q["price"] - 1) * 100, time=dq["time"], venue=dq.get("exchange") or "Deutsche Börse",
                us_close=q["price"])


def _german_fx(cur, cache):
    """Einheiten der Währung je Euro für german_quote, je Lauf einmal geholt."""
    if cur not in cache:
        if cur == "USD":
            cache[cur] = (sources.stock_quote("EURUSD=X") or {}).get("price") or 0
        else:
            cache[cur] = sources.fx_rate(cur) or 0
    return cache[cur]


def _german_ok(sym, q, now):
    """Kommt für den deutschen Kurs in Frage: US-Aktie außerhalb des US-Handels oder Aktie einer asiatischen Börse."""
    if not q or sym.startswith("^"):
        return False
    if q.get("currency") == "USD":
        return "." not in sym and not us_session(now)
    return q.get("currency") in sources.DE_LATE


# ----------------------------------------------------------------- schneller Lauf
def run_fast(store):
    pf = store.get("portfolio.json") or empty_portfolio()
    state = store.get("state.json") or {}
    assets = tracked_assets(pf)
    for k, v in strategy_assets(store).items():
        assets.setdefault(k, v)
    old_market = store.get("market.json") or {}
    old = old_market.get("assets") or {}
    out, currencies = {}, set()
    oi_mem = state.setdefault("oi", {})
    now = time.time()
    de_map, de_fx = state.setdefault("de_map", {}), {}
    for key, a in assets.items():
        if a["kind"] == "stock":
            q = sources.stock_quote(a["symbol"])
            if _german_ok(a["symbol"], q, now):
                q = german_quote(a["symbol"], q, de_map, _german_fx(q["currency"], de_fx), a["name"] or (old.get(key) or {}).get("name"))
        else:
            q = sources.crypto_quote(a["symbol"])
            if q:
                mem = oi_mem.get(a["symbol"]) or []
                flow = sources.crypto_flow(a["symbol"], mem)
                if flow:
                    q["flow"] = flow
                    q["flow_read"] = {h: sources.classify_flow(_window_change(q, flow, h), flow, int(h)) for h in ("4", "24")}
                    if flow.get("oi_total"):
                        mem = [m for m in mem if now - m[0] < 30 * 3600] + [[int(now), flow["oi_total"]]]
                        oi_mem[a["symbol"]] = mem
        if not q:
            if key in old:      # letzten bekannten Stand behalten, als veraltet markieren
                q = dict(old[key], stale=True)
            else:
                q = {"error": True}
        q["kind"], q["symbol"] = a["kind"], a["symbol"]
        q["name"] = (q.get("name") or a["name"] or (old.get(key) or {}).get("name")
                     or (sources.COIN_NAMES.get(a["symbol"], a["symbol"]) if a["kind"] == "crypto" else ""))
        if q.get("currency"):
            currencies.add(q["currency"])
        out[key] = q
    for t in pf.get("transactions") or []:
        if t.get("currency"):
            currencies.add(t["currency"])
    fx = {"EUR": 1.0}
    old_fx = old_market.get("fx") or {}
    for cur in sorted(currencies | {"USD"}):
        if cur != "EUR":
            fx[cur] = sources.fx_rate(cur) or old_fx.get(cur)
    indices = market_strip(out)
    fired = check_alerts(pf, out, state, fx)
    moved = check_moves(store, pf, out, state, fx)
    for sym in list(oi_mem):
        if asset_key("crypto", sym) not in assets:
            del oi_mem[sym]
    try:
        refresh_strategy(store, pf, out, state)
    except Exception as e:   # die Strategie darf den Kurslauf nicht aufhalten
        log("Strategie live: Fehler " + type(e).__name__)
    spark, spark_t, spark_at = refresh_spark(assets, old_market)
    store.put("market.json", {"updated": now_iso(), "fx": fx, "assets": out, "indices": indices, "spark": spark, "spark_t": spark_t, "spark_at": spark_at,
                              "sources": sources.STATUS})
    store.put("state.json", state)
    log("Kurse: %d Titel, %d ohne Daten, %d Alerts ausgelöst, %d Bewegungen gemeldet" % (
        len(out), sum(1 for q in out.values() if q.get("error")), fired, moved))


# ----------------------------------------------------------------- Strategie mit aktuellen Kursen

# Jakobs Wunsch vom 23.11.2026: Strategie, Momentum, Angst und Gier, Halbleiter und Ideal-Depot immer mit aktuellen
# Kursen, nicht nur mit dem Stand des Tageslaufs. Der Kurslauf rechnet sie alle 15 Minuten neu (werktags 8 bis 23 Uhr
# deutscher Zeit): Tagesverläufe aus daily.json bzw. screen_base.json, der heutige Kurs als letzter Schlusskurs.
# Kennzahlen, Schätzungen und Analystenziele bleiben vom Tageslauf (ändern sich untertags kaum).
STRAT_EVERY = 15 * 60
TZ_H = {"USD": -5, "CAD": -5, "EUR": 1, "CHF": 1, "DKK": 1, "SEK": 1, "NOK": 1, "GBP": 0, "KRW": 9, "JPY": 9, "TWD": 8, "HKD": 8}


def _strat_hours(ts):
    try:
        from zoneinfo import ZoneInfo
        t = datetime.datetime.fromtimestamp(ts, ZoneInfo("Europe/Berlin"))
    except Exception:
        t = datetime.datetime.utcfromtimestamp(ts) + datetime.timedelta(hours=1)
    return t.weekday() < 5 and 8 <= t.hour < 23


def _with_live(h, q, crypto=False):
    """Tagesverlauf {d, c} mit dem aktuellen Kurs als heutigem Schluss (ersetzt den Tag, wenn es ihn schon gibt)."""
    if not h or not h.get("c") or not h.get("d") or not q or q.get("error") or q.get("stale") or not q.get("price"):
        return h
    t = q.get("time") or (time.time() if crypto else None)
    if not t:
        return h
    day = int((t + (0 if crypto else TZ_H.get(q.get("currency"), 0) * 3600)) // 86400)
    d, c = list(h["d"]), list(h["c"])
    if day < d[-1]:
        return h
    if day == d[-1]:
        c[-1] = q["price"]
    else:
        d.append(day)
        c.append(q["price"])
    return dict(h, d=d, c=c)


def _live_bar(q):
    """(Tag, Kurs) aus einem aktuellen Kurs, Tag nach der Uhr der Börse (wie _with_live)."""
    if not q or q.get("error") or q.get("stale") or not q.get("price") or not q.get("time"):
        return None
    return int((q["time"] + TZ_H.get(q.get("currency"), 0) * 3600) // 86400), q["price"]


def refresh_strategy(store, pf, live, state, force=False):
    """Wachstums-Momentum mit aktuellen Kursen: die stärksten Titel, Ideal-Depot, Depot Jakob und Watchlist bekommen den
    aktuellen Kurs, die übrigen Titel der Auswahl behalten den letzten Schlusskurs (an ihrem Rang ändert sich untertags
    kaum etwas). Dazu Angst und Gier am Aktienmarkt."""
    now = time.time()
    if not force and (now - (state.get("strat_at") or 0) < STRAT_EVERY or not _strat_hours(now)):
        return
    base, daily = store.get("screen_base.json"), store.get("daily.json") or {}
    if not base or not base.get("px") or not daily.get("assets"):
        return
    state["strat_at"] = int(now)
    de_map, de_fx = state.setdefault("de_map", {}), {}

    def quote(sym):
        q = live.get(asset_key("stock", sym))
        if q is None:
            q = sources.stock_quote(sym)
            if _german_ok(sym, q, now):
                q = german_quote(sym, q, de_map, _german_fx(q["currency"], de_fx), "")
        return q
    members = base.get("members") or {}
    lv = {}
    for sym in screen.watch_syms(store.get("screen.json"), pf, members):
        bar = _live_bar(quote(sym))
        if bar:
            lv[sym] = bar
    extra = {sym: _with_live(h, live.get(asset_key("stock", sym))) for sym, h in screen.extra_hist(pf, daily["assets"], members).items()}
    fg_hist = {}
    for s, (d, c) in (base.get("fg") or {}).items():
        h = _with_live({"d": d, "c": c}, sources.stock_quote(s))
        fg_hist[s] = (h["d"], h["c"])
    mfg = analytics.market_fear_greed(fg_hist) if fg_hist else None
    prev_fg = (store.get("screen.json") or {}).get("fg") or {}
    fg = {"stocks": (mfg or {}).get("value", prev_fg.get("stocks")), "crypto": (daily.get("crypto_fg") or {}).get("value", prev_fg.get("crypto"))}
    screen.build(store, pf, base, push, fg, mfg=mfg, extra=extra, live=lv)


SPARK_EVERY = 55 * 60   # 7-Tage-Verlauf (Stundenkurse) für die Watchlist am Handy: höchstens stündlich neu


def refresh_spark(assets, old_market):
    """7-Tage-Verlauf je Titel (Kurse und Stunden). Fällig einmal pro Stunde, neue Titel sofort; bei Fehlern bleibt der alte."""
    old, old_t, at = old_market.get("spark") or {}, old_market.get("spark_t") or {}, old_market.get("spark_at") or 0
    due = time.time() - at > SPARK_EVERY
    out, out_t = {}, {}
    for key, a in assets.items():
        if due or key not in old or key not in old_t:
            r = sources.spark_7d(a["kind"], a["symbol"])
            if r:
                out_t[key], out[key] = r
                continue
        if key in old:
            out[key] = old[key]
            if key in old_t:
                out_t[key] = old_t[key]
    missing = [a["symbol"] for k, a in assets.items() if a["kind"] == "crypto" and (k not in out or k not in out_t)]
    for sym, (t, c) in sources.coin_spark(missing).items():
        out_t[asset_key("crypto", sym)], out[asset_key("crypto", sym)] = t, c
    out_t = {k: v for k, v in out_t.items() if k in out and len(v) == len(out[k])}
    return out, out_t, int(time.time()) if due else at


MARKET_STRIP = [("^GSPC", "S&P 500"), ("^NDX", "Nasdaq 100"), ("^GDAXI", "DAX"), ("^STOXX50E", "Euro Stoxx 50"),
                ("^VIX", "VIX"), ("GC=F", "Gold"), ("BTC", "Bitcoin"), ("EURUSD", "Euro/Dollar")]


def market_strip(assets):
    """Leitindizes für die Kopfleiste des Dashboards. Bitcoin kommt aus den Krypto-Kursen, Euro/Dollar von Yahoo."""
    out = []
    for sym, name in MARKET_STRIP:
        if sym == "BTC":
            q = assets.get("crypto:BTC") or sources.crypto_quote("BTC")
        elif sym == "EURUSD":
            q = sources.stock_quote("EURUSD=X")
        else:
            q = sources.stock_quote(sym)
        if q and q.get("price") is not None and not q.get("error"):
            out.append({"sym": sym, "name": name, "price": q["price"], "change_pct": q.get("change_pct"),
                        "currency": q.get("currency") or "", "time": q.get("time")})
    return out


def _window_change(q, flow, h):
    return flow.get("px_chg_4h") if h == "4" else q.get("change_pct")


# ----------------------------------------------------------------- Alerts
ALERT_TEXT = {
    "price_above": "über {v}", "price_below": "unter {v}",
    "change_above": "heute mehr als +{v} %", "change_below": "heute mehr als −{v} %",
    "funding_above": "Funding über {v} %", "funding_below": "Funding unter {v} %",
}


def show_price(q, value, fx):
    """Anzeige: Aktien immer in Euro, Krypto in US-Dollar (dieselbe Regel in web/app.js: toShow)."""
    cur = q.get("currency") or ""
    if value is None or q.get("kind") == "crypto" or cur == "EUR":
        return value, cur
    rate = (fx or {}).get(cur)
    return (value / rate, "EUR") if rate else (value, cur)


def _show(q, value, fx):
    v, cur = show_price(q, value, fx)
    return _fmt(v), cur


def _fmt(x):
    if x is None:
        return "–"
    s = ("%.2f" % x) if abs(x) >= 1 else ("%.6f" % x).rstrip("0")
    return s.replace(".", ",")


def check_alerts(pf, market, state, fx=None):
    st = state.setdefault("alerts", {})
    ids = set()
    fired = 0
    for al in pf.get("alerts") or []:
        aid = al.get("id")
        ids.add(aid)
        if not aid or al.get("active") is False:
            continue
        q = market.get(asset_key(al.get("kind"), al.get("symbol"))) or {}
        v, typ = al.get("value"), al.get("type")
        price, chg = q.get("price"), q.get("change_pct")
        shown, shown_cur = show_price(q, price, fx)
        if typ and typ.startswith("price") and al.get("currency") == "EUR" and shown_cur == "EUR":
            price = shown       # Schwelle wurde in Euro eingegeben
        fund = (q.get("flow") or {}).get("funding_avg")
        if v is None or q.get("error") or q.get("stale"):
            continue
        hit, actual = False, None
        if typ == "price_above" and price is not None:
            hit, actual = price >= v, price
        elif typ == "price_below" and price is not None:
            hit, actual = price <= v, price
        elif typ == "change_above" and chg is not None:
            hit, actual = chg >= abs(v), chg
        elif typ == "change_below" and chg is not None:
            hit, actual = chg <= -abs(v), chg
        elif typ == "funding_above" and fund is not None:
            hit, actual = fund >= v, fund
        elif typ == "funding_below" and fund is not None:
            hit, actual = fund <= v, fund
        if not hit:
            continue
        prev = st.get(aid)
        daily = typ.startswith("change_")
        today = trade_day(q) if daily else datetime.date.today().isoformat()
        if prev and (not daily or prev.get("day") == today):
            continue    # Preis-Alerts feuern einmal, Tages-Alerts einmal pro Tag
        st[aid] = {"fired": now_iso(), "day": today, "value": actual}
        fired += 1
        name = q.get("name") or al.get("symbol")
        cur = " " + (al.get("currency") or q.get("currency", "")) if typ.startswith("price") else ""
        title = "%s %s" % (al.get("symbol"), ALERT_TEXT.get(typ, typ).format(v=_fmt(abs(v) if daily else v) + cur))
        body = "%s steht bei %s %s" % (name, _fmt(shown), shown_cur)
        if chg is not None:
            body += " (%s%s %% heute)" % ("+" if chg >= 0 else "−", _fmt(abs(chg)))
        if al.get("note"):
            body += "\n" + al["note"]
        push(pf, title, body)
    for aid in list(st):
        if aid not in ids:
            del st[aid]
    return fired


MOVE_DEFAULT = {"stock": 5.0, "crypto": 8.0}   # ab dieser Tagesbewegung in Prozent kommt eine Meldung, 0 = aus


def trade_day(q):
    """Handelstag eines Kurses. Aktien: Tag des letzten Kurses (US-Schluss um 22 Uhr ist nach Mitternacht UTC noch derselbe Tag).
    Krypto handelt rund um die Uhr: Kalendertag in UTC."""
    t = q.get("time")
    if q.get("kind") == "stock" and isinstance(t, (int, float)) and t > 0:
        return datetime.datetime.utcfromtimestamp(t - 4 * 3600).date().isoformat()
    return datetime.date.today().isoformat()


def check_moves(store, pf, market, state, fx=None):
    """Meldet starke Tagesbewegungen mit Einordnung der Bewertung: bei jeder vollen Schwelle (5, 10, 15 % ...) einmal."""
    cfg = pf.get("settings") or {}
    st = state.setdefault("moves", {})
    hits = []
    for key, q in market.items():
        chg = q.get("change_pct")
        lim = cfg.get("move_" + q.get("kind", ""), MOVE_DEFAULT.get(q.get("kind"), 0))
        if chg is None or not lim or q.get("error") or q.get("stale") or abs(chg) < lim:
            continue
        d = 1 if chg >= 0 else -1
        step = int(abs(chg) // lim)     # 1 = erste Schwelle, 2 = doppelte Schwelle usw.
        old = st.get(key) or {}
        today = trade_day(q)
        if old.get("day") == today and old.get("dir") == d and old.get("step", 1) >= step:
            continue    # je Tag, Richtung und Stufe nur eine Meldung
        hits.append((key, q, chg, d, step, today))
    for key in list(st):
        if key not in market:
            del st[key]
    if not hits:
        return 0
    daily = (store.get("daily.json") or {}).get("assets") or {}
    ai = (store.get("analysis.json") or {}).get("assets") or {}
    for key, q, chg, d, step, today in hits:
        st[key] = {"day": today, "dir": d, "step": step, "at": now_iso(), "value": chg}
        info = daily.get(key) or {}
        val = info.get("valuation") or {}
        title = "%s %s%s %% heute" % (q["symbol"], "+" if chg >= 0 else "−", _fmt(abs(chg)))
        lines = ["%s steht bei %s %s." % ((q.get("name") or q["symbol"],) + tuple(_show(q, q.get("price"), fx)))]
        if val.get("label"):
            pts = val.get("rating") or analytics.rating(val.get("score") or 0)
            lines.append("Bewertung: %d von 10 Punkten (%s). %s" % (pts, val["label"], analytics.move_read(chg, val, q.get("kind"))))
        verdict = ((ai.get(key) or {}).get("claude") or {}).get("verdict")
        if verdict:
            ai_pts = ((ai.get(key) or {}).get("claude") or {}).get("score")
            lines.append("Recherche: %s%s." % ("%s von 10, " % ai_pts if ai_pts else "", verdict))
        label = ((q.get("flow_read") or {}).get("24") or {}).get("label")
        if label:
            lines.append("Bewegung: %s." % label)
        below = [x for x in info.get("levels") or [] if q.get("price") and x.get("price") and x["price"] < q["price"]]
        if below and chg < 0:
            z = max(below, key=lambda x: x["price"])
            lines.append("Nächste Nachkauf-Zone: %s %s." % _show(q, z["price"], fx))
        lines.append("Keine Anlageberatung.")
        push(pf, title, "\n".join(lines))
    return len(hits)


def push(pf, title, body):
    """Push aufs Handy über ntfy. Der Kanalname ist das Geheimnis: wer ihn kennt, kann mitlesen."""
    import os
    topic = os.environ.get("NTFY_TOPIC") or (pf.get("settings") or {}).get("ntfy_topic")
    if not topic:
        return False
    server = ((pf.get("settings") or {}).get("ntfy_server") or "https://ntfy.sh").rstrip("/")
    try:
        http_json(server, body={"topic": topic, "title": title, "message": body, "tags": ["chart_with_upwards_trend"],
                                "priority": 4})
        return True
    except SourceError:
        log("Push fehlgeschlagen")
        return False


# ----------------------------------------------------------------- täglicher Lauf
def run_daily(store):
    pf = store.get("portfolio.json") or empty_portfolio()
    market = (store.get("market.json") or {}).get("assets") or {}
    assets = tracked_assets(pf)
    for k, v in strategy_assets(store).items():
        assets.setdefault(k, v)
    # Verläufe müssen bis zum ersten Kauf reichen, sonst rechnet der Vergleich alte Käufe mit späteren Kursen
    first = min((str(t.get("date") or "")[:10] for t in pf.get("transactions") or [] if t.get("date")), default="")
    rng = "10y" if first and first < (datetime.date.today() - datetime.timedelta(days=5 * 365 - 30)).isoformat() else "5y"
    first_day = (datetime.date.fromisoformat(first) - datetime.date(1970, 1, 1)).days if first else None
    yf = sources.YahooFundamentals()
    research = (store.get("analysis.json") or {}).get("assets") or {}   # Plan der Firma aus der Recherche fließt in die Punkte
    onchain = sources.onchain_revenue([a["symbol"] for a in assets.values() if a["kind"] == "crypto"])
    out, currencies = {}, {"USD"}
    # Gesamtmarkt als Maßstab: ein Rückgang zählt nur, wenn der Titel nicht deutlich schwächer läuft als der Markt
    hist_cache, market_6m = {}, {}
    for kind, sym in (("stock", "^GSPC"), ("crypto", "BTC")):
        h = sources.crypto_history(sym) if kind == "crypto" else sources.stock_history(sym, rng)
        hist_cache[asset_key(kind, sym)] = h
        market_6m[kind] = _perf_6m(h, kind == "crypto")
    for key, a in assets.items():
        crypto = a["kind"] == "crypto"
        h = hist_cache.get(key) or (sources.crypto_history(a["symbol"]) if crypto else sources.stock_history(a["symbol"], rng))
        if not h or len(h["c"]) < 2:
            continue
        currencies.add(h["currency"])
        q = market.get(key) or {}
        price = q.get("price") if not q.get("error") else None
        price = price or h["c"][-1]
        tech = analytics.technicals(h["c"], crypto)
        own, mkt = _perf_6m(h, crypto), market_6m["crypto" if crypto else "stock"]
        if tech and own is not None and mkt is not None and a["symbol"] not in ("BTC", "^GSPC"):
            tech["rel_6m"] = own - mkt
        lows = analytics.swing_lows(h["d"], h["c"])
        entry = {"hist": {"d": h["d"], "c": h["c"]}, "currency": h["currency"], "tech": _round(tech),
                 "levels": analytics.buy_levels(price, tech, lows)}
        # Momentum-Signal gegen den Markt (Aktien und ETFs: S&P 500, Coins: Bitcoin; die beiden selbst ohne Vergleich)
        bm = hist_cache.get(asset_key("crypto", "BTC") if crypto else asset_key("stock", "^GSPC"))
        mom = analytics.momentum(h["c"], bm["c"] if bm and a["symbol"] not in ("BTC", "^GSPC") else None, crypto)
        if mom:
            entry["mom"] = mom
        if h.get("name"):
            entry["name"] = h["name"]
        if crypto:
            oc = onchain.get(a["symbol"])
            if oc:
                entry["onchain"] = _round(oc)
            entry["valuation"] = analytics.crypto_valuation(price, tech, q.get("flow"), oc)
        else:
            fund = yf.get(a["symbol"]) or {}
            div = analytics.dividend_info(h["div"], price, fund)
            entry["fund"] = _round(fund)
            entry["div"] = div
            entry["divs"] = [[d, round(x, 4)] for d, x in h["div"]]
            entry["valuation"] = analytics.stock_valuation(price, tech, fund, div, (research.get(key) or {}).get("claude"))
            entry.update(yf.extra.get(a["symbol"]) or {})   # insider, analyst, sectors
            if fund.get("earnings_date"):
                entry["earnings_date"] = analytics.ts_to_iso(fund["earnings_date"])
        out[key] = entry
    for t in pf.get("transactions") or []:
        if t.get("currency"):
            currencies.add(t["currency"])
    bench = {}
    for name, (kind, sym, label) in BENCH.items():
        key = asset_key(kind, sym)
        h = out[key]["hist"] if key in out else hist_cache.get(key)
        if h and first_day is not None and h["d"] and h["d"][0] > first_day:
            # Binance liefert bei Bitcoin nur gut 1000 Tage: dann den längeren Verlauf von Yahoo nehmen
            h = sources.stock_history(sym + "-USD" if kind == "crypto" else sym, rng) or h
        if h and key in out and h is out[key]["hist"]:
            bench[name] = dict(h, label=label, currency=out[key]["currency"])
            continue
        h = h or (sources.crypto_history(sym) if kind == "crypto" else sources.stock_history(sym, rng))
        if h:
            bench[name] = {"d": h["d"], "c": h["c"], "label": label, "currency": h["currency"]}
    # Stimmung ohne Schlüssel: Reddit-Erwähnungen je Titel, Angst und Gier bei Krypto
    for key, b in sources.reddit_buzz([(a["kind"], a["symbol"]) for a in assets.values()]).items():
        if key in out:
            out[key]["reddit"] = b
    crypto_fg = sources.crypto_fear_greed()
    # Coins: Marktwert und Rang von CoinGecko; Logos aller Titel einmal holen und im privaten Daten-Repo ablegen
    meta = sources.coin_meta([a["symbol"] for a in assets.values() if a["kind"] == "crypto"])
    for key, a in assets.items():
        m = meta.get(a["symbol"]) if a["kind"] == "crypto" else None
        if m and key in out:
            out[key]["mcap"], out[key]["rank"] = m.get("mcap"), m.get("rank")
    # Strategie Wachstums-Momentum (Jakobs Wunsch vom 27.11.2026): heutige Mitglieder von S&P 500 und Nasdaq-100, dazu
    # Europa, China und Hongkong aus dem MSCI ACWI (28.11.2026) und Länder-ETFs, Kurse mit Dividenden über 2 Jahre
    base0 = store.get("screen_base.json") or {}
    members, uni_h = {}, {}
    try:
        members = screen.index_members(base0.get("members"))
        uni_h = screen.fetch_universe(screen.universe(members))
        for sym, v in members.items():      # Auslandsaktien: Name wie bei Yahoo statt in Großbuchstaben aus der iShares-Liste
            if v[0] == "welt" and (uni_h.get(sym) or {}).get("name"):
                v[2] = uni_h[sym]["name"]
    except Exception as e:
        log("Strategie Kurse: Fehler " + type(e).__name__)
    # Angst und Gier am Aktienmarkt: eigene Berechnung (CNN sperrt Skripte), aus Yahoo-Kursen
    fg_hist = {}
    for sym in ("^GSPC", "^VIX", "SPY", "TLT", "HYG", "IEF", "RSP"):
        h = sources.stock_history(sym, "2y")
        if h:
            fg_hist[sym] = (h["d"], h["c"])
    market_fg = analytics.market_fear_greed(fg_hist)
    # Smart Money / Dumb Money: Terminmarkt-Positionen (CFTC, wöchentlich) und Stimmung, eigene Berechnung
    smart = {}
    for name, crowd in (("stocks", {d: v for d, v in (market_fg or {}).get("hist") or []}), ("btc", sources.crypto_fear_greed_hist())):
        x = analytics.smart_dumb(sources.cftc_tff(sources.COT_MARKETS[name]), crowd)
        if x:
            smart[name] = x
    # Bitcoin: Kurzfrist- und Langfrist-Anleger im Plus oder Minus (Einstandspreise von BGeometrics, frei, 7 Tage verzögert)
    btc = bench.get("BTC")
    holders = analytics.holder_stats(sources.holder_cost(), btc["d"], btc["c"]) if btc else None
    holders = holders or (store.get("smart.json") or {}).get("holders")
    if holders:
        smart["holders"] = holders
    if smart:
        smart["updated"] = now_iso()
        store.put("smart.json", smart)
    logo_more = {}
    try:
        if members and screen.CAL in uni_h:
            base = screen.pack(uni_h)
            F = screen.snapshot(base["px"], screen.universe(members), len(base["days"]) - 1)
            show = screen.ranked(F)[:40] + screen.watch_syms(store.get("screen.json"), pf, members, 0)
            base.update(members=members, members_at=datetime.date.today().isoformat(),
                        info=screen.fund_info(show, yf, out, base0.get("info")),
                        fg={s: [d, c] for s, (d, c) in fg_hist.items()}, updated=now_iso())
            doc = screen.build(store, pf, base, push, {"stocks": (market_fg or {}).get("value"), "crypto": (crypto_fg or {}).get("value")},
                               mfg=market_fg, extra=screen.extra_hist(pf, out, members))
            store.put("screen_base.json", base)     # Grundlage für die Zwischenläufe mit aktuellen Kursen (refresh_strategy)
            logo_more = {r["key"]: {"kind": "stock", "symbol": r["symbol"], "name": r.get("name") or ""} for r in doc["list"]}
    except Exception as e:   # der Filter darf den Tageslauf nicht aufhalten
        log("Strategie: Fehler " + type(e).__name__)
    update_logos(store, dict(logo_more, **assets), dict({k: {"name": v["name"]} for k, v in logo_more.items()}, **out), meta)
    # Branchen der großen Indizes als Vergleich für die Sektoren des Depots (über die ETFs URTH und SPY)
    sector_bench = {}
    for name, sym in SECTOR_BENCH:
        yf.get(sym)
        w = (yf.extra.get(sym) or {}).get("sectors")
        if w:
            sector_bench[name] = w
    fx = {}
    for cur in sorted(currencies):
        if cur != "EUR":
            h = sources.fx_history(cur, rng)
            if h:
                fx[cur] = h
    store.put("daily.json", {"updated": now_iso(), "assets": out, "bench": bench, "sector_bench": sector_bench, "crypto_fg": crypto_fg, "market_fg": market_fg, "fx": fx,
                             "sources": sources.STATUS})
    log("Tagesdaten: %d von %d Titeln mit Verlauf" % (len(out), len(assets)))


SECTOR_BENCH = (("MSCI World", "URTH"), ("S&P 500", "SPY"))


def update_logos(store, assets, out, meta):
    """logos.json: je Titel ein kleines Bild als data-URI. Vorhandene bleiben 60 Tage, fehlende werden nach 7 Tagen neu versucht.
    So lädt die App keine Bilder von fremden Servern und verrät dort nicht, welche Titel im Depot stehen."""
    logos = store.get("logos.json") or {}
    today = datetime.date.today()
    changed = False
    for key, a in assets.items():
        have = logos.get(key) or {}
        try:
            age = (today - datetime.date.fromisoformat(have.get("at", "2000-01-01"))).days
        except ValueError:
            age = 999
        if have and age < (60 if have.get("img") else 7):
            continue
        d = out.get(key) or {}
        img = sources.logo(a["kind"], a["symbol"], d.get("name") or a.get("name") or "", (d.get("fund") or {}).get("website") or "",
                           (meta.get(a["symbol"]) or {}).get("image") if a["kind"] == "crypto" else None)
        logos[key] = {"img": img or have.get("img"), "at": today.isoformat()}
        changed = True
    for key in [k for k in logos if k not in assets]:
        del logos[key]
        changed = True
    if changed:
        store.put("logos.json", logos)
    log("Logos: %d von %d" % (sum(1 for v in logos.values() if v.get("img")), len(assets)))


def _perf_6m(h, crypto):
    k = 182 if crypto else 126
    c = (h or {}).get("c") or []
    return (c[-1] / c[-1 - k] - 1) * 100 if len(c) > k and c[-1 - k] else None


def _round(d):
    if not d:
        return d
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in d.items()}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "fast"
    store = get_store()
    try:
        if mode in ("fast", "all"):
            run_fast(store)
        if mode == "loop":
            # GitHub startet zeitgesteuerte Läufe nur alle 40 bis 150 Minuten. Deshalb prüft ein Lauf
            # bis zu 50 Minuten lang alle 5 Minuten; der nächste geplante Lauf übernimmt danach.
            minutes = float(sys.argv[2]) if len(sys.argv) > 2 else 50
            end = time.time() + minutes * 60
            while True:
                run_fast(store)
                if time.time() + 300 > end:
                    break
                time.sleep(300)
        if mode in ("daily", "all"):
            run_daily(store)
    except Exception as e:
        if CLOUD:   # öffentliches Protokoll: keine Details, die Titel verraten könnten
            log("Fehler: %s" % type(e).__name__)
            sys.exit(1)
        raise
    for name, s in sorted(sources.STATUS.items()):
        log("  %-18s ok %d, Fehler %d" % (name, s["ok"], s["fehler"]))


if __name__ == "__main__":
    main()
