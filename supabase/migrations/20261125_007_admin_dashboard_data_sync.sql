-- Admin-only synchronization for the public dashboard data tables.

create or replace function public.admin_sync_dashboard_rankings(target_season jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  season_year_value integer;
  season_title_value text;
  season_id_value uuid;
  category_json jsonb;
  headers_json jsonb;
  row_json jsonb;
  row_index integer;
  category_index integer;
  column_index integer;
  division_title text;
  division_key text;
  division_display_name text;
  division_id_value uuid;
  source_record_id_value uuid;
  ranking_entry_id_value uuid;
  source_hash_value text;
  source_name_value text;
  source_athlete_id_value text;
  rank_label_value text;
  rank_value_value numeric;
  total_points_label_value text;
  total_points_value numeric;
  carryover_points_value numeric;
  header_label text;
  source_value text;
  numeric_value text;
  leg_match text[];
  leg_number_value integer;
  imported_rows integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can sync dashboard rankings';
  end if;

  if jsonb_typeof(target_season) is distinct from 'object'
     or jsonb_typeof(target_season->'categories') is distinct from 'array' then
    raise exception 'A season object with a categories array is required';
  end if;

  season_year_value := nullif(target_season->>'year', '')::integer;
  season_title_value := nullif(target_season->>'title', '');
  if season_year_value is null or season_title_value is null then
    raise exception 'The season year and title are required';
  end if;

  insert into public.seasons (year, title, is_public)
  values (season_year_value, season_title_value, true)
  on conflict (year) do update
    set title = excluded.title,
        is_public = excluded.is_public
  returning id into season_id_value;

  for category_index in 0..jsonb_array_length(target_season->'categories') - 1 loop
    category_json := target_season->'categories'->category_index;
    division_title := nullif(category_json->>'title', '');
    headers_json := category_json->'headers';
    if division_title is null
       or jsonb_typeof(headers_json) is distinct from 'array'
       or jsonb_typeof(category_json->'rows') is distinct from 'array' then
      raise exception 'Every ranking category must include a title, headers, and rows';
    end if;

    division_key := lower(regexp_replace(division_title, '[^a-zA-Z0-9]+', '-', 'g'));
    division_key := trim(both '-' from division_key);
    division_display_name := regexp_replace(division_title, '^\d{4}\s*', '');

    insert into public.divisions (
      season_id, source_title, normalized_key, display_name, sort_order
    )
    values (
      season_id_value, division_title, division_key, division_display_name, category_index
    )
    on conflict (season_id, normalized_key) do update
      set source_title = excluded.source_title,
          display_name = excluded.display_name,
          sort_order = excluded.sort_order
    returning id into division_id_value;

    for row_json, row_index in
      select rows.value, rows.ordinality::integer
      from jsonb_array_elements(category_json->'rows') with ordinality as rows(value, ordinality)
    loop
      if jsonb_typeof(row_json) <> 'array'
         or jsonb_array_length(row_json) <> jsonb_array_length(headers_json) then
        raise exception 'Ranking row % in % has a different number of values than headers',
          row_index, division_title;
      end if;

      source_hash_value := md5(
        season_year_value::text || ':' || division_key || ':' || row_index::text
      );
      insert into public.ranking_source_records (
        season_id, division_id, source_year, source_category_title,
        source_category_index, source_row_index, source_headers, source_row,
        source_hash, imported_at
      )
      values (
        season_id_value, division_id_value, season_year_value, division_title,
        category_index, row_index, headers_json, row_json, source_hash_value, now()
      )
      on conflict (season_id, division_id, source_row_index) do update
        set source_year = excluded.source_year,
            source_category_title = excluded.source_category_title,
            source_category_index = excluded.source_category_index,
            source_headers = excluded.source_headers,
            source_row = excluded.source_row,
            source_hash = excluded.source_hash,
            imported_at = excluded.imported_at
      returning id into source_record_id_value;

      source_name_value := null;
      source_athlete_id_value := null;
      rank_label_value := null;
      rank_value_value := null;
      total_points_label_value := null;
      total_points_value := null;
      carryover_points_value := null;

      for column_index in 0..jsonb_array_length(headers_json) - 1 loop
        header_label := headers_json->>column_index;
        source_value := nullif(row_json->>column_index, '');
        numeric_value := nullif(regexp_replace(coalesce(source_value, ''), '[^0-9.-]', '', 'g'), '');

        if lower(header_label) = 'name' then
          source_name_value := source_value;
        elsif lower(header_label) = 'athlete id' then
          source_athlete_id_value := source_value;
        elsif lower(header_label) = 'rank' then
          rank_label_value := source_value;
          if numeric_value ~ '^-?[0-9]+(\.[0-9]+)?$' then
            rank_value_value := numeric_value::numeric;
          end if;
        elsif lower(header_label) like 'total points%' then
          total_points_label_value := source_value;
          if numeric_value ~ '^-?[0-9]+(\.[0-9]+)?$' then
            total_points_value := numeric_value::numeric;
          end if;
        elsif lower(header_label) like '%carry%over%' then
          if numeric_value ~ '^-?[0-9]+(\.[0-9]+)?$' then
            carryover_points_value := numeric_value::numeric;
          end if;
        end if;
      end loop;

      insert into public.ranking_entries (
        season_id, division_id, source_record_id, source_name, source_athlete_id,
        rank_value, rank_label, total_points, total_points_label, carryover_points
      )
      values (
        season_id_value, division_id_value, source_record_id_value,
        coalesce(source_name_value, 'Unknown athlete'), source_athlete_id_value,
        rank_value_value, rank_label_value, total_points_value,
        total_points_label_value, carryover_points_value
      )
      on conflict (source_record_id) do update
        set season_id = excluded.season_id,
            division_id = excluded.division_id,
            source_name = excluded.source_name,
            source_athlete_id = excluded.source_athlete_id,
            rank_value = excluded.rank_value,
            rank_label = excluded.rank_label,
            total_points = excluded.total_points,
            total_points_label = excluded.total_points_label,
            carryover_points = excluded.carryover_points
      returning id into ranking_entry_id_value;

      delete from public.ranking_leg_points
      where ranking_entry_id = ranking_entry_id_value;

      for column_index in 0..jsonb_array_length(headers_json) - 1 loop
        header_label := headers_json->>column_index;
        source_value := nullif(row_json->>column_index, '');
        leg_match := regexp_match(header_label, '^\s*leg\s*([0-9]+)', 'i');
        if leg_match is not null then
          leg_number_value := leg_match[1]::integer;
          numeric_value := nullif(regexp_replace(coalesce(source_value, ''), '[^0-9.-]', '', 'g'), '');
          insert into public.ranking_leg_points (
            ranking_entry_id, leg_label, leg_number, points, source_value
          )
          values (
            ranking_entry_id_value,
            header_label,
            leg_number_value,
            case when numeric_value ~ '^-?[0-9]+(\.[0-9]+)?$' then numeric_value::numeric else null end,
            source_value
          );
        end if;
      end loop;
      imported_rows := imported_rows + 1;
    end loop;

    delete from public.ranking_source_records
    where season_id = season_id_value
      and division_id = division_id_value
      and source_row_index > jsonb_array_length(category_json->'rows');
  end loop;

  return jsonb_build_object(
    'year', season_year_value,
    'ranking_entries_synced', imported_rows
  );
end;
$$;

create or replace function public.admin_sync_dashboard_events(target_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_json jsonb;
  imported_events integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can sync dashboard events';
  end if;
  if jsonb_typeof(target_events) is distinct from 'array' then
    raise exception 'An events array is required';
  end if;

  for event_json in select value from jsonb_array_elements(target_events)
  loop
    if nullif(event_json->>'name', '') is null
       or nullif(event_json->>'slug', '') is null then
      raise exception 'Every event must include a name and slug';
    end if;

    insert into public.events (
      name, slug, description, location, start_date, end_date, category,
      featured_image_path, publication_status, external_url
    )
    values (
      event_json->>'name',
      event_json->>'slug',
      nullif(event_json->>'description', ''),
      nullif(event_json->>'location', ''),
      nullif(event_json->>'start_date', '')::date,
      nullif(event_json->>'end_date', '')::date,
      nullif(event_json->>'category', ''),
      nullif(event_json->>'featured_image_path', ''),
      'published',
      nullif(event_json->>'external_url', '')
    )
    on conflict (slug) do update
      set name = excluded.name,
          description = excluded.description,
          location = excluded.location,
          start_date = excluded.start_date,
          end_date = excluded.end_date,
          category = excluded.category,
          featured_image_path = excluded.featured_image_path,
          publication_status = excluded.publication_status,
          external_url = excluded.external_url;

    imported_events := imported_events + 1;
  end loop;

  return jsonb_build_object('events_synced', imported_events);
end;
$$;

revoke all on function public.admin_sync_dashboard_rankings(jsonb) from public;
grant execute on function public.admin_sync_dashboard_rankings(jsonb) to authenticated;
revoke all on function public.admin_sync_dashboard_events(jsonb) from public;
grant execute on function public.admin_sync_dashboard_events(jsonb) to authenticated;

notify pgrst, 'reload schema';
