-- DB Management: drill from a trip member into their individual beers so the
-- owner can review the full/empty photos of any beer in any trip.
--
-- Password-gated SECURITY DEFINER (bypasses RLS), mirroring admin_trip_members,
-- so it lists beers regardless of the caller's membership or the board state.
-- The photo BLOBS themselves are still fetched client-side via short-lived
-- signed URLs, which remain governed by storage RLS — i.e. the owner sees the
-- actual images for trips they belong to (they are auto-membered into every
-- trip they create). Only beers that have at least one uploaded photo are
-- returned, newest first.

create or replace function public.admin_member_beers(
  p_password text,
  p_holiday uuid,
  p_user uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.admin_check_password(p_password);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'beer_id', b.id,
        'status', b.status,
        'is_offline', b.is_offline,
        'claimed_chug', b.claimed_chug,
        'caption', b.caption,
        'brand', b.brand,
        'full_taken_at', b.full_taken_at,
        'empty_taken_at', b.empty_taken_at,
        'full_photo_path', b.full_photo_path,
        'empty_photo_path', b.empty_photo_path
      )
      order by coalesce(b.empty_taken_at, b.full_taken_at, b.created_at) desc
    ),
    '[]'::jsonb
  )
  into result
  from public.beers b
  where b.holiday_id = p_holiday
    and b.user_id = p_user
    and (b.full_photo_path is not null or b.empty_photo_path is not null);

  return result;
end;
$$;

grant execute on function public.admin_member_beers(text, uuid, uuid) to authenticated;
