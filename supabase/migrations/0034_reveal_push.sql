-- Web push — phase 2: the grand-reveal moment.
--
-- Fire a one-off push to every member when a trip flips into 'reveal' state —
-- either because now() crossed (end_date + end_time) in its tz, or because the
-- admin forced it via set_holiday_state(..., 'reveal'). Reuses the exact same
-- pg_cron + pg_net + Vercel-route pipeline as the happy-hour push (0028); the
-- route already fans out generic {title, body} events, so no new endpoint.
--
-- We deliberately add ONLY the reveal notification here — not the other mooted
-- phases (beers-to-audit, challenge-on-your-beer).

-- 'reveal' joins 'start'/'end' as a valid dedup kind. One reveal per trip.
alter table public.push_sent_log drop constraint if exists push_sent_log_kind_check;
alter table public.push_sent_log
  add constraint push_sent_log_kind_check check (kind in ('start','end','reveal'));

-- ---- reveal due-events builder --------------------------------------------

-- Returns { events: [ { holiday_id, kind:'reveal', tag, title, body, subscriptions } ] }
-- for every holiday currently in reveal state that hasn't been announced yet.
-- Unlike the happy-hour builder we log the dedup row ONLY once we have at least
-- one subscriber, so a reveal that lands while nobody's subscribed yet retries
-- next hour and can still catch people who turn notifications on later. (The
-- reveal is a once-per-trip moment, so it's worth being patient about.)
create or replace function public.reveal_push_due()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events jsonb := '[]'::jsonb;
  r record;
  v_subs jsonb;
begin
  for r in
    select h.id, h.name, h.end_date
    from public.holidays h
    where public.holiday_state(h) = 'reveal'
  loop
    -- already announced this trip's reveal?
    if exists (
      select 1 from public.push_sent_log l
      where l.holiday_id = r.id and l.kind = 'reveal'
    ) then
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      into v_subs
    from public.push_subscriptions s
    join public.memberships m on m.user_id = s.user_id
    where m.holiday_id = r.id;

    if jsonb_array_length(v_subs) = 0 then
      continue;  -- nobody to tell yet; don't log, so we retry next hour
    end if;

    insert into public.push_sent_log(holiday_id, event_date, kind)
      values (r.id, r.end_date, 'reveal')
      on conflict do nothing;

    v_events := v_events || jsonb_build_array(jsonb_build_object(
      'holiday_id', r.id,
      'kind', 'reveal',
      'tag', 'reveal',
      'title', '🏆 The Grand Reveal!',
      'body', r.name || ' — the trip''s over. Open the app to see who''s top of the hops! 🍺',
      'subscriptions', v_subs
    ));
  end loop;

  return jsonb_build_object('events', v_events);
end;
$$;

-- ---- unified dispatcher (happy-hour + reveal in one POST) ------------------

create or replace function public.dispatch_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg private.push_config;
  v_events jsonb;
begin
  select * into v_cfg from private.push_config where id = 1;
  if not found then return; end if;  -- not configured yet

  v_events := coalesce(public.happy_hour_push_due() -> 'events', '[]'::jsonb)
            || coalesce(public.reveal_push_due() -> 'events', '[]'::jsonb);

  if jsonb_array_length(v_events) = 0 then
    return;
  end if;

  perform net.http_post(
    url := v_cfg.endpoint_url,
    body := jsonb_build_object('events', v_events),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_cfg.push_secret
    )
  );
end;
$$;

-- Keep the old name working (in case anything references it) as a thin wrapper.
create or replace function public.dispatch_happy_hour_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.dispatch_push();
end;
$$;

-- Repoint the hourly cron at the unified dispatcher (same jobname/schedule).
do $$
begin
  perform cron.unschedule('happy_hour_push')
    where exists (select 1 from cron.job where jobname = 'happy_hour_push');
exception when others then null;
end $$;

select cron.schedule('happy_hour_push', '0 * * * *',
  $$select public.dispatch_push();$$);

-- ---- fire the reveal immediately when the admin ends the trip --------------
-- Re-create set_holiday_state (body identical to 0011) plus an immediate push
-- dispatch when the new state is 'reveal', so "End the trip" notifies right away
-- instead of waiting up to an hour for the next cron tick.
create or replace function public.set_holiday_state(p_holiday uuid, p_state text)
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
  if p_state not in ('live','dark','reveal','auto') then raise exception 'bad state'; end if;

  update public.holidays
     set forced_state = case when p_state = 'auto' then null else p_state end
   where id = p_holiday;

  perform public.refresh_snapshot(p_holiday);

  -- Grand-reveal moment: nudge everyone to open the app right now.
  if p_state = 'reveal' then
    perform public.dispatch_push();
  end if;
end;
$$;

grant execute on function public.set_holiday_state(uuid, text) to authenticated;
