-- Admin "adjust score" with a reason.
--
-- When an admin hand-sets a beer's points (admin_set_beer_score), they can now
-- attach a short note explaining WHY (e.g. "claimed a chug they clearly walked").
-- The note rides alongside score_override on the beer; user_ledger surfaces it so
-- the "Adjusted ✎" badge can reveal the reason on tap. Clearing the override
-- (uphold/reject) clears the note too.

alter table public.beers
  add column if not exists score_override_reason text
  check (score_override_reason is null or char_length(score_override_reason) <= 200);

-- ---------------------------------------------------------------------------
-- Set score now takes an optional reason. We drop the old 2-arg signature so
-- PostgREST resolves the call unambiguously to this 3-arg version.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_set_beer_score(uuid, int);

create or replace function public.admin_set_beer_score(
  p_beer uuid,
  p_points int,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
  v_reason text;
begin
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if not public.is_admin(b.holiday_id, auth.uid()) then raise exception 'admin only'; end if;
  if p_points is null or p_points < 0 or p_points > 100 then
    raise exception 'points must be between 0 and 100';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_reason := left(v_reason, 200);

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set status = 'confirmed',
         score_override = p_points,
         score_override_reason = v_reason,
         admin_ruled_at = now()
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;

grant execute on function public.admin_set_beer_score(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Uphold / reject clears any prior override AND its reason.
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
         score_override = null,
         score_override_reason = null,
         admin_ruled_at = now()
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-player ledger: also return the override reason (everything else as in 0015).
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
           (g.claimed_chug or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds') as is_chug,
           greatest(
             row_number() over (
               partition by g.user_id, g.grp order by g.empty_taken_at
             ),
             case when g.claimed_chug
                       or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds'
                  then 2 else 1 end
           ) as bonus,
           (extract(hour from g.lf)::int = public.happy_hour_for(p_holiday, g.hh_day)) as is_happy
    from grouped g
  ),
  -- Group-wide first/last finisher per day; night owl gated to after midnight.
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
           b.score_override, b.score_override_reason
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
             'is_happy_hour', coalesce(s.is_happy, false),
             'is_early_bird', coalesce(dm.is_first, false),
             'is_night_owl', coalesce(dm.is_last, false),
             'is_offline', a.is_offline,
             'score_override', a.score_override,
             'override_reason', a.score_override_reason,
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
  left join scored s    on s.id  = a.id
  left join day_marks dm on dm.id = a.id
  left join rev r       on r.beer_id = a.id;

  return result;
end;
$$;
