import { supabase } from './supabase/client.js';
import { countries, getCountryFlag, getCountryName } from './countries.js';
import { loadDashboardContent } from './dashboard-data.js';

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

const dashboardNavItems = [...document.querySelectorAll('[data-dashboard-view]')];
const dashboardPanels = [...document.querySelectorAll('[data-dashboard-panel]')];
const searchToggle = document.querySelector('#dashboard-search-toggle');
const searchPopover = document.querySelector('#dashboard-search-popover');
const searchForm = document.querySelector('#dashboard-search-popover');
const searchInput = document.querySelector('#dashboard-search-input');
const searchStatus = document.querySelector('#dashboard-search-status');
const notificationsToggle = document.querySelector('#dashboard-notifications-toggle');
const notificationsPopover = document.querySelector('#dashboard-notifications-popover');
const avatarToggle = document.querySelector('#dashboard-avatar');
const accountPopover = document.querySelector('#dashboard-account-popover');
const dashboardPopovers = [searchPopover, notificationsPopover, accountPopover];

const closeDashboardPopovers = () => {
  dashboardPopovers.forEach(popover => {
    popover.hidden = true;
  });
  [searchToggle, notificationsToggle, avatarToggle].forEach(toggle => {
    toggle.setAttribute('aria-expanded', 'false');
  });
};

const toggleDashboardPopover = (toggle, popover) => {
  const shouldOpen = popover.hidden;
  closeDashboardPopovers();
  if (!shouldOpen) return;
  popover.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  if (popover === searchPopover) searchInput.focus();
};

const redirectToSignIn = () => {
  window.location.href = new URL('membership/signin.html', siteRoot).href;
};

const filterDashboardResults = query => {
  const normalizedQuery = query.toLowerCase();
  const eventCards = [...document.querySelectorAll('.dashboard-event-card')];
  const rankingRows = [...document.querySelectorAll('.dashboard-ranking-table tbody tr')];
  const eventMatches = eventCards.filter(card => card.textContent.toLowerCase().includes(normalizedQuery));
  const rankingMatches = rankingRows.filter(row => row.textContent.toLowerCase().includes(normalizedQuery));
  const uniqueEventMatches = new Set(eventMatches.map(card =>
    card.querySelector('h3')?.textContent.trim() || card.textContent.trim()
  ));
  const uniqueRankingMatches = new Set(rankingMatches.map(row => row.textContent.trim()));

  eventCards.forEach(card => {
    card.hidden = !eventMatches.includes(card);
  });
  rankingRows.forEach(row => {
    row.hidden = !rankingMatches.includes(row);
  });

  if (!normalizedQuery) {
    eventCards.forEach(card => {
      card.hidden = false;
    });
    rankingRows.forEach(row => {
      row.hidden = false;
    });
    setDashboardView('dashboard');
    searchStatus.textContent = 'Enter a name, event, or ranking to search.';
    return;
  }

  const resultCount = uniqueEventMatches.size + uniqueRankingMatches.size;
  setDashboardView(uniqueEventMatches.size && uniqueRankingMatches.size
    ? 'dashboard'
    : uniqueEventMatches.size
      ? 'events'
      : 'rankings');
  searchStatus.textContent = resultCount
    ? `${resultCount} matching ${uniqueEventMatches.size && uniqueRankingMatches.size ? 'events and ranking entries' : uniqueEventMatches.size ? 'events' : 'ranking entries'}.`
    : `No events or ranking entries matched “${query}”.`;
};

searchToggle.addEventListener('click', () => {
  if (!currentUser) {
    redirectToSignIn();
    return;
  }
  toggleDashboardPopover(searchToggle, searchPopover);
});

searchForm.addEventListener('submit', event => {
  event.preventDefault();
  filterDashboardResults(searchInput.value.trim());
});

