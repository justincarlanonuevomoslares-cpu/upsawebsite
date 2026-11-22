import { supabase } from './supabase/client.js';
import { countries, getCountryFlag, getCountryName } from './countries.js';

const siteRoot = new URL('./', import.meta.url);
const notice = document.querySelector('#account-notice');
const setupPanel = document.querySelector('#backend-setup');
const authPanel = document.querySelector('#auth-panel');
const membershipArea = document.querySelector('#membership-area');
const membershipAvailabilityNotice = document.querySelector('#membership-availability-notice');
const membershipBannerLink = document.querySelector('#membership-banner-link');
const membershipGuestActions = document.querySelector('#membership-guest-actions');
const membershipMemberActions = document.querySelector('#membership-member-actions');
const editor = document.querySelector('#profile-editor');
const loadErrorPanel = document.querySelector('#profile-load-error');
const profileForm = document.querySelector('#profile-form');
const adminDashboardLink = document.querySelector('#admin-dashboard-link');
const reelForm = document.querySelector('#reel-form');
const athleteClaimForm = document.querySelector('#athlete-claim-form');
const athleteLinkStatus = document.querySelector('#athlete-link-status');
const reelList = document.querySelector('#reel-list');
const reelEmpty = document.querySelector('#reel-empty');
const nationalitySelect = profileForm.elements.nationality;
const nationalityFlagPreview = document.querySelector('#nationality-flag-preview');
const imageBucket = 'member-profile-images';
const maxImageSize = 5 * 1024 * 1024;
const imageExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};
const photoControls = {
  profile: {
    file: profileForm.elements.profile_photo_file,
    preview: document.querySelector('#profile-photo-preview'),
    status: document.querySelector('#profile-photo-status'),
    remove: profileForm.elements.remove_profile_photo
  },
  cover: {
    file: profileForm.elements.cover_photo_file,
    preview: document.querySelector('#cover-photo-preview'),
    status: document.querySelector('#cover-photo-status'),
    remove: profileForm.elements.remove_cover_photo
  }
};
const previewObjectUrls = new Map();
let currentUser = null;
let linkedAthleteProfile = null;
let currentProfile = null;

countries.forEach(({ code, name }) => {
  const option = document.createElement('option');
  option.value = code;
  option.textContent = `${getCountryFlag(code)} ${name}`;
  nationalitySelect.append(option);
});

const updateNationalityFlagPreview = code => {
  const name = getCountryName(code);
  nationalityFlagPreview.textContent = name
    ? `${getCountryFlag(code)} ${name}`
    : 'Choose a country to preview its flag.';
};

const setPhotoPreview = (kind, url, objectUrl = false) => {
  const control = photoControls[kind];
  const previousObjectUrl = previewObjectUrls.get(kind);
  if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
  previewObjectUrls.delete(kind);

  if (!url) {
    control.preview.removeAttribute('src');
    control.preview.hidden = true;
    return;
  }

  control.preview.src = url;
  control.preview.alt = `${kind === 'profile' ? 'Profile' : 'Cover'} photo preview`;
  control.preview.hidden = false;
  if (objectUrl) previewObjectUrls.set(kind, url);
};

nationalitySelect.addEventListener('change', () => {
  updateNationalityFlagPreview(nationalitySelect.value);
});

Object.entries(photoControls).forEach(([kind, control]) => {
  control.file.addEventListener('change', () => {
    const file = control.file.files[0];
    if (!file) return;
    control.remove.checked = false;
    control.status.textContent = file.name;
    setPhotoPreview(kind, URL.createObjectURL(file), true);
  });

  control.remove.addEventListener('change', () => {
    if (control.remove.checked) {
      control.file.value = '';
      setPhotoPreview(kind, '');
      control.status.textContent = 'This photo will be removed when you save.';
      return;
    }

    const urlField = kind === 'profile' ? 'profile_photo_url' : 'cover_photo_url';
    setPhotoPreview(kind, currentProfile?.[urlField] || '');
    control.status.textContent = currentProfile?.[urlField]
      ? 'Current photo. Choose a file to replace it.'
      : 'JPG, PNG, or WebP; maximum 5 MB.';
  });

  control.preview.addEventListener('error', () => {
    control.preview.hidden = true;
    control.status.textContent = 'The image preview could not be loaded.';
  });
});

