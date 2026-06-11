-- Daily tally — the caller's beers finished each day vs the group average for
-- that day, for every beer-day from the trip start up to today.
--
-- "Day" is the 7am-7am beer-day (same boundary as scoring / daily_recap), keyed
-- on the empty (finish) photo. Counts every audited beer (pending/challenged/
-- confirmed); unfinished/rejected/open beers don't count. The group average is
-- the day's group total / number of members. Like the heatmap and insights this
-- is the caller's own data plus a group aggregate (no per-player standings), so
-- it's safe to return during the dark window.

create or replace function public.daily_bars(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_uid uuid;
  v_tz text;
  v_state text;
  v_members int;
  v_start date;
  v_end date;
  result jsonb;
begin
  v_uid := auth.uid();
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, v_uid) then raise exception 'not a member'; end if;

  v_tz := coalesce(h.timezone, 'UTC');
  v_state := public.holiday_state(h);

  select count(*)::int into v_members from public.memberships where holiday_id = p_holiday;

  -- Window: trip start .. min(today's beer-day, trip end).
  v_start := h.start_date;
  v_end := least(((now() at time zone v_tz) - interval '7 hours')::date, h.end_date);

  with days as (
    select generate_series(v_start, greatest(v_start, v_end), interval '1 day')::date as d
  ),
  elig as (
    select b.user_id,
           ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date as fin_day
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  per_day as (
    select d.d,
           count(*) filter (where e.user_id = v_uid)::int as mine,
           count(e.user_id)::int as group_total
    from days d
    left join elig e on e.fin_day = d.d
    group by d.d
  )
  select jsonb_build_object(
    'tz', v_tz,
    'state', v_state,
    'members', v_members,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', to_char(d, 'YYYY-MM-DD'),
               'mine', mine,
               'avg', case when v_members > 0
                           then round(group_total::numeric / v_members, 2)
                           else 0 end
             ) order by d)
      from per_day
    ), '[]'::jsonb),
    'my_total', (select coalesce(sum(mine), 0)::int from per_day),
    'group_total', (select coalesce(sum(group_total), 0)::int from per_day)
  ) into result;

  return result;
end;
$$;

grant execute on function public.daily_bars(uuid) to authenticated;
