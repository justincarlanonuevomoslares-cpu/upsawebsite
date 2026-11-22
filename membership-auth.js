import { supabase } from './supabase/client.js';

const siteRoot = new URL('./', import.meta.url);
const formPanel = document.querySelector('#auth-form-panel');
const setupPanel = document.querySelector('#backend-setup');
const notice = document.querySelector('#auth-notice');
const membershipUrl = new URL('membership/membership.html#membership-account', siteRoot).href;

const showNotice = (message, kind = 'info') => {
  notice.textContent = message;
  notice.className = `member-account-notice ${kind}`;
  notice.hidden = false;
};

if (!supabase) {
  setupPanel.hidden = false;
  formPanel.hidden = true;
} else {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' && session) {
      window.location.replace(membershipUrl);
    }
  });

  const signupForm = document.querySelector('#signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = signupForm.querySelector('button[type="submit"]');
      button.disabled = true;
      showNotice('Creating your account…');
      const { data, error } = await supabase.auth.signUp({
        email: signupForm.elements.email.value.trim(),
        password: signupForm.elements.password.value,
        options: {
          data: { display_name: signupForm.elements.display_name.value.trim() },
          emailRedirectTo: membershipUrl
        }
      });
      button.disabled = false;
      if (error) {
        showNotice(`Could not create account: ${error.message}`, 'error');
        return;
      }

      signupForm.reset();
      if (data.session) {
        showNotice('Account created. Opening your member area…', 'success');
        window.location.replace(membershipUrl);
        return;
      }
      showNotice('Account created. Check your email to confirm it, then sign in to access your member area.', 'success');
    });
  }

  const signinForm = document.querySelector('#signin-form');
  if (signinForm) {
    signinForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = signinForm.querySelector('button[type="submit"]');
      button.disabled = true;
      showNotice('Signing in…');
      const { error } = await supabase.auth.signInWithPassword({
        email: signinForm.elements.email.value.trim(),
        password: signinForm.elements.password.value
      });
      button.disabled = false;
      if (error) {
        showNotice(`Could not sign in: ${error.message}`, 'error');
        return;
      }
      window.location.replace(membershipUrl);
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
