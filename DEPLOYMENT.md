# Basar Tischbörse - Deployment

## GitHub Pages

Dieses Projekt ist als statische Website für GitHub Pages vorbereitet.

1. Dateien im Repository ersetzen/hochladen.
2. Unter **Settings -> Pages** muss als Quelle der Branch `main` und der Ordner `/ (root)` ausgewählt sein.
3. Danach die veröffentlichte URL öffnen.

## Supabase

Die Website nutzt Supabase für Authentifizierung, Basare und Buchungen. Der Browser verwendet ausschließlich die Project URL und den Publishable Key. Secret Keys gehören niemals in diese Dateien.

## Admin-Verwaltung

Der Veranstalterbereich benötigt ein Supabase-Auth-Konto, das in `public.admins` eingetragen ist. RLS bleibt aktiv.

## Aktuelle V3-Funktionen

- geschützter Veranstalter-Login
- mehrere Basare anzeigen und auswählen
- neuen Basar anlegen
- bestehenden Basar bearbeiten
- Basare aktiv/inaktiv schalten
- Buchungen öffnen und vollständige Teilnehmerdaten sehen
- Buchungen filtern
- Zahlung als bezahlt/offen markieren
- Buchungen stornieren
