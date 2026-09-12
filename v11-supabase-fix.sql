-- V11: Berechtigungen fuer die oeffentliche Buchungsseite absichern.
-- Kann gefahrlos mehrfach ausgefuehrt werden.

grant usage on schema public to anon, authenticated;
grant select on table public.basare to anon, authenticated;

grant execute on function public.get_basar_availability(bigint) to anon, authenticated;
grant execute on function public.create_buchung(
  bigint, integer, text, boolean, text, text, text, text, text, text, text, text, text
) to anon, authenticated;

alter table public.basare enable row level security;
alter table public.buchungen enable row level security;

drop policy if exists "aktive basare oeffentlich lesbar" on public.basare;
create policy "aktive basare oeffentlich lesbar"
on public.basare
for select
to anon, authenticated
using (aktiv = true);

-- Direkter Zugriff auf Teilnehmer-/Buchungsdaten bleibt fuer anonyme Nutzer gesperrt.
revoke all on table public.buchungen from anon;
