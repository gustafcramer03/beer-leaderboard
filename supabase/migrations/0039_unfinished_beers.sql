-- Unfinished-beer penalty mechanic.
--
-- A beer left unfinished is declared by its owner (via the resolution gate when
-- a started beer is >90 min old, or the "I didn't finish this beer" button on
-- the empty-photo step). It moves to status='unfinished' and is worth -1 point
-- until an admin rules on it. The admin can UPHOLD (-1 stands) or REINSTATE
-- (award +1 instead). An unfinished beer stays in status='unfinished' forever;
-- its point contribution is coalesce(score_override, -1): default -1, and
-- Reinstate just sets score_override = 1 (fits the existing 0-100 constraint).
-- admin_ruled_at marks it finalised / out of the rulings queue.
--
-- Unfinished beers never enter beer_count, chains, streaks or bonuses (those all
-- require an empty photo); they are a pure points adjustment. Readers that only
-- count finished beers (audit_queue, user_achievements, daily_recap) already
-- exclude them via the empty-photo filter and are left unchanged. trip_stats
-- derives total_points from the snapshot, so it inherits the change for free
-- once compute_standings is updated and a fresh snapshot is taken.

-- ---------------------------------------------------------------------------
-- Schema: new status value + the user's explanation note.
-- ---------------------------------------------------------------------------
alter table public.beers drop constraint if exists beers_status_check;
alter table public.beers add constraint beers_status_check
  check (status in ('open','pending','challenged','confirmed','rejected','unfinished'));

alter table public.beers add column if not exists unfinished_note text
  check (unfinished_note is null or char_length(unfinished_note) <= 200);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- The caller's own started-but-unfinished beers that are now overdue (>90 min
-- since the full photo). Drives the resolution gate on app open.
create or replace function public.overdue_open_beers(p_holiday uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'full_taken_at', b.full_taken_at,
           'full_photo_path', b.full_photo_path
         ) order by b.full_taken_at asc), '[]'::jsonb)
  from public.beers b
  where b.holiday_id = p_holiday
    and b.user_id = auth.uid()
    and b.status = 'open'
    and b.full_photo_path is not null
    and b.full_taken_at < now() - interval '90 minutes';
$$;
grant execute on function public.overdue_open_beers(uuid) to authenticated;

