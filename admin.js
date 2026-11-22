import { supabase } from './supabase/client.js';

const authPanel = document.querySelector('#admin-auth-panel');
const signinForm = document.querySelector('#admin-signin-form');
const switchAccountButton = document.querySelector('#admin-switch-account');
const dashboard = document.querySelector('#admin-dashboard');
const notice = document.querySelector('#admin-notice');
const applicationBody = document.querySelector('#admin-applications-body');
const claimsList = document.querySelector('#admin-claim-list');
const applicationFilter = document.querySelector('#application-status-filter');
const applicationSearch = document.querySelector('#application-search');
const siteRoot = new URL('./', import.meta.url);
let applications = [];
let athleteClaims = [];
let memberProfiles = new Map();

const getErrorMessage = error => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
};

const showNotice = (message, kind = 'info') => {
  notice.textContent = message;
  notice.className = `member-account-notice ${kind}`;
  notice.hidden = false;
};

const createOption = (value, label, selectedValue) => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.selected = value === selectedValue;
  return option;
};

const createCell = text => {
  const cell = document.createElement('td');
  cell.textContent = text || '—';
  return cell;
};

const formatDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
};

const addAnswerDetails = answers => {
  const details = document.createElement('details');
  details.className = 'admin-answer-details';
  const summary = document.createElement('summary');
  summary.textContent = 'View responses';
  const list = document.createElement('dl');
  const entries = Object.entries(answers || {});

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No response fields were included.';
    details.append(summary, empty);
    return details;
  }

  entries.forEach(([key, value]) => {
    const term = document.createElement('dt');
    term.textContent = key;
    const description = document.createElement('dd');
    description.textContent = typeof value === 'string' ? value : JSON.stringify(value);
    list.append(term, description);
  });
  details.append(summary, list);
  return details;
};

const saveApplicationReview = async (application, reviewStatus, paymentStatus, notes, button) => {
  button.disabled = true;
  try {
    const { error } = await supabase.rpc('admin_update_membership_application', {
      target_application_id: application.id,
      new_review_status: reviewStatus,
      new_payment_status: paymentStatus,
      new_review_notes: notes
    });
    if (error) throw new Error(error.message);
    showNotice('Membership application review saved.', 'success');
  } catch (error) {
    showNotice(`Could not save this application: ${getErrorMessage(error)}`, 'error');
    button.disabled = false;
    return;
  }
  try {
    await loadAdminData();
  } catch (error) {
    showNotice(`Application saved, but the list could not be refreshed: ${getErrorMessage(error)}`, 'error');
  } finally {
    button.disabled = false;
  }
};

const renderApplication = application => {
  const row = document.createElement('tr');
  row.append(createCell(formatDate(application.submitted_at)));

  const applicantCell = document.createElement('td');
  const applicantName = document.createElement('strong');
  applicantName.textContent = application.applicant_name || 'Name not supplied';
  const applicantEmail = document.createElement('small');
  applicantEmail.textContent = application.applicant_email || 'Email not supplied';
  const applicantPhone = document.createElement('small');
  applicantPhone.textContent = application.applicant_phone || '';
  applicantCell.append(applicantName, applicantEmail);
  if (application.applicant_phone) applicantCell.append(applicantPhone);
  row.append(applicantCell);

  const applicationCell = document.createElement('td');
  const applicationDescription = [
    application.application_type,
    application.membership_plan,
    application.athlete_id ? `Athlete ID ${application.athlete_id}` : ''
  ].filter(Boolean);
  const description = document.createElement('span');
  description.textContent = applicationDescription.join(' · ') || application.source_form_key;
  const source = document.createElement('small');
  source.textContent = application.source_form_key;
  applicationCell.append(description, source);
  row.append(applicationCell);

  const statusCell = document.createElement('td');
  const reviewSelect = document.createElement('select');
  reviewSelect.setAttribute('aria-label', `Review status for ${application.applicant_name || 'application'}`);
  [
    ['pending', 'Pending'],
    ['under_review', 'Under review'],
    ['approved', 'Approved'],
    ['rejected', 'Rejected']
  ].forEach(([value, label]) => reviewSelect.append(createOption(value, label, application.review_status)));

  const paymentSelect = document.createElement('select');
  paymentSelect.setAttribute('aria-label', `Payment status for ${application.applicant_name || 'application'}`);
  [
    ['unverified', 'Unverified'],
    ['pending', 'Pending'],
    ['confirmed', 'Confirmed'],
    ['rejected', 'Not confirmed'],
    ['not_required', 'Not required']
  ].forEach(([value, label]) => paymentSelect.append(createOption(value, label, application.payment_status)));
  statusCell.append(reviewSelect, paymentSelect);
  row.append(statusCell);

  const answersCell = document.createElement('td');
  answersCell.append(addAnswerDetails(application.answers));
  row.append(answersCell);

  const actionCell = document.createElement('td');
  const notes = document.createElement('textarea');
  notes.rows = 2;
  notes.maxLength = 1000;
  notes.placeholder = 'Internal review note';
  notes.value = application.review_notes || '';
  notes.setAttribute('aria-label', `Review notes for ${application.applicant_name || 'application'}`);
  const saveButton = document.createElement('button');
  saveButton.className = 'admin-save-button';
  saveButton.type = 'button';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => saveApplicationReview(
    application,
    reviewSelect.value,
    paymentSelect.value,
    notes.value.trim(),
    saveButton
  ));
  actionCell.append(notes, saveButton);
  row.append(actionCell);
  return row;
};

