-- 0036_brand_tagging.sql
-- Brand tagging + beer insights.
--   * adds beers.brand (a brand slug from lib/brands.ts; nullable, capped)
--   * threads brand through log_offline_beer, user_ledger, audit_queue, admin_beers
--   * adds beer_insights(p_holiday): a group aggregate (returned even while dark)
--     of per-brand counts for the Beer insights tab.
-- The brand catalogue itself lives in the frontend (lib/brands.ts); the DB only
-- ever stores/aggregates the slug string.

-- 1) Column ----------------------------------------------------------------
alter table public.beers add column if not exists brand text;

-- 2) log_offline_beer: add p_brand (drop the old 8-arg signature first, since
--    adding a parameter would otherwise create an overload).
drop function if exists public.log_offline_beer(uuid, uuid, text, text, timestamptz, timestamptz, boolean, text);

create or replace function public.log_offline_beer(
  p_id uuid,
  p_holiday uuid,
  p_full_path text,
  p_empty_path text,
  p_full_taken timestamptz,
  p_empty_taken timestamptz,
  p_claimed_chug boolean,
  p_caption text default null,
  p_brand text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  v_caption text;
  v_brand text;
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
  v_brand   := left(nullif(btrim(coalesce(p_brand, '')), ''), 60);

  perform set_config('app.allow_manual_beer', '1', true);
  insert into public.beers(
    id, holiday_id, user_id, full_photo_path, empty_photo_path,
    full_taken_at, empty_taken_at, claimed_chug, status, is_offline, caption, brand
  ) values (
    p_id, p_holiday, uid, p_full_path, p_empty_path,
    p_full_taken, p_empty_taken, p_claimed_chug, 'pending', true, v_caption, v_brand
  );
  perform set_config('app.allow_manual_beer', '0', true);
  return p_id;
end;
$function$;

grant execute on function public.log_offline_beer(uuid, uuid, text, text, timestamptz, timestamptz, boolean, text, text) to authenticated;

-- 3) user_ledger: surface brand on each entry --------------------------------
create or replace function public.user_ledger(p_holiday uuid, p_user uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
           b.score_override, b.score_override_reason, b.caption, b.brand
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
             'brand', a.brand,
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
$function$;

-- 4) audit_queue: add a brand column (RETURNS TABLE shape changes -> drop first) --
drop function if exists public.audit_queue(uuid);

create or replace function public.audit_queue(p_holiday uuid)
 returns table(beer_id uuid, owner_name text, full_photo_path text, empty_photo_path text, full_taken_at timestamptz, empty_taken_at timestamptz, claimed_chug boolean, is_offline boolean, is_morning boolean, is_happy_hour boolean, is_early_bird boolean, is_night_owl boolean, caption text, brand text)
 language sql
 security definer
 set search_path to 'public'
as $function$
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
         b.caption,
         b.brand
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
$function$;

grant execute on function public.audit_queue(uuid) to authenticated;

-- 5) admin_beers: surface brand on each row ----------------------------------
create or replace function public.admin_beers(p_holiday uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  h public.holidays;
  v_tz text;
  result jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_admin(p_holiday, auth.uid()) then raise exception 'admin only'; end if;

  v_tz := coalesce(h.timezone, 'UTC');

  with eligible as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           (b.full_taken_at at time zone v_tz) as lf,
           ((b.full_taken_at at time zone v_tz) - interval '7 hours')::date as hh_day,
           lag(b.empty_taken_at) over (
             partition by b.user_id order by b.empty_taken_at
           ) as prev_finish
    from public.beers b
    where b.holiday_id = p_holiday
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
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.status,
           b.claimed_chug, b.full_photo_path, b.empty_photo_path, b.is_offline,
           b.score_override, b.score_override_reason, b.caption, b.brand, b.created_at
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status <> 'open'
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
             'user_id', a.user_id,
             'owner_name', coalesce(p.display_name, 'Unknown'),
             'full_taken_at', a.full_taken_at,
             'empty_taken_at', a.empty_taken_at,
             'status', a.status,
             'is_chug', coalesce(
               s.is_chug,
               a.claimed_chug or (a.empty_taken_at - a.full_taken_at) <= interval '60 seconds'
             ),
             'claimed_chug', a.claimed_chug,
             'is_offline', a.is_offline,
             'is_morning', (a.full_taken_at is not null
               and extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10),
             'is_happy_hour', coalesce(s.is_happy, false),
             'is_early_bird', coalesce(dm.is_first, false),
             'is_night_owl', coalesce(dm.is_last, false),
             'score_override', a.score_override,
             'override_reason', a.score_override_reason,
             'caption', a.caption,
             'brand', a.brand,
             'points', case
               when a.status = 'rejected' then 0
               when a.empty_taken_at is null then 0
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
           )
           order by coalesce(p.display_name, 'Unknown') asc, a.full_taken_at desc nulls last, a.created_at desc
         ), '[]'::jsonb)
  into result
  from allb a
  left join public.profiles p on p.id = a.user_id
  left join scored s    on s.id  = a.id
  left join day_marks dm on dm.id = a.id
  left join rev r       on r.beer_id = a.id;

  return result;
end;
$function$;

-- 6) beer_insights: per-brand counts (group aggregate, returned even while dark) --
create or replace function public.beer_insights(p_holiday uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  h public.holidays;
  v_state text;
  result jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;
  v_state := public.holiday_state(h);

  with elig as (
    select nullif(btrim(coalesce(b.brand, '')), '') as brand
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  tagged as (
    select brand, count(*)::int as c
    from elig
    where brand is not null
    group by brand
  )
  select jsonb_build_object(
    'state', v_state,
    'total_beers', (select count(*)::int from elig),
    'total_tagged', (select coalesce(sum(c), 0)::int from tagged),
    'distinct_brands', (select count(*)::int from tagged),
    'brands', coalesce(
      (select jsonb_agg(jsonb_build_object('slug', brand, 'count', c) order by c desc, brand)
         from tagged),
      '[]'::jsonb),
    'top', (select jsonb_build_object('slug', brand, 'count', c)
              from tagged order by c desc, brand limit 1)
  ) into result;

  return result;
end;
$function$;

grant execute on function public.beer_insights(uuid) to authenticated;
