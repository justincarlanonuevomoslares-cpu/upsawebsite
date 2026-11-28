# upsawebsite

## Rankings data

Ranking records are maintained in `rankings-data/<year>.xlsx`, with one worksheet per division plus a `Season Info` worksheet. The site reads the available seasons from `rankings-data/manifest.json` and loads those workbooks directly using the local SheetJS CE 0.20.3 parser in `vendor/`.

The `Season Info` worksheet stores the season title, notices, and source-column mapping used to keep the website's athlete and ranking views compatible. When adding a season, add its workbook and year to the manifest. Serve the site over HTTP(S) so the browser can fetch the workbooks.

The 2022–2024 source rankings do not include athlete IDs, so those workbook cells remain blank rather than inferred. The source IDs in 2025–2026 are retained as published.