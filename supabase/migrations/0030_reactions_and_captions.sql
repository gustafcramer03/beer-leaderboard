-- Emoji reactions + captions on beers.
--
-- Two social touches that live on the beer object:
--   1. Captions — a short (<=140 char) note the drinker attaches when logging
--      (online or offline). Surfaced in the ledger and the audit card.
--   2. Reactions — WhatsApp-style one-tap emoji on a mate's beer. Exactly one
--      reaction per user per beer (tapping a new emoji replaces it; tapping the
--      same one removes it). Stored in a dedicated RLS-locked table reached only
--      via the react_to_beer RPC + read back through user_ledger.

-- ---------------------------------------------------------------------------
-- Caption column.
-- ---------------------------------------------------------------------------
alter table public.beers
  add column if not exists caption text
  check (caption is null or char_length(caption) <= 140);

-- ---------------------------------------------------------------------------
-- Reactions table. One row per (beer, user); the emoji is replaceable. RLS is
-- enabled with NO policies, so direct table access is blocked — everything goes
-- through the SECURITY DEFINER RPCs below (which run as owner and bypass RLS).
-- ---------------------------------------------------------------------------
create table if not exists public.beer_reactions (
  beer_id    uuid not null references public.beers(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (beer_id, user_id)
);

create index if not exists beer_reactions_beer_idx on public.beer_reactions(beer_id);

alter table public.beer_reactions enable row level security;

-- ---------------------------------------------------------------------------
-- Toggle a reaction on a beer. Validates membership of the beer's holiday and
-- the emoji against the allowed set. Tapping the emoji you already have removes
-- it; any other emoji replaces it. Returns the fresh aggregate for that beer:
--   { "counts": { "<emoji>": <n>, ... }, "mine": "<emoji>" | null }
-- ---------------------------------------------------------------------------
create or replace function public.react_to_beer(p_beer uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
  v_uid uuid := auth.uid();
  v_allowed text[] := array['🍺','🔥','💪','😂','😮','🤮'];
  v_existing text;
  v_counts jsonb;
  v_mine text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if not public.is_member(b.holiday_id, v_uid) then raise exception 'not a member'; end if;
  if p_emoji is null or not (p_emoji = any (v_allowed)) then
    raise exception 'invalid reaction';
  end if;

  select emoji into v_existing
    from public.beer_reactions
   where beer_id = p_beer and user_id = v_uid;

  if v_existing = p_emoji then
    delete from public.beer_reactions
     where beer_id = p_beer and user_id = v_uid;
  else
    insert into public.beer_reactions(beer_id, user_id, emoji)
    values (p_beer, v_uid, p_emoji)
    on conflict (beer_id, user_id)
      do update set emoji = excluded.emoji, created_at = now();
  end if;

  select coalesce(jsonb_object_agg(emoji, cnt), '{}'::jsonb) into v_counts
    from (
      select emoji, count(*)::int as cnt
        from public.beer_reactions
       where beer_id = p_beer
       group by emoji
    ) z;

  select emoji into v_mine
    from public.beer_reactions
   where beer_id = p_beer and user_id = v_uid;

  return jsonb_build_object('counts', v_counts, 'mine', v_mine);
end;
$$;

grant execute on function public.react_to_beer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Offline logging now accepts an optional caption. Drop the old 7-arg form so
-- PostgREST resolves unambiguously to this version.
-- ---------------------------------------------------------------------------
drop function if exists public.log_offline_beer(uuid, uuid, text, text, timestamptz, timestamptz, boolean);

create or replace function public.log_offline_beer(
  p_id          uuid,
  p_holiday     uuid,
  p_full_path   text,
  p_empty_path  text,
  p_full_taken  timestamptz,
  p_empty_taken timestamptz,
  p_claimed_chug boolean,
  p_caption     text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_caption text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_holiday, uid) then raise exception 'not a member'; end if;
  if p_full_taken is null or p_empty_taken is null then
    raise exception 'both timestamps are required';
  end if;
  if p_empty_taken < p_full_taken then
    raise exception 'empty photo is older than the full photo';
  end if;
  if p_full_taken > now() + interval '1 day' then
    raise exception 'timestamp is in the future';
  end if;

  v_caption := left(nullif(btrim(coalesce(p_caption, '')), ''), 140);

  perform set_config('app.allow_manual_beer', '1', true);
  insert into public.beers(
    id, holiday_id, user_id, full_photo_path, empty_photo_path,
    full_taken_at, empty_taken_at, claimed_chug, status, is_offline, caption
  ) values (
    p_id, p_holiday, uid, p_full_path, p_empty_path,
    p_full_taken, p_empty_taken, p_claimed_chug, 'pending', true, v_caption
  );
  perform set_config('app.allow_manual_beer', '0', true);
  return p_id;
end;
$$;

grant execute on function
  public.log_offline_beer(uuid, uuid, text, text, timestamptz, timestamptz, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Surface the caption in the audit queue so reviewers see it on the card.
-- (Return signature changes, so drop + recreate.)
-- ---------------------------------------------------------------------------
drop function if exists public.audit_queue(uuid);
create or replace function public.audit_queue(p_holiday uuid)
returns table (
  beer_id uuid,
  owner_name text,
  full_photo_path text,
  empty_photo_path text,
  full_taken_at timestamptz,
  empty_taken_at timestamptz,
  claimed_chug boolean,
  is_offline boolean,
  is_morning boolean,
  is_happy_hour boolean,
  is_early_bird boolean,
  is_night_owl boolean,
  caption text
)
language sql
security definer
set search_path = public
as $$
  with hol as (
    select coalesce(timezone, 'UTC') as tz from public.holidays where id = p_holiday
  ),
  flagged as (
    select b.id,
           (extract(hour from (b.full_taken_at at time zone h.tz)) between 7 and 10) as is_morning,
           (extract(hour from (b.full_taken_at at time zone h.tz))::int
              = public.happy_hour_for(p_holiday,
                  ((b.full_taken_at at time zone h.tz) - interval '7 hours')::date)) as is_happy,
           (row_number() over (
              partition by ((b.empty_taken_at at time zone h.tz) - interval '7 hours')::date
              order by b.empty_taken_at asc, b.id asc) = 1) as is_first,
           (row_number() over (
              partition by ((b.empty_taken_at at time zone h.tz) - interval '7 hours')::date
              order by b.empty_taken_at desc, b.id desc) = 1
            and extract(hour from (b.empty_taken_at at time zone h.tz)) < 7) as is_last
    from public.beers b cross join hol h
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  )
  select b.id, p.display_name, b.full_photo_path, b.empty_photo_path,
         b.full_taken_at, b.empty_taken_at, b.claimed_chug, b.is_offline,
         coalesce(f.is_morning, false),
         coalesce(f.is_happy, false),
         coalesce(f.is_first, false),
         coalesce(f.is_last, false),
         b.caption
    from public.beers b
    join public.profiles p on p.id = b.user_id
    left join flagged f on f.id = b.id
   where b.holiday_id = p_holiday
     and b.user_id <> auth.uid()
     and b.status in ('pending','challenged')
     and b.empty_photo_path is not null
     and public.is_member(p_holiday, auth.uid())
     and not exists (
       select 1 from public.reviews r
       where r.beer_id = b.id and r.reviewer_id = auth.uid()
     )
   order by b.empty_taken_at asc;
$$;

grant execute on function public.audit_queue(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Per-player ledger: also return caption + reactions (everything else as 0029).
-- ---------------------------------------------------------------------------
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
  v_state := public.holiday_state(h);
  if v_state = 'dark' and not v_admin then
    raise exception 'board is dark';
  end if;

  with eligible as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           (b.full_taken_at at time zone v_tz) as lf,
           ((b.full_taken_at at time zone v_tz) - interval '7 hours')::date as hh_day,
           lag(b.empty_taken_at) over (
             partition by b.user_id order by b.empty_taken_at
           ) as prev_finish
    from public.beers b
    where b.holiday_id = p_holiday
      and b.user_id = p_user
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
    select b.id, b.full_taken_at, b.empty_taken_at, b.status, b.claimed_chug,
           b.full_photo_path, b.empty_photo_path, b.is_offline,
           b.score_override, b.score_override_reason, b.caption
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
  ),
  reacts as (
    select beer_id, jsonb_object_agg(emoji, cnt) as counts
    from (
      select beer_id, emoji, count(*)::int as cnt
        from public.beer_reactions
       where beer_id in (select id from allb)
       group by beer_id, emoji
    ) z
    group by beer_id
  ),
  mine as (
    select beer_id, emoji
      from public.beer_reactions
     where user_id = auth.uid()
       and beer_id in (select id from allb)
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
             'is_happy_hour', coalesce(s.is_happy, false),
             'is_early_bird', coalesce(dm.is_first, false),
             'is_night_owl', coalesce(dm.is_last, false),
             'is_offline', a.is_offline,
             'score_override', a.score_override,
             'override_reason', a.score_override_reason,
             'caption', a.caption,
             'reactions', coalesce(rc.counts, '{}'::jsonb),
             'my_reaction', mr.emoji,
             'points', case
               when a.status = 'rejected' then 0
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
           ) order by a.full_taken_at desc
         ), '[]'::jsonb)
  into result
  from allb a
  left join scored s     on s.id  = a.id
  left join day_marks dm on dm.id = a.id
  left join rev r        on r.beer_id = a.id
  left join reacts rc    on rc.beer_id = a.id
  left join mine mr      on mr.beer_id = a.id;

  return result;
end;
$$;

grant execute on function public.user_ledger(uuid, uuid) to authenticated;
