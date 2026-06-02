-- Per-player ledger: every finished beer for one user with its scoring breakdown
-- and challenge tally, for the tap-through view on the leaderboard.
--
-- Returns a JSON array (most recent first) of:
--   { beer_id, full_taken_at, empty_taken_at, status, is_chug, streak_position,
--     is_morning, points, reviews_total, reviews_challenged,
--     full_photo_path, empty_photo_path }
--
-- Scoring mirrors compute_standings exactly (chug=2, streak on start time,
-- morning +1 additive, greatest of chug/streak). Rejected beers show 0 points
-- and are excluded from the streak ordering, but still appear so the owner can
-- see the challenge result. Open (unfinished) beers are omitted.
--
-- Gated like the board: blocked for non-admins during the dark window.
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
           b.full_photo_path, b.empty_photo_path
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
             'points', case
               when a.status = 'rejected' then 0
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

grant execute on function public.user_ledger(uuid, uuid) to authenticated;
