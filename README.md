# Commodities Tracker

Automated daily tracking of commodity prices and PPI data, sent to Domo via webhook.

## Overview

This script collects commodity pricing data from multiple sources:
- **Futures**: Lumber (LB), Copper (HG) via Financial Modeling Prep
- **Metals**: Aluminum, Steel via Metals-API (optional)
- **PPI Data**: Cement, PVC, Gypsum via FRED (Federal Reserve Economic Data)

Data is automatically sent to Domo as a clean JSON array on a nightly schedule.

## Setup

### 1. Get API Keys

- **FRED API Key**: Free at https://fred.stlouisfed.org/docs/api/api_key.html
- **FMP API Key**: Get from https://financialmodelingprep.com (free tier available)
- **Metals API Key**: Optional, from https://metals-api.com

### 2. Configure GitHub Secrets

In your GitHub repository, go to Settings → Secrets and variables → Actions, and add:

- `FRED_API_KEY`: Your FRED API key
- `FMP_API_KEY`: Your Financial Modeling Prep API key
- `METALS_API_KEY`: Your Metals-API key (optional, leave empty if not using)

### 3. Local Testing

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables (Windows PowerShell)
$env:FRED_API_KEY="your_key_here"
$env:FMP_API_KEY="your_key_here"
$env:METALS_API_KEY="your_key_here"  # Optional

# Run the script
python commodities_tracker.py
```

## Schedule

The workflow runs automatically every night at 2:00 AM UTC via GitHub Actions. You can also trigger it manually from the Actions tab.

## Output Format

The script sends a JSON array to Domo with the following structure:

```json
[
  {
    "material": "lumber",
    "source": "CME Futures (LB)",
    "date": "2024-01-15",
    "value": 450.25
  },
  {
    "material": "copper",
    "source": "COMEX Copper (HG)",
    "date": "2024-01-15",
    "value": 3.85
  },
  ...
]
```

## Files

- `commodities_tracker.py`: Main script that collects and sends data
- `requirements.txt`: Python dependencies
- `.github/workflows/nightly-tracker.yml`: GitHub Actions workflow configuration
- `sample_output.json`: Example JSON output for testing

