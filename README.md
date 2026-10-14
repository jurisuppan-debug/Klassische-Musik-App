# Klassik entdecken

Web-App rund um klassische Musik:

- **Komponisten-Lexikon** – 30 Komponisten vom Barock bis zur Moderne, mit Porträt, Biografie (live aus der deutschen Wikipedia), wichtigen Werken und Hörbeispielen.
- **Hör-Quiz** – ein Ausschnitt wird abgespielt, du wählst aus vier Stücken das richtige. Filter nach Epoche und Komponist, zwei Schwierigkeitsstufen (Anfang / zufällige Stelle).

Die Aufnahmen stammen von Wikimedia Commons (gemeinfrei oder freie Lizenz, Angaben stehen beim jeweiligen Stück).

## Starten

Es braucht nichts außer Python (ist auf dem Mac vorinstalliert):

```bash
python3 -m http.server 8000
```

Dann im Browser <http://localhost:8000> öffnen.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seitengerüst |
| `css/style.css` | Gestaltung (hell/dunkel) |
| `js/composers.js` | Epochen und Komponisten (Lebensdaten, Kurztext, Werke) |
| `js/pieces.js` | Musikstücke mit Link zur Aufnahme |
| `js/app.js` | Seiten, Lexikon und Quiz |

Neuen Komponisten hinzufügen: Eintrag in `js/composers.js` ergänzen (`wiki` = Titel des deutschen Wikipedia-Artikels). Neues Stück: Eintrag in `js/pieces.js` mit MP3-Link von Wikimedia Commons.
