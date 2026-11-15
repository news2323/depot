# Depot-Tracker (Jakob)

Aktien- und Krypto-Tracker mit Dashboard im Stil des Börsen-Newsletters (Apple-Look). Anleitung für Jakob: `ANLEITUNG.md`.

## Aufbau
- `tracker/` Python, nur Standardbibliothek (außer `ai.py`: `anthropic`). Läuft lokal mit Python 3.9 und in GitHub Actions.
  - `common.py` HTTP, Datenablage (`LocalStore` = `data/`, `GitHubStore` = privates Repo, gewählt über `DATA_REPO`)
  - `sources.py` Yahoo (Kurse, Kennzahlen), Binance/OKX/Hyperliquid/Bybit (Spot, Futures, OI, Funding), `classify_flow`, `onchain_revenue` (DeFi Llama: Gebühren/Einnahmen je Protokoll, Marktwert, dazu FDV von CoinGecko; fließt bei Protokollen in `crypto_valuation`, bei Chains nur Anzeige)
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
- Anzeige: Aktien immer in Euro, Krypto in US-Dollar. Daten bleiben in der Handelswährung, umgerechnet wird nur bei der Ausgabe (`web/app.js` `toShow`/`px`, `tracker/update.py` `show_price`). Kurs-Alerts tragen `currency`; ohne das Feld gilt die Handelswährung.
- Bewertung als Punkte 1 bis 10 (1 = deutlich überbewertet, 10 = deutlich unterbewertet): `analytics.rating` aus dem Score, gespeichert als `valuation.rating`; `web/app.js` `ratingOf` rechnet für alte Daten nach. Stufen und Wörter in `RATING_WORDS`.
- Dashboard: Listen sind sortierbare Tabellen (`tbl` und `COL` in `web/views.js`), Filter über `S.flt`, Sortierung über `S.sort`, Suche im Kopf.
- Gewichtung (Jakobs Vorgabe vom 15.11.2026): Ein gefallener Kurs oder gefallener Markt ist allein kein Kaufgrund. Kennzahlen zählen voll, Kursziele und Dividende halb, Kurslage nur, wenn die Kennzahlen positiv sind und der Titel in 6 Monaten nicht deutlich schwächer lief als S&P 500 bzw. Bitcoin (`_price_points`, `tech.rel_6m`). Ohne Kennzahlen (ETFs, Gold, Coins ohne Protokoll-Einnahmen) gibt es keine Punkte (`rating: null`), nur ein Wort zur Kurslage. Verlustbringer höchstens 5 Punkte.
- Die Bewertung ist eine Faustregel. Überall „keine Anlageberatung“ stehen lassen.
