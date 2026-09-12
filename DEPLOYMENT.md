# Kostenloser Onlinebetrieb – Zielarchitektur

## Ziel
Die Plattform soll ohne feste monatliche Hostingkosten betrieben werden. Kosten können trotzdem durch eine eigene Domain, PayPal-Transaktionsgebühren oder bezahlte Zusatzdienste entstehen.

## Komponenten
1. Frontend: statische HTML/CSS/JS-Seite, später als React/Vite oder ähnlich ausbaubar.
2. Hosting: kostenloser Static-Hosting-Tarif (z. B. Netlify oder Cloudflare Pages).
3. Datenbank/Auth: Supabase Free.
4. Zahlungsabwicklung: PayPal + Überweisung.
5. E-Mail: zunächst transaktionaler Dienst mit kostenlosem Einstiegsvolumen oder über vorhandene Mailinfrastruktur.
6. Vertrags-PDF: serverseitige PDF-Erzeugung.

## Wichtig
Die Tischbegrenzung darf im finalen System nicht nur im Browser geprüft werden. Die Buchung muss in der Datenbank transaktional geprüft und gespeichert werden, damit zwei gleichzeitige Buchungen nicht dieselben letzten Tische reservieren.
