-- Combined UPSA base schema: migrations 001 and 002, in order.
-- Run only if neither base migration has already been applied.
-- Review and test in staging before using a production project.

BEGIN;

-- MIGRATION 001: INITIAL SCHEMA
-- UPSA Supabase draft migration
-- Review only. Do not execute against a live database.

create type public.app_role as enum ('player', 'admin');
create type public.account_status as enum ('active', 'disabled', 'pending');
create type public.profile_verification_status as enum ('unverified', 'provisional', 'verified');
create type public.identity_review_status as enum ('pending', 'approved', 'rejected', 'needs_evidence');
create type public.claim_status as enum ('pending', 'approved', 'rejected');
create type public.publication_status as enum ('draft', 'published', 'archived');

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'player',
  account_status public.account_status not null default 'active',
  athlete_id uuid,
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  source_athlete_id text,
  official_name text not null,
  profile_photo_path text,
  cover_photo_path text,
  biography text,
  surf_club text,
  hometown text,
  nationality text,
  verification_status public.profile_verification_status not null default 'unverified',
  is_public boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_profiles
  add constraint user_profiles_athlete_fk
  foreign key (athlete_id) references public.athletes(id) on delete set null;

create unique index athletes_source_athlete_id_uidx
  on public.athletes(source_athlete_id)
  where source_athlete_id is not null;

create table public.athlete_name_variants (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  source_year integer,
  is_official boolean not null default false,
  verification_status public.profile_verification_status not null default 'unverified',
  created_at timestamptz not null default timezone('utc', now()),
  unique (athlete_id, normalized_name)
);

create table public.athlete_source_identities (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references public.athletes(id) on delete set null,
  source_type text not null default 'ranking',
  source_athlete_id text,
  source_name text not null,
  normalized_source_name text not null,
  season_year integer,
  division_source_title text,
  source_row_index integer,
  match_status text not null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.user_profiles(id),
  review_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  check (match_status in (
    'source-id',
    'exact-name',
    'exact-name-provisional',
    'conflicting-id',
    'duplicate-name',
    'name-only',
    'manual-review'
  ))
);

create table public.athlete_photos (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  photo_type text not null,
  storage_bucket text not null,
  storage_path text not null,
  is_verified boolean not null default false,
  alt_text text,
  source_url text,
  created_at timestamptz not null default timezone('utc', now()),
  check (photo_type in ('profile', 'cover', 'gallery')),
  unique (athlete_id, photo_type, storage_path)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  year integer not null unique,
  title text not null,
  is_public boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_title text not null,
  normalized_key text not null,
  display_name text not null,
  sort_order integer,
  created_at timestamptz not null default timezone('utc', now()),
  unique (season_id, normalized_key)
);

create table public.ranking_source_records (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  division_id uuid not null references public.divisions(id),
  source_year integer not null,
  source_category_title text not null,
  source_category_index integer not null,
  source_row_index integer not null,
  source_headers jsonb not null,
  source_row jsonb not null,
  source_hash text not null,
  imported_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (season_id, division_id, source_row_index),
  unique (source_hash)
);

create table public.ranking_entries (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references public.athletes(id) on delete set null,
  season_id uuid not null references public.seasons(id),
  division_id uuid not null references public.divisions(id),
  source_record_id uuid not null references public.ranking_source_records(id) on delete cascade,
  source_name text not null,
  source_athlete_id text,
  rank_value numeric,
  rank_label text,
  total_points numeric,
  total_points_label text,
  carryover_points numeric,
  identity_match_status text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source_record_id)
);

