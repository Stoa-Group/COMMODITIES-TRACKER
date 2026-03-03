"""
Commodities Tracker - Free public data sources only.
Fetches from FRED (Federal Reserve Economic Data) and pushes to stoagroupDB API.
No paid APIs (Metals-API, FMP removed).
"""
import requests
import json
import time
from datetime import datetime
from dotenv import load_dotenv
import os

load_dotenv()


def get_env_var(key, default=None):
    """Get environment variable and strip surrounding quotes if present."""
    value = os.getenv(key, default)
    if value and isinstance(value, str):
        value = value.strip('"').strip("'")
    return value


# -----------------------------
# CONFIGURATION
# -----------------------------
FRED_API_KEY = get_env_var("FRED_API_KEY")
STOAGROUP_API_URL = get_env_var("STOAGROUP_API_URL", "").rstrip("/")
COMMODITIES_INGEST_KEY = get_env_var("COMMODITIES_INGEST_KEY")
ALLOW_INGEST_FAILURE = str(get_env_var("ALLOW_INGEST_FAILURE", "false")).lower() in ("1", "true", "yes", "y")

# Validation
if not FRED_API_KEY:
    print("[ERROR] FRED_API_KEY not found. Get free key at https://fred.stlouisfed.org/docs/api/api_key.html")
if not STOAGROUP_API_URL:
    print("[WARNING] STOAGROUP_API_URL not set. Data will not be pushed to database.")
if not COMMODITIES_INGEST_KEY and STOAGROUP_API_URL:
    print("[WARNING] COMMODITIES_INGEST_KEY not set. Ingest may fail if API requires it.")

# FRED series mapped to (material, subcategory, product, unit)
# Source: plan section 1 & 1b - Random Lengths free source mapping
FRED_SERIES = [
    # Lumber & Wood
    ("WPU081", "lumber", "PPI", "Lumber", "Index (1982=100)"),
    ("WPU08110701", "lumber", "PPI", "Softwood Lumber", "Index (1982=100)"),
    ("WPU081106013", "lumber", "PPI", "Softwood 2\" Dimension", "Index (1982=100)"),
    ("WPU081106014", "lumber", "PPI", "Softwood Timbers", "Index (1982=100)"),
    ("WPU0812", "lumber", "PPI", "Hardwood Lumber", "Index (1982=100)"),
    ("WPU081204", "lumber", "PPI", "Hardwood Flooring", "Index (1982=100)"),
    # Panels
    ("WPU083", "lumber", "PPI", "Plywood", "Index (1982=100)"),
    ("WPU083103035", "lumber", "PPI", "Softwood Plywood", "Index (1982=100)"),
    ("WPU09220124", "lumber", "PPI", "OSB/Waferboard", "Index (1982=100)"),
    ("WPU09220125", "lumber", "PPI", "Particleboard", "Index (1982=100)"),
    ("WPU09220141", "lumber", "PPI", "MDF", "Index (1982=100)"),
    # Millwork
    ("WPU08210162", "lumber", "PPI", "Wood Moldings", "Index (1982=100)"),
    ("WPU082", "lumber", "PPI", "Millwork", "Index (1982=100)"),
    ("WPU087101", "lumber", "PPI", "Treated Wood", "Index (1982=100)"),
    ("WPU08490301", "lumber", "PPI", "Shingles and Shakes", "Index (1982=100)"),
    # Metals
    ("PCU331331", "metal", "PPI", "Steel", "Index (1982=100)"),
    ("WPU1074051", "metal", "PPI", "Rebar", "Index (1982=100)"),
    ("PCU331314331314", "metal", "PPI", "Aluminum", "Index (1982=100)"),
    ("WPU10250201", "metal", "PPI", "Copper & Brass", "Index (1982=100)"),
    # Construction
    ("PCU32733273", "construction", "PPI", "Cement & Concrete", "Index (Dec 2003=100)"),
    ("PCU3274203274201", "construction", "PPI", "Gypsum", "Index (1982=100)"),
    ("WPU072106033", "construction", "PPI", "PVC", "Index (1982=100)"),
    ("WPUSI012011", "construction", "PPI", "Construction Materials Index", "Index (1982=100)"),
    # Housing - Starts & Permits
    ("HOUSTNE", "housing", "Housing Starts", "Housing Starts - Northeast", "Thousands (SAAR)"),
    ("HOUSTMW", "housing", "Housing Starts", "Housing Starts - Midwest", "Thousands (SAAR)"),
    ("HOUSTS", "housing", "Housing Starts", "Housing Starts - South", "Thousands (SAAR)"),
    ("HOUSTW", "housing", "Housing Starts", "Housing Starts - West", "Thousands (SAAR)"),
    ("PERMITNE", "housing", "Building Permits", "Building Permits - Northeast", "Thousands (SAAR)"),
    ("PERMITMW", "housing", "Building Permits", "Building Permits - Midwest", "Thousands (SAAR)"),
    ("PERMITS", "housing", "Building Permits", "Building Permits - South", "Thousands (SAAR)"),
    ("PERMITW", "housing", "Building Permits", "Building Permits - West", "Thousands (SAAR)"),
    # Housing - Sales
    ("HSNEN", "housing", "New Home Sales", "New Home Sales - Northeast", "Thousands (SAAR)"),
    ("HSNMW", "housing", "New Home Sales", "New Home Sales - Midwest", "Thousands (SAAR)"),
    ("HSNS", "housing", "New Home Sales", "New Home Sales - South", "Thousands (SAAR)"),
    ("HSNW", "housing", "New Home Sales", "New Home Sales - West", "Thousands (SAAR)"),
    ("EXHOSLUSNE", "housing", "Existing Home Sales", "Existing Home Sales - Northeast", "Thousands (SAAR)"),
    ("EXHOSLUSMW", "housing", "Existing Home Sales", "Existing Home Sales - Midwest", "Thousands (SAAR)"),
    ("EXHOSLUSS", "housing", "Existing Home Sales", "Existing Home Sales - South", "Thousands (SAAR)"),
    ("EXHOSLUSW", "housing", "Existing Home Sales", "Existing Home Sales - West", "Thousands (SAAR)"),
    # Housing - Inventory
    ("HSFSN", "housing", "Inventory", "New Homes for Sale", "Thousands"),
    ("EXHOSINVNE", "housing", "Inventory", "Existing Homes for Sale - Northeast", "Thousands"),
    ("EXHOSINVMW", "housing", "Inventory", "Existing Homes for Sale - Midwest", "Thousands"),
    ("EXHOSINVS", "housing", "Inventory", "Existing Homes for Sale - South", "Thousands"),
    ("EXHOSINVW", "housing", "Inventory", "Existing Homes for Sale - West", "Thousands"),
    ("MSACSR", "housing", "Inventory", "Months Supply of New Houses", "Months"),
    # Housing - Prices & Rates
    ("MSPN", "housing", "Prices", "Median Price - New Houses", "USD"),
    ("HOSMEDUSM052N", "housing", "Prices", "Median Price - Existing Houses", "USD"),
    ("MORTGAGE30US", "housing", "Mortgage Rates", "30-Year Fixed Mortgage Rate", "Percent"),
    ("DTB3", "housing", "Treasury", "3-Month Treasury Bill", "Percent"),
]


