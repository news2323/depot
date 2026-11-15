# Depot-Tracker (Jakob)

Aktien- und Krypto-Tracker mit Dashboard im Stil des Börsen-Newsletters (Apple-Look). Anleitung für Jakob: `ANLEITUNG.md`.

## Aufbau
- `tracker/` Python, nur Standardbibliothek (außer `ai.py`: `anthropic`). Läuft lokal mit Python 3.9 und in GitHub Actions.
  - `common.py` HTTP, Datenablage (`LocalStore` = `data/`, `GitHubStore` = privates Repo, gewählt über `DATA_REPO`)
  - `sources.py` Yahoo (Kurse, Kennzahlen), Binance/OKX/Hyperliquid/Bybit (Spot, Futures, OI, Funding), `classify_flow`
  - `analytics.py` Trend, Nachkauf-Zonen, Dividenden, regelbasierte Bewertung
  - `portfolio.py` Bestände per FIFO in Euro (dieselbe Logik steht noch einmal in `web/app.js` → beide Stellen ändern)
  - `update.py fast|daily|all`, `ai.py` (Claude + Grok über API, nur mit Schlüssel), `abo.py` (Recherche über das Claude-Abo: geplante Aufgabe `depot-ki-recherche` in der App, Token aus dem Schlüsselbund), `digest.py` (Kalender, Newsletter-Kurzfassung)
- `web/` statische App (`index.html`, `app.css`, `app.js` = Daten/Rechnen/Diagramme, `views.js` = Ansichten). Kein Build.
  Auf `localhost` spricht sie mit `server.py`, sonst über die GitHub-API mit dem privaten Daten-Repo.
- `server.py` lokaler Server (`--data <ordner> --port <n>` für Tests mit Beispieldaten).
- `.github/workflows/` `kurse.yml` (alle 10 Min.), `analyse.yml` (täglich), `seite.yml` (Pages aus `web/`).
- `newsletter_baustein.py` Karte „Dein Depot“ zum Einfügen in Jakobs Newsletter.

## Datendateien (`data/`)
`portfolio.json` schreibt nur die App (Buchungen, Watchlist, Alerts, ntfy-Kanal). Alles andere schreiben die Läufe:
`market.json`, `daily.json`, `analysis.json`, `digest.json`, `state.json` (ausgelöste Alerts, OI-Gedächtnis).

## Regeln
- Das Code-Repo ist öffentlich, die Action-Protokolle auch: nie Ticker, Stückzahlen oder Beträge loggen. Fehler nur als Typ.
- An KI-Dienste gehen nur Ticker, öffentliche Kennzahlen und Gewichte in Prozent, keine Euro-Beträge.
- Yahoo: User-Agent muss schlicht `Mozilla/5.0` sein, sonst 429. Kennzahlen brauchen Cookie + Crumb.
- Texte im Dashboard auf Deutsch, Stil und Farben wie im Newsletter (`~/Downloads/newsletter_code.txt`).
- Broker-Import (Trade Republic, comdirect) ist bewusst noch nicht gebaut: Buchungen haben dafür das Feld `source`.
- Starke Tagesbewegungen: `update.check_moves` meldet sie per Push mit Bewertung (`analytics.move_read`, dieselben Sätze in `web/views.js` `moveRead` → beide Stellen ändern). Schwellen in `portfolio.settings.move_stock/move_crypto`.
- Die Bewertung ist eine Faustregel. Überall „keine Anlageberatung“ stehen lassen.
