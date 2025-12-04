import requests
import json
from datetime import datetime
from dotenv import load_dotenv
import os

# Load environment variables from .env file (for local development)
# Note: In GitHub Actions, secrets are passed as environment variables
# and will take precedence over .env file values
load_dotenv()

# -----------------------------
# CONFIGURATION
# -----------------------------
# Get API keys and webhook URL from environment variables
# These are set from GitHub Secrets in CI/CD, or from .env file locally
DOMO_WEBHOOK_URL = os.getenv(
    "DOMO_WEBHOOK_URL",
    "https://stoagroup.domo.com/api/iot/v1/webhook/data/eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NjQ4NzAzNzUsInN0cmVhbSI6IjkyNDE0M2Q4NGY4NzRmMTZiYzU3MWQ1OWY5NTc5Y2FiOm1tbW0tMDA0NC0wNTc0OjUyMzIwNTM5NSJ9.zK49RWVpC4DDCIF6gHHOYY1LcwZ2CGqef_PJCiwsDUk"
)

FRED_API_KEY = os.getenv("FRED_API_KEY")
FMP_API_KEY = os.getenv("FMP_API_KEY")
METALS_API_KEY = os.getenv("METALS_API_KEY")

# Validate that required secrets are available (for GitHub Actions)
if not FRED_API_KEY:
    print("Warning: FRED_API_KEY not found in environment variables")
if not FMP_API_KEY:
    print("Warning: FMP_API_KEY not found in environment variables")
if not METALS_API_KEY:
    print("Warning: METALS_API_KEY not found in environment variables")
