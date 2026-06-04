-- Achievements / trophy cabinet.
--
-- A read-only function that returns, for one player in one holiday, how many
-- times they've earned each trophy. Counts are "how many times won" so the UI
-- can show e.g. "2x Centurion" (200 beers). Trophies:
--
--   centurion       floor(total beers / 100)            -- 1 per 100 beers
--   legend_of_day   # of days they drank the most beers -- group-wide daily win
--   early_bird      # of days they owned the 1st finish -- group-wide daily prize
--   night_owl       # of days they owned the last       -- finish, after midnight
--   chug_master     floor(chugs / 10)                   -- 1 per 10 chugs
--   breakfast_club  floor(morning beers / 5)            -- 1 per 5 morning beers
--
-- Definitions mirror the scoring functions: only audited beers count
-- (status in pending/challenged/confirmed, empty_taken_at not null), the
-- beer-day runs 07:00 -> next-day 07:00 local keyed on FINISH time, and Night
-- Owl requires a small-hours finish (local hour < 7), matching migration 0015.
--
-- A player's own cabinet is always visible (it's their private trophy case);
-- viewing someone else's is blocked while the board is dark, like user_ledger.

create or replace function public.user_achievements(p_holiday uuid, p_user uuid)
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
  -- Your own trophy case is always visible; others' are hidden while dark.
  if v_state = 'dark' and not v_admin and p_user <> auth.uid() then
    raise exception 'board is dark';
  end if;

  with base as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           (b.full_taken_at  at time zone v_tz) as lf,
           (b.empty_taken_at at time zone v_tz) as le,
           ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date as fin_day
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  marks as (
    select base.*,
           (row_number() over (partition by fin_day order by empty_taken_at asc,  id asc)  = 1) as is_first,
           (row_number() over (partition by fin_day order by empty_taken_at desc, id desc) = 1
              and extract(hour from le) < 7) as is_last,
           (claimed_chug or (empty_taken_at - full_taken_at) <= interval '60 seconds') as is_chug,
           (extract(hour from lf) between 7 and 10) as is_morning
    from base
  ),
  per_user_day as (
    select user_id, fin_day, count(*) as n
    from base
    group by user_id, fin_day
  ),
  day_max as (
    select fin_day, max(n) as mx from per_user_day group by fin_day
  ),
  legend as (
    select pud.user_id, count(*) as days
    from per_user_day pud
    join day_max dm on dm.fin_day = pud.fin_day
    where pud.n = dm.mx and dm.mx >= 1
    group by pud.user_id
  ),
  tally as (
    select m.user_id,
           count(*)                          as beers,
           count(*) filter (where is_chug)   as chugs,
           count(*) filter (where is_morning) as mornings,
           count(*) filter (where is_first)  as early_days,
           count(*) filter (where is_last)   as night_days
    from marks m
    group by m.user_id
  )
  select jsonb_build_object(
    'centurion',      coalesce((select floor(beers   / 100.0)::int from tally where user_id = p_user), 0),
    'legend_of_day',  coalesce((select days                       from legend where user_id = p_user), 0),
    'early_bird',     coalesce((select early_days                 from tally where user_id = p_user), 0),
    'night_owl',      coalesce((select night_days                 from tally where user_id = p_user), 0),
    'chug_master',    coalesce((select floor(chugs    / 10.0)::int from tally where user_id = p_user), 0),
    'breakfast_club', coalesce((select floor(mornings / 5.0)::int  from tally where user_id = p_user), 0)
  ) into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;

grant execute on function public.user_achievements(uuid, uuid) to authenticated;