def fetch_fred_latest(series_id):
    """
    Fetch latest observation from FRED. Returns (value, date) or (None, None).
    """
    if not FRED_API_KEY:
        return None, None
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=1"
    )
    try:
        r = requests.get(url, timeout=15)
        if r.status_code != 200:
            print(f"[FRED] {series_id}: status {r.status_code}")
            return None, None
        data = r.json()
        obs = data.get("observations", [])
        if not obs:
            return None, None
        o = obs[0]
        val = o.get("value")
        if val in ("", None, "."):
            return None, None
        return float(val), o.get("date")
    except Exception as e:
        print(f"[FRED] {series_id}: {e}")
        return None, None


def build_payload():
    """Build list of commodity records from FRED."""
    payload = []
    for i, (series_id, material, subcategory, product, unit) in enumerate(FRED_SERIES):
        if i > 0:
            time.sleep(0.2)  # Rate limit: ~5 req/sec for FRED
        value, date_str = fetch_fred_latest(series_id)
        if value is None or not date_str:
            continue
        payload.append({
            "material": material,
            "subcategory": subcategory,
            "product": product,
            "date": date_str,
            "value": value,
            "unit": unit,
            "source": "FRED",
        })
    return payload


def push_to_stoagroup(payload):
    """POST payload to stoagroupDB API ingest endpoint."""
    if not STOAGROUP_API_URL:
        print("[SKIP] STOAGROUP_API_URL not set. Skipping push.")
        return False
    if not payload:
        print("[WARNING] Empty payload, nothing to push.")
        return False
    url = f"{STOAGROUP_API_URL}/api/commodities/ingest"
    headers = {"Content-Type": "application/json"}
    if COMMODITIES_INGEST_KEY:
        headers["X-Commodities-Ingest-Key"] = COMMODITIES_INGEST_KEY
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=60)
        print(f"[API] Status: {r.status_code}, Response: {r.text[:200]}")
        if r.status_code in (200, 201):
            print(f"[SUCCESS] Pushed {len(payload)} records to stoagroupDB")
            return True
        return False
    except Exception as e:
        print(f"[ERROR] Push failed: {e}")
        return False


def main():
    print("=" * 60)
    print("Commodities Tracker - Free sources (FRED only)")
    print("=" * 60)
    payload = build_payload()
    print(f"\nCollected {len(payload)} records from FRED")
    if payload:
        by_material = {}
        for r in payload:
            m = r.get("material", "unknown")
            by_material[m] = by_material.get(m, 0) + 1
        for m, c in sorted(by_material.items()):
            print(f"  {m}: {c}")
        print(f"\nSample: {json.dumps(payload[0], indent=2)}")
    success = push_to_stoagroup(payload)
    if not success and payload and STOAGROUP_API_URL:
        print("[WARNING] Data collected but push failed. Check STOAGROUP_API_URL and COMMODITIES_INGEST_KEY.")
        if ALLOW_INGEST_FAILURE:
            print("[WARNING] ALLOW_INGEST_FAILURE is enabled; finishing run without failing workflow.")
        else:
            exit(1)
    if not payload:
        print("[ERROR] No data collected. Check FRED_API_KEY.")
        exit(1)
    print("=" * 60)
    print("[DONE] Commodities tracker finished")


if __name__ == "__main__":
    main()
