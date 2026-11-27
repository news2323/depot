"""Backtest Wachstums-Momentum und bekannter Strategien von Hedgefonds und Wachstums-Investoren über 10 Jahre
(Jakobs Wunsch vom 26. und 27.11.2026; ersetzt den Backtest der KI-Strategie vom 22.11.2026).

Die Regel der App (best, Stand 27.11.2026 abends): die 6 stärksten Titel im Aufwärtstrend, monatlich geprüft, kein Stopp,
keine regelmäßige Gleichgewichtung, Obergrenze 30 % je Titel zum Monatsende (Jakobs Wunsch: ohne Stopp, Stellschrauben
einzeln und in Kombination geprüft). Die 6 Titel stammen aus Jakobs Quality-Growth-Vorlage (27.11.2026);
deren Filter und Punkte wurden im selben Rahmen mit zusätzlichen SEC-Zahlen getestet (Experiment außerhalb des Repos,
Ergebnis bleibt aus der letzten backtest.json stehen: Gruppe „vorlage“).

Ohne Rückschaufehler: Auswahl = S&P 500 und Nasdaq-100 so, wie sie am jeweiligen Tag zusammengesetzt waren (Listen
fja05680/sp500 und unliftedq/index-constitution), dazu 18 Länder-ETFs der Schwellenländer (screen.MARKETS). Nur Daten,
die es am jeweiligen Tag gab: Kurse mit Dividenden (Yahoo, in Dollar), Umsatz, Betriebsergebnis und Gewinn je Aktie aus
den Berichten an die SEC ab dem Tag der Veröffentlichung. Alle Strategien: 7 Titel, gleich gewichtet, Prüfung zum
Monatsende, 0,1 % Kosten je umgeschichtetem Betrag (wenn nicht anders angegeben). Jede Zahl ist der Schnitt aus 6 Stichtagen rund ums Monatsende
(15 Handelstage davor bis 10 danach), weil der Tag im Monat mehrere Prozentpunkte ausmacht.

Grenzen: Kürzel ohne Kurse bei Yahoo (meist nach Übernahmen) fehlen; das kann das Ergebnis leicht schönen. Ohne Steuern.

Aufruf:
  python3 -m tracker.backtest sec          SEC-Zahlen holen (Absender: SEC_CONTACT oder Schlüsselbund „depot-sec-contact“)
  python3 -m tracker.backtest run [repo]   rechnen und backtest.json ablegen (repo: privates Daten-Repo, Schlüsselbund)
  python3 -m tracker.backtest quick        nur die Regel mit einem Stichtag, zur Probe (schreibt nichts)

Die bisherigen Regeln (KI-Strategie) und die Quality-Growth-Vorlage rechnet dieses Modul nicht; ihre Ergebnisse vom 26. und
27.11.2026 bleiben aus der letzten backtest.json stehen. Zwischenspeicher in .cache/ (nicht im Repo). Im Protokoll stehen keine Ticker. Keine Anlageberatung.
"""
import bisect
import collections
import csv
import datetime
import gzip
import io
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from . import screen, world

CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".cache")
START = datetime.date(2013, 6, 1)          # Vorlauf für 200-Tage-Linie und 12 Monate Rendite
YEARS = 10
TRAIN_END = "2021-10-31"                   # erste Hälfte bis hier, zweite danach
COST = 0.001                               # Kosten je umgeschichtetem Betrag (Spanne, Gebühren)
N_POS = 7
OFFS = (-15, -10, -5, 0, 5, 10)            # Stichtage rund ums Monatsende
MARKETS = screen.MARKETS
SP_URL = "https://raw.githubusercontent.com/fja05680/sp500/master/S%26P%20500%20Historical%20Components%20%26%20Changes%20(Updated).csv"
NDX_URL = "https://raw.githubusercontent.com/unliftedq/index-constitution/main/history/nasdaq100.csv"
# Alte Kürzel auf die heutigen bei Yahoo
RENAME = {"FB": "META", "ANTM": "ELV", "FISV": "FI", "PKI": "RVTY", "ABC": "COR", "RE": "EG", "WLTW": "WTW", "FLT": "CPAY",
          "PEAK": "DOC", "HCP": "DOC", "HFC": "DINO", "COG": "CTRA", "BLL": "BALL", "TMK": "GL", "SYMC": "GEN", "NLOK": "GEN",
          "CBS": "PARA", "VIAC": "PARA", "ADS": "BFH", "BBT": "TFC", "JEC": "J", "BHGE": "BKR", "BHI": "BKR", "HRS": "LHX",
          "UTX": "RTX", "DWDP": "DD", "PCLN": "BKNG", "KORS": "CPRI", "LUK": "JEF", "CTL": "LUMN", "HCN": "WELL", "DPS": "KDP",
          "Q": "IQV", "GPS": "GAP", "WYN": "WH", "ARNC": "HWM", "CCE": "CCEP", "DISCA": "WBD", "BRK.B": "BRK-B", "BF.B": "BF-B",
          "FBHS": "FBIN", "MYL": "VTRS", "WRK": "SW", "SQ": "XYZ"}
SKIP_SECOND = {"GOOG", "FOX", "NWS", "UA", "DISCK", "LBTYK", "BATRK", "LILAK", "LMCK", "TCFCB", "STRZA"}   # zweite Aktiengattung


# ----------------------------------------------------------------- Hilfen
def _d(iso):
    return datetime.date.fromisoformat(iso)


def _iso(day):
    return (datetime.date(1970, 1, 1) + datetime.timedelta(days=day)).isoformat()


def _log(msg):
    print(msg, flush=True)


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as f:
        return f.read().decode("utf-8-sig")


