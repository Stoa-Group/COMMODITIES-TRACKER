"""
Historical Data Uploader for Commodities Tracker - Free sources only.
Fetches historical FRED data (full date range per series) and pushes to stoagroupDB API.
Uses FRED observations API with observation_start/observation_end for efficient bulk fetch.

Usage:
    python historical_uploader.py --start-date 2020-01-01 --end-date 2025-02-28
    python historical_uploader.py --years 3   # Last 3 years
    python historical_uploader.py --dry-run   # Fetch only, no DB write
"""

import requests
import json
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
import argparse

load_dotenv()


def get_env_var(key, default=None):
    value = os.getenv(key, default)
    if value and isinstance(value, str):
        value = value.strip('"').strip("'")
    return value


FRED_API_KEY = get_env_var("FRED_API_KEY")
STOAGROUP_API_URL = get_env_var("STOAGROUP_API_URL", "").rstrip("/")
COMMODITIES_INGEST_KEY = get_env_var("COMMODITIES_INGEST_KEY")

# Same FRED series as commodities_tracker.py
FRED_SERIES = [
    ("WPU081", "lumber", "PPI", "Lumber", "Index (1982=100)"),
    ("WPU08110701", "lumber", "PPI", "Softwood Lumber", "Index (1982=100)"),
    ("WPU081106013", "lumber", "PPI", "Softwood 2\" Dimension", "Index (1982=100)"),
    ("WPU081106014", "lumber", "PPI", "Softwood Timbers", "Index (1982=100)"),
    ("WPU0812", "lumber", "PPI", "Hardwood Lumber", "Index (1982=100)"),
    ("WPU081204", "lumber", "PPI", "Hardwood Flooring", "Index (1982=100)"),
    ("WPU083", "lumber", "PPI", "Plywood", "Index (1982=100)"),
    ("WPU083103035", "lumber", "PPI", "Softwood Plywood", "Index (1982=100)"),
    ("WPU09220124", "lumber", "PPI", "OSB/Waferboard", "Index (1982=100)"),
    ("WPU09220125", "lumber", "PPI", "Particleboard", "Index (1982=100)"),
    ("WPU09220141", "lumber", "PPI", "MDF", "Index (1982=100)"),
    ("WPU08210162", "lumber", "PPI", "Wood Moldings", "Index (1982=100)"),
    ("WPU082", "lumber", "PPI", "Millwork", "Index (1982=100)"),
    ("WPU087101", "lumber", "PPI", "Treated Wood", "Index (1982=100)"),
    ("WPU08490301", "lumber", "PPI", "Shingles and Shakes", "Index (1982=100)"),
    ("PCU331331", "metal", "PPI", "Steel", "Index (1982=100)"),
    ("WPU1074051", "metal", "PPI", "Rebar", "Index (1982=100)"),
    ("PCU331314331314", "metal", "PPI", "Aluminum", "Index (1982=100)"),
    ("WPU10250201", "metal", "PPI", "Copper & Brass", "Index (1982=100)"),
    ("PCU32733273", "construction", "PPI", "Cement & Concrete", "Index (Dec 2003=100)"),
    ("PCU3274203274201", "construction", "PPI", "Gypsum", "Index (1982=100)"),
    ("WPU072106033", "construction", "PPI", "PVC", "Index (1982=100)"),
    ("WPUSI012011", "construction", "PPI", "Construction Materials Index", "Index (1982=100)"),
    ("HOUSTNE", "housing", "Housing Starts", "Housing Starts - Northeast", "Thousands (SAAR)"),
    ("HOUSTMW", "housing", "Housing Starts", "Housing Starts - Midwest", "Thousands (SAAR)"),
    ("HOUSTS", "housing", "Housing Starts", "Housing Starts - South", "Thousands (SAAR)"),
    ("HOUSTW", "housing", "Housing Starts", "Housing Starts - West", "Thousands (SAAR)"),
    ("PERMITNE", "housing", "Building Permits", "Building Permits - Northeast", "Thousands (SAAR)"),
    ("PERMITMW", "housing", "Building Permits", "Building Permits - Midwest", "Thousands (SAAR)"),
    ("PERMITS", "housing", "Building Permits", "Building Permits - South", "Thousands (SAAR)"),
    ("PERMITW", "housing", "Building Permits", "Building Permits - West", "Thousands (SAAR)"),
    ("HSNEN", "housing", "New Home Sales", "New Home Sales - Northeast", "Thousands (SAAR)"),
    ("HSNMW", "housing", "New Home Sales", "New Home Sales - Midwest", "Thousands (SAAR)"),
    ("HSNS", "housing", "New Home Sales", "New Home Sales - South", "Thousands (SAAR)"),
    ("HSNW", "housing", "New Home Sales", "New Home Sales - West", "Thousands (SAAR)"),
    ("EXHOSLUSNE", "housing", "Existing Home Sales", "Existing Home Sales - Northeast", "Thousands (SAAR)"),
    ("EXHOSLUSMW", "housing", "Existing Home Sales", "Existing Home Sales - Midwest", "Thousands (SAAR)"),
    ("EXHOSLUSS", "housing", "Existing Home Sales", "Existing Home Sales - South", "Thousands (SAAR)"),
    ("EXHOSLUSW", "housing", "Existing Home Sales", "Existing Home Sales - West", "Thousands (SAAR)"),
    ("HSFSN", "housing", "Inventory", "New Homes for Sale", "Thousands"),
    ("EXHOSINVNE", "housing", "Inventory", "Existing Homes for Sale - Northeast", "Thousands"),
    ("EXHOSINVMW", "housing", "Inventory", "Existing Homes for Sale - Midwest", "Thousands"),
    ("EXHOSINVS", "housing", "Inventory", "Existing Homes for Sale - South", "Thousands"),
    ("EXHOSINVW", "housing", "Inventory", "Existing Homes for Sale - West", "Thousands"),
    ("MSACSR", "housing", "Inventory", "Months' Supply of New Houses", "Months"),
    ("MSPN", "housing", "Prices", "Median Price - New Houses", "USD"),
    ("HOSMEDUSM052N", "housing", "Prices", "Median Price - Existing Houses", "USD"),
    ("MORTGAGE30US", "housing", "Mortgage Rates", "30-Year Fixed Mortgage Rate", "Percent"),
    ("DTB3", "housing", "Treasury", "3-Month Treasury Bill", "Percent"),
]

