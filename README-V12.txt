BASAR-TISCHBOERSE V12

Neu:
- Veranstalterprofil pro Benutzer (eigene Vertrags- und Zahlungsdaten)
- Jeder Basar ist einem Veranstalter zugeordnet
- 14-/3-Tage-Zahlungsfrist automatisch
- Bei weniger als 3 Tagen bis zum Termin: Frist spaetestens Veranstaltungstag
- Offene, ueberfaellige Reservierungen werden als "Frist abgelaufen" markiert und geben Tische frei
- Kostenlose Stornierung bis 14 Tage vor Veranstaltung wird in der Teilnahmevereinbarung dokumentiert
- PDF-Teilnahmevereinbarung direkt nach Buchung
- Adminbereich: Veranstalterdaten inkl. optionaler IBAN/PayPal-E-Mail pflegen
- Multi-Veranstalter-Datentrennung fuer Basare und Buchungen

INSTALLATION:
1. In Supabase > SQL Editor die Datei v12-migration.sql komplett ausfuehren.
2. Danach alle Webdateien aus diesem Ordner zu GitHub hochladen (mindestens index.html, app.js, admin.html, admin.js, styles.css; config.js bleibt gleich, kann aber mit hochgeladen werden).
3. GitHub Pages neu laden: ?v=12 und Strg+F5.
4. Im Adminbereich Veranstalterdaten pruefen und optional IBAN / PayPal-E-Mail ergaenzen.
5. Testbuchung anlegen und "Vertrag als PDF herunterladen" pruefen.

Hinweis: Die Teilnahmebedingungen sind eine technische Vorlage und sollten vor echtem oeffentlichem Betrieb juristisch geprueft werden.
