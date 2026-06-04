-- Pace projection board.
--
-- Returns cumulative beer-count and points time series over the trip's days,
-- for the group as a whole and for each player, up to "today" (the current
-- beer-day). The frontend draws these solid and extends a dotted projection to
-- the trip's end date at the current daily pace.
--
-- Per-beer points mirror compute_standings exactly (chug/chain, morning, happy
-- hour, early bird, night-owl-after-midnight, score_override; rejected/open
-- excluded). Beers are bucketed by FINISH beer-day (07:00 -> next 07:00 local),
-- clamped into the trip's [start_date, end_date] window.
--
-- Per-player series reveal individual standings, so the whole board is gated
-- while dark for non-admins (like user_ledger).

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
  v_start date;
  v_end date;
  v_today date;
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

  v_start := h.start_date;
  v_end := h.end_date;
  v_today := ((now() at time zone v_tz) - interval '7 hours')::date;

  with axis as (
    select d::date as day, (row_number() over (order by d) - 1)::int as idx
    from generate_series(v_start, v_end, interval '1 day') g(d)
  ),
  adays as (
    select * from axis where day <= v_today
  ),
  base as (
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
    select f.user_id,
           greatest(least(f.fin_day, v_end), v_start) as bday,
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
  ),
  members as (
    select m.user_id, pr.display_name
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    where m.holiday_id = p_holiday
  ),
  ucum as (
    select mem.user_id, mem.display_name, ad.idx,
           (select count(*) from beer_pts bp
              where bp.user_id = mem.user_id and bp.bday <= ad.day)::int as beers,
           (select coalesce(sum(bp.pts), 0) from beer_pts bp
              where bp.user_id = mem.user_id and bp.bday <= ad.day)::int as points
    from members mem cross join adays ad
  ),
  pser as (
    select user_id, display_name,
           jsonb_agg(beers  order by idx) as beers,
           jsonb_agg(points order by idx) as points,
           max(beers)  as beer_total,
           max(points) as point_total
    from ucum
    group by user_id, display_name
  ),
  gcum as (
    select idx, sum(beers)::int as beers, sum(points)::int as points
    from ucum group by idx
  )
  select jsonb_build_object(
    'state', v_state,
    'days', coalesce((select jsonb_agg(to_char(day, 'YYYY-MM-DD') order by idx) from axis), '[]'::jsonb),
    'today_index', coalesce((select max(idx) from adays), 0),
    'group_beers',  coalesce((select jsonb_agg(beers  order by idx) from gcum), '[]'::jsonb),
    'group_points', coalesce((select jsonb_agg(points order by idx) from gcum), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', user_id,
               'display_name', display_name,
               'beers', beers,
               'points', points
             ) order by point_total desc, beer_total desc, display_name asc)
      from pser
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.pace_series(uuid) to authenticated;