BATCH_SIZE = 500
API_DELAY = 0.3


def fetch_fred_observations(series_id, start_date, end_date):
    """Fetch all FRED observations in date range. Returns list of (date_str, value)."""
    if not FRED_API_KEY:
        return []
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json"
        f"&observation_start={start_date}&observation_end={end_date}&sort_order=asc"
    )
    try:
        r = requests.get(url, timeout=30)
        if r.status_code != 200:
            return []
        data = r.json()
        obs = data.get("observations", [])
        out = []
        for o in obs:
            val = o.get("value")
            if val in ("", None, "."):
                continue
            try:
                out.append((o.get("date"), float(val)))
            except (TypeError, ValueError):
                pass
        return out
    except Exception as e:
        print(f"  [FRED] {series_id}: {e}")
        return []


def build_historical_payload(start_date, end_date):
    """Fetch all FRED series for date range and build flat list of records."""
    payload = []
    for i, (series_id, material, subcategory, product, unit) in enumerate(FRED_SERIES):
        if i > 0:
            time.sleep(API_DELAY)
        obs = fetch_fred_observations(series_id, start_date, end_date)
        for date_str, value in obs:
            if not date_str:
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
        if obs:
            print(f"  {product}: {len(obs)} observations")
    return payload


def push_to_stoagroup(payload, dry_run=False):
    """POST payload to stoagroupDB in batches. Returns (success, total_pushed)."""
    if dry_run or not STOAGROUP_API_URL:
        return True, 0
    if not payload:
        return True, 0
    base = STOAGROUP_API_URL.rstrip("/")
    url = f"{base}/api/commodities/ingest"
    headers = {"Content-Type": "application/json"}
    if COMMODITIES_INGEST_KEY:
        headers["X-Commodities-Ingest-Key"] = COMMODITIES_INGEST_KEY
    total = 0
    for i in range(0, len(payload), BATCH_SIZE):
        chunk = payload[i : i + BATCH_SIZE]
        try:
            r = requests.post(url, json=chunk, headers=headers, timeout=90)
            if r.status_code in (200, 201):
                total += len(chunk)
            else:
                print(f"[ERROR] Ingest batch failed: {r.status_code} {r.text[:300]}")
                if r.status_code == 404:
                    print("[HINT] 404 = commodities route not found. Ensure stoagroupDB API is deployed "
                          "with commodities routes and STOAGROUP_API_URL is the base only (no /api suffix).")
                elif r.status_code == 500:
                    print("[HINT] 500 = server error. Usually means the commodities schema is missing. "
                          "Run schema/create_commodities_schema.sql on your production database (Azure/SSMS).")
                return False, total
        except Exception as e:
            print(f"[ERROR] Ingest failed: {e}")
            return False, total
        time.sleep(0.5)
    return True, total


def main():
    parser = argparse.ArgumentParser(description="Backfill historical commodities data to stoagroupDB")
    parser.add_argument("--start-date", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--years", type=int, default=3, help="Years back from today (default: 3)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch only, do not push to API")
    args = parser.parse_args()

    end = datetime.now()
    if args.start_date and args.end_date:
        start = datetime.strptime(args.start_date, "%Y-%m-%d")
        end = datetime.strptime(args.end_date, "%Y-%m-%d")
    else:
        start = end - timedelta(days=args.years * 365)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    print("=" * 60)
    print("Historical Commodities Backfill - FRED only")
    print("=" * 60)
    print(f"Date range: {start_str} to {end_str}")
    print(f"Dry run: {args.dry_run}")
    if not args.dry_run and STOAGROUP_API_URL:
        print(f"Target: {STOAGROUP_API_URL}/api/commodities/ingest")
    elif not STOAGROUP_API_URL:
        print("[WARNING] STOAGROUP_API_URL not set. Use --dry-run to fetch only.")
    print("=" * 60)

    if not FRED_API_KEY:
        print("[ERROR] FRED_API_KEY required.")
        exit(1)

    print("\nFetching FRED data...")
    payload = build_historical_payload(start_str, end_str)
    print(f"\nCollected {len(payload)} records")

    if not payload:
        print("[WARNING] No data collected. Check series IDs and date range.")
        exit(0)

    if args.dry_run:
        print(f"[DRY RUN] Would push {len(payload)} records. Skipping.")
        with open("historical_upload_results.json", "w") as f:
            json.dump({"dry_run": True, "count": len(payload), "sample": payload[:5]}, f, indent=2)
        exit(0)

    ok, count = push_to_stoagroup(payload, dry_run=False)
    if ok:
        print(f"\n[SUCCESS] Pushed {count} records to stoagroupDB")
    else:
        print("\n[FAILED] Some records may not have been pushed.")
        exit(1)


if __name__ == "__main__":
    main()
