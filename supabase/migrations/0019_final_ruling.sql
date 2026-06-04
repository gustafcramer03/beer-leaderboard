-- Make admin rulings final.
--
-- A beer is escalated to the admin's queue the FIRST time it is challenged.
-- Once the admin has ruled on it (uphold / reject / set score), that ruling is
-- final: a later challenge by another player must NOT push it back to the admin.
-- We stamp the beer with admin_ruled_at when ruled, and the challenge escalation
-- skips any beer that already carries a ruling. Players still audit/swipe every
-- beer as before; the admin only ever reviews a given beer once.

alter table public.beers
  add column if not exists admin_ruled_at timestamptz;

-- A challenge escalates to the admin only before any ruling exists.
create or replace function public.reviews_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verdict = 'challenge' then
    perform set_config('app.bypass_beer_guard', '1', true);
    update public.beers
       set status = 'challenged'
     where id = new.beer_id
       and status = 'pending'
       and admin_ruled_at is null;   -- a ruled beer is final; never re-escalate
  end if;
  return new;
end;
$$;

-- Uphold / reject: stamp the ruling time (and clear any prior override).
create or replace function public.admin_rule_beer(p_beer uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
begin
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if not public.is_admin(b.holiday_id, auth.uid()) then raise exception 'admin only'; end if;
  if p_decision not in ('confirm','reject') then raise exception 'bad decision'; end if;

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set status = case when p_decision = 'confirm' then 'confirmed' else 'rejected' end,
         score_override = null,
         admin_ruled_at = now()
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;

-- Set score (accept as legit with a hand-dialled value): also a final ruling.
create or replace function public.admin_set_beer_score(p_beer uuid, p_points int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
begin
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if not public.is_admin(b.holiday_id, auth.uid()) then raise exception 'admin only'; end if;
  if p_points is null or p_points < 0 or p_points > 100 then
    raise exception 'points must be between 0 and 100';
  end if;

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set status = 'confirmed', score_override = p_points, admin_ruled_at = now()
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;
