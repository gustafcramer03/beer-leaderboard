-- DB Management tooling: list every trip in the database with its photo count
-- and storage footprint, drill into a trip's members, and delete a whole trip
-- or a single member (freeing their photos). Also reports total storage use as
-- a percentage of the Supabase free-tier allowance (1 GB).
--
-- SECURITY NOTE: these RPCs are SECURITY DEFINER and bypass RLS so the owner can
-- see/manage EVERY trip, not just ones they belong to. They are gated by a
-- shared password ('password' for now) passed from the client — this is a
-- placeholder to be hardened later (e.g. restrict to a specific admin uid).
-- Storage figures are read from storage.objects.metadata->>'size'.

-- Free-tier file-storage allowance, in bytes (1 GB).
create or replace function public.admin_storage_limit_bytes()
returns bigint
language sql
immutable
as $$ select 1073741824::bigint $$;

-- Validate the management password. Centralised so it's easy to change later.
create or replace function public.admin_check_password(p_password text)
returns void
language plpgsql
as $$
begin
  if coalesce(p_password, '') <> 'password' then
    raise exception 'bad management password';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- List every trip with rollups.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_trips(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.admin_check_password(p_password);

  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      h.id,
      h.name,
      h.start_date,
      h.end_date,
      h.invite_code,
      h.created_at,
      (select count(*)::int from public.memberships m where m.holiday_id = h.id) as member_count,
      (select count(*)::int from public.beers b where b.holiday_id = h.id) as beer_count,
      coalesce(s.photo_count, 0) as photo_count,
      coalesce(s.storage_bytes, 0) as storage_bytes
    from public.holidays h
    left join lateral (
      select count(*)::int as photo_count,
             coalesce(sum((o.metadata->>'size')::bigint), 0) as storage_bytes
      from storage.objects o
      where o.bucket_id = 'beer-photos'
        and (storage.foldername(o.name))[1] = h.id::text
    ) s on true
  ) t;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- List the members of one trip, with each member's photo/storage footprint.
-- ---------------------------------------------------------------------------
create or replace function public.admin_trip_members(p_password text, p_holiday uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.admin_check_password(p_password);

  select coalesce(jsonb_agg(t order by t.is_admin desc, t.display_name asc), '[]'::jsonb)
  into result
  from (
    select
      m.user_id,
      pr.display_name,
      (h.admin_id = m.user_id) as is_admin,
      (select count(*)::int from public.beers b
        where b.holiday_id = p_holiday and b.user_id = m.user_id) as beer_count,
      coalesce(us.photo_count, 0) as photo_count,
      coalesce(us.storage_bytes, 0) as storage_bytes
    from public.memberships m
    join public.holidays h on h.id = m.holiday_id
    join public.profiles pr on pr.id = m.user_id
    left join lateral (
      select count(*)::int as photo_count,
             coalesce(sum((o.metadata->>'size')::bigint), 0) as storage_bytes
      from storage.objects o
      join public.beers b on b.id = ((storage.foldername(o.name))[2])::uuid
      where o.bucket_id = 'beer-photos'
        and (storage.foldername(o.name))[1] = p_holiday::text
        and b.user_id = m.user_id
    ) us on true
    where m.holiday_id = p_holiday
  ) t;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage paths to purge — for a whole trip, or one user within it.
-- Returned so the client can remove the blobs via the Storage API (which frees
-- the actual files), before the DB rows are deleted.
-- ---------------------------------------------------------------------------
create or replace function public.admin_trip_photo_paths(
  p_password text,
  p_holiday uuid,
  p_user uuid default null
)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_check_password(p_password);

  return query
    select o.name
    from storage.objects o
    where o.bucket_id = 'beer-photos'
      and (storage.foldername(o.name))[1] = p_holiday::text
      and (
        p_user is null
        or exists (
          select 1 from public.beers b
          where b.id = ((storage.foldername(o.name))[2])::uuid
            and b.user_id = p_user
        )
      );
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete a whole trip (cascades memberships, beers, reviews, snapshots).
-- Caller should purge storage first via admin_trip_photo_paths.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_holiday(p_password text, p_holiday uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_check_password(p_password);
  delete from public.holidays where id = p_holiday;
end;
$$;

-- ---------------------------------------------------------------------------
-- Remove one member from a trip: delete their beers in that trip (cascades
-- their reviews/photos rows) and their membership. The trip admin cannot be
-- removed this way — delete the whole trip instead.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_member(
  p_password text,
  p_holiday uuid,
  p_user uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
begin
  perform public.admin_check_password(p_password);

  select admin_id into v_admin from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if v_admin = p_user then
    raise exception 'cannot remove the trip admin; delete the whole trip instead';
  end if;

  delete from public.beers where holiday_id = p_holiday and user_id = p_user;
  delete from public.memberships where holiday_id = p_holiday and user_id = p_user;

  perform public.refresh_snapshot(p_holiday);
end;
$$;

-- ---------------------------------------------------------------------------
-- Whole-database storage summary vs. the free-tier allowance.
-- ---------------------------------------------------------------------------
create or replace function public.admin_storage_summary(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photos int;
  v_bytes bigint;
  v_limit bigint := public.admin_storage_limit_bytes();
begin
  perform public.admin_check_password(p_password);

  select count(*)::int, coalesce(sum((metadata->>'size')::bigint), 0)
  into v_photos, v_bytes
  from storage.objects
  where bucket_id = 'beer-photos';

  return jsonb_build_object(
    'total_photos', v_photos,
    'total_bytes', v_bytes,
    'limit_bytes', v_limit,
    'used_pct', round((v_bytes::numeric / nullif(v_limit, 0)::numeric) * 100, 2)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Allow members to delete their holiday's photos via the Storage API, so the
-- management tool can free the actual blobs before deleting DB rows.
-- ---------------------------------------------------------------------------
drop policy if exists "beer photos deletable by members" on storage.objects;
create policy "beer photos deletable by members" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'beer-photos'
    and public.is_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

-- Grants
grant execute on function public.admin_storage_limit_bytes()                  to authenticated;
grant execute on function public.admin_check_password(text)                   to authenticated;
grant execute on function public.admin_list_trips(text)                       to authenticated;
grant execute on function public.admin_trip_members(text, uuid)               to authenticated;
grant execute on function public.admin_trip_photo_paths(text, uuid, uuid)     to authenticated;
grant execute on function public.admin_delete_holiday(text, uuid)             to authenticated;
grant execute on function public.admin_delete_member(text, uuid, uuid)        to authenticated;
grant execute on function public.admin_storage_summary(text)                  to authenticated;
