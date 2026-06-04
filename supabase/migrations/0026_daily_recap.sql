-- Daily recap: a once-a-day summary of the beer-day that just wrapped.
--
-- daily_recap(holiday) summarises the most recently *completed* beer-day, where a
-- beer-day runs 07:00 -> 07:00 local (matching the rest of the scoring). The
-- server resolves the day in the trip timezone and returns both `today` (the
-- current beer-day) and `date` (the recapped day) so the client can gate the
-- once-per-day popup without doing its own timezone maths.
--
-- recap contents (null where nobody qualifies):
--   total_beers   - beers finished on the day
--   champion      - top drinker of the day (the "Legend"; n = beer_count)
--   early_bird    - first finisher of the day
--   night_owl     - the day's last finisher, only if after midnight (hour < 7)
--   fastest_chug  - quickest claimed/sub-60s chug (n = seconds)
--   longest_chain - longest chain of 3+ (n = length)
--
-- Beer eligibility matches the leaderboard (pending/challenged/confirmed with an
-- empty photo). Withheld while the board is dark so the finale stays secret, and
-- null when no beers were logged that day (nothing to celebrate).

create or replace function public.daily_recap(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_tz text;
  v_cur_day date;
  v_recap_day date;
  v_state text;
  v_total int;
  v_champion jsonb;
  v_early jsonb;
  v_owl jsonb;
  v_chug jsonb;
  v_chain jsonb;
  v_recap jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_tz := coalesce(h.timezone, 'UTC');
  v_cur_day   := ((now() at time zone v_tz) - interval '7 hours')::date;
  v_recap_day := v_cur_day - 1;
  v_state := public.holiday_state(h);

  if v_state = 'dark' then
    return jsonb_build_object(
      'today', to_char(v_cur_day, 'YYYY-MM-DD'),
      'date',  to_char(v_recap_day, 'YYYY-MM-DD'),
      'recap', null
    );
  end if;

  -- All eligible beers finished on the recapped beer-day, with chug/chain flags.
  create temp table _recap_beers on commit drop as
  with base as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           (b.empty_taken_at at time zone v_tz) as le,
           lag(b.empty_taken_at) over (
             partition by b.user_id order by b.empty_taken_at
           ) as prev_finish
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
      and ((b.empty_taken_at at time zone v_tz) - interval '7 hours')::date = v_recap_day
  ),
  grouped as (
    select base.*,
           sum(case when prev_finish is null
                      or empty_taken_at - prev_finish > interval '5 minutes'
                    then 1 else 0 end)
             over (partition by user_id order by empty_taken_at) as grp
    from base
  )
  select g.id, g.user_id, g.full_taken_at, g.empty_taken_at, g.grp,
         (g.claimed_chug or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds') as is_chug,
         extract(epoch from (g.empty_taken_at - g.full_taken_at))::int as duration_s,
         (row_number() over (order by g.empty_taken_at asc,  g.id asc)  = 1) as is_first,
         (row_number() over (order by g.empty_taken_at desc, g.id desc) = 1
            and extract(hour from g.le) < 7) as is_last
  from grouped g;

  select count(*)::int into v_total from _recap_beers;

  if v_total = 0 then
    return jsonb_build_object(
      'today', to_char(v_cur_day, 'YYYY-MM-DD'),
      'date',  to_char(v_recap_day, 'YYYY-MM-DD'),
      'recap', null
    );
  end if;

  -- champion: top drinker of the day (ties broken by user_id, like the Legend).
  select jsonb_build_object(
           'user_id', t.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path,
           'beer_count', t.c)
  into v_champion
  from (
    select user_id, count(*)::int as c
    from _recap_beers group by user_id
    order by c desc, user_id limit 1
  ) t join public.profiles pr on pr.id = t.user_id;

  -- early bird: first finisher of the day.
  select jsonb_build_object(
           'user_id', b.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path)
  into v_early
  from _recap_beers b join public.profiles pr on pr.id = b.user_id
  where b.is_first;

  -- night owl: the day's last finisher, only if it landed after midnight.
  select jsonb_build_object(
           'user_id', b.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path)
  into v_owl
  from _recap_beers b join public.profiles pr on pr.id = b.user_id
  where b.is_last;

  -- fastest chug: shortest qualifying chug duration (n = seconds).
  select jsonb_build_object(
           'user_id', b.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path,
           'seconds', b.duration_s)
  into v_chug
  from _recap_beers b join public.profiles pr on pr.id = b.user_id
  where b.is_chug
  order by b.duration_s asc, b.empty_taken_at asc, b.id asc
  limit 1;

  -- longest chain of 3+ (n = length).
  select jsonb_build_object(
           'user_id', c.user_id,
           'display_name', pr.display_name,
           'avatar_path', pr.avatar_path,
           'length', c.len)
  into v_chain
  from (
    select user_id, count(*)::int as len
    from _recap_beers group by user_id, grp having count(*) >= 3
    order by len desc limit 1
  ) c join public.profiles pr on pr.id = c.user_id;

  v_recap := jsonb_build_object(
    'total_beers', v_total,
    'champion', v_champion,
    'early_bird', v_early,
    'night_owl', v_owl,
    'fastest_chug', v_chug,
    'longest_chain', v_chain
  );

  return jsonb_build_object(
    'today', to_char(v_cur_day, 'YYYY-MM-DD'),
    'date',  to_char(v_recap_day, 'YYYY-MM-DD'),
    'recap', v_recap
  );
end;
$$;

grant execute on function public.daily_recap(uuid) to authenticated;
