import requests
import json
from datetime import datetime
from dotenv import load_dotenv
import os

# Load environment variables from .env file
load_dotenv()

# -----------------------------
# CONFIGURATION
# -----------------------------
DOMO_WEBHOOK_URL = "https://stoagroup.domo.com/api/iot/v1/webhook/data/eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NjQ4NzAzNzUsInN0cmVhbSI6IjkyNDE0M2Q4NGY4NzRmMTZiYzU3MWQ1OWY5NTc5Y2FiOm1tbW0tMDA0NC0wNTc0OjUyMzIwNTM5NSJ9.zK49RWVpC4DDCIF6gHHOYY1LcwZ2CGqef_PJCiwsDUk"

# Get API keys from .env file
FRED_API_KEY = os.getenv("FRED_API_KEY")
FMP_API_KEY = os.getenv("FMP_API_KEY")
METALS_API_KEY = os.getenv("METALS_API_KEY")

# Validate required keys
if not FRED_API_KEY:
    print("Warning: FRED_API_KEY not found in .env file")
if not FMP_API_KEY:
    print("Warning: FMP_API_KEY not found in .env file")
if not METALS_API_KEY:
    print("Warning: METALS_API_KEY not found in .env file (optional)")

today = datetime.now().strftime("%Y-%m-%d")


# ------------------------------------------------
# HELPERS
# ------------------------------------------------
def fred_series(series_id):
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json&sort_order=desc"
    )
    r = requests.get(url)
    if r.status_code != 200:
        return None

    data = r.json().get("observations", [])
    if not data:
        return None

    latest = data[-1]
    value = latest.get("value")
    return float(value) if value not in ("", None) else None


def fmp_quote(symbol):
    """Get real-time futures quote from Financial Modeling Prep."""
    url = f"https://financialmodelingprep.com/api/v3/quote/{symbol}?apikey={FMP_API_KEY}"
    r = requests.get(url)
    if r.status_code != 200:
        return None

    try:
        return float(r.json()[0].get("price"))
    except:
        return None


# ------------------------------------------------
# METALS API - Single Request (Iron Plan Optimized)
# ------------------------------------------------
def fetch_metals():
    """
    Pull aluminum, copper, steel in ONE API call.
    Uses the free/low-tier Metals-API 'latest' endpoint.
    """
    url = (
        f"https://metals-api.com/api/latest?"
        f"access_key={METALS_API_KEY}&base=USD&symbols=ALUMINUM,COPPER,STEEL"
    )

    try:
        r = requests.get(url, timeout=10)
        data = r.json()

        if not data.get("success", False):
            return {
                "aluminum": None,
                "copper": None,
                "steel": None,
                "error": data.get("error", {}).get("info", "Unknown error")
            }

        rates = data.get("rates", {})

        return {
            "aluminum": rates.get("ALUMINUM"),
            "copper": rates.get("COPPER"),
            "steel": rates.get("STEEL")
        }
    except Exception as e:
        return {"aluminum": None, "copper": None, "steel": None, "error": str(e)}


# ------------------------------------------------
# COLLECT DATA
# ------------------------------------------------
dataset = []

# Lumber — CME Futures (LB)
lumber_price = fmp_quote("LB")
dataset.append({
    "material": "lumber",
    "source": "CME Futures (LB)",
    "date": today,
    "value": lumber_price
})

# Metals (one call)
metals = fetch_metals()

dataset.append({
    "material": "copper",
    "source": "Metals-API",
    "date": today,
    "value": metals.get("copper")
})

dataset.append({
    "material": "aluminum",
    "source": "Metals-API",
    "date": today,
    "value": metals.get("aluminum")
})

dataset.append({
    "material": "steel",
    "source": "Metals-API",
    "date": today,
    "value": metals.get("steel")
})


# PPI SERIES
dataset.append({
    "material": "cement",
    "source": "US PPI",
    "date": today,
    "value": fred_series("PCU3274203274201")
})

dataset.append({
    "material": "pvc",
    "source": "US PPI",
    "date": today,
    "value": fred_series("WPU06310209")
})

dataset.append({
    "material": "gypsum",
    "source": "US PPI",
    "date": today,
    "value": fred_series("PCU3274103274101")
})


# ------------------------------------------------
# SEND TO DOMO (FULL REPLACE)
# ------------------------------------------------
print("Uploading full dataset to Domo…")

headers = {"Content-Type": "application/json"}

response = requests.post(
    DOMO_WEBHOOK_URL,
    data=json.dumps(dataset),
    headers=headers
)

print("Status:", response.status_code)
print("Response:", response.text)
