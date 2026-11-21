"""KI-Recherche (läuft einmal täglich, nur wenn die API-Schlüssel gesetzt sind).

Claude: sucht Investor-Relations-Seiten, Quartalszahlen, Dividendentermine und ordnet die Bewertung ein.
Grok:   liest die Stimmung auf X zu jedem Titel.

Es werden nur Ticker und öffentliche Kennzahlen verschickt, nie Stückzahlen oder Euro-Beträge.
Für die Depot-Einschätzung gehen Gewichte in Prozent an Claude.

    python3 -m tracker.ai
"""
import datetime
import json
import os
import sys

from . import common, portfolio
from .common import CLOUD, SourceError, get_store, http_json, log, now_iso, tracked_assets, empty_portfolio

# ================= EINSTELLUNGEN =================
CLAUDE_MODEL = "claude-opus-5-5"
GROK_MODEL = "grok-4.7"
REFRESH_DAYS = 7        # jede Aktie/jeder Coin wird höchstens so oft neu recherchiert
MAX_PER_RUN = 6         # Obergrenze je Lauf, hält die Kosten planbar
# =================================================

STYLE = ("Schreibe auf Deutsch, in eigenen Worten, klar und nüchtern: kurze Sätze, kein Börsenjargon, keine Ausrufezeichen. "
         "Nur Zahlen, die du in der Recherche gefunden hast oder die unten stehen. Fehlt ein Wert, lass das Feld leer (\"\" oder null). "
         "Antworte ausschließlich mit einem JSON-Objekt, ohne Text davor oder danach und ohne Codeblock.")


def parse_json(text):
    a, b = text.find("{"), text.rfind("}")
    if a == -1 or b == -1:
        raise ValueError("kein JSON")
    return json.loads(text[a:b + 1])