if not DOMO_WEBHOOK_URL:
    print("Warning: DOMO_WEBHOOK_URL not found in environment variables")

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
    
    # Metals-API uses LME (London Metal Exchange) symbols
    # Prices are per troy ounce - need to convert to metric ton
    # LME-ALU = Aluminum, LME-XCU = Copper
    url = (
        f"https://metals-api.com/api/latest?"
        f"access_key={METALS_API_KEY}&base=USD&symbols=LME-ALU,LME-XCU"
    )
    
    try:
        r = requests.get(url, timeout=10)
        print(f"Metals-API Response Status: {r.status_code}")
        data = r.json()
        print(f"Metals-API Response: {json.dumps(data, indent=2)[:500]}...")  # First 500 chars
        
        if not data.get("success", False):
            error_info = data.get("error", {}).get("info", "Unknown error")
            print(f"Metals-API error: {error_info}")
            return {"aluminum": None, "copper": None, "steel": None}
        
        rates = data.get("rates", {})
        print(f"Metals-API Rates: {rates}")
        
        # Metals-API returns prices per troy ounce
        # Convert to metric ton: 1 metric ton = 32,150.7 troy ounces
        TROY_OUNCES_PER_METRIC_TON = 32150.7
        
        # Extract prices and convert to metric tons
        aluminum_per_oz = rates.get("LME-ALU") or rates.get("ALUMINUM")
        copper_per_oz = rates.get("LME-XCU") or rates.get("COPPER")
        
        result = {
            "aluminum": float(aluminum_per_oz) * TROY_OUNCES_PER_METRIC_TON if aluminum_per_oz else None,
            "copper": float(copper_per_oz) * TROY_OUNCES_PER_METRIC_TON if copper_per_oz else None,
            "steel": None  # Steel not available through Metals-API LME symbols
        }
        print(f"Metals-API Parsed Values (converted to metric tons): {result}")
        return result
    except Exception as e:
        print(f"Metals-API exception: {str(e)}")
        import traceback
        traceback.print_exc()
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
        print(f"FMP API Response Status: {r.status_code}")
        if r.status_code != 200:
            print(f"FMP API error: Status {r.status_code}")
            print(f"FMP API Response: {r.text[:500]}")
            return None
        
        data = r.json()
        print(f"FMP API Response: {json.dumps(data, indent=2)[:500]}...")
        if not data or len(data) == 0:
            print("FMP API: Empty response for LB")
            return None
        
        price = data[0].get("price")
        print(f"FMP API Parsed Price: {price}")
        if price is None:
            return None
        
        return float(price)
    except Exception as e:
        print(f"FMP API exception: {str(e)}")
        import traceback
        traceback.print_exc()
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
        print(f"FRED API Response Status for {series_id}: {r.status_code}")
        if r.status_code != 200:
            print(f"FRED API error for {series_id}: Status {r.status_code}")
            print(f"FRED API Response: {r.text[:500]}")
            return None
        
        data = r.json()
        observations = data.get("observations", [])
        print(f"FRED API for {series_id}: Found {len(observations)} observations")
        if not observations:
            print(f"FRED API: No observations for {series_id}")
            return None
        
        # First entry is latest with sort_order=desc
        latest = observations[0]
        value = latest.get("value")
        date = latest.get("date")
        print(f"FRED API for {series_id}: Latest value on {date} = {value}")
        
        if value in ("", None, "."):
            return None
        
        return float(value)
    except Exception as e:
        print(f"FRED API exception for {series_id}: {str(e)}")
        import traceback
        traceback.print_exc()
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
    # Only add Aluminum and Copper if we have values from Metals-API
    if metals.get("aluminum") is not None:
        payload.append({
            "material": "metal",
            "subcategory": "Base Metals",
            "product": "Aluminum",
            "date": today,
            "value": metals.get("aluminum"),
            "unit": "USD per metric ton",
            "source": "Metals-API"
        })
    
    if metals.get("copper") is not None:
        payload.append({
            "material": "metal",
            "subcategory": "Base Metals",
            "product": "Copper",
            "date": today,
            "value": metals.get("copper"),
            "unit": "USD per metric ton",
            "source": "Metals-API"
        })
    
    # Lumber - Try FMP first, fallback to FRED PPI if FMP fails
    if lumber_price is not None:
        payload.append({
            "material": "lumber",
            "subcategory": "CME Futures",
            "product": "LB",
            "date": today,
            "value": lumber_price,
            "unit": "USD per 1000 board feet",
            "source": "FMP"
        })
    else:
        # Fallback to FRED Softwood Lumber PPI
        lumber_ppi = fetch_fred_series("WPU08110701")
        if lumber_ppi is not None:
            payload.append({
                "material": "lumber",
                "subcategory": "PPI",
                "product": "Softwood Lumber",
                "date": today,
                "value": lumber_ppi,
                "unit": "Index (base year = 100)",
                "source": "FRED"
            })
    
    # Construction Commodities - PPI subcategory
    # Cement series ID: PCU3274203274201
    # Note: Gypsum also uses PCU3274203274201 (same as Cement - Cement Manufacturing PPI)
    ppi_series = {
        "Cement": "PCU3274203274201",
    }
    
    # PVC - Resin / PVC product price/trend
    # Using WPU072106033 as specified
    pvc_value = fetch_fred_series("WPU072106033")
    if pvc_value is not None:
        payload.append({
            "material": "construction",
            "subcategory": "PPI",
            "product": "PVC",
            "date": today,
            "value": pvc_value,
            "unit": "Index (base year = 100)",
            "source": "FRED"
        })
    
    # Gypsum - Gypsum product manufacturing price/trend
    # Using PCU3274203274201 as specified
    gypsum_value = fetch_fred_series("PCU3274203274201")
    if gypsum_value is not None:
        payload.append({
            "material": "construction",
            "subcategory": "PPI",
            "product": "Gypsum",
            "date": today,
            "value": gypsum_value,
            "unit": "Index (base year = 100)",
            "source": "FRED"
        })
    
    for product_name, series_id in ppi_series.items():
        value = fetch_fred_series(series_id)
        if value is not None:
            payload.append({
                "material": "construction",
                "subcategory": "PPI",
                "product": product_name,
                "date": today,
                "value": value,
                "unit": "Index (base year = 100)",
                "source": "FRED"
            })
    
    # Steel - Use FRED PPI (Metals-API doesn't have steel)
    steel_ppi = fetch_fred_series("PCU331331")  # Steel product manufacturing PPI
    if steel_ppi is not None:
        payload.append({
            "material": "metal",
            "subcategory": "PPI",
            "product": "Steel",
            "date": today,
            "value": steel_ppi,
            "unit": "Index (base year = 100)",
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
