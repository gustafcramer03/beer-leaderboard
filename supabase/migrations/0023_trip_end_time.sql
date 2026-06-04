-- Let the admin schedule the trip end down to the hour and minute.
--
-- Until now the board flipped to 'reveal' at midnight (start of end_date) in the
-- trip's timezone, and 'dark' began dark_days before that. We add an end_time so
-- the admin can pick the exact moment (e.g. 18:00 on the last day) instead of
-- always midnight. holiday_state now compares now() against that precise instant,
-- and get_latest_standings exposes the same instant as reveal_at for the
-- countdown. A small admin-only RPC lets the admin update date + time together.

alter table public.holidays
  add column if not exists end_time time not null default '00:00';

-- State now resolves against the precise reveal instant (end_date + end_time in
-- the trip tz). Dark begins dark_days before that instant. forced_state still wins.
create or replace function public.holiday_state(h public.holidays)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when h.forced_state is not null then h.forced_state
    when now() >= ((h.end_date + h.end_time) at time zone coalesce(h.timezone, 'UTC'))
      then 'reveal'
    when now() >= (((h.end_date + h.end_time) at time zone coalesce(h.timezone, 'UTC'))
                   - (h.dark_days || ' days')::interval)
      then 'dark'
    else 'live'
  end;
$$;

-- Admin updates the scheduled end (date + time), then re-snapshots so the board
-- reflects any state change immediately.
create or replace function public.set_trip_end(
  p_holiday uuid,
  p_end_date date,
  p_end_time time
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if h.admin_id <> auth.uid() then raise exception 'admin only'; end if;

  update public.holidays
     set end_date = p_end_date,
         end_time = p_end_time
   where id = p_holiday;

  perform public.refresh_snapshot(p_holiday);
end;
$$;

grant execute on function public.set_trip_end(uuid, date, time) to authenticated;

-- Re-create get_latest_standings so reveal_at carries the new end_time. Body is
-- otherwise unchanged from 0020.
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
  v_reveal_at timestamptz;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_admin := (h.admin_id = auth.uid());
  v_state := public.holiday_state(h);
  v_reveal_at := ((h.end_date + h.end_time) at time zone coalesce(h.timezone, 'UTC'));

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
    'reveal_at', v_reveal_at,
    'standings', case when v_show then coalesce(v_snap.standings, '[]'::jsonb) else null end
  );
end;
$$;
