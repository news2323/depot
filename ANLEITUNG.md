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
- Permissions: **Contents: Read and write**, **Actions: Read and write**, **Workflows: Read and write**
- Expiration: ein festes Datum wählen (mit „No expiration“ lässt sich das Formular nicht abschicken)

Den Schlüssel einmal kopieren. Er wird an zwei Stellen gebraucht: als Secret (Schritt 3) und in der App (Schritt 5).

### 3. Secrets im Repo `depot` eintragen
Settings → Secrets and variables → Actions → New repository secret:

| Name | Wert |
|---|---|
| `DATA_REPO` | `deinname/depot-daten` |
| `DATA_TOKEN` | der Zugangsschlüssel aus Schritt 2 |
| `ANTHROPIC_API_KEY` | nur für Recherche über die API-Abrechnung; weglassen, wenn sie über das Abo läuft |
| `XAI_API_KEY` | Schlüssel von console.x.ai (für Grok, optional) |

Die beiden KI-Schlüssel sind freiwillig. Ohne sie läuft die Recherche über das Claude-Abo (siehe unten).

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

## Meldung bei starken Bewegungen

Bewegt sich ein Titel aus Depot oder Watchlist an einem Tag um mehr als 5 % (Aktien) oder 8 % (Krypto), kommt einmal
pro Tag und Richtung ein Push: wie der Titel nach Faustregel bewertet ist, was die Bewegung dafür bedeutet und wo die
nächste Nachkauf-Zone liegt. Die Schwellen stehen in den Einstellungen (Zahnrad), 0 schaltet die Meldung aus.

## Was wann läuft

| Ablauf | Wann | Was |
|---|---|---|
| Kurse und Alerts | durchgehend alle 5 Minuten (GitHub startet die Läufe unregelmäßig, jeder prüft deshalb 50 Minuten lang) | Kurse, Krypto-Flows, Alerts |
| Kurse beim Öffnen | wenn du die App öffnest und die Kurse älter als 3 Minuten sind | wie oben; die Seite lädt nach etwa einer Minute selbst neu |
| Tagesanalyse | täglich 5:30 bzw. 6:30 Uhr | Verläufe, Kennzahlen, Dividenden, Nachkauf-Zonen, KI-Recherche, Kalender |

GitHub schaltet zeitgesteuerte Abläufe ab, wenn im Repo 60 Tage nichts geändert wurde. Dann unter Actions wieder einschalten.

## KI-Recherche: über das Claude-Abo oder über die API

**Über das Abo (eingerichtet):** In der Claude-App läuft samstags um 9 Uhr die geplante Aufgabe „Depot: KI-Recherche“.
Sie recherchiert bis zu 12 fällige Titel (älter als 6 Tage) und die Depot-Einschätzung und schreibt beides ins Daten-Repo.
Das kostet nichts extra, zählt aber auf das Nutzungslimit des Abos. Der Mac muss an und die App offen sein, sonst läuft
die Aufgabe beim nächsten Start nach. Den Zugangsschlüssel holt das Skript `tracker/abo.py` aus dem macOS-Schlüsselbund
(dort liegt er seit dem ersten `git push`). Grenzen stehen in `MAX_TITEL` und `REFRESH_DAYS` in `tracker/abo.py`.

**Über die API (aus):** Mit dem Secret `ANTHROPIC_API_KEY` recherchiert stattdessen der tägliche Lauf auf GitHub
(`tracker/ai.py`, höchstens 6 Titel pro Tag, Abrechnung nach Verbrauch). Ohne das Secret wird das übersprungen.
`XAI_API_KEY` schaltet zusätzlich die Stimmung von X über Grok automatisch ein, ebenfalls nach Verbrauch. Ohne Kosten geht es von Hand über die App (siehe Stimmung unten).

## Woher die Daten kommen

- **Aktien:** Yahoo Finance (Kurse, Dividenden, KGV, PEG, Analystenziele, Termine). Die KI ergänzt Quartalszahlen von den Investor-Relations-Seiten.
- **Einblicke:** ebenfalls Yahoo Finance, einmal am Tag: Branchen deiner ETFs, Urteile und Kursziele der Analysten samt Hoch- und Abstufungen,
  Insider-Käufe und -Verkäufe. Insider melden einzeln nur US-Firmen, für europäische Titel bleibt der Bereich leer.
- **Stimmung:** Reddit-Erwähnungen von ApeWisdom und der Angst-und-Gier-Index für Krypto von alternative.me, täglich und kostenlos.
  Die Stimmung auf X holst du kostenlos über Grok: In Einblicke → Stimmung „Frage kopieren“ tippen, bei Grok einfügen,
  Groks Antwort kopieren und unter „Antwort einfügen“ speichern. Sie erscheint dann in der Tabelle und in der Detailansicht.
- **Krypto:** Velo hat keine frei nutzbare Schnittstelle. Der Tracker holt dieselben Größen direkt von den Börsen:
  Spot-Kaufdruck von Binance, Futures-Kaufdruck von Binance oder OKX, Open Interest und Funding von OKX, Hyperliquid, Bybit und Binance.
  Jeder Coin verlinkt zu Velo.
- **Krypto-Einnahmen:** DeFi Llama liefert je Protokoll Gebühren (Umsatz), Einnahmen (was das Protokoll behält) und den Anteil für Token-Halter.
  Daraus rechnet der Tracker Marktwert zu Gebühren (wie KUV) und Marktwert zu Einnahmen (wie KGV), hochgerechnet aus den letzten 30 Tagen. Von GitHubs Servern (USA) aus sind Binance Futures und Bybit meist gesperrt, dann zählen OKX und Hyperliquid.
- **Bewertung:** eine Faustregel aus Kennzahlen und Kurslage. Keine Anlageberatung.

## Später: Depot direkt verbinden

Jede Buchung trägt das Feld `source` (heute `manual`). Ein Import für Trade Republic oder comdirect schreibt Buchungen
mit eigener Kennung in dieselbe Liste, ohne dass sich am Rest etwas ändert.
