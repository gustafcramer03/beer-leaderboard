-- Head-to-head rivalry card: compare two players' stats side by side.
--
-- Two member-facing helpers:
--   holiday_members(holiday)            -> roster (id, name, avatar) for the picker
--   head_to_head(holiday, user_a, user_b) -> matched stats for both players
--
-- head_to_head reuses the exact eligibility + scoring from compute_standings
-- (chug/chain bonus + morning + happy hour + early bird + night owl), so the
-- points it reports match the league table. It is withheld while the board is
-- dark for non-admins, since a side-by-side comparison would leak who's ahead.

-- Roster for the picker. Member names aren't secret (the board shows them), so
-- this is available regardless of board state.
create or replace function public.holiday_members(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;
  return (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'user_id', pr.id,
               'display_name', pr.display_name,
               'avatar_path', pr.avatar_path
             ) order by pr.display_name asc
           ), '[]'::jsonb)
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    where m.holiday_id = p_holiday
  );
end;
$$;

grant execute on function public.holiday_members(uuid) to authenticated;

create or replace function public.head_to_head(
  p_holiday uuid,
  p_a uuid,
  p_b uuid
)
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
$$;

grant execute on function public.head_to_head(uuid, uuid, uuid) to authenticated;
