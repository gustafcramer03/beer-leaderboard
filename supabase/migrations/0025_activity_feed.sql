-- Live activity feed — only the *bigger* moments, never every beer.
--
-- activity_feed(holiday, limit) derives notable events on the fly from the beers
-- table (no event table to keep in sync), reusing the exact compute_standings
-- scoring so "took the lead" matches the board. Event types:
--   chug          - someone chugged a beer
--   early_bird    - first finisher of the day
--   night_owl     - last finisher of a completed day, after midnight
--   happy_hour_start - a day's happy hour just began (no user; a call to arms)
--   happy_hour_end   - that happy hour ended (no user; n = beers landed in it)
--   chain         - a completed chain of 3+ (n = final length)
--   day_milestone - a player's 10th beer of the day, then every 5th (n = count)
--   trip_milestone- a player's 10th beer of the trip, then 25th & every 25 (n)
--   lead          - a player overtook to take the #1 spot
--   legend        - top drinker of a completed day (n = beers that day)
--   first_blood   - the very first beer of the whole trip
--
-- Withheld while the board is dark for non-admins (it would leak standings).

create or replace function public.activity_feed(p_holiday uuid, p_limit int default 50)
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
           (g.claimed_chug or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds') as is_chug
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
$$;

grant execute on function public.activity_feed(uuid, int) to authenticated;
