-- Admin per-beer score override.
--
-- An admin ruling on a challenged beer can now accept it as legit but set its
-- points by hand (e.g. someone claimed a chug they didn't actually do, or a
-- "chain" that was gamed). A nullable score_override on the beer wins over the
-- computed score: when set, the beer is worth exactly that many points; when
-- null, the normal chug/chain/morning rules apply. Rejected beers still score 0.
--
-- Morning beers aren't spoofable, so there's deliberately no per-bonus toggle —
-- the admin just dials in the final number for that one beer.

alter table public.beers
  add column if not exists score_override int
  check (score_override is null or (score_override >= 0 and score_override <= 100));

-- ---------------------------------------------------------------------------
-- Scoring: honour score_override when present, else compute as before
-- (chug=2, streak on start time, morning +1 additive, greatest of chug/streak).
-- ---------------------------------------------------------------------------
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
    select b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug, b.score_override,
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
           case when g.score_override is not null then g.score_override
           else
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
           end as points
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

-- ---------------------------------------------------------------------------
-- Per-player ledger: surface score_override and reflect it in points.
-- ---------------------------------------------------------------------------
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

  if current_date >= h.end_date then
    v_state := 'reveal';
  elsif current_date >= (h.end_date - h.dark_days) then
    v_state := 'dark';
  else
    v_state := 'live';
  end if;
  if v_state = 'dark' and not v_admin then
    raise exception 'board is dark';
  end if;

  with eligible as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           lag(b.full_taken_at) over (
             partition by b.user_id order by b.full_taken_at
           ) as prev_start
    from public.beers b
    where b.holiday_id = p_holiday
      and b.user_id = p_user
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  grouped as (
    select e.*,
           sum(case when prev_start is null
                      or full_taken_at - prev_start > interval '5 minutes'
                    then 1 else 0 end)
             over (partition by user_id order by full_taken_at) as grp
    from eligible e
  ),
  scored as (
    select g.id,
           row_number() over (
             partition by g.user_id, g.grp order by g.full_taken_at
           ) as streak_position,
           (g.claimed_chug or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds') as is_chug,
           greatest(
             row_number() over (
               partition by g.user_id, g.grp order by g.full_taken_at
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

-- ---------------------------------------------------------------------------
-- Admin sets an explicit point value for a beer (accepts it as legit but
-- overrides the computed bonus). Confirms the beer and refreshes the board.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_beer_score(p_beer uuid, p_points int)
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
  if p_points is null or p_points < 0 or p_points > 100 then
    raise exception 'points must be between 0 and 100';
  end if;

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set status = 'confirmed', score_override = p_points
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;

grant execute on function public.admin_set_beer_score(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Uphold/Reject now clears any prior override (back to normal scoring) and
-- refreshes the snapshot so the board reflects the ruling straight away.
-- ---------------------------------------------------------------------------
create or replace function public.admin_rule_beer(p_beer uuid, p_decision text)
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
  if p_decision not in ('confirm','reject') then raise exception 'bad decision'; end if;

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set status = case when p_decision = 'confirm' then 'confirmed' else 'rejected' end,
         score_override = null
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;
