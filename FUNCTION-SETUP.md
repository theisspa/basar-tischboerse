# V13 – Automatische E-Mails

V13 nutzt eine Supabase Edge Function und Brevo fuer Transaktions-E-Mails.

## 1. Brevo

1. Kostenloses Konto bei https://www.brevo.com/ anlegen.
2. Unter **Transactional > Settings > Senders & IP** einen Absender anlegen.
3. Die Absender-E-Mail verifizieren (Brevo sendet einen Code an diese Adresse).
4. Unter **SMTP & API > API Keys** einen neuen API-Key erstellen und kopieren.

Hinweis: Eine kostenlose Gmail-/Outlook-Adresse kann als verifizierter Absender genutzt werden; Brevo kann die technische Absenderadresse aus Zustellbarkeitsgruenden umschreiben. Fuer eine professionelle Absenderadresse ist spaeter eine eigene Domain empfehlenswert.

## 2. Supabase Secret-Variablen

Im Supabase-Projekt zu **Edge Functions > Secrets** gehen und anlegen:

- `BREVO_API_KEY` = dein Brevo API-Key
- `BREVO_SENDER_EMAIL` = die bei Brevo verifizierte Absender-E-Mail
- `BREVO_SENDER_NAME` = z. B. `Basar Tischbörse`

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase fuer Edge Functions automatisch bereit.

## 3. Edge Function erstellen

Supabase > **Edge Functions** > **Deploy a new function** / **Create function**.

Name: `send-booking-email`

Den kompletten Inhalt aus
`supabase/functions/send-booking-email/index.ts`
in den Editor kopieren und deployen.

Wichtig: Fuer diese Funktion **JWT-Verifizierung deaktivieren** (`verify_jwt = false`). Die Funktion ist trotzdem geschuetzt, weil sie fuer jede Buchung ein zufaelliges `email_token` prueft und bereits versendete Buchungen nicht erneut verschickt.

## 4. Datenbank

`v13-migration.sql` einmal im Supabase SQL Editor ausfuehren.

## 5. Website

Die V13-Dateien zu GitHub hochladen. Anschliessend eine Testbuchung mit einer echten E-Mail-Adresse machen.

Nach der Buchung sollte auf der Erfolgsseite `Buchungsbestätigung wurde per E-Mail versendet.` erscheinen. Im Admin-Popup wird der E-Mail-Status angezeigt.
