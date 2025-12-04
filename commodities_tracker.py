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
DOMO_WEBHOOK_URL = os.getenv(
    "DOMO_WEBHOOK_URL",
    "https://stoagroup.domo.com/api/iot/v1/webhook/data/eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NjQ4NzAzNzUsInN0cmVhbSI6IjkyNDE0M2Q4NGY4NzRmMTZiYzU3MWQ1OWY5NTc5Y2FiOm1tbW0tMDA0NC0wNTc0OjUyMzIwNTM5NSJ9.zK49RWVpC4DDCIF6gHHOYY1LcwZ2CGqef_PJCiwsDUk"
)

FRED_API_KEY = os.getenv("FRED_API_KEY")
FMP_API_KEY = os.getenv("FMP_API_KEY")
METALS_API_KEY = os.getenv("METALS_API_KEY")

today = datetime.now().strftime("%Y-%m-%d")


# ------------------------------------------------
# API FETCH FUNCTIONS
# ------------------------------------------------
def fetch_metals():
    """
    Calls Metals-API /latest
    Bundles symbols in one request
    Returns dict: { "aluminum": float|None, "copper": float|None, "steel": float|None }
    """
    if not METALS_API_KEY:
        print("Warning: METALS_API_KEY not found, skipping metals fetch")
        return {"aluminum": None, "copper": None, "steel": None}
    
    url = (
        f"https://metals-api.com/api/latest?"
        f"access_key={METALS_API_KEY}&base=USD&symbols=ALUMINUM,COPPER,STEEL"
    )
    
    try:
        r = requests.get(url, timeout=10)
        data = r.json()
        
        if not data.get("success", False):
            error_info = data.get("error", {}).get("info", "Unknown error")
            print(f"Metals-API error: {error_info}")
            return {"aluminum": None, "copper": None, "steel": None}
        
        rates = data.get("rates", {})
        
        return {
            "aluminum": float(rates.get("ALUMINUM")) if rates.get("ALUMINUM") else None,
            "copper": float(rates.get("COPPER")) if rates.get("COPPER") else None,
            "steel": float(rates.get("STEEL")) if rates.get("STEEL") else None
        }
    except Exception as e:
        print(f"Metals-API exception: {str(e)}")
        return {"aluminum": None, "copper": None, "steel": None}


def fetch_lumber_futures():
    """
    Calls FMP /quote/LB
    Returns price or None
    """
    if not FMP_API_KEY:
        print("Warning: FMP_API_KEY not found, skipping lumber futures fetch")
        return None
    
    url = f"https://financialmodelingprep.com/api/v3/quote/LB?apikey={FMP_API_KEY}"
    
    try:
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            print(f"FMP API error: Status {r.status_code}")
            return None
        
        data = r.json()
        if not data or len(data) == 0:
            print("FMP API: Empty response for LB")
            return None
        
        price = data[0].get("price")
        if price is None:
            return None
        
        return float(price)
    except Exception as e:
        print(f"FMP API exception: {str(e)}")
        return None


def fetch_fred_series(series_id):
    """
    Returns latest observation value or None
    """
    if not FRED_API_KEY:
        print(f"Warning: FRED_API_KEY not found, skipping FRED series {series_id}")
        return None
    
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json&sort_order=desc"
    )
    
    try:
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            print(f"FRED API error for {series_id}: Status {r.status_code}")
            return None
        
        data = r.json().get("observations", [])
        if not data:
            print(f"FRED API: No observations for {series_id}")
            return None
        
        # Last entry is most recent (sort_order=desc means first is latest, but we check all)
        latest = data[0]  # First entry is latest with sort_order=desc
        value = latest.get("value")
        
        if value in ("", None, "."):
            return None
        
        return float(value)
    except Exception as e:
        print(f"FRED API exception for {series_id}: {str(e)}")
        return None


