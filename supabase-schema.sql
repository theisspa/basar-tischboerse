-- Basar Tischbörse: Datenmodell für den Onlinebetrieb mit Supabase/PostgreSQL
create table if not exists organizers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references organizers(id) on delete cascade,
  name text not null,
  event_date date not null,
  location text not null,
  total_tables integer not null check (total_tables > 0),
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  booking_number text unique not null,
  event_id uuid not null references events(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  street text not null,
  house_number text not null,
  postal_code text not null,
  city text not null,
  email text not null,
  phone text not null,
  tables_count integer not null check (tables_count between 1 and 3),
  category text not null check (category in ('Kinder','Erwachsene')),
  cake_donation boolean not null default false,
  base_price numeric(10,2) not null,
  discount numeric(10,2) not null default 0,
  total_price numeric(10,2) not null,
  payment_method text not null check (payment_method in ('paypal','transfer')),
  payment_status text not null default 'open' check (payment_status in ('open','paid','cancelled')),
  cake_status text not null default 'pending' check (cake_status in ('pending','received','missing')),
  created_at timestamptz not null default now(),
  payment_due_at timestamptz,
  contract_version text not null default '1.0'
);

create index if not exists bookings_event_id_idx on bookings(event_id);
create index if not exists bookings_email_idx on bookings(email);

-- Für die verbindliche Überbuchungssperre sollte die Buchung serverseitig
-- transaktional erfolgen (nicht ausschließlich im Browser).
