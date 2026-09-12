-- ============================================================
-- BASAR TISCHBOERSE - V13 E-MAIL-VERSAND
-- Erst nach erfolgreicher V12-Migration ausfuehren.
-- ============================================================

-- E-Mail-Status und ein nicht erratbares Einmal-Token fuer den Versand.
alter table public.buchungen add column if not exists email_token uuid not null default gen_random_uuid();
alter table public.buchungen add column if not exists email_status text not null default 'pending';
alter table public.buchungen add column if not exists email_sent_at timestamptz;
alter table public.buchungen add column if not exists email_last_error text;
alter table public.buchungen add column if not exists veranstalter_email_status text not null default 'pending';
alter table public.buchungen add column if not exists veranstalter_email_sent_at timestamptz;
alter table public.buchungen add column if not exists veranstalter_email_last_error text;

alter table public.buchungen drop constraint if exists buchungen_email_status_check;
alter table public.buchungen
  add constraint buchungen_email_status_check
  check (email_status in ('pending','sending','sent','error'));

alter table public.buchungen drop constraint if exists buchungen_veranstalter_email_status_check;
alter table public.buchungen
  add constraint buchungen_veranstalter_email_status_check
  check (veranstalter_email_status in ('pending','sending','sent','error'));

-- Die oeffentliche Buchungsfunktion liefert nun zusaetzlich email_token zurueck.
-- Dieses Token ist nur fuer den direkten Versand dieser einen Buchung verwendbar.
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
  veranstalter_paypal_email text,
  email_token uuid
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
  v_email_token uuid;
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

  if v_event_date >= current_date + 14 then
    v_deadline := current_date + 14;
  else
    v_deadline := least(current_date + 3, v_event_date);
  end if;

  v_buchungsnummer := 'B-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.buchungsnummer_seq')::text, 6, '0');
  v_email_token := gen_random_uuid();

  insert into public.buchungen (
    basar_id, buchungsnummer, anzahl_tische, verkaufsbereich, kuchenspende, preis,
    vorname, nachname, strasse, hausnummer, plz, ort, email, telefon,
    zahlungsart, zahlungsstatus, zahlungsfrist,
    email_token, email_status, veranstalter_email_status
  ) values (
    p_basar_id, v_buchungsnummer, p_anzahl_tische, p_verkaufsbereich, p_kuchenspende, finalpreis,
    trim(p_vorname), trim(p_nachname), trim(p_strasse), trim(p_hausnummer), trim(p_plz), trim(p_ort), lower(trim(p_email)), nullif(trim(p_telefon), ''),
    p_zahlungsart, 'offen', v_deadline,
    v_email_token, 'pending', 'pending'
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
    v_veranstalter.paypal_email,
    v_email_token;
end;
$$;

grant execute on function public.create_buchung(bigint, integer, text, boolean, text, text, text, text, text, text, text, text, text) to anon, authenticated;
