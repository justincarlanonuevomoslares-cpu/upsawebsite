const pageSize = 1000;

const todayLocal = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const requireData = (result, description) => {
  if (result.error) throw new Error(`Could not load ${description}: ${result.error.message}`);
  return result.data || [];
};

const loadRankingRecords = async (supabase, seasonId) => {
  const records = [];
  for (let from = 0; ; from += pageSize) {
    const result = await supabase
      .from('ranking_source_records')
      .select('division_id, source_category_index, source_row_index, source_headers, source_row')
      .eq('season_id', seasonId)
      .order('source_category_index', { ascending: true })
      .order('source_row_index', { ascending: true })
      .range(from, from + pageSize - 1);
    const page = requireData(result, 'ranking records');
    records.push(...page);
    if (page.length < pageSize) return records;
  }
};

export const loadDashboardContent = async supabase => {
  const [{ data: seasons, error: seasonsError }, { data: events, error: eventsError }] = await Promise.all([
    supabase
      .from('seasons')
      .select('id, year, title')
      .eq('is_public', true)
      .order('year', { ascending: false })
      .limit(1),
    supabase
      .from('events')
      .select('id, name, description, location, start_date, end_date, category, featured_image_path, external_url')
      .eq('publication_status', 'published')
      .order('start_date', { ascending: true, nullsFirst: false })
      .limit(pageSize)
  ]);
  if (seasonsError) throw new Error(`Could not load ranking seasons: ${seasonsError.message}`);
  if (eventsError) throw new Error(`Could not load published events: ${eventsError.message}`);

  const currentDate = todayLocal();
  const upcomingEvents = (events || []).filter(event =>
    (!event.start_date || event.start_date >= currentDate)
    || Boolean(event.end_date && event.end_date >= currentDate)
  );
  const season = seasons?.[0] || null;
  if (!season) return { season: null, categories: [], events: upcomingEvents };

  const divisionsResult = await supabase
    .from('divisions')
    .select('id, display_name, sort_order')
    .eq('season_id', season.id)
    .order('sort_order', { ascending: true });
  const divisions = requireData(divisionsResult, 'ranking divisions');
  const records = await loadRankingRecords(supabase, season.id);
  const categoryById = new Map(divisions.map(division => [
    division.id,
    { title: division.display_name, headers: [], rows: [] }
  ]));

  records.forEach(record => {
    const category = categoryById.get(record.division_id);
    if (!category) return;
    if (!category.headers.length) category.headers = record.source_headers || [];
    category.rows.push(record.source_row || []);
  });

  return {
    season,
    categories: divisions
      .map(division => categoryById.get(division.id))
      .filter(category => category && category.rows.length),
    events: upcomingEvents
  };
};
