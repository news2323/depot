# Depot-Tracker: Anleitung

## Sofort auf dem Mac nutzen

Im Terminal in diesem Ordner:

```bash
python3 server.py
```

Dann <http://localhost:8765> im Browser öffnen. Käufe eintragen, fertig. Deine Daten liegen in `data/portfolio.json`.
Der Knopf oben rechts (Pfeile) holt neue Kurse. „Alles neu laden und berechnen“ in den Einstellungen holt auch
Kursverläufe, Kennzahlen, Dividenden und Nachkauf-Zonen.

## Cloud-Betrieb mit Handy-App und Alerts (einmalig etwa 20 Minuten)

Zwei Repos auf GitHub:

| Repo | Sichtbarkeit | Inhalt |
|---|---|---|
| `depot` | öffentlich | nur der Programmcode und das Dashboard, keine Depotdaten |
| `depot-daten` | **privat** | dein Depot, Kurse, Analysen |

Öffentlich muss das Code-Repo sein, weil GitHub nur dort die Webseite (Pages) und unbegrenzte Rechenzeit kostenlos gibt.
Ein Kurs-Check alle 10 Minuten würde in einem privaten Repo das Freikontingent sprengen.
Die Protokolle der Läufe sind deshalb öffentlich einsehbar: Das Programm schreibt dort nie Ticker oder Beträge hinein.

### 1. Repos anlegen
1. Auf github.com ein **privates** Repo `depot-daten` anlegen (mit README, damit es einen `main`-Zweig hat).
2. Ein **öffentliches** Repo `depot` anlegen und den Inhalt dieses Ordners hochladen (alles außer `data/`).

### 2. Zugangsschlüssel erstellen
GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:
- Repository access: nur `depot` und `depot-daten`
- Permissions: **Contents: Read and write**, **Actions: Read and write**

Den Schlüssel einmal kopieren. Er wird an zwei Stellen gebraucht: als Secret (Schritt 3) und in der App (Schritt 5).

### 3. Secrets im Repo `depot` eintragen
Settings → Secrets and variables → Actions → New repository secret:

| Name | Wert |
|---|---|
| `DATA_REPO` | `deinname/depot-daten` |
| `DATA_TOKEN` | der Zugangsschlüssel aus Schritt 2 |
| `ANTHROPIC_API_KEY` | derselbe Schlüssel wie beim Newsletter (für Claude) |
| `XAI_API_KEY` | Schlüssel von console.x.ai (für Grok, optional) |

Ohne die beiden KI-Schlüssel läuft alles außer der KI-Recherche.

### 4. Webseite einschalten
Im Repo `depot`: Settings → Pages → Source: **GitHub Actions**. Danach unter Actions den Ablauf
„Dashboard veröffentlichen“ einmal von Hand starten. Die Adresse ist `https://deinname.github.io/depot/`.

### 5. App verbinden
Die Adresse am Handy in Safari öffnen, Benutzername und Zugangsschlüssel eintragen.
Dann Teilen → **Zum Home-Bildschirm**. Auf dem Mac dieselbe Adresse öffnen und genauso verbinden.

Wenn du lokal schon Käufe eingetragen hast: In den Einstellungen „Depot als Datei sichern“ und den Inhalt als
`data/portfolio.json` ins Repo `depot-daten` hochladen.

### 6. Push-Alerts
1. App **ntfy** aufs Handy laden (kostenlos, kein Konto nötig).
2. Im Dashboard: Zahnrad → „Zufälligen Namen erzeugen“ → Speichern.
3. In ntfy: „Thema abonnieren“ und genau diesen Namen eintragen. Mit „Test senden“ prüfen.

Der Kanalname ist das Passwort. Die Alert-Texte (z. B. „NVDA unter 120 $“) laufen über den ntfy-Server.

## Was wann läuft

| Ablauf | Wann | Was |
|---|---|---|
| Kurse und Alerts | alle 10 Minuten (GitHub startet oft etwas später) | Kurse, Krypto-Flows, Alerts |
| Tagesanalyse | täglich 5:30 bzw. 6:30 Uhr | Verläufe, Kennzahlen, Dividenden, Nachkauf-Zonen, KI-Recherche, Kalender |

GitHub schaltet zeitgesteuerte Abläufe ab, wenn im Repo 60 Tage nichts geändert wurde. Dann unter Actions wieder einschalten.

## Kosten der KI-Recherche

Jeder Titel wird höchstens alle 7 Tage neu recherchiert, pro Tag höchstens 6 Titel (`REFRESH_DAYS`, `MAX_PER_RUN` in
`tracker/ai.py`). Dazu kommt täglich eine kurze Depot-Einschätzung und ein Grok-Abruf. Das Modell steht in `CLAUDE_MODEL`.

## Woher die Daten kommen

- **Aktien:** Yahoo Finance (Kurse, Dividenden, KGV, PEG, Analystenziele, Termine). Die KI ergänzt Quartalszahlen von den Investor-Relations-Seiten.
- **Krypto:** Velo hat keine frei nutzbare Schnittstelle. Der Tracker holt dieselben Größen direkt von den Börsen:
  Spot-Kaufdruck von Binance, Futures-Kaufdruck von Binance oder OKX, Open Interest und Funding von OKX, Hyperliquid, Bybit und Binance.
  Jeder Coin verlinkt zu Velo. Von GitHubs Servern (USA) aus sind Binance Futures und Bybit meist gesperrt, dann zählen OKX und Hyperliquid.
- **Bewertung:** eine Faustregel aus Kennzahlen und Kurslage. Keine Anlageberatung.

## Später: Depot direkt verbinden

Jede Buchung trägt das Feld `source` (heute `manual`). Ein Import für Trade Republic oder comdirect schreibt Buchungen
mit eigener Kennung in dieselbe Liste, ohne dass sich am Rest etwas ändert.
