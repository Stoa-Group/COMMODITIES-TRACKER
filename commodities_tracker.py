import requests
import json
from datetime import datetime
import os

# -----------------------------
# CONFIGURATION
# -----------------------------
DOMO_WEBHOOK_URL = "https://stoagroup.domo.com/api/iot/v1/webhook/data/eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NjQ4NzAzNzUsInN0cmVhbSI6IjkyNDE0M2Q4NGY4NzRmMTZiYzU3MWQ1OWY5NTc5Y2FiOm1tbW0tMDA0NC0wNTc0OjUyMzIwNTM5NSJ9.zK49RWVpC4DDCIF6gHHOYY1LcwZ2CGqef_PJCiwsDUk"

# Get API keys from environment variables (set in GitHub Actions secrets)
FRED_API_KEY = os.getenv("FRED_API_KEY", "YOUR_FRED_KEY")
FMP_API_KEY = os.getenv("FMP_API_KEY", "demo")
METALS_API_KEY = os.getenv("METALS_API_KEY", "")

today = datetime.now().strftime("%Y-%m-%d")

# ------------------------------------------------
# HELPERS
# ------------------------------------------------
def fred_series(series_id):
    """Get latest monthly observation from a FRED PPI/Index series."""
    if FRED_API_KEY == "YOUR_FRED_KEY":
        return None
    
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
    latest = data[-1]  # last entry is most recent chronologically
    value = latest.get("value")
    if value in ("", None):
        return None
    return float(value)

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
# COLLECT DATA (FREE SOURCES)
# ------------------------------------------------
dataset = []

# Lumber — CME Lumber Futures (LB1)
lumber_price = fmp_quote("LB")
dataset.append({
    "material": "lumber",
    "source": "CME Futures (LB)",
    "date": today,
    "value": lumber_price
})

# Copper (from FMP or Metals-API alternative)
copper_price = fmp_quote("HG")   # Copper futures
dataset.append({
    "material": "copper",
    "source": "COMEX Copper (HG)",
    "date": today,
    "value": copper_price
})

# Aluminum (LME) — free replacement via Metals-API (if key provided)
# If no key, this returns None safely.
if METALS_API_KEY:
    try:
        metals_resp = requests.get(
            f"https://metals-api.com/api/latest?access_key={METALS_API_KEY}&symbols=ALUMINUM"
        ).json()
        aluminum_price = metals_resp.get("rates", {}).get("ALUMINUM")
    except:
        aluminum_price = None
else:
    aluminum_price = None

dataset.append({
    "material": "aluminum",
    "source": "LME Aluminum (metals-api)",
    "date": today,
    "value": aluminum_price
})

# Steel — using steel scrap index via Metals API (if available)
if METALS_API_KEY:
    try:
        steel_resp = requests.get(
            f"https://metals-api.com/api/latest?access_key={METALS_API_KEY}&symbols=STEEL"
        ).json()
        steel_price = steel_resp.get("rates", {}).get("STEEL")
    except:
        steel_price = None
else:
    steel_price = None

dataset.append({
    "material": "steel",
    "source": "Steel Index (metals-api)",
    "date": today,
    "value": steel_price
})

# -------- PPI Series for Other Materials --------
# Cement PPI
cement_ppi = fred_series("PCU3274203274201")
dataset.append({
    "material": "cement",
    "source": "US PPI",
    "date": today,
    "value": cement_ppi
})

# PVC Resin PPI
pvc_ppi = fred_series("WPU06310209")
dataset.append({
    "material": "pvc",
    "source": "US PPI",
    "date": today,
    "value": pvc_ppi
})

# Gypsum products PPI
gypsum_ppi = fred_series("PCU3274103274101")  # Gypsum product index
dataset.append({
    "material": "gypsum",
    "source": "US PPI",
    "date": today,
    "value": gypsum_ppi
})

# ------------------------------------------------
# PUSH FULL DATASET TO DOMO (FULL REPLACE)
# ------------------------------------------------
print("Sending data to Domo…")
print(f"Dataset: {json.dumps(dataset, indent=2)}")

headers = {"Content-Type": "application/json"}
response = requests.post(
    DOMO_WEBHOOK_URL,
    data=json.dumps(dataset),
    headers=headers
)

print("Status:", response.status_code)
print("Response:", response.text)

if response.status_code == 200:
    print("✓ Successfully sent data to Domo")
else:
    print("✗ Failed to send data to Domo")
    exit(1)