const renderApplications = () => {
  const selectedStatus = applicationFilter.value;
  const search = applicationSearch.value.trim().toLowerCase();
  const filtered = applications.filter(application => {
    if (selectedStatus !== 'all' && application.review_status !== selectedStatus) return false;
    if (!search) return true;
    const searchable = [
      application.applicant_name,
      application.applicant_email,
      application.applicant_phone,
      application.application_type,
      application.membership_plan,
      application.athlete_id,
      application.source_form_key,
      JSON.stringify(application.answers)
    ].join(' ').toLowerCase();
    return searchable.includes(search);
  });

  applicationBody.replaceChildren(...filtered.map(renderApplication));
  const emptyMessage = document.querySelector('#admin-applications-empty');
  emptyMessage.hidden = filtered.length > 0;
  emptyMessage.textContent = applications.length
    ? 'No applications match the selected filters.'
    : 'No membership applications have synced yet.';
  document.querySelector('#admin-application-count').textContent = String(applications.length);
  document.querySelector('#admin-pending-count').textContent = String(
    applications.filter(application => application.review_status === 'pending').length
  );
  document.querySelector('#admin-payment-count').textContent = String(
    applications.filter(application => application.payment_status === 'unverified').length
  );
};

const reviewAthleteClaim = async (claim, decision, notes, button) => {
  button.disabled = true;
  try {
    const { error } = await supabase.rpc('admin_review_member_athlete_claim', {
      target_claim_id: claim.id,
      decision,
      reviewer_notes: notes
    });
    if (error) throw new Error(error.message);
    showNotice(`Athlete ID request ${decision}.`, 'success');
  } catch (error) {
    showNotice(`Could not review this Athlete ID request: ${getErrorMessage(error)}`, 'error');
    button.disabled = false;
    return;
  }
  try {
    await loadAdminData();
  } catch (error) {
    showNotice(`Claim review saved, but the lists could not be refreshed: ${getErrorMessage(error)}`, 'error');
  } finally {
    button.disabled = false;
  }
};

const renderClaim = claim => {
  const card = document.createElement('article');
  card.className = 'admin-claim-card';
  const profile = memberProfiles.get(claim.claimant_user_id);
  const heading = document.createElement('div');
  const memberName = document.createElement('strong');
  memberName.textContent = profile?.display_name || 'Member account';
  const username = document.createElement('small');
  username.textContent = profile?.username ? `@${profile.username}` : claim.claimant_user_id;
  heading.append(memberName, username);

  const details = document.createElement('p');
  details.textContent = `Athlete ID ${claim.source_athlete_id} · Submitted ${formatDate(claim.created_at)}`;
  const evidence = document.createElement('p');
  evidence.className = 'admin-claim-evidence';
  evidence.textContent = claim.evidence || 'No evidence was provided.';

  const lookup = new URL('athlete-profile.html', siteRoot);
  lookup.searchParams.set('athlete', `id:${claim.source_athlete_id}`);
  const lookupLink = document.createElement('a');
  lookupLink.href = lookup.href;
  lookupLink.target = '_blank';
  lookupLink.rel = 'noopener noreferrer';
  lookupLink.textContent = 'Check official profile ↗';

  const status = document.createElement('span');
  status.className = `admin-status-pill ${claim.status}`;
  status.textContent = claim.status.replace('_', ' ');
  card.append(heading, details, evidence, lookupLink, status);

  if (claim.status === 'pending') {
    const notes = document.createElement('textarea');
    notes.rows = 2;
    notes.maxLength = 1000;
    notes.placeholder = 'Review note (optional)';
    notes.setAttribute('aria-label', `Review notes for Athlete ID ${claim.source_athlete_id}`);
    const actions = document.createElement('div');
    actions.className = 'admin-claim-actions';
    const approveButton = document.createElement('button');
    approveButton.className = 'admin-save-button';
    approveButton.type = 'button';
    approveButton.textContent = 'Approve';
    approveButton.addEventListener('click', () =>
      reviewAthleteClaim(claim, 'approved', notes.value.trim(), approveButton)
    );
    const rejectButton = document.createElement('button');
    rejectButton.className = 'admin-reject-button';
    rejectButton.type = 'button';
    rejectButton.textContent = 'Reject';
    rejectButton.addEventListener('click', () =>
      reviewAthleteClaim(claim, 'rejected', notes.value.trim(), rejectButton)
    );
    actions.append(approveButton, rejectButton);
    card.append(notes, actions);
  } else if (claim.review_notes) {
    const reviewNotes = document.createElement('p');
    reviewNotes.className = 'admin-review-note';
    reviewNotes.textContent = `Review note: ${claim.review_notes}`;
    card.append(reviewNotes);
  }
  return card;
};

