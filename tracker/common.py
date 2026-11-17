"""Gemeinsame Helfer: HTTP, Protokoll, Datenablage (lokal oder privates GitHub-Repo)."""
import base64
import datetime
import json
import time
import os
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0"   # Yahoo lehnt ausführliche Browser-Kennungen aus Skripten mit 429 ab
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# In der Cloud sind die Protokolle öffentlich einsehbar (öffentliches Code-Repo).
# Deshalb: niemals Ticker, Stückzahlen oder Beträge ins Protokoll schreiben.
CLOUD = bool(os.environ.get("DATA_REPO"))


def log(msg):
    print(msg, flush=True)


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class SourceError(Exception):
    """Fehler einer Datenquelle. Die Meldung enthält bewusst keine URL (Ticker bleiben privat)."""


def http_json(url, body=None, headers=None, timeout=15, method=None, opener=None, raw=False):
    h = {"User-Agent": UA, "Accept": "*/*" if raw else "application/json"}
    h.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with (opener.open(req, timeout=timeout) if opener else urllib.request.urlopen(req, timeout=timeout)) as r:
            text = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise SourceError("HTTP %s" % e.code)
    except Exception as e:  # Zeitüberschreitung, DNS, TLS
        raise SourceError(type(e).__name__)
    if raw:
        return text
    try:
        return json.loads(text)
    except ValueError:
        raise SourceError("keine JSON-Antwort")


def fnum(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


# ----------------------------------------------------------------- Datenablage
class LocalStore:
    def __init__(self, folder):
        self.folder = folder
        os.makedirs(folder, exist_ok=True)

    def get(self, name, default=None):
        try:
            with open(os.path.join(self.folder, name), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return default

    def put(self, name, obj):
        path = os.path.join(self.folder, name)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)


class GitHubStore:
    """Liest und schreibt data/<name> in einem privaten GitHub-Repo über die Contents-API."""

    def __init__(self, repo, token, branch="main"):
        self.base = "https://api.github.com/repos/%s/contents/data/" % repo
        self.branch = branch
        self.auth = {"Authorization": "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28"}

    def _url(self, name):
        return self.base + urllib.parse.quote(name) + "?ref=" + self.branch

    def get(self, name, default=None):
        h = dict(self.auth, Accept="application/vnd.github.raw+json")
        try:
            return http_json(self._url(name), headers=h, timeout=30)
        except SourceError as e:
            if "404" in str(e):
                return default
            raise

    def put(self, name, obj):
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        h = dict(self.auth, Accept="application/vnd.github+json")
        for attempt in range(3):   # zwei Läufe gleichzeitig (geplant und aus der App): bei Konflikt neu versuchen
            sha = None
            try:
                sha = http_json(self._url(name), headers=h, timeout=30).get("sha")
            except SourceError as e:
                if "404" not in str(e):
                    raise
            body = {"message": "Daten aktualisiert", "branch": self.branch,
                    "content": base64.b64encode(text.encode("utf-8")).decode("ascii")}
            if sha:
                body["sha"] = sha
            try:
                http_json(self.base + urllib.parse.quote(name), body=body, headers=h, timeout=60, method="PUT")
                return
            except SourceError as e:
                if attempt == 2 or not any(c in str(e) for c in ("409", "422")):
                    raise
                time.sleep(2)


def get_store():
    if CLOUD:
        return GitHubStore(os.environ["DATA_REPO"], os.environ["DATA_TOKEN"])
    return LocalStore(os.environ.get("DATA_DIR") or os.path.join(ROOT, "data"))


def empty_portfolio():
    return {"version": 1, "base_currency": "EUR", "transactions": [], "watchlist": [], "alerts": [],
            "settings": {"ntfy_topic": ""}}


def asset_key(kind, symbol):
    return "%s:%s" % (kind, str(symbol).upper().strip())


def tracked_assets(pf):
    """Alle Titel aus Käufen/Verkäufen, Watchlist und Alerts: {key: {"kind","symbol","name"}}."""
    out = {}
    for group in ("transactions", "watchlist", "alerts"):
        for x in pf.get(group) or []:
            kind, sym = x.get("kind"), str(x.get("symbol") or "").upper().strip()
            if kind not in ("stock", "crypto") or not sym:
                continue
            a = out.setdefault(asset_key(kind, sym), {"kind": kind, "symbol": sym, "name": ""})
            if x.get("name") and not a["name"]:
                a["name"] = x["name"]
    return out


def asset_type(kind, q):
    """Art eines Titels: Krypto, ETF, ETC oder Aktie. Yahoo liefert den Typ, der Name fängt Lücken ab (Gold-ETCs heißen bei Yahoo EQUITY)."""
    if kind == "crypto":
        return "Krypto"
    name = " %s " % ((q or {}).get("name") or "").upper().replace("(", " ").replace(")", " ")
    if " ETC " in name:
        return "ETC"
    if (q or {}).get("type") == "ETF" or " ETF " in name or " UCITS " in name:
        return "ETF"
    return "Aktie"
