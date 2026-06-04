-- Share card stats: the caller's own headline numbers for a branded, shareable
-- image (Instagram story etc.). share_card(holiday) returns the current user's
-- rank, points, beers and a few highlight stats, reusing the exact
-- compute_standings eligibility + scoring so the figures match the league table.
--
-- Rank is computed across every member (even those on zero) ordered like the
-- board: points desc, beers desc. Withheld while the board is dark for
-- non-admins, since the rank would leak who's ahead before the reveal.

create or replace function public.share_card(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
           (g.claimed_chug or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds') as is_chug,
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
$$;

grant execute on function public.share_card(uuid) to authenticated;
