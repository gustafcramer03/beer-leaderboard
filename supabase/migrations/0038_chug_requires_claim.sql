-- Chug now requires the explicit claim: a beer counts as a chug ONLY when the
-- logger ticked "I chugged it" (claimed_chug). Photos taken within 60s of each
-- other no longer auto-count. Re-creates every scoring/stats reader that carried
-- the old claimed_chug OR (empty-full) <= 60s rule, stripping the time clause,
-- then re-snapshots all holidays so the board reflects the new scoring.
-- Generated from the live function definitions (bodies otherwise unchanged).

-- ---- activity_feed ----
CREATE OR REPLACE FUNCTION public.activity_feed(p_holiday uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  h public.holidays;
  v_admin boolean;
  v_state text;
  v_tz text;
  v_events jsonb := '[]'::jsonb;
  v_running jsonb := '{}'::jsonb;
  v_leader uuid;
  v_top numeric := -1;
  v_actor_total numeric;
  v_name text;
  v_avatar text;
  rec record;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_admin := (h.admin_id = auth.uid());
  v_tz := coalesce(h.timezone, 'UTC');
  v_state := public.holiday_state(h);

  if v_state = 'dark' and not v_admin then
    return jsonb_build_object('state', v_state, 'events', null);
  end if;

  create temp table _feed_beers on commit drop as
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
              and extract(hour from g.le) < 7) as is_last,
           (g.claimed_chug) as is_chug
    from grouped g
  ),
  scored as (
    select f.*,
           case when f.score_override is not null then f.score_override
           else
             greatest(
               row_number() over (partition by f.user_id, f.grp order by f.empty_taken_at),
               case when f.is_chug then 2 else 1 end
             )
             + case when f.is_morning then 1 else 0 end
             + case when f.is_happy   then 1 else 0 end
             + case when f.is_first   then 1 else 0 end
             + case when f.is_last    then 1 else 0 end
           end as points
    from flagged f
  )
  select s.id, s.user_id, s.empty_taken_at, s.is_chug, s.is_first, s.is_last,
         s.is_happy, s.hh_day, s.grp, s.fin_day, s.points,
         row_number() over (partition by s.user_id, s.fin_day order by s.empty_taken_at asc, s.id asc) as day_rn,
         row_number() over (partition by s.user_id order by s.empty_taken_at asc, s.id asc) as trip_rn
  from scored s;

  -- Helper: day-end instant (next day 07:00 local) for "completed day" checks.
  -- chug
  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
             'type','chug','at',b.empty_taken_at,'user_id',b.user_id,
             'display_name',pr.display_name,'avatar_path',pr.avatar_path,'n',null::int))
    from _feed_beers b join public.profiles pr on pr.id = b.user_id
    where b.is_chug), '[]'::jsonb);

  -- early bird (stable as soon as the first beer of the day finishes)
  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
             'type','early_bird','at',b.empty_taken_at,'user_id',b.user_id,
             'display_name',pr.display_name,'avatar_path',pr.avatar_path,'n',null::int))
    from _feed_beers b join public.profiles pr on pr.id = b.user_id
    where b.is_first), '[]'::jsonb);

  -- night owl (only for completed beer-days, else it can still change)
  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
             'type','night_owl','at',b.empty_taken_at,'user_id',b.user_id,
             'display_name',pr.display_name,'avatar_path',pr.avatar_path,'n',null::int))
    from _feed_beers b join public.profiles pr on pr.id = b.user_id
    where b.is_last
      and (((b.fin_day + 1)::timestamp + interval '7 hours') at time zone v_tz) <= now()
  ), '[]'::jsonb);

  -- happy hour windows: announce the start (a call to arms), then on completion
  -- summarise how many beers landed. One window per beer-day; the hour comes from
  -- happy_hour_for(day). These events have no user. The window sits on calendar
  -- date d when the hour >= 7, else it rolls into d+1 (beer-day = 07:00->07:00).
  v_events := v_events || coalesce((
    with days as (
      select generate_series(h.start_date, h.end_date, interval '1 day')::date as d
    ),
    windows as (
      select d, public.happy_hour_for(p_holiday, d) as hh from days
    ),
    enriched as (
      select w.d, w.hh,
             (((case when w.hh >= 7 then w.d else w.d + 1 end)::timestamp
               + (w.hh || ' hours')::interval) at time zone v_tz) as starts,
             (select count(*)::int from _feed_beers b
              where b.is_happy and b.hh_day = w.d) as n
      from windows w
      where w.hh is not null
    )
    select jsonb_agg(ev) from (
      select jsonb_build_object(
               'type','happy_hour_start','at',e.starts,'user_id',null,
               'display_name',null,'avatar_path',null,'n',null::int) as ev
      from enriched e where e.starts <= now()
      union all
      select jsonb_build_object(
               'type','happy_hour_end','at',e.starts + interval '1 hour','user_id',null,
               'display_name',null,'avatar_path',null,'n',e.n) as ev
      from enriched e where e.starts + interval '1 hour' <= now()
    ) s), '[]'::jsonb);

  -- completed chains of 3+
  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
             'type','chain','at',g.at,'user_id',g.user_id,
             'display_name',pr.display_name,'avatar_path',pr.avatar_path,'n',g.len))
    from (
      select user_id, grp, count(*)::int as len, max(empty_taken_at) as at
      from _feed_beers group by user_id, grp having count(*) >= 3
    ) g join public.profiles pr on pr.id = g.user_id), '[]'::jsonb);

  -- per-day milestones: 10th, then every 5th
  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
             'type','day_milestone','at',b.empty_taken_at,'user_id',b.user_id,
             'display_name',pr.display_name,'avatar_path',pr.avatar_path,'n',b.day_rn))
    from _feed_beers b join public.profiles pr on pr.id = b.user_id
    where b.day_rn >= 10 and b.day_rn % 5 = 0), '[]'::jsonb);

  -- per-trip milestones: 10th, then 25th & every 25th
  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
             'type','trip_milestone','at',b.empty_taken_at,'user_id',b.user_id,
             'display_name',pr.display_name,'avatar_path',pr.avatar_path,'n',b.trip_rn))
    from _feed_beers b join public.profiles pr on pr.id = b.user_id
    where b.trip_rn = 10 or (b.trip_rn >= 25 and b.trip_rn % 25 = 0)), '[]'::jsonb);

  -- first beer of the whole trip
  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
             'type','first_blood','at',b.empty_taken_at,'user_id',b.user_id,
             'display_name',pr.display_name,'avatar_path',pr.avatar_path,'n',null::int))
    from (select * from _feed_beers order by empty_taken_at asc, id asc limit 1) b
    join public.profiles pr on pr.id = b.user_id), '[]'::jsonb);

  -- legend of the day: top drinker of each completed day
  v_events := v_events || coalesce((
    with day_counts as (
      select user_id, fin_day, count(*)::int as c
      from _feed_beers group by user_id, fin_day
    ),
    tops as (
      select distinct on (fin_day) fin_day, user_id, c
      from day_counts order by fin_day, c desc, user_id
    )
    select jsonb_agg(jsonb_build_object(
             'type','legend',
             'at', (((t.fin_day + 1)::timestamp + interval '7 hours') at time zone v_tz),
             'user_id', t.user_id,
             'display_name', pr.display_name,
             'avatar_path', pr.avatar_path,
             'n', t.c))
    from tops t join public.profiles pr on pr.id = t.user_id
    where (((t.fin_day + 1)::timestamp + interval '7 hours') at time zone v_tz) <= now()
  ), '[]'::jsonb);

  -- lead changes: walk beers in finish order, track the running #1.
  for rec in
    select user_id, points, empty_taken_at, id from _feed_beers
    order by empty_taken_at asc, id asc
  loop
    v_running := jsonb_set(
      v_running,
      array[(rec.user_id)::text],
      to_jsonb(coalesce(((v_running ->> (rec.user_id)::text))::numeric, 0) + rec.points)
    );
    v_actor_total := ((v_running ->> (rec.user_id)::text))::numeric;

    if v_leader is null then
      v_leader := rec.user_id;
      v_top := v_actor_total;
    elsif rec.user_id = v_leader then
      v_top := v_actor_total;  -- leader extends their lead
    elsif v_actor_total > v_top then
      v_leader := rec.user_id;
      v_top := v_actor_total;
      select display_name, avatar_path into v_name, v_avatar
        from public.profiles where id = rec.user_id;
      v_events := v_events || jsonb_build_array(jsonb_build_object(
        'type','lead','at',rec.empty_taken_at,'user_id',rec.user_id,
        'display_name',v_name,'avatar_path',v_avatar,'n',v_actor_total::int));
    end if;
  end loop;

  -- newest first, capped
  v_events := (
    select coalesce(jsonb_agg(e order by (e->>'at')::timestamptz desc), '[]'::jsonb)
    from (
      select value as e from jsonb_array_elements(v_events)
      order by (value->>'at')::timestamptz desc
      limit greatest(p_limit, 1)
    ) s
  );

  return jsonb_build_object('state', v_state, 'events', v_events);
