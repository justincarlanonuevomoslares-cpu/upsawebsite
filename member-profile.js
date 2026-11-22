import { supabase } from './supabase/client.js';
import { processInstagramEmbeds } from './instagram-embeds.js';
import { getCountryFlag, getCountryName } from './countries.js';

const siteRoot = new URL('./', import.meta.url);
const notice = document.querySelector('#member-profile-notice');
const profileRoot = document.querySelector('#member-public-profile');
const missingRoot = document.querySelector('#member-profile-missing');
const profileLinks = document.querySelector('#member-public-links');
const reelSection = document.querySelector('#member-instagram');
const reelNav = document.querySelector('#member-instagram-nav');
const reelsContainer = document.querySelector('#member-public-reels');

const initialsFor = name => name
  .split(/\s+/)
  .slice(0, 2)
  .map(part => part.charAt(0))
  .join('')
  .toLocaleUpperCase();

const showUnavailable = message => {
  notice.hidden = true;
  profileRoot.hidden = true;
  missingRoot.hidden = false;
  document.querySelector('#member-profile-missing-message').textContent = message;
};

const addExternalLink = (label, href) => {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  profileLinks.append(link);
};

const renderProfileFacts = profile => {
  const facts = [
    { label: 'Profile type', value: 'Community surfer', detail: 'UPSA member profile' },
    { label: 'Home break', value: profile.home_break || 'Not added yet', detail: 'Member-provided profile detail' },
    { label: 'Surf club', value: profile.surf_club || 'Not added yet', detail: 'Member-provided profile detail' }
  ];
  const container = document.querySelector('#member-profile-facts');
  container.replaceChildren(...facts.map(fact => {
    const card = document.createElement('article');
    card.className = 'athlete-stat';
    const label = document.createElement('span');
    label.textContent = fact.label;
    const value = document.createElement('strong');
    value.textContent = fact.value;
    const detail = document.createElement('small');
    detail.textContent = fact.detail;
    card.append(label, value, detail);
    return card;
  }));
};

const renderReels = reels => {
  if (!reels.length) return;
  reelSection.hidden = false;
  reelNav.hidden = false;
  reels.forEach(reel => {
    const card = document.createElement('article');
    card.className = 'athlete-member-reel';
    const quote = document.createElement('blockquote');
    quote.className = 'instagram-media';
    quote.dataset.instgrmPermalink = reel.reel_url;
    quote.dataset.instgrmVersion = '14';
    const fallback = document.createElement('a');
    fallback.href = reel.reel_url;
    fallback.target = '_blank';
    fallback.rel = 'noopener noreferrer';
    fallback.textContent = 'View this video on Instagram ↗';
    quote.append(fallback);
    card.append(quote);
    reelsContainer.append(card);
  });

  processInstagramEmbeds().catch(error => {
    const inlineNotice = document.querySelector('#member-profile-inline-notice');
    inlineNotice.textContent = `${error.message} Use the direct Instagram links in this section.`;
    inlineNotice.hidden = false;
  });
};

