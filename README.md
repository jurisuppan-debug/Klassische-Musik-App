# Klassik entdecken

Web-App rund um klassische Musik:

- **Komponisten-Lexikon** – 60 Komponisten vom Barock bis zur Moderne, mit Porträt, Biografie (live aus der deutschen Wikipedia), wichtigen Werken und Hörbeispielen.
- **Hör-Quiz** – ein Ausschnitt wird abgespielt, du errätst das Stück. Filter nach Epoche und Komponist, zwei Schwierigkeitsstufen (Anfang / zufällige Stelle). Modus „Auswahl“ mit vier Antworten oder „Hardcore“: Epoche, Komponist und Stück selbst eintippen (mit Vorschlägen).
- **Wer bin ich?** – fünf Hinweise pro Komponist, von vage bis offensichtlich; je weniger Hinweise du brauchst, desto mehr Punkte.

Die Aufnahmen stammen von Wikimedia Commons (gemeinfrei oder freie Lizenz, Angaben stehen beim jeweiligen Stück).

## Starten

Es braucht nichts außer Python (ist auf dem Mac vorinstalliert):

```bash
python3 server.py
```

Dann im Browser <http://localhost:8000> öffnen. Der Server sagt dem Browser, dass er nichts zwischenspeichern soll – Änderungen sind also sofort sichtbar.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seitengerüst |
| `css/style.css` | Gestaltung (hell/dunkel) |
| `js/composers.js` | Epochen und Komponisten (Lebensdaten, Kurztext, Werke) |
| `js/pieces.js` | Musikstücke mit Link zur Aufnahme |
| `js/clues.js` | Hinweise für „Wer bin ich?“ |
| `js/app.js` | Seiten, Lexikon und Quiz |
| `server.py` | Lokaler Server ohne Browser-Cache |

Neuen Komponisten hinzufügen: Eintrag in `js/composers.js` ergänzen (`wiki` = Titel des deutschen Wikipedia-Artikels). Neues Stück: Eintrag in `js/pieces.js` mit MP3-Link von Wikimedia Commons.