const loadAdminData = async () => {
  showNotice('Loading administration records…');
  const [applicationsResult, claimsResult] = await Promise.all([
    supabase
      .from('membership_applications')
      .select('id, external_submission_id, source_form_key, submitted_at, applicant_name, applicant_email, applicant_phone, application_type, membership_plan, athlete_id, review_status, payment_status, review_notes, answers')
      .order('submitted_at', { ascending: false })
      .limit(500),
    supabase
      .from('member_athlete_profile_claims')
      .select('id, claimant_user_id, source_athlete_id, evidence, status, review_notes, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
  ]);
  if (applicationsResult.error) throw new Error(applicationsResult.error.message);
  if (claimsResult.error) throw new Error(claimsResult.error.message);

  applications = applicationsResult.data || [];
  athleteClaims = claimsResult.data || [];
  const userIds = [...new Set(athleteClaims.map(claim => claim.claimant_user_id))];
  memberProfiles = new Map();
  if (userIds.length) {
    const userIdGroups = [];
    for (let index = 0; index < userIds.length; index += 50) {
      userIdGroups.push(userIds.slice(index, index + 50));
    }
    const profileResults = await Promise.all(userIdGroups.map(userIdGroup =>
      supabase
        .from('member_profiles')
        .select('user_id, username, display_name')
        .in('user_id', userIdGroup)
    ));
    profileResults.forEach(({ data, error }) => {
      if (error) throw new Error(error.message);
      (data || []).forEach(profile => memberProfiles.set(profile.user_id, profile));
    });
  }

  renderApplications();
  claimsList.replaceChildren(...athleteClaims.map(renderClaim));
  document.querySelector('#admin-claims-empty').hidden = athleteClaims.length > 0;
  document.querySelector('#admin-claim-count').textContent = String(
    athleteClaims.filter(claim => claim.status === 'pending').length
  );
  showNotice(`Loaded ${applications.length} applications and ${athleteClaims.length} Athlete ID requests.`, 'success');
};

const showAdminDashboard = async user => {
  showNotice('Checking administrator access…');
  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error) throw new Error(`Could not verify administrator access: ${error.message}`);
  if (isAdmin !== true) {
    signinForm.hidden = true;
    switchAccountButton.hidden = false;
    showNotice('This account does not have administrator access. Sign out before switching to an authorized admin account.', 'error');
    return;
  }

  authPanel.hidden = true;
  dashboard.hidden = false;
  document.querySelector('#admin-current-user').textContent = user.email || 'Signed in administrator';
  await loadAdminData();
};

if (!supabase) {
  signinForm.hidden = true;
  showNotice('Administrator access is unavailable until Supabase is configured.', 'error');
} else {
  signinForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = signinForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showNotice('Signing in…');
    let user;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: signinForm.elements.email.value.trim(),
        password: signinForm.elements.password.value
      });
      if (error) throw new Error(error.message);
      if (!data.user) throw new Error('Supabase did not return an authenticated user.');
      user = data.user;
    } catch (error) {
      showNotice(`Could not sign in: ${getErrorMessage(error)}`, 'error');
      button.disabled = false;
      return;
    }
    try {
      await showAdminDashboard(user);
    } catch (error) {
      showNotice(`Signed in, but could not load the admin dashboard: ${getErrorMessage(error)}`, 'error');
    } finally {
      button.disabled = false;
    }
  });

  switchAccountButton.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showNotice(`Could not sign out: ${error.message}`, 'error');
      return;
    }
    signinForm.reset();
    signinForm.hidden = false;
    switchAccountButton.hidden = true;
    showNotice('Signed out. Sign in with an administrator account.');
  });

  document.querySelector('#admin-signout').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showNotice(`Could not sign out: ${error.message}`, 'error');
      return;
    }
    dashboard.hidden = true;
    authPanel.hidden = false;
    signinForm.hidden = false;
    showNotice('Signed out.');
  });

  document.querySelector('#admin-refresh').addEventListener('click', async () => {
    try {
      await loadAdminData();
    } catch (error) {
      showNotice(`Could not load administration records: ${getErrorMessage(error)}`, 'error');
    }
  });
  applicationFilter.addEventListener('change', renderApplications);
  applicationSearch.addEventListener('input', renderApplications);

  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      showNotice(`Could not restore your sign-in: ${error.message}`, 'error');
      return;
    }
    if (data.session?.user) {
      showAdminDashboard(data.session.user).catch(error => {
        showNotice(`Could not load the admin dashboard: ${getErrorMessage(error)}`, 'error');
      });
    }
  }).catch(error => {
    showNotice(`Could not restore your sign-in: ${getErrorMessage(error)}`, 'error');
  });
}
