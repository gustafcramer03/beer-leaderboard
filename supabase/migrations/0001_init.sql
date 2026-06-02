-- Holiday Beer Leaderboard — full schema, RLS, triggers, scoring, dark-mode gating.
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Requires: anonymous sign-ins enabled (Auth settings) and the pg_cron + pg_net
-- extensions (enabled near the bottom).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;        -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  created_at    timestamptz not null default now()
);

create table if not exists public.holidays (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 80),
  start_date   date not null,
  end_date     date not null,
  dark_days    int  not null default 2 check (dark_days >= 0),
  admin_id     uuid not null references auth.users(id) on delete cascade,
  invite_code  text not null unique,
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.memberships (
  holiday_id  uuid not null references public.holidays(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (holiday_id, user_id)
);

-- status lifecycle:
--   open       -> full photo taken, awaiting the empty photo (does NOT score)
--   pending    -> complete, awaiting / undergoing peer audit (scores)
--   challenged -> a peer challenged it; escalated to admin (still scores)
--   confirmed  -> admin upheld it (scores)
--   rejected   -> admin rejected it (scores 0)
create table if not exists public.beers (
  id                uuid primary key default gen_random_uuid(),
  holiday_id        uuid not null references public.holidays(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  full_photo_path   text,
  empty_photo_path  text,
  full_taken_at     timestamptz,   -- set by trigger (server clock)
  empty_taken_at    timestamptz,   -- set by trigger (server clock)
  claimed_chug      boolean not null default false,
  status            text not null default 'open'
                    check (status in ('open','pending','challenged','confirmed','rejected')),
  created_at        timestamptz not null default now()
);
create index if not exists beers_holiday_idx on public.beers(holiday_id);
create index if not exists beers_user_idx    on public.beers(user_id);

create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  beer_id      uuid not null references public.beers(id) on delete cascade,
  reviewer_id  uuid not null references auth.users(id) on delete cascade,
  verdict      text not null check (verdict in ('confirm','challenge')),
  created_at   timestamptz not null default now(),
  unique (beer_id, reviewer_id)
);

create table if not exists public.leaderboard_snapshots (
  id            uuid primary key default gen_random_uuid(),
  holiday_id    uuid not null references public.holidays(id) on delete cascade,
  generated_at  timestamptz not null default now(),
  standings     jsonb not null
);
create index if not exists snapshots_holiday_idx
  on public.leaderboard_snapshots(holiday_id, generated_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_member(p_holiday uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.holiday_id = p_holiday and m.user_id = p_user
  );
$$;

create or replace function public.is_admin(p_holiday uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.holidays h
    where h.id = p_holiday and h.admin_id = p_user
  );
$$;

create or replace function public.gen_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no ambiguous chars
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.holidays where invite_code = code);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: server-authoritative timestamps + status guarding
-- ---------------------------------------------------------------------------
create or replace function public.beers_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.full_taken_at  := now();         -- server clock, ignore client value
  new.empty_taken_at := null;
  new.status         := 'open';
  new.empty_photo_path := null;
  return new;
end;
$$;

create or replace function public.beers_before_update()
returns trigger
language plpgsql
as $$
begin
  -- never let the owner rewrite the full timestamp
  new.full_taken_at := old.full_taken_at;

  -- finishing the beer: empty photo added for the first time
  if old.empty_photo_path is null and new.empty_photo_path is not null then
    new.empty_taken_at := now();       -- server clock
    if old.status = 'open' then
      new.status := 'pending';
    end if;
  else
    new.empty_taken_at := old.empty_taken_at;
  end if;

  -- trusted server-side routines (challenge trigger, admin ruling) set this
  -- transaction-local flag and may move status freely.
  if current_setting('app.bypass_beer_guard', true) = '1' then
    return new;
  end if;

  -- owners may not move status into admin/review-controlled states directly;
  -- those transitions happen only via SECURITY DEFINER RPCs below.
  if new.status not in ('open','pending') and new.status is distinct from old.status then
    new.status := old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_beers_before_insert on public.beers;
create trigger trg_beers_before_insert
  before insert on public.beers
  for each row execute function public.beers_before_insert();

drop trigger if exists trg_beers_before_update on public.beers;
create trigger trg_beers_before_update
  before update on public.beers
  for each row execute function public.beers_before_update();

-- A challenge flips the beer to 'challenged' so it surfaces in the admin queue.
create or replace function public.reviews_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verdict = 'challenge' then
    perform set_config('app.bypass_beer_guard', '1', true);
    update public.beers
       set status = 'challenged'
     where id = new.beer_id
       and status = 'pending';   -- don't override an admin ruling
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reviews_after_insert on public.reviews;
create trigger trg_reviews_after_insert
  after insert on public.reviews
  for each row execute function public.reviews_after_insert();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Create a holiday (caller becomes admin + first member) and seed a snapshot.
create or replace function public.create_holiday(
  p_name text, p_start date, p_end date, p_dark_days int
) returns public.holidays
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.holidays(name, start_date, end_date, dark_days, admin_id, invite_code)
  values (p_name, p_start, p_end, greatest(p_dark_days,0), auth.uid(), public.gen_invite_code())
  returning * into h;

  insert into public.memberships(holiday_id, user_id) values (h.id, auth.uid());
  perform public.refresh_snapshot(h.id);
  return h;
end;
$$;

-- Join a holiday by invite code.
create or replace function public.join_holiday(p_code text)
returns public.holidays
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into h from public.holidays
   where invite_code = upper(trim(p_code));
  if not found then
    raise exception 'invalid invite code';
  end if;
  insert into public.memberships(holiday_id, user_id)
  values (h.id, auth.uid())
  on conflict do nothing;
  return h;
end;
$$;

-- Submit a peer review (confirm/challenge). Reviewer must be a member and not the owner.
create or replace function public.submit_review(p_beer uuid, p_verdict text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
begin
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if b.user_id = auth.uid() then raise exception 'cannot review your own beer'; end if;
  if not public.is_member(b.holiday_id, auth.uid()) then raise exception 'not a member'; end if;
  if p_verdict not in ('confirm','challenge') then raise exception 'bad verdict'; end if;

  insert into public.reviews(beer_id, reviewer_id, verdict)
  values (p_beer, auth.uid(), p_verdict)
  on conflict (beer_id, reviewer_id) do update set verdict = excluded.verdict;
end;
$$;

-- Admin upholds or rejects a challenged beer.
create or replace function public.admin_rule_beer(p_beer uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
begin
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if not public.is_admin(b.holiday_id, auth.uid()) then raise exception 'admin only'; end if;
  if p_decision not in ('confirm','reject') then raise exception 'bad decision'; end if;

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set status = case when p_decision = 'confirm' then 'confirmed' else 'rejected' end
   where id = p_beer;
end;
$$;

-- The audit queue: complete beers by OTHER members in this holiday that the
-- caller has not yet reviewed. Returns photo storage paths (client signs URLs).
create or replace function public.audit_queue(p_holiday uuid)
returns table (
  beer_id uuid,
  owner_name text,
  full_photo_path text,
  empty_photo_path text,
  full_taken_at timestamptz,
  empty_taken_at timestamptz,
  claimed_chug boolean
)
language sql
security definer
set search_path = public
as $$
  select b.id, p.display_name, b.full_photo_path, b.empty_photo_path,
         b.full_taken_at, b.empty_taken_at, b.claimed_chug
    from public.beers b
    join public.profiles p on p.id = b.user_id
   where b.holiday_id = p_holiday
     and b.user_id <> auth.uid()
     and b.status in ('pending','challenged')
     and b.empty_photo_path is not null
     and public.is_member(p_holiday, auth.uid())
     and not exists (
       select 1 from public.reviews r
       where r.beer_id = b.id and r.reviewer_id = auth.uid()
     )
   order by b.empty_taken_at asc;
$$;

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
-- Points per beer = greatest(streak position, chug bonus).
--   * base                  = 1
--   * chug (<=60s or claimed)= 3
--   * streak: beers whose empty_taken_at is within 5 min of the previous
--     scoring beer's empty_taken_at extend a run; position 1,2,3,... = points.
-- Rejected and still-open beers are excluded.
create or replace function public.compute_standings(p_holiday uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with scored as (
    select b.user_id,
           b.empty_taken_at,
           greatest(
             row_number() over (
               partition by b.user_id, grp order by b.empty_taken_at
             ),
             case when b.claimed_chug
                       or (b.empty_taken_at - b.full_taken_at) <= interval '60 seconds'
                  then 3 else 1 end
           ) as points
    from (
      select b.*,
             sum(case when prev_empty is null
                        or b.empty_taken_at - prev_empty > interval '5 minutes'
                      then 1 else 0 end)
               over (partition by b.user_id order by b.empty_taken_at) as grp
      from (
        select b.*,
               lag(b.empty_taken_at) over (
                 partition by b.user_id order by b.empty_taken_at
               ) as prev_empty
        from public.beers b
        where b.holiday_id = p_holiday
          and b.status in ('pending','challenged','confirmed')
          and b.empty_taken_at is not null
      ) b
    ) b
  ),
  totals as (
    select s.user_id,
           coalesce(sum(s.points),0)::int as points,
           count(*)::int as beer_count
    from scored s
    group by s.user_id
  ),
  everyone as (
    select m.user_id, pr.display_name,
           coalesce(t.points,0) as points,
           coalesce(t.beer_count,0) as beer_count
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    left join totals t on t.user_id = m.user_id
    where m.holiday_id = p_holiday
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'user_id', user_id,
             'display_name', display_name,
             'points', points,
             'beer_count', beer_count
           ) order by points desc, beer_count desc, display_name asc
         ), '[]'::jsonb)
  from everyone;
$$;

-- Write a fresh snapshot (used by cron and on holiday creation).
create or replace function public.refresh_snapshot(p_holiday uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.leaderboard_snapshots(holiday_id, standings)
  values (p_holiday, public.compute_standings(p_holiday));
end;
$$;

-- Read the latest standings WITH dark-mode gating.
-- Returns { state, is_admin, generated_at, standings }.
--   state = 'live'   -> normal hourly board
--           'dark'   -> last N days; standings hidden (null) for non-admins
--           'reveal' -> final day onward; standings shown to everyone
create or replace function public.get_latest_standings(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_state text;
  v_admin boolean;
  v_snap public.leaderboard_snapshots;
  v_show boolean;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_admin := (h.admin_id = auth.uid());

  if current_date >= h.end_date then
    v_state := 'reveal';
  elsif current_date >= (h.end_date - h.dark_days) then
    v_state := 'dark';
  else
    v_state := 'live';
  end if;

  v_show := (v_state <> 'dark') or v_admin;

  select * into v_snap from public.leaderboard_snapshots
   where holiday_id = p_holiday
   order by generated_at desc limit 1;

  return jsonb_build_object(
    'state', v_state,
    'is_admin', v_admin,
    'generated_at', v_snap.generated_at,
    'standings', case when v_show then coalesce(v_snap.standings, '[]'::jsonb) else null end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.holidays               enable row level security;
alter table public.memberships            enable row level security;
alter table public.beers                  enable row level security;
alter table public.reviews                enable row level security;
alter table public.leaderboard_snapshots  enable row level security;

-- profiles: readable by any authenticated user; you manage your own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- holidays: members can read; anyone authenticated can create (admin = self).
drop policy if exists holidays_select on public.holidays;
create policy holidays_select on public.holidays
  for select to authenticated using (public.is_member(id, auth.uid()));
drop policy if exists holidays_insert on public.holidays;
create policy holidays_insert on public.holidays
  for insert to authenticated with check (admin_id = auth.uid());

-- memberships: members of a holiday can see its roster; rows are created by RPCs.
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated using (public.is_member(holiday_id, auth.uid()));

-- beers: members can read all beers in their holiday; owner inserts/updates own.
drop policy if exists beers_select on public.beers;
create policy beers_select on public.beers
  for select to authenticated using (public.is_member(holiday_id, auth.uid()));
drop policy if exists beers_insert on public.beers;
create policy beers_insert on public.beers
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(holiday_id, auth.uid()));
drop policy if exists beers_update on public.beers;
create policy beers_update on public.beers
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reviews: members read reviews in their holiday; rows created via submit_review RPC.
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated using (
    exists (
      select 1 from public.beers b
      where b.id = reviews.beer_id and public.is_member(b.holiday_id, auth.uid())
    )
  );

-- snapshots: no direct client reads; access only through get_latest_standings().
-- (RLS enabled with no SELECT policy = denied for anon/authenticated.)

-- ---------------------------------------------------------------------------
-- Grants (RPCs are SECURITY DEFINER; allow authenticated users to call them)
-- ---------------------------------------------------------------------------
grant execute on function public.create_holiday(text,date,date,int)  to authenticated;
grant execute on function public.join_holiday(text)                  to authenticated;
grant execute on function public.submit_review(uuid,text)            to authenticated;
grant execute on function public.admin_rule_beer(uuid,text)          to authenticated;
grant execute on function public.audit_queue(uuid)                   to authenticated;
grant execute on function public.get_latest_standings(uuid)          to authenticated;
grant execute on function public.refresh_snapshot(uuid)              to authenticated;

-- ---------------------------------------------------------------------------
-- Hourly snapshot via pg_cron (enable pg_cron in Database > Extensions first)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function public.refresh_all_active_snapshots()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in
    select id from public.holidays
    where current_date <= end_date  -- still running (incl. reveal day)
  loop
    perform public.refresh_snapshot(r.id);
  end loop;
end;
$$;

-- Schedule hourly (idempotent: unschedule a prior job of the same name first).
do $$
begin
  perform cron.unschedule('hourly_beer_snapshots')
    where exists (select 1 from cron.job where jobname = 'hourly_beer_snapshots');
exception when others then null;
end $$;

select cron.schedule('hourly_beer_snapshots', '0 * * * *',
  $$select public.refresh_all_active_snapshots();$$);
