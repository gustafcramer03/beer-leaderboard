-- Profile avatars: an optional selfie per account.
--
-- The image is square-cropped + compressed client-side (~256px JPEG, a few KB)
-- and stored private at {user_id}/avatar.jpg, read via short-lived signed URLs
-- exactly like beer photos. Accounts without one fall back to a bundled static
-- default (the Lorax) in the frontend, so the default costs zero storage.

alter table public.profiles add column if not exists avatar_path text;

-- Private bucket (clients read via signed URLs).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- Read: any authenticated user. Display names are already readable to members,
-- and avatars surface alongside names (leaderboard, rivalry cards, etc.).
drop policy if exists "avatars readable by authenticated" on storage.objects;
create policy "avatars readable by authenticated" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

-- Write: you may only create/update/delete your own avatar (folder = your uid).
drop policy if exists "avatars insertable by owner" on storage.objects;
create policy "avatars insertable by owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );

drop policy if exists "avatars updatable by owner" on storage.objects;
create policy "avatars updatable by owner" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  )
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );

drop policy if exists "avatars deletable by owner" on storage.objects;
create policy "avatars deletable by owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );
