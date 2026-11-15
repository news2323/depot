"""KI-Recherche über das Claude-Abo statt über die API-Abrechnung.

Eine geplante Aufgabe in der Claude-App ruft diese Befehle auf dem Mac auf. Claude recherchiert im Web und
gibt je Titel ein JSON zurück; dieses Skript liefert die Aufträge und speichert die Ergebnisse in analysis.json.
Claude sieht dabei nur Ticker, öffentliche Kennzahlen und Gewichte in Prozent, nie Stückzahlen oder Euro-Beträge.

    python3 -m tracker.abo plan   --repo name/depot-daten     Aufträge für fällige Titel (JSON)
    python3 -m tracker.abo save   --repo ... KEY DATEI        Ergebnis für einen Titel speichern
    python3 -m tracker.abo depot  --repo ...                  Auftrag für die Depot-Einschätzung
    python3 -m tracker.abo save-depot --repo ... DATEI        Depot-Einschätzung speichern, Kalender neu bauen

Ohne --repo arbeitet es mit dem lokalen Ordner data/. Mit --repo holt es den Zugangsschlüssel aus dem
macOS-Schlüsselbund (dort legt ihn "git push" ab) und gibt ihn nirgends aus.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

from . import ai, common, portfolio
from .common import empty_portfolio, get_store, now_iso, tracked_assets

MAX_TITEL = 12      # Obergrenze je Lauf, schont das Nutzungslimit des Abos
REFRESH_DAYS = 6    # wöchentlicher Lauf: alles, was älter als 6 Tage ist, ist fällig


def keychain_token():
    try:
        p = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                           capture_output=True, text=True, timeout=20,
                           env=dict(os.environ, GIT_TERMINAL_PROMPT="0"))
    except (OSError, subprocess.SubprocessError):
        return None
    for line in p.stdout.splitlines():
        if line.startswith("password="):
            return line[9:]
    return None


def connect(repo):
    if repo:
        token = os.environ.get("DATA_TOKEN") or keychain_token()
        if not token:
            sys.exit("Kein Zugangsschlüssel im Schlüsselbund. Einmal 'git push' im Ordner ausführen, dann ist er gespeichert.")
        os.environ["DATA_REPO"], os.environ["DATA_TOKEN"] = repo, token
        common.CLOUD = True
    return get_store()


def load(store):
    pf = store.get("portfolio.json") or empty_portfolio()
    market = store.get("market.json") or {}
    daily = store.get("daily.json") or {}
    analysis = store.get("analysis.json") or {}
    res = analysis.setdefault("assets", {})
    assets = tracked_assets(pf)
    pos = {p["key"]: p for p in portfolio.positions(pf, market, daily)}
    return market, daily, analysis, res, assets, pos


def read_result(path):
    with open(path, encoding="utf-8") as f:
        out = ai.parse_json(f.read())
    if not isinstance(out, dict) or not out.get("summary"):
        sys.exit("Ergebnis nicht lesbar: Es fehlt das Feld summary.")
    return out


def cmd_plan(store, args):
    market, daily, analysis, res, assets, pos = load(store)
    today = datetime.date.today().isoformat()
    todo = ai.due_keys(assets, res, daily, pos, today, REFRESH_DAYS)
    jobs = []
    for key in todo:
        a = assets[key]
        q = (market.get("assets") or {}).get(key) or {}
        d = (daily.get("assets") or {}).get(key) or {}
        if q.get("error") or not q.get("price"):
            continue
        fund = d.get("fund") or {}
        is_fund = any(w in (q.get("name") or "").upper() for w in ("ETF", "ETC", "UCITS"))
        if a["kind"] == "stock" and (is_fund or not (fund.get("forward_pe") or fund.get("target_mean"))):
            continue    # ETFs und ETCs haben keine Quartalszahlen: nur Kurslage, keine Recherche
        prompt = (ai.crypto_prompt if a["kind"] == "crypto" else ai.stock_prompt)(a, q, d, today)
        jobs.append({"key": key, "auftrag": prompt})
    print(json.dumps({"heute": today, "titel": jobs[:args.max], "weitere_offen": max(0, len(jobs) - args.max)},
                     ensure_ascii=False, indent=1))


def cmd_save(store, args):
    market, daily, analysis, res, assets, pos = load(store)
    if args.key not in assets:
        sys.exit("Unbekannter Titel: " + args.key)
    out = read_result(args.file)
    out["at"] = now_iso()
    out["price_at"] = ((market.get("assets") or {}).get(args.key) or {}).get("price")
    out["via"] = "abo"
    res.setdefault(args.key, {})["claude"] = out
    for key in list(res):
        if key not in assets:
            del res[key]
    analysis["updated"] = now_iso()
    store.put("analysis.json", analysis)
    print("gespeichert: " + args.key)


def cmd_depot(store, args):
    market, daily, analysis, res, assets, pos = load(store)
    rows = ai.depot_rows(assets, res, market, daily, pos)
    print(ai.depot_prompt(rows, datetime.date.today().isoformat()) if rows else "")


def cmd_save_depot(store, args):
    market, daily, analysis, res, assets, pos = load(store)
    out = read_result(args.file)
    out["at"] = now_iso()
    analysis["portfolio"] = out
    analysis["updated"] = now_iso()
    store.put("analysis.json", analysis)
    try:
        from . import digest
        digest.main()
    except Exception as e:
        print("Kalender nicht neu gebaut (%s)" % type(e).__name__)
    print("gespeichert: Depot-Einschätzung")


def main():
    ap = argparse.ArgumentParser(prog="tracker.abo")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in (("plan", cmd_plan), ("save", cmd_save), ("depot", cmd_depot), ("save-depot", cmd_save_depot)):
        p = sub.add_parser(name)
        p.add_argument("--repo", default="")
        p.set_defaults(fn=fn)
        if name == "plan":
            p.add_argument("--max", type=int, default=MAX_TITEL)
        if name == "save":
            p.add_argument("key")
        if name in ("save", "save-depot"):
            p.add_argument("file")
    args = ap.parse_args()
    args.fn(connect(args.repo), args)


if __name__ == "__main__":
    main()