def ask_claude(client, prompt, search=True):
    """Eine Anfrage an Claude, optional mit Websuche. Gibt das JSON-Objekt zurück oder None."""
    messages = [{"role": "user", "content": prompt}]
    kwargs = dict(model=CLAUDE_MODEL, max_tokens=16000, thinking={"type": "adaptive"},
                  output_config={"effort": "medium"},
                  betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    if search:
        kwargs["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 8}]
    parts = []
    for _ in range(6):
        resp = client.beta.messages.create(messages=messages, **kwargs)
        if resp.stop_reason == "refusal":
            return None
        parts += [b.text for b in resp.content if b.type == "text"]
        if resp.stop_reason != "pause_turn":
            break
        messages = [messages[0], {"role": "assistant", "content": resp.content}]
    try:
        return parse_json("".join(parts))
    except ValueError:
        return None


def stock_prompt(a, q, d, today):
    fund = d.get("fund") or {}
    facts = {"Kurs": q.get("price"), "Währung": q.get("currency"), "KGV": fund.get("pe"),
             "erwartetes KGV": fund.get("forward_pe"), "PEG": fund.get("peg"),
             "Analystenziel (Mittel)": fund.get("target_mean"), "52-Wochen-Hoch": (d.get("tech") or {}).get("high52"),
             "52-Wochen-Tief": (d.get("tech") or {}).get("low52"), "200-Tage-Linie": (d.get("tech") or {}).get("sma200"),
             "technische Nachkauf-Zonen": [x["price"] for x in d.get("levels") or []],
             "IR-Seite laut Yahoo": fund.get("ir_website") or fund.get("website")}
    facts = {k: v for k, v in facts.items() if v not in (None, "", [])}
    return f"""Heute ist {today}. Analysiere die Aktie {a['symbol']} ({q.get('name') or a.get('name') or ''}) für einen Privatanleger.

Recherchiere mit der Websuche, bevorzugt auf der Investor-Relations-Seite des Unternehmens:
1. die zuletzt gemeldeten Quartalszahlen (Umsatz, Gewinn je Aktie, Vergleich zu Vorjahr und Erwartungen, Ausblick),
2. den Termin der nächsten Quartalszahlen,
3. die Dividende: Höhe je Aktie, Rhythmus, nächster Ex-Tag und Zahltag,
4. wie die Aktie im Vergleich zur eigenen Historie und zu Wettbewerbern bewertet ist.

Bekannte Kennzahlen (Stand heute): {json.dumps(facts, ensure_ascii=False)}

Leite daraus ab, ob die Aktie eher unterbewertet, fair oder überbewertet ist, und nenne bis zu drei Kurszonen,
an denen ein Nachkauf sinnvoll wäre, jeweils mit Begründung. Das ist eine Einschätzung, keine Anlageberatung.

{STYLE}
Struktur:
{{"summary": "2–3 Sätze zur Lage des Unternehmens",
 "business": {{"what": "1–2 einfache Sätze, was das Unternehmen tut", "money": "1–2 Sätze, womit es sein Geld verdient, mit groben Anteilen der Sparten"}},
 "verdict": "unterbewertet|fair|überbewertet", "score": 5, "confidence": "niedrig|mittel|hoch",
 "valuation_reasoning": "3–4 Sätze, warum",
 "last_quarter": {{"period": "z. B. Q3 2026", "date": "YYYY-MM-DD", "revenue": "", "revenue_growth": "", "eps": "", "vs_expectations": "", "guidance": "", "highlights": ["2–4 Punkte"], "source_url": ""}},
 "next_earnings": {{"date": "YYYY-MM-DD", "confirmed": true}},
 "dividend": {{"amount": "", "frequency": "", "ex_date": "YYYY-MM-DD", "pay_date": "YYYY-MM-DD", "yield_pct": null, "note": ""}},
 "buy_zones": [{{"price": 0.0, "reason": ""}}],
 "risks": ["2–3 Punkte"], "catalysts": ["2–3 Punkte"],
 "ir_url": "", "sources": [{{"name": "", "url": ""}}]}}
score ist eine ganze Zahl von 1 bis 10: 1 = deutlich überbewertet, 5 bis 6 = fair, 10 = deutlich unterbewertet.
Kurse in buy_zones in {q.get('currency') or 'der Handelswährung'}."""


def crypto_prompt(a, q, d, today):
    flow = q.get("flow") or {}
    facts = {"Kurs USD": q.get("price"), "24 Std. %": q.get("change_pct"),
             "Einordnung 24 Std.": ((q.get("flow_read") or {}).get("24") or {}).get("label"),
             "Spot-Kaufdruck 24 Std. (Anteil am Volumen)": ((flow.get("spot") or {}).get("24") or {}).get("ratio"),
             "Futures-Kaufdruck 24 Std.": ((flow.get("fut") or {}).get("24") or {}).get("ratio"),
             "Open Interest USD": flow.get("oi_total"), "OI-Änderung 24 Std. %": (flow.get("oi_chg") or {}).get("24"),
             "Funding je 8 Std. %": flow.get("funding_avg"),
             "200-Tage-Linie": (d.get("tech") or {}).get("sma200"), "Jahreshoch": (d.get("tech") or {}).get("high52"),
             "technische Nachkauf-Zonen": [x["price"] for x in d.get("levels") or []]}
    oc = d.get("onchain") or {}
    facts.update({"Marktwert USD": oc.get("mcap"), "voll verwässerter Wert USD": oc.get("fdv"),
                  "Gebühren 30 Tage USD (DeFi Llama)": oc.get("fees_30d"), "Einnahmen des Protokolls 30 Tage USD": oc.get("rev_30d"),
                  "davon an Token-Halter 30 Tage USD": oc.get("holders_30d"),
                  "Einnahmen zum Vormonat %": oc.get("rev_chg"), "Marktwert zu Jahreseinnahmen": oc.get("pe")})
    facts = {k: v for k, v in facts.items() if v not in (None, "", [])}
    return f"""Heute ist {today}. Analysiere den Coin {a['symbol']} ({q.get('name') or ''}) für einen Privatanleger.

Marktdaten von den Börsen (Stand heute): {json.dumps(facts, ensure_ascii=False)}

Recherchiere mit der Websuche die wichtigsten Nachrichten der letzten Tage und anstehende Termine
(Token-Unlocks, Upgrades, Listings, ETF-Entscheidungen). Ordne ein, ob der Markt eher überhitzt, neutral oder abgekühlt ist,
was die Derivate-Daten (Spot gegen Futures, Open Interest, Funding) bedeuten, ob der Marktwert zu den Einnahmen des Protokolls passt (falls oben angegeben), und nenne bis zu drei Kurszonen für Nachkäufe.
Das ist eine Einschätzung, keine Anlageberatung.

{STYLE}
Struktur:
{{"summary": "2–3 Sätze", "business": {{"what": "1–2 einfache Sätze, was das Projekt tut", "money": "1–2 Sätze, womit es Einnahmen erzielt und ob sie an Token-Halter gehen"}}, "verdict": "unterbewertet|fair|überbewertet", "score": 5, "confidence": "niedrig|mittel|hoch",
 "valuation_reasoning": "2–3 Sätze", "flow_comment": "2 Sätze zu Spot, Futures, Open Interest und Funding",
 "events": [{{"date": "YYYY-MM-DD", "title": ""}}],
 "buy_zones": [{{"price": 0.0, "reason": ""}}],
 "risks": ["2–3 Punkte"], "catalysts": ["2–3 Punkte"], "sources": [{{"name": "", "url": ""}}]}}
score ist eine ganze Zahl von 1 bis 10: 1 = deutlich überbewertet, 5 bis 6 = fair, 10 = deutlich unterbewertet.
Kurse in buy_zones in USD."""


def depot_prompt(rows, today):
    return f"""Heute ist {today}. Hier ist ein privates Depot aus Aktien und Krypto (Gewichte in Prozent, Gewinn seit Kauf in Prozent,
regelbasierte Bewertung, KI-Urteil je Titel, technische Nachkauf-Zonen). Die Watchlist steht mit Gewicht 0 dabei.

{json.dumps(rows, ensure_ascii=False)}

Gib eine ehrliche Einschätzung: Wo liegen Klumpenrisiken? Welche Titel wirken überbewertet, welche unterbewertet?
Welche könnte man nachkaufen und ab welchem Kurs? Stütze dich nur auf die Daten oben. Keine Anlageberatung, keine Garantien.

{STYLE}
Struktur:
{{"headline": "ein Satz, max. 12 Wörter", "summary": "3–4 Sätze",
 "overvalued": [{{"symbol": "", "reason": ""}}], "undervalued": [{{"symbol": "", "reason": ""}}],
 "buy_candidates": [{{"symbol": "", "level": "Kurs oder Zone mit Währung", "reason": ""}}],
 "risks": ["2–4 Punkte"]}}"""


def ask_grok(symbols, today):
    """Stimmung auf X je Titel. Ein Abruf für alle Titel."""
    key = os.environ.get("XAI_API_KEY")
    if not key or not symbols:
        return None
    prompt = f"""Heute ist {today}. Suche auf X und im Web nach der aktuellen Stimmung zu diesen Titeln: {", ".join(symbols)}.
Bewerte je Titel die Stimmung der letzten 48 Stunden und fasse zusammen, worüber gesprochen wird.
{STYLE}
Struktur: {{"market_mood": "1–2 Sätze zur Gesamtstimmung",
 "assets": [{{"symbol": "", "sentiment": "bullisch|neutral|bärisch", "summary": "1–2 Sätze", "topics": ["2–3 Stichworte"]}}]}}"""
    try:
        r = http_json("https://api.x.ai/v1/responses", timeout=600, headers={"Authorization": "Bearer " + key},
                      body={"model": GROK_MODEL, "input": [{"role": "user", "content": prompt}],
                            "tools": [{"type": "web_search"}, {"type": "x_search"}]})
    except SourceError as e:
        log("Grok: Abruf fehlgeschlagen (%s)" % e)
        return None
    text = ""
    for item in r.get("output") or []:
        if item.get("type") == "message":
            for c in item.get("content") or []:
                text += c.get("text") or ""
    try:
        return parse_json(text)
    except ValueError:
        log("Grok: Antwort nicht lesbar")
        return None


def _age_days(iso):
    try:
        t = datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")
        return (datetime.datetime.utcnow() - t).total_seconds() / 86400
    except (TypeError, ValueError):
        return 1e9


def due_keys(assets, res, daily, pos, today, refresh_days=None):
    """Titel, die neu recherchiert werden sollten: Bestand zuerst, dann die ältesten."""
    days = REFRESH_DAYS if refresh_days is None else refresh_days
    todo = []
    for key in assets:
        old = (res.get(key) or {}).get("claude") or {}
        age = _age_days(old.get("at"))
        earn = (daily.get("assets") or {}).get(key, {}).get("earnings_date")
        fresh_numbers = bool(earn and old.get("at") and old["at"][:10] < earn <= today)
        if age >= days or fresh_numbers:
            todo.append((key, age))
    todo.sort(key=lambda x: (0 if (pos.get(x[0]) or {}).get("qty", 0) > 0 else 1, -x[1]))
    return [k for k, _ in todo]


def depot_rows(assets, res, market, daily, pos):
    """Zeilen für die Depot-Einschätzung: nur Gewichte in Prozent, keine Beträge. Leer ohne Bestand."""
    held = [p for p in pos.values() if p["qty"] > 1e-12 and p["value"]]
    total = sum(p["value"] for p in held)
    if not held or not total:
        return []
    rows = []
    for key, a in assets.items():
        p = pos.get(key)
        d = (daily.get("assets") or {}).get(key) or {}
        q = (market.get("assets") or {}).get(key) or {}
        art = common.asset_type(a["kind"], q)
        rows.append({"symbol": a["symbol"], "art": art, "name": q.get("name") or a.get("name") or "",
                     "gewicht_pct": round(p["value"] / total * 100, 1) if p and p["value"] and p["qty"] > 1e-12 else 0,
                     "gewinn_pct": round(p["pnl_pct"], 1) if p and p["pnl_pct"] is not None and p["qty"] > 1e-12 else None,
                     "kurs": q.get("price"), "waehrung": q.get("currency"),
                     "punkte_regel_1_bis_10": (d.get("valuation") or {}).get("rating"),
                     "bewertung_regel": (d.get("valuation") or {}).get("label"),
                     "urteil_ki": ((res.get(key) or {}).get("claude") or {}).get("verdict"),
                     "nachkauf_zonen": [x["price"] for x in d.get("levels") or []],
                     "sektor": (d.get("fund") or {}).get("sector")})
    return rows


def main():
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("XAI_API_KEY"):
        log("KI: keine Schlüssel gesetzt, übersprungen")
        return
    store = get_store()
    pf = store.get("portfolio.json") or empty_portfolio()
    market = store.get("market.json") or {}
    daily = store.get("daily.json") or {}
    analysis = store.get("analysis.json") or {}
    res = analysis.setdefault("assets", {})
    assets = tracked_assets(pf)
    today = datetime.date.today().isoformat()
    pos = {p["key"]: p for p in portfolio.positions(pf, market, daily)}
    for key in list(res):
        if key not in assets:
            del res[key]

    client = None
    if os.environ.get("ANTHROPIC_API_KEY"):
        import anthropic
        client = anthropic.Anthropic(timeout=900)
    else:
        log("Claude: kein Schlüssel gesetzt, übersprungen")

    if client:
        todo = due_keys(assets, res, daily, pos, today)
        done = 0
        for key in todo[:MAX_PER_RUN]:
            a = assets[key]
            q = (market.get("assets") or {}).get(key) or {}
            d = (daily.get("assets") or {}).get(key) or {}
            if q.get("error"):
                continue
            prompt = (crypto_prompt if a["kind"] == "crypto" else stock_prompt)(a, q, d, today)
            try:
                out = ask_claude(client, prompt)
            except Exception as e:
                log("Claude: Abruf fehlgeschlagen (%s)" % type(e).__name__)
                out = None
            if out:
                out["at"] = now_iso()
                out["price_at"] = q.get("price")
                res.setdefault(key, {})["claude"] = out
                done += 1
        log("Claude: %d Titel recherchiert, %d weitere stehen an" % (done, max(0, len(todo) - MAX_PER_RUN)))

        rows = depot_rows(assets, res, market, daily, pos)
        if rows:
            try:
                out = ask_claude(client, depot_prompt(rows, today), search=False)
            except Exception as e:
                log("Claude: Depot-Einschätzung fehlgeschlagen (%s)" % type(e).__name__)
                out = None
            if out:
                out["at"] = now_iso()
                analysis["portfolio"] = out

    if os.environ.get("XAI_API_KEY"):
        g = ask_grok([a["symbol"] for a in assets.values()][:30], today)
        if g:
            analysis["grok"] = {"at": now_iso(), "market_mood": g.get("market_mood") or ""}
            by = {str(x.get("symbol") or "").upper(): x for x in g.get("assets") or []}
            n = 0
            for key, a in assets.items():
                x = by.get(a["symbol"])
                if x:
                    x["at"] = now_iso()
                    res.setdefault(key, {})["grok"] = x
                    n += 1
            log("Grok: Stimmung für %d Titel" % n)
    else:
        log("Grok: kein Schlüssel gesetzt, übersprungen")

    analysis["updated"] = now_iso()
    store.put("analysis.json", analysis)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if CLOUD:
            log("Fehler: %s" % type(e).__name__)
            sys.exit(1)
        raise
