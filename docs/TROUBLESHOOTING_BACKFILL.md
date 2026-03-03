# Backfill Troubleshooting

## 500 Internal Server Error

If the backfill fails with **500** and `{"error":"Failed to ingest commodities data"}`:

**Most likely cause:** The commodities schema has not been run on the production database.

**Fix:** Run `schema/create_commodities_schema.sql` on your production database:
- Azure Portal → Query editor (or connect via SSMS)
- Execute the script from `stoagroupDB/schema/create_commodities_schema.sql`

This creates the `commodities` schema and `commodities.CommodityPrice` table. Then re-run the backfill.

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