const setMembershipAccess = hasAccountSession => {
  membershipArea.hidden = !hasAccountSession;
  membershipAvailabilityNotice.hidden = false;
  membershipBannerLink.href = hasAccountSession ? '#membership-plans' : 'signup.html';
  membershipBannerLink.textContent = hasAccountSession ? 'Explore membership ↘' : 'Join UPSA ↗';
  membershipGuestActions.hidden = hasAccountSession;
  membershipMemberActions.hidden = !hasAccountSession;
  if (hasAccountSession) {
    window.dispatchEvent(new Event('upsa:membership-access-granted'));
  }
};

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

const normalizeInstagramUrl = value => {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid public Instagram Reel, post, or video URL.');
  }

  if (
    url.protocol !== 'https:'
    || !['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase())
  ) {
    throw new Error('Use an https://www.instagram.com/ link.');
  }

  const match = url.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) {
    throw new Error('Use a direct public Instagram Reel, post, or video link.');
  }

  return {
    url: `https://www.instagram.com/${match[1]}/${match[2]}/`,
    shortcode: match[2]
  };
};

const uploadMemberImage = async (kind, file) => {
  const extension = imageExtensions[file.type];
  if (!extension) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  if (file.size > maxImageSize) {
    throw new Error('Each image must be 5 MB or smaller.');
  }

  const randomPart = Array.from(crypto.getRandomValues(new Uint32Array(4)))
    .map(value => value.toString(16).padStart(8, '0'))
    .join('');
  const path = `${currentUser.id}/${kind}-${randomPart}.${extension}`;
  const storage = supabase.storage.from(imageBucket);
  const { error } = await storage.upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false
  });
  if (error) throw new Error(`Could not upload the ${kind} photo: ${error.message}`);

  const { data } = storage.getPublicUrl(path);
  return { path, url: data.publicUrl };
};

const updatePublicProfileLink = username => {
  const profileUrl = linkedAthleteProfile
    ? new URL('athlete-profile.html', siteRoot)
    : new URL('member-profile.html', siteRoot);
  if (linkedAthleteProfile) {
    profileUrl.searchParams.set('athlete', linkedAthleteProfile.athlete_profile_key);
  } else {
    profileUrl.searchParams.set('username', username);
  }
  const publicProfileLink = document.querySelector('#public-profile-link');
  publicProfileLink.href = profileUrl.href;
  publicProfileLink.textContent = linkedAthleteProfile ? 'View athlete profile ↗' : 'View public profile ↗';
};

const setFormValues = profile => {
  currentProfile = profile;
  profileForm.elements.username.value = profile.username;
  profileForm.elements.display_name.value = profile.display_name;
  nationalitySelect.value = profile.nationality || '';
  updateNationalityFlagPreview(nationalitySelect.value);
  profileForm.elements.bio.value = profile.bio;
  profileForm.elements.home_break.value = profile.home_break;
  profileForm.elements.surf_club.value = profile.surf_club;
  profileForm.elements.instagram_handle.value = profile.instagram_handle;
  profileForm.elements.website_url.value = profile.website_url;
  profileForm.elements.theme.value = profile.theme;
  profileForm.elements.is_public.checked = profile.is_public;
  Object.entries(photoControls).forEach(([kind, control]) => {
    const urlField = kind === 'profile' ? 'profile_photo_url' : 'cover_photo_url';
    control.file.value = '';
    control.remove.checked = false;
    control.remove.closest('label').hidden = !profile[urlField];
    setPhotoPreview(kind, profile[urlField] || '');
    control.status.textContent = profile[urlField]
      ? 'Current photo. Choose a file to replace it.'
      : 'JPG, PNG, or WebP; maximum 5 MB.';
  });
  updatePublicProfileLink(profile.username);
};