end;
$function$;

-- ---- admin_beers ----
CREATE OR REPLACE FUNCTION public.admin_beers(p_holiday uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  h public.holidays;
  v_tz text;
  result jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_admin(p_holiday, auth.uid()) then raise exception 'admin only'; end if;

  v_tz := coalesce(h.timezone, 'UTC');

  with eligible as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           (b.full_taken_at at time zone v_tz) as lf,
           ((b.full_taken_at at time zone v_tz) - interval '7 hours')::date as hh_day,
           lag(b.empty_taken_at) over (
             partition by b.user_id order by b.empty_taken_at
           ) as prev_finish
    from public.beers b
    where b.holiday_id = p_holiday
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
           (g.claimed_chug) as is_chug,
           greatest(
             row_number() over (
               partition by g.user_id, g.grp order by g.empty_taken_at
             ),
             case when g.claimed_chug
                  then 2 else 1 end
           ) as bonus,
           (extract(hour from g.lf)::int = public.happy_hour_for(p_holiday, g.hh_day)) as is_happy
    from grouped g
  ),
  day_marks as (
    select b.id,
           (row_number() over (
              partition by ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date
              order by b.empty_taken_at asc, b.id asc) = 1) as is_first,
           (row_number() over (
              partition by ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date
              order by b.empty_taken_at desc, b.id desc) = 1
            and extract(hour from (b.empty_taken_at at time zone v_tz)) < 7) as is_last
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  allb as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.status,
           b.claimed_chug, b.full_photo_path, b.empty_photo_path, b.is_offline,
           b.score_override, b.score_override_reason, b.caption, b.brand, b.created_at
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status <> 'open'
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
             'user_id', a.user_id,
             'owner_name', coalesce(p.display_name, 'Unknown'),
             'full_taken_at', a.full_taken_at,
             'empty_taken_at', a.empty_taken_at,
             'status', a.status,
             'is_chug', coalesce(
               s.is_chug,
               a.claimed_chug
             ),
             'claimed_chug', a.claimed_chug,
             'is_offline', a.is_offline,
             'is_morning', (a.full_taken_at is not null
               and extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10),
             'is_happy_hour', coalesce(s.is_happy, false),
             'is_early_bird', coalesce(dm.is_first, false),
             'is_night_owl', coalesce(dm.is_last, false),
             'score_override', a.score_override,
             'override_reason', a.score_override_reason,
             'caption', a.caption,
             'brand', a.brand,
             'points', case
               when a.status = 'rejected' then 0
               when a.empty_taken_at is null then 0
               when a.score_override is not null then a.score_override
               else coalesce(s.bonus, 1)
                    + case when extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10
                           then 1 else 0 end
                    + case when coalesce(s.is_happy,  false) then 1 else 0 end
                    + case when coalesce(dm.is_first, false) then 1 else 0 end
                    + case when coalesce(dm.is_last,  false) then 1 else 0 end
             end,
             'reviews_total', coalesce(r.total, 0),
             'reviews_challenged', coalesce(r.challenged, 0),
             'full_photo_path', a.full_photo_path,
             'empty_photo_path', a.empty_photo_path
           )
           order by coalesce(p.display_name, 'Unknown') asc, a.full_taken_at desc nulls last, a.created_at desc
         ), '[]'::jsonb)
  into result
  from allb a
  left join public.profiles p on p.id = a.user_id
  left join scored s    on s.id  = a.id
  left join day_marks dm on dm.id = a.id
  left join rev r       on r.beer_id = a.id;

  return result;
end;
$function$;

-- ---- compute_standings ----
CREATE OR REPLACE FUNCTION public.compute_standings(p_holiday uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with hol as (
    select coalesce(timezone, 'UTC') as tz from public.holidays where id = p_holiday
  ),
  base as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug, b.score_override,
           (b.full_taken_at  at time zone h.tz) as lf,
           (b.empty_taken_at at time zone h.tz) as le,
           ((b.full_taken_at  at time zone h.tz) - interval '7 hours')::date as hh_day,
           ((b.empty_taken_at at time zone h.tz) - interval '7 hours')::date as fin_day,
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
           (extract(hour from g.lf)::int = public.happy_hour_for(p_holiday, g.hh_day)) as is_happy,
           -- group-wide first finisher of the day (any time):
           (row_number() over (partition by g.fin_day order by g.empty_taken_at asc,  g.id asc)  = 1) as is_first,
           -- group-wide last finisher of the day, but ONLY if after midnight:
           (row_number() over (partition by g.fin_day order by g.empty_taken_at desc, g.id desc) = 1
              and extract(hour from g.le) < 7) as is_last
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
$function$;

-- ---- daily_recap ----
CREATE OR REPLACE FUNCTION public.daily_recap(p_holiday uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  h public.holidays;
  v_tz text;
  v_cur_day date;
  v_recap_day date;
  v_state text;
  v_total int;
  v_champion jsonb;
  v_early jsonb;
  v_owl jsonb;
  v_chug jsonb;
  v_chain jsonb;
  v_recap jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_tz := coalesce(h.timezone, 'UTC');
  v_cur_day   := ((now() at time zone v_tz) - interval '7 hours')::date;
  v_recap_day := v_cur_day - 1;
  v_state := public.holiday_state(h);

  if v_state = 'dark' then
    return jsonb_build_object(
      'today', to_char(v_cur_day, 'YYYY-MM-DD'),
      'date',  to_char(v_recap_day, 'YYYY-MM-DD'),
      'recap', null
    );
  end if;

  -- All eligible beers finished on the recapped beer-day, with chug/chain flags.
  create temp table _recap_beers on commit drop as
  with base as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           (b.empty_taken_at at time zone v_tz) as le,
           lag(b.empty_taken_at) over (
             partition by b.user_id order by b.empty_taken_at
           ) as prev_finish
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
      and ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date = v_recap_day
  ),
  grouped as (
    select base.*,
           sum(case when prev_finish is null
                      or empty_taken_at - prev_finish > interval '5 minutes'
                    then 1 else 0 end)
             over (partition by user_id order by empty_taken_at) as grp
    from base
  )
  select g.id, g.user_id, g.full_taken_at, g.empty_taken_at, g.grp,
         (g.claimed_chug) as is_chug,
         extract(epoch from (g.empty_taken_at - g.full_taken_at))::int as duration_s,
         (row_number() over (order by g.empty_taken_at asc,  g.id asc)  = 1) as is_first,
         (row_number() over (order by g.empty_taken_at desc, g.id desc) = 1
            and extract(hour from g.le) < 7) as is_last
  from grouped g;

  select count(*)::int into v_total from _recap_beers;

  if v_total = 0 then
    return jsonb_build_object(
      'today', to_char(v_cur_day, 'YYYY-MM-DD'),
      'date',  to_char(v_recap_day, 'YYYY-MM-DD'),
      'recap', null
    );
  end if;

  -- champion: top drinker of the day (ties broken by user_id, like the Legend).
  select jsonb_build_object(
           'user_id', t.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path,
           'beer_count', t.c)
  into v_champion
  from (
    select user_id, count(*)::int as c
    from _recap_beers group by user_id
    order by c desc, user_id limit 1
  ) t join public.profiles pr on pr.id = t.user_id;

  -- early bird: first finisher of the day.
  select jsonb_build_object(
           'user_id', b.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path)
  into v_early
  from _recap_beers b join public.profiles pr on pr.id = b.user_id
  where b.is_first;

  -- night owl: the day's last finisher, only if it landed after midnight.
  select jsonb_build_object(
           'user_id', b.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path)
  into v_owl
  from _recap_beers b join public.profiles pr on pr.id = b.user_id
  where b.is_last;

  -- fastest chug: shortest qualifying chug duration (n = seconds).
  select jsonb_build_object(
           'user_id', b.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path,
           'seconds', b.duration_s)
  into v_chug
  from _recap_beers b join public.profiles pr on pr.id = b.user_id
  where b.is_chug
  order by b.duration_s asc, b.empty_taken_at asc, b.id asc
  limit 1;

  -- longest chain of 3+ (n = length).
  select jsonb_build_object(
           'user_id', c.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path,
           'length', c.len)
  into v_chain
  from (
    select user_id, count(*)::int as len
    from _recap_beers group by user_id, grp having count(*) >= 3
    order by len desc limit 1
  ) c join public.profiles pr on pr.id = c.user_id;

  v_recap := jsonb_build_object(
    'total_beers', v_total,
    'champion', v_champion,
    'early_bird', v_early,
    'night_owl', v_owl,
    'fastest_chug', v_chug,
    'longest_chain', v_chain
  );

  return jsonb_build_object(
    'today', to_char(v_cur_day, 'YYYY-MM-DD'),
    'date',  to_char(v_recap_day, 'YYYY-MM-DD'),
    'recap', v_recap
  );
end;
$function$;

-- ---- head_to_head ----
CREATE OR REPLACE FUNCTION public.head_to_head(p_holiday uuid, p_a uuid, p_b uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- A side-by-side comparison would reveal who leads, so block it in the dark.
  if v_state = 'dark' and not v_admin then
    return jsonb_build_object('state', v_state, 'players', null);
  end if;

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
              and extract(hour from g.le) < 7) as is_last,
           (g.claimed_chug) as is_chug,
           extract(epoch from (g.empty_taken_at - g.full_taken_at)) as dur_seconds
    from grouped g
  ),
  scored as (
    select f.*,
           case when f.score_override is not null then f.score_override
           else
             greatest(
               row_number() over (
                 partition by f.user_id, f.grp order by f.empty_taken_at
               ),
               case when f.is_chug then 2 else 1 end
             )
             + case when f.is_morning then 1 else 0 end
             + case when f.is_happy   then 1 else 0 end
             + case when f.is_first   then 1 else 0 end
             + case when f.is_last    then 1 else 0 end
           end as points
    from flagged f
  ),
  agg as (
    select s.user_id,
           count(*)::int as beers,
           coalesce(sum(s.points),0)::int as points,
           count(*) filter (where s.is_chug)::int as chugs,
           count(*) filter (where s.is_morning)::int as morning_beers,
           count(*) filter (where s.is_happy)::int as happy_hours,
           count(*) filter (where s.is_first)::int as early_birds,
           count(*) filter (where s.is_last)::int as night_owls,
           count(distinct s.fin_day)::int as active_days,
           min(s.dur_seconds) filter (where s.is_chug)::int as fastest_chug
    from scored s
    where s.user_id in (p_a, p_b)
    group by s.user_id
  ),
  chains as (
    select user_id, grp, count(*)::int as len
    from flagged
    where user_id in (p_a, p_b)
    group by user_id, grp
  ),
  chain_max as (
    select user_id, max(len)::int as longest_chain
    from chains
    group by user_id
  ),
  ids as (
    select 1 as ord, p_a as uid
    union all
    select 2, p_b
  )
  select jsonb_build_object(
    'state', v_state,
    'players', coalesce(jsonb_agg(x.player order by x.ord), '[]'::jsonb)
  )
  into result
  from (
    select ids.ord,
           jsonb_build_object(
             'user_id', pr.id,
             'display_name', pr.display_name,
             'avatar_path', pr.avatar_path,
             'beers', coalesce(a.beers, 0),
             'points', coalesce(a.points, 0),
             'chugs', coalesce(a.chugs, 0),
             'fastest_chug', a.fastest_chug,
             'longest_chain', coalesce(cm.longest_chain, 0),
             'morning_beers', coalesce(a.morning_beers, 0),
             'happy_hours', coalesce(a.happy_hours, 0),
             'early_birds', coalesce(a.early_birds, 0),
             'night_owls', coalesce(a.night_owls, 0),
             'active_days', coalesce(a.active_days, 0)
           ) as player
    from ids
    join public.profiles pr on pr.id = ids.uid
    left join agg a on a.user_id = ids.uid
    left join chain_max cm on cm.user_id = ids.uid
  ) x;

  return result;
