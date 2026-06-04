-- Pace board, take 2: per-beer event series instead of daily buckets.
--
-- The first cut (0017) bucketed cumulative totals by beer-day, so the line only
-- ever turned once per day. This returns one cumulative point per actual beer
-- (keyed on its finish time), letting the frontend draw a real staircase on a
-- time axis -- flat overnight, stepping up through an evening session -- and
-- then extend a dotted projection from "now" to the trip's end at the current
-- average rate.
--
-- Per-beer points still mirror compute_standings exactly (chug/chain greatest,
-- morning, happy hour, early bird, night-owl-after-midnight, score_override;
-- rejected/open excluded). Times are returned as epoch milliseconds so the JS
-- Date constructor parses them unambiguously.
--
-- Still gated entirely while dark for non-admins (reveals individual standings).

create or replace function public.pace_series(p_holiday uuid)
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
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_now timestamptz;
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

  -- Plot domain in real time: beer-day boundaries (07:00 local) at the trip edges.
  v_start_ts := ((h.start_date::timestamp + interval '7 hours') at time zone v_tz);
  v_end_ts   := (((h.end_date + 1)::timestamp + interval '7 hours') at time zone v_tz);
  v_now := now();

  with base as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug, b.score_override,
           (b.full_taken_at  at time zone v_tz) as lf,
           (b.empty_taken_at at time zone v_tz) as le,
           ((b.full_taken_at  at time zone v_tz) - interval '7 hours')::date as hh_day,
           ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date as fin_day,
           lag(b.empty_taken_at) over (
             partition by b.user_id order by b.empty_taken_at
           ) as prev_finish
    from public.beers b
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
           (extract(hour from g.lf)::int = public.happy_hour_for(p_holiday, g.hh_day)) as is_happy,
           (row_number() over (partition by g.fin_day order by g.empty_taken_at asc,  g.id asc)  = 1) as is_first,
           (row_number() over (partition by g.fin_day order by g.empty_taken_at desc, g.id desc) = 1
              and extract(hour from g.le) < 7) as is_last
    from grouped g
  ),
  beer_pts as (
    select f.user_id, f.empty_taken_at as t,
           case when f.score_override is not null then f.score_override
           else
             greatest(
               row_number() over (partition by f.user_id, f.grp order by f.empty_taken_at),
               case when f.claimed_chug
                         or (f.empty_taken_at - f.full_taken_at) <= interval '60 seconds'
                    then 2 else 1 end
             )
             + case when f.is_morning then 1 else 0 end
             + case when f.is_happy   then 1 else 0 end
             + case when f.is_first   then 1 else 0 end
             + case when f.is_last    then 1 else 0 end
           end as pts
    from flagged f
    where f.empty_taken_at >= v_start_ts and f.empty_taken_at < v_end_ts
  ),
  -- Running cumulative at each of a player's own beer events.
  pl_events as (
    select user_id, t,
           (count(*) over (partition by user_id order by t rows unbounded preceding))::int as beers,
           (sum(pts) over (partition by user_id order by t rows unbounded preceding))::int as points
    from beer_pts
  ),
  -- Running cumulative across everyone's beers (the whole group).
  gr_events as (
    select t,
           (count(*) over (order by t, user_id rows unbounded preceding))::int as beers,
           (sum(pts) over (order by t, user_id rows unbounded preceding))::int as points
    from beer_pts
  ),
  members as (
    select m.user_id, pr.display_name
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    where m.holiday_id = p_holiday
  ),
  pl_agg as (
    select mem.user_id, mem.display_name,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 't', (extract(epoch from e.t) * 1000)::bigint,
                 'beers', e.beers,
                 'points', e.points
               ) order by e.t)
        from pl_events e where e.user_id = mem.user_id
      ), '[]'::jsonb) as events,
      coalesce((select max(beers)  from pl_events e where e.user_id = mem.user_id), 0) as beer_total,
      coalesce((select max(points) from pl_events e where e.user_id = mem.user_id), 0) as point_total
    from members mem
  )
  select jsonb_build_object(
    'state', v_state,
    'start', (extract(epoch from v_start_ts) * 1000)::bigint,
    'end',   (extract(epoch from v_end_ts)   * 1000)::bigint,
    'now',   (extract(epoch from v_now)       * 1000)::bigint,
    'group_events', coalesce((
      select jsonb_agg(jsonb_build_object(
               't', (extract(epoch from t) * 1000)::bigint,
               'beers', beers,
               'points', points
             ) order by t)
      from gr_events
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', user_id,
               'display_name', display_name,
               'events', events
             ) order by point_total desc, beer_total desc, display_name asc)
      from pl_agg
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.pace_series(uuid) to authenticated;