const loadProfile = async () => {
  if (!supabase) {
    showUnavailable('Member profiles are not configured yet.');
    return;
  }
  const username = new URLSearchParams(window.location.search).get('username')?.trim().toLowerCase();
  if (!username) {
    showUnavailable('No profile address was provided.');
    return;
  }

  const { data: profile, error } = await supabase
    .from('member_profiles')
    .select('user_id, username, display_name, nationality, bio, home_break, surf_club, instagram_handle, website_url, profile_photo_url, cover_photo_url, theme')
    .eq('username', username)
    .eq('is_public', true)
    .maybeSingle();
  if (error) throw new Error(`Could not load this profile: ${error.message}`);
  if (!profile) {
    showUnavailable('This profile may be private or the link may be incorrect.');
    return;
  }

  const { data: athleteLink, error: athleteLinkError } = await supabase
    .from('member_athlete_profile_links')
    .select('athlete_profile_key')
    .eq('member_user_id', profile.user_id)
    .maybeSingle();
  if (athleteLinkError) throw new Error(`Could not load this athlete profile link: ${athleteLinkError.message}`);
  if (athleteLink) {
    const athleteUrl = new URL('athlete-profile.html', siteRoot);
    athleteUrl.searchParams.set('athlete', athleteLink.athlete_profile_key);
    window.location.replace(athleteUrl.href);
    return;
  }

  const { data: reels, error: reelsError } = await supabase
    .from('member_instagram_reels')
    .select('reel_url, shortcode')
    .eq('owner_id', profile.user_id)
    .order('created_at');
  if (reelsError) throw new Error(`Could not load this profile’s Instagram links: ${reelsError.message}`);

  const theme = {
    ocean: { navy: '#08283b', blue: '#143d5a', cream: '#f3f1eb', lime: '#cbde5a' },
    sand: { navy: '#66513b', blue: '#8b7154', cream: '#f5eee2', lime: '#dfbd7d' },
    sunset: { navy: '#6f3029', blue: '#994a38', cream: '#f7e9dd', lime: '#ffd09c' },
    midnight: { navy: '#182438', blue: '#283a52', cream: '#e9edf0', lime: '#7fc8cb' }
  }[profile.theme];
  if (theme) {
    Object.entries(theme).forEach(([name, value]) => {
      profileRoot.style.setProperty(`--${name}`, value);
    });
  }

  const displayName = profile.display_name || 'UPSA Community Surfer';
  const coverImage = document.querySelector('#member-cover-image');
  const coverFallback = document.querySelector('#member-cover-fallback');
  coverImage.alt = `${displayName} cover photo`;
  if (profile.cover_photo_url) {
    coverImage.src = profile.cover_photo_url;
    coverImage.hidden = false;
    coverFallback.hidden = true;
    coverImage.addEventListener('error', () => {
      coverImage.hidden = true;
      coverFallback.hidden = false;
    }, { once: true });
  } else {
    coverFallback.hidden = false;
  }

  const profileImage = document.querySelector('#member-profile-image');
  const profileInitials = document.querySelector('#member-profile-initials');
  const photoNote = document.querySelector('#member-profile-photo-note');
  profileInitials.textContent = initialsFor(displayName);
  profileImage.alt = `${displayName} profile photo`;
  if (profile.profile_photo_url) {
    profileImage.src = profile.profile_photo_url;
    profileImage.hidden = false;
    profileInitials.hidden = true;
    photoNote.hidden = true;
    profileImage.addEventListener('error', () => {
      profileImage.hidden = true;
      profileInitials.hidden = false;
      photoNote.hidden = false;
    }, { once: true });
  }

  document.querySelector('#member-public-name').textContent = displayName;
  const nationality = document.querySelector('#member-public-nationality');
  const nationalityName = getCountryName(profile.nationality);
  if (nationalityName) {
    nationality.textContent = `${getCountryFlag(profile.nationality)} ${nationalityName}`;
    nationality.hidden = false;
  }
  document.querySelector('#member-public-username').textContent = `@${profile.username}`;
  document.querySelector('#member-public-bio').textContent = profile.bio;
  document.querySelector('#member-public-bio').hidden = !profile.bio;
  const location = [profile.home_break, profile.surf_club].filter(Boolean).join(' · ');
  const locationElement = document.querySelector('#member-public-location');
  locationElement.textContent = location;
  locationElement.hidden = !location;
  document.title = `${displayName} | UPSA Community Profile`;

  if (profile.instagram_handle) {
    addExternalLink(
      `Instagram @${profile.instagram_handle} ↗`,
      `https://www.instagram.com/${encodeURIComponent(profile.instagram_handle)}/`
    );
  }
  if (profile.website_url) addExternalLink('Website ↗', profile.website_url);

  renderProfileFacts(profile);
  renderReels(reels);

  profileRoot.hidden = false;
  notice.hidden = true;

  const nav = document.querySelector('.athlete-profile-nav');
  const navLinks = [...nav.querySelectorAll('a')].filter(link => !link.hidden);
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      navLinks.forEach(item => item.classList.remove('active'));
      link.classList.add('active');
    });
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0];
      if (!visible) return;
      navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`);
      });
    }, { rootMargin: '-20% 0px -65% 0px', threshold: [0.05, 0.25, 0.5] });
    ['#member-overview', '#member-about', ...(reels.length ? ['#member-instagram'] : [])]
      .forEach(selector => observer.observe(document.querySelector(selector)));
  }
};

loadProfile().catch(error => showUnavailable(error.message));
