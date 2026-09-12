Basar Tischboerse V11 - Korrekturpaket

Gefundene und behobene Hauptfehler:
1. Die oeffentliche app.js nutzte eine falsche Supabase-URL (ein "v" fehlte).
2. "Ueberweisung" sendete den Wert "transfer", die Datenbank akzeptiert aber nur "ueberweisung".
3. Die Zahl "37 Tische frei" war im HTML fest eingetragen und konnte dadurch wie ein echter Wert wirken, obwohl die Datenbankverbindung fehlgeschlagen war.
4. Oeffentliche Seite und Admin verwendeten getrennte Supabase-Konfigurationen. V11 nutzt config.js als gemeinsame Quelle.
5. Bei mehreren aktiven Basaren kann der Besucher jetzt den Basar auswaehlen.
6. V11 enthaelt einen SQL-Patch fuer die Data-API-Berechtigungen der oeffentlichen Seite.

Upload bei GitHub:
- config.js
- app.js
- index.html
- admin.js
- admin.html
- styles.css

Danach in Supabase SQL Editor einmal v11-supabase-fix.sql ausfuehren.
