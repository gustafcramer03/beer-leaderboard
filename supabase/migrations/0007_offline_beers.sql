-- Offline beers: beers consumed without internet (plane, ferry) and logged later
-- from photos already in the camera roll. We can't trust the upload time, so the
-- client reads each photo's EXIF capture time and passes it in explicitly. These
-- rows are flagged is_offline = true so reviewers and ledgers can mark them.
--
-- Normal online logging stays server-authoritative: the before-insert trigger
-- still stamps now() for ordinary inserts. Only the trusted SECURITY DEFINER RPC
-- below sets a transaction-local flag that lets the client-supplied timestamps
-- through, so a plain REST insert can never forge a timestamp.

alter table public.beers
  add column if not exists is_offline boolean not null default false;

-- ---------------------------------------------------------------------------
-- Allow the trusted offline RPC to insert pre-stamped rows.
-- ---------------------------------------------------------------------------
create or replace function public.beers_before_insert()
returns trigger
language plpgsql
as $$
begin
  -- The offline RPC sets this transaction-local flag; trust its values verbatim.
  if current_setting('app.allow_manual_beer', true) = '1' then
    return new;
  end if;

  -- Default path: server-authoritative timestamps, ignore client values.
  new.full_taken_at  := now();
  new.empty_taken_at := null;
  new.status         := 'open';
  new.empty_photo_path := null;
  new.is_offline     := false;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Log an offline beer in one shot. The client generates the id (so it can name
-- the storage paths), uploads both photos, then calls this with the EXIF times.
-- ---------------------------------------------------------------------------
create or replace function public.log_offline_beer(
  p_id          uuid,
  p_holiday     uuid,
  p_full_path   text,
  p_empty_path  text,
  p_full_taken  timestamptz,
  p_empty_taken timestamptz,
  p_claimed_chug boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_holiday, uid) then raise exception 'not a member'; end if;
  if p_full_taken is null or p_empty_taken is null then
    raise exception 'both timestamps are required';
  end if;
  if p_empty_taken < p_full_taken then
    raise exception 'empty photo is older than the full photo';
  end if;
  -- Small tolerance for clock skew; reject anything clearly in the future.
  if p_full_taken > now() + interval '1 day' then
    raise exception 'timestamp is in the future';
  end if;

  perform set_config('app.allow_manual_beer', '1', true);
  insert into public.beers(
    id, holiday_id, user_id, full_photo_path, empty_photo_path,
    full_taken_at, empty_taken_at, claimed_chug, status, is_offline
  ) values (
    p_id, p_holiday, uid, p_full_path, p_empty_path,
    p_full_taken, p_empty_taken, p_claimed_chug, 'pending', true
  );
  -- Clear the flag immediately so nothing else in this transaction inherits the
  -- trigger bypass (defence in depth; PostgREST already isolates each call).
  perform set_config('app.allow_manual_beer', '0', true);
  return p_id;
end;
$$;