end;
$function$;

-- ---- pace_series ----
CREATE OR REPLACE FUNCTION public.pace_series(p_holiday uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ---- share_card ----
CREATE OR REPLACE FUNCTION public.share_card(p_holiday uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  h public.holidays;
  v_uid uuid;
  v_admin boolean;
  v_state text;
  v_tz text;
  result jsonb;
begin
  v_uid := auth.uid();
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, v_uid) then raise exception 'not a member'; end if;

  v_admin := (h.admin_id = v_uid);
  v_tz := coalesce(h.timezone, 'UTC');
  v_state := public.holiday_state(h);

  -- The rank would reveal who's leading, so block it during the dark finale.
  if v_state = 'dark' and not v_admin then
    return jsonb_build_object('state', v_state, 'card', null);
  end if;

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
              and extract(hour from g.le) < 7) as is_last,
           (g.claimed_chug) as is_chug,
           extract(epoch from (g.empty_taken_at - g.full_taken_at)) as dur_seconds
    from grouped g
  ),
  scored as (
    select f.*,
           case when f.score_override is not null then f.score_override
           else
             greatest(
               row_number() over (
                 partition by f.user_id, f.grp order by f.empty_taken_at
               ),
               case when f.is_chug then 2 else 1 end
             )
             + case when f.is_morning then 1 else 0 end
             + case when f.is_happy   then 1 else 0 end
             + case when f.is_first   then 1 else 0 end
             + case when f.is_last    then 1 else 0 end
           end as points
    from flagged f
  ),
  agg as (
    select s.user_id,
           count(*)::int as beers,
           coalesce(sum(s.points),0)::int as points,
           count(*) filter (where s.is_chug)::int as chugs,
           count(*) filter (where s.is_morning)::int as morning_beers,
           count(*) filter (where s.is_first)::int as early_birds,
           count(*) filter (where s.is_last)::int as night_owls,
           count(distinct s.fin_day)::int as active_days,
           min(s.dur_seconds) filter (where s.is_chug)::int as fastest_chug
    from scored s
    group by s.user_id
  ),
  chains as (
    select user_id, grp, count(*)::int as len from flagged group by user_id, grp
  ),
  chain_max as (
    select user_id, max(len)::int as longest_chain from chains group by user_id
  ),
  -- Every member, so players on zero still count toward the rank denominator.
  member_pts as (
    select m.user_id,
           coalesce(a.points, 0) as points,
           coalesce(a.beers, 0) as beers
    from public.memberships m
    left join agg a on a.user_id = m.user_id
    where m.holiday_id = p_holiday
  ),
  ranked as (
    select user_id, points, beers,
           rank() over (order by points desc, beers desc)::int as rnk,
           count(*) over ()::int as players
    from member_pts
  )
  select jsonb_build_object(
    'state', v_state,
    'card', jsonb_build_object(
      'holiday_name', h.name,
      'display_name', pr.display_name,
      'avatar_path', pr.avatar_path,
      'rank', r.rnk,
      'players', r.players,
      'points', r.points,
      'beers', r.beers,
      'chugs', coalesce(a.chugs, 0),
      'morning_beers', coalesce(a.morning_beers, 0),
      'fastest_chug', a.fastest_chug,
      'longest_chain', coalesce(cm.longest_chain, 0),
      'active_days', coalesce(a.active_days, 0),
      'early_birds', coalesce(a.early_birds, 0),
      'night_owls', coalesce(a.night_owls, 0)
    )
  )
  into result
  from ranked r
  join public.profiles pr on pr.id = r.user_id
  left join agg a on a.user_id = r.user_id
  left join chain_max cm on cm.user_id = r.user_id
  where r.user_id = v_uid;

  return result;
