-- Einmalig in Supabase SQL Editor ausfuehren.
insert into public.basare (name, ort, veranstaltungsdatum, max_tische, aktiv)
select 'Sommerbasar Alsenborn', 'Bürgerhaus Alsenborn', date '2026-10-10', 50, true
where not exists (
  select 1 from public.basare where name = 'Sommerbasar Alsenborn' and veranstaltungsdatum = date '2026-10-10'
);
