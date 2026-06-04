-- Admin manual control over the board state (dark / reveal).
--
-- Until now 'live' / 'dark' / 'reveal' was purely date-driven (end_date and
-- dark_days). The admin can now override it: toggle dark on/off and "end the
-- trip" to trigger the reveal, regardless of the calendar.
--
-- holidays.forced_state: null = automatic (date-based, unchanged); otherwise
-- 'live' / 'dark' / 'reveal' wins. A single helper resolves the effective
-- state so every reader (standings, ledger, stats) stays consistent.

alter table public.holidays
  add column if not exists forced_state text
  check (forced_state is null or forced_state in ('live','dark','reveal'));

create or replace function public.holiday_state(h public.holidays)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when h.forced_state is not null then h.forced_state
    when current_date >= h.end_date then 'reveal'
    when current_date >= (h.end_date - h.dark_days) then 'dark'
    else 'live'
  end;
$$;

-- Admin sets (or clears) the override. 'auto' clears it back to date-based.
create or replace function public.set_holiday_state(p_holiday uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if h.admin_id <> auth.uid() then raise exception 'admin only'; end if;
  if p_state not in ('live','dark','reveal','auto') then raise exception 'bad state'; end if;

  update public.holidays
     set forced_state = case when p_state = 'auto' then null else p_state end
   where id = p_holiday;

  perform public.refresh_snapshot(p_holiday);
end;
$$;

grant execute on function public.set_holiday_state(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-create the three state-aware readers to resolve via holiday_state().
-- Bodies are otherwise identical to their latest versions.
-- ---------------------------------------------------------------------------
create or replace function public.get_latest_standings(
  p_holiday uuid,
  p_admin_peek boolean default false
)
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
  v_state := public.holiday_state(h);

  -- dark hides for EVERYONE, including the admin, unless they explicitly peek
  v_show := (v_state <> 'dark') or (v_admin and coalesce(p_admin_peek, false));

  select * into v_snap from public.leaderboard_snapshots
   where holiday_id = p_holiday
   order by generated_at desc limit 1;

  return jsonb_build_object(
    'state', v_state,
    'is_admin', v_admin,
    'can_peek', (v_state = 'dark' and v_admin),
    'generated_at', v_snap.generated_at,
    'standings', case when v_show then coalesce(v_snap.standings, '[]'::jsonb) else null end
  );
end;
$$;

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
           ) as bonus
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
             'is_offline', a.is_offline,
             'score_override', a.score_override,
             'points', case
               when a.status = 'rejected' then 0
               when a.score_override is not null then a.score_override
               else coalesce(s.bonus, 1)
                    + case when extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10
                           then 1 else 0 end
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
  v_state := public.holiday_state(h);
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
