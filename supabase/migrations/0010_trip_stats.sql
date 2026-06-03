-- Trip stats for the Stats tab.
--
-- Group-level aggregates over all finished, non-rejected beers in a holiday,
-- computed in the holiday's local timezone. Group totals are always returned
-- (they don't reveal who's winning). Per-player superlatives (top drinker,
-- fastest-chug holder, longest-chain holder) carry a name only when the board
-- isn't dark — during the dark window the names are nulled so the ending stays
-- a surprise, while the collective numbers keep flowing.
--
-- Chain length here matches the scoring rule: a run of beers each FINISHED
-- within 5 minutes of the previous one being finished.

create or replace function public.trip_stats(p_holiday uuid)
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
  v_show boolean;
  v_members int;
  v_snap public.leaderboard_snapshots;
  result jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_admin := (h.admin_id = auth.uid());
  v_tz := coalesce(h.timezone, 'UTC');

  if current_date >= h.end_date then
    v_state := 'reveal';
  elsif current_date >= (h.end_date - h.dark_days) then
    v_state := 'dark';
  else
    v_state := 'live';
  end if;
  -- Hide per-player superlatives during the dark window (for everyone, to keep
  -- the surprise); group aggregates are still returned.
  v_show := (v_state <> 'dark');

  select count(*)::int into v_members from public.memberships where holiday_id = p_holiday;

  select * into v_snap from public.leaderboard_snapshots
   where holiday_id = p_holiday
   order by generated_at desc limit 1;

  with elig as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.is_offline,
           b.claimed_chug,
           (b.empty_taken_at - b.full_taken_at) as dur,
           (b.full_taken_at at time zone v_tz) as lf
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  ch as (
    select user_id, grp, count(*)::int as len
    from (
      select user_id,
             sum(case when pf is null or empty_taken_at - pf > interval '5 minutes'
                      then 1 else 0 end)
               over (partition by user_id order by empty_taken_at) as grp
      from (
        select user_id, empty_taken_at,
               lag(empty_taken_at) over (partition by user_id order by empty_taken_at) as pf
        from elig
      ) a
    ) b
    group by user_id, grp
  )
  select jsonb_build_object(
    'state', v_state,
    'is_admin', v_admin,
    'members', v_members,
    'total_beers', (select count(*)::int from elig),
    'total_points', coalesce((
      select sum((s->>'points')::int)
      from jsonb_array_elements(coalesce(v_snap.standings, '[]'::jsonb)) s
    ), 0),
    'chugs', (select count(*)::int from elig where claimed_chug or dur <= interval '60 seconds'),
    'morning_beers', (select count(*)::int from elig where extract(hour from lf) between 7 and 10),
    'offline_beers', (select count(*)::int from elig where is_offline),
    'active_days', (select count(distinct lf::date)::int from elig),
    'first_beer_at', (select min(full_taken_at) from elig),
    'last_beer_at', (select max(full_taken_at) from elig),
    'challenges_raised', (
      select count(*)::int from public.reviews rv
      join elig e on e.id = rv.beer_id
      where rv.verdict = 'challenge'
    ),
    'beers_rejected', (
      select count(*)::int from public.beers b
      where b.holiday_id = p_holiday and b.status = 'rejected'
    ),
    'happiest_hour', (
      select jsonb_build_object('hour', t.hr, 'count', t.c)
      from (
        select extract(hour from lf)::int as hr, count(*)::int as c
        from elig group by 1 order by c desc, hr limit 1
      ) t
    ),
    'happiest_day', (
      select jsonb_build_object('date', to_char(t.d, 'YYYY-MM-DD'), 'count', t.c)
      from (
        select lf::date as d, count(*)::int as c
        from elig group by 1 order by c desc, d limit 1
      ) t
    ),
    'fastest_chug', (
      select jsonb_build_object(
        'seconds', extract(epoch from t.dur)::int,
        'name', case when v_show then pr.display_name else null end)
      from (
        select user_id, dur from elig
        where claimed_chug or dur <= interval '60 seconds'
        order by dur asc limit 1
      ) t
      join public.profiles pr on pr.id = t.user_id
    ),
    'longest_chain', (
      select jsonb_build_object(
        'length', t.len,
        'name', case when v_show then pr.display_name else null end)
      from (select user_id, len from ch order by len desc, user_id limit 1) t
      join public.profiles pr on pr.id = t.user_id
    ),
    'top_drinker', case when v_show then (
      select jsonb_build_object('name', pr.display_name, 'count', t.c)
      from (
        select user_id, count(*)::int as c from elig
        group by user_id order by c desc, user_id limit 1
      ) t
      join public.profiles pr on pr.id = t.user_id
    ) else null end
  ) into result;

  return result;
end;
$$;

grant execute on function public.trip_stats(uuid) to authenticated;
