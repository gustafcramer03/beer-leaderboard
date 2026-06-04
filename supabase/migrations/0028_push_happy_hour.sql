-- Web push notifications — phase 1: happy-hour start & end only.
--
-- Pipeline (no new always-on server; reuses pg_cron + pg_net):
--   pg_cron (hourly, :00)  ->  dispatch_happy_hour_push()
--     -> happy_hour_push_due() computes which happy-hour boundaries land in the
--        current hour (per holiday, in its tz), logs them so they fire once, and
--        returns the message + every member's push subscription.
--     -> net.http_post() POSTs that payload to our Vercel route, which signs and
--        sends each notification with the Web Push protocol (VAPID).
--
-- Subscriptions are per-device (keyed on the push endpoint) and global to the
-- user; targeting is by holiday membership. All client access goes through the
-- save/delete RPCs (the tables themselves are RLS-locked).

create extension if not exists pg_net;

-- One row per browser/device push subscription the user has granted.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;  -- locked; access via RPC

-- Dedup log so each happy-hour boundary notifies exactly once.
create table if not exists public.push_sent_log (
  holiday_id uuid not null references public.holidays(id) on delete cascade,
  event_date date not null,
  kind       text not null check (kind in ('start','end')),
  sent_at    timestamptz not null default now(),
  primary key (holiday_id, event_date, kind)
);
alter table public.push_sent_log enable row level security;  -- locked; functions only

-- Private config (endpoint URL + shared secret). Lives outside the public schema
-- so it is never exposed via the API; the row is inserted out-of-band, never in
-- a committed migration, so the secret stays out of git.
create schema if not exists private;
create table if not exists private.push_config (
  id           int primary key default 1 check (id = 1),
  endpoint_url text not null,
  push_secret  text not null
);

-- ---- client-facing RPCs ---------------------------------------------------

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_ua       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.push_subscriptions(endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, p_ua)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh  = excluded.p256dh,
        auth    = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---- the due-events builder ----------------------------------------------

-- Returns { events: [ { holiday_id, kind, title, body, subscriptions:[...] } ] }
-- for every happy-hour boundary that falls in the current hour and hasn't fired
-- yet. Side effect: logs each boundary so it can't double-fire. happy_hour_for
-- always returns 14..22, so each window sits on its own calendar date.
create or replace function public.happy_hour_push_due()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events jsonb := '[]'::jsonb;
  r record;
  v_subs jsonb;
  v_n int;
  v_start_lbl text;
  v_end_lbl text;
  v_title text;
  v_body text;
begin
  for r in
    with hols as (
      select h.id, h.name, coalesce(h.timezone, 'UTC') as tz, h.start_date, h.end_date
      from public.holidays h
    ),
    windows as (
      select hols.id, hols.name, hols.tz, gs::date as d,
             public.happy_hour_for(hols.id, gs::date) as hh
      from hols, generate_series(hols.start_date, hols.end_date, interval '1 day') gs
    ),
    enriched as (
      select w.*,
             ((w.d::timestamp + (w.hh || ' hours')::interval) at time zone w.tz) as starts
      from windows w
      where w.hh is not null
    )
    select e.id, e.name, e.tz, e.d, e.hh, e.starts,
           case
             when date_trunc('hour', now()) = date_trunc('hour', e.starts) then 'start'
             when date_trunc('hour', now()) = date_trunc('hour', e.starts + interval '1 hour') then 'end'
           end as kind
    from enriched e
    where date_trunc('hour', now()) in (
            date_trunc('hour', e.starts),
            date_trunc('hour', e.starts + interval '1 hour')
          )
  loop
    if r.kind is null then continue; end if;

    -- fire-once guard
    if exists (
      select 1 from public.push_sent_log l
      where l.holiday_id = r.id and l.event_date = r.d and l.kind = r.kind
    ) then
      continue;
    end if;
    insert into public.push_sent_log(holiday_id, event_date, kind)
      values (r.id, r.d, r.kind)
      on conflict do nothing;

    select coalesce(jsonb_agg(jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      into v_subs
    from public.push_subscriptions s
    join public.memberships m on m.user_id = s.user_id
    where m.holiday_id = r.id;

    if jsonb_array_length(v_subs) = 0 then continue; end if;  -- nobody to tell

    v_start_lbl := lower(to_char(make_timestamp(2000, 1, 1, r.hh, 0, 0), 'FMHH12AM'));
    v_end_lbl   := lower(to_char(make_timestamp(2000, 1, 1, (r.hh + 1) % 24, 0, 0), 'FMHH12AM'));

    if r.kind = 'start' then
      v_title := '🍻 Happy hour!';
      v_body  := r.name || ' — happy hour is ON, ' || v_start_lbl || '–' || v_end_lbl
                 || '. GO QUENCH YOUR THIRST!';
    else
      select count(*)::int into v_n
      from public.beers b
      where b.holiday_id = r.id
        and b.status in ('pending', 'challenged', 'confirmed')
        and b.full_taken_at is not null
        and extract(hour from (b.full_taken_at at time zone r.tz))::int = r.hh
        and ((b.full_taken_at at time zone r.tz) - interval '7 hours')::date = r.d;
      v_title := '🍻 Happy hour''s over';
      v_body  := r.name || ' — ' || coalesce(v_n, 0) || ' beer'
                 || case when coalesce(v_n, 0) = 1 then '' else 's' end
                 || ' sunk during happy hour!';
    end if;

    v_events := v_events || jsonb_build_array(jsonb_build_object(
      'holiday_id', r.id,
      'kind', r.kind,
      'title', v_title,
      'body', v_body,
      'subscriptions', v_subs
    ));
  end loop;

  return jsonb_build_object('events', v_events);
end;
$$;

-- ---- the dispatcher (called by cron) --------------------------------------

create or replace function public.dispatch_happy_hour_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg private.push_config;
  v_payload jsonb;
begin
  select * into v_cfg from private.push_config where id = 1;
  if not found then return; end if;  -- not configured yet; do nothing

  v_payload := public.happy_hour_push_due();
  if coalesce(jsonb_array_length(v_payload -> 'events'), 0) = 0 then
    return;
  end if;

  perform net.http_post(
    url := v_cfg.endpoint_url,
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_cfg.push_secret
    )
  );
end;
$$;

-- ---- schedule (hourly at :00, like the snapshot job) ----------------------

do $$
begin
  perform cron.unschedule('happy_hour_push')
    where exists (select 1 from cron.job where jobname = 'happy_hour_push');
exception when others then null;
end $$;

select cron.schedule('happy_hour_push', '0 * * * *',
  $$select public.dispatch_happy_hour_push();$$);