-- Owner declares one of their open beers unfinished: -1 point, raised to the
-- admin rulings queue. No empty photo is uploaded.
create or replace function public.declare_beer_unfinished(p_beer uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
begin
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if b.user_id <> auth.uid() then raise exception 'not your beer'; end if;
  if b.status <> 'open' then raise exception 'beer is not open'; end if;

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set status = 'unfinished',
         unfinished_note = nullif(left(trim(coalesce(p_note, '')), 200), '')
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;
grant execute on function public.declare_beer_unfinished(uuid, text) to authenticated;

-- Admin rules on an unfinished beer. Uphold -> stays -1 (score_override null).
-- Reinstate -> +1 (score_override = 1). Either way it leaves the queue
-- (admin_ruled_at set) and keeps status='unfinished'.
create or replace function public.admin_rule_unfinished(p_beer uuid, p_uphold boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
begin
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if not public.is_admin(b.holiday_id, auth.uid()) then raise exception 'admin only'; end if;
  if b.status <> 'unfinished' then raise exception 'beer is not unfinished'; end if;

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set score_override = case when p_uphold then null else 1 end,
         score_override_reason = nullif(left(trim(coalesce(p_reason, '')), 200), ''),
         admin_ruled_at = now()
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;
grant execute on function public.admin_rule_unfinished(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- compute_standings: add the per-user unfinished adjust to points.
-- ---------------------------------------------------------------------------
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
           (row_number() over (partition by g.fin_day order by g.empty_taken_at asc,  g.id asc)  = 1) as is_first,
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
  adjust as (
    select b.user_id, sum(coalesce(b.score_override, -1))::int as adj
    from public.beers b
    where b.holiday_id = p_holiday and b.status = 'unfinished'
    group by b.user_id
  ),
  everyone as (
    select m.user_id, pr.display_name,
           coalesce(t.points,0) + coalesce(aj.adj,0) as points,
           coalesce(t.beer_count,0) as beer_count
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    left join totals t on t.user_id = m.user_id
    left join adjust aj on aj.user_id = m.user_id
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

-- ---------------------------------------------------------------------------
-- user_ledger: surface unfinished beers as -1 / +1 entries.
-- ---------------------------------------------------------------------------
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
           b.score_override, b.score_override_reason, b.unfinished_note, b.caption, b.brand
    from public.beers b
    where b.holiday_id = p_holiday
      and b.user_id = p_user
      and b.status <> 'open'
      and (b.empty_taken_at is not null or b.status = 'unfinished')
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
             'override_reason', case when a.status = 'unfinished' then a.unfinished_note
                                     else a.score_override_reason end,
             'caption', a.caption,
             'brand', a.brand,
             'reactions', coalesce(rc.counts, '{}'::jsonb),
             'my_reaction', mr.emoji,
             'points', case
               when a.status = 'unfinished' then coalesce(a.score_override, -1)
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

-- ---------------------------------------------------------------------------
-- admin_beers: include unfinished beers, score them coalesce(override,-1),
-- and surface unfinished_note + admin_ruled_at for the rulings panel.
-- ---------------------------------------------------------------------------
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
           b.score_override, b.score_override_reason, b.unfinished_note,
           b.admin_ruled_at, b.caption, b.brand, b.created_at
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
             'unfinished_note', a.unfinished_note,
             'admin_ruled_at', a.admin_ruled_at,
             'caption', a.caption,
             'brand', a.brand,
             'points', case
               when a.status = 'unfinished' then coalesce(a.score_override, -1)
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

-- ---------------------------------------------------------------------------
-- share_card: fold the unfinished adjust into the player's points.
-- ---------------------------------------------------------------------------
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
  adjust as (
    select b.user_id, sum(coalesce(b.score_override, -1))::int as adj
    from public.beers b
    where b.holiday_id = p_holiday and b.status = 'unfinished'
    group by b.user_id
  ),
  member_pts as (
    select m.user_id,
           coalesce(a.points, 0) + coalesce(adj.adj, 0) as points,
           coalesce(a.beers, 0) as beers
    from public.memberships m
    left join agg a on a.user_id = m.user_id
    left join adjust adj on adj.user_id = m.user_id
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

-- ---------------------------------------------------------------------------
-- head_to_head: fold the unfinished adjust into each player's points.
-- ---------------------------------------------------------------------------
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
  adjust as (
    select b.user_id, sum(coalesce(b.score_override, -1))::int as adj
    from public.beers b
    where b.holiday_id = p_holiday and b.status = 'unfinished'
      and b.user_id in (p_a, p_b)
    group by b.user_id
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
             'points', coalesce(a.points, 0) + coalesce(adj.adj, 0),
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
    left join adjust adj on adj.user_id = ids.uid
    left join chain_max cm on cm.user_id = ids.uid
  ) x;

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- pace_series: add unfinished beers as point-only events (no beer count) at
-- their full_taken_at, so the cumulative points line dips/rises correctly.
-- ---------------------------------------------------------------------------
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
    select f.user_id, f.empty_taken_at as t, 1 as is_beer,
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
  unfinished_pts as (
    select b.user_id, b.full_taken_at as t, 0 as is_beer,
           coalesce(b.score_override, -1) as pts
    from public.beers b
    where b.holiday_id = p_holiday and b.status = 'unfinished'
      and b.full_taken_at >= v_start_ts and b.full_taken_at < v_end_ts
  ),
  all_pts as (
    select * from beer_pts
    union all
    select * from unfinished_pts
  ),
  pl_events as (
    select user_id, t,
           (sum(is_beer) over (partition by user_id order by t rows unbounded preceding))::int as beers,
           (sum(pts)     over (partition by user_id order by t rows unbounded preceding))::int as points
    from all_pts
  ),
  gr_events as (
    select t,
           (sum(is_beer) over (order by t, user_id rows unbounded preceding))::int as beers,
           (sum(pts)     over (order by t, user_id rows unbounded preceding))::int as points
    from all_pts
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
      coalesce((select sum(is_beer)::int from all_pts e where e.user_id = mem.user_id), 0) as beer_total,
      coalesce((select sum(pts)::int     from all_pts e where e.user_id = mem.user_id), 0) as point_total
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

-- Re-snapshot every holiday so boards reflect the new accounting immediately.
select public.refresh_snapshot(id) from public.holidays;