# ----------------------------------------------------------------- Auswahl ohne Rückschaufehler
def membership():
    """Je Yahoo-Kürzel die Zeiträume der Mitgliedschaft [[von, bis oder None, "sp"|"ndx"]]."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "membership.json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 7 * 86400:
        return json.load(open(path))
    rows = list(csv.reader(io.StringIO(_get(SP_URL))))[1:]
    snaps = sorted((r[0], set(r[1].split(","))) for r in rows if len(r) >= 2)
    spans, prev = {}, set()
    for d, members in snaps:
        for t in members - prev:
            spans.setdefault(t, []).append([d, None])
        for t in prev - members:
            spans[t][-1][1] = d
        prev = members
    out = {}
    cut = (START + datetime.timedelta(days=365)).isoformat()
    for t, ss in spans.items():
        if t in SKIP_SECOND:
            continue
        y = RENAME.get(t, t).replace(".", "-")
        for a, b in ss:
            if b is None or b >= cut:
                out.setdefault(y, []).append([a, b, "sp"])
    for r in list(csv.reader(io.StringIO(_get(NDX_URL))))[1:]:
        if len(r) < 4:
            continue
        t, a, b = r[0], r[2], r[3] or None
        if t in SKIP_SECOND or (b and b < cut):
            continue
        out.setdefault(RENAME.get(t, t).replace(".", "-"), []).append([a, b, "ndx"])
    json.dump(out, open(path, "w"))
    return out


# ----------------------------------------------------------------- weltweite Auswahl (Jakobs Wunsch vom 28.11.2026)
WORLD_FUNDS = (("acwi", "239600/ishares-msci-acwi-etf"), ("world", "239696/ishares-msci-world-etf"), ("eafe", "239623/ishares-msci-eafe-etf"))
REGION_SRC = {"na": ("acwi", "world"), "dev": ("acwi", "world", "eafe"), "em": ("acwi",)}


def world_snaps():
    """Bestandslisten der iShares-Fonds auf MSCI ACWI, World und EAFE von 2015 bis heute: archivierte Fassungen aus dem
    Internet Archive (etwa zwei im Jahr) und die heutige von iShares. -> [(Datum, Fonds, {Kürzel: [Land, ...]})]."""
    folder = os.path.join(CACHE, "world")
    os.makedirs(folder, exist_ok=True)
    today = os.path.join(folder, "acwi_%s.csv" % datetime.date.today().strftime("%Y%m%d"))
    if not any(f.startswith("acwi_%s" % datetime.date.today().strftime("%Y%m")) for f in os.listdir(folder)):
        try:
            open(today, "w").write(_get(world.URL))
        except Exception as e:
            _log("Weltweit: heutige Liste fehlt (%s)" % type(e).__name__)
    if not os.path.exists(os.path.join(folder, ".archiv")):
        for fund, path in WORLD_FUNDS:
            u = ("https://web.archive.org/cdx/search/cdx?url=ishares.com/us/products/%s/*&output=json&fl=timestamp,original"
                 "&filter=statuscode:200&filter=mimetype:text/csv&limit=5000" % path)
            for ts, orig in json.loads(_get(u))[1:]:
                fn = os.path.join(folder, "%s_%s.csv" % (fund, ts[:8]))
                if "holding" in orig.lower() and not os.path.exists(fn):
                    try:
                        open(fn, "w").write(_get("https://web.archive.org/web/%sid_/%s" % (ts, orig)))
                    except Exception as e:
                        _log("Weltweit: Archiv-Fassung fehlt (%s)" % type(e).__name__)
                    time.sleep(1.5)
        open(os.path.join(folder, ".archiv"), "w").write("ok")
    out = []
    for fn in sorted(os.listdir(folder)):
        if not fn.endswith(".csv"):
            continue
        fund, ymd = fn[:-4].split("_")
        m = world.parse(open(os.path.join(folder, fn), encoding="utf-8", errors="replace").read())
        if len(m) >= 300:
            out.append(("%s-%s-%s" % (ymd[:4], ymd[4:6], ymd[6:]), fund, m))
    return out


def _region(country):
    return "na" if country in ("United States", "Canada") else "dev" if country in world.HOME else "em"


def world_membership():
    """Je Yahoo-Kürzel Zeiträume [[von, bis oder None, "welt"]] und [Land, Sektor, Name, Gewicht] aus der jüngsten Liste. Je Region gilt die jüngste Liste eines Fonds,
    der sie abdeckt (EAFE ohne Nordamerika, Schwellenländer nur im ACWI); vor der ersten Liste gilt die erste."""
    snaps = world_snaps()
    dates = sorted({d for d, _, _ in snaps})
    country, spans, prev = {}, {}, set()
    for d in dates:
        cur = set()
        for reg, src in REGION_SRC.items():
            cand = [x for x in snaps if x[1] in src and x[0] <= d] or [min((x for x in snaps if x[1] in src), key=lambda x: x[0])]
            dd, _, m = max(cand, key=lambda x: x[0])
            for sym, v in m.items():
                if _region(v[0]) == reg:
                    cur.add(sym)
                    country[sym] = v
        start = "2000-01-01" if d == dates[0] else d
        for t in cur - prev:
            spans.setdefault(t, []).append([start, None, "welt"])
        for t in prev - cur:
            spans[t][-1][1] = d
        prev = cur
    return spans, country


def member(spans, iso):
    return any(a <= iso and (b is None or iso < b) for a, b, _ in spans)


# ----------------------------------------------------------------- Kurse
def _chart(sym):
    os.makedirs(os.path.join(CACHE, "prices"), exist_ok=True)
    path = os.path.join(CACHE, "prices", sym.replace("^", "_") + ".json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 20 * 3600:
        return json.load(open(path))
    from . import sources
    p1 = int(datetime.datetime(START.year, START.month, START.day).timestamp())
    u = "https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d&events=div%%2Csplit" % (
        urllib.parse.quote(sym), p1, int(time.time()))
    r = sources._try("Yahoo Kurse", u)
    try:
        res = r["chart"]["result"][0]
    except (TypeError, KeyError, IndexError):
        return None
    off = (res.get("meta") or {}).get("gmtoffset") or 0
    adj = ((res.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose")
    cl = adj or ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    out = {"d": [], "c": [], "cur": (res.get("meta") or {}).get("currency") or "USD"}
    for t, c in zip(res.get("timestamp") or [], cl):
        if c is None or c <= 0:
            continue
        d = int((t + off) // 86400)
        if out["d"] and out["d"][-1] == d:
            out["c"][-1] = c
        else:
            out["d"].append(d)
            out["c"].append(c)
    json.dump(out, open(path, "w"))
    time.sleep(0.15)
    return out


def _align(series, days):
    """Auf die Handelstage des S&P 500 legen; fehlende Tage mit dem letzten Kurs, vor dem ersten Kurs None."""
    out, j, last = [], 0, None
    d, c = series["d"], series["c"]
    for day in days:
        while j < len(d) and d[j] <= day:
            last = c[j]
            j += 1
        out.append(last)
    return out


class Stock:
    """Kurs in Dollar und gleitende Werte je Handelstag."""

    def __init__(self, sym, px):
        self.sym, self.p = sym, px
        n = len(px)
        self.first = next((i for i, x in enumerate(px) if x is not None), n)
        self.end = n
        ps = [0.0] * (n + 1)
        for i in range(n):
            ps[i + 1] = ps[i] + (px[i] or 0.0)
        self.ps = ps
        self.hi = [None] * n
        win = []
        for i in range(self.first, n):     # Hoch der letzten 252 Handelstage (monoton fallende Schlange)
            while win and px[win[-1]] <= px[i]:
                win.pop()
            win.append(i)
            if win[0] <= i - 252:
                win.pop(0)
            self.hi[i] = px[win[0]]

    def ok(self, i, need):
        return i - self.first >= need

    def sma(self, i, k):
        return (self.ps[i + 1] - self.ps[i + 1 - k]) / k if i - self.first + 1 >= k else None


def month_ends(days, start_iso):
    out = [i for i in range(len(days) - 1) if _iso(days[i])[:7] != _iso(days[i + 1])[:7] and _iso(days[i]) >= start_iso]
    return out + [len(days) - 1]


def stats(nav, days):
    """nav: Werte je Tag, days: Tage seit 1970. Rendite pro Jahr, größter Rückgang."""
    if len(nav) < 2:
        return None
    yrs = (days[-1] - days[0]) / 365.25
    cagr = (nav[-1] / nav[0]) ** (1 / yrs) - 1 if yrs > 0 and nav[0] > 0 else None
    peak, best = nav[0], 0.0
    for v in nav:
        peak = max(peak, v)
        best = min(best, v / peak - 1)
    return {"cagr": round(cagr * 100, 1) if cagr is not None else None, "dd": round(best * 100, 1)}


# ----------------------------------------------------------------- SEC: berichtete Zahlen mit Tag der Veröffentlichung
SEC_TAGS = {
    "rev": ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet",
            "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenue"),
    "op": ("OperatingIncomeLoss", "ProfitLossFromOperatingActivities"),
    "eps": ("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"),
}


def _contact():
    """Absender für die SEC: Umgebungsvariable SEC_CONTACT oder der Eintrag „depot-sec-contact“ im Schlüsselbund von macOS
    (legt Jakob selbst an). Steht nie im Code und wird nie ausgegeben."""
    c = os.environ.get("SEC_CONTACT")
    if c:
        return c
    try:
        p = subprocess.run(["security", "find-generic-password", "-s", "depot-sec-contact", "-w"], capture_output=True, text=True, timeout=10)
        return p.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _sec_get(url):
    contact = _contact()
    if not contact or "@" not in contact:
        raise SystemExit("Absender für die SEC fehlt: SEC_CONTACT setzen oder im Schlüsselbund „depot-sec-contact“ anlegen")
    req = urllib.request.Request(url, headers={"User-Agent": contact, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as f:
        b = f.read()
        if f.headers.get("Content-Encoding") == "gzip":
            b = gzip.decompress(b)
    return json.loads(b)


def _sec_compact(facts):
    out = {}
    for name, tags in SEC_TAGS.items():
        rows = {}
        for tax in ("us-gaap", "ifrs-full"):
            g = (facts.get("facts") or {}).get(tax) or {}
            for tag in tags:
                for unit, xs in ((g.get(tag) or {}).get("units") or {}).items():
                    for x in xs:
                        if not x.get("start") or not x.get("end") or x.get("val") is None or not x.get("filed"):
                            continue
                        k = (x["start"], x["end"])
                        if k not in rows or x["filed"] < rows[k][3]:
                            rows[k] = [x["start"], x["end"], x["val"], x["filed"]]
        out[name] = sorted(rows.values(), key=lambda r: (r[1], r[0]))
    return out


def sec_fetch(symbols):
    """Umsatz, Betriebsergebnis, Gewinn je Aktie und Branche (SIC) je Firma in .cache/sec2/."""
    os.makedirs(os.path.join(CACHE, "sec2"), exist_ok=True)
    try:
        tick = _sec_get("https://www.sec.gov/files/company_tickers.json")
    except urllib.error.HTTPError as e:
        raise SystemExit("Die SEC hat den Abruf abgelehnt (%d). Steht im Absender eine echte E-Mail-Adresse?" % e.code)
    cik = {v["ticker"].upper(): int(v["cik_str"]) for v in tick.values()}
    ok = 0
    for sym in symbols:
        path = os.path.join(CACHE, "sec2", sym + ".json")
        if os.path.exists(path):
            ok += 1
            continue
        c = cik.get(sym.upper()) or cik.get(sym.upper().replace("-", "."))
        if not c:
            continue
        try:
            data = _sec_compact(_sec_get("https://data.sec.gov/api/xbrl/companyfacts/CIK%010d.json" % c))
            sub = _sec_get("https://data.sec.gov/submissions/CIK%010d.json" % c)
            data["sic"] = [sub.get("sic"), sub.get("sicDescription"), sub.get("name")]
        except Exception as e:
            _log("SEC: Fehler " + type(e).__name__)
            continue
        json.dump(data, open(path, "w"))
        ok += 1
        time.sleep(0.25)   # die SEC erlaubt höchstens 10 Abrufe je Sekunde
    _log("SEC: %d von %d Firmen" % (ok, len(symbols)))


def _periods(rows):
    q, ann, nine = {}, {}, {}
    for st, en, val, filed in rows:
        dur = (_d(en) - _d(st)).days
        if 80 <= dur <= 100:
            q.setdefault(en, (val, filed))
        elif 350 <= dur <= 380:
            ann.setdefault(en, (val, filed, st))
        elif 260 <= dur <= 285:
            nine.setdefault(st, (val, filed, en))
    for en, (val, filed, st) in ann.items():
        n9 = nine.get(st)
        if en not in q and n9 and n9[2] < en:
            q[en] = (val - n9[0], filed)
    return q


def sec_load(sym):
    p = os.path.join(CACHE, "sec2", sym + ".json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p))
    out = {k: sorted((en, v, f) for en, (v, f) in _periods(d.get(k) or []).items()) for k in ("rev", "op", "eps")}
    out["sic"] = d.get("sic")
    return out


def fund_at(fq, iso):
    """Kennzahlen mit dem Stand vom Tag iso: Umsatz Quartal zu Vorjahr (gq, gq1, gq2), 4 Quartale (gttm), Beschleunigung,
    Gewinn je Aktie Quartal und 4 Quartale (eq, ettm), Tage seit dem letzten Bericht."""
    if not fq:
        return None
    lim = (_d(iso) - datetime.timedelta(days=200)).isoformat()
    out = {}
    qs = [x for x in fq["rev"] if x[2] <= iso]
    if len(qs) >= 8 and qs[-1][0] >= lim and 600 <= (_d(qs[-1][0]) - _d(qs[-8][0])).days <= 700:
        g = lambda a, b: (a / b - 1) * 100 if b and b > 0 else None
        out["gq"], out["gq1"], out["gq2"] = g(qs[-1][1], qs[-5][1]), g(qs[-2][1], qs[-6][1]), g(qs[-3][1], qs[-7][1])
        out["gttm"] = g(sum(x[1] for x in qs[-4:]), sum(x[1] for x in qs[-8:-4]))
        out["filed"] = (_d(iso) - _d(qs[-1][2])).days
        if out["gq"] is not None and out["gq1"] is not None:
            out["accel"] = out["gq"] - out["gq1"]
    es = [x for x in fq["eps"] if x[2] <= iso]
    if len(es) >= 8 and es[-1][0] >= lim:
        def eg(a, b):
            if b is None or a is None:
                return None
            if b <= 0:
                return 100.0 if a > 0 else None     # von Verlust zu Gewinn: zählt als starkes Wachstum
            return (a / b - 1) * 100
        out["eq"] = eg(es[-1][1], es[-5][1])
        out["ettm"] = eg(sum(x[1] for x in es[-4:]), sum(x[1] for x in es[-8:-4]))
    return out or None


# ----------------------------------------------------------------- Daten und Kennzahlen je Stichtag
class Data:
    def __init__(self, markets=True, world_=False):
        master = _chart("^GSPC")
        t0 = (START - datetime.date(1970, 1, 1)).days
        self.days = [d for d in master["d"] if d >= t0]
        self.iso = [_iso(d) for d in self.days]
        self.n = len(self.days)
        self.bench = _align(master, self.days)
        self.spans = {k: list(v) for k, v in membership().items()}
        self.country, self.winfo = {}, {}
        if world_:            # True: wie die App (world.INCLUDE), "all": ganzer ACWI, soweit handelbar
            ws, country = world_membership()
            for k, v in ws.items():
                if k not in screen.SKIP and (world_ == "all" or country[k][0] in world.INCLUDE):
                    self.spans.setdefault(k, []).extend(v)
                    self.country[k] = country[k][0]
                    self.winfo[k] = country[k]
        self.stocks, self.sec, self.kind, self.missing, fx = {}, {}, {}, 0, {}
        for sym in sorted(self.spans):
            x = _chart(sym)
            cur = (x or {}).get("cur") or "USD"
            c0, f = screen.UNIT.get(cur, (cur, 1))
            if c0 != "USD" and c0 not in fx:
                fx[c0] = _chart("%sUSD=X" % c0)
            if not x or len(x["d"]) < 260 or (c0 != "USD" and not fx.get(c0)):
                self.missing += 1
                continue
            px = _align(x, self.days)
            if c0 != "USD":
                r = _align(fx[c0], self.days)
                px = [p * f * q if p is not None and q else None for p, q in zip(px, r)]
                if any(a and b and (b / a > 3 or b / a < 0.25) for a, b in zip(px, px[1:])):
                    self.missing += 1          # Kurssprung über das Dreifache an einem Tag: Datenfehler bei Yahoo
                    continue
            s = Stock(sym, px)
            s.end = next((i for i, d in enumerate(self.days) if d > x["d"][-1]), self.n)   # danach nicht mehr handelbar
            self.stocks[sym], self.kind[sym], self.sec[sym] = s, "stock", sec_load(sym)
        if markets:
            for sym in MARKETS:
                x = _chart(sym)
                if x and len(x["d"]) > 300:
                    self.stocks[sym], self.kind[sym] = Stock(sym, _align(x, self.days)), "market"
        self.al = {k: _align(x, self.days) for k, x in ((k, _chart(k)) for k in ("SPY", "QQQ", "BIL")) if x}
        start_iso = (_d(self.iso[-1]) - datetime.timedelta(days=int(YEARS * 365.25))).isoformat()
        self.months = month_ends(self.days, start_iso)
        self.mset = set(self.months)
        self.feat, self._fund = {}, {}

    def eligible(self, sym, i):
        s = self.stocks[sym]
        if (s.end < self.n and i >= s.end - 1) or not s.ok(i, 273) or not s.p[i]:
            return False
        return self.kind[sym] == "market" or member(self.spans[sym], self.iso[i])

    def fund(self, sym, i):
        k = (sym, i)
        if k not in self._fund:
            self._fund[k] = fund_at(self.sec.get(sym), self.iso[i])
        return self._fund[k]

    def features(self, i):
        """Kennzahlen aller handelbaren Titel am Tag i (zwischengespeichert)."""
        if i in self.feat:
            return self.feat[i]
        out = {}
        for sym, s in self.stocks.items():
            if not self.eligible(sym, i):
                continue
            p = s.p
            r = lambda back, skip=0: (p[i - skip] / p[i - back] - 1) if i - back >= s.first and p[i - back] else None
            lo = min(x for x in p[i - 251:i + 1] if x)
            f = {"r12_1": r(252, 21), "r12": r(252), "r6": r(126), "r3": r(63), "r9": r(189),
                 "hi": p[i] / s.hi[i], "lo": p[i] / lo, "s50": s.sma(i, 50), "s150": s.sma(i, 150), "s200": s.sma(i, 200),
                 "s200m": s.sma(i - 21, 200), "p": p[i]}
            # relative Stärke wie IBD, gleiche Gewichte wie screen.RS_W
            f["rs_raw"] = 0.4 * (f["r3"] or 0) + 0.2 * (f["r6"] or 0) + 0.2 * (f["r9"] or 0) + 0.2 * (f["r12"] or 0)
            f["template"] = bool(p[i] > f["s150"] and p[i] > f["s200"] and f["s150"] > f["s200"] and f["s200"] > f["s200m"]
                                 and f["s50"] > f["s150"] and p[i] > f["s50"] and f["lo"] >= 1.30 and f["hi"] >= 0.75)
            out[sym] = f
        syms = list(out)
        for key, name in (("rs_raw", "rs"), ("r12_1", "mom_pct")):
            vals = sorted(out[x][key] for x in syms if out[x][key] is not None)
            for x in syms:
                v = out[x][key]
                out[x][name] = bisect.bisect_left(vals, v) / max(1, len(vals) - 1) if v is not None else None
        self.feat[i] = out
        return out

    def _all_month_ends(self):
        if not hasattr(self, "_ame"):
            self._ame = [i for i in range(self.n - 1) if self.iso[i][:7] != self.iso[i + 1][:7]]
        return self._ame

    def resid_mom(self, i):
        """Residual-Momentum (Blitz, Huij, Martens): Monatsrenditen der letzten 36 Monate gegen den S&P 500,
        Summe der Reste aus Monat t-12 bis t-2 geteilt durch deren Schwankung."""
        k = ("rm", i)
        if k in self.feat:
            return self.feat[k]
        me = [m for m in self._all_month_ends() if m <= i][-37:]
        out = {}
        if len(me) == 37:
            bm = [self.bench[me[t + 1]] / self.bench[me[t]] - 1 for t in range(36)]
            for sym in self.features(i):
                s = self.stocks[sym]
                if me[0] < s.first:
                    continue
                ys = [s.p[me[t + 1]] / s.p[me[t]] - 1 for t in range(36)]
                mx, my = sum(bm) / 36, sum(ys) / 36
                vx = sum((x - mx) ** 2 for x in bm)
                beta = sum((x - mx) * (y - my) for x, y in zip(bm, ys)) / vx if vx else 1
                alpha = my - beta * mx
                form = [y - alpha - beta * x for x, y in zip(bm, ys)][-12:-1]
                m_ = sum(form) / len(form)
                sd = math.sqrt(sum((e - m_) ** 2 for e in form) / len(form))
                if sd > 0:
                    out[sym] = sum(form) / sd
        self.feat[k] = out
        return out


# ----------------------------------------------------------------- Depot-Simulation (gleicher Ablauf wie screen.advance)
def simulate(D, strat, n_pos=N_POS, cost=COST, log=False):
    """strat: pick(D, i, keep) -> neue Titel (beste zuerst), keep(D, i, sym, info) -> bleibt, expo(D, i) -> Aktienanteil,
    stop: None oder (art, Prozent): 'fix' ab Einstieg, 'trail' ab Hoch seit Einstieg, täglich geprüft; n: Zahl der Titel;
    rebal: 'month' (jeden Monat gleich gewichten), 'year' (nur zum Monatsende Dezember) oder 'never' (nie, wie screen.py);
    cap: Obergrenze je Titel (Anteil 0..1) zum Monatsende, der Überschuss geht an die Titel darunter (wie screen.enforce_cap)."""
    months, mset, st = D.months, D.mset, D.stocks
    n_pos = strat.get("n") or n_pos
    cap = strat.get("cap")
    pos, cash, nav, info, hold_log, trades = {}, 1.0, [1.0], {}, [], 0
    stop = strat.get("stop")
    for d in range(months[0], months[-1] + 1):
        if d > months[0]:
            for x in list(pos):
                s = st[x]
                if d >= s.end:                      # Kurs eingestellt: zum letzten Kurs raus
                    cash += pos.pop(x) * (1 - cost)
                    info.pop(x, None)
                    continue
                pos[x] *= s.p[d] / s.p[d - 1]
                inf = info[x]
                inf["hi"] = max(inf["hi"], s.p[d])
                if stop and d not in mset:
                    kind, pct = stop
                    ref = inf["entry"] if kind == "fix" else inf["hi"]
                    if s.p[d] < ref * (1 - pct / 100.0):
                        cash += pos.pop(x) * (1 - cost)
                        info.pop(x)
                        trades += 1
        if d in mset:
            f = strat["expo"](D, d) if strat.get("expo") else 1.0
            held = list(pos)
            keep = [x for x in held if (st[x].end >= D.n or d < st[x].end - 1) and strat["keep"](D, d, x, info[x])]
            new = [x for x in strat["pick"](D, d, keep) if x not in keep][:max(0, n_pos - len(keep))]
            for x in held:
                if x not in keep:
                    cash += pos.pop(x) * (1 - cost)
                    info.pop(x)
                    trades += 1
            w = f / n_pos
            V = cash + sum(pos.values())
            rb = strat.get("rebal", "month")
            if rb == "month" or (rb == "year" and D.iso[d][5:7] == "12"):
                for x in list(pos):
                    tgt = V * w
                    diff = tgt - pos[x]
                    if abs(diff) > 0.02 * tgt:
                        cash -= diff + abs(diff) * cost
                        pos[x] = tgt
            for x in new:
                V = cash + sum(pos.values())
                amt = min(cash, V * w)
                if amt > 0.1 * V * w:
                    cash -= amt
                    pos[x] = amt * (1 - cost)
                    info[x] = {"entry": st[x].p[d], "hi": st[x].p[d], "since": d}
                    trades += 1
            if cap:
                cash, k = screen.enforce_cap(pos, cash, cap, cost)
                trades += k
            if log:
                hold_log.append((D.iso[d], sorted(pos)))
        nav.append(cash + sum(pos.values()))
    ds = [D.days[months[0]]] + D.days[months[0]:months[-1] + 1]
    return {"nav": nav, "ds": ds, "log": hold_log, "trades": trades}


def evaluate(D, res):
    nav, ds = res["nav"], res["ds"]
    k = next(i for i, d in enumerate(ds) if _iso(d) > TRAIN_END)
    full = stats(nav, ds)
    tr = stats(nav[:k], ds[:k])
    te = stats([1.0] + [x / nav[k - 1] for x in nav[k:]], [ds[k - 1]] + ds[k:])
    years, yr, prev = {}, {}, nav[0]
    for v, d in zip(nav, ds):
        years.setdefault(_iso(d)[:4], []).append(v)
    for y in sorted(years):
        yr[y] = round((years[y][-1] / prev - 1) * 100, 1)
        prev = years[y][-1]
    return {"cagr": full["cagr"], "dd": full["dd"], "train": tr["cagr"], "train_dd": tr["dd"], "test": te["cagr"], "test_dd": te["dd"],
            "years": yr, "trades": res["trades"]}


def bench_nav(D, key):
    xs = D.al[key]
    a, b = D.months[0], D.months[-1]
    return {"nav": [1.0] + [xs[d] / xs[a] for d in range(a, b + 1)], "ds": [D.days[a]] + D.days[a:b + 1], "trades": 0}


def multi(D, builder, cost=COST):
    """Schnitt aus den Stichtagen OFFS rund ums Monatsende; Verlauf und Jahre mit dem Stichtag Monatsende."""
    M0, evs, res0 = list(D.months), [], None
    for off in OFFS:
        D.months = [min(D.n - 1, max(0, m + off)) for m in M0[:-1]] + [M0[-1]]
        D.mset = set(D.months)
        res = simulate(D, builder(), cost=cost, log=(off == 0))
        evs.append(evaluate(D, res))
        if off == 0:
            res0 = res
    D.months, D.mset = list(M0), set(M0)
    m = lambda k: round(sum(e[k] for e in evs) / len(evs), 1)
    return {"cagr": m("cagr"), "dd": m("dd"), "worst_dd": min(e["dd"] for e in evs), "min": min(e["cagr"] for e in evs),
            "max": max(e["cagr"] for e in evs), "train": m("train"), "test": m("test"), "trades": round(sum(e["trades"] for e in evs) / len(evs)),
            "years": evs[OFFS.index(0)]["years"], "res0": res0}


# ----------------------------------------------------------------- Strategien
def _pct(vals):
    s = sorted(v for v in vals.values() if v is not None)
    return {k: (bisect.bisect_left(s, v) / max(1, len(s) - 1) if v is not None else None) for k, v in vals.items()}


def ranked(D, i, key, score, filt, markets=True):
    """Kandidaten am Tag i, beste zuerst (zwischengespeichert je Strategie: key muss Wertung und Filter eindeutig nennen)."""
    ck = ("rk", key, i, markets)
    if ck in D.feat:
        return D.feat[ck]
    xs = []
    for sym, f in D.features(i).items():
        if (not markets and D.kind[sym] == "market") or not filt(D, i, sym, f):
            continue
        v = score(D, i, sym, f)
        if v is not None:
            xs.append((v, sym))
    D.feat[ck] = [s for _, s in sorted(xs, reverse=True)]
    return D.feat[ck]


def make(key, score, filt=lambda D, i, s, f: True, buffer=1, keep_filt=None, expo=None, stop=None, markets=True):
    """Die besten N kaufen; gehaltene bleiben, solange sie unter den besten N*buffer sind (oder keep_filt erfüllen)."""
    def pick(D, i, keep):
        return [x for x in ranked(D, i, key, score, filt, markets) if x not in keep]

    def keep(D, i, sym, inf):
        if keep_filt is not None:
            f = D.features(i).get(sym)
            return f is not None and keep_filt(D, i, sym, f)
        return sym in ranked(D, i, key, score, filt, markets)[:int(N_POS * buffer)]
    return {"pick": pick, "keep": keep, "expo": expo, "stop": stop}


def sp200(level):
    """S&P 500 unter der 200-Tage-Linie: Aktienanteil auf level."""
    return lambda D, i: 1.0 if D.bench[i] >= sum(D.bench[i - 199:i + 1]) / 200 else level


def bil12(D, i):
    t = D.al.get("BIL")
    return (t[i] / t[i - 252] - 1) if t and t[i - 252] else 0.0


def abs_mom(D, i):
    """Antonacci: S&P 500 in 12 Monaten besser als kurze Staatsanleihen, sonst raus."""
    return 1.0 if D.bench[i] / D.bench[i - 252] - 1 > bil12(D, i) else 0.0


def fund(D, i, s):
    return D.fund(s, i) if D.kind[s] == "stock" else None


def trend(D, i, s, f):
    return f["p"] > f["s200"] and f["s50"] > f["s200"]


def rev_trend(mn):
    """Aufwärtstrend und Umsatz in 4 Quartalen mindestens mn % über dem Vorjahr (Länder-ETFs ohne Umsatz zählen)."""
    def filt(D, i, s, f):
        q = fund(D, i, s)
        return trend(D, i, s, f) and (D.kind[s] == "market" or bool(q and q.get("gttm") is not None and q["gttm"] >= mn))
    return filt


def growth_momentum(stop=None, markets=True, buffer=1, filt=trend, fkey="trend", expo=None, n=N_POS, rebal="month"):
    """Wachstums-Momentum: relative Stärke wie IBD, nur Aufwärtstrend, die n stärksten. Gehaltene Titel bleiben, solange sie
    unter den besten n*buffer sind."""
    score = lambda D, i, s, f: f["rs_raw"]
    sm = make("rs|" + fkey, score, filt, buffer=buffer, stop=stop, markets=markets, expo=expo)
    sm["n"], sm["rebal"] = n, rebal
    sm["keep"] = lambda D, i, sym, inf: sym in ranked(D, i, "rs|" + fkey, score, filt, markets)[:int(n * buffer)]
    return sm


def app_rule(stop=False, cap=screen.CAP_PCT, rebal="never", **kw):
    """Die Regel der App (screen.py): 6 Titel, kein Stopp, keine regelmäßige Gleichgewichtung, Obergrenze 30 % je Titel."""
    kw.setdefault("n", screen.N_POS)
    sm = growth_momentum(stop=("trail", screen.STOP_PCT) if stop else None, rebal=rebal, **kw)
    sm["cap"] = cap / 100.0 if cap else None
    return sm


def _tt(D, i, s, f):
    return f["template"] and (f["rs"] or 0) >= 0.70


def _sepa_f(D, i, s, f):
    q = fund(D, i, s)
    return _tt(D, i, s, f) and bool(q and q.get("gq") is not None) and q["gq"] >= 20 and ((q.get("accel") or -1) >= 0 or (q.get("eq") or 0) >= 25)


def _cs_f(D, i, s, f):
    q = fund(D, i, s)
    return bool(q and q.get("eq") is not None and q.get("ettm") is not None) and q["eq"] >= 25 and q["ettm"] >= 25 and f["hi"] >= 0.85 and (f["rs"] or 0) >= 0.80


def growth_mom(min_g=15, w=(0.5, 0.3, 0.2)):
    """Nachbau des Stils von Tiger Global und Coatue: Umsatzwachstum, Beschleunigung und Kursstärke."""
    def filt(D, i, s, f):
        q = fund(D, i, s)
        return bool(q and q.get("gttm") is not None and q["gttm"] >= min_g and f["p"] > f["s200"])

    def score(D, i, s, f):
        ck = ("gm_p", i, min_g)
        if ck not in D.feat:
            F = D.features(i)
            ok = [x for x, g in F.items() if D.kind[x] == "stock" and filt(D, i, x, g)]
            D.feat[ck] = (_pct({x: F[x]["r12_1"] for x in ok}), _pct({x: fund(D, i, x)["gttm"] for x in ok}),
                          _pct({x: fund(D, i, x).get("accel") for x in ok}))
        pm, pg, pa = D.feat[ck]
        if pm.get(s) is None:
            return None
        return w[0] * pm[s] + w[1] * (pg.get(s) or 0) + w[2] * (pa.get(s) if pa.get(s) is not None else 0.5)
    return make("gm", score, filt, markets=False)


def pead():
    """Bernard/Thomas: frischer Bericht mit Umsatzwachstum über dem bisherigen Tempo, Kurs über der 50-Tage-Linie."""
    def filt(D, i, s, f):
        q = fund(D, i, s)
        return bool(q and q.get("gq") is not None and q.get("gq1") is not None and q.get("gq2") is not None
                    and q.get("filed", 999) <= 75 and f["p"] > f["s50"] and q["gq"] > 0)

    def score(D, i, s, f):
        q = fund(D, i, s)
        return q["gq"] - (q["gq1"] + q["gq2"]) / 2
    return make("pead", score, filt, markets=False)


def _mv_keep(D, i, s, f):
    return f["p"] > f["s50"] and (f["rs"] or 0) >= 0.5


# id: Name, Kurzname, Beschreibung, Bauplan. calm und win: Wachstums-Momentum (die Regel der App)
STRATS = {
    "best": ("Deine Regel: Wachstums-Momentum, 6 Titel, ohne Stopp", "Deine Regel", "Die 6 stärksten Titel im Aufwärtstrend (relative Stärke wie IBD: 3 Monate 40 %, 6/9/12 Monate je 20 %), monatlich geprüft, Gewinner laufen weiter, höchstens 30 % je Titel, kein Stopp",
             lambda: app_rule()),
    "best_stop": ("Dieselbe Regel mit Stopp 25 %", "Mit Stopp", "Wie deine Regel, dazu Verkauf bei 25 % unter dem Hoch seit Kauf", lambda: app_rule(stop=True)),
    "prev27": ("Regel vom 27.11. mittags", "6 Titel, jährlich, Stopp", "6 Titel, einmal im Jahr gleich gewichtet, Stopp 25 %", lambda: app_rule(stop=True, cap=None, rebal="year")),
    "calm": ("Regel vom 26.11.", "7 Titel, monatlich, Stopp", "Die 7 stärksten im Aufwärtstrend, jeden Monat gleich gewichtet, Stopp 25 %",
             lambda: growth_momentum(stop=("trail", screen.STOP_PCT))),
    "mom": ("Momentum 12-1", None, "Rendite 12 Monate ohne den letzten, die 7 stärksten. Jegadeesh/Titman 1993, Grundlage der Momentum-Fonds von AQR",
            lambda: make("mom", lambda D, i, s, f: f["r12_1"])),
    "dual": ("Dual Momentum", None, "Gary Antonacci 2014: die stärksten Titel, aber nur, wenn der S&P 500 in 12 Monaten besser lief als kurze Staatsanleihen",
             lambda: make("dual", lambda D, i, s, f: f["r12"], lambda D, i, s, f: f["r12"] is not None and f["r12"] > bil12(D, i), expo=abs_mom)),
    "mv": ("Minervini Trend Template", None, "Mark Minervini, US-Investing-Champion 1997 und 2021: Kurs über 50-, 150- und 200-Tage-Linie, nahe am Jahreshoch, weit über dem Jahrestief; stärkste zuerst",
           lambda: make("mv", lambda D, i, s, f: f["rs"], _tt, keep_filt=_mv_keep, stop=("fix", 8))),
    "sepa": ("SEPA mit Zahlen", None, "Mark Minervini: Trend Template plus Umsatz- und Gewinnwachstum",
             lambda: make("sepa", lambda D, i, s, f: f["rs"], _sepa_f, keep_filt=_mv_keep, stop=("fix", 8), markets=False)),
    "cs": ("CAN SLIM", None, "William O'Neil (IBD): Gewinnwachstum ab 25 %, relative Stärke, nahe am Hoch, Marktfilter, Verlustgrenze −8 %",
           lambda: make("cs", lambda D, i, s, f: f["rs"], _cs_f, keep_filt=lambda D, i, s, f: f["hi"] >= 0.75 and (f["rs"] or 0) >= 0.6,
                        stop=("fix", 8), markets=False, expo=sp200(0.0))),
    "hi52": ("52-Wochen-Hoch", None, "George/Hwang 2004: Titel am nächsten an ihrem 52-Wochen-Hoch",
             lambda: make("hi52", lambda D, i, s, f: f["hi"] + 0.001 * (f["r12_1"] or 0))),
    "rm": ("Residual-Momentum", None, "Blitz/Huij/Martens 2011 (Robeco): Kursstärke ohne die Bewegung des Gesamtmarkts",
           lambda: make("rm", lambda D, i, s, f: D.resid_mom(i).get(s))),
    "gm": ("Wachstum mit Momentum", None, "Nachbau des Stils von Tiger Global und Coatue: Umsatzwachstum, Beschleunigung und Kursstärke", growth_mom),
    "pead": ("Umsatz-Überraschung", None, "Bernard/Thomas 1989: Drift nach überraschend gutem Quartal, hier mit Umsatz", pead),
}
PROBES = (("4 Titel", "mehr Rendite, aber bis zu 50 % in einem Titel", lambda: app_rule(n=4), COST),
          ("5 Titel", "", lambda: app_rule(n=5), COST),
          ("7 Titel", "", lambda: app_rule(n=7), COST),
          ("8 Titel", "", lambda: app_rule(n=8), COST),
          ("Obergrenze 15 % je Titel", "zu eng: schon 6 gleiche Teile sind 16,7 %", lambda: app_rule(cap=15), COST),
          ("Obergrenze 20 % je Titel", "", lambda: app_rule(cap=20), COST),
          ("Obergrenze 25 % je Titel", "", lambda: app_rule(cap=25), COST),
          ("Obergrenze 35 % je Titel", "", lambda: app_rule(cap=35), COST),
          ("Ohne Obergrenze", "größte Position bis 55 %", lambda: app_rule(cap=None), COST),
          ("Einmal im Jahr gleich gewichten", "", lambda: app_rule(rebal="year"), COST),
          ("Jeden Monat gleich gewichten", "", lambda: app_rule(rebal="month"), COST),
          ("Halten bis Rang 9 statt 6", "weniger Handel, tieferer Rückgang", lambda: app_rule(buffer=1.5), COST),
          ("Kosten 0,3 % statt 0,1 % je Kauf und Verkauf", "", lambda: app_rule(), 0.003),
          ("Ohne Länder-ETFs der Schwellenländer", "kaum Unterschied: Sie kamen selten zum Zug", lambda: app_rule(markets=False), COST),
          ("Marktfilter: halb raus unter der 200-Tage-Linie des S&P 500", "kostet Rendite", lambda: app_rule(expo=sp200(0.5)), COST))


def _sector(sic):
    """Branche aus dem SIC-Code der SEC (grob, für die Streuung)."""
    try:
        c = int(sic[0])
    except (TypeError, ValueError, IndexError):
        return "Sonstige"
    groups = (("Halbleiter und Elektronik", lambda c: c in (3674, 3672, 3670, 3677, 3678, 3679, 3559)),
              ("Technik-Hardware", lambda c: 3570 <= c <= 3579 or c in (3661, 3663, 3669, 3825, 3826, 3827, 3829, 3812)),
              ("Software und Internet", lambda c: 7370 <= c <= 7379),
              ("Internet-Handel", lambda c: c in (5961, 5990, 4899)),
              ("Gesundheit", lambda c: 2830 <= c <= 2836 or 8000 <= c <= 8099 or 3841 <= c <= 3851 or c in (5047, 5122, 6324, 8731)),
              ("Energie", lambda c: 1300 <= c <= 1399 or c in (2911, 2990, 4610, 4922, 4923, 5171, 5172)),
              ("Versorger und Strom", lambda c: 4900 <= c <= 4991),
              ("Rohstoffe und Chemie", lambda c: 1000 <= c <= 1499 or c in (3310, 3312, 3330, 3334, 2800, 2810, 2820, 2821, 2860, 2870)),
              ("Finanzen und Immobilien", lambda c: 6000 <= c <= 6799),
              ("Kommunikation und Medien", lambda c: 4800 <= c <= 4899 or c in (7812, 7822, 7841, 2711, 7990)),
              ("Konsum", lambda c: c in (3711, 3713, 3714, 3716, 3751) or 5000 <= c <= 5999 or 7000 <= c <= 7099 or 1520 <= c <= 1531
               or c in (2300, 2320, 3021, 3100, 3140, 3949, 4400, 4412, 3630, 3651, 2510, 2520, 3942, 3944, 3990, 2750)),
              ("Konsum Basis", lambda c: 2000 <= c <= 2199),
              ("Industrie", lambda c: 3400 <= c <= 3569 or 3580 <= c <= 3669 or 3700 <= c <= 3799 or 4000 <= c <= 4799 or 8700 <= c <= 8744 or 1600 <= c <= 1799))
    return next((name for name, f in groups if f(c)), "Sonstige")


def _de(v, d=1):
    """Zahl in deutscher Schreibweise (Komma, echtes Minus)."""
    return ("%.*f" % (d, v)).replace("-", "−").replace(".", ",")


def _nice(name):
    n = (name or "").replace(",", "").replace(".", "")
    for suf in (" INC", " CORP", " CORPORATION", " CO", " HOLDINGS", " PLC", " LTD", " NV", " SA", " /DE/", " /DE", " INCORPORATED", " COMPANY"):
        if n.upper().endswith(suf):
            n = n[: -len(suf)]
    return " ".join(w.capitalize() if len(w) > 3 else w for w in n.split()).strip()


def run(prev=None):
    """Alles rechnen; Ergebnis im Format von backtest.json (Fassung 2, wie web/views.js btCard es liest)."""
    t0 = time.time()
    D = Data(world_=True)
    _log("Backtest: %d Titel mit Kursen, %d ohne, %d Monate" % (len(D.stocks), D.missing, len(D.months)))
    out, res = [], {}
    for key, (name, short, desc, mk) in STRATS.items():
        r = multi(D, mk)
        res[key] = r
        out.append({"id": key, "name": name, "short": short or name, "desc": desc, "group": "neu" if key in ("best", "best_stop", "prev27", "calm") else "bekannt",
                    **{k: r[k] for k in ("cagr", "min", "max", "dd", "worst_dd", "train", "test", "trades", "years")}})
        _log("Backtest: Strategie %d von %d (%.0f s)" % (len(out), len(STRATS), time.time() - t0))
    for key, name in (("QQQ", "Nasdaq-100"), ("SPY", "S&P 500")):
        b = bench_nav(D, key)
        ev = evaluate(D, b)
        res[key] = {"res0": b}
        out.append({"id": key, "name": name, "short": name, "desc": "Index mit Dividenden", "group": "index", "cagr": ev["cagr"],
                    "min": ev["cagr"], "max": ev["cagr"], "dd": ev["dd"], "worst_dd": ev["dd"], "train": ev["train"], "test": ev["test"],
                    "trades": 0, "years": ev["years"]})
    out += [x for x in (prev or {}).get("strategies") or [] if x.get("group") in ("bisher", "vorlage")]   # Ergebnisse vom 26./27.11.
    probes = []
    for name, note, mk, cost in PROBES:
        r = multi(D, mk, cost=cost)
        probes.append({"name": name, "note": note, **{k: r[k] for k in ("cagr", "min", "max", "dd", "train", "test")}})
    probes += [x for x in (prev or {}).get("probes") or [] if x.get("carry")]   # Tests mit Zahlen außerhalb dieses Moduls
    # Zusammensetzung (ohne Stopp, Stichtag Monatsende)
    cnt, mk_n, gr_n, all_n = collections.Counter(), 0, 0, 0
    for iso, held in res["best"]["res0"]["log"]:
        i = D.iso.index(iso)
        for x in held:
            cnt[x] += 1
            if D.kind[x] == "market":
                mk_n += 1
            else:
                q = fund(D, i, x)
                all_n += 1
                gr_n += bool(q and q.get("gttm") is not None and q["gttm"] >= 15)
    sec = collections.Counter()
    for x, k in cnt.items():
        w = D.winfo.get(x) if x not in D.sec or not (D.sec.get(x) or {}).get("sic") else None
        sec["Länder-ETF" if D.kind[x] == "market" else screen.GICS_DE.get(w[1], "Sonstige") if w else _sector((D.sec.get(x) or {}).get("sic"))] += k
    tot = float(sum(sec.values())) or 1.0
    ds = res["best"]["res0"]["ds"]
    idx = list(range(0, len(ds), 5))      # jeder 5. Handelstag
    curves = {"d": [ds[i] for i in idx]}
    for k in ("best", "best_stop", "prev27", "QQQ", "SPY"):
        nav = res[k]["res0"]["nav"]
        curves[k] = [round(nav[i] / nav[0], 4) for i in idx]
    pc = (prev or {}).get("curves") or {}
    for k in ("jakob", "qg"):
        if pc.get(k) and pc.get("d") == curves["d"]:
            curves[k] = pc[k]
    S = {x["id"]: x for x in out}
    c, w = S["best"], S["best_stop"]
    best = max((x for x in out if x["group"] == "bekannt"), key=lambda x: x["cagr"])
    top_sec = sec.most_common(1)[0] if sec else ("–", 0)
    doc = {"v": 2, "rule": screen.RULE_V, "made": datetime.date.today().isoformat(), "years": YEARS, "offsets": len(OFFS),
           "period": {"start": _iso(ds[0]), "end": _iso(ds[-1]), "train_end": TRAIN_END},
           "universe": {"tickers": len(D.spans), "missing": D.missing, "markets": len(MARKETS)},
           "strategies": out, "probes": probes, "curves": curves,
           "sectors": [[k, round(v / tot * 100, 1)] for k, v in sec.most_common()],
           "held": [[s, m, _nice(((D.sec.get(s) or {}).get("sic") or [None, None, MARKETS.get(s) or (D.winfo.get(s) or [0, 0, s])[2]])[2])] for s, m in cnt.most_common(12)],
           "n_titles": len(cnt), "market_share": round(mk_n / max(1, sum(cnt.values())) * 100, 1), "growth_share": round(gr_n / max(1, all_n) * 100, 1),
           "findings": [
               {"t": "Deine Regel", "x": "6 Titel ohne Stopp, Gewinner laufen weiter, höchstens 30 %% je Titel: %s %% pro Jahr bei %s %% größtem Rückgang. Mit Stopp 25 %% wären es %s %% bei %s %%." % (_de(c["cagr"]), _de(c["dd"], 0), _de(w["cagr"]), _de(w["dd"], 0))}]
           + ([{"t": "Quality-Growth-Vorlage", "x": "Wie eingefügt %s %% pro Jahr, ohne Warten auf Rücksetzer %s %%. Übernommen wurden 6 Titel. Gleich gewichten einmal im Jahr war besser als jeden Monat, gar nicht gleich gewichten noch etwas besser." % (
               _de(S["qg"]["cagr"]), _de(S["qg_any"]["cagr"]))}] if "qg" in S and "qg_any" in S else [])
           + list((prev or {}).get("notes") or [])
           + [{"t": "Gegen bekannte Strategien", "x": "Beste bekannte Strategie: %s mit %s %%. Nasdaq-100 %s %%, S&P 500 %s %%%s." % (
               best["name"], _de(best["cagr"]), _de(S["QQQ"]["cagr"]), _de(S["SPY"]["cagr"]), ", deine bisherigen Regeln auf derselben Auswahl %s %%" % _de(S["jakob"]["cagr"]) if "jakob" in S else "")},
              {"t": "Breit statt ein Sektor", "x": "%d verschiedene Titel in %d Jahren; am häufigsten %s (%s %% der Monate)." % (len(cnt), YEARS, top_sec[0], _de(top_sec[1] / tot * 100, 0))}],
           "limits": ["Je nach Stichtag im Monat liegt die Rendite zwischen %s und %s %% pro Jahr, der Rückgang reicht bis %s %%." % (_de(c["min"]), _de(c["max"]), _de(c["worst_dd"], 0)),
                      "Etwa %d Käufe und Verkäufe im Jahr; Gewinne fallen fast jedes Jahr an, Steuern sind nicht eingerechnet." % round(c["trades"] / YEARS),
                      "Schwächste volle Jahre: %s." % ", ".join("%s %s%s %%" % (y, "+" if v > 0 else "", _de(v, 0)) for y, v in sorted(list(c["years"].items())[1:-1], key=lambda x: x[1])[:2]),
                      "Für %d von %d Kürzeln gibt es keine Kurse mehr (meist nach Übernahmen); das kann das Ergebnis leicht schönen." % (D.missing, len(D.spans)),
                      "Ein Filter nach Umsatzwachstum senkte die Rendite: Die stärksten Aktien sind ohnehin meist schnell wachsende Firmen."],
           "sources": (prev or {}).get("sources") or [], "notes": (prev or {}).get("notes") or []}
    _log("Backtest: fertig in %.0f s" % (time.time() - t0))
    return doc


def quick():
    D = Data(world_=True)
    ev = evaluate(D, simulate(D, app_rule()))  # Stichtag Monatsende
    _log("Regel der App, Stichtag Monatsende: %.1f %% pro Jahr, Rückgang %.1f %% (%d Titel)" % (ev["cagr"], ev["dd"], len(D.stocks)))


def main(repo=None):
    from .common import get_store
    if repo:
        from . import abo
        store = abo.connect(repo)
    else:
        store = get_store()
    store.put("backtest.json", run(store.get("backtest.json")))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "sec":
        sec_fetch(sorted(membership()))
    elif cmd == "quick":
        quick()
    else:
        main(sys.argv[2] if len(sys.argv) > 2 else None)
