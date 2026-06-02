-- Rule tweaks (Gustaf's answers to the open questions):
--  1. Per-beer points already take greatest(streak, chug) — keep "higher of the two".
--  2. Streak now keys off the PREVIOUS beer's START time (full_taken_at), not its
--     empty time; and the chug bonus drops from 3 -> 2.
--  3. Dark window: the admin no longer sees standings automatically during the dark
--     stretch — they must deliberately peek (p_admin_peek = true).

-- ---------------------------------------------------------------------------
-- Scoring: chug = 2, streak reference = previous beer's start time.
-- Points per beer = greatest(streak position, chug bonus).
--   * base                    = 1
--   * chug (<=60s or claimed)  = 2
--   * streak: beers are ordered by full_taken_at (start); a beer extends the run
--     when its start is within 5 min of the PREVIOUS beer's start. position = points.
-- Only finished beers (empty_taken_at set) in pending/challenged/confirmed count.
create or replace function public.compute_standings(p_holiday uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with scored as (
    select b.user_id,
           greatest(
             row_number() over (
               partition by b.user_id, grp order by b.full_taken_at
             ),
             case when b.claimed_chug
                       or (b.empty_taken_at - b.full_taken_at) <= interval '60 seconds'
                  then 2 else 1 end
           ) as points
    from (
      select b.*,
             sum(case when prev_start is null
                        or b.full_taken_at - prev_start > interval '5 minutes'
                      then 1 else 0 end)
               over (partition by b.user_id order by b.full_taken_at) as grp
      from (
        select b.*,
               lag(b.full_taken_at) over (
                 partition by b.user_id order by b.full_taken_at
               ) as prev_start
        from public.beers b
        where b.holiday_id = p_holiday
          and b.status in ('pending','challenged','confirmed')
          and b.empty_taken_at is not null
      ) b
    ) b
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
-- Dark-mode gating: admin can peek, but only on demand.
-- Returns { state, is_admin, can_peek, generated_at, standings }.
--   * standings is null during 'dark' unless (admin AND p_admin_peek).
--   * can_peek = true tells the admin UI to offer a deliberate "peek" button.
drop function if exists public.get_latest_standings(uuid);

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

  if current_date >= h.end_date then
    v_state := 'reveal';
  elsif current_date >= (h.end_date - h.dark_days) then
    v_state := 'dark';
  else
    v_state := 'live';
  end if;

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

grant execute on function public.get_latest_standings(uuid, boolean) to authenticated;