create table public.ranking_leg_points (
  id uuid primary key default gen_random_uuid(),
  ranking_entry_id uuid not null references public.ranking_entries(id) on delete cascade,
  leg_label text not null,
  leg_number integer,
  points numeric,
  source_value text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (ranking_entry_id, leg_label)
);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id),
  name text not null,
  description text,
  location text,
  start_date date,
  end_date date,
  category text,
  featured_image_path text,
  publication_status public.publication_status not null default 'draft',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.competition_results (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  division_id uuid references public.divisions(id),
  placement integer,
  points numeric,
  result_date date,
  source_url text,
  source_note text,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  location text,
  start_date date,
  end_date date,
  category text,
  featured_image_path text,
  publication_status public.publication_status not null default 'draft',
  external_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.news_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  summary text,
  content text,
  featured_image_path text,
  category text,
  author_profile_id uuid references public.user_profiles(id),
  author_name text,
  published_at timestamptz,
  publication_status public.publication_status not null default 'draft',
  external_source_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.athlete_achievements (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  achievement_type text not null,
  title text not null,
  description text,
  ranking_entry_id uuid references public.ranking_entries(id),
  competition_result_id uuid references public.competition_results(id),
  season_year integer,
  source_note text,
  is_public boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  check (ranking_entry_id is not null or competition_result_id is not null)
);

create table public.athlete_profile_claims (
  id uuid primary key default gen_random_uuid(),
  claimant_user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  status public.claim_status not null default 'pending',
  requested_name text,
  evidence text,
  reviewed_by uuid references public.user_profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.athlete_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references public.athletes(id) on delete set null,
  source_identity_id uuid references public.athlete_source_identities(id) on delete set null,
  status public.identity_review_status not null default 'pending',
  reason text,
  evidence text,
  reviewed_by uuid references public.user_profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.admin_activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.user_profiles(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  changes jsonb,
  ip_address inet,
  created_at timestamptz not null default timezone('utc', now())
);

create index ranking_entries_season_idx on public.ranking_entries(season_id);
create index ranking_entries_athlete_idx on public.ranking_entries(athlete_id);
create index ranking_entries_division_idx on public.ranking_entries(division_id);
create index source_identities_source_id_idx on public.athlete_source_identities(source_athlete_id);
create index source_identities_normalized_name_idx on public.athlete_source_identities(normalized_source_name);
create index events_publication_idx on public.events(publication_status, start_date);
create index news_publication_idx on public.news_articles(publication_status, published_at);

-- MIGRATION 002: RLS POLICIES
-- UPSA Supabase draft RLS policies
-- Review only. Do not execute against a live database.

alter table public.user_profiles enable row level security;
alter table public.athletes enable row level security;
alter table public.athlete_name_variants enable row level security;
alter table public.athlete_source_identities enable row level security;
alter table public.athlete_photos enable row level security;
alter table public.seasons enable row level security;
alter table public.divisions enable row level security;
alter table public.ranking_source_records enable row level security;
alter table public.ranking_entries enable row level security;
alter table public.ranking_leg_points enable row level security;
alter table public.competitions enable row level security;
alter table public.competition_results enable row level security;
alter table public.events enable row level security;
alter table public.news_articles enable row level security;
alter table public.athlete_achievements enable row level security;
alter table public.athlete_profile_claims enable row level security;
alter table public.athlete_identity_reviews enable row level security;
alter table public.admin_activity_logs enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and role = 'admin'
      and account_status = 'active'
  );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.user_athlete_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select athlete_id
  from public.user_profiles
  where id = auth.uid()
    and account_status = 'active';
$$;

revoke execute on function public.user_athlete_id() from public;
grant execute on function public.user_athlete_id() to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, role, account_status)
  values (new.id, 'player', 'active')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.prevent_user_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() and (
    new.role is distinct from 'player'
    or new.account_status is distinct from 'active'
    or new.athlete_id is distinct from old.athlete_id
  ) then
    raise exception 'Unauthorized profile field change';
  end if;
  return new;
end;
$$;

create trigger prevent_user_profile_escalation
  before update on public.user_profiles
  for each row execute function public.prevent_user_profile_role_escalation();

