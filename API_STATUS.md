# API Status & Configuration Notes

## Current Status

### ✅ Working APIs
- **FRED - Cement PPI**: Series ID `PCU3274203274201` is working correctly
  - Latest value: 363.747 (as of 2025-09-01)
  - Unit: Index (base year = 100)

### ⚠️ Issues to Resolve

#### 1. Metals-API (Aluminum, Copper, Steel)
**Status**: Symbols not recognized
**Error**: "One or more invalid symbols have been specified"

**Attempted Symbols**:
- `ALUMINUM, COPPER, STEEL` - Invalid
- `XAL, XCU` - Invalid

**Action Needed**:
- Check Metals-API documentation for correct symbol format
- May need to use LME (London Metal Exchange) symbols like `LME-XCU`
- Verify API key has access to base metals (may require subscription tier)
- Alternative: Check if Metals-API supports these metals or if different API needed

#### 2. Financial Modeling Prep (Lumber Futures - LB)
**Status**: Legacy endpoint, requires subscription
**Error**: "Legacy Endpoint : Due to Legacy endpoints being no longer supported"

**Action Needed**:
- Upgrade FMP subscription to access legacy endpoints
- OR find alternative API for lumber futures
- OR use different endpoint if available in new API version

#### 3. FRED - PVC and Gypsum PPI
**Status**: Series IDs don't exist
**Errors**:
- `WPU06310209` (PVC): "The series does not exist"
- `PCU3274103274101` (Gypsum): "The series does not exist"

**Action Needed**:
- Search FRED database for correct PVC resin PPI series ID
- Search FRED database for correct gypsum/wallboard products PPI series ID
- Visit: https://fred.stlouisfed.org/ and search for these commodities

## Data Structure

All records now include a `unit` field:
- **Metals**: "USD per metric ton"
- **Lumber**: "USD per 1000 board feet"
- **PPI**: "Index (base year = 100)"

## Enhanced Logging

The script now includes detailed logging:
- API response status codes
- Full API responses (first 500 chars)
- Parsed values
- Error messages with details

Run the script to see exactly what each API is returning.

