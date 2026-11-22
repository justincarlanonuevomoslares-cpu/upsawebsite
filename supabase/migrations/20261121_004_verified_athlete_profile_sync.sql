-- Verified links between member accounts and ranking-derived athlete profiles.
-- Admins approve claims in Supabase before inserting into member_athlete_profile_links.

alter table public.member_profiles
  add column if not exists profile_photo_url text not null default ''
    check (
      char_length(profile_photo_url) <= 2048
      and (profile_photo_url = '' or profile_photo_url ~ '^https://[^[:space:]]+$')
    ),
  add column if not exists cover_photo_url text not null default ''
    check (
      char_length(cover_photo_url) <= 2048
      and (cover_photo_url = '' or cover_photo_url ~ '^https://[^[:space:]]+$')
    );

create table public.member_athlete_profile_claims (
  id uuid primary key default gen_random_uuid(),
  claimant_user_id uuid not null references auth.users(id) on delete cascade,
  source_athlete_id text not null
    check (source_athlete_id ~ '^[A-Za-z0-9._-]{1,80}$'),
  evidence text not null default ''
    check (char_length(evidence) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_notes text not null default ''
    check (char_length(review_notes) <= 1000),
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index member_athlete_claims_one_pending_per_user_uidx
  on public.member_athlete_profile_claims (claimant_user_id)
  where status = 'pending';

create table public.member_athlete_profile_links (
  member_user_id uuid primary key references public.member_profiles(user_id) on delete cascade,
  source_athlete_id text not null unique
    check (source_athlete_id ~ '^[A-Za-z0-9._-]{1,80}$'),
  athlete_profile_key text not null unique
    check (athlete_profile_key = 'id:' || source_athlete_id),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.member_athlete_profile_claims enable row level security;
alter table public.member_athlete_profile_links enable row level security;

create policy "Members can submit their own athlete profile claims"
  on public.member_athlete_profile_claims for insert
  to authenticated
  with check (
    claimant_user_id = auth.uid()
    and status = 'pending'
    and review_notes = ''
    and reviewed_at is null
  );

create policy "Members can read their own athlete profile claims"
  on public.member_athlete_profile_claims for select
  to authenticated
  using (claimant_user_id = auth.uid());

create policy "Members can read their own verified athlete link"
  on public.member_athlete_profile_links for select
  to authenticated
  using (member_user_id = auth.uid());

create policy "Public can read verified links for visible profiles"
  on public.member_athlete_profile_links for select
  to anon, authenticated
  using (exists (
    select 1
    from public.member_profiles
    where member_profiles.user_id = member_athlete_profile_links.member_user_id
      and member_profiles.is_public = true
  ));

grant select, insert on public.member_athlete_profile_claims to authenticated;
grant select on public.member_athlete_profile_links to anon, authenticated;
