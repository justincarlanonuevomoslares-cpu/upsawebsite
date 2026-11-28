import { supabase } from './supabase/admin-client.js?v=20261125-8';
import { loadDashboardContent } from './dashboard-data.js';
import { syncDashboardContent } from './dashboard-sync.js';

const dashboard = document.querySelector('#admin-dashboard');
const notice = document.querySelector('#admin-notice');
const applicationBody = document.querySelector('#admin-applications-body');
const claimsList = document.querySelector('#admin-claim-list');
const applicationFilter = document.querySelector('#application-status-filter');
const applicationSearch = document.querySelector('#application-search');
const dashboardDataStatus = document.querySelector('#admin-dashboard-data-status');
const dashboardDataSyncButton = document.querySelector('#admin-sync-dashboard-data');
const dashboardDataRefreshButton = document.querySelector('#admin-refresh-dashboard-data');
const refreshAllButton = document.querySelector('#admin-refresh-all');
const adminNavItems = [...document.querySelectorAll('[data-admin-view]')];
const adminPanels = [...document.querySelectorAll('[data-admin-panel]')];
const homeUrl = new URL('../index.html', window.location.href);
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

const setAdminView = view => {
  adminNavItems.forEach(item => {
    const active = item.dataset.adminView === view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  adminPanels.forEach(panel => {
    const active = panel.dataset.adminPanel === view;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
};

const signOutToHome = async button => {
  button.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
    window.location.replace(homeUrl.href);
  } catch (error) {
    showNotice(`Could not sign out: ${getErrorMessage(error)}`, 'error');
    button.disabled = false;
  }
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

const renderAdminDashboardContent = async () => {
  const seasonLabel = document.querySelector('#admin-dashboard-season');
  const rankingCount = document.querySelector('#admin-dashboard-ranking-count');
  const eventCount = document.querySelector('#admin-dashboard-event-count');
  const rankingPreview = document.querySelector('#admin-dashboard-ranking-preview');
  const eventPreview = document.querySelector('#admin-dashboard-event-preview');

  try {
    const content = await loadDashboardContent(supabase);
    const totalRankingRows = content.categories.reduce((total, category) => total + category.rows.length, 0);
    seasonLabel.textContent = content.season?.title || 'Not synced';
    rankingCount.textContent = String(totalRankingRows);
    eventCount.textContent = String(content.events.length);
    rankingPreview.replaceChildren();
    if (!content.categories.length) {
      rankingPreview.append(createAdminDataMessage('No public rankings are available yet. Apply the dashboard sync migration, then sync website data.'));
    } else {
      content.categories.forEach(category => {
        const card = document.createElement('article');
        card.className = 'admin-dashboard-data-item';
        const heading = document.createElement('strong');
        heading.textContent = category.title;
        const list = document.createElement('ol');
        const rankIndex = category.headers.findIndex(header => header.toLowerCase() === 'rank');
        const nameIndex = category.headers.findIndex(header => header.toLowerCase() === 'name');
        const pointsIndex = category.headers.findIndex(header => header.toLowerCase().startsWith('total points'));
        category.rows.slice(0, 5).forEach((row, index) => {
          const item = document.createElement('li');
          const rank = row[rankIndex] || String(index + 1);
          const name = row[nameIndex] || 'Unknown athlete';
          const points = pointsIndex >= 0 && row[pointsIndex] ? ` · ${row[pointsIndex]} pts` : '';
          item.textContent = `${rank}. ${name}${points}`;
          list.append(item);
        });
        card.append(heading, list);
        rankingPreview.append(card);
      });
    }

    eventPreview.replaceChildren();
    if (!content.events.length) {
      eventPreview.append(createAdminDataMessage('No published upcoming events are available.'));
    } else {
      content.events.slice(0, 8).forEach(event => {
        const card = document.createElement('article');
        card.className = 'admin-dashboard-data-item';
        const heading = document.createElement('strong');
        heading.textContent = event.name;
        const details = document.createElement('p');
        details.textContent = [
          event.start_date || 'Date to be announced',
          event.location
        ].filter(Boolean).join(' · ');
        card.append(heading, details);
        eventPreview.append(card);
      });
    }
    dashboardDataStatus.textContent = totalRankingRows || content.events.length
      ? `Loaded ${totalRankingRows} ranking entries and ${content.events.length} published upcoming events.`
      : 'No dashboard data has synced yet. Apply the dashboard sync migration, then select “Sync website data”.';
    return true;
  } catch (error) {
    seasonLabel.textContent = 'Unavailable';
    rankingCount.textContent = '—';
    eventCount.textContent = '—';
    rankingPreview.replaceChildren(createAdminDataMessage('Ranking data could not be loaded.'));
    eventPreview.replaceChildren(createAdminDataMessage('Event data could not be loaded.'));
    dashboardDataStatus.textContent = `Dashboard data could not be loaded: ${getErrorMessage(error)}`;
    return false;
  }
};

const createAdminDataMessage = message => {
  const paragraph = document.createElement('p');
  paragraph.className = 'admin-dashboard-data-empty';
  paragraph.textContent = message;
  return paragraph;
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
  await renderAdminDashboardContent();
  showNotice(`Loaded ${applications.length} applications and ${athleteClaims.length} Athlete ID requests.`, 'success');
};

const syncWebsiteData = async trigger => {
  dashboardDataSyncButton.disabled = true;
  dashboardDataStatus.textContent = 'Preparing website rankings and events…';
  showNotice(trigger === 'automatic'
    ? 'Automatically syncing website rankings and events…'
    : 'Preparing website rankings and events…');

  try {
    const seasons = await window.upsaRankingsReady;
    if (!Array.isArray(seasons)) throw new Error('The local rankings source could not be loaded.');
    const results = await syncDashboardContent(supabase, seasons, message => {
      dashboardDataStatus.textContent = message;
      showNotice(message);
    });
    const previewLoaded = await renderAdminDashboardContent();
    const rankingRows = results.reduce(
      (total, result) => total + Number(result?.ranking_entries_synced || 0),
      0
    );
    const eventRows = results.reduce(
      (total, result) => total + Number(result?.events_synced || 0),
      0
    );
    dashboardDataStatus.textContent = previewLoaded
      ? `Sync complete: ${rankingRows} ranking entries and ${eventRows} event listings processed.`
      : `Sync RPCs completed (${rankingRows} ranking entries and ${eventRows} events), but the dashboard preview could not be refreshed.`;
    showNotice(
      previewLoaded
        ? `${trigger === 'automatic' ? 'Website data synced automatically' : 'Public dashboard data synced successfully'}: ${rankingRows} ranking entries and ${eventRows} events.`
        : 'Dashboard data synced, but the admin preview could not be refreshed.',
      previewLoaded ? 'success' : 'error'
    );
    return previewLoaded;
  } catch (error) {
    const message = getErrorMessage(error);
    dashboardDataStatus.textContent = `Dashboard sync failed: ${message} Check that the dashboard sync migration ran in this website’s Supabase project and that this account has the admin role.`;
    showNotice(`Could not sync public dashboard data: ${message}`, 'error');
    return false;
  } finally {
    dashboardDataSyncButton.disabled = false;
  }
};

const showAdminDashboard = async user => {
  showNotice('Checking administrator access…');
  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error) throw new Error(`Could not verify administrator access: ${error.message}`);
  if (isAdmin !== true) {
    window.location.replace(homeUrl.href);
    return;
  }

  dashboard.hidden = false;
  document.body.classList.add('admin-authenticated');
  setAdminView('overview');
  document.querySelector('#admin-current-user').textContent = user.email || 'Signed in administrator';
  let recordLoadError = '';
  try {
    await loadAdminData();
  } catch (error) {
    recordLoadError = getErrorMessage(error);
  }
  const syncSucceeded = await syncWebsiteData('automatic');
  if (recordLoadError) {
    const syncStatus = syncSucceeded
      ? 'Website data sync completed.'
      : dashboardDataStatus.textContent;
    showNotice(`Could not load administration records: ${recordLoadError}. ${syncStatus}`, 'error');
  }
};

const refreshAdminData = async button => {
  button.disabled = true;
  try {
    await loadAdminData();
  } catch (error) {
    showNotice(`Could not refresh administration data: ${getErrorMessage(error)}`, 'error');
  } finally {
    button.disabled = false;
  }
};

if (!supabase) {
  window.location.replace(homeUrl.href);
} else {
  adminNavItems.forEach(item => {
    item.addEventListener('click', () => setAdminView(item.dataset.adminView));
  });

  document.querySelector('#admin-signout').addEventListener('click', event => {
    signOutToHome(event.currentTarget);
  });

  dashboardDataRefreshButton.addEventListener('click', async () => {
    dashboardDataRefreshButton.disabled = true;
    const loaded = await renderAdminDashboardContent();
    if (!loaded) showNotice(`Could not refresh dashboard previews: ${dashboardDataStatus.textContent}`, 'error');
    else showNotice('Dashboard previews refreshed.', 'success');
    dashboardDataRefreshButton.disabled = false;
  });

  refreshAllButton.addEventListener('click', () => refreshAdminData(refreshAllButton));

  dashboardDataSyncButton.addEventListener('click', () => syncWebsiteData('manual'));

  document.querySelector('#admin-refresh').addEventListener('click', async () => {
    await refreshAdminData(document.querySelector('#admin-refresh'));
  });
  applicationFilter.addEventListener('change', renderApplications);
  applicationSearch.addEventListener('input', renderApplications);

  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      showNotice(`Could not restore your sign-in: ${error.message}`, 'error');
      return;
    }
    if (!data.session?.user) {
      window.location.replace(homeUrl.href);
      return;
    }
    showAdminDashboard(data.session.user).catch(error => {
      showNotice(`Could not load the admin dashboard: ${getErrorMessage(error)}`, 'error');
    });
  }).catch(error => {
    showNotice(`Could not restore your sign-in: ${getErrorMessage(error)}`, 'error');
  });
}
