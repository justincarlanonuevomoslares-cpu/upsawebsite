const toSlug = value => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const readWebsiteEvents = async () => {
  const response = await fetch(new URL('events.html', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not read the public events page (HTTP ${response.status}).`);

  const source = new DOMParser().parseFromString(await response.text(), 'text/html');
  const events = [...source.querySelectorAll('.event-listing')].map(event => {
    const name = event.dataset.title?.trim();
    if (!name) return null;
    const image = event.querySelector('.event-card-image img');
    const link = event.querySelector('.event-card-image[href], .event-card-content h3 a');
    const startDate = event.dataset.start || '';
    const slugBase = toSlug(name) || 'upsa-event';

    return {
      name,
      slug: startDate ? `${slugBase}-${startDate.slice(0, 4)}` : slugBase,
      description: '',
      location: event.dataset.location || '',
      start_date: startDate,
      end_date: event.dataset.end || '',
      category: event.dataset.type || '',
      featured_image_path: image?.src || '',
      external_url: link?.href || ''
    };
  }).filter(Boolean);

  if (!events.length) throw new Error('No public event listings were found to sync.');
  return events;
};

export const syncDashboardContent = async (supabase, seasons, onProgress = () => {}) => {
  if (!Array.isArray(seasons) || !seasons.length) {
    throw new Error('No ranking seasons are available to sync.');
  }

  const results = [];
  for (const season of seasons) {
    onProgress(`Syncing ${season.year} rankings…`);
    const { data, error } = await supabase.rpc('admin_sync_dashboard_rankings', {
      target_season: season
    });
    if (error) throw new Error(`Could not sync ${season.year} rankings: ${error.message}`);
    results.push(data);
  }

  onProgress('Syncing published event listings…');
  const events = await readWebsiteEvents();
  const { data, error } = await supabase.rpc('admin_sync_dashboard_events', {
    target_events: events
  });
  if (error) throw new Error(`Rankings synced, but event sync failed: ${error.message}`);
  results.push(data);

  return results;
};
