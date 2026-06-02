-- Morning bonus: a beer started between 07:00 and 10:59 (local holiday time)
-- earns +1 point, ADDED on top of the chug/streak bonus.
--   * plain morning beer            = 1 (base) + 1 (morning) = 2
--   * chug bonus / streak position  = greatest of the two (unchanged)
--   * chug at 08:00                 = 2 (chug) + 1 (morning) = 3
-- The 07:00 floor means post-midnight beers (00:00–06:59) get nothing.
--
-- "Morning" is judged on the beer's START time (full_taken_at), in the holiday's
-- local timezone. Timestamps are stored in UTC, so each holiday carries its own
-- IANA timezone; without it a UTC hour wouldn't match local morning.

alter table public.holidays
  add column if not exists timezone text not null default 'UTC';

-- create_holiday now records the holiday timezone (validated against the DB's
-- timezone catalogue; falls back to UTC if unknown). Older 4-arg signature dropped.
drop function if exists public.create_holiday(text, date, date, int);

create or replace function public.create_holiday(
  p_name text, p_start date, p_end date, p_dark_days int, p_timezone text default 'UTC'
) returns public.holidays
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_tz text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_tz := p_timezone;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;

  insert into public.holidays(name, start_date, end_date, dark_days, admin_id, invite_code, timezone)
  values (p_name, p_start, p_end, greatest(p_dark_days,0), auth.uid(), public.gen_invite_code(), v_tz)
  returning * into h;

  insert into public.memberships(holiday_id, user_id) values (h.id, auth.uid());
  perform public.refresh_snapshot(h.id);
  return h;
end;
$$;

grant execute on function public.create_holiday(text, date, date, int, text) to authenticated;

-- Scoring with the additive morning bonus.
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
    select b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           lag(b.full_taken_at) over (
             partition by b.user_id order by b.full_taken_at
           ) as prev_start
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  grouped as (
    select base.*,
           sum(case when prev_start is null
                      or full_taken_at - prev_start > interval '5 minutes'
                    then 1 else 0 end)
             over (partition by user_id order by full_taken_at) as grp
    from base
  ),
  scored as (
    select g.user_id,
           greatest(
             row_number() over (
               partition by g.user_id, g.grp order by g.full_taken_at
             ),
             case when g.claimed_chug
                       or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds'
                  then 2 else 1 end
           )
           + case when extract(hour from (g.full_taken_at at time zone h.tz)) between 7 and 10
                  then 1 else 0 end
           as points
    from grouped g cross join hol h
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
