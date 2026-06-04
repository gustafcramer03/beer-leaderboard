-- Expose the scheduled reveal moment so the dark screen can show a countdown.
--
-- The board flips to 'reveal' on end_date (see holiday_state). reveal_at is the
-- exact instant that happens: midnight at the start of end_date in the trip's
-- own timezone, returned as a timestamptz. It's always the natural end of the
-- trip even when the admin has forced the board dark, so the countdown is
-- meaningful regardless of forced_state. Body is otherwise unchanged from 0011.

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
  v_reveal_at := (h.end_date::timestamp at time zone coalesce(h.timezone, 'UTC'));

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