create or replace function public.assign_admin(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can assign an administrator';
  end if;

  update public.user_profiles
  set role = 'admin', updated_at = timezone('utc', now())
  where id = target_profile_id;

  insert into public.admin_activity_logs (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    auth.uid(),
    'assign_admin',
    'user_profile',
    target_profile_id,
    jsonb_build_object('role', 'admin')
  );
end;
$$;

revoke execute on function public.assign_admin(uuid) from public;
grant execute on function public.assign_admin(uuid) to authenticated;

-- PUBLIC READ POLICIES
create policy "Public profiles are readable"
  on public.athletes for select
  to anon, authenticated
  using (is_public = true);

create policy "Public name variants are readable"
  on public.athlete_name_variants for select
  to anon, authenticated
  using (exists (
    select 1 from public.athletes
    where athletes.id = athlete_name_variants.athlete_id
      and athletes.is_public = true
  ));

create policy "Public athlete source identities are readable"
  on public.athlete_source_identities for select
  to anon, authenticated
  using (athlete_id is null or exists (
    select 1 from public.athletes
    where athletes.id = athlete_source_identities.athlete_id
      and athletes.is_public = true
  ));

create policy "Public athlete photos are readable"
  on public.athlete_photos for select
  to anon, authenticated
  using (is_verified = true and exists (
    select 1 from public.athletes
    where athletes.id = athlete_photos.athlete_id
      and athletes.is_public = true
  ));

create policy "Public seasons are readable"
  on public.seasons for select
  to anon, authenticated
  using (is_public = true);

create policy "Public divisions are readable"
  on public.divisions for select
  to anon, authenticated
  using (exists (
    select 1 from public.seasons
    where seasons.id = divisions.season_id
      and seasons.is_public = true
  ));

create policy "Public ranking entries are readable"
  on public.ranking_entries for select
  to anon, authenticated
  using (exists (
    select 1 from public.seasons
    where seasons.id = ranking_entries.season_id
      and seasons.is_public = true
  ));

create policy "Public leg points are readable"
  on public.ranking_leg_points for select
  to anon, authenticated
  using (exists (
    select 1 from public.ranking_entries
    join public.seasons on seasons.id = ranking_entries.season_id
    where ranking_entries.id = ranking_leg_points.ranking_entry_id
      and seasons.is_public = true
  ));

create policy "Public achievements are readable"
  on public.athlete_achievements for select
  to anon, authenticated
  using (is_public = true);

create policy "Public competition results are readable"
  on public.competition_results for select
  to anon, authenticated
  using (exists (
    select 1 from public.competitions
    where competitions.id = competition_results.competition_id
      and competitions.publication_status = 'published'
  ));

create policy "Published events are readable"
  on public.events for select
  to anon, authenticated
  using (publication_status = 'published');

create policy "Published news is readable"
  on public.news_articles for select
  to anon, authenticated
  using (publication_status = 'published');

create policy "Public competition records are readable"
  on public.competitions for select
  to anon, authenticated
  using (publication_status = 'published');

create policy "Public source records are readable"
  on public.ranking_source_records for select
  to anon, authenticated
  using (exists (
    select 1 from public.seasons
    where seasons.id = ranking_source_records.season_id
      and seasons.is_public = true
  ));

-- OWN ACCOUNT AND CLAIM POLICIES
create policy "Players can view own profile"
  on public.user_profiles for select
  to authenticated
  using (id = auth.uid());

create policy "Players cannot directly insert profiles"
  on public.user_profiles for insert
  to authenticated
  with check (false);

create policy "Players can update display name"
  on public.user_profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'player');

create policy "Players can submit profile claims"
  on public.athlete_profile_claims for insert
  to authenticated
  with check (claimant_user_id = auth.uid());

create policy "Players can view own profile claims"
  on public.athlete_profile_claims for select
  to authenticated
  using (claimant_user_id = auth.uid());

create policy "Players can update own pending profile claims"
  on public.athlete_profile_claims for update
  to authenticated
  using (claimant_user_id = auth.uid() and status = 'pending')
  with check (claimant_user_id = auth.uid() and status = 'pending');

create policy "Players can update permitted own athlete fields"
  on public.athletes for update
  to authenticated
  using (id = public.user_athlete_id())
  with check (id = public.user_athlete_id());

revoke update on public.athletes from authenticated;
grant update (
  profile_photo_path,
  cover_photo_path,
  biography,
  surf_club,
  hometown,
  nationality
) on public.athletes to authenticated;

-- ADMIN POLICIES
create policy "Admins manage user profiles"
  on public.user_profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage athletes"
  on public.athletes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage athlete names"
  on public.athlete_name_variants for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage source identities"
  on public.athlete_source_identities for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage athlete photos"
  on public.athlete_photos for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage seasons"
  on public.seasons for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage divisions"
  on public.divisions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage source records"
  on public.ranking_source_records for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage ranking entries"
  on public.ranking_entries for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage leg points"
  on public.ranking_leg_points for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage competitions"
  on public.competitions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage competition results"
  on public.competition_results for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage events"
  on public.events for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage news"
  on public.news_articles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage achievements"
  on public.athlete_achievements for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins review profile claims"
  on public.athlete_profile_claims for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins review identity records"
  on public.athlete_identity_reviews for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins read activity logs"
  on public.admin_activity_logs for select
  to authenticated
  using (public.is_admin());

create policy "Admins insert activity logs"
  on public.admin_activity_logs for insert
  to authenticated
  with check (public.is_admin());

COMMIT;
