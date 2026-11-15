"""Aktualisiert die Daten des Trackers.

    python3 -m tracker.update fast    Kurse, Krypto-Flows, Alerts (alle paar Minuten)
    python3 -m tracker.update daily   Kursverläufe, Kennzahlen, Dividenden, Nachkauf-Zonen (einmal täglich)
    python3 -m tracker.update all     beides
"""
import datetime
import sys
import time

from . import analytics, sources
from .common import CLOUD, SourceError, asset_key, empty_portfolio, get_store, http_json, log, now_iso, tracked_assets

BENCH = {"SP500": ("stock", "^GSPC", "S&P 500"), "BTC": ("crypto", "BTC", "Bitcoin")}


# ----------------------------------------------------------------- schneller Lauf
def run_fast(store):
    pf = store.get("portfolio.json") or empty_portfolio()
    state = store.get("state.json") or {}
    assets = tracked_assets(pf)
    old = (store.get("market.json") or {}).get("assets") or {}
    out, currencies = {}, set()
    oi_mem = state.setdefault("oi", {})
    now = time.time()
    for key, a in assets.items():
        if a["kind"] == "stock":
            q = sources.stock_quote(a["symbol"])
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
    old_fx = (store.get("market.json") or {}).get("fx") or {}
    for cur in sorted(currencies | {"USD"}):
        if cur != "EUR":
            fx[cur] = sources.fx_rate(cur) or old_fx.get(cur)
    fired = check_alerts(pf, out, state, fx)
    moved = check_moves(store, pf, out, state, fx)
    for sym in list(oi_mem):
        if asset_key("crypto", sym) not in assets:
            del oi_mem[sym]
    store.put("market.json", {"updated": now_iso(), "fx": fx, "assets": out, "sources": sources.STATUS})
    store.put("state.json", state)
    log("Kurse: %d Titel, %d ohne Daten, %d Alerts ausgelöst, %d Bewegungen gemeldet" % (
        len(out), sum(1 for q in out.values() if q.get("error")), fired, moved))


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
    today = datetime.date.today().isoformat()
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


def check_moves(store, pf, market, state, fx=None):
    """Meldet starke Tagesbewegungen mit Einordnung der Bewertung: bei jeder vollen Schwelle (5, 10, 15 % ...) einmal."""
    cfg = pf.get("settings") or {}
    st = state.setdefault("moves", {})
    today = datetime.date.today().isoformat()
    hits = []
    for key, q in market.items():
        chg = q.get("change_pct")
        lim = cfg.get("move_" + q.get("kind", ""), MOVE_DEFAULT.get(q.get("kind"), 0))
        if chg is None or not lim or q.get("error") or q.get("stale") or abs(chg) < lim:
            continue
        d = 1 if chg >= 0 else -1
        step = int(abs(chg) // lim)     # 1 = erste Schwelle, 2 = doppelte Schwelle usw.
        old = st.get(key) or {}
        if old.get("day") == today and old.get("dir") == d and old.get("step", 1) >= step:
            continue    # je Tag, Richtung und Stufe nur eine Meldung
        hits.append((key, q, chg, d, step))
    for key in list(st):
        if key not in market:
            del st[key]
    if not hits:
        return 0
    daily = (store.get("daily.json") or {}).get("assets") or {}
    ai = (store.get("analysis.json") or {}).get("assets") or {}
    for key, q, chg, d, step in hits:
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
    yf = sources.YahooFundamentals()
    onchain = sources.onchain_revenue([a["symbol"] for a in assets.values() if a["kind"] == "crypto"])
    out, currencies = {}, {"USD"}
    for key, a in assets.items():
        crypto = a["kind"] == "crypto"
        h = sources.crypto_history(a["symbol"]) if crypto else sources.stock_history(a["symbol"])
        if not h or len(h["c"]) < 2:
            continue
        currencies.add(h["currency"])
        q = market.get(key) or {}
        price = q.get("price") if not q.get("error") else None
        price = price or h["c"][-1]
        tech = analytics.technicals(h["c"], crypto)
        lows = analytics.swing_lows(h["d"], h["c"])
        entry = {"hist": {"d": h["d"], "c": h["c"]}, "currency": h["currency"], "tech": _round(tech),
                 "levels": analytics.buy_levels(price, tech, lows)}
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
            entry["valuation"] = analytics.stock_valuation(price, tech, fund, div)
            if fund.get("earnings_date"):
                entry["earnings_date"] = analytics.ts_to_iso(fund["earnings_date"])
        out[key] = entry
    for t in pf.get("transactions") or []:
        if t.get("currency"):
            currencies.add(t["currency"])
    bench = {}
    for name, (kind, sym, label) in BENCH.items():
        key = asset_key(kind, sym)
        if key in out:
            bench[name] = dict(out[key]["hist"], label=label, currency=out[key]["currency"])
            continue
        h = sources.crypto_history(sym) if kind == "crypto" else sources.stock_history(sym)
        if h:
            bench[name] = {"d": h["d"], "c": h["c"], "label": label, "currency": h["currency"]}
    fx = {}
    for cur in sorted(currencies):
        if cur != "EUR":
            h = sources.fx_history(cur)
            if h:
                fx[cur] = h
    store.put("daily.json", {"updated": now_iso(), "assets": out, "bench": bench, "fx": fx, "sources": sources.STATUS})
    log("Tagesdaten: %d von %d Titeln mit Verlauf" % (len(out), len(assets)))


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
