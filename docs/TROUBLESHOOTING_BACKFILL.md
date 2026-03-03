# Backfill & Dashboard Troubleshooting

## Dashboard shows no data / can't update

1. **Wrong API URL**: The dashboard must use `https://stoagroupdb-ddre.onrender.com` (not `stoagroup-api`). The app auto-detects localhost and uses `http://localhost:3000` when running locally.
2. **Render API returns 500**: The production DB may be missing the commodities schema. See "500 Internal Server Error" below.
3. **CORS**: If loading from a custom origin, ensure the API's `CORS_ORIGINS` env var includes it, or the API allows all origins when `CORS_ORIGINS` is empty.

## Nightly tracker doesn't push data

1. **GitHub Secrets**: Ensure `FRED_API_KEY`, `STOAGROUP_API_URL`, and `COMMODITIES_INGEST_KEY` are set. `STOAGROUP_API_URL` must be `https://stoagroupdb-ddre.onrender.com` (no trailing slash).
2. **Ingest 500**: Schema not on Render's DB; run `create_commodities_schema.sql` there.
3. **ALLOW_INGEST_FAILURE**: The workflow sets this so the job stays green even when push fails. Check the Actions log for `[API] Status:` to see the actual response.

---

## 500 Internal Server Error

If the backfill fails with **500** and `{"error":"Failed to ingest commodities data"}`:

**Most likely cause:** The commodities schema has not been run on the production database.

**Fix:**

1. **Run the schema** on the same database Render uses (same as your API's DB_* env vars):
   ```bash
   cd stoagroupDB/api
   npm run db:run-migration -- ../schema/create_commodities_schema.sql
   ```
   Or run the SQL manually in Azure Portal Query editor / SSMS.

2. **Ensure the latest API is deployed** on Render (includes temp-table connection fix). Push stoagroupDB and let Render auto-deploy, or trigger Manual Deploy.

---

## 404 Not Found

If the backfill fails with **404 Not Found** when pushing to the API:

## 1. Verify the commodities API is deployed

The commodities routes were added to stoagroupDB. Render must have deployed the latest code.

- Go to [Render Dashboard](https://dashboard.render.com)
- Open the stoagroupDB API service
- Check **Events** – ensure the latest deploy (after the commodities commit) succeeded
- If the deploy failed, fix the error and redeploy
- If auto-deploy is off, click **Manual Deploy** → **Deploy latest commit**

## 2. Verify the API URL

`STOAGROUP_API_URL` in GitHub Secrets must be the **base URL only**, e.g.:

- Correct: `https://stoagroupdb-ddre.onrender.com`
- Incorrect: `https://stoagroup-api.onrender.com/` (trailing slash – usually OK but avoid)
- Incorrect: `https://stoagroup-api.onrender.com/api` (would result in `/api/api/commodities/ingest`)

## 3. Test the endpoint manually

```bash
# Replace with your actual API URL
curl -X GET "https://stoagroupdb-ddre.onrender.com/api/commodities?limit=1"
```

- **200** with `[]` or data → commodities route exists
- **404** → commodities route not deployed; redeploy stoagroupDB API

## 4. Run the commodities schema

Before ingest works, run `schema/create_commodities_schema.sql` on the production database (Azure Portal Query Editor or SSMS).