const renderAthleteLink = (link, claim) => {
  athleteLinkStatus.replaceChildren();
  linkedAthleteProfile = link;
  updatePublicProfileLink(profileForm.elements.username.value);
  athleteClaimForm.hidden = Boolean(link) || claim?.status === 'pending' || claim?.status === 'approved';

  if (link) {
    athleteLinkStatus.append(document.createTextNode('Your account is connected to the verified UPSA athlete profile. '));
    const profileUrl = new URL('athlete-profile.html', siteRoot);
    profileUrl.searchParams.set('athlete', link.athlete_profile_key);
    const profileLink = document.createElement('a');
    profileLink.href = profileUrl.href;
    profileLink.textContent = 'View athlete profile ↗';
    athleteLinkStatus.append(profileLink);
    return;
  }

  if (claim?.status === 'pending') {
    athleteLinkStatus.textContent = `Your request for Athlete ID ${claim.source_athlete_id} is awaiting UPSA review.`;
    return;
  }
  if (claim?.status === 'approved') {
    athleteLinkStatus.textContent = 'Your claim was approved. The athlete profile link is being finalized.';
    return;
  }
  if (claim?.status === 'rejected') {
    athleteLinkStatus.textContent = claim.review_notes
      ? `Your previous request was not approved: ${claim.review_notes}`
      : 'Your previous request was not approved. Review the details and submit a new request if needed.';
    return;
  }
  athleteLinkStatus.textContent = 'Your account is not connected to an official athlete profile yet.';
};

const renderReels = reels => {
  reelList.replaceChildren();
  reels.forEach(reel => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = reel.reel_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = reel.reel_url;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove Instagram video ${reel.shortcode}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      const { error } = await supabase
        .from('member_instagram_reels')
        .delete()
        .eq('id', reel.id)
        .eq('owner_id', currentUser.id);
      if (error) {
        remove.disabled = false;
        showNotice(`Could not remove Reel: ${error.message}`, 'error');
        return;
      }
      item.remove();
      reelEmpty.hidden = reelList.children.length > 0;
      showNotice('Instagram link removed.', 'success');
    });

    item.append(link, remove);
    reelList.append(item);
  });
  reelEmpty.hidden = reels.length > 0;
};

