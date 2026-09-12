-- ============================================================
-- BASAR-TISCHBOERSE V12 - Veranstalterprofile + Vertragslogik
-- Einmal in Supabase > SQL Editor ausfuehren.
-- ============================================================

-- 1) Veranstalterprofil
create table if not exists public.veranstalter (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  strasse text not null,
  hausnummer text not null,
  plz text not null,
  ort text not null,
  telefon text,
  email text not null,
  iban text,
  kontoinhaber text,
  paypal_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.veranstalter enable row level security;
grant select, insert, update on public.veranstalter to authenticated;

drop policy if exists "Veranstalter sieht eigenes Profil" on public.veranstalter;
create policy "Veranstalter sieht eigenes Profil"
on public.veranstalter for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Veranstalter legt eigenes Profil an" on public.veranstalter;
create policy "Veranstalter legt eigenes Profil an"
on public.veranstalter for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Veranstalter aendert eigenes Profil" on public.veranstalter;
create policy "Veranstalter aendert eigenes Profil"
on public.veranstalter for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Bestehenden Veranstalter anlegen/aktualisieren
insert into public.veranstalter (
  user_id, name, strasse, hausnummer, plz, ort, telefon, email
) values (
  '2d9bea72-4c1a-4257-b3fb-4b25d59866e6',
  'Pascal Theiss',
  'Burgstr',
  '26',
  '67677',
  'Enkenbach-Alsenborn',
  '017680288516',
  'theiss.handy@gmail.com'
)
on conflict (user_id) do update set
  name = excluded.name,
  strasse = excluded.strasse,
  hausnummer = excluded.hausnummer,
  plz = excluded.plz,
  ort = excluded.ort,
  telefon = excluded.telefon,
  email = excluded.email,
  updated_at = now();

-- 2) Jeder Basar gehoert einem Veranstalter
alter table public.basare add column if not exists veranstalter_id uuid;

update public.basare
set veranstalter_id = '2d9bea72-4c1a-4257-b3fb-4b25d59866e6'
where veranstalter_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'basare_veranstalter_id_fkey'
  ) then
    alter table public.basare
      add constraint basare_veranstalter_id_fkey
      foreign key (veranstalter_id) references public.veranstalter(user_id) on delete restrict;
  end if;
end $$;

alter table public.basare alter column veranstalter_id set not null;

-- Adminzugriff pro Veranstalter
grant select, insert, update, delete on public.basare to authenticated;
grant select, update on public.buchungen to authenticated;
grant usage, select on sequence public.basare_id_seq to authenticated;

drop policy if exists "Admins verwalten Basare" on public.basare;
drop policy if exists "Veranstalter verwaltet eigene Basare" on public.basare;
create policy "Veranstalter verwaltet eigene Basare"
on public.basare for all to authenticated
using (veranstalter_id = auth.uid())
with check (veranstalter_id = auth.uid());

drop policy if exists "Admins verwalten Buchungen" on public.buchungen;
drop policy if exists "Veranstalter verwaltet eigene Buchungen" on public.buchungen;
create policy "Veranstalter verwaltet eigene Buchungen"
on public.buchungen for all to authenticated
using (
  exists (
    select 1 from public.basare b
    where b.id = buchungen.basar_id
      and b.veranstalter_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.basare b
    where b.id = buchungen.basar_id
      and b.veranstalter_id = auth.uid()
  )
);

-- 3) Status "abgelaufen" ergaenzen
alter table public.buchungen drop constraint if exists buchungen_zahlungsstatus_check;
alter table public.buchungen
  add constraint buchungen_zahlungsstatus_check
  check (zahlungsstatus in ('offen', 'bezahlt', 'storniert', 'abgelaufen'));

-- 4) Trigger: Preis + Kapazitaet sauber pruefen
create or replace function public.pruefe_buchung()
returns trigger
language plpgsql
as $$
declare
  grundpreis numeric(10,2);
  erwarteter_preis numeric(10,2);
  bereits_belegte_tische integer;
  maximale_tische integer;
  basar_aktiv boolean;
begin
  grundpreis := case new.anzahl_tische when 1 then 12.00 when 2 then 20.00 when 3 then 25.00 end;
  erwarteter_preis := grundpreis - case when new.kuchenspende then 4.00 else 0.00 end;

  if new.preis <> erwarteter_preis then
    raise exception 'Ungueltiger Buchungspreis';
  end if;

  select max_tische, aktiv
  into maximale_tische, basar_aktiv
  from public.basare
  where id = new.basar_id;

  if maximale_tische is null then
    raise exception 'Basar nicht gefunden';
  end if;

  if tg_op = 'INSERT' and not basar_aktiv then
    raise exception 'Basar ist nicht aktiv';
  end if;

  -- Nur Buchungen, die einen Tisch wirklich blockieren, muessen Kapazitaet haben.
  if new.zahlungsstatus in ('offen', 'bezahlt') then
    select coalesce(sum(anzahl_tische), 0)
    into bereits_belegte_tische
    from public.buchungen
    where basar_id = new.basar_id
      and zahlungsstatus in ('offen', 'bezahlt')
      and id is distinct from new.id;

    if bereits_belegte_tische + new.anzahl_tische > maximale_tische then
      raise exception 'Nicht genuegend freie Tische vorhanden';
    end if;
  end if;

  return new;
end;
$$;

