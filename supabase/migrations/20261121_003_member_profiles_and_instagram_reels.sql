-- Member accounts, customizable public profiles, and public Instagram embeds.
-- Review and apply in staging before production.

create table public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9][a-z0-9-]{2,23}$'),
  display_name text not null default 'New surfer'
    check (char_length(display_name) between 1 and 80),
  bio text not null default ''
    check (char_length(bio) <= 500),
  home_break text not null default ''
    check (char_length(home_break) <= 120),
  surf_club text not null default ''
    check (char_length(surf_club) <= 120),
  instagram_handle text not null default ''
    check (instagram_handle = '' or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  website_url text not null default ''
    check (
      char_length(website_url) <= 2048
      and (website_url = '' or website_url ~ '^https://[^[:space:]]+$')
    ),
  theme text not null default 'ocean'
    check (theme in ('ocean', 'sand', 'sunset', 'midnight')),
  is_public boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.member_instagram_reels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.member_profiles(user_id) on delete cascade,
  reel_url text not null
    check (reel_url ~* '^https://(www[.])?instagram[.]com/(reel|p|tv)/[A-Za-z0-9_-]+/?$'),
  shortcode text not null
    check (shortcode ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, shortcode)
);

create index member_instagram_reels_owner_created_idx
  on public.member_instagram_reels (owner_id, created_at);

create or replace function public.handle_new_member_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_profiles (user_id, username, display_name)
  values (
    new.id,
    'surfer-' || substr(replace(new.id::text, '-', ''), 1, 12),
    coalesce(
      nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 80), ''),
      'New surfer'
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_member_profile
  after insert on auth.users
  for each row execute function public.handle_new_member_profile();

create or replace function public.update_member_profile_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger update_member_profile_timestamp
  before update on public.member_profiles
  for each row execute function public.update_member_profile_timestamp();

alter table public.member_profiles enable row level security;
alter table public.member_instagram_reels enable row level security;

create policy "Public can read visible member profiles"
  on public.member_profiles for select
  to anon, authenticated
  using (is_public = true);

create policy "Members can read their own profile"
  on public.member_profiles for select
  to authenticated
  using (user_id = auth.uid());

create policy "Members can create their own profile"
  on public.member_profiles for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Members can update their own profile"
  on public.member_profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Public can read reels on visible member profiles"
  on public.member_instagram_reels for select
  to anon, authenticated
  using (exists (
    select 1
    from public.member_profiles
    where member_profiles.user_id = member_instagram_reels.owner_id
      and member_profiles.is_public = true
  ));

create policy "Members can read their own reels"
  on public.member_instagram_reels for select
  to authenticated
  using (owner_id = auth.uid());

create policy "Members can add reels to their own profile"
  on public.member_instagram_reels for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "Members can remove their own reels"
  on public.member_instagram_reels for delete
  to authenticated
  using (owner_id = auth.uid());

grant select, insert, update on public.member_profiles to authenticated;
grant select on public.member_profiles to anon;
grant select, insert, delete on public.member_instagram_reels to authenticated;
grant select on public.member_instagram_reels to anon;
