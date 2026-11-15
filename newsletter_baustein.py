"""Baustein für den Börsen-Newsletter: zeigt dein Depot als eigene Karte.

Einbau in newsletter.py (drei Schritte):

1. Diesen Code (ab "import urllib.request") unter die Funktion calendar_view() kopieren.
2. In render_html() nach dem Block "Das Wichtigste" einfügen:

        depot = depot_card()
        if depot:
            parts.append(depot)

3. In newsletter.yml unter "env:" zwei Zeilen ergänzen und beide Werte als Secrets im Newsletter-Repo anlegen:

          DEPOT_REPO: ${{ secrets.DEPOT_REPO }}      # z. B. deinname/depot-daten
          DEPOT_TOKEN: ${{ secrets.DEPOT_TOKEN }}    # derselbe Zugangsschlüssel wie beim Tracker (nur Lesen reicht)

Der Baustein nutzt die Helfer des Newsletters (card, stat_tiles, coin_list, subhead, esc, UP, DOWN, INK, INK3).
Fehlen die Secrets oder ist GitHub nicht erreichbar, bleibt die Karte einfach weg.
"""
import urllib.request


def _de(x, digits=2):
    s = f"{abs(x):,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s


def depot_card():
    repo, token = os.environ.get("DEPOT_REPO"), os.environ.get("DEPOT_TOKEN")
    if not repo or not token:
        return ""
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/contents/data/digest.json",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.raw+json",
                     "User-Agent": "newsletter"})
        with urllib.request.urlopen(req, timeout=30) as r:
            n = json.loads(r.read().decode("utf-8")).get("newsletter") or {}
    except Exception:
        return ""
    if not n.get("positions"):
        return ""
    day, pnl = n.get("day_eur") or 0, n.get("pnl") or 0
    tiles = [
        ("Depotwert", _de(n.get("value") or 0) + " €", n.get("day_pct")),
        ("Heute", ("+" if day >= 0 else "−") + _de(day) + " €", None, UP if day >= 0 else DOWN),
        ("Gewinn offen", ("+" if pnl >= 0 else "−") + _de(pnl) + " €", n.get("pnl_pct")),
    ]
    inner = stat_tiles(tiles)
    movers = [{"name": m.get("name"), "symbol": m.get("symbol"), "change_pct": m.get("change_pct"),
               "price": ("+" if (m.get("day_eur") or 0) >= 0 else "−") + _de(m.get("day_eur") or 0) + " € für dich"}
              for m in n.get("movers") or []]
    if movers:
        inner += '<div style="height:22px;"></div>' + subhead("Größte Bewegungen") + coin_list(movers)
    events = n.get("events") or []
    if events:
        rows = "".join(
            f'<div style="padding:8px 0;font-size:15px;line-height:1.45;color:{INK};">'
            f'<span style="color:{INK3};">{esc(e.get("date", "")[8:10])}.{esc(e.get("date", "")[5:7])}.</span>&nbsp;&nbsp;'
            f'{esc(e.get("title"))}</div>' for e in events[:6])
        inner += '<div style="height:18px;"></div>' + subhead("Termine deiner Titel") + rows
    return card("Dein Depot", inner, esc(n.get("headline")) or "Stand von heute früh")
