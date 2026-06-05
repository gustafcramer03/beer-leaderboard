-- Grand-reveal media: per-player avatar + a pool of their beer photos.
--
-- The reveal show now puts each player's profile photo centre stage with a
-- scattered handful of their own beer photos around it. This RPC returns, keyed
-- by user_id, the avatar path (avatars bucket) and a shuffled pool of up to 12
-- beer photo paths (beer-photos bucket). The client signs the URLs and samples a
-- few to scatter. Gated to the reveal state (admins may preview any time).

create or replace function public.reveal_media(p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_admin boolean;
  v_state text;
  result jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_admin := (h.admin_id = auth.uid());
  v_state := public.holiday_state(h);
  if v_state <> 'reveal' and not v_admin then
    raise exception 'not revealed yet';
  end if;

  with photos as (
    select b.user_id, pa.path
    from public.beers b
    cross join lateral (values (b.full_photo_path), (b.empty_photo_path)) as pa(path)
    where b.holiday_id = p_holiday
      and b.status in ('pending','challenged','confirmed')
      and pa.path is not null
  ),
  ranked as (
    select user_id, path,
           row_number() over (partition by user_id order by random()) as rn
    from photos
  ),
  per_user as (
    select m.user_id,
           pr.avatar_path,
           coalesce(
             (select jsonb_agg(r.path) from ranked r where r.user_id = m.user_id and r.rn <= 12),
             '[]'::jsonb
           ) as photos
    from public.memberships m
    left join public.profiles pr on pr.id = m.user_id
    where m.holiday_id = p_holiday
  )
  select coalesce(
           jsonb_object_agg(
             user_id::text,
             jsonb_build_object('avatar_path', avatar_path, 'photos', photos)
           ),
           '{}'::jsonb
         )
    into result
  from per_user;

  return result;
end;
$$;

grant execute on function public.reveal_media(uuid) to authenticated;
