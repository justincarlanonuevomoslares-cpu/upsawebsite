import { supabase } from './supabase/client.js';

const siteRoot = new URL('./', import.meta.url);
const membershipUrl = new URL('membership/membership.html#membership-account', siteRoot).href;
const formPanel = document.querySelector('#auth-form-panel');
const setupPanel = document.querySelector('#backend-setup');
const notice = document.querySelector('#auth-notice');

const showNotice = (message, kind = 'info') => {
  notice.textContent = message;
  notice.className = `member-account-notice ${kind}`;
  notice.hidden = false;
};

const getErrorMessage = error => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
};

const prepareDashboardTab = () => {
  const dashboardTab = window.open('about:blank', '_blank');
  if (dashboardTab) dashboardTab.opener = null;
  return dashboardTab;
};

const getDashboardUrl = async () => {
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin');
  if (adminError) throw new Error(`Could not check your account role: ${adminError.message}`);

  const dashboardPath = isAdmin === true ? 'dashboards/admin.html' : 'dashboards/athlete.html';
  return new URL(dashboardPath, siteRoot);
};

const openDashboard = (dashboardUrl, dashboardTab) => {
  if (dashboardTab) {
    dashboardTab.location.replace(dashboardUrl.href);
    showNotice('Sign-in succeeded. Your dashboard is opening in a new tab.', 'success');
    return;
  }

  const openedTab = window.open(dashboardUrl.href, '_blank');
  if (openedTab) {
    openedTab.opener = null;
    showNotice('Sign-in succeeded. Your dashboard is opening in a new tab.', 'success');
    return;
  }

  showNotice('Sign-in succeeded, but your browser blocked the dashboard tab. Open it here:');
  const dashboardLink = document.createElement('a');
  dashboardLink.href = dashboardUrl.href;
  dashboardLink.target = '_blank';
  dashboardLink.rel = 'noopener noreferrer';
  dashboardLink.textContent = 'Open dashboard';
  notice.append(' ', dashboardLink);
};

const closeDashboardTab = dashboardTab => {
  if (dashboardTab && !dashboardTab.closed) dashboardTab.close();
};

if (!supabase) {
  setupPanel.hidden = false;
  formPanel.hidden = true;
} else {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' && session) {
      getDashboardUrl().then(dashboardUrl => {
        openDashboard(dashboardUrl, null);
      }).catch(error => {
        showNotice(`Signed in, but could not open your dashboard: ${error.message}`, 'error');
      });
    }
  });

  const signupForm = document.querySelector('#signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = signupForm.querySelector('button[type="submit"]');
      const dashboardTab = prepareDashboardTab();
      button.disabled = true;
      showNotice('Creating your account…');
      try {
        const { data, error } = await supabase.auth.signUp({
          email: signupForm.elements.email.value.trim(),
          password: signupForm.elements.password.value,
          options: {
            data: { display_name: signupForm.elements.display_name.value.trim() },
            emailRedirectTo: membershipUrl
          }
        });
        if (error) throw error;

        signupForm.reset();
        if (data.session) {
          showNotice('Account created. Opening your dashboard…', 'success');
          try {
            openDashboard(await getDashboardUrl(), dashboardTab);
          } catch (error) {
            closeDashboardTab(dashboardTab);
            showNotice(`Account created, but could not open your dashboard: ${getErrorMessage(error)}`, 'error');
          }
          return;
        }

        closeDashboardTab(dashboardTab);
        showNotice('Account created. Check your email to confirm it, then sign in to access your dashboard.', 'success');
      } catch (error) {
        closeDashboardTab(dashboardTab);
        showNotice(`Could not create account: ${getErrorMessage(error)}`, 'error');
      } finally {
        button.disabled = false;
      }
    });
  }

  const signinForm = document.querySelector('#signin-form');
  if (signinForm) {
    signinForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = signinForm.querySelector('button[type="submit"]');
      const dashboardTab = prepareDashboardTab();
      button.disabled = true;
      showNotice('Signing in…');
      try {
        let signInError;
        try {
          ({ error: signInError } = await supabase.auth.signInWithPassword({
            email: signinForm.elements.email.value.trim(),
            password: signinForm.elements.password.value
          }));
        } catch (error) {
          closeDashboardTab(dashboardTab);
          showNotice(`Could not sign in: ${getErrorMessage(error)}`, 'error');
          return;
        }
        if (signInError) {
          closeDashboardTab(dashboardTab);
          showNotice(`Could not sign in: ${getErrorMessage(signInError)}`, 'error');
          return;
        }

        try {
          openDashboard(await getDashboardUrl(), dashboardTab);
        } catch (error) {
          closeDashboardTab(dashboardTab);
          showNotice(`Signed in, but could not open your dashboard: ${getErrorMessage(error)}`, 'error');
        }
      } finally {
        button.disabled = false;
      }
    });
  }

  const resetPasswordButton = document.querySelector('#reset-password');
  if (resetPasswordButton) {
    resetPasswordButton.addEventListener('click', async () => {
      const email = document.querySelector('#signin-email').value.trim();
      if (!email) {
        showNotice('Enter your email in the sign-in form first.', 'error');
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: membershipUrl });
      if (error) {
        showNotice(`Could not send password reset email: ${error.message}`, 'error');
        return;
      }
      showNotice('If an account exists for that email, a password reset link is on its way.', 'success');
    });
  }
}