notificationsToggle.addEventListener('click', () => {
  if (!currentUser) {
    redirectToSignIn();
    return;
  }
  toggleDashboardPopover(notificationsToggle, notificationsPopover);
});

avatarToggle.addEventListener('click', () => {
  if (!currentUser) {
    redirectToSignIn();
    return;
  }
  toggleDashboardPopover(avatarToggle, accountPopover);
});

document.querySelector('#dashboard-open-account').addEventListener('click', () => {
  closeDashboardPopovers();
  setDashboardView('account');
  document.querySelector('#profile-username').focus();
});

document.querySelector('#dashboard-signout').addEventListener('click', async () => {
  closeDashboardPopovers();
  await signOutToHome();
});

document.addEventListener('click', event => {
  if (!event.target.closest('.athlete-dashboard-actions')) closeDashboardPopovers();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && dashboardPopovers.some(popover => !popover.hidden)) {
    closeDashboardPopovers();
  }
});

const setDashboardView = view => {
  dashboardNavItems.forEach(item => {
    item.classList.toggle('active', item.dataset.dashboardView === view);
  });
  dashboardPanels.forEach(panel => {
    panel.classList.toggle('active', panel.dataset.dashboardPanel === view);
  });
};

dashboardNavItems.forEach(item => {
  item.addEventListener('click', () => setDashboardView(item.dataset.dashboardView));
});

document.querySelectorAll('[data-open-dashboard-view]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    setDashboardView(link.dataset.openDashboardView);
  });
});

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
  if (membershipArea) membershipArea.hidden = !hasAccountSession;
  if (membershipAvailabilityNotice) membershipAvailabilityNotice.hidden = false;
  if (membershipBannerLink) {
    membershipBannerLink.href = hasAccountSession ? '#membership-plans' : 'signup.html';
    membershipBannerLink.textContent = hasAccountSession ? 'Explore membership ↘' : 'Join UPSA ↗';
  }
  if (membershipGuestActions) membershipGuestActions.hidden = hasAccountSession;
  if (membershipMemberActions) membershipMemberActions.hidden = !hasAccountSession;
  if (hasAccountSession) {
    window.dispatchEvent(new Event('upsa:membership-access-granted'));
  }
};

const showNotice = (message, kind = 'info') => {
  notice.textContent = message;
  notice.className = `member-account-notice ${kind}`;
  notice.hidden = false;
};