end;
$function$;

-- ---- trip_stats ----
CREATE OR REPLACE FUNCTION public.trip_stats(p_holiday uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'chugs', (select count(*)::int from elig where claimed_chug),
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
        where claimed_chug
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
$function$;

-- ---- user_achievements ----
CREATE OR REPLACE FUNCTION public.user_achievements(p_holiday uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Your own trophy case is always visible; others' are hidden while dark.
  if v_state = 'dark' and not v_admin and p_user <> auth.uid() then
    raise exception 'board is dark';
  end if;

  with base as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           (b.full_taken_at  at time zone v_tz) as lf,
           (b.empty_taken_at at time zone v_tz) as le,
           ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date as fin_day
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  marks as (
    select base.*,
           (row_number() over (partition by fin_day order by empty_taken_at asc,  id asc)  = 1) as is_first,
           (row_number() over (partition by fin_day order by empty_taken_at desc, id desc) = 1
              and extract(hour from le) < 7) as is_last,
           (claimed_chug) as is_chug,
           (extract(hour from lf) between 7 and 10) as is_morning
    from base
  ),
  per_user_day as (
    select user_id, fin_day, count(*) as n
    from base
    group by user_id, fin_day
  ),
  day_max as (
    select fin_day, max(n) as mx from per_user_day group by fin_day
  ),
  legend as (
    select pud.user_id, count(*) as days
    from per_user_day pud
    join day_max dm on dm.fin_day = pud.fin_day
    where pud.n = dm.mx and dm.mx >= 1
    group by pud.user_id
  ),
  tally as (
    select m.user_id,
           count(*)                          as beers,
           count(*) filter (where is_chug)   as chugs,
           count(*) filter (where is_morning) as mornings,
           count(*) filter (where is_first)  as early_days,
           count(*) filter (where is_last)   as night_days
    from marks m
    group by m.user_id
  )
  select jsonb_build_object(
    'centurion',      coalesce((select floor(beers   / 100.0)::int from tally where user_id = p_user), 0),
    'legend_of_day',  coalesce((select days                       from legend where user_id = p_user), 0),
    'early_bird',     coalesce((select early_days                 from tally where user_id = p_user), 0),
    'night_owl',      coalesce((select night_days                 from tally where user_id = p_user), 0),
    'chug_master',    coalesce((select floor(chugs    / 10.0)::int from tally where user_id = p_user), 0),
    'breakfast_club', coalesce((select floor(mornings / 5.0)::int  from tally where user_id = p_user), 0)
  ) into result;

  return coalesce(result, '{}'::jsonb);
end;
$function$;

-- ---- user_ledger ----
CREATE OR REPLACE FUNCTION public.user_ledger(p_holiday uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           ((b.full_taken_at at time zone v_tz) - interval '7 hours')::date as hh_day,
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
           (g.claimed_chug) as is_chug,
           greatest(
             row_number() over (
               partition by g.user_id, g.grp order by g.empty_taken_at
             ),
             case when g.claimed_chug
                  then 2 else 1 end
           ) as bonus,
           (extract(hour from g.lf)::int = public.happy_hour_for(p_holiday, g.hh_day)) as is_happy
    from grouped g
  ),
  day_marks as (
    select b.id,
           (row_number() over (
              partition by ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date
              order by b.empty_taken_at asc, b.id asc) = 1) as is_first,
           (row_number() over (
              partition by ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date
              order by b.empty_taken_at desc, b.id desc) = 1
            and extract(hour from (b.empty_taken_at at time zone v_tz)) < 7) as is_last
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  allb as (
    select b.id, b.full_taken_at, b.empty_taken_at, b.status, b.claimed_chug,
           b.full_photo_path, b.empty_photo_path, b.is_offline,
           b.score_override, b.score_override_reason, b.caption, b.brand
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
  ),
  reacts as (
    select beer_id, jsonb_object_agg(emoji, cnt) as counts
    from (
      select beer_id, emoji, count(*)::int as cnt
        from public.beer_reactions
       where beer_id in (select id from allb)
       group by beer_id, emoji
    ) z
    group by beer_id
  ),
  mine as (
    select beer_id, emoji
      from public.beer_reactions
     where user_id = auth.uid()
       and beer_id in (select id from allb)
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'beer_id', a.id,
             'full_taken_at', a.full_taken_at,
             'empty_taken_at', a.empty_taken_at,
             'status', a.status,
             'is_chug', coalesce(
               s.is_chug,
               a.claimed_chug
             ),
             'streak_position', coalesce(s.streak_position, 0),
             'is_morning', (extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10),
             'is_happy_hour', coalesce(s.is_happy, false),
             'is_early_bird', coalesce(dm.is_first, false),
             'is_night_owl', coalesce(dm.is_last, false),
             'is_offline', a.is_offline,
             'score_override', a.score_override,
             'override_reason', a.score_override_reason,
             'caption', a.caption,
             'brand', a.brand,
             'reactions', coalesce(rc.counts, '{}'::jsonb),
             'my_reaction', mr.emoji,
             'points', case
               when a.status = 'rejected' then 0
               when a.score_override is not null then a.score_override
               else coalesce(s.bonus, 1)
                    + case when extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10
                           then 1 else 0 end
                    + case when coalesce(s.is_happy,  false) then 1 else 0 end
                    + case when coalesce(dm.is_first, false) then 1 else 0 end
                    + case when coalesce(dm.is_last,  false) then 1 else 0 end
             end,
             'reviews_total', coalesce(r.total, 0),
             'reviews_challenged', coalesce(r.challenged, 0),
             'full_photo_path', a.full_photo_path,
             'empty_photo_path', a.empty_photo_path
           ) order by a.full_taken_at desc
         ), '[]'::jsonb)
  into result
  from allb a
  left join scored s     on s.id  = a.id
  left join day_marks dm on dm.id = a.id
  left join rev r        on r.beer_id = a.id
  left join reacts rc    on rc.beer_id = a.id
  left join mine mr      on mr.beer_id = a.id;

  return result;
end;
$function$;

select public.refresh_snapshot(id) from public.holidays;