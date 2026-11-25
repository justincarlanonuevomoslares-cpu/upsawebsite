import { supabase } from './supabase/client.js';

const notice = document.querySelector('#account-notice');
const setupPanel = document.querySelector('#backend-setup');
const authPanel = document.querySelector('#auth-panel');
const dashboardPanel = document.querySelector('#membership-dashboard-launch');
const dashboardLink = document.querySelector('#membership-dashboard-link');
const heroDashboardLink = document.querySelector('#membership-hero-dashboard-link');
const membershipArea = document.querySelector('#membership-area');
const membershipAvailabilityNotice = document.querySelector('#membership-availability-notice');
const membershipBannerLink = document.querySelector('#membership-banner-link');
const membershipGuestActions = document.querySelector('#membership-guest-actions');
const membershipMemberActions = document.querySelector('#membership-member-actions');

const showNotice = (message, kind = 'info') => {
  notice.textContent = message;
  notice.className = `member-account-notice ${kind}`;
  notice.hidden = false;
};

const setDashboardLinkUnavailable = () => {
  dashboardLink.href = '#';
  dashboardLink.setAttribute('aria-disabled', 'true');
  heroDashboardLink.href = '#';
  heroDashboardLink.setAttribute('aria-disabled', 'true');
};

const updateDashboardLink = async () => {
  setDashboardLinkUnavailable();
  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error) {
    showNotice(`Your account is signed in, but dashboard access could not be checked: ${error.message}`, 'error');
    return;
  }

  const dashboardPath = isAdmin === true
    ? '../dashboards/admin.html'
    : '../dashboards/athlete.html';
  dashboardLink.href = dashboardPath;
  heroDashboardLink.href = dashboardPath;
  heroDashboardLink.removeAttribute('aria-disabled');
  dashboardLink.removeAttribute('aria-disabled');
};

const setMembershipAccess = async user => {
  const hasSession = Boolean(user);
  authPanel.hidden = hasSession;
  dashboardPanel.hidden = !hasSession;
  membershipArea.hidden = !hasSession;
  membershipGuestActions.hidden = hasSession;
  membershipMemberActions.hidden = !hasSession;
  membershipAvailabilityNotice.hidden = false;
  membershipBannerLink.href = hasSession ? '#membership-plans' : 'signup.html';
  membershipBannerLink.textContent = hasSession ? 'Explore membership ↘' : 'Join UPSA ↗';

  if (!hasSession) {
    notice.hidden = true;
    return;
  }

  await updateDashboardLink();
  if (window.location.hash === '#membership-plans') {
    requestAnimationFrame(() => {
      document.querySelector('#membership-plans').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  window.dispatchEvent(new Event('upsa:membership-access-granted'));
};

document.querySelector('#membership-signout-button').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  const { error } = await supabase.auth.signOut();
  button.disabled = false;
  if (error) showNotice(`Could not sign out: ${error.message}`, 'error');
});

dashboardLink.addEventListener('click', event => {
  if (dashboardLink.getAttribute('aria-disabled') === 'true') event.preventDefault();
});
heroDashboardLink.addEventListener('click', event => {
  if (heroDashboardLink.getAttribute('aria-disabled') === 'true') event.preventDefault();
});

if (!supabase) {
  setupPanel.hidden = false;
  authPanel.hidden = false;
} else {
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      setMembershipAccess(session?.user || null).catch(error => {
        showNotice(`Could not prepare your member dashboard: ${error.message}`, 'error');
      });
    }, 0);
  });
}
