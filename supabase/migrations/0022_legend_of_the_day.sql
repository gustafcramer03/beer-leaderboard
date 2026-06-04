-- Legend of the Day: who sank the most beers yesterday.
--
-- Shown once per day to each player on first open. The "day" is resolved in the
-- trip's own timezone; the server returns both the celebrated date (yesterday)
-- and the current day so the client can gate the once-per-day popup without
-- doing its own timezone maths. Beer eligibility matches the leaderboard
-- (pending/challenged/confirmed with an empty photo), counted on the day the
-- beer was finished. During the dark finale we keep yesterday's leader secret
-- too, so the legend is withheld until the board comes back.

create or replace function public.legend_of_the_day(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_tz text;
  v_today date;
  v_yesterday date;
  v_state text;
  v_legend jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_tz := coalesce(h.timezone, 'UTC');
  v_today := (now() at time zone v_tz)::date;
  v_yesterday := v_today - 1;
  v_state := public.holiday_state(h);

  if v_state = 'dark' then
    return jsonb_build_object(
      'today', to_char(v_today, 'YYYY-MM-DD'),
      'date', to_char(v_yesterday, 'YYYY-MM-DD'),
      'legend', null
    );
  end if;

  select jsonb_build_object(
    'user_id', t.user_id,
    'display_name', pr.display_name,
    'avatar_path', pr.avatar_path,
    'beer_count', t.c
  )
  into v_legend
  from (
    select b.user_id, count(*)::int as c
    from public.beers b
    where b.holiday_id = p_holiday
      and b.status in ('pending', 'challenged', 'confirmed')
      and b.empty_taken_at is not null
      and (b.empty_taken_at at time zone v_tz)::date = v_yesterday
    group by b.user_id
    order by c desc, b.user_id
    limit 1
  ) t
  join public.profiles pr on pr.id = t.user_id;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'date', to_char(v_yesterday, 'YYYY-MM-DD'),
    'legend', v_legend
  );
end;
$$;

grant execute on function public.legend_of_the_day(uuid) to authenticated;
