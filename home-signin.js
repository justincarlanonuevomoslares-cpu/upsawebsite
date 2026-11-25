import { supabase } from './supabase/client.js';

const dialog = document.querySelector('#home-signin-dialog');
const openButton = document.querySelector('.home-signin-trigger');
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

    window.location.assign(isAdmin === true ? 'dashboards/admin.html' : 'dashboards/athlete.html');
  } catch (error) {
    showNotice(`Could not complete sign-in: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    submitButton.disabled = false;
  }
});
