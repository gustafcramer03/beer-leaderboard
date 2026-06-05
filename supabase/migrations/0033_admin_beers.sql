-- Admin "manage beers" board.
--
-- The rulings queue (admin_rule_beer / challengedBeers) only surfaces beers that
-- are currently status='challenged'. Once an admin rules (confirm/reject) or sets
-- a score, the beer leaves the queue — leaving no way to revisit a *decided* beer
-- and fix a mistake. This RPC backs an admin-only "Manage beers" screen that lists
-- EVERY non-open beer in the trip (all players), with its current status, the
-- effective points it is contributing right now, any override + reason, caption,
-- chug/offline flags and photo paths — so the admin can re-score, void or
-- reinstate any of them via the existing admin_set_beer_score / admin_rule_beer.
--
-- Points are computed with the same CTE pipeline as user_ledger (0029), only
-- without the single-user filter, so the figure shown matches the leaderboard.

create or replace function public.admin_beers(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
           b.score_override, b.score_override_reason, b.caption, b.created_at
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
               a.claimed_chug or (a.empty_taken_at - a.full_taken_at) <= interval '60 seconds'
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
$$;

grant execute on function public.admin_beers(uuid) to authenticated;
