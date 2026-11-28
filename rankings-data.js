(() => {
  const scriptUrl = document.currentScript?.src
    || new URL('rankings-data.js', document.baseURI).href;

  const getText = value => String(value ?? '').trim();

  const loadSeason = async year => {
    if (!window.XLSX || typeof window.XLSX.read !== 'function') {
      throw new Error('The local Excel parser did not load.');
    }

    const url = new URL(`rankings-data/${year}.xlsx`, scriptUrl);
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Could not load the ${year} rankings workbook (HTTP ${response.status}).`);
    }

    const workbook = window.XLSX.read(await response.arrayBuffer(), { type: 'array' });
    const infoSheet = workbook.Sheets['Season Info'];
    if (!infoSheet) {
      throw new Error(`The ${year} rankings workbook is missing its Season Info sheet.`);
    }

    const infoRows = window.XLSX.utils.sheet_to_json(infoSheet, {
      header: 1,
      raw: false,
      defval: ''
    });
    const metadata = new Map(infoRows.slice(1).map(([field, value]) => [getText(field), getText(value)]));
    if (Number(metadata.get('Year')) !== year) {
      throw new Error(`The rankings workbook at ${url.pathname} does not identify season ${year}.`);
    }

    const title = metadata.get('Title');
    if (!title) throw new Error(`The ${year} rankings workbook is missing its season title.`);

    const categories = workbook.SheetNames
      .filter(sheetName => sheetName !== 'Season Info')
      .map((sheetName, categoryIndex) => {
        const sourceHeadersValue = metadata.get(`Headers:${sheetName}`);
        if (!sourceHeadersValue) {
          throw new Error(`The ${year} rankings workbook is missing source column metadata for ${sheetName}.`);
        }

        let headers;
        try {
          headers = JSON.parse(sourceHeadersValue);
        } catch (error) {
          throw new Error(`Invalid source column metadata for ${year} ${sheetName}: ${error.message}`);
        }
        if (!Array.isArray(headers) || !headers.length) {
          throw new Error(`Invalid source column metadata for ${year} ${sheetName}.`);
        }

        const sheet = workbook.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          defval: ''
        });
        const tableHeaders = (rows.shift() || []).map(getText);
        const columnIndexes = headers.map(header => {
          const label = getText(header);
          if (/^rank$/i.test(label)) return tableHeaders.findIndex(value => value === 'Overall Rank');
          if (/^name$/i.test(label)) return tableHeaders.findIndex(value => value === 'Name');
          if (/^athlete\s*id$/i.test(label)) return tableHeaders.findIndex(value => value === 'Athlete ID');
          if (/^total points/i.test(label)) return tableHeaders.findIndex(value => value === 'Overall Points');
          if (/^leg\s+\d+$/i.test(label)) return tableHeaders.findIndex(value => value === label);
          if (/carry\s*over|carryover/i.test(label)) return tableHeaders.findIndex(value => value === 'Carryover Points');
          return -1;
        });
        if (columnIndexes.some(index => index < 0)) {
          throw new Error(`The ${year} ${sheetName} sheet is missing a required ranking column.`);
        }

        const dataRows = rows
          .filter(row => row.some(value => getText(value) !== ''))
          .map(row => columnIndexes.map(index => getText(row[index])));
        if (!dataRows.length) {
          throw new Error(`The ${year} ${sheetName} sheet contains no ranking entries.`);
        }

        return {
          title: `${year} ${sheetName}`,
          headers,
          rows: dataRows,
          categoryIndex
        };
      });

    if (!categories.length) {
      throw new Error(`The ${year} rankings workbook contains no division sheets.`);
    }

    return {
      year,
      title,
      categories,
      notices: infoRows
        .slice(1)
        .filter(([field]) => getText(field) === 'Notice')
        .map(([, value]) => getText(value))
    };
  };

  const loadSeasons = async () => {
    const manifestUrl = new URL('rankings-data/manifest.json', scriptUrl);
    const response = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Could not load the rankings workbook list (HTTP ${response.status}).`);
    }

    const manifest = await response.json();
    if (
      !Array.isArray(manifest.years)
      || !manifest.years.length
      || manifest.years.some(year => !Number.isInteger(year) || year < 1900)
    ) {
      throw new Error('The rankings workbook list must contain a non-empty array of season years.');
    }

    const years = [...new Set(manifest.years)].sort((first, second) => first - second);
    return Promise.all(years.map(loadSeason));
  };

  window.upsaRankingsReady = loadSeasons()
    .then(seasons => {
      window.upsaRankings = seasons;
      return seasons;
    })
    .catch(error => {
      console.error('UPSA rankings workbooks could not be loaded.', error);
      if (document.body && !document.querySelector('.rankings-data-error')) {
        const alert = document.createElement('p');
        alert.className = 'rankings-data-error';
        alert.setAttribute('role', 'alert');
        alert.textContent = `Rankings could not be loaded: ${error.message}`;
        document.body.prepend(alert);
      }
      throw error;
    });
})();
