-- Admin-only membership application management and athlete claim review.

create table public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  external_submission_id text not null unique
    check (char_length(external_submission_id) between 1 and 300),
  source_form_key text not null
    check (char_length(source_form_key) between 1 and 100),
  submitted_at timestamptz not null default timezone('utc', now()),
  applicant_name text not null default ''
    check (char_length(applicant_name) <= 160),
  applicant_email text not null default ''
    check (char_length(applicant_email) <= 320),
  applicant_phone text not null default ''
    check (char_length(applicant_phone) <= 80),
  application_type text not null default ''
    check (char_length(application_type) <= 80),
  membership_plan text not null default ''
    check (char_length(membership_plan) <= 120),
  athlete_id text not null default ''
    check (char_length(athlete_id) <= 80),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'under_review', 'approved', 'rejected')),
  payment_status text not null default 'unverified'
    check (payment_status in ('unverified', 'pending', 'confirmed', 'rejected', 'not_required')),
  review_notes text not null default ''
    check (char_length(review_notes) <= 1000),
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object'),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index membership_applications_status_submitted_idx
  on public.membership_applications (review_status, submitted_at desc);
create index membership_applications_payment_status_idx
  on public.membership_applications (payment_status);

alter table public.membership_applications enable row level security;

create policy "Admins can read membership applications"
  on public.membership_applications for select
  to authenticated
  using (public.is_admin());

create policy "Admins can read member profiles"
  on public.member_profiles for select
  to authenticated
  using (public.is_admin());

create policy "Admins can read athlete profile claims"
  on public.member_athlete_profile_claims for select
  to authenticated
  using (public.is_admin());

revoke all on public.membership_applications from anon, authenticated;
grant select on public.membership_applications to authenticated;
grant all on public.membership_applications to service_role;

create or replace function public.prevent_user_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('upsa.bootstrap_admin', true) = 'on' then
    return new;
  end if;

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

create or replace function public.bootstrap_initial_admin(target_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_user_id uuid;
begin
  if exists (
    select 1
      from public.user_profiles
     where role = 'admin'
       and account_status = 'active'
  ) then
    raise exception 'An active administrator already exists; use assign_admin for additional administrators';
  end if;

  select auth_user.id
    into target_user_id
    from auth.users as auth_user
    join public.user_profiles as profile on profile.id = auth_user.id
   where lower(auth_user.email) = lower(trim(target_email))
     and profile.account_status = 'active';

  if not found then
    raise exception 'No active account exists for that email; sign up and confirm the account first';
  end if;

  perform set_config('upsa.bootstrap_admin', 'on', true);
  update public.user_profiles
     set role = 'admin',
         updated_at = timezone('utc', now())
   where id = target_user_id;
  perform set_config('upsa.bootstrap_admin', 'off', true);

  insert into public.admin_activity_logs (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    null,
    'bootstrap_admin',
    'user_profile',
    target_user_id,
    jsonb_build_object('role', 'admin')
  );

  return target_user_id;
end;
$$;

revoke all on function public.bootstrap_initial_admin(text) from public, anon, authenticated, service_role;

create or replace function public.admin_update_membership_application(
  target_application_id uuid,
  new_review_status text,
  new_payment_status text,
  new_review_notes text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_row public.membership_applications%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can update membership applications';
  end if;
  if new_review_status not in ('pending', 'under_review', 'approved', 'rejected') then
    raise exception 'Invalid membership review status';
  end if;
  if new_payment_status not in ('unverified', 'pending', 'confirmed', 'rejected', 'not_required') then
    raise exception 'Invalid payment status';
  end if;
  if char_length(coalesce(new_review_notes, '')) > 1000 then
    raise exception 'Review notes must be 1000 characters or fewer';
  end if;

  select *
    into application_row
    from public.membership_applications
   where id = target_application_id
   for update;

  if not found then
    raise exception 'Membership application does not exist';
  end if;

  update public.membership_applications
     set review_status = new_review_status,
         payment_status = new_payment_status,
         review_notes = coalesce(new_review_notes, ''),
         reviewed_by = auth.uid(),
         reviewed_at = timezone('utc', now()),
         updated_at = timezone('utc', now())
   where id = target_application_id;

  insert into public.admin_activity_logs (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    auth.uid(),
    'review_membership_application',
    'membership_application',
    target_application_id,
    jsonb_build_object(
      'review_status', jsonb_build_object('old', application_row.review_status, 'new', new_review_status),
      'payment_status', jsonb_build_object('old', application_row.payment_status, 'new', new_payment_status)
    )
  );
end;
$$;

revoke all on function public.admin_update_membership_application(uuid, text, text, text) from public;
grant execute on function public.admin_update_membership_application(uuid, text, text, text) to authenticated;

create or replace function public.admin_review_member_athlete_claim(
  target_claim_id uuid,
  decision text,
  reviewer_notes text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claim_row public.member_athlete_profile_claims%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can review athlete claims';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  if char_length(coalesce(reviewer_notes, '')) > 1000 then
    raise exception 'Review notes must be 1000 characters or fewer';
  end if;

  select *
    into claim_row
    from public.member_athlete_profile_claims
   where id = target_claim_id
   for update;

  if not found or claim_row.status <> 'pending' then
    raise exception 'Athlete claim does not exist or is no longer pending';
  end if;

  if decision = 'approved' then
    insert into public.member_athlete_profile_links (
      member_user_id,
      source_athlete_id,
      athlete_profile_key
    )
    values (
      claim_row.claimant_user_id,
      claim_row.source_athlete_id,
      'id:' || claim_row.source_athlete_id
    );
  end if;

  update public.member_athlete_profile_claims
     set status = decision,
         review_notes = coalesce(reviewer_notes, ''),
         reviewed_at = timezone('utc', now())
   where id = target_claim_id;

  insert into public.admin_activity_logs (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    auth.uid(),
    'review_athlete_profile_claim',
    'member_athlete_profile_claim',
    target_claim_id,
    jsonb_build_object(
      'status', jsonb_build_object('old', 'pending', 'new', decision),
      'source_athlete_id', claim_row.source_athlete_id
    )
  );
end;
$$;

revoke all on function public.admin_review_member_athlete_claim(uuid, text, text) from public;
grant execute on function public.admin_review_member_athlete_claim(uuid, text, text) to authenticated;