const signOutToHome = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
    window.location.replace(new URL('index.html', siteRoot).href);
  } catch (error) {
    showNotice(`Could not sign out: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
};

const createDashboardEmptyState = message => {
  const empty = document.createElement('p');
  empty.className = 'dashboard-data-empty';
  empty.textContent = message;
  return empty;
};

const safeExternalUrl = value => {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

const formatDashboardDate = value => {
  if (!value) return 'Date to be announced';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const renderDashboardEvent = event => {
  const card = document.createElement('article');
  card.className = 'dashboard-event-card';
  const image = document.createElement('div');
  image.className = 'dashboard-event-image';
  const imageUrl = safeExternalUrl(event.featured_image_path);
  if (imageUrl) {
    const photo = document.createElement('img');
    photo.src = imageUrl;
    photo.alt = '';
    photo.loading = 'lazy';
    image.append(photo);
  }
  const title = document.createElement('strong');
  title.textContent = event.name;
  image.append(title);

  const body = document.createElement('div');
  body.className = 'dashboard-event-card-body';
  const heading = document.createElement('h3');
  heading.textContent = event.name;
  const description = document.createElement('p');
  description.textContent = event.description || event.category || 'UPSA event';
  const details = document.createElement('dl');
  [
    ['Date', `${formatDashboardDate(event.start_date)}${event.end_date && event.end_date !== event.start_date ? ` – ${formatDashboardDate(event.end_date)}` : ''}`],
    ['Location', event.location || 'To be announced']
  ].forEach(([label, value]) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = `${label}:`;
    const detail = document.createElement('dd');
    detail.textContent = value;
    row.append(term, detail);
    details.append(row);
  });
  body.append(heading, description, details);

  const externalUrl = safeExternalUrl(event.external_url);
  if (externalUrl) {
    const link = document.createElement('a');
    link.className = 'dashboard-event-register';
    link.href = externalUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Event details';
    body.append(link);
  }
  card.append(image, body);
  return card;
};

const renderDashboardEvents = (container, events, emptyMessage) => {
  container.replaceChildren(...(
    events.length ? events.map(renderDashboardEvent) : [createDashboardEmptyState(emptyMessage)]
  ));
};

const renderRankingCategory = (category, rowLimit) => {
  const card = document.createElement('article');
  card.className = 'dashboard-ranking-card';
  const heading = document.createElement('h3');
  heading.textContent = category.title;
  const tableWrap = document.createElement('div');
  tableWrap.className = 'dashboard-ranking-table-wrap';
  const table = document.createElement('table');
  table.className = 'dashboard-ranking-table';
  const tableHead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const headers = category.headers.length ? category.headers : ['Rank', 'Name'];
  headers.forEach(header => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = header;
    headerRow.append(cell);
  });
  tableHead.append(headerRow);
  const tableBody = document.createElement('tbody');
  category.rows.slice(0, rowLimit).forEach(values => {
    const row = document.createElement('tr');
    headers.forEach((_, index) => {
      const cell = document.createElement('td');
      cell.textContent = values[index] == null || values[index] === '' ? '—' : String(values[index]);
      row.append(cell);
    });
    tableBody.append(row);
  });
  table.append(tableHead, tableBody);
  tableWrap.append(table);
  card.append(heading, tableWrap);
  return card;
};

const renderDashboardRankings = (container, categories, rowLimit, emptyMessage) => {
  container.replaceChildren(...(
    categories.length
      ? categories.map(category => renderRankingCategory(category, rowLimit))
      : [createDashboardEmptyState(emptyMessage)]
  ));
};

const getLatestLocalRankings = seasons => {
  if (!Array.isArray(seasons)) return null;
  return seasons.reduce((latest, season) =>
    !latest || Number(season.year) > Number(latest.year) ? season : latest
  , null);
};

const renderDashboardContent = async () => {
  const homeEvents = document.querySelector('#dashboard-home-events');
  const allEvents = document.querySelector('#dashboard-all-events');
  const homeRankings = document.querySelector('#dashboard-home-rankings');
  const allRankings = document.querySelector('#dashboard-all-rankings');
  const homeSeason = document.querySelector('#dashboard-home-season');
  const homeSource = document.querySelector('#dashboard-home-ranking-source');
  const allSource = document.querySelector('#dashboard-all-ranking-source');
  const rankingTitle = document.querySelector('#dashboard-rankings-title');
  let content = { season: null, categories: [], events: [] };
  let dashboardError = '';

  try {
    content = await loadDashboardContent(supabase);
  } catch (error) {
    dashboardError = error instanceof Error ? error.message : String(error);
  }

  let localRankings = null;
  let localRankingsError = '';
  try {
    localRankings = getLatestLocalRankings(await window.upsaRankingsReady);
  } catch (error) {
    localRankingsError = error instanceof Error ? error.message : String(error);
  }
  const useLocalRankings = Boolean(localRankings && (
    !content.season
    || !content.categories.length
    || Number(localRankings.year) > Number(content.season.year)
  ));
  const season = useLocalRankings ? localRankings : content.season;
  const categories = useLocalRankings ? localRankings.categories : content.categories;
  const eventMessage = dashboardError
    ? 'Published events could not be loaded. Please try again later.'
    : 'No published upcoming events are available yet.';
  renderDashboardEvents(homeEvents, dashboardError ? [] : content.events.slice(0, 3), eventMessage);
  renderDashboardEvents(allEvents, dashboardError ? [] : content.events, eventMessage);
  document.querySelector('#dashboard-upcoming-event-count').textContent = String(
    dashboardError ? 0 : content.events.length
  );

  const seasonTitle = season?.title || 'Official rankings';
  homeSeason.textContent = seasonTitle;
  rankingTitle.textContent = seasonTitle;
  const sourceMessage = useLocalRankings
    ? `Showing the latest official rankings loaded from the ${season.year} Excel workbook; Supabase has not been synced to this season yet.`
    : season
      ? 'Rankings loaded from Supabase.'
      : 'Official rankings have not been synced yet.';
  homeSource.textContent = sourceMessage;
  allSource.textContent = sourceMessage;
  const rankingMessage = dashboardError || localRankingsError
    ? 'Rankings could not be loaded from Supabase or the local site source.'
    : 'Official rankings have not been synced yet.';
  renderDashboardRankings(homeRankings, categories || [], 3, rankingMessage);
  renderDashboardRankings(allRankings, categories || [], 1000, rankingMessage);

  return dashboardError ? ` Dashboard content could not be loaded: ${dashboardError}` : '';
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
  const displayName = String(profile.display_name || 'John').trim();
  const firstName = displayName.split(/\s+/)[0] || 'John';
  const welcomeName = document.querySelector('#dashboard-welcome-name');
  const avatar = document.querySelector('#dashboard-avatar');
  if (welcomeName) {
    const celebration = document.createElement('span');
    celebration.setAttribute('aria-hidden', 'true');
    celebration.textContent = '🎉';
    welcomeName.replaceChildren(document.createTextNode(`Hey ${firstName}! `), celebration);
  }
  if (avatar) avatar.textContent = firstName.charAt(0).toUpperCase();
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
  const notificationMessage = document.querySelector('#dashboard-notification-message');
  const notificationsToggle = document.querySelector('#dashboard-notifications-toggle');
  if (link) {
    notificationMessage.textContent = 'Your UPSA athlete profile is connected to the official rankings.';
  } else if (claim?.status === 'pending') {
    notificationMessage.textContent = `Your Athlete ID request (${claim.source_athlete_id}) is awaiting UPSA review.`;
  } else if (claim?.status === 'approved') {
    notificationMessage.textContent = 'Your Athlete ID request was approved and is being finalized.';
  } else if (claim?.status === 'rejected') {
    notificationMessage.textContent = 'Your Athlete ID request needs attention. Check Account for the review details.';
  } else {
    notificationMessage.textContent = 'You’re all caught up.';
  }
  notificationsToggle.dataset.hasNotifications = String(
    ['pending', 'approved', 'rejected'].includes(claim?.status)
  );

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
  document.querySelector('#dashboard-account-email').textContent = user.email || '';
  searchInput.value = '';
  filterDashboardResults('');
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
  if (adminDashboardLink) adminDashboardLink.hidden = Boolean(adminRoleError) || isAdmin !== true;
  const dashboardDataError = await renderDashboardContent();
  showNotice(
    `Signed in as ${user.email}.${adminRoleError
      ? ` Admin access could not be checked: ${adminRoleError.message}`
      : ''}${dashboardDataError}`,
    adminRoleError || dashboardDataError ? 'error' : 'success'
  );
};

const showSignedOut = () => {
  currentUser = null;
  closeDashboardPopovers();
  document.querySelector('#dashboard-account-email').textContent = '';
  if (adminDashboardLink) adminDashboardLink.hidden = true;
  setMembershipAccess(false);
  loadErrorPanel.hidden = true;
  editor.hidden = true;
  authPanel.hidden = false;
  dashboardPanels.forEach(panel => panel.classList.remove('active'));
  dashboardNavItems.forEach(item => item.classList.remove('active'));
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
    await signOutToHome();
  });

  document.querySelector('#profile-load-signout').addEventListener('click', async () => {
    await signOutToHome();
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
