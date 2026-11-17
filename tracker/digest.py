"""Baut aus allen Daten den Termin-Kalender und die Kurzfassung für den Newsletter (digest.json).

    python3 -m tracker.digest
"""
import datetime
import sys

from . import portfolio, sources
from .common import CLOUD, empty_portfolio, get_store, log, now_iso, tracked_assets


def _valid(iso):
    try:
        datetime.date.fromisoformat(str(iso)[:10])
        return str(iso)[:10]
    except (TypeError, ValueError):
        return None


def build_calendar(assets, market, daily, analysis, pos):
    """Quartalszahlen, Ex-Dividenden- und Zahltage sowie Krypto-Termine der beobachteten Titel."""
    today = datetime.date.today().isoformat()
    seen, out = set(), []

    def add(date, category, key, title, **extra):
        date = _valid(date)
        if not date or date < today or (date, category, key) in seen:
            return
        seen.add((date, category, key))
        out.append(dict(date=date, category=category, key=key, symbol=key.split(":", 1)[1], title=title, **extra))

    for key, a in assets.items():
        q = (market.get("assets") or {}).get(key) or {}
        d = (daily.get("assets") or {}).get(key) or {}
        c = ((analysis.get("assets") or {}).get(key) or {}).get("claude") or {}
        name = q.get("name") or a["symbol"]
        qty = (pos.get(key) or {}).get("qty") or 0
        if a["kind"] == "stock":
            ne = c.get("next_earnings") or {}
            add(ne.get("date") or d.get("earnings_date"), "Earnings", key, "%s: Quartalszahlen" % name,
                estimated=not ne.get("confirmed", bool(d.get("earnings_date"))))
            add(d.get("earnings_date"), "Earnings", key, "%s: Quartalszahlen" % name)
            div, cd = d.get("div") or {}, c.get("dividend") or {}
            amount = div.get("last_amount")
            cur = q.get("currency") or d.get("currency") or ""
            amt = (" (%s %s je Aktie)" % (("%.2f" % amount).replace(".", ","), cur)) if amount else ""
            ex = _valid(cd.get("ex_date")) if _valid(cd.get("ex_date")) and cd["ex_date"] >= today else div.get("next_ex")
            est = bool(div.get("next_ex_estimated")) and ex == div.get("next_ex")
            add(ex, "Dividende", key, "%s: Ex-Dividende%s" % (name, amt), estimated=est,
                expected=round(amount * qty, 2) if amount and qty > 0 else None, currency=cur)
            pay = _valid(cd.get("pay_date")) if _valid(cd.get("pay_date")) and cd["pay_date"] >= today else div.get("next_pay")
            add(pay, "Zahltag", key, "%s: Dividende wird gezahlt%s" % (name, amt),
                expected=round(amount * qty, 2) if amount and qty > 0 else None, currency=cur)
        else:
            for e in c.get("events") or []:
                if e.get("title"):
                    add(e.get("date"), "Krypto", key, "%s: %s" % (a["symbol"], e["title"]))
    # Markttermine wie im Newsletter: große US-Quartalszahlen, Konjunktur, Notenbanken, Börsengänge
    own_stocks = {k.split(":", 1)[1].upper(): k for k, a in assets.items() if a["kind"] == "stock"}
    mine = {(e["date"], e["symbol"].upper()): e for e in out if e["category"] == "Earnings"}
    for e in sources.market_calendar(own_stocks):
        if e["category"] == "Earnings" and e.get("symbol") in own_stocks:
            hit = mine.get((e["date"], e["symbol"]))
            if hit:
                hit["time"] = e["time"]
                continue
            add(e["date"], "Earnings", own_stocks[e["symbol"]], e["title"], time=e["time"])
            continue
        if e["date"] >= today:
            out.append({"date": e["date"], "time": e.get("time") or "", "category": e["category"], "key": "markt:" + (e.get("symbol") or ""),
                        "symbol": e.get("symbol") or "", "title": e["title"], "market": True})
    out.sort(key=lambda e: (e["date"], _clock(e.get("time")), e["category"]))
    return out


def _clock(t):
    """Sortierschlüssel für die Uhrzeit: vorbörslich vor Börsenstart, nachbörslich nach Börsenschluss (deutsche Zeit)."""
    return {"vorbörslich": "13:00", "nachbörslich": "22:05", "": "00:00", None: "00:00"}.get(t, t)


def main():
    store = get_store()
    pf = store.get("portfolio.json") or empty_portfolio()
    market = store.get("market.json") or {}
    daily = store.get("daily.json") or {}
    analysis = store.get("analysis.json") or {}
    assets = tracked_assets(pf)
    pos_list = portfolio.positions(pf, market, daily)
    pos = {p["key"]: p for p in pos_list}
    cal = build_calendar(assets, market, daily, analysis, pos)
    # Antwortet eine Markt-Quelle nicht, bleiben ihre Termine vom letzten Lauf stehen
    old = (store.get("digest.json") or {}).get("calendar") or []
    today = datetime.date.today().isoformat()
    for cats in (("Makro", "Fed"), ("IPO",)):
        if not any(e["category"] in cats for e in cal):
            cal += [e for e in old if e.get("market") and e["category"] in cats and e["date"] >= today]
    cal.sort(key=lambda e: (e["date"], _clock(e.get("time")), e["category"]))
    tot = portfolio.totals(pos_list)
    held = [p for p in pos_list if p["qty"] > 1e-12 and p["value"] is not None]
    movers = sorted((p for p in held if p["day_pct"] is not None), key=lambda p: -abs(p["day_pct"]))[:5]
    week = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()
    news = {
        "value": round(tot["value"], 2), "day_eur": round(tot["day_eur"], 2), "day_pct": tot["day_pct"],
        "pnl": round(tot["pnl"], 2), "pnl_pct": tot["pnl_pct"], "positions": len(held),
        "movers": [{"symbol": p["symbol"], "name": p["name"], "change_pct": round(p["day_pct"], 2),
                    "day_eur": round(p["day_eur"] or 0, 2)} for p in movers],
        "events": [e for e in cal if e["date"] <= week][:8],
        "headline": (analysis.get("portfolio") or {}).get("headline") or "",
    }
    store.put("digest.json", {"updated": now_iso(), "calendar": cal, "newsletter": news})
    log("Kalender: %d Termine" % len(cal))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if CLOUD:
            log("Fehler: %s" % type(e).__name__)
            sys.exit(1)
        raise
