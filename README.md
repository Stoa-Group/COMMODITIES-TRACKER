# Commodities Tracker

Automated daily tracking of commodity prices, metals, futures, PPIs, and all Random Lengths wood products, sent to Domo via webhook.

## Overview

This script collects commodity pricing data from multiple sources:

- **Metals**: Aluminum, Copper, Steel via Metals-API
- **Futures**: Lumber (LB) via Financial Modeling Prep
- **PPI Data**: Cement, PVC, Gypsum via FRED (Federal Reserve Economic Data)

## Data Structure

Each record follows this unified format:

```json
{
  "material": "metal | lumber | wood | construction",
  "subcategory": "Base Metals | CME Futures | PPI | Framing Lumber | Panels | Engineered Wood | Cedar | Softwood Boards | Specialty",
  "product": "Aluminum | LB | Douglas Fir KD | Cement etc.",
  "date": "YYYY-MM-DD",
  "value": 123.45,
  "source": "Metals-API | FMP | FRED"
}
```

## Setup

### 1. Get API Keys

- **FRED API Key**: Free at https://fred.stlouisfed.org/docs/api/api_key.html
- **FMP API Key**: Get from https://financialmodelingprep.com (free tier available)
- **Metals API Key**: Get from https://metals-api.com

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
FRED_API_KEY=your_fred_key_here
FMP_API_KEY=your_fmp_key_here
METALS_API_KEY=your_metals_key_here
DOMO_WEBHOOK_URL=https://stoagroup.domo.com/api/iot/v1/webhook/data/...
```

### 3. Configure GitHub Secrets

In your GitHub repository, go to Settings → Secrets and variables → Actions, and add:

- `FRED_API_KEY`: Your FRED API key
- `FMP_API_KEY`: Your Financial Modeling Prep API key
- `METALS_API_KEY`: Your Metals-API key
- `DOMO_WEBHOOK_URL`: Your Domo webhook URL (optional, defaults to hardcoded URL)

### 4. Local Testing

```bash
# Install dependencies
pip install -r requirements.txt

# Run the script
python commodities_tracker.py
```

## Schedule

The workflow runs automatically every night at 2:00 AM UTC via GitHub Actions. You can also trigger it manually from the Actions tab.

## Output Format

The script sends a JSON array to Domo with all commodities and wood products. See `sample_output.json` for an example.

## Functions

The module implements the following functions as specified:

- `fetch_metals()`: Fetches Aluminum, Copper, Steel in one API call
- `fetch_lumber_futures()`: Fetches LB futures price
- `fetch_fred_series(series_id)`: Fetches latest PPI observation
- `build_payload()`: Assembles complete dataset from API sources
- `push_to_domo(payload)`: Sends data to Domo webhook
- `main()`: Main execution function

## Error Handling

- Metals-API failures are logged and return None values
- FMP missing symbols return None
- FRED missing observations return None
- Domo response codes are printed/logged
- Execution continues even if one source fails

## Historical Data Upload

To backfill historical data, use the `historical_uploader.py` script:

```bash
# Upload last 30 days
python historical_uploader.py --days 30

# Upload specific date range
python historical_uploader.py --start-date 2024-01-01 --end-date 2024-12-31

# Dry run (test without uploading)
python historical_uploader.py --days 30 --dry-run
```

See `HISTORICAL_DATA.md` for detailed documentation.

## Files

- `commodities_tracker.py`: Main script that collects and sends data
- `historical_uploader.py`: Script for uploading historical data
- `requirements.txt`: Python dependencies
- `.github/workflows/nightly-tracker.yml`: GitHub Actions workflow configuration
- `sample_output.json`: Example JSON output for testing
- `HISTORICAL_DATA.md`: Guide for historical data uploads
