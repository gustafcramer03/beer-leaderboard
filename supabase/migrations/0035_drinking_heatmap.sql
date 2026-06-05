-- Drinking heatmap — when does the group drink most?
--
-- A day x hour grid of beer counts in the holiday's local timezone, keyed on
-- each beer's START time (full_taken_at = when it was cracked). This is a pure
-- GROUP aggregate — no per-player data, no standings — so, like trip_stats'
-- group totals, it's safe to return even during the dark window (it can't leak
-- who's winning). Counts every audited beer (pending/challenged/confirmed),
-- excluding rejected and still-open (no full photo) beers.

create or replace function public.heatmap_data(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_tz text;
  v_state text;
  result jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_tz := coalesce(h.timezone, 'UTC');
  v_state := public.holiday_state(h);

  with elig as (
    select (b.full_taken_at at time zone v_tz) as lf
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.full_taken_at is not null
  ),
  binned as (
    select lf::date as d, extract(hour from lf)::int as hr, count(*)::int as c
    from elig
    group by 1, 2
  ),
  per_day as (
    select d.d, jsonb_agg(coalesce(b.c, 0) order by g.hr) as counts
    from (select distinct d from binned) d
    cross join generate_series(0, 23) as g(hr)
    left join binned b on b.d = d.d and b.hr = g.hr
    group by d.d
  )
  select jsonb_build_object(
    'tz', v_tz,
    'state', v_state,
    'total', (select count(*)::int from elig),
    'max', coalesce((select max(c) from binned), 0),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', to_char(d, 'YYYY-MM-DD'),
               'counts', counts
             ) order by d)
      from per_day
    ), '[]'::jsonb),
    'by_hour', (
      select jsonb_agg(coalesce(t.s, 0) order by g.hr)
      from generate_series(0, 23) as g(hr)
      left join (select hr, sum(c)::int as s from binned group by hr) t on t.hr = g.hr
    ),
    'peak', (
      select jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'hour', hr, 'count', c)
      from binned order by c desc, d, hr limit 1
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.heatmap_data(uuid) to authenticated;
