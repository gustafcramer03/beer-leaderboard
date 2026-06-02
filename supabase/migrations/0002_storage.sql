-- Storage bucket for beer photos + access policies.
-- Photos are stored under path:  {holiday_id}/{beer_id}/{full|empty}.jpg
-- The first path segment (holiday_id) drives membership-based access.

-- Private bucket (clients read via short-lived signed URLs).
insert into storage.buckets (id, name, public)
values ('beer-photos', 'beer-photos', false)
on conflict (id) do nothing;

-- Read: any member of the holiday that owns the photo.
drop policy if exists "beer photos readable by members" on storage.objects;
create policy "beer photos readable by members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'beer-photos'
    and public.is_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

-- Upload: members may upload into their holiday's folder.
drop policy if exists "beer photos uploadable by members" on storage.objects;
create policy "beer photos uploadable by members" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'beer-photos'
    and public.is_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );
