-- Trip activity window: beers can only be logged while the trip is actually on.
--
-- The trip now has a start_time as well as the existing end_time. Uploads (both
-- online and offline) are blocked before start_date+start_time and on/after
-- end_date+end_time (or once the admin has forced the reveal). These times also
-- already drive the reveal / dark-mode timing via holiday_state(end_date+end_time).
--
-- IMPORTANT: this only gates uploads and the reveal — it does NOT change any
-- scoring/stats mechanics. Beer-days stay 7am-7am and every reader is untouched.

-- Start-of-day default keeps existing (already-running) trips active.
alter table public.holidays add column if not exists start_time time not null default '00:00:00';

-- ---------------------------------------------------------------------------
-- Gate the insert trigger on the trip window (covers startBeer AND the offline
-- RPC, which both insert into beers). Clear error codes the client maps to a
-- friendly message.
-- ---------------------------------------------------------------------------
create or replace function public.beers_before_insert()
returns trigger
language plpgsql
as $function$
declare
  hh public.holidays;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
begin
  select * into hh from public.holidays where id = new.holiday_id;
  if found then
    v_start_ts := ((hh.start_date + hh.start_time) at time zone coalesce(hh.timezone, 'UTC'));
    v_end_ts   := ((hh.end_date   + hh.end_time)   at time zone coalesce(hh.timezone, 'UTC'));
    if now() < v_start_ts then
      raise exception 'trip_not_started';
    end if;
    if now() >= v_end_ts or hh.forced_state = 'reveal' then
      raise exception 'trip_ended';
    end if;
  end if;

  -- The offline RPC sets this transaction-local flag; trust its values verbatim.
  if current_setting('app.allow_manual_beer', true) = '1' then
    return new;
  end if;

  -- Default path: server-authoritative timestamps, ignore client values.
  new.full_taken_at  := now();
  new.empty_taken_at := null;
  new.status         := 'open';
  new.empty_photo_path := null;
  new.is_offline     := false;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- upload_window: the client asks "can I log right now?" to gate the log UI
-- (server trigger above is the real backstop). phase = pre | open | ended.
-- ---------------------------------------------------------------------------
create or replace function public.upload_window(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  h public.holidays;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_state text;
  v_phase text;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_start_ts := ((h.start_date + h.start_time) at time zone coalesce(h.timezone, 'UTC'));
  v_end_ts   := ((h.end_date   + h.end_time)   at time zone coalesce(h.timezone, 'UTC'));
  v_state := public.holiday_state(h);

  if now() < v_start_ts then
    v_phase := 'pre';
  elsif now() >= v_end_ts or v_state = 'reveal' then
    v_phase := 'ended';
  else
    v_phase := 'open';
  end if;

  return jsonb_build_object(
    'phase', v_phase,
    'starts_at', (extract(epoch from v_start_ts) * 1000)::bigint,
    'ends_at',   (extract(epoch from v_end_ts)   * 1000)::bigint
  );
end;
$function$;
grant execute on function public.upload_window(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_trip_start: admin sets the start date + time (mirrors set_trip_end).
-- ---------------------------------------------------------------------------
create or replace function public.set_trip_start(p_holiday uuid, p_start_date date, p_start_time time)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  h public.holidays;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if h.admin_id <> auth.uid() then raise exception 'admin only'; end if;

  update public.holidays
     set start_date = p_start_date,
         start_time = p_start_time
   where id = p_holiday;

  perform public.refresh_snapshot(p_holiday);
end;
$function$;
grant execute on function public.set_trip_start(uuid, date, time) to authenticated;

-- ---------------------------------------------------------------------------
-- create_holiday: now takes start_time + end_time so the create form can set
-- both. Drop the old 5-arg signature first to avoid an overload.
-- ---------------------------------------------------------------------------
drop function if exists public.create_holiday(text, date, date, integer, text);

create or replace function public.create_holiday(
  p_name text,
  p_start date,
  p_end date,
  p_dark_days integer,
  p_timezone text default 'UTC',
  p_start_time time default '00:00:00',
  p_end_time time default '00:00:00'
)
returns holidays
language plpgsql
security definer
set search_path = public
as $function$
declare
  h public.holidays;
  v_tz text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_tz := p_timezone;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;

  insert into public.holidays(
    name, start_date, end_date, dark_days, admin_id, invite_code, timezone, start_time, end_time
  )
  values (
    p_name, p_start, p_end, greatest(p_dark_days, 0), auth.uid(), public.gen_invite_code(), v_tz,
    coalesce(p_start_time, '00:00:00'), coalesce(p_end_time, '00:00:00')
  )
  returning * into h;

  insert into public.memberships(holiday_id, user_id) values (h.id, auth.uid());
  perform public.refresh_snapshot(h.id);
  return h;
end;
$function$;
grant execute on function public.create_holiday(text, date, date, integer, text, time, time) to authenticated;
