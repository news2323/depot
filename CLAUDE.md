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
  Layout im Stil eines Fonds-Dashboards (Jakobs Wunsch vom 17.11.2026): Seitenleiste ab 1100 px, sonst Leiste unten; Marktleiste aus `market.json` → `indices` (`update.market_strip`); Detail als Seitenpanel. Hell und dunkel über CSS-Variablen, folgt dem System, umstellbar in den Einstellungen (`applyTheme`, nur `localStorage`). Diagrammfarben aus der geprüften Palette (`--s1`…`--s8`).
  Übersicht: Wertentwicklung, Diagramm „Heutige Positionen“ und Risiko (Schwankung, größter Rückgang, Beta) rechnen die heutigen Bestände mit alten Kursen zurück (`backcast`, `perfStats` in `app.js`), weil die eingetragenen Kaufdaten kurz zurückreichen. Heatmap (`squarify`), Beitrag heute, Allokation.
  Auf `localhost` spricht sie mit `server.py`, sonst über die GitHub-API mit dem privaten Daten-Repo.
- `server.py` lokaler Server (`--data <ordner> --port <n>` für Tests mit Beispieldaten).
- `.github/workflows/` `kurse.yml` (geplant: `update loop 50`, prüft 50 Min. lang alle 5 Min., weil GitHub geplante Läufe nur alle 40 bis 150 Min. startet; aus der App: `fast` in eigener Concurrency-Gruppe), `analyse.yml` (täglich), `seite.yml` (Pages aus `web/`).
- `newsletter_baustein.py` Karte „Dein Depot“ zum Einfügen in Jakobs Newsletter.

## Datendateien (`data/`)
`portfolio.json` schreibt nur die App (Buchungen, Watchlist, Alerts, ntfy-Kanal). Alles andere schreiben die Läufe:
`market.json`, `daily.json`, `analysis.json`, `digest.json`, `state.json` (ausgelöste Alerts, OI-Gedächtnis).

## Regeln
- Das Code-Repo ist öffentlich, die Action-Protokolle auch: nie Ticker, Stückzahlen oder Beträge loggen. Fehler nur als Typ.
- An KI-Dienste gehen nur Ticker, öffentliche Kennzahlen und Gewichte in Prozent, keine Euro-Beträge.
- Yahoo: User-Agent muss schlicht `Mozilla/5.0` sein, sonst 429. Kennzahlen brauchen Cookie + Crumb.
- Texte im Dashboard auf Deutsch. Schrift und Farben für Kursbewegungen wie im Newsletter (`~/Downloads/newsletter_code.txt`), Layout siehe oben.
- Broker-Import (Trade Republic, comdirect) ist bewusst noch nicht gebaut: Buchungen haben dafür das Feld `source`.
- Starke Tagesbewegungen: `update.check_moves` meldet sie per Push mit Bewertung (`analytics.move_read`). Schwellen in `portfolio.settings.move_stock/move_crypto`.
- Anzeige: Aktien immer in Euro, Krypto in US-Dollar. Daten bleiben in der Handelswährung, umgerechnet wird nur bei der Ausgabe (`web/app.js` `toShow`/`px`, `tracker/update.py` `show_price`). Kurs-Alerts tragen `currency`; ohne das Feld gilt die Handelswährung.
- Bewertung als Punkte 1 bis 10 (1 = deutlich überbewertet, 10 = deutlich unterbewertet): `analytics.rating` aus dem Score, gespeichert als `valuation.rating`; `web/app.js` `ratingOf` rechnet für alte Daten nach. Stufen und Wörter in `RATING_WORDS`.
- Reiter: Übersicht, Depot (mit Dividenden), Watchlist (mit Alerts), Kalender. Einen Analyse-Reiter gibt es nicht mehr: Punkte, Gründe, Kennzahlen und Recherche stehen nur in der Detailansicht eines Titels (Jakobs Wunsch vom 17.11.2026). Die Watchlist zeigt keine Bewertungsspalten.
- Kalender wie im Newsletter (`digest.build_calendar` + `sources.market_calendar`): Quartalszahlen großer US-Firmen (Nasdaq, ab 40 Mrd. $), US-Konjunktur, Fed und EZB (Forex Factory, nur laufende Woche, drosselt bei vielen Abrufen), Börsengänge (Nasdaq), dazu die eigenen Titel. Markttermine tragen `market: true`; fällt eine Quelle aus, bleiben ihre Termine vom Vortag.
- Art eines Titels: `common.asset_type` (Krypto, ETF, ETC, Aktie), in der App `isFund`.
- Alerts und Bewegungen zählen je Handelstag (`update.trade_day`), nicht je UTC-Kalendertag.
- Dashboard: Listen sind sortierbare Tabellen (`tbl` und `COL` in `web/views.js`), Filter über `S.flt`, Sortierung über `S.sort`, Suche im Kopf.
- Gewichtung (Jakobs Vorgaben vom 15. und 17.11.2026): Ein gefallener Kurs oder Markt ist allein kein Kaufgrund. Unterbewertet heißt: Der Markt hat überreagiert, der innere Wert hat sich nicht entsprechend geändert. Kennzahlen zählen voll, dazu die Änderung der Gewinnschätzung in 90 Tagen (Yahoo `earningsTrend`, `sources._eps_trend`, `analytics.est_change`). Kursziele und Dividende halb. Kurslage zählt nur, wenn die Kennzahlen positiv sind und der Kurs in 3 Monaten deutlich stärker fiel als die Gewinnschätzung (Coins: 1 Monat gegen `rev_chg`); bei gesenkten Schätzungen nie (`_price_points`, `intrinsic`). Ohne Schätzungsdaten nur der Vergleich mit S&P 500 bzw. Bitcoin (`tech.rel_6m`), Gewicht 0,25. Schätzung um 10 % gesenkt: höchstens 6 Punkte, um 25 %: höchstens 5. Ohne Kennzahlen (ETFs, Gold, Coins ohne Protokoll-Einnahmen) keine Punkte (`rating: null`), nur ein Wort zur Kurslage. Verlustbringer höchstens 5 Punkte.
- Beim Öffnen der App (und beim Zurückkehren) startet `autoRefresh` in `web/app.js` einen Kurslauf, wenn `market.json` älter als 3 Minuten ist, und lädt neu, sobald er fertig ist.
- Die Bewertung ist eine Faustregel. Überall „keine Anlageberatung“ stehen lassen.
