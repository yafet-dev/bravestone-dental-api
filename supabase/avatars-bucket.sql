-- Bravestone Dental — "avatars" Storage bucket for doctor/staff profile pictures.
--
-- A Supabase Storage bucket is just a row in storage.buckets; access is governed
-- by RLS policies on storage.objects. This script is idempotent — safe to re-run.
--
-- Apply with: `npm run setup:storage` from bravestone-dental-api (uses DIRECT_URL),
-- or paste into the Supabase dashboard SQL editor.

-- 1) The bucket. Public read so <img src> works without signed URLs.
--    5 MB per file, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Anyone can read avatars (the bucket is public anyway; explicit for clarity).
drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- 3) A signed-in user may only write inside a folder named after their own auth uid,
--    e.g. avatars/<auth.uid()>/profile-...png — so no one can overwrite someone else's.
drop policy if exists "Users manage their own avatar (insert)" on storage.objects;
create policy "Users manage their own avatar (insert)"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users manage their own avatar (update)" on storage.objects;
create policy "Users manage their own avatar (update)"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users manage their own avatar (delete)" on storage.objects;
create policy "Users manage their own avatar (delete)"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