# ------------------------------------------------
# DATA BUILDING FUNCTIONS
# ------------------------------------------------
def build_payload():
    """
    Converts metals → structured rows
    Converts lumber futures → structured row
    Converts FRED values → structured rows
    Final output is a list of dicts, JSON-serializable
    """
    payload = []
    
    # Fetch all data
    metals = fetch_metals()
    lumber_price = fetch_lumber_futures()
    
    # Metals - Base Metals subcategory
    metal_mapping = {
        "aluminum": "Aluminum",
        "copper": "Copper",
        "steel": "Steel"
    }
    
    for metal_key, metal_name in metal_mapping.items():
        payload.append({
            "material": "metal",
            "subcategory": "Base Metals",
            "product": metal_name,
            "date": today,
            "value": metals.get(metal_key),
            "source": "Metals-API"
        })
    
    # Lumber Futures - CME Futures subcategory
    payload.append({
        "material": "lumber",
        "subcategory": "CME Futures",
        "product": "LB",
        "date": today,
        "value": lumber_price,
        "source": "FMP"
    })
    
    # Construction Commodities - PPI subcategory
    ppi_series = {
        "Cement": "PCU3274203274201",
        "PVC": "WPU06310209",
        "Gypsum": "PCU3274103274101"
    }
    
    for product_name, series_id in ppi_series.items():
        value = fetch_fred_series(series_id)
        payload.append({
            "material": "construction",
            "subcategory": "PPI",
            "product": product_name,
            "date": today,
            "value": value,
            "source": "FRED"
        })
    
    return payload


def push_to_domo(payload):
    """
    POSTs the full JSON array
    Endpoint: DOMO_WEBHOOK_URL
    Headers: Content-Type: application/json
    Push mode: full replace
    """
    print(f"Uploading {len(payload)} records to Domo…")
    
    headers = {"Content-Type": "application/json"}
    
    try:
        response = requests.post(
            DOMO_WEBHOOK_URL,
            data=json.dumps(payload),
            headers=headers,
            timeout=30
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        
        if response.status_code == 200:
            print("✓ Successfully sent data to Domo")
            return True
        else:
            print(f"✗ Failed to send data to Domo (Status: {response.status_code})")
            return False
    except Exception as e:
        print(f"✗ Exception sending to Domo: {str(e)}")
        return False


def main():
    """
    Main execution function
    """
    print("=" * 60)
    print("Commodities Tracker - Starting data collection")
    print("=" * 60)
    
    # Build the complete payload
    payload = build_payload()
    
    # Print summary
    print(f"\nDataset summary:")
    print(f"  Total records: {len(payload)}")
    
    # Count by material type
    material_counts = {}
    for record in payload:
        material = record.get("material", "unknown")
        material_counts[material] = material_counts.get(material, 0) + 1
    
    for material, count in material_counts.items():
        print(f"  {material}: {count} records")
    
    # Count records with values
    records_with_values = sum(1 for r in payload if r.get("value") is not None)
    print(f"  Records with values: {records_with_values}")
    print(f"  Records with null values: {len(payload) - records_with_values}")
    
    # Show sample of records with values
    records_with_data = [r for r in payload if r.get("value") is not None]
    if records_with_data:
        print(f"\nSample records with values:")
        for record in records_with_data[:5]:  # Show first 5
            print(f"  - {record.get('product')} ({record.get('subcategory')}): {record.get('value')}")
    
    # Show records without values
    records_without_data = [r for r in payload if r.get("value") is None]
    if records_without_data:
        print(f"\nRecords without values (API errors):")
        for record in records_without_data[:5]:  # Show first 5
            print(f"  - {record.get('product')} ({record.get('subcategory')}): value=None")
    
    # Print full JSON for debugging (first 3 records)
    print(f"\nFirst 3 records (JSON format):")
    print(json.dumps(payload[:3], indent=2))
    
    # Push to Domo
    print("\n" + "=" * 60)
    success = push_to_domo(payload)
    
    if success:
        print("=" * 60)
        print("✓ Process completed successfully")
    else:
        print("=" * 60)
        print("✗ Process completed with errors")
        exit(1)


if __name__ == "__main__":
    main()
