import { supabase } from './supabase/client.js';

const siteRoot = new URL('./', import.meta.url);
let dialog = document.querySelector('#home-signin-dialog');
const openButton = document.querySelector('.home-signin-trigger');

if (!dialog) {
  dialog = document.createElement('dialog');
  dialog.className = 'home-signin-dialog';
  dialog.id = 'home-signin-dialog';
  dialog.setAttribute('aria-labelledby', 'home-signin-title');
  dialog.innerHTML = `
    <button class="home-signin-close" type="button" aria-label="Close sign-in window">×</button>
    <form class="member-form" id="home-signin-form">
      <p class="home-signin-kicker">Welcome back</p>
      <h2 id="home-signin-title">Sign in to UPSA</h2>
      <label for="home-signin-email">Email</label>
      <input id="home-signin-email" name="email" type="email" autocomplete="email" required>
      <label for="home-signin-password">Password</label>
      <input id="home-signin-password" name="password" type="password" autocomplete="current-password" required>
      <p class="home-signin-notice" id="home-signin-notice" role="status" aria-live="polite" hidden></p>
      <button type="submit">Sign in <span>↗</span></button>
      <p class="home-signin-links">New to UPSA? <a href="${new URL('membership/signup.html', siteRoot).href}">Create an account</a><br><a href="${new URL('membership/signin.html', siteRoot).href}">Forgot your password?</a></p>
    </form>`;
  document.body.append(dialog);
}

const closeButton = dialog.querySelector('.home-signin-close');
const form = document.querySelector('#home-signin-form');
const notice = document.querySelector('#home-signin-notice');

const showNotice = message => {
  notice.textContent = message;
  notice.hidden = false;
};

openButton.addEventListener('click', () => {
  notice.hidden = true;
  dialog.showModal();
  form.elements.email.focus();
});

closeButton.addEventListener('click', () => dialog.close());

dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase) {
    showNotice('Sign-in is unavailable because the Supabase backend is not configured.');
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  notice.hidden = true;

  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: form.elements.email.value.trim(),
      password: form.elements.password.value
    });
    if (signInError) {
      showNotice(`Could not sign in: ${signInError.message}`);
      return;
    }

    let isAdmin;
    let roleError;
    try {
      ({ data: isAdmin, error: roleError } = await supabase.rpc('is_admin'));
    } catch (error) {
      showNotice(`Signed in, but could not check your account role: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (roleError) {
      showNotice(`Signed in, but could not check your account role: ${roleError.message}`);
      return;
    }

    const dashboard = isAdmin === true ? 'dashboards/admin.html' : 'dashboards/athlete.html';
    window.location.assign(new URL(dashboard, siteRoot).href);
  } catch (error) {
    showNotice(`Could not complete sign-in: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    submitButton.disabled = false;
  }
});