grant execute on function
  public.log_offline_beer(uuid, uuid, text, text, timestamptz, timestamptz, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Surface is_offline in the audit queue so reviewers see the offline badge.
-- (Return signature changes, so drop + recreate.)
-- ---------------------------------------------------------------------------
drop function if exists public.audit_queue(uuid);
create or replace function public.audit_queue(p_holiday uuid)
returns table (
  beer_id uuid,
  owner_name text,
  full_photo_path text,
  empty_photo_path text,
  full_taken_at timestamptz,
  empty_taken_at timestamptz,
  claimed_chug boolean,
  is_offline boolean
)
language sql
security definer
set search_path = public
as $$
  select b.id, p.display_name, b.full_photo_path, b.empty_photo_path,
         b.full_taken_at, b.empty_taken_at, b.claimed_chug, b.is_offline
    from public.beers b
    join public.profiles p on p.id = b.user_id
   where b.holiday_id = p_holiday
     and b.user_id <> auth.uid()
     and b.status in ('pending','challenged')
     and b.empty_photo_path is not null
     and public.is_member(p_holiday, auth.uid())
     and not exists (
       select 1 from public.reviews r
       where r.beer_id = b.id and r.reviewer_id = auth.uid()
     )
   order by b.empty_taken_at asc;
$$;

grant execute on function public.audit_queue(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Surface is_offline in the per-player ledger.
-- ---------------------------------------------------------------------------
create or replace function public.user_ledger(p_holiday uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.holidays;
  v_admin boolean;
  v_state text;
  v_tz text;
  result jsonb;
begin
  select * into h from public.holidays where id = p_holiday;
  if not found then raise exception 'holiday not found'; end if;
  if not public.is_member(p_holiday, auth.uid()) then raise exception 'not a member'; end if;

  v_admin := (h.admin_id = auth.uid());
  v_tz := coalesce(h.timezone, 'UTC');

  if current_date >= h.end_date then
    v_state := 'reveal';
  elsif current_date >= (h.end_date - h.dark_days) then
    v_state := 'dark';
  else
    v_state := 'live';
  end if;
  if v_state = 'dark' and not v_admin then
    raise exception 'board is dark';
  end if;

  with eligible as (
    select b.id, b.user_id, b.full_taken_at, b.empty_taken_at, b.claimed_chug,
           lag(b.full_taken_at) over (
             partition by b.user_id order by b.full_taken_at
           ) as prev_start
    from public.beers b
    where b.holiday_id = p_holiday
      and b.user_id = p_user
      and b.status in ('pending','challenged','confirmed')
      and b.empty_taken_at is not null
  ),
  grouped as (
    select e.*,
           sum(case when prev_start is null
                      or full_taken_at - prev_start > interval '5 minutes'
                    then 1 else 0 end)
             over (partition by user_id order by full_taken_at) as grp
    from eligible e
  ),
  scored as (
    select g.id,
           row_number() over (
             partition by g.user_id, g.grp order by g.full_taken_at
           ) as streak_position,
           (g.claimed_chug or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds') as is_chug,
           greatest(
             row_number() over (
               partition by g.user_id, g.grp order by g.full_taken_at
             ),
             case when g.claimed_chug
                       or (g.empty_taken_at - g.full_taken_at) <= interval '60 seconds'
                  then 2 else 1 end
           ) as bonus
    from grouped g
  ),
  allb as (
    select b.id, b.full_taken_at, b.empty_taken_at, b.status, b.claimed_chug,
           b.full_photo_path, b.empty_photo_path, b.is_offline
    from public.beers b
    where b.holiday_id = p_holiday
      and b.user_id = p_user
      and b.status <> 'open'
      and b.empty_taken_at is not null
  ),
  rev as (
    select beer_id,
           count(*)::int as total,
           count(*) filter (where verdict = 'challenge')::int as challenged
    from public.reviews
    where beer_id in (select id from allb)
    group by beer_id
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'beer_id', a.id,
             'full_taken_at', a.full_taken_at,
             'empty_taken_at', a.empty_taken_at,
             'status', a.status,
             'is_chug', coalesce(
               s.is_chug,
               a.claimed_chug or (a.empty_taken_at - a.full_taken_at) <= interval '60 seconds'
             ),
             'streak_position', coalesce(s.streak_position, 0),
             'is_morning', (extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10),
             'is_offline', a.is_offline,
             'points', case
               when a.status = 'rejected' then 0
               else coalesce(s.bonus, 1)
                    + case when extract(hour from (a.full_taken_at at time zone v_tz)) between 7 and 10
                           then 1 else 0 end
             end,
             'reviews_total', coalesce(r.total, 0),
             'reviews_challenged', coalesce(r.challenged, 0),
             'full_photo_path', a.full_photo_path,
             'empty_photo_path', a.empty_photo_path
           ) order by a.full_taken_at desc
         ), '[]'::jsonb)
  into result
  from allb a
  left join scored s on s.id = a.id
  left join rev r on r.beer_id = a.id;

  return result;
end;
$$;

grant execute on function public.user_ledger(uuid, uuid) to authenticated;
