"""Auswahl über die USA hinaus für die Strategie (Jakobs Wunsch vom 28.11.2026: weltweite Aktien, nicht nur S&P 500 und
Nasdaq-100; nach dem Backtest gewählt: dazu Europa, China und Hongkong).

Quelle: Bestandsliste des iShares MSCI ACWI ETF (rund 2.200 große und mittlere Aktien aus 47 Ländern, frei als CSV).
Handelbar über deutsche Broker sind Industrieländer und Hongkong; aus Schwellenländern mit eigener Börse (Taiwan, Korea,
Indien, Brasilien, Mexiko …) nur Firmen mit einer Notiz in New York (ADR, Tabelle ADR); China A-Aktien, Saudi-Arabien,
Golfstaaten und Russland nie (yahoo_symbol, parse: so rechnet auch der Backtest „weltweit“).

Die Strategie nimmt davon nur INCLUDE (Backtest 28.11.2026, 10 Jahre, 6 Stichtage, Regel der App): S&P 500 und Nasdaq-100
33,0 % pro Jahr (Rückgang −48 %), dazu Europa, China und Hongkong 34,8 % (−52 %, beide Hälften besser), ganzer ACWI nur
30,8 % (−64 %); einzeln dazu: Europa 36,4 %, China/Hongkong 33,8 %, US-Mittelwerte 35,5 % (erste Hälfte schlechter),
Kanada/Australien 31,8 %, Japan 28,9 %, Schwellenländer über New York 28,5 %.

Kurse kommen von Yahoo in der Heimatwährung; für die Rangfolge rechnet screen.py alles in Dollar um (FX), damit ein Kursplus,
das nur aus einer schwachen Heimatwährung kommt, nicht als Stärke zählt.
"""
import csv
import io
import re

from .common import SourceError, http_json, log

URL = "https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf/latest-holdings.csv"

# Börse (Stichwort im Namen, klein) -> Yahoo-Endung; leer = Kürzel wie in New York
EXCH = (("tokyo", ".T"), ("london", ".L"), ("hong kong", ".HK"), ("toronto", ".TO"), ("asx", ".AX"), ("new zealand", ".NZ"),
        ("singapore", ".SI"), ("euronext paris", ".PA"), ("xetra", ".DE"), ("deutsche boerse", ".DE"), ("amsterdam", ".AS"),
        ("brussels", ".BR"), ("lisbon", ".LS"), ("madrid", ".MC"), ("borsa italiana", ".MI"), ("swiss", ".SW"),
        ("copenhagen", ".CO"), ("helsinki", ".HE"), ("oslo", ".OL"), ("wiener", ".VI"), ("irish", ".IR"), ("tel aviv", ".TA"),
        ("omx nordic", ".ST"), ("nasdaq", ""), ("nyse", ""), ("new york", ""))
# Länder, deren Heimatbörse zählt (Industrieländer und Hongkong)
HOME = {"Canada", "United Kingdom", "Ireland", "France", "Germany", "Netherlands", "Belgium", "Luxembourg", "Austria",
        "Switzerland", "Italy", "Spain", "Portugal", "Denmark", "Sweden", "Norway", "Finland", "Israel", "Japan", "Australia",
        "New Zealand", "Hong Kong", "Singapore", "China", "Macau"}
NO_HOME = {"shanghai", "shenzhen"}     # China A-Aktien: über deutsche Broker nicht handelbar
# Schwellenländer: Heimatkürzel -> Notiz in New York
ADR = {("Taiwan", "2330"): "TSM", ("Taiwan", "2303"): "UMC", ("Taiwan", "3711"): "ASX", ("Taiwan", "2412"): "CHT",
       ("Korea (South)", "105560"): "KB", ("Korea (South)", "055550"): "SHG", ("Korea (South)", "005490"): "PKX",
       ("Korea (South)", "015760"): "KEP", ("Korea (South)", "017670"): "SKM", ("Korea (South)", "030200"): "KT",
       ("India", "INFY"): "INFY", ("India", "HDFCBANK"): "HDB", ("India", "ICICIBANK"): "IBN", ("India", "WIPRO"): "WIT",
       ("India", "DRREDDY"): "RDY",
       ("Brazil", "VALE3"): "VALE", ("Brazil", "PETR4"): "PBR-A", ("Brazil", "PETR3"): "PBR", ("Brazil", "ITUB4"): "ITUB",
       ("Brazil", "BBDC4"): "BBD", ("Brazil", "ABEV3"): "ABEV", ("Brazil", "SBSP3"): "SBS", ("Brazil", "GGBR4"): "GGB",
       ("Brazil", "EMBR3"): "EMBJ", ("Brazil", "EMBJ3"): "EMBJ", ("Brazil", "SANB11"): "BSBR", ("Brazil", "UGPA3"): "UGP",
       ("Brazil", "CMIG4"): "CIG", ("Brazil", "ELET3"): "EBR", ("Brazil", "SUZB3"): "SUZ", ("Brazil", "VIVT3"): "VIV",
       ("Brazil", "TIMS3"): "TIMB", ("Brazil", "CSNA3"): "SID",
       ("Mexico", "AMXL"): "AMX", ("Mexico", "AMXB"): "AMX", ("Mexico", "FEMSAUBD"): "FMX", ("Mexico", "KOFUBL"): "KOF",
       ("Mexico", "CEMEXCPO"): "CX", ("Mexico", "GAPB"): "PAC", ("Mexico", "ASURB"): "ASR", ("Mexico", "OMAB"): "OMAB",
       ("South Africa", "GFI"): "GFI", ("South Africa", "HAR"): "HMY", ("South Africa", "SSW"): "SBSW", ("South Africa", "SOL"): "SSL",
       ("Chile", "SQM-B"): "SQM", ("Chile", "SQM B"): "SQM", ("Chile", "CHILE"): "BCH", ("Chile", "BSANTANDER"): "BSAC",
       ("Chile", "LTM"): "LTM", ("Colombia", "ECOPETROL"): "EC", ("Colombia", "PFBCOLOM"): "CIB",
       ("Indonesia", "TLKM"): "TLK"}
EUROPE = {"United Kingdom", "Ireland", "France", "Germany", "Netherlands", "Belgium", "Luxembourg", "Austria", "Switzerland",
          "Italy", "Spain", "Portugal", "Denmark", "Sweden", "Norway", "Finland"}
INCLUDE = EUROPE | {"China", "Hong Kong", "Macau"}     # zusätzlich zu S&P 500 und Nasdaq-100
COUNTRY_DE = {"United States": "USA", "Canada": "Kanada", "United Kingdom": "Großbritannien", "Ireland": "Irland",
              "France": "Frankreich", "Germany": "Deutschland", "Netherlands": "Niederlande", "Belgium": "Belgien",
              "Luxembourg": "Luxemburg", "Austria": "Österreich", "Switzerland": "Schweiz", "Italy": "Italien", "Spain": "Spanien",
              "Portugal": "Portugal", "Denmark": "Dänemark", "Sweden": "Schweden", "Norway": "Norwegen", "Finland": "Finnland",
              "Israel": "Israel", "Japan": "Japan", "Australia": "Australien", "New Zealand": "Neuseeland", "Hong Kong": "Hongkong",
              "Singapore": "Singapur", "China": "China", "Macau": "Macau", "Taiwan": "Taiwan", "Korea (South)": "Südkorea",
              "India": "Indien", "Brazil": "Brasilien", "Mexico": "Mexiko", "South Africa": "Südafrika", "Chile": "Chile",
              "Colombia": "Kolumbien", "Indonesia": "Indonesien", "Argentina": "Argentinien", "Peru": "Peru"}


def yahoo_symbol(ticker, exchange, country):
    """Yahoo-Kürzel für eine Zeile der Bestandsliste, None, wenn die Börse nicht zählt."""
    t, ex = (ticker or "").strip(), (exchange or "").lower()
    if not t or t == "-" or any(x in ex for x in NO_HOME):
        return None
    adr = ADR.get((country, t))
    if adr:
        return adr
    suf = next((s for k, s in EXCH if k in ex), None)
    if suf is None:
        return None
    if suf == "":
        return re.sub(r"[ ./]+", "-", t)
    if country not in HOME and country != "United States":
        return None
    if suf == ".HK":
        return "%04d.HK" % int(t) if t.isdigit() else None
    if suf == ".T" and not t[:4].isalnum():
        return None
    if suf == ".L":
        t = t.rstrip(".")
    return re.sub(r"[ ./]+", "-", t) + suf


def parse(text):
    """Bestandsliste (CSV, alle Formate seit 2015) -> {Yahoo-Kürzel: [Land, Sektor nach GICS, Name, Gewicht in %]}."""
    lines = (text or "").lstrip("﻿").splitlines()
    h = next((i for i, l in enumerate(lines) if l.startswith("Ticker,")), None)
    if h is None:
        return {}
    out = {}
    for r in csv.DictReader(io.StringIO("\n".join(lines[h:]))):
        if (r.get("Asset Class") or "") != "Equity":
            continue
        country = r.get("Location") or r.get("Country") or ""
        sym = yahoo_symbol(r.get("Ticker"), r.get("Exchange"), country)
        if not sym:
            continue
        try:
            w = float((r.get("Weight (%)") or "0").replace(",", ""))
        except ValueError:
            w = 0.0
        try:
            if float(re.sub(r"[^0-9.\-]", "", r.get("Market Value") or "") or "1") <= 1000:
                continue       # Restposten ohne Wert (Pleite, eingestellt)
        except ValueError:
            pass
        if sym in out:
            out[sym][3] += w
            continue
        out[sym] = [country, r.get("Sector") or "", (r.get("Name") or "").strip(), w]
    return out


def acwi(include=INCLUDE):
    """Heutige Mitglieder des MSCI ACWI aus den Ländern include (Standard: Europa, China, Hongkong), soweit über deutsche
    Broker handelbar. Leer, wenn die Liste nicht passt."""
    try:
        txt = http_json(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=60, raw=True)
    except SourceError as e:
        log("Auswahl: MSCI ACWI nicht geladen (%s)" % type(e).__name__)
        return {}
    allm = parse(txt)
    if len(allm) < 1000:
        return {}
    return {s: v for s, v in allm.items() if include is None or v[0] in include}
