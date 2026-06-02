-- Fix: the beers BEFORE UPDATE guard reverted ALL status changes into
-- review/admin states, including the legitimate ones performed by our
-- SECURITY DEFINER routines (challenge trigger + admin ruling).
--
-- Solution: trusted routines set a transaction-local flag
-- (app.bypass_beer_guard) before updating beer status; the guard skips when the
-- flag is set. Direct client (anon-key) updates cannot set this flag, so a
-- player still cannot promote their own beer to confirmed/etc.

create or replace function public.beers_before_update()
returns trigger
language plpgsql
as $$
begin
  -- never let the owner rewrite the full timestamp
  new.full_taken_at := old.full_taken_at;

  -- finishing the beer: empty photo added for the first time
  if old.empty_photo_path is null and new.empty_photo_path is not null then
    new.empty_taken_at := now();       -- server clock
    if old.status = 'open' then
      new.status := 'pending';
    end if;
  else
    new.empty_taken_at := old.empty_taken_at;
  end if;

  -- trusted server-side routines may move status freely
  if current_setting('app.bypass_beer_guard', true) = '1' then
    return new;
  end if;

  -- otherwise owners may only leave status at open/pending
  if new.status not in ('open','pending') and new.status is distinct from old.status then
    new.status := old.status;
  end if;

  return new;
end;
$$;

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
       and status = 'pending';   -- don't override an admin ruling
  end if;
  return new;
end;
$$;

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
     set status = case when p_decision = 'confirm' then 'confirmed' else 'rejected' end
   where id = p_beer;
end;
$$;