-- 5) Verfuegbarkeit: ueberfaellige offene Reservierungen geben Tische frei
create or replace function public.get_basar_availability(p_basar_id bigint)
returns table(total_tables integer, booked_tables integer, free_tables integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.buchungen
  set zahlungsstatus = 'abgelaufen'
  where basar_id = p_basar_id
    and zahlungsstatus = 'offen'
    and zahlungsfrist < current_date;

  return query
  select b.max_tische::integer,
         coalesce(sum(case when bu.zahlungsstatus in ('offen','bezahlt') then bu.anzahl_tische else 0 end),0)::integer,
         greatest(
           b.max_tische - coalesce(sum(case when bu.zahlungsstatus in ('offen','bezahlt') then bu.anzahl_tische else 0 end),0),
           0
         )::integer
  from public.basare b
  left join public.buchungen bu on bu.basar_id = b.id
  where b.id = p_basar_id and b.aktiv = true
  group by b.id, b.max_tische;
end;
$$;

grant execute on function public.get_basar_availability(bigint) to anon, authenticated;

-- 6) Buchung mit 14-/3-Tage-Zahlungslogik + Vertragsdaten
-- Alte Funktion mit identischer Signatur wird ersetzt.
create or replace function public.create_buchung(
  p_basar_id bigint,
  p_anzahl_tische integer,
  p_verkaufsbereich text,
  p_kuchenspende boolean,
  p_vorname text,
  p_nachname text,
  p_strasse text,
  p_hausnummer text,
  p_plz text,
  p_ort text,
  p_email text,
  p_telefon text,
  p_zahlungsart text
)
returns table(
  buchung_id bigint,
  buchungsnummer text,
  preis numeric,
  zahlungsfrist date,
  buchungsdatum date,
  stornierbar_bis date,
  basar_name text,
  basar_ort text,
  veranstaltungsdatum date,
  veranstalter_name text,
  veranstalter_strasse text,
  veranstalter_hausnummer text,
  veranstalter_plz text,
  veranstalter_ort text,
  veranstalter_telefon text,
  veranstalter_email text,
  veranstalter_iban text,
  veranstalter_kontoinhaber text,
  veranstalter_paypal_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  grundpreis numeric(10,2);
  finalpreis numeric(10,2);
  v_buchungsnummer text;
  v_buchung_id bigint;
  v_event_date date;
  v_deadline date;
  v_basar_name text;
  v_basar_ort text;
  v_veranstalter_id uuid;
  v_veranstalter public.veranstalter%rowtype;
begin
  if p_anzahl_tische not between 1 and 3 then
    raise exception 'Ungueltige Tischanzahl';
  end if;
  if p_verkaufsbereich not in ('kinder','erwachsene') then
    raise exception 'Ungueltiger Verkaufsbereich';
  end if;
  if p_zahlungsart not in ('paypal','ueberweisung') then
    raise exception 'Ungueltige Zahlungsart';
  end if;

  select b.veranstaltungsdatum, b.name, b.ort, b.veranstalter_id
  into v_event_date, v_basar_name, v_basar_ort, v_veranstalter_id
  from public.basare b
  where b.id = p_basar_id and b.aktiv = true
  for update;

  if v_event_date is null then
    raise exception 'Basar nicht gefunden oder nicht aktiv';
  end if;
  if v_event_date < current_date then
    raise exception 'Der Basartermin ist bereits vorbei';
  end if;

  select * into v_veranstalter
  from public.veranstalter v
  where v.user_id = v_veranstalter_id;

  if v_veranstalter.user_id is null then
    raise exception 'Veranstalterdaten fehlen';
  end if;

  grundpreis := case p_anzahl_tische when 1 then 12.00 when 2 then 20.00 when 3 then 25.00 end;
  finalpreis := grundpreis - case when p_kuchenspende then 4.00 else 0.00 end;

  -- Mindestens 14 Tage bis zum Termin: 14 Tage Zahlungsfrist.
  -- Weniger als 14 Tage: 3 Tage, aber niemals nach dem Veranstaltungstag.
  if v_event_date >= current_date + 14 then
    v_deadline := current_date + 14;
  else
    v_deadline := least(current_date + 3, v_event_date);
  end if;

  v_buchungsnummer := 'B-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.buchungsnummer_seq')::text, 6, '0');

  insert into public.buchungen (
    basar_id, buchungsnummer, anzahl_tische, verkaufsbereich, kuchenspende, preis,
    vorname, nachname, strasse, hausnummer, plz, ort, email, telefon,
    zahlungsart, zahlungsstatus, zahlungsfrist
  ) values (
    p_basar_id, v_buchungsnummer, p_anzahl_tische, p_verkaufsbereich, p_kuchenspende, finalpreis,
    trim(p_vorname), trim(p_nachname), trim(p_strasse), trim(p_hausnummer), trim(p_plz), trim(p_ort), lower(trim(p_email)), nullif(trim(p_telefon), ''),
    p_zahlungsart, 'offen', v_deadline
  ) returning id into v_buchung_id;

  return query select
    v_buchung_id,
    v_buchungsnummer,
    finalpreis,
    v_deadline,
    current_date,
    v_event_date - 14,
    v_basar_name,
    v_basar_ort,
    v_event_date,
    v_veranstalter.name,
    v_veranstalter.strasse,
    v_veranstalter.hausnummer,
    v_veranstalter.plz,
    v_veranstalter.ort,
    v_veranstalter.telefon,
    v_veranstalter.email,
    v_veranstalter.iban,
    v_veranstalter.kontoinhaber,
    v_veranstalter.paypal_email;
end;
$$;

grant execute on function public.create_buchung(bigint, integer, text, boolean, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- 7) Sicherheit: direkte Buchungsdaten bleiben nicht oeffentlich lesbar.
-- Die bestehende Policy "aktive basare oeffentlich lesbar" bleibt bestehen.
