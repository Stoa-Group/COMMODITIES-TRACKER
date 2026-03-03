# Backfill Troubleshooting

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

- Correct: `https://stoagroup-api.onrender.com`
- Incorrect: `https://stoagroup-api.onrender.com/` (trailing slash – usually OK but avoid)
- Incorrect: `https://stoagroup-api.onrender.com/api` (would result in `/api/api/commodities/ingest`)

## 3. Test the endpoint manually

```bash
# Replace with your actual API URL
curl -X GET "https://stoagroup-api.onrender.com/api/commodities?limit=1"
```

- **200** with `[]` or data → commodities route exists
- **404** → commodities route not deployed; redeploy stoagroupDB API

## 4. Run the commodities schema

Before ingest works, run `schema/create_commodities_schema.sql` on the production database (Azure Portal Query Editor or SSMS).