const loadAccount = async user => {
  currentUser = user;
  setMembershipAccess(true);
  loadErrorPanel.hidden = true;
  editor.hidden = false;
  authPanel.hidden = true;
  showNotice('Loading your profile…');

  const [
    { data: profile, error: profileError },
    { data: reels, error: reelsError },
    { data: claims, error: claimsError },
    { data: athleteLinks, error: athleteLinkError },
    { data: isAdmin, error: adminRoleError }
  ] =
    await Promise.all([
      supabase.from('member_profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('member_instagram_reels').select('*').eq('owner_id', user.id).order('created_at'),
      supabase
        .from('member_athlete_profile_claims')
        .select('source_athlete_id, status, review_notes, created_at')
        .eq('claimant_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase.from('member_athlete_profile_links')
        .select('source_athlete_id, athlete_profile_key')
        .eq('member_user_id', user.id)
        .maybeSingle(),
      supabase.rpc('is_admin')
    ]);

  if (profileError) throw new Error(`Could not load your profile: ${profileError.message}`);
  if (reelsError) throw new Error(`Could not load your Instagram links: ${reelsError.message}`);
  if (claimsError) throw new Error(`Could not load your athlete profile request: ${claimsError.message}`);
  if (athleteLinkError) throw new Error(`Could not load your athlete profile connection: ${athleteLinkError.message}`);
  setFormValues(profile);
  renderAthleteLink(athleteLinks, claims[0] || null);
  renderReels(reels);
  adminDashboardLink.hidden = Boolean(adminRoleError) || isAdmin !== true;
  showNotice(
    adminRoleError
      ? `Signed in as ${user.email}. Admin access could not be checked: ${adminRoleError.message}`
      : `Signed in as ${user.email}.`,
    adminRoleError ? 'error' : 'success'
  );
};

const showSignedOut = () => {
  currentUser = null;
  adminDashboardLink.hidden = true;
  setMembershipAccess(false);
  loadErrorPanel.hidden = true;
  editor.hidden = true;
  authPanel.hidden = false;
};

const showProfileLoadError = error => {
  editor.hidden = true;
  authPanel.hidden = true;
  loadErrorPanel.hidden = false;
  showNotice(error.message, 'error');
};

if (!supabase) {
  setupPanel.hidden = false;
  authPanel.hidden = false;
  showNotice('Member accounts are unavailable until Supabase is configured.', 'error');
} else {
  profileForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const username = form.elements.username.value.trim();
    const displayName = form.elements.display_name.value.trim();
    const handle = form.elements.instagram_handle.value.trim().replace(/^@/, '');
    const nationality = nationalitySelect.value;
    const secureLinks = [['Website', form.elements.website_url.value.trim()]];
    const selectedPhotos = Object.entries(photoControls)
      .map(([kind, control]) => ({ kind, file: control.file.files[0] }));
    if (!/^[a-z0-9][a-z0-9-]{2,23}$/.test(username)) {
      showNotice('Your profile address must be 3–24 lowercase letters, numbers, or hyphens.', 'error');
      return;
    }
    if (nationality && !countries.some(country => country.code === nationality)) {
      showNotice('Choose a nationality from the country list.', 'error');
      return;
    }
    if (handle && !/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
      showNotice('Enter a valid Instagram username without the @ sign.', 'error');
      return;
    }
    for (const [label, value] of secureLinks) {
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:') throw new Error();
      } catch {
        showNotice(`${label} must be a valid https:// address.`, 'error');
        return;
      }
    }
    for (const { kind, file } of selectedPhotos) {
      if (!file) continue;
      if (!imageExtensions[file.type]) {
        showNotice('Choose JPG, PNG, or WebP images only.', 'error');
        return;
      }
      if (file.size > maxImageSize) {
        showNotice('Each uploaded image must be 5 MB or smaller.', 'error');
        return;
      }
    }

    button.disabled = true;
    showNotice('Uploading photos and saving your profile…');
    const newlyUploadedPaths = [];
    const oldPathsToRemove = [];
    let profileSaved = false;
    try {
      const uploads = {};
      for (const { kind, file } of selectedPhotos) {
        if (!file) continue;
        uploads[kind] = await uploadMemberImage(kind, file);
        newlyUploadedPaths.push(uploads[kind].path);
      }

      const getPhotoValues = kind => {
        const urlField = kind === 'profile' ? 'profile_photo_url' : 'cover_photo_url';
        const pathField = kind === 'profile' ? 'profile_photo_path' : 'cover_photo_path';
        const removeField = kind === 'profile' ? 'remove_profile_photo' : 'remove_cover_photo';
        const upload = uploads[kind];
        const removeCurrent = form.elements[removeField].checked && !upload;
        const previousPath = currentProfile[pathField] || '';

        if (upload || removeCurrent) {
          if (previousPath) oldPathsToRemove.push(previousPath);
          return {
            [urlField]: upload?.url || '',
            [pathField]: upload?.path || ''
          };
        }

        return {
          [urlField]: currentProfile[urlField] || '',
          [pathField]: previousPath
        };
      };

      const { data, error } = await supabase
        .from('member_profiles')
        .update({
          username,
          display_name: displayName,
          nationality,
          bio: form.elements.bio.value.trim(),
          home_break: form.elements.home_break.value.trim(),
          surf_club: form.elements.surf_club.value.trim(),
          instagram_handle: handle,
          website_url: form.elements.website_url.value.trim(),
          ...getPhotoValues('profile'),
          ...getPhotoValues('cover'),
          theme: form.elements.theme.value,
          is_public: form.elements.is_public.checked
        })
        .eq('user_id', currentUser.id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);

      profileSaved = true;
      setFormValues(data);
    } catch (error) {
      let cleanupMessage = '';
      if (!profileSaved && newlyUploadedPaths.length) {
        try {
          const { error: cleanupError } = await supabase.storage
            .from(imageBucket)
            .remove(newlyUploadedPaths);
          if (cleanupError) cleanupMessage = ` Uploaded image cleanup also failed: ${getErrorMessage(cleanupError)}`;
        } catch (cleanupError) {
          cleanupMessage = ` Uploaded image cleanup also failed: ${getErrorMessage(cleanupError)}`;
        }
      }
      showNotice(`Could not save your profile: ${getErrorMessage(error)}${cleanupMessage}`, 'error');
      return;
    } finally {
      button.disabled = false;
    }

    const oldPaths = [...new Set(oldPathsToRemove)];
    if (oldPaths.length) {
      try {
        const { error } = await supabase.storage.from(imageBucket).remove(oldPaths);
        if (error) throw new Error(error.message);
      } catch (error) {
        showNotice(`Profile saved, but an old uploaded image could not be removed: ${getErrorMessage(error)}`, 'error');
        return;
      }
    }
    showNotice('Profile saved.', 'success');
  });

  athleteClaimForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const sourceAthleteId = form.elements.source_athlete_id.value.trim();
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(sourceAthleteId)) {
      showNotice('Enter the Athlete ID exactly as it appears in the UPSA rankings.', 'error');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showNotice('Submitting your athlete profile request…');
    const { data, error } = await supabase
      .from('member_athlete_profile_claims')
      .insert({
        claimant_user_id: currentUser.id,
        source_athlete_id: sourceAthleteId,
        evidence: form.elements.evidence.value.trim()
      })
      .select('source_athlete_id, status, review_notes, created_at')
      .single();
    button.disabled = false;
    if (error) {
      showNotice(
        error.code === '23505'
          ? 'You already have a pending athlete profile request.'
          : `Could not submit your request: ${error.message}`,
        'error'
      );
      return;
    }
    renderAthleteLink(null, data);
    form.reset();
    showNotice('Request submitted. UPSA will verify your Athlete ID before linking your account.', 'success');
  });

  reelForm.addEventListener('submit', async event => {
    event.preventDefault();
    let reel;
    try {
      reel = normalizeInstagramUrl(reelForm.elements.reel_url.value);
    } catch (error) {
      showNotice(error.message, 'error');
      return;
    }
    const button = reelForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const { data, error } = await supabase
      .from('member_instagram_reels')
      .insert({
        owner_id: currentUser.id,
        reel_url: reel.url,
        shortcode: reel.shortcode
      })
      .select('*')
      .single();
    button.disabled = false;
    if (error) {
      showNotice(
        error.code === '23505'
          ? 'That Instagram video is already on your profile.'
          : `Could not add that Instagram video: ${error.message}`,
        'error'
      );
      return;
    }
    const existing = await supabase
      .from('member_instagram_reels')
      .select('*')
      .eq('owner_id', currentUser.id)
      .order('created_at');
    if (existing.error) {
      showNotice(`Reel added, but the list could not be refreshed: ${existing.error.message}`, 'error');
      renderReels([data]);
    } else {
      renderReels(existing.data);
      showNotice('Instagram video added to your profile.', 'success');
    }
    reelForm.reset();
  });

  document.querySelector('#signout-button').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) showNotice(`Could not sign out: ${error.message}`, 'error');
  });

  document.querySelector('#profile-load-signout').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) showNotice(`Could not sign out: ${error.message}`, 'error');
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      if (!session) {
        showSignedOut();
        return;
      }
      loadAccount(session.user).catch(showProfileLoadError);
    }, 0);
  });
}
