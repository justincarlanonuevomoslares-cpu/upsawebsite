-- Public member-profile images and ISO 3166-1 alpha-2 nationality codes, plus XK for Kosovo.
-- Uploaded images are publicly readable; only authenticated owners can write their own folder.

alter table public.member_profiles
  add column if not exists nationality text not null default ''
    check (nationality = '' or nationality ~ '^[A-Z]{2}$'),
  add column if not exists profile_photo_path text not null default ''
    check (char_length(profile_photo_path) <= 300),
  add column if not exists cover_photo_path text not null default ''
    check (char_length(cover_photo_path) <= 300);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'member-profile-images',
  'member-profile-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Members can upload their own profile images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'member-profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and storage.extension(name) in ('jpg', 'jpeg', 'png', 'webp')
  );

create policy "Members can replace their own profile images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'member-profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'member-profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and storage.extension(name) in ('jpg', 'jpeg', 'png', 'webp')
  );

create policy "Members can remove their own profile images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'member-profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
