-- Two new additive bonuses: Early Bird / Night Owl, and Happy Hour.
--
-- 1. EARLY BIRD 🐦 / NIGHT OWL 🌙
--    The first and last scoring beer of each "beer day" earn +1 each, on top of
--    every other bonus. A beer day runs 07:00 → next-day 07:00 in the holiday's
--    local timezone (same waking principle as the morning bonus), so Thursday's
--    "last beer" can be poured at 04:00 Friday. We derive the day key by shifting
--    the local start time back 7 hours and taking the date:
--        beer_day = ((full_taken_at at tz) - interval '7 hours')::date
--    First/last are decided by START time (full_taken_at) among that day's
--    scoring beers. A lone beer in a day is both first AND last → +2.
--
-- 2. HAPPY HOUR ⏰  (base value doubled → an additive +1)
--    Each beer day has one "happy hour": a single clock hour, randomly but
--    DETERMINISTICALLY chosen per (holiday, day) so every player in the trip
--    shares the same hour. It sits between 14:00 and 23:00 local (start hour in
--    14..22). A beer STARTED during that hour earns +1 — i.e. a plain beer is
--    worth 2 (base 1 + happy 1, "double"), a chug 3, a chained beer n+1, all
--    additive with morning / early-bird / night-owl.
--
-- score_override still wins over everything; rejected beers still score 0.

-- ---------------------------------------------------------------------------
-- Deterministic per-day happy hour (local start hour, 14..22 inclusive).
-- Stable for a given (holiday, day): hashes the pair into one of 9 slots.
-- ---------------------------------------------------------------------------
create or replace function public.happy_hour_for(p_holiday uuid, p_day date)
returns int
language sql
immutable
as $$
  select 14 + (abs(hashtext(p_holiday::text || ':' || to_char(p_day, 'YYYY-MM-DD'))) % 9);
$$;

