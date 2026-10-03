-- Marin Hive Tracker — database schema
--
-- Run this whole file once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to re-run; it drops and recreates policies, functions and triggers.
--
-- Privacy model:
--   * Anyone can sign up, but a new account is "pending" until an admin approves it.
--   * Approved members can read and write only their own apiaries, hives and records.
--   * Admins can read every member's records (but not edit them) and approve members.
--   * Club-wide totals are exposed only through club_stats(), which never returns
--     names, locations or individual records.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'member' check (role in ('member', 'admin')),
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.apiaries (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null,
  location    text,            -- free text, e.g. "Backyard, San Anselmo"
  town        text,            -- used only for club-wide counts by town
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.hives (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  apiary_id       uuid references public.apiaries (id) on delete set null,
  name            text not null,
  hive_type       text not null default 'Langstroth',
  bee_species     text,         -- e.g. Italian, Carniolan, local survivor stock
  status          text not null default 'active'
                  check (status in ('active', 'dead', 'swarmed', 'combined', 'sold')),
  established_on  date,
  ended_on        date,         -- set when status leaves 'active'
  queen_source    text,
  queen_year      int,
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists public.inspections (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  hive_id         uuid not null references public.hives (id) on delete cascade,
  inspected_on    date not null default current_date,
  inspected_at    time,         -- time of day (local)
  temp_f          numeric(5, 1),
  humidity        int check (humidity between 0 and 100),
  wind_mph        numeric(5, 1) check (wind_mph >= 0),
  conditions      text,         -- e.g. "Partly cloudy"; auto-filled from Open-Meteo
  queen_seen      boolean,
  eggs_seen       boolean,
  queen_cells     boolean,
  brood_pattern   text check (brood_pattern in ('excellent', 'good', 'spotty', 'none')),
  temperament     text check (temperament in ('calm', 'nervous', 'aggressive')),
  frames_bees     int check (frames_bees >= 0),
  frames_brood    int check (frames_brood >= 0),
  frames_honey    int check (frames_honey >= 0),
  disease_signs   text,
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists public.mite_counts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  hive_id       uuid not null references public.hives (id) on delete cascade,
  counted_on    date not null default current_date,
  method        text not null
                check (method in ('alcohol wash', 'sugar roll', 'CO2', 'sticky board')),
  bees_sampled  int check (bees_sampled > 0),   -- wash/roll/CO2: usually ~300 (½ cup)
  mites         int not null check (mites >= 0),
  board_days    int check (board_days > 0),     -- sticky board: days in place
  notes         text,
  created_at    timestamptz not null default now(),
  -- Wash/roll/CO2 need a sample size; a sticky board needs a duration.
  constraint mite_sample_shape check (
    (method = 'sticky board' and board_days is not null)
    or (method <> 'sticky board' and bees_sampled is not null)
  )
);

create table if not exists public.treatments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  hive_id     uuid not null references public.hives (id) on delete cascade,
  product     text not null,      -- e.g. "Oxalic acid (vapor)", "Apivar"
  started_on  date not null default current_date,
  ended_on    date,
  dose        text,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.feedings (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  hive_id     uuid not null references public.hives (id) on delete cascade,
  fed_on      date not null default current_date,
  feed        text not null,      -- e.g. "1:1 syrup", "pollen patty"
  amount      text,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.harvests (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  hive_id       uuid not null references public.hives (id) on delete cascade,
  harvested_on  date not null default current_date,
  honey_lbs     numeric(7, 2) check (honey_lbs >= 0),
  frames        int check (frames >= 0),
  notes         text,
  created_at    timestamptz not null default now()
);

-- Columns added after the first release (create table above won't add them to existing tables).
alter table public.hives add column if not exists bee_species text;
alter table public.inspections add column if not exists inspected_at time;
alter table public.inspections add column if not exists temp_f numeric(5, 1);
alter table public.inspections add column if not exists humidity int check (humidity between 0 and 100);
alter table public.inspections add column if not exists wind_mph numeric(5, 1) check (wind_mph >= 0);
alter table public.inspections add column if not exists conditions text;

create index if not exists apiaries_owner_idx    on public.apiaries (owner_id);
create index if not exists hives_owner_idx       on public.hives (owner_id);
create index if not exists inspections_hive_idx  on public.inspections (hive_id, inspected_on desc);
create index if not exists mite_counts_hive_idx  on public.mite_counts (hive_id, counted_on desc);
create index if not exists treatments_hive_idx   on public.treatments (hive_id, started_on desc);
create index if not exists feedings_hive_idx     on public.feedings (hive_id, fed_on desc);
create index if not exists harvests_hive_idx     on public.harvests (hive_id, harvested_on desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- security definer so policies can check the caller's profile without recursing
-- through the profiles table's own policies.
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select approved and role = 'admin' from public.profiles where id = auth.uid()),
    false);
$$;

-- Mites per 100 bees for wash/roll/CO2; mites per day for sticky boards.
create or replace function public.mite_rate(m public.mite_counts) returns numeric
language sql immutable as $$
  select case
    when m.method = 'sticky board' then round(m.mites::numeric / m.board_days, 1)
    else round(m.mites::numeric * 100 / m.bees_sampled, 1)
  end;
$$;

-- ---------------------------------------------------------------------------
-- New-user profile + guard rails
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Members may rename themselves, but only admins may change role/approval.
-- The SQL editor (no auth.uid()) is allowed so the first admin can be bootstrapped.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.approved is distinct from old.approved
      or new.email is distinct from old.email or new.id is distinct from old.id)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only club admins can change membership status';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- A record's hive (and a hive's apiary) must belong to the same member.
create or replace function public.check_hive_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.hives where id = new.hive_id and owner_id = new.owner_id) then
    raise exception 'Hive not found';
  end if;
  return new;
end;
$$;

create or replace function public.check_apiary_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.apiary_id is not null and not exists (
    select 1 from public.apiaries where id = new.apiary_id and owner_id = new.owner_id) then
    raise exception 'Apiary not found';
  end if;
  return new;
end;
$$;

drop trigger if exists check_apiary_owner on public.hives;
create trigger check_apiary_owner before insert or update on public.hives
  for each row execute function public.check_apiary_owner();

do $$
declare t text;
begin
  foreach t in array array['inspections', 'mite_counts', 'treatments', 'feedings', 'harvests'] loop
    execute format('drop trigger if exists check_hive_owner on public.%I', t);
    execute format('create trigger check_hive_owner before insert or update on public.%I
                    for each row execute function public.check_hive_owner()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "read own profile or admin" on public.profiles;
create policy "read own profile or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "update own profile or admin" on public.profiles;
create policy "update own profile or admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

drop policy if exists "admin deletes profiles" on public.profiles;
create policy "admin deletes profiles" on public.profiles
  for delete using (public.is_admin() and id <> auth.uid());

-- Same four policies on every member-owned table.
do $$
declare t text;
begin
  foreach t in array array['apiaries', 'hives', 'inspections', 'mite_counts',
                           'treatments', 'feedings', 'harvests'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "read own or admin" on public.%I', t);
    execute format('create policy "read own or admin" on public.%I for select
                    using ((owner_id = auth.uid() and public.is_approved()) or public.is_admin())', t);

    execute format('drop policy if exists "insert own" on public.%I', t);
    execute format('create policy "insert own" on public.%I for insert
                    with check (owner_id = auth.uid() and public.is_approved())', t);

    execute format('drop policy if exists "update own" on public.%I', t);
    execute format('create policy "update own" on public.%I for update
                    using (owner_id = auth.uid() and public.is_approved())
                    with check (owner_id = auth.uid())', t);

    execute format('drop policy if exists "delete own" on public.%I', t);
    execute format('create policy "delete own" on public.%I for delete
                    using (owner_id = auth.uid() and public.is_approved())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Club-wide statistics (aggregates only; no names or locations)
-- ---------------------------------------------------------------------------

create or replace function public.club_stats(p_year int default extract(year from current_date)::int)
returns json
language plpgsql stable security definer set search_path = public as $$
declare result json;
begin
  if not public.is_approved() then
    raise exception 'Membership not yet approved';
  end if;

  select json_build_object(
    'year', p_year,
    'members', (select count(*) from profiles where approved),
    'active_hives', (select count(*) from hives where status = 'active'),
    'hives_by_type', (
      select coalesce(json_object_agg(hive_type, n), '{}'::json)
      from (select hive_type, count(*) n from hives where status = 'active' group by hive_type) s),
    'hives_by_species', (
      select coalesce(json_object_agg(species, n), '{}'::json)
      from (select coalesce(nullif(trim(bee_species), ''), 'Unspecified') species, count(*) n
            from hives where status = 'active' group by 1) s),
    'hives_by_town', (
      select coalesce(json_object_agg(town, n), '{}'::json)
      from (select coalesce(nullif(trim(a.town), ''), 'Unspecified') town, count(*) n
            from hives h left join apiaries a on a.id = h.apiary_id
            where h.status = 'active' group by 1) s),
    'losses', (
      select count(*) from hives
      where status in ('dead', 'swarmed')
        and extract(year from coalesce(ended_on, created_at::date)) = p_year),
    'honey_lbs', (
      select coalesce(sum(honey_lbs), 0) from harvests
      where extract(year from harvested_on) = p_year),
    'inspections', (
      select count(*) from inspections where extract(year from inspected_on) = p_year),
    -- Monthly mite load from wash/roll/CO2 samples (mites per 100 bees).
    'mites_by_month', (
      select coalesce(json_agg(json_build_object(
               'month', mon, 'samples', samples, 'avg_per_100', avg_rate,
               'over_threshold', over_n) order by mon), '[]'::json)
      from (select extract(month from counted_on)::int mon,
                   count(*) samples,
                   round(avg(mite_rate(m)), 1) avg_rate,
                   count(*) filter (where mite_rate(m) >= 3) over_n
            from mite_counts m
            where method <> 'sticky board' and extract(year from counted_on) = p_year
            group by 1) s)
  ) into result;

  return result;
end;
$$;

-- Supabase grants these by default; repeated here so the schema doesn't depend on it.
-- Row-level security above decides which rows each member can actually touch.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.club_stats(int) to authenticated;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.is_admin() to authenticated;
