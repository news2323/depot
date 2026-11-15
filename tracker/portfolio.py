"""Bestände aus den eingetragenen Käufen und Verkäufen (FIFO), alles in Euro."""
import bisect
import datetime

from .common import asset_key


def _day(iso):
    try:
        return (datetime.date.fromisoformat(str(iso)[:10]) - datetime.date(1970, 1, 1)).days
    except ValueError:
        return None


def fx_at(cur, iso, daily_fx, fx_now):
    """Einheiten der Währung pro Euro am Tag der Buchung, sonst der aktuelle Kurs."""
    if cur == "EUR":
        return 1.0
    h = (daily_fx or {}).get(cur)
    d = _day(iso)
    if h and d is not None and h["d"]:
        i = bisect.bisect_right(h["d"], d) - 1
        if i >= 0:
            return h["c"][i]
    return (fx_now or {}).get(cur)


def positions(pf, market, daily):
    """Liste der Positionen mit Stückzahl, Einstand, Wert, Gewinn. Verkäufe lösen die ältesten Käufe auf."""
    assets = (market or {}).get("assets") or {}
    fx_now = (market or {}).get("fx") or {}
    daily_fx = (daily or {}).get("fx") or {}
    lots, realized, names = {}, {}, {}
    for t in sorted(pf.get("transactions") or [], key=lambda x: (str(x.get("date")), x.get("type") != "buy")):
        key = asset_key(t.get("kind"), t.get("symbol"))
        try:
            qty, price, fee = float(t.get("qty") or 0), float(t.get("price") or 0), float(t.get("fee") or 0)
        except (TypeError, ValueError):
            continue
        rate = fx_at(t.get("currency") or "EUR", t.get("date"), daily_fx, fx_now) or 1.0
        if t.get("name"):
            names[key] = t["name"]
        q = lots.setdefault(key, [])
        if t.get("type") == "buy":
            q.append([qty, (qty * price + fee) / rate])
        elif t.get("type") == "sell":
            proceeds = (qty * price - fee) / rate
            left, cost = qty, 0.0
            while left > 1e-12 and q:
                lq, lc = q[0]
                take = min(lq, left)
                cost += lc * take / lq
                q[0] = [lq - take, lc - lc * take / lq]
                if q[0][0] <= 1e-12:
                    q.pop(0)
                left -= take
            realized[key] = realized.get(key, 0.0) + proceeds - cost
    out = []
    for key, q in lots.items():
        qty = sum(x[0] for x in q)
        a = assets.get(key) or {}
        kind, symbol = key.split(":", 1)
        price = a.get("price") if not a.get("error") else None
        rate = fx_now.get(a.get("currency") or "USD") or 1.0
        value = qty * price / rate if price is not None else None
        chg = a.get("change_pct")
        cost = sum(x[1] for x in q)
        out.append({"key": key, "kind": kind, "symbol": symbol, "name": a.get("name") or names.get(key) or symbol,
                    "qty": qty, "cost": cost, "value": value, "realized": realized.get(key, 0.0),
                    "pnl": value - cost if value is not None else None,
                    "pnl_pct": (value / cost - 1) * 100 if value is not None and cost > 0 else None,
                    "day_pct": chg,
                    "day_eur": value - value / (1 + chg / 100) if value is not None and chg is not None and chg > -100 else None})
    return out


def totals(pos):
    held = [p for p in pos if p["qty"] > 1e-12 and p["value"] is not None]
    value = sum(p["value"] for p in held)
    cost = sum(p["cost"] for p in held)
    day = sum(p["day_eur"] or 0 for p in held)
    return {"value": value, "cost": cost, "pnl": value - cost, "pnl_pct": (value / cost - 1) * 100 if cost else None,
            "day_eur": day, "day_pct": day / (value - day) * 100 if value - day > 0 else None,
            "realized": sum(p["realized"] for p in pos),
            "crypto_share": sum(p["value"] for p in held if p["kind"] == "crypto") / value * 100 if value else None}
