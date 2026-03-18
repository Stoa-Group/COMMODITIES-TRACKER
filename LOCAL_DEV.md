# Running the Commodities Dashboard Locally

## Quick start

1. **Start the stoagroupDB API** (serves data from your local DB):
   ```bash
   cd stoagroupDB/api
   npm run dev
   ```
   API runs on http://localhost:3002 (default). The dashboard auto-connects to it when served from localhost.

2. **Start the dashboard**:
   ```bash
   cd "commodities tracker"
   npx serve -l 5500 .
   ```
   Open http://localhost:5500 in your browser.

3. **Data source**: When served from localhost, the dashboard automatically uses `http://localhost:3002` as the API URL. No config needed. No Domo datasets required.

## Override API URL

Set `window.STOAGROUP_API_URL` before the app loads, e.g. in `index.html`:
```html
<script>window.STOAGROUP_API_URL = 'https://stoagroupdb-ddre.onrender.com';</script>
```

## Run the nightly tracker locally

```bash
cd "commodities tracker"
# Ensure .env has FRED_API_KEY, STOAGROUP_API_URL, COMMODITIES_INGEST_KEY
.venv/bin/python commodities_tracker.py
```

For local API, set `STOAGROUP_API_URL=http://localhost:3002` in `.env`.
