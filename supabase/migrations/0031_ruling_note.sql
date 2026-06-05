-- Admin ruling note on uphold/reject too.
--
-- Until now only admin_set_beer_score could attach a note (score_override_reason)
-- explaining a hand-set score; uphold/reject CLEARED the note. The rulings screen
-- now gives the admin one "Your ruling" field that rides along with any decision,
-- so a confirmed or rejected beer can also carry the reasoning. We reuse the
-- existing score_override_reason column; user_ledger already returns it as
-- override_reason, and the ledger reveals it for any beer that has one.

drop function if exists public.admin_rule_beer(uuid, text);

create or replace function public.admin_rule_beer(
  p_beer uuid,
  p_decision text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.beers;
  v_reason text;
begin
  select * into b from public.beers where id = p_beer;
  if not found then raise exception 'beer not found'; end if;
  if not public.is_admin(b.holiday_id, auth.uid()) then raise exception 'admin only'; end if;
  if p_decision not in ('confirm','reject') then raise exception 'bad decision'; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_reason := left(v_reason, 200);

  perform set_config('app.bypass_beer_guard', '1', true);
  update public.beers
     set status = case when p_decision = 'confirm' then 'confirmed' else 'rejected' end,
         score_override = null,
         score_override_reason = v_reason,
         admin_ruled_at = now()
   where id = p_beer;

  perform public.refresh_snapshot(b.holiday_id);
end;
$$;

grant execute on function public.admin_rule_beer(uuid, text, text) to authenticated;