-- Is it happy hour right now for this holiday? Used by the client for the
-- load-time banner. Returns { active, start_hour, end_hour, now_hour } in the
-- holiday's local 24h clock.
create or replace function public.happy_hour_now(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_tz text;
  v_local timestamp;
  v_hour int;
  v_day date;
  v_hh int;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_tz := coalesce(h.timezone, 'UTC');
  v_local := (now() at time zone v_tz);          -- wall-clock in holiday tz
  v_hour := extract(hour from v_local)::int;
  v_day := (v_local - interval '7 hours')::date;  -- same beer-day key as scoring
  v_hh := public.happy_hour_for(p_holiday, v_day);

  return jsonb_build_object(
    'active', v_hour = v_hh,
    'start_hour', v_hh,
    'end_hour', v_hh + 1,
    'now_hour', v_hour
  );
end;
$$;

grant execute on function public.happy_hour_for(uuid, date) to authenticated;
grant execute on function public.happy_hour_now(uuid)       to authenticated;

-- ---------------------------------------------------------------------------
-- Board snapshot — scoring with all four additive bonuses.
-- Chain is on FINISH times (unchanged from 0009).
-- ---------------------------------------------------------------------------
create or replace function public.compute_standings(p_holiday uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with hol as (
    select coalesce(timezone, 'UTC') as tz from public.holidays where id = p_holiday
  ),
  base as (
    select b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug, b.score_override,
           (b.full_taken_at at time zone h.tz) as lf,
           ((b.full_taken_at at time zone h.tz) - interval '7 hours')::date as beer_day,
           lag(b.empty_taken_at) over (
             partition by b.user_id order by b.empty_taken_at
           ) as prev_finish
    from public.beers b cross join hol h
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  grouped as (
    select base.*,
           sum(case when prev_finish is null
                      or empty_taken_at - prev_finish > interval '5 minutes'
                    then 1 else 0 end)
             over (partition by user_id order by empty_taken_at) as grp
    from base
  ),
  flagged as (
    select g.*,
           (extract(hour from g.lf) between 7 and 10) as is_morning,
           (extract(hour from g.lf)::int = public.happy_hour_for(p_holiday, g.beer_day)) as is_happy,
           (row_number() over (partition by g.user_id, g.beer_day order by g.full_taken_at asc)  = 1) as is_first,
           (row_number() over (partition by g.user_id, g.beer_day order by g.full_taken_at desc) = 1) as is_last
    from grouped g
  ),
  scored as (
    select f.user_id,
           case when f.score_override is not null then f.score_override
           else
             greatest(
               row_number() over (
                 partition by f.user_id, f.grp order by f.empty_taken_at
               ),
               case when f.claimed_chug
                         or (f.empty_taken_at - f.full_taken_at) <= interval '60 seconds'
                    then 2 else 1 end
             )
             + case when f.is_morning then 1 else 0 end
             + case when f.is_happy   then 1 else 0 end
             + case when f.is_first   then 1 else 0 end
             + case when f.is_last    then 1 else 0 end
           end as points
    from flagged f
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

-- ---------------------------------------------------------------------------
-- Per-player ledger — surface the new flags and fold them into points.
-- State resolution via holiday_state() (unchanged from 0011).
-- ---------------------------------------------------------------------------
create or replace function public.user_ledger(p_holiday uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_admin boolean;
  v_state text;
  v_tz text;
  result jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_admin := (h.admin_id = auth.uid());
  v_tz := coalesce(h.timezone, 'UTC');
  v_state := public.holiday_state(h);
  if v_state = 'dark' and not v_admin then
    raise exception 'board is dark';
  end if;

  with eligible as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           (b.full_taken_at at time zone v_tz) as lf,
           ((b.full_taken_at at time zone v_tz) - interval '7 hours')::date as beer_day,
           lag(b.empty_taken_at) over (
             partition by b.user_id order by b.empty_taken_at
           ) as prev_finish
    from public.beers b
    where b.holiday_id = p_holiday
      and b.user_id = p_user
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  grouped as (
    select e.*,
           sum(case when prev_finish is null
                      or empty_taken_at - prev_finish > interval '5 minutes'
                    then 1 else 0 end)
             over (partition by user_id order by empty_taken_at) as grp
    from eligible e
  ),
  scored as (
    select g.id,
           row_number() over (
             partition by g.user_id, g.grp order by g.empty_taken_at
           ) as streak_position,
           (g.claimed_chug or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds') as is_chug,
           greatest(
             row_number() over (
               partition by g.user_id, g.grp order by g.empty_taken_at
             ),
             case when g.claimed_chug
                       or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds'
                  then 2 else 1 end
           ) as bonus,
           (extract(hour from g.lf)::int = public.happy_hour_for(p_holiday, g.beer_day)) as is_happy,
           (row_number() over (partition by g.user_id, g.beer_day order by g.full_taken_at asc)  = 1) as is_first,
           (row_number() over (partition by g.user_id, g.beer_day order by g.full_taken_at desc) = 1) as is_last
    from grouped g
  ),
  allb as (
    select b.id, b.full_taken_at, b.empty_taken_at, b.status, b.claimed_chug,
           b.full_photo_path, b.empty_photo_path, b.is_offline, b.score_override
    from public.beers b
    where b.holiday_id = p_holiday
      and b.user_id = p_user
      and b.status <> 'open'
      and b.empty_taken_at is not null
  ),
  rev as (
    select beer_id,
           count(*)::int as total,
           count(*) filter (where verdict = 'challenge')::int as challenged
    from public.reviews
    where beer_id in (select id from allb)
    group by beer_id
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'beer_id', a.id,
             'full_taken_at', a.full_taken_at,
             'empty_taken_at', a.empty_taken_at,
             'status', a.status,
             'is_chug', coalesce(
               s.is_chug,
               a.claimed_chug or (a.empty_taken_at - a.full_taken_at) <= interval '60 seconds'
             ),
             'streak_position', coalesce(s.streak_position, 0),
             'is_morning', (extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10),
             'is_happy_hour', coalesce(s.is_happy, false),
             'is_early_bird', coalesce(s.is_first, false),
             'is_night_owl', coalesce(s.is_last, false),
             'is_offline', a.is_offline,
             'score_override', a.score_override,
             'points', case
               when a.status = 'rejected' then 0
               when a.score_override is not null then a.score_override
               else coalesce(s.bonus, 1)
                    + case when extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10
                           then 1 else 0 end
                    + case when coalesce(s.is_happy, false) then 1 else 0 end
                    + case when coalesce(s.is_first, false) then 1 else 0 end
                    + case when coalesce(s.is_last,  false) then 1 else 0 end
             end,
             'reviews_total', coalesce(r.total, 0),
             'reviews_challenged', coalesce(r.challenged, 0),
             'full_photo_path', a.full_photo_path,
             'empty_photo_path', a.empty_photo_path
           ) order by a.full_taken_at desc
         ), '[]'::jsonb)
  into result
  from allb a
  left join scored s on s.id = a.id
  left join rev r on r.beer_id = a.id;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit queue — surface the per-beer bonus flags so the review/swipe screen
-- can show Early Bird / Night Owl / Happy Hour alongside chug & morning.
-- (Return signature changes, so drop + recreate.)
-- ---------------------------------------------------------------------------
drop function if exists public.audit_queue(uuid);
create or replace function public.audit_queue(p_holiday uuid)
returns table (
  beer_id uuid,
  owner_name text,
  full_photo_path text,
  empty_photo_path text,
  full_taken_at timestamptz,
  empty_taken_at timestamptz,
  claimed_chug boolean,
  is_offline boolean,
  is_morning boolean,
  is_happy_hour boolean,
  is_early_bird boolean,
  is_night_owl boolean
)
language sql
security definer
set search_path = public
as $$
  with hol as (
    select coalesce(timezone, 'UTC') as tz from public.holidays where id = p_holiday
  ),
  -- Flags are computed across ALL of each owner's scoring beers in the trip
  -- (not just the queue), so first/last-of-day is correct even when some of a
  -- day's beers are already reviewed.
  flagged as (
    select b.id,
           (extract(hour from (b.full_taken_at at time zone h.tz)) between 7 and 10) as is_morning,
           (extract(hour from (b.full_taken_at at time zone h.tz))::int
              = public.happy_hour_for(p_holiday,
                  ((b.full_taken_at at time zone h.tz) - interval '7 hours')::date)) as is_happy,
           (row_number() over (
              partition by b.user_id,
                ((b.full_taken_at at time zone h.tz) - interval '7 hours')::date
              order by b.full_taken_at asc) = 1) as is_first,
           (row_number() over (
              partition by b.user_id,
                ((b.full_taken_at at time zone h.tz) - interval '7 hours')::date
              order by b.full_taken_at desc) = 1) as is_last
    from public.beers b cross join hol h
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  )
  select b.id, p.display_name, b.full_photo_path, b.empty_photo_path,
         b.full_taken_at, b.empty_taken_at, b.claimed_chug, b.is_offline,
         coalesce(f.is_morning, false),
         coalesce(f.is_happy, false),
         coalesce(f.is_first, false),
         coalesce(f.is_last, false)
    from public.beers b
    join public.profiles p on p.id = b.user_id
    left join flagged f on f.id = b.id
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

grant execute on function public.audit_queue(uuid) to authenticated;
