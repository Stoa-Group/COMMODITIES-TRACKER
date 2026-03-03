/*
 * STOA Commodities and Housing Market Trends Dashboard - Advanced Analytics App
 * Features: Apple-level UI, Meta-level analytics, real-time updates
 * Data fetching pattern optimized for Domo platform
 */

// ============================================
// GLOBAL STATE & CONFIGURATION
// ============================================
const AppState = {
    commodities: [],
    filteredCommodities: [],
    historicalData: {}, // Store historical data for trend analysis
    rawData: [], // Store raw data from Domo
    filters: {
        search: '',
        material: 'all',
        sortBy: 'value', // Default sort by value
        sortOrder: 'desc',
        showNotableOnly: true // Overview shows notable trends by default
    },
    dataMaxDate: null, // Max date in dataset (data through X)
    viewMode: 'grid',
    selectedCommodity: null,
    lastUpdate: null,
    chart: null,
    detailChart: null,
    materialComparisonChart: null,
    analytics: null,
    isLoading: false,
    chartState: {
        primaryCommodity: null, // Currently selected commodity
        comparedCommodities: [] // Array of commodities being compared
    }
};

/**
 * Commodity type configs - how each type is measured, what to gauge, and labels
 * Used for self-explanatory detail pages
 */
const COMMODITY_TYPE_CONFIG = {
    mortgage: {
        primaryLabel: 'Rate',
        valueLabel: 'Current Rate',
        changeLabel: 'Rate Change',
        unitExplanation: 'Annual percentage rate (APR) for conventional mortgages. Some sources report in basis points (÷100 for %).',
        /** If raw value > 20, treat as basis points and display as percentage */
        valueTransform: (v) => (v > 20 ? v / 100 : v),
        howMeasured: 'Weekly national average from Freddie Mac Primary Mortgage Market Survey (PMMS). Reflects rates offered to prime borrowers with 20% down.',
        whatToGauge: 'Below 6% favors homebuyers; 6–7% is neutral; above 7% weighs on affordability and demand. Compare to 10-year Treasury for spread.',
        chartLabel: 'Mortgage Rate',
        maShortLabel: '3-Point MA',
        maMediumLabel: '6-Point MA',
        maLongLabel: '12-Point MA',
        periodPreset: 'monthly',
        insights: (a) => {
            const change30 = parseFloat(a.priceChanges?.change30d) || 0;
            const insights = [];
            const v = typeof a.currentValue === 'number' ? a.currentValue : parseFloat(a.currentValue);
            if (!isNaN(v)) {
                if (v < 6) insights.push('Rates below 6% support stronger buyer demand.');
                else if (v > 7) insights.push('Rates above 7% typically cool housing activity.');
                else insights.push('Rates in the 6–7% range are historically moderate.');
            }
            if (change30 < 0) insights.push('Declining rates improve affordability for new buyers.');
            else if (change30 > 0) insights.push('Rising rates can slow refinancing and purchase activity.');
            else insights.push('Rates have been stable recently.');
            return insights;
        }
    },
    housing: {
        primaryLabel: 'Value',
        valueLabel: 'Current Value',
        changeLabel: 'Change',
        unitExplanation: 'Varies by metric (SAAR = seasonally adjusted annual rate, etc.)',
        howMeasured: 'Data from Census Bureau, HUD, and FRED. Most series are seasonally adjusted. SAAR = monthly figure expressed as annual rate.',
        whatToGauge: 'Compare to prior months and year-ago levels. Housing starts/permits lead construction; sales reflect demand.',
        chartLabel: 'Value',
        maShortLabel: '3-Point MA',
        maMediumLabel: '6-Point MA',
        maLongLabel: '12-Point MA',
        periodPreset: 'monthly',
        insights: () => []
    },
    lumber: {
        primaryLabel: 'Price',
        valueLabel: 'Current Price',
        changeLabel: 'Price Change',
        unitExplanation: 'Per 1,000 board feet (MBF). Random Lengths composite or exchange-traded.',
        howMeasured: 'Cash market or futures settlement prices. Lumber is sensitive to housing starts and seasonal demand.',
        whatToGauge: 'Track vs. housing starts and permits. Sharp spikes often follow weather events or supply constraints.',
        chartLabel: 'Price',
        maShortLabel: '7-Day MA',
        maMediumLabel: '30-Day MA',
        maLongLabel: '90-Day MA',
        periodPreset: 'daily',
        insights: () => []
    },
    metal: {
        primaryLabel: 'Price',
        valueLabel: 'Current Price',
        changeLabel: 'Price Change',
        unitExplanation: 'Per ton or per lb, depending on metal. Exchange-traded (LME, COMEX).',
        howMeasured: 'Spot or futures settlement prices from major exchanges. Reflects global supply/demand.',
        whatToGauge: 'Metals drive construction costs. Copper tracks economic activity; steel follows industrial demand.',
        chartLabel: 'Price',
        maShortLabel: '7-Day MA',
        maMediumLabel: '30-Day MA',
        maLongLabel: '90-Day MA',
        periodPreset: 'daily',
        insights: () => []
    },
    construction: {
        primaryLabel: 'Price',
        valueLabel: 'Current Price',
        changeLabel: 'Price Change',
        unitExplanation: 'Varies by material (per ton, per unit, index points).',
        howMeasured: 'Producer price indices (PPI) or direct market prices. Construction inputs track materials and labor.',
        whatToGauge: 'Rising input costs pressure margins; falling costs can improve project economics.',
        chartLabel: 'Price',
        maShortLabel: '7-Day MA',
        maMediumLabel: '30-Day MA',
        maLongLabel: '90-Day MA',
        periodPreset: 'daily',
        insights: () => []
    },
    default: {
        primaryLabel: 'Price',
        valueLabel: 'Current Price',
        changeLabel: 'Price Change',
        unitExplanation: '',
        howMeasured: 'Market or survey data. Source varies by commodity.',
        whatToGauge: 'Compare to historical average and recent trend. Consider volatility.',
        chartLabel: 'Price',
        maShortLabel: '7-Day MA',
        maMediumLabel: '30-Day MA',
        maLongLabel: '90-Day MA',
        periodPreset: 'daily',
        insights: () => []
    }
};

function getCommodityTypeConfig(commodity) {
    const p = (commodity.product || '').toLowerCase();
    const s = (commodity.subcategory || '').toLowerCase();
    const m = (commodity.material || '').toLowerCase();
    if (s.includes('mortgage') || (p.includes('mortgage') && (p.includes('rate') || p.includes('fixed')))) return COMMODITY_TYPE_CONFIG.mortgage;
    if (s.includes('housing') || s.includes('starts') || s.includes('permits') || s.includes('sales')) return COMMODITY_TYPE_CONFIG.housing;
    if (m === 'lumber' || p.includes('lumber')) return COMMODITY_TYPE_CONFIG.lumber;
    if (m === 'metal' || p.includes('copper') || p.includes('steel') || p.includes('aluminum')) return COMMODITY_TYPE_CONFIG.metal;
    if (m === 'construction') return COMMODITY_TYPE_CONFIG.construction;
    return COMMODITY_TYPE_CONFIG.default;
}

/** Detect data frequency from records (avg days between points) */
function getDataFrequency(records) {
    if (!records || records.length < 2) return 'daily';
    const sorted = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));
    let totalDays = 0, count = 0;
    for (let i = 1; i < sorted.length; i++) {
        const d = (new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / (24 * 60 * 60 * 1000);
        if (d > 0 && d < 400) { totalDays += d; count++; }
    }
    const avgDays = count ? totalDays / count : 7;
    if (avgDays >= 20) return 'monthly';
    if (avgDays >= 4) return 'weekly';
    return 'daily';
}

// STOA Brand Colors
const STOAColors = {
    green: '#7e8a6b',
    green2: '#a6ad8a',
    grey: '#757270',
    blue: '#bdc2ce',
    grey2: '#efeff1',
    black: '#333333',
    accent: '#a6ad8a',
    success: '#4caf50',
    warning: '#ff9800',
    error: '#f44336',
    info: '#2196f3'
};

// ============================================
// DATA FETCHING - stoagroupDB API (primary)
// ============================================
// API base URL - set window.STOAGROUP_API_URL to override; auto-detect localhost for local dev
const STOAGROUP_API_URL = (typeof window !== 'undefined' && window.STOAGROUP_API_URL) ||
  (typeof window !== 'undefined' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location?.origin || '')
    ? 'http://localhost:3002' : 'https://stoagroupdb-ddre.onrender.com');

/**
 * Fetch commodities data from stoagroupDB API
 * @returns {Promise<Array>} Array of commodity records
 */
async function fetchCommoditiesFromAPI() {
    if (!STOAGROUP_API_URL) {
        throw new Error('STOAGROUP_API_URL not configured. Set window.STOAGROUP_API_URL or configure in app.');
    }
    const url = `${STOAGROUP_API_URL.replace(/\/$/, '')}/api/commodities?limit=10000`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

/**
 * Fetch data from Domo dataset (fallback - used when API URL not set)
 * @param {string} alias - Dataset alias from manifest.json
 * @returns {Promise<Array>} Array of data rows
 */
async function fetchAlias(alias) {
    const qs = new URLSearchParams();
    qs.set("limit", "10000");
    return domo.get(`/data/v2/${encodeURIComponent(alias)}?${qs.toString()}`);
}

// ============================================
// INITIALIZATION
// ============================================
// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

/**
 * Main initialization function
 * Sets up event listeners, loads data, and initializes charts
 */
function initializeApp() {
    console.log('[STOA Commodities] Initializing app...');
    
    // Require API URL (primary). Domo dataset only when explicitly configured and no API.
    const hasDomo = typeof domo !== 'undefined' && domo && typeof domo.get === 'function';
    const hasApiUrl = !!STOAGROUP_API_URL;
    if (!hasApiUrl && !hasDomo) {
        console.error('[STOA Commodities] Neither Domo SDK nor STOAGROUP_API_URL available');
        showAlert('Please configure STOAGROUP_API_URL (window.STOAGROUP_API_URL) for API data source.', 'error');
        renderErrorState();
        return;
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Load data (from API or Domo)
    loadCommoditiesData();
    
    // Initialize charts (will be populated when data loads)
    initializeCharts();
    
    // Setup auto-refresh (every 5 minutes)
    setInterval(() => {
        if (!AppState.isLoading) {
            loadCommoditiesData(true);
        }
    }, 300000); // 5 minutes
}

// ============================================
// DATA LOADING - Enhanced Pattern
// ============================================
/**
 * Load commodities data from stoagroupDB API (primary) or Domo dataset (fallback)
 * 
 * @param {boolean} silent - If true, don't show loading spinner (for auto-refresh)
 */
function loadCommoditiesData(silent = false) {
    // Require API URL or Domo
    const hasApi = !!STOAGROUP_API_URL;
    const hasDomo = typeof domo !== 'undefined' && domo && typeof domo.get === 'function';
    if (!hasApi && !hasDomo) {
        if (!silent) showAlert('No data source configured (STOAGROUP_API_URL or Domo dataset).', 'error');
        renderErrorState();
        return;
    }
    
    // Prevent concurrent loads
    if (AppState.isLoading) {
        console.log('[STOA Commodities] Data load already in progress, skipping...');
        return;
    }
    
    AppState.isLoading = true;
    
    if (!silent) {
        showLoadingState();
    }
    
    // Fetch from stoagroupDB API only (no Domo fallback)
    const fetchPromise = hasApi ? fetchCommoditiesFromAPI() : (hasDomo ? fetchAlias('commoditiesdata') : Promise.reject(new Error('No data source configured')));
    fetchPromise
        .then(function(data) {
            console.log('[STOA Commodities] Raw data received:', data);
            console.log('[STOA Commodities] Data count:', data ? data.length : 0);
            
            // Validate data
            if (!data || !Array.isArray(data)) {
                throw new Error('Invalid data format received');
            }
            
            if (data.length === 0) {
                showAlert('No commodities data available. Run backfill or check data source.', 'warning');
                renderEmptyState();
                AppState.isLoading = false;
                hideLoadingState();
                return;
            }
            
            // Store raw data for analytics
            AppState.rawData = data;
            
            // Compute max date in dataset (data through X)
            let maxDate = null;
            data.forEach(item => {
                const d = item.date || item.Date;
                if (d) {
                    const parsed = new Date(d);
                    if (!isNaN(parsed.getTime()) && (!maxDate || parsed > maxDate)) {
                        maxDate = parsed;
                    }
                }
            });
            AppState.dataMaxDate = maxDate;
            
            // Process and normalize data
            AppState.commodities = processCommoditiesData(data);
            AppState.lastUpdate = new Date();
            
            // Calculate historical trends (compare with previous data if available)
            calculateHistoricalTrends();
            
            // Calculate comprehensive analytics (Meta-level)
            calculateAnalytics();
            
            // Render all UI components
            renderCommodities();
            renderMetrics();
            renderBreakdown();
            populateCommoditySelector(); // Populate chart commodity selector (for detail pages)
            // Don't render trend chart on main page - only on detail pages
            // renderTrendChart();
            // Hide housing indicators on all pages - only show on housing detail pages
            const housingSection = document.getElementById('housingSection');
            if (housingSection) {
                housingSection.style.display = 'none';
            }
            updateLastUpdateTime();
            
            AppState.isLoading = false;
            hideLoadingState();
            
            if (!silent) {
                showToast('Data refreshed successfully', 'success');
            }
            
            // Log analytics summary
            console.log('[STOA Commodities] Analytics:', AppState.analytics);
        })
        .catch(function(error) {
            console.error('[STOA Commodities] Error loading data:', error);
            console.error('[STOA Commodities] Error details:', {
                message: error.message,
                stack: error.stack,
                type: error.constructor.name
            });
            
            showAlert('Failed to load commodities data. Please try again.', 'error');
            AppState.isLoading = false;
            hideLoadingState();
            renderErrorState();
        });
}

/**
 * Process and normalize raw data from Domo
 * Groups commodities by product name and shows latest value with historical data
 * 
 * @param {Array} rawData - Raw data array from Domo
 * @returns {Array} Processed commodities array (one per unique product)
 */
function processCommoditiesData(rawData) {
    if (!rawData || !Array.isArray(rawData)) {
        return [];
    }
    
    // First, process all records and group by product name
    const productGroups = {};
    
    rawData.forEach((item, index) => {
        // Normalize keys (API uses lowercase; Domo may use PascalCase)
        const r = (k) => item[k] ?? item[k.charAt(0).toUpperCase() + k.slice(1)];
        const value = r('value') !== null && r('value') !== undefined && String(r('value')).trim() !== ''
            ? parseFloat(r('value'))
            : null;
        const unit = r('unit') || 'N/A';
        const dateRaw = r('date') ?? r('Date');
        const date = dateRaw ? (dateRaw instanceof Date ? dateRaw.toISOString().slice(0, 10) : String(dateRaw).slice(0, 10)) : new Date().toISOString().split('T')[0];
        const product = (r('product') || r('Product') || 'Unknown').toString().trim();
        
        // Initialize product group if it doesn't exist
        if (!productGroups[product]) {
            productGroups[product] = {
                product: product,
                material: (r('material') || r('Material') || 'unknown').toString().trim(),
                subcategory: (r('subcategory') || r('Subcategory') || 'unknown').toString().trim(),
                source: (r('source') || r('Source') || 'unknown').toString().trim(),
                unit: unit,
                records: [], // All historical records for this product
                latestRecord: null,
                latestDate: null,
                latestValue: null,
                historicalValues: [] // For trend calculation
            };
        }
        
        // Add this record to the product's history
        const processedRecord = {
            ...item,
            value: value,
            date: date,
            hasValue: value !== null && value !== undefined && value > 0
        };
        
        productGroups[product].records.push(processedRecord);
        
        // Track historical values for trend calculation
        if (value !== null && value !== undefined && value > 0) {
            productGroups[product].historicalValues.push({
                date: date,
                value: value
            });
        }
        
        // Update latest record if this is more recent
        if (!productGroups[product].latestDate || date > productGroups[product].latestDate) {
            productGroups[product].latestDate = date;
            productGroups[product].latestValue = value;
            productGroups[product].latestRecord = processedRecord;
            productGroups[product].unit = unit; // Use unit from latest record
        }
    });
    
    // Convert grouped data to array of unique products
    const groupedCommodities = Object.values(productGroups).map((group, index) => {
        const latest = group.latestRecord;
        const value = group.latestValue;
        const date = group.latestDate;
        
        // Calculate trend from historical data
        const trend = calculateTrendFromHistory(group.historicalValues, value);
        
        // Determine category and styling
        const category = getCategoryColor(group.material);
        const icon = getCommodityIcon(group.product);
        const priority = getPriority({ product: group.product, material: group.material });
        
        // Check for alerts (missing data, stale data, etc.)
        const alerts = checkAlerts(latest || {}, value, date);
        
        // Calculate price change indicators (use trend for meaningful comparison)
        const priceChange = calculatePriceChange({ ...(latest || {}), trend }, value);
        
        return {
            product: group.product,
            material: group.material,
            subcategory: group.subcategory,
            source: group.source,
            value: value,
            displayValue: formatValue(value, group.unit, group.material),
            unit: group.unit,
            date: date,
            trend: trend,
            priceChange: priceChange,
            category: category,
            icon: icon,
            priority: priority,
            alerts: alerts,
            hasValue: value !== null && value !== undefined && value > 0,
            historicalRecords: group.records, // Store all historical records
            recordCount: group.records.length, // Total number of records for this product
            index: index // For stable sorting
        };
    });
    
    // Sort by priority first, then by value (highest first), then by product name
    return groupedCommodities.sort((a, b) => {
        if (a.priority !== b.priority) {
            return b.priority - a.priority;
        }
        if (a.hasValue && b.hasValue) {
            return (b.value || 0) - (a.value || 0);
        }
        if (a.hasValue && !b.hasValue) {
            return -1;
        }
        if (!a.hasValue && b.hasValue) {
            return 1;
        }
        return a.product.localeCompare(b.product);
    });
}

/**
 * Calculate trend from historical values
 * Compares latest value with previous values to determine trend
 * 
 * @param {Array} historicalValues - Array of {date, value} objects
 * @param {number} currentValue - Current/latest value
 * @returns {Object} Trend object with direction, percentage, and value
 */
function calculateTrendFromHistory(historicalValues, currentValue) {
    if (!historicalValues || historicalValues.length < 2 || !currentValue) {
        return {
            direction: 'neutral',
            percentage: 0,
            value: 0,
            previousValue: null
        };
    }
    
    // Sort by date (oldest first)
    const sorted = [...historicalValues].sort((a, b) => a.date.localeCompare(b.date));
    
    // Get previous value (second to last, or compare with average of last few)
    // Use the value from 7 days ago if available, otherwise use the previous value
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - 7);
    const targetDateStr = targetDate.toISOString().split('T')[0];
    
    let previousValue = null;
    
    // Try to find value from 7 days ago
    for (let i = sorted.length - 2; i >= 0; i--) {
        if (sorted[i].date <= targetDateStr) {
            previousValue = sorted[i].value;
            break;
        }
    }
    
    // If no 7-day-ago value, use the second-to-last value
    if (!previousValue && sorted.length >= 2) {
        previousValue = sorted[sorted.length - 2].value;
    }
    
    if (previousValue && currentValue) {
        const change = currentValue - previousValue;
        const percentage = ((change / previousValue) * 100).toFixed(2);
        
        // Determine timeframe based on which value was used
        const latestDate = new Date(sorted[sorted.length - 1].date);
        const previousDate = previousValue === sorted[sorted.length - 2]?.value 
            ? new Date(sorted[sorted.length - 2].date)
            : new Date(targetDateStr);
        const daysDiff = Math.round((latestDate - previousDate) / (1000 * 60 * 60 * 24));
        const timeframe = daysDiff === 1 ? '1 day' : `${daysDiff} days`;
        
        return {
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
            percentage: Math.abs(parseFloat(percentage)),
            value: change,
            previousValue: previousValue,
            timeframe: timeframe
        };
    }
    
    return {
        direction: 'neutral',
        percentage: 0,
        value: 0,
        previousValue: previousValue,
        timeframe: '7 days'
    };
}

/**
 * Calculate trend for a commodity
 * Compares current value with historical data if available
 * NOTE: This function is now primarily used for backward compatibility.
 * The main trend calculation is done in calculateTrendFromHistory().
 * 
 * @param {Object} item - Commodity item
 * @param {number} currentValue - Current value
 * @returns {Object} Trend object with direction, percentage, and value
 */
function calculateTrend(item, currentValue) {
    // If we have historical data in AppState, use it
    if (AppState.historicalData && AppState.historicalData[item.product]) {
        const historical = AppState.historicalData[item.product];
        const previousValue = historical.previousValue;
        
        if (previousValue && currentValue) {
            const change = currentValue - previousValue;
            const percentage = ((change / previousValue) * 100).toFixed(2);
            
            return {
                direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
                percentage: Math.abs(parseFloat(percentage)),
                value: change,
                previousValue: previousValue
            };
        }
    }
    
    // Default: neutral trend
    return {
        direction: 'neutral',
        percentage: 0,
        value: 0,
        previousValue: null
    };
}

/**
 * Calculate price change indicator
 * Used for visual indicators in the UI
 * 
 * @param {Object} item - Commodity item
 * @param {number} value - Current value
 * @returns {Object} Price change object
 */
function calculatePriceChange(item, value) {
    if (!value || value === 0) {
        return {
            status: 'no-data',
            label: 'No Data',
            color: STOAColors.grey
        };
    }
    
    // Use trend when available; avoid mixing commodities via global avg
    if (item.trend && item.trend.direction !== 'neutral') {
        if (item.trend.direction === 'up') {
            return {
                status: 'high',
                label: 'Trending Up',
                color: STOAColors.warning
            };
        }
        return {
            status: 'low',
            label: 'Trending Down',
            color: STOAColors.success
        };
    }
    
    return {
        status: 'normal',
        label: 'Normal',
        color: STOAColors.info
    };
}

/**
 * Calculate historical trends by comparing current data with stored historical data
 * This enables trend indicators and change calculations
 */
function calculateHistoricalTrends() {
    // Store current values as historical for next comparison
    const currentHistorical = {};
    
    AppState.commodities.forEach(commodity => {
        if (commodity.hasValue) {
            if (!currentHistorical[commodity.product]) {
                currentHistorical[commodity.product] = {
                    values: [],
                    dates: []
                };
            }
            currentHistorical[commodity.product].values.push(commodity.value);
            currentHistorical[commodity.product].dates.push(commodity.date);
        }
    });
    
    // Update historical data
    Object.keys(currentHistorical).forEach(product => {
        const data = currentHistorical[product];
        if (data.values.length > 0) {
            const latestValue = data.values[data.values.length - 1];
            const previousValue = AppState.historicalData[product]?.previousValue || latestValue;
            
            AppState.historicalData[product] = {
                previousValue: previousValue,
                currentValue: latestValue,
                values: data.values,
                dates: data.dates
            };
        }
    });
}

/**
 * Get category color based on material type
 * 
 * @param {string} material - Material type
 * @returns {string} Color hex code
 */
function getCategoryColor(material) {
    const colors = {
        'metal': STOAColors.blue,
        'lumber': STOAColors.green,
        'construction': STOAColors.grey,
        'wood': STOAColors.green2
    };
    return colors[material?.toLowerCase()] || STOAColors.grey;
}

/**
 * Get icon for commodity product
 * 
 * @param {string} product - Product name
 * @returns {string} Emoji icon
 */
function getCommodityIcon(product) {
    const icons = {
        'Aluminum': '🔩',
        'Copper': '⚡',
        'Steel': '🏗️',
        'LB': '🪵',
        'Softwood Lumber': '🪵',
        'Cement': '🏛️',
        'PVC': '🧪',
        'Gypsum': '🧱'
    };
    
    // Try exact match first
    if (icons[product]) {
        return icons[product];
    }
    
    // Try partial match
    const productLower = product.toLowerCase();
    for (const [key, icon] of Object.entries(icons)) {
        if (productLower.includes(key.toLowerCase()) || key.toLowerCase().includes(productLower)) {
            return icon;
        }
    }
    
    return '📦'; // Default icon
}

/**
 * Get priority for sorting and display
 * Higher priority items appear first
 * 
 * @param {Object} item - Commodity item
 * @returns {number} Priority score
 */
function getPriority(item) {
    const priorities = {
        'metal': 3,
        'lumber': 2,
        'construction': 1
    };
    return priorities[item.material?.toLowerCase()] || 0;
}

/**
 * Check for alerts on a commodity
 * Identifies missing data, stale data, and other issues
 * 
 * @param {Object} item - Commodity item
 * @param {number} value - Current value
 * @param {string} date - Data date
 * @returns {Array} Array of alert objects
 */
function checkAlerts(item, value, date) {
    const alerts = [];
    
    // Check for missing values
    if (!value || value === 0) {
        alerts.push({
            type: 'warning',
            message: 'No price data available',
            icon: '⚠️',
            severity: 'medium'
        });
    }
    
    // Check for stale data (older than 7 days)
    if (date) {
        const dataDate = new Date(date);
        const daysOld = (new Date() - dataDate) / (1000 * 60 * 60 * 24);
        if (daysOld > 7) {
            alerts.push({
                type: 'error',
                message: `Data is ${Math.floor(daysOld)} days old`,
                icon: '⏰',
                severity: 'high'
            });
        } else if (daysOld > 3) {
            alerts.push({
                type: 'warning',
                message: `Data is ${Math.floor(daysOld)} days old`,
                icon: '⏱️',
                severity: 'medium'
            });
        }
    }
    
    // Check for extreme values (outliers)
    // Skip this check for housing metrics that shouldn't have price alerts
    const product = item.product || '';
    const subcategory = item.subcategory || '';
    const isHousingMetric = item.material === 'housing' || 
                            subcategory === 'Mortgage Rates' || 
                            subcategory === 'Treasury Bills' ||
                            subcategory === 'Inventory' ||
                            product.includes('Months\' Supply') ||
                            product.includes('Treasury') ||
                            product.includes('Mortgage');
    
    if (value && AppState.analytics && !isHousingMetric) {
        const avgValue = AppState.analytics.avgValue;
        const priceRanges = AppState.analytics.priceRanges;
        
        if (avgValue > 0 && priceRanges) {
            if (value > priceRanges.high * 1.5) {
                alerts.push({
                    type: 'warning',
                    message: 'Unusually high price',
                    icon: '📈',
                    severity: 'low'
                });
            } else if (value < priceRanges.low * 0.5 && value > 0) {
                alerts.push({
                    type: 'info',
                    message: 'Unusually low price',
                    icon: '📉',
                    severity: 'low'
                });
            }
        }
    }
    
    return alerts;
}

// ============================================
// ANALYTICS & CALCULATIONS - Meta-level
// ============================================
/**
 * Calculate comprehensive analytics (Meta-level)
 * Provides deep insights into commodity data
 */
function calculateAnalytics() {
    const commodities = AppState.commodities;
    const withValues = commodities.filter(c => c.hasValue);
    const withoutValues = commodities.filter(c => !c.hasValue);
    
    // Basic counts
    const total = commodities.length;
    const withDataCount = withValues.length;
    const withoutDataCount = withoutValues.length;
    const dataCoverage = total > 0 ? (withDataCount / total * 100).toFixed(1) : 0;
    
    // Value statistics
    const values = withValues.map(c => c.value);
    const avgValue = values.length > 0 
        ? values.reduce((sum, v) => sum + v, 0) / values.length 
        : 0;
    const minValue = values.length > 0 ? Math.min(...values) : 0;
    const maxValue = values.length > 0 ? Math.max(...values) : 0;
    const medianValue = values.length > 0 
        ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] 
        : 0;
    
    // Price ranges for classification
    const priceRanges = calculatePriceRanges(withValues);
    
    // Group by material
    const byMaterial = groupByMaterial(commodities);
    
    // Group by source
    const bySource = groupBySource(commodities);
    
    // Group by subcategory
    const bySubcategory = groupBySubcategory(commodities);
    
    // Trend analysis
    const trends = calculateTrendAnalysis(commodities);
    
    // Data quality metrics
    const dataQuality = {
        coverage: parseFloat(dataCoverage),
        completeness: calculateCompleteness(commodities),
        freshness: calculateFreshness(commodities),
        consistency: calculateConsistency(commodities)
    };
    
    // Store comprehensive analytics
    AppState.analytics = {
        // Basic metrics
        total: total,
        withValues: withDataCount,
        withoutValues: withoutDataCount,
        dataCoverage: dataCoverage,
        
        // Value statistics
        avgValue: avgValue,
        minValue: minValue,
        maxValue: maxValue,
        medianValue: medianValue,
        
        // Groupings
        byMaterial: byMaterial,
        bySource: bySource,
        bySubcategory: bySubcategory,
        
        // Analysis
        priceRanges: priceRanges,
        trends: trends,
        dataQuality: dataQuality
    };
}

/**
 * Group commodities by material type
 * 
 * @param {Array} commodities - Commodities array
 * @returns {Object} Grouped data by material
 */
function groupByMaterial(commodities) {
    const groups = {};
    commodities.forEach(c => {
        const material = c.material || 'unknown';
        if (!groups[material]) {
            groups[material] = { 
                count: 0, 
                total: 0, 
                items: [],
                withValues: 0,
                up: 0,
                down: 0
            };
        }
        groups[material].count++;
        if (c.hasValue) {
            groups[material].total += c.value;
            groups[material].withValues++;
            groups[material].items.push(c);
        }
        if (c.trend && c.trend.direction === 'up') groups[material].up++;
        if (c.trend && c.trend.direction === 'down') groups[material].down++;
    });
    
    return groups;
}

/**
 * Group commodities by data source
 * 
 * @param {Array} commodities - Commodities array
 * @returns {Object} Grouped data by source
 */
function groupBySource(commodities) {
    const groups = {};
    commodities.forEach(c => {
        const source = c.source || 'unknown';
        if (!groups[source]) {
            groups[source] = { count: 0, withValues: 0 };
        }
        groups[source].count++;
        if (c.hasValue) {
            groups[source].withValues++;
        }
    });
    return groups;
}

/**
 * Group commodities by subcategory
 * 
 * @param {Array} commodities - Commodities array
 * @returns {Object} Grouped data by subcategory
 */
function groupBySubcategory(commodities) {
    const groups = {};
    commodities.forEach(c => {
        const subcategory = c.subcategory || 'unknown';
        if (!groups[subcategory]) {
            groups[subcategory] = { count: 0, withValues: 0, items: [] };
        }
        groups[subcategory].count++;
        if (c.hasValue) {
            groups[subcategory].withValues++;
            groups[subcategory].items.push(c);
        }
    });
    return groups;
}

/**
 * Calculate price ranges for classification
 * 
 * @param {Array} commodities - Commodities with values
 * @returns {Object} Price range object
 */
function calculatePriceRanges(commodities) {
    if (commodities.length === 0) {
        return { low: 0, medium: 0, high: 0 };
    }
    
    const values = commodities.map(c => c.value).sort((a, b) => a - b);
    const low = values[Math.floor(values.length * 0.33)] || 0;
    const medium = values[Math.floor(values.length * 0.66)] || 0;
    const high = values[values.length - 1] || 0;
    
    return { low, medium, high };
}

/**
 * Calculate trend analysis across all commodities
 * Returns useful KPIs: up/down counts, top gainer/decliner, alerts
 * 
 * @param {Array} commodities - Commodities array
 * @returns {Object} Trend analysis
 */
function calculateTrendAnalysis(commodities) {
    const withTrends = commodities.filter(c => c.trend && c.trend.direction !== 'neutral');
    const upTrends = withTrends.filter(c => c.trend.direction === 'up');
    const downTrends = withTrends.filter(c => c.trend.direction === 'down');
    
    const topGainer = upTrends.length > 0
        ? upTrends.reduce((a, b) => (Math.abs(a.trend?.percentage || 0) >= Math.abs(b.trend?.percentage || 0) ? a : b))
        : null;
    const topDecliner = downTrends.length > 0
        ? downTrends.reduce((a, b) => (Math.abs(a.trend?.percentage || 0) >= Math.abs(b.trend?.percentage || 0) ? a : b))
        : null;
    
    const alertCount = commodities.filter(c => c.alerts && c.alerts.length > 0).length;
    
    return {
        up: upTrends.length,
        down: downTrends.length,
        neutral: commodities.length - upTrends.length - downTrends.length,
        total: commodities.length,
        topGainer: topGainer ? { product: topGainer.product, pct: topGainer.trend?.percentage || 0 } : null,
        topDecliner: topDecliner ? { product: topDecliner.product, pct: topDecliner.trend?.percentage || 0 } : null,
        alertCount
    };
}

/**
 * Calculate data completeness score
 * 
 * @param {Array} commodities - Commodities array
 * @returns {number} Completeness score (0-100)
 */
function calculateCompleteness(commodities) {
    if (commodities.length === 0) return 0;
    const withValues = commodities.filter(c => c.hasValue).length;
    return (withValues / commodities.length * 100).toFixed(1);
}

/**
 * Calculate data freshness score
 * 
 * @param {Array} commodities - Commodities array
 * @returns {number} Freshness score (0-100)
 */
function calculateFreshness(commodities) {
    if (commodities.length === 0) return 0;
    const now = new Date();
    let freshCount = 0;
    
    commodities.forEach(c => {
        if (c.date) {
            const dataDate = new Date(c.date);
            const daysOld = (now - dataDate) / (1000 * 60 * 60 * 24);
            if (daysOld <= 7) {
                freshCount++;
            }
        }
    });
    
    return (freshCount / commodities.length * 100).toFixed(1);
}

/**
 * Calculate data consistency score
 * 
 * @param {Array} commodities - Commodities array
 * @returns {number} Consistency score (0-100)
 */
function calculateConsistency(commodities) {
    // Simple consistency check: percentage of commodities with valid units
    if (commodities.length === 0) return 0;
    const withValidUnits = commodities.filter(c => c.unit && c.unit !== 'N/A').length;
    return (withValidUnits / commodities.length * 100).toFixed(1);
}

// ============================================
// RENDERING
// ============================================
/**
 * Render commodities grid/list
 * Displays commodities based on current filters and view mode
 */
function renderCommodities() {
    const container = document.getElementById('commoditiesContainer');
    if (!container) return;
    
    const data = getFilteredCommodities();
    const sectionTitle = document.getElementById('commoditiesSectionTitle');
    
    // Check if we're showing housing category summaries
    const isHousingCategories = AppState.filters.material === 'housing' && 
                                 !AppState.filters.search && 
                                 data.length > 0 && 
                                 data[0].category !== undefined;
    
    // Update Notable/All toggle state (hide for housing - it uses category grouping)
    const notableToggle = document.getElementById('notableToggle');
    if (notableToggle) {
        notableToggle.style.display = AppState.filters.material === 'housing' ? 'none' : '';
        notableToggle.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', String(btn.dataset.notable) === String(AppState.filters.showNotableOnly));
        });
    }
    
    // Update section title and description based on filter
    const sectionDescription = document.querySelector('#commoditiesSectionDescription');
    if (sectionTitle) {
        const showingNotable = AppState.filters.showNotableOnly && !AppState.filters.search && AppState.filters.material !== 'housing';
        if (AppState.filters.material === 'all' && !AppState.filters.search) {
            sectionTitle.textContent = showingNotable ? 'Significant Movers & Outliers' : 'All Commodities';
            if (sectionDescription) {
                sectionDescription.textContent = showingNotable 
                    ? 'Showing commodities with significant price changes, alerts, or outliers. Use filters or "All" to see everything.'
                    : 'Showing all commodities. Switch to "Notable" to focus on significant movers.';
            }
        } else if (AppState.filters.material === 'housing' && !AppState.filters.search) {
            sectionTitle.textContent = 'Housing Market Overview';
            if (sectionDescription) {
                sectionDescription.textContent = 'Housing data grouped by category. Click any category card to view detailed metrics and regional breakdowns.';
            }
        } else if (AppState.filters.search) {
            sectionTitle.textContent = 'Search Results';
            if (sectionDescription) {
                sectionDescription.textContent = 'Search results matching your query. Click any card for detailed analysis.';
            }
        } else {
            const materialName = AppState.filters.material.charAt(0).toUpperCase() + AppState.filters.material.slice(1);
            sectionTitle.textContent = showingNotable ? `${materialName} Notable Trends` : `${materialName} Commodities`;
            if (sectionDescription) {
                sectionDescription.textContent = showingNotable 
                    ? `Notable price changes and alerts in ${materialName.toLowerCase()}. Switch to "All" to see everything.`
                    : `All ${materialName.toLowerCase()} commodities. Click any card for detailed analysis and charts.`;
            }
        }
    }
    
    if (data.length === 0) {
        const showingNotable = AppState.filters.showNotableOnly && !AppState.filters.search && AppState.filters.material !== 'housing';
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <h3>No data found</h3>
                <p>${showingNotable 
                    ? 'No notable trends in this view. Switch to "All" to see all commodities, or try a different filter.' 
                    : 'Try adjusting your filters or search terms'}</p>
            </div>
        `;
        return;
    }
    
    // Special rendering for housing category summaries
    if (isHousingCategories) {
        container.className = 'commodities-container housing-categories';
        container.innerHTML = data.map(group => renderHousingCategoryCard(group)).join('');
        
        // Attach click handlers for category details
        container.querySelectorAll('.view-details-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const category = e.target.dataset.category;
                // Show all items in this category
                AppState.filters.search = category;
                renderCommodities();
            });
        });
        
        // Attach click handlers to show category items
        container.querySelectorAll('.housing-category-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('view-details-btn')) return;
                const category = card.dataset.category;
                // Filter to show items in this category
                const categoryItems = AppState.commodities.filter(c => 
                    c.material === 'housing' && c.subcategory === category
                );
                if (categoryItems.length > 0) {
                    // Show first item's detail page
                    showCommodityDetail(categoryItems[0]);
                }
            });
        });
        return;
    }
    
    // Regular commodity rendering
    const commodities = data;
    
    // Apply view mode class
    container.className = AppState.viewMode === 'grid' 
        ? 'commodities-container' 
        : 'commodities-container list-view';
    
    // Render based on view mode
    if (AppState.viewMode === 'grid') {
        container.innerHTML = commodities.map(c => renderCommodityCard(c)).join('');
    } else {
        container.innerHTML = commodities.map(c => renderCommodityListItem(c)).join('');
    }
    
    // Attach click handlers for detail view
    container.querySelectorAll('.commodity-card, .commodity-item').forEach(card => {
        card.addEventListener('click', () => {
            const product = card.dataset.product;
            const commodity = commodities.find(c => c.product === product);
            if (commodity) {
                showCommodityDetail(commodity);
            }
        });
    });
    
    // Render material-specific comparison charts
    if (AppState.filters.material && AppState.filters.material !== 'all' && AppState.filters.material !== 'housing' && !AppState.filters.search) {
        setTimeout(() => {
            renderMaterialComparisonChart(AppState.filters.material, commodities);
        }, 100);
    } else if (AppState.filters.material === 'housing' && !AppState.filters.search) {
        setTimeout(() => {
            renderHousingStartsComparisonChart();
        }, 100);
    } else {
        // Hide comparison chart section
        const comparisonSection = document.getElementById('materialComparisonSection');
        if (comparisonSection) {
            comparisonSection.style.display = 'none';
        }
    }
}

/**
 * Render a commodity card (grid view)
 * 
 * @param {Object} commodity - Commodity object
 * @returns {string} HTML string
 */
function renderCommodityCard(commodity) {
    const hasValue = commodity.hasValue;
    const alertBadges = commodity.alerts.map(a => 
        `<span class="alert-badge ${a.type}" title="${a.message}" data-severity="${a.severity}">${a.icon}</span>`
    ).join('');
    
    const trendIndicator = hasValue && commodity.trend.direction !== 'neutral' 
        ? `<div class="trend-indicator ${commodity.trend.direction}" title="${commodity.trend.direction === 'up' ? 'Up' : 'Down'} ${commodity.trend.percentage}% (${commodity.trend.timeframe || '7 days'})">
            ${getTrendIcon(commodity.trend.direction)} ${commodity.trend.percentage}% <span class="trend-timeframe">(${commodity.trend.timeframe || '7 days'})</span>
        </div>`
        : '';
    
    return `
        <div class="commodity-card ${hasValue ? '' : 'no-data'}" data-product="${escapeHtml(commodity.product)}">
            <div class="card-header">
                <div class="commodity-icon">${commodity.icon}</div>
                <div class="commodity-title">
                    <h3>${escapeHtml(commodity.product)}</h3>
                    <span class="commodity-subcategory">${escapeHtml(commodity.subcategory || 'N/A')}</span>
                    ${commodity.material === 'housing' ? (() => {
                        const region = extractRegionFromProduct(commodity.product);
                        return region ? `<span class="housing-region-badge">Region: ${region}</span>` : '';
                    })() : ''}
                </div>
                ${alertBadges ? `<div class="alert-badges">${alertBadges}</div>` : ''}
            </div>
            <div class="card-body">
                <div class="price-display">
                    ${hasValue ? `
                        <div class="price-value">${commodity.displayValue}</div>
                        <div class="price-unit">${escapeHtml(commodity.unit)}</div>
                        ${trendIndicator}
                    ` : `
                        <div class="price-value no-data">No Data</div>
                        <div class="price-unit no-data">Data unavailable</div>
                    `}
                </div>
                <div class="commodity-meta">
                    <span class="meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        ${formatDate(commodity.date)}
                    </span>
                    <span class="meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        ${escapeHtml(commodity.source || 'Unknown')}
                    </span>
                    ${commodity.material === 'housing' ? (() => {
                        const freqInfo = getHousingDataFrequency(commodity.subcategory, commodity.unit);
                        return `<span class="meta-item housing-frequency" title="${freqInfo.description}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            ${freqInfo.frequency}
                        </span>`;
                    })() : ''}
                </div>
                ${commodity.material === 'housing' ? (() => {
                    const freqInfo = getHousingDataFrequency(commodity.subcategory, commodity.unit);
                    return `<div class="housing-timeframe-info">
                        <span class="timeframe-label">Data Period:</span>
                        <span class="timeframe-value">${freqInfo.description} as of ${formatDate(commodity.date)}</span>
                    </div>`;
                })() : ''}
            </div>
            <div class="card-footer">
                <div class="material-badge" style="background-color: ${commodity.category}20; color: ${commodity.category};">
                    ${escapeHtml(commodity.material || 'Unknown')}
                </div>
                ${hasValue ? `
                    <div class="price-change-indicator ${commodity.priceChange.status}">
                        ${commodity.priceChange.label}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Render a commodity list item (list view)
 * 
 * @param {Object} commodity - Commodity object
 * @returns {string} HTML string
 */
function renderCommodityListItem(commodity) {
    const hasValue = commodity.hasValue;
    
    return `
        <div class="commodity-item ${hasValue ? '' : 'no-data'}" data-product="${escapeHtml(commodity.product)}">
            <div class="item-icon">${commodity.icon}</div>
            <div class="item-content">
                <div class="item-header">
                    <h3>${escapeHtml(commodity.product)}</h3>
                    <span class="item-subcategory">${escapeHtml(commodity.subcategory || 'N/A')}</span>
                </div>
                <div class="item-details">
                    ${hasValue ? `
                        <span class="item-price">${commodity.displayValue}</span>
                        <span class="item-unit">${escapeHtml(commodity.unit)}</span>
                    ` : '<span class="item-price no-data">No Data</span>'}
                </div>
            </div>
            <div class="item-meta">
                <span class="meta-badge">${escapeHtml(commodity.source || 'Unknown')}</span>
                <span class="meta-date">${formatDate(commodity.date)}</span>
                ${hasValue && commodity.trend.direction !== 'neutral' ? `
                    <span class="trend-badge ${commodity.trend.direction}">
                        ${getTrendIcon(commodity.trend.direction)} ${commodity.trend.percentage}% <span class="trend-timeframe">(${commodity.trend.timeframe || '7 days'})</span>
                    </span>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Render metrics dashboard
 * Displays key analytics metrics
 */
function renderMetrics() {
    const analytics = AppState.analytics;
    if (!analytics) return;
    
    const totalEl = document.getElementById('totalCommodities');
    const trendSummaryEl = document.getElementById('trendSummary');
    const trendDetailEl = document.getElementById('trendDetail');
    const lastUpdatedEl = document.getElementById('lastUpdated');
    const updateSourceEl = document.getElementById('updateSource');
    
    if (totalEl) {
        totalEl.textContent = analytics.total;
    }
    
    if (trendSummaryEl && trendDetailEl && analytics.trends) {
        const t = analytics.trends;
        const net = t.up - t.down;
        trendSummaryEl.innerHTML = `<span class="trend-up">↑ ${t.up}</span> <span class="trend-down">↓ ${t.down}</span>`;
        let detail = '';
        if (t.topGainer) detail += `${t.topGainer.product} +${t.topGainer.pct}%`;
        if (t.topDecliner) detail += (detail ? ' · ' : '') + `${t.topDecliner.product} ${t.topDecliner.pct}%`;
        if (t.alertCount > 0) detail += (detail ? ' · ' : '') + `${t.alertCount} alert${t.alertCount > 1 ? 's' : ''}`;
        trendDetailEl.textContent = detail || (net > 0 ? 'More up than down' : net < 0 ? 'More down than up' : 'Mixed trends');
    }
    
    if (lastUpdatedEl) {
        if (AppState.dataMaxDate) {
            lastUpdatedEl.textContent = formatDate(AppState.dataMaxDate);
        } else {
            lastUpdatedEl.textContent = formatTime(AppState.lastUpdate);
        }
    }
    
    if (updateSourceEl) {
        updateSourceEl.textContent = AppState.dataMaxDate 
            ? `Data through ${formatDate(AppState.dataMaxDate)} · ${analytics.dataCoverage}% coverage` 
            : `Data coverage: ${analytics.dataCoverage}%`;
    }
}

/**
 * Render material breakdown
 * Shows statistics by material type
 */
function renderBreakdown() {
    const analytics = AppState.analytics;
    if (!analytics || !analytics.byMaterial) return;
    
    const container = document.getElementById('breakdownGrid');
    if (!container) return;
    
    // Filter out housing from material breakdown
    const materials = Object.entries(analytics.byMaterial).filter(([material]) => material !== 'housing');
    
    container.innerHTML = materials.map(([material, data]) => `
        <div class="breakdown-card">
            <div class="breakdown-header">
                <h4>${capitalize(material)}</h4>
                <span class="breakdown-count">${data.count} items</span>
            </div>
            <div class="breakdown-stats">
                <div class="stat-item">
                    <span class="stat-label">With Data</span>
                    <span class="stat-value">${data.withValues}</span>
                </div>
                ${(data.up || data.down) ? `
                    <div class="stat-item breakdown-trends">
                        <span class="trend-up">↑ ${data.up || 0}</span>
                        <span class="trend-down">↓ ${data.down || 0}</span>
                    </div>
                ` : ''}
            </div>
            <div class="breakdown-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${(data.withValues / data.count) * 100}%"></div>
                </div>
                <span class="progress-text">${Math.round((data.withValues / data.count) * 100)}% coverage</span>
            </div>
        </div>
    `).join('');
}

/**
 * Process and render housing indicators
 */
function renderHousingIndicators() {
    const housingSection = document.getElementById('housingSection');
    if (!housingSection) return;
    
    // Filter housing data from commodities
    const housingData = AppState.commodities.filter(c => c.material === 'housing');
    
    if (housingData.length === 0) {
        housingSection.style.display = 'none';
        return;
    }
    
    housingSection.style.display = 'block';
    
    // Group housing data by subcategory
    const housingByCategory = housingData.reduce((acc, item) => {
        const category = item.subcategory || 'Other';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(item);
        return acc;
    }, {});
    
    // Render Housing Starts & Permits
    renderHousingStartsPermits(housingByCategory['Housing Starts'] || [], housingByCategory['Building Permits'] || []);
    
    // Render New Home Sales
    renderNewHomeSales(housingByCategory['New Home Sales'] || []);
    
    // Render Existing Home Sales
    renderExistingHomeSales(housingByCategory['Existing Home Sales'] || []);
    
    // Render Houses for Sale
    renderHousesForSale(housingByCategory['Inventory'] || []);
    
    // Render Median Prices
    renderMedianPrices(housingByCategory['Prices'] || []);
    
    // Render Rates
    renderRates(housingByCategory['Mortgage Rates'] || [], housingByCategory['Treasury Bills'] || []);
}

/**
 * Render Housing Starts & Permits charts by region
 */
function renderHousingStartsPermits(startsData, permitsData) {
    const container = document.getElementById('housingStartsPermitsCharts');
    if (!container) return;
    
    const regions = ['Northeast', 'Midwest', 'South', 'West'];
    container.innerHTML = regions.map(region => {
        const regionStarts = startsData.find(d => d.product.includes(region));
        const regionPermits = permitsData.find(d => d.product.includes(region));
        
        if (!regionStarts && !regionPermits) return '';
        
        const chartId = `chart_starts_permits_${region.toLowerCase().replace(/\s+/g, '_')}`;
        const latestDate = regionStarts?.date || regionPermits?.date;
        const dateRange = latestDate ? ` (Monthly data as of ${formatDate(latestDate)})` : '';
        return `
            <div class="housing-chart-card">
                <h4>${region}${dateRange}</h4>
                <div class="chart-container-small">
                    <canvas id="${chartId}"></canvas>
                </div>
            </div>
        `;
    }).join('');
    
    // Render charts
    regions.forEach(region => {
        const chartId = `chart_starts_permits_${region.toLowerCase().replace(/\s+/g, '_')}`;
        const canvas = document.getElementById(chartId);
        if (!canvas || typeof Chart === 'undefined') return;
        
        const regionStarts = startsData.find(d => d.product.includes(region));
        const regionPermits = permitsData.find(d => d.product.includes(region));
        
        if (!regionStarts && !regionPermits) return;
        
        // Get historical data
        const startsRecords = regionStarts?.historicalRecords || [];
        const permitsRecords = regionPermits?.historicalRecords || [];
        
        // Get last 18 months of data
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 18);
        
        const startsFiltered = startsRecords.filter(r => new Date(r.date) >= cutoffDate).sort((a, b) => new Date(a.date) - new Date(b.date));
        const permitsFiltered = permitsRecords.filter(r => new Date(r.date) >= cutoffDate).sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Combine dates
        const allDates = [...new Set([...startsFiltered.map(r => r.date), ...permitsFiltered.map(r => r.date)])].sort();
        
        const startsValues = allDates.map(date => {
            const record = startsFiltered.find(r => r.date === date);
            return record && record.hasValue ? record.value : null;
        });
        
        const permitsValues = allDates.map(date => {
            const record = permitsFiltered.find(r => r.date === date);
            return record && record.hasValue ? record.value : null;
        });
        
        // Calculate 3-month moving average for permits
        const permitsMA = calculateMovingAverage(permitsValues.filter(v => v !== null), 3);
        
        const labels = allDates.map(d => {
            const date = new Date(d);
            return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });
        
        const ctx = canvas.getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Starts',
                        data: startsValues,
                        backgroundColor: STOAColors.green2 + '80',
                        borderColor: STOAColors.green2,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: STOAColors.green2,
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2
                    },
                    {
                        label: 'Permits',
                        data: permitsValues,
                        type: 'line',
                        borderColor: STOAColors.black,
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        spanGaps: true,
                        pointRadius: allDates.length <= 5 ? 5 : 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Thousands of units (SAAR)'
                        },
                        ticks: {
                            callback: function(value) {
                                return formatValue(value, 'Thousands of Units (SAAR)', 'housing');
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed.y;
                                if (value === null) return context.dataset.label + ': No data';
                                return context.dataset.label + ': ' + formatValue(value, 'Thousands of Units (SAAR)', 'housing');
                            }
                        }
                    }
                }
            }
        });
    });
}

/**
 * Render New Home Sales charts by region
 */
function renderNewHomeSales(salesData) {
    const container = document.getElementById('newHomeSalesCharts');
    if (!container) return;
    
    const regions = ['Northeast', 'Midwest', 'South', 'West'];
    container.innerHTML = regions.map(region => {
        const regionData = salesData.find(d => d.product.includes(region));
        if (!regionData) return '';
        
        const chartId = `chart_new_sales_${region.toLowerCase().replace(/\s+/g, '_')}`;
        const latestDate = regionData?.date;
        const dateRange = latestDate ? ` (Monthly data as of ${formatDate(latestDate)})` : '';
        return `
            <div class="housing-chart-card">
                <h4>${region}${dateRange}</h4>
                <div class="chart-container-small">
                    <canvas id="${chartId}"></canvas>
                </div>
            </div>
        `;
    }).join('');
    
    regions.forEach(region => {
        const chartId = `chart_new_sales_${region.toLowerCase().replace(/\s+/g, '_')}`;
        const canvas = document.getElementById(chartId);
        if (!canvas || typeof Chart === 'undefined') return;
        
        const regionData = salesData.find(d => d.product.includes(region));
        if (!regionData) return;
        
        const records = (regionData.historicalRecords || []).filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date));
        if (records.length === 0) return;
        
        const values = records.map(r => r.value);
        const ma3 = calculateMovingAverage(values, 3);
        const labels = records.map(r => {
            const date = new Date(r.date);
            return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });
        
        const ctx = canvas.getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Units',
                        data: values,
                        backgroundColor: STOAColors.green2 + '80',
                        borderColor: STOAColors.green2,
                        borderWidth: 1
                    },
                    {
                        label: '3-Month MA',
                        data: ma3,
                        type: 'line',
                        borderColor: STOAColors.black,
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        spanGaps: true,
                        pointRadius: labels.length <= 5 ? 5 : 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Thousands of units (SAAR)'
                        },
                        ticks: {
                            callback: function(value) {
                                return formatValue(value, 'Thousands of Units (SAAR)', 'housing');
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed.y;
                                if (value === null) return context.dataset.label + ': No data';
                                return context.dataset.label + ': ' + formatValue(value, 'Thousands of Units (SAAR)', 'housing');
                            }
                        }
                    }
                }
            }
        });
    });
}

/**
 * Render Existing Home Sales charts by region
 */
function renderExistingHomeSales(salesData) {
    const container = document.getElementById('existingHomeSalesCharts');
    if (!container) return;
    
    const regions = ['Northeast', 'Midwest', 'South', 'West'];
    container.innerHTML = regions.map(region => {
        const regionData = salesData.find(d => d.product.includes(region));
        if (!regionData) return '';
        
        const chartId = `chart_existing_sales_${region.toLowerCase().replace(/\s+/g, '_')}`;
        const latestDate = regionData?.date;
        const dateRange = latestDate ? ` (Monthly data as of ${formatDate(latestDate)})` : '';
        return `
            <div class="housing-chart-card">
                <h4>${region}${dateRange}</h4>
                <div class="chart-container-small">
                    <canvas id="${chartId}"></canvas>
                </div>
            </div>
        `;
    }).join('');
    
    regions.forEach(region => {
        const chartId = `chart_existing_sales_${region.toLowerCase().replace(/\s+/g, '_')}`;
        const canvas = document.getElementById(chartId);
        if (!canvas || typeof Chart === 'undefined') return;
        
        const regionData = salesData.find(d => d.product.includes(region));
        if (!regionData) return;
        
        const records = (regionData.historicalRecords || []).filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date));
        if (records.length === 0) return;
        
        const values = records.map(r => r.value);
        const ma3 = calculateMovingAverage(values, 3);
        const labels = records.map(r => {
            const date = new Date(r.date);
            return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });
        
        const ctx = canvas.getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Units',
                        data: values,
                        backgroundColor: STOAColors.green2 + '80',
                        borderColor: STOAColors.green2,
                        borderWidth: 1
                    },
                    {
                        label: '3-Month MA',
                        data: ma3,
                        type: 'line',
                        borderColor: STOAColors.black,
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        spanGaps: true,
                        pointRadius: labels.length <= 5 ? 5 : 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Thousands of units (SAAR)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom'
                    }
                }
            }
        });
    });
}

/**
 * Render Houses for Sale charts
 */
function renderHousesForSale(inventoryData) {
    const container = document.getElementById('housesForSaleCharts');
    if (!container) return;
    
    const newHomes = inventoryData.find(d => d.product === 'New Homes for Sale');
    const monthsSupply = inventoryData.find(d => d.product === "Months' Supply of New Houses");
    const existingHomes = inventoryData.filter(d => d.product.includes('Existing Homes for Sale'));
    
    container.innerHTML = `
        <div class="housing-chart-card large">
            <h4>New Homes for Sale</h4>
            <div class="chart-container-medium">
                <canvas id="chart_new_homes_sale"></canvas>
            </div>
        </div>
        <div class="housing-chart-card large">
            <h4>Existing Homes for Sale</h4>
            <div class="chart-container-medium">
                <canvas id="chart_existing_homes_sale"></canvas>
            </div>
        </div>
    `;
    
    // Render New Homes chart
    if (newHomes && typeof Chart !== 'undefined') {
        const canvas = document.getElementById('chart_new_homes_sale');
        if (canvas) {
            const records = (newHomes.historicalRecords || []).filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date));
            const supplyRecords = monthsSupply ? (monthsSupply.historicalRecords || []).filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date)) : [];
            
            if (records.length > 0) {
                const values = records.map(r => r.value);
                const supplyValues = supplyRecords.map(r => r.value);
                const labels = records.map(r => {
                    const date = new Date(r.date);
                    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                });
                
                const ctx = canvas.getContext('2d');
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'Thousands of units',
                                data: values,
                                backgroundColor: STOAColors.green2 + '80',
                                borderColor: STOAColors.green2,
                                borderWidth: 1,
                                yAxisID: 'y'
                            },
                            {
                                label: "Months' Supply",
                                data: supplyValues,
                                type: 'line',
                                borderColor: STOAColors.black,
                                borderWidth: 2,
                                fill: false,
                                yAxisID: 'y1'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: true,
                                position: 'left',
                                title: {
                                    display: true,
                                    text: 'Thousands of units'
                                }
                            },
                            y1: {
                                beginAtZero: true,
                                position: 'right',
                                title: {
                                    display: true,
                                    text: "Months' Supply"
                                },
                                grid: {
                                    drawOnChartArea: false
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'bottom'
                            }
                        }
                    }
                });
            }
        }
    }
    
    // Render Existing Homes chart (aggregate all regions)
    if (existingHomes.length > 0 && typeof Chart !== 'undefined') {
        const canvas = document.getElementById('chart_existing_homes_sale');
        if (canvas) {
            // Combine all regional data
            const allRecords = existingHomes.flatMap(d => (d.historicalRecords || []).filter(r => r.hasValue));
            const groupedByDate = allRecords.reduce((acc, r) => {
                if (!acc[r.date]) acc[r.date] = [];
                acc[r.date].push(r.value);
                return acc;
            }, {});
            
            const dates = Object.keys(groupedByDate).sort();
            const totalValues = dates.map(date => {
                const values = groupedByDate[date];
                return values.reduce((a, b) => a + b, 0);
            });
            
            const labels = dates.map(d => {
                const date = new Date(d);
                return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            });
            
            const ctx = canvas.getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Thousands of units',
                        data: totalValues,
                        backgroundColor: STOAColors.green2 + '80',
                        borderColor: STOAColors.green2,
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Thousands of units'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom'
                        }
                    }
                }
            });
        }
    }
}

/**
 * Render Median House Prices charts
 */
function renderMedianPrices(pricesData) {
    const container = document.getElementById('medianPricesCharts');
    if (!container) return;
    
    const newPrice = pricesData.find(d => d.product.includes('New'));
    const existingPrice = pricesData.find(d => d.product.includes('Existing'));
    
    container.innerHTML = `
        <div class="housing-chart-card">
            <h4>New Houses</h4>
            <div class="chart-container-small">
                <canvas id="chart_median_new"></canvas>
            </div>
        </div>
        <div class="housing-chart-card">
            <h4>Existing Houses</h4>
            <div class="chart-container-small">
                <canvas id="chart_median_existing"></canvas>
            </div>
        </div>
    `;
    
    // Render New Price chart
    if (newPrice && typeof Chart !== 'undefined') {
        const canvas = document.getElementById('chart_median_new');
        if (canvas) {
            const records = (newPrice.historicalRecords || []).filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date));
            if (records.length > 0) {
                const values = records.map(r => r.value / 1000); // Convert to thousands
                const labels = records.map(r => {
                    const date = new Date(r.date);
                    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                });
                
                const ctx = canvas.getContext('2d');
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Median Price',
                            data: values,
                            backgroundColor: STOAColors.green2 + '80',
                            borderColor: STOAColors.green2,
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: true,
                                title: {
                                    display: true,
                                    text: 'in $1,000s'
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                display: false
                            }
                        }
                    }
                });
            }
        }
    }
    
    // Render Existing Price chart
    if (existingPrice && typeof Chart !== 'undefined') {
        const canvas = document.getElementById('chart_median_existing');
        if (canvas) {
            const records = (existingPrice.historicalRecords || []).filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date));
            if (records.length > 0) {
                const values = records.map(r => r.value / 1000); // Convert to thousands
                const labels = records.map(r => {
                    const date = new Date(r.date);
                    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                });
                
                const ctx = canvas.getContext('2d');
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Median Price',
                            data: values,
                            backgroundColor: STOAColors.green2 + '80',
                            borderColor: STOAColors.green2,
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: true,
                                title: {
                                    display: true,
                                    text: 'in $1,000s'
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                display: false
                            }
                        }
                    }
                });
            }
        }
    }
}

/**
 * Render Mortgage Rates and Treasury Bills charts
 */
function renderRates(mortgageData, tbillData) {
    const container = document.getElementById('ratesCharts');
    if (!container) return;
    
    const mortgageDate = mortgageData.length > 0 ? mortgageData[0].date : null;
    const tbillDate = tbillData.length > 0 ? tbillData[0].date : null;
    const mortgageDateRange = mortgageDate ? ` (Monthly data as of ${formatDate(mortgageDate)})` : '';
    const tbillDateRange = tbillDate ? ` (Monthly data as of ${formatDate(tbillDate)})` : '';
    
    container.innerHTML = `
        <div class="housing-chart-card">
            <h4>30-Year Fixed Mortgage Rate${mortgageDateRange}</h4>
            <div class="chart-container-small">
                <canvas id="chart_mortgage"></canvas>
            </div>
        </div>
        <div class="housing-chart-card">
            <h4>3-Month Treasury Bill${tbillDateRange}</h4>
            <div class="chart-container-small">
                <canvas id="chart_tbill"></canvas>
            </div>
        </div>
    `;
    
    // Render Mortgage Rate chart
    if (mortgageData.length > 0 && typeof Chart !== 'undefined') {
        const canvas = document.getElementById('chart_mortgage');
        if (canvas) {
            const mortgage = mortgageData[0];
            const records = (mortgage.historicalRecords || []).filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date));
            if (records.length > 0) {
                const values = records.map(r => r.value);
                const labels = records.map(r => {
                    const date = new Date(r.date);
                    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                });
                
                const ctx = canvas.getContext('2d');
                // Calculate min/max for normalized scale (less drastic movements)
                const minValue = Math.min(...values);
                const maxValue = Math.max(...values);
                const range = maxValue - minValue;
                // Use smaller padding (5% of range) to show normalized movements
                const padding = Math.max(0.1, range * 0.05);
                const yMin = Math.max(0, minValue - padding);
                const yMax = maxValue + padding;
                
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Rate (%)',
                            data: values,
                            borderColor: STOAColors.green2,
                            backgroundColor: STOAColors.green2 + '20',
                            borderWidth: 3,
                            fill: false,
                            tension: 0.3,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            pointBackgroundColor: STOAColors.green2,
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: false,
                                min: yMin,
                                max: yMax,
                                title: {
                                    display: true,
                                    text: 'Percentage (%)'
                                },
                                ticks: {
                                    callback: function(value) {
                                        return value.toFixed(2) + '%';
                                    },
                                    stepSize: 0.5
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'bottom'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const value = context.parsed.y;
                                        if (value === null) return context.dataset.label + ': No data';
                                        return context.dataset.label + ': ' + value.toFixed(2) + '%';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
    }
    
    // Render Treasury Bill chart
    if (tbillData.length > 0 && typeof Chart !== 'undefined') {
        const canvas = document.getElementById('chart_tbill');
        if (canvas) {
            const tbill = tbillData[0];
            const records = (tbill.historicalRecords || []).filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date));
            if (records.length > 0) {
                const values = records.map(r => r.value);
                const labels = records.map(r => {
                    const date = new Date(r.date);
                    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                });
                
                const ctx = canvas.getContext('2d');
                // Calculate min/max for normalized scale (less drastic movements)
                const minValue = Math.min(...values);
                const maxValue = Math.max(...values);
                const range = maxValue - minValue;
                // Use smaller padding (5% of range) to show normalized movements
                const padding = Math.max(0.05, range * 0.05);
                const yMin = Math.max(0, minValue - padding);
                const yMax = maxValue + padding;
                
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Rate (%)',
                            data: values,
                            borderColor: STOAColors.grey || '#757270',
                            backgroundColor: (STOAColors.grey || '#757270') + '20',
                            borderWidth: 3,
                            fill: false,
                            tension: 0.3,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            pointBackgroundColor: STOAColors.grey || '#757270',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: false,
                                min: yMin,
                                max: yMax,
                                title: {
                                    display: true,
                                    text: 'Percentage (%)'
                                },
                                ticks: {
                                    callback: function(value) {
                                        return value.toFixed(2) + '%';
                                    },
                                    stepSize: 0.25
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'bottom'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const value = context.parsed.y;
                                        if (value === null) return context.dataset.label + ': No data';
                                        return context.dataset.label + ': ' + value.toFixed(2) + '%';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
    }
}

/**
 * Populate commodity selector dropdown
 */
function populateCommoditySelector() {
    const selector = document.getElementById('chartCommodity');
    if (!selector) return;
    
    // Filter out housing data from price trends selector
    const commodities = AppState.commodities.filter(c => 
        c.historicalRecords && 
        c.historicalRecords.length > 0 &&
        c.hasValue &&
        c.material !== 'housing' // Exclude housing from price trends
    );
    
    // Clear existing options except the first one
    selector.innerHTML = '<option value="">Select commodity...</option>';
    
    // Add commodities to selector
    commodities.forEach(commodity => {
        const option = document.createElement('option');
        option.value = commodity.product;
        option.textContent = commodity.product;
        selector.appendChild(option);
    });
    
    // Set default selection if none selected
    if (!AppState.chartState.primaryCommodity && commodities.length > 0) {
        AppState.chartState.primaryCommodity = commodities[0].product;
        selector.value = commodities[0].product;
    } else if (AppState.chartState.primaryCommodity) {
        selector.value = AppState.chartState.primaryCommodity;
    }
    
    // Update compare button state
    updateCompareButtonState();
}

/**
 * Update compare button state based on available commodities
 */
function updateCompareButtonState() {
    const compareBtn = document.getElementById('compareBtn');
    if (!compareBtn) return;
    
    const availableCommodities = AppState.commodities.filter(c => 
        c.historicalRecords && 
        c.historicalRecords.length > 0 &&
        c.hasValue
    );
    
    const primaryProduct = AppState.chartState.primaryCommodity;
    const availableToCompare = availableCommodities.filter(c => 
        c.product !== primaryProduct && 
        !AppState.chartState.comparedCommodities.includes(c.product)
    );
    
    if (!primaryProduct || availableToCompare.length === 0) {
        compareBtn.disabled = true;
        compareBtn.style.opacity = '0.5';
        compareBtn.style.cursor = 'not-allowed';
    } else {
        compareBtn.disabled = false;
        compareBtn.style.opacity = '1';
        compareBtn.style.cursor = 'pointer';
    }
}

/**
 * Render price trends chart
 * Shows one commodity at a time with compare functionality
 */
function renderTrendChart() {
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
        console.warn('[STOA Commodities] Chart.js not loaded');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = STOAColors.grey || '#666';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Chart.js is loading...', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Get commodities with historical data
    const availableCommodities = AppState.commodities.filter(c => 
        c.historicalRecords && 
        c.historicalRecords.length > 0 &&
        c.hasValue
    );
    
    if (availableCommodities.length === 0) {
        if (AppState.chart) {
            AppState.chart.destroy();
            AppState.chart = null;
        }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = STOAColors.grey || '#666';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No historical data available', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Get selected commodity
    const primaryProduct = AppState.chartState.primaryCommodity;
    if (!primaryProduct) {
        if (AppState.chart) {
            AppState.chart.destroy();
            AppState.chart = null;
        }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = STOAColors.grey || '#666';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Please select a commodity to view trends', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Get period selector value
    const periodSelect = document.getElementById('chartPeriod');
    const period = periodSelect ? periodSelect.value : '30d';
    
    // Calculate date cutoff based on period
    const cutoffDate = new Date();
    switch (period) {
        case '7d':
            cutoffDate.setDate(cutoffDate.getDate() - 7);
            break;
        case '30d':
            cutoffDate.setDate(cutoffDate.getDate() - 30);
            break;
        case '90d':
            cutoffDate.setDate(cutoffDate.getDate() - 90);
            break;
        case '1y':
            cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
            break;
        default:
            cutoffDate.setDate(cutoffDate.getDate() - 30);
    }
    
    // Get primary commodity
    const primaryCommodity = availableCommodities.find(c => c.product === primaryProduct);
    if (!primaryCommodity) {
        if (AppState.chart) {
            AppState.chart.destroy();
            AppState.chart = null;
        }
        return;
    }
    
    // Get compared commodities
    const comparedCommodities = AppState.chartState.comparedCommodities
        .map(productName => availableCommodities.find(c => c.product === productName))
        .filter(c => c && c.product !== primaryProduct); // Remove primary and invalid
    
    // Combine primary and compared commodities
    const commoditiesToShow = [primaryCommodity, ...comparedCommodities];
    
    // Collect all unique dates within the period
    const allDates = new Set();
    commoditiesToShow.forEach(commodity => {
        commodity.historicalRecords.forEach(record => {
            if (record.date && record.hasValue) {
                const recordDate = new Date(record.date);
                if (recordDate >= cutoffDate) {
                    allDates.add(record.date);
                }
            }
        });
    });
    
    // Sort dates
    const sortedDates = Array.from(allDates).sort((a, b) => a.localeCompare(b));
    
    if (sortedDates.length === 0) {
        if (AppState.chart) {
            AppState.chart.destroy();
            AppState.chart = null;
        }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = STOAColors.grey || '#666';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data for selected period', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Format dates for display
    const formatDateLabel = (dateStr) => {
        const date = new Date(dateStr);
        if (period === '7d' || period === '30d') {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } else if (period === '90d') {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } else {
            return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        }
    };
    
    const labels = sortedDates.map(formatDateLabel);
    
    // Generate color palette (STOA colors)
    const colorPalette = [
        STOAColors.green || '#7e8a6b',      // Primary commodity
        STOAColors.green2 || '#a6ad8a',    // Compare 1
        STOAColors.blue || '#bdc2ce',      // Compare 2
        '#8fa07a',                         // Compare 3
        '#9ba88d',                         // Compare 4
        '#b5c0a8',                         // Compare 5
        '#c4d0b8'                          // Compare 6
    ];
    
    // Create datasets
    const datasets = commoditiesToShow.map((commodity, index) => {
        // Map dates to values for this commodity
        const data = sortedDates.map(dateStr => {
            const record = commodity.historicalRecords.find(r => r.date === dateStr && r.hasValue);
            return record ? record.value : null;
        });
        
        const color = colorPalette[index % colorPalette.length];
        const isPrimary = index === 0;
        
        return {
            label: commodity.product + (isPrimary ? ' (Primary)' : ''),
            data: data,
            borderColor: color,
            backgroundColor: color + '40',
            borderWidth: isPrimary ? 3 : 2.5, // Thicker line for primary
            borderDash: isPrimary ? [] : [5, 5], // Dashed for compared
            fill: false,
            tension: 0.3,
            pointRadius: isPrimary ? 4 : 3,
            pointHoverRadius: isPrimary ? 6 : 5,
            pointBackgroundColor: color,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            spanGaps: false
        };
    });
    
    // Destroy existing chart if any
    if (AppState.chart) {
        AppState.chart.destroy();
    }
    
    // Create new chart
    const ctx = canvas.getContext('2d');
    AppState.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: {
                            family: 'Inter, system-ui, sans-serif',
                            size: 12,
                            weight: '600'
                        },
                        color: STOAColors.black || '#333'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 31, 22, 0.95)',
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: {
                        weight: '700',
                        size: 13
                    },
                    bodyFont: {
                        weight: '500',
                        size: 12
                    },
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value === null) return context.dataset.label + ': No data';
                            const commodity = commoditiesToShow[context.datasetIndex];
                            const unit = commodity ? commodity.unit : '';
                            const material = commodity ? commodity.material : null;
                            return context.dataset.label.replace(' (Primary)', '') + ': ' + formatValue(value, unit, material);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(224, 224, 224, 0.3)',
                        display: true
                    },
                    ticks: {
                        font: {
                            family: 'Inter, system-ui, sans-serif',
                            size: 11,
                            weight: '600'
                        },
                        color: STOAColors.grey || '#666',
                        maxTicksLimit: period === '7d' ? 7 : period === '30d' ? 10 : period === '90d' ? 12 : 15
                    }
                },
                y: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(224, 224, 224, 0.5)',
                        display: true
                    },
                    ticks: {
                        font: {
                            family: 'Inter, system-ui, sans-serif',
                            size: 11,
                            weight: '600'
                        },
                        color: STOAColors.grey || '#666',
                        callback: function(value) {
                            if (value >= 1000000) {
                                return '$' + (value / 1000000).toFixed(1) + 'M';
                            } else if (value >= 1000) {
                                return '$' + (value / 1000).toFixed(1) + 'K';
                            }
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
    
    // Update compared commodities display
    updateComparedCommoditiesDisplay();
    
    console.log('[STOA Commodities] Trend chart rendered for', primaryProduct, 'with', comparedCommodities.length, 'comparisons');
}

/**
 * Update the compared commodities display
 */
function updateComparedCommoditiesDisplay() {
    const container = document.getElementById('comparedCommodities');
    if (!container) return;
    
    const compared = AppState.chartState.comparedCommodities;
    
    if (compared.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    container.innerHTML = compared.map(product => `
        <div class="compared-item">
            <span>${escapeHtml(product)}</span>
            <button class="remove-compare" data-product="${escapeHtml(product)}" aria-label="Remove ${escapeHtml(product)} from comparison">×</button>
        </div>
    `).join('');
    
    // Add remove handlers
    container.querySelectorAll('.remove-compare').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const product = e.target.dataset.product;
            AppState.chartState.comparedCommodities = AppState.chartState.comparedCommodities.filter(p => p !== product);
            updateCompareButtonState();
            renderTrendChart();
        });
    });
}

// ============================================
// FILTERING & SEARCH
// ============================================
/**
 * Check if a commodity is a significant mover or outlier
 * 
 * @param {Object} commodity - Commodity object
 * @returns {boolean} True if significant mover/outlier
 */
function isSignificantMover(commodity) {
    if (!commodity.hasValue) return false;
    
    let criteriaMet = 0;
    
    // Check for significant trend changes (>= 15% change - much stricter)
    if (commodity.trend && commodity.trend.direction !== 'neutral') {
        const absChange = Math.abs(commodity.trend.percentage || 0);
        if (absChange >= 15) {
            criteriaMet++; // Very significant change (15%+)
        } else if (absChange >= 10) {
            // 10-15% change - need additional criteria
        }
    }
    
    // Check for alerts - only high severity or truly unusual values
    if (commodity.alerts && commodity.alerts.length > 0) {
        const hasHighSeverityAlert = commodity.alerts.some(alert => 
            alert.severity === 'high'
        );
        const hasUnusualValueAlert = commodity.alerts.some(alert => 
            alert.message.includes('Unusually high') || alert.message.includes('Unusually low')
        );
        // Only count very stale data (30+ days) as significant
        const hasVeryStaleData = commodity.alerts.some(alert => 
            alert.message.includes('30 days old') || alert.message.includes('60 days old') || alert.message.includes('90 days old')
        );
        
        if (hasHighSeverityAlert || hasUnusualValueAlert) {
            criteriaMet++;
        }
        if (hasVeryStaleData) {
            criteriaMet++;
        }
    }
    
    // Require at least 2 criteria to be met, OR one very strong criterion
    // Very strong: 15%+ change, high severity alert
    const hasVeryStrongCriterion = 
        (commodity.trend && Math.abs(commodity.trend.percentage || 0) >= 15) ||
        (commodity.alerts && commodity.alerts.some(a => a.severity === 'high'));
    
    return hasVeryStrongCriterion || criteriaMet >= 2;
}

/**
 * Group housing data by category for digestible display
 * 
 * @param {Array} housingData - Array of housing commodities
 * @returns {Array} Array of grouped summary objects
 */
function groupHousingForDisplay(housingData) {
    const grouped = {};
    
    housingData.forEach(item => {
        const category = item.subcategory || 'Other';
        if (!grouped[category]) {
            grouped[category] = {
                category: category,
                items: [],
                totalValue: 0,
                avgValue: 0,
                count: 0,
                latestDate: null,
                regions: new Set(),
                hasTrends: false
            };
        }
        
        grouped[category].items.push(item);
        if (item.hasValue && item.value) {
            grouped[category].totalValue += item.value;
            grouped[category].count++;
        }
        if (item.date && (!grouped[category].latestDate || item.date > grouped[category].latestDate)) {
            grouped[category].latestDate = item.date;
        }
        if (item.trend && item.trend.direction !== 'neutral') {
            grouped[category].hasTrends = true;
        }
        
        // Extract region if present
        const region = extractRegionFromProduct(item.product);
        if (region) {
            grouped[category].regions.add(region);
        }
    });
    
    // Calculate averages
    Object.values(grouped).forEach(group => {
        if (group.count > 0) {
            group.avgValue = group.totalValue / group.count;
        }
    });
    
    return Object.values(grouped);
}

/**
 * Render a housing category summary card
 * 
 * @param {Object} group - Grouped housing data
 * @returns {string} HTML string
 */
function renderHousingCategoryCard(group) {
    const regionCount = group.regions.size;
    const regionText = regionCount > 0 ? ` (${regionCount} region${regionCount > 1 ? 's' : ''})` : '';
    const freqInfo = getHousingDataFrequency(group.category, group.items[0]?.unit || '');
    const latestDate = group.latestDate ? formatDate(group.latestDate) : 'N/A';
    
    // Get trend summary
    const trends = group.items.filter(i => i.trend && i.trend.direction !== 'neutral');
    const upTrends = trends.filter(t => t.trend.direction === 'up').length;
    const downTrends = trends.filter(t => t.trend.direction === 'down').length;
    
    return `
        <div class="housing-category-card" data-category="${escapeHtml(group.category)}">
            <div class="category-header">
                <h3>${escapeHtml(group.category)}${regionText}</h3>
                <span class="category-count">${group.items.length} metric${group.items.length > 1 ? 's' : ''}</span>
            </div>
            <div class="category-summary">
                ${group.count > 0 ? `
                    <div class="summary-stat">
                        <span class="stat-label">Average</span>
                        <span class="stat-value">${formatValue(group.avgValue, group.items[0]?.unit || '', 'housing')}</span>
                    </div>
                ` : ''}
                <div class="summary-stat">
                    <span class="stat-label">Frequency</span>
                    <span class="stat-value">${freqInfo.frequency}</span>
                </div>
                <div class="summary-stat">
                    <span class="stat-label">Latest Data</span>
                    <span class="stat-value">${latestDate}</span>
                </div>
            </div>
            ${trends.length > 0 ? `
                <div class="category-trends">
                    <span class="trend-summary">
                        ${upTrends > 0 ? `<span class="trend-up">↑ ${upTrends} up</span>` : ''}
                        ${downTrends > 0 ? `<span class="trend-down">↓ ${downTrends} down</span>` : ''}
                    </span>
                </div>
            ` : ''}
            <div class="category-actions">
                <button class="view-details-btn" data-category="${escapeHtml(group.category)}">
                    View Details
                </button>
            </div>
        </div>
    `;
}

/**
 * Get filtered commodities based on current filters
 * On "all" filter, only show significant movers/outliers
 * For housing filter, show grouped category summaries
 * 
 * @returns {Array} Filtered commodities array or housing category summaries
 */
function getFilteredCommodities() {
    // Special handling for housing filter - show grouped summaries
    if (AppState.filters.material === 'housing' && !AppState.filters.search) {
        const housingData = AppState.commodities.filter(c => c.material === 'housing');
        return groupHousingForDisplay(housingData);
    }
    
    let filtered = [...AppState.commodities];
    
    // Show notable trends by default (significant movers/outliers) - applies to all material views except housing
    if (AppState.filters.showNotableOnly && !AppState.filters.search && AppState.filters.material !== 'housing') {
        filtered = filtered.filter(c => isSignificantMover(c));
    }
    
    // Search filter
    if (AppState.filters.search) {
        const search = AppState.filters.search.toLowerCase();
        filtered = filtered.filter(c => 
            c.product?.toLowerCase().includes(search) ||
            c.subcategory?.toLowerCase().includes(search) ||
            c.material?.toLowerCase().includes(search) ||
            c.source?.toLowerCase().includes(search)
        );
    }
    
    // Material filter
    if (AppState.filters.material !== 'all' && AppState.filters.material !== 'housing') {
        filtered = filtered.filter(c => c.material?.toLowerCase() === AppState.filters.material.toLowerCase());
    }
    
    // Sort by significance (trend change percentage, then alerts)
    filtered.sort((a, b) => {
        const aSignificance = Math.abs(a.trend?.percentage || 0) + (a.alerts?.length || 0) * 10;
        const bSignificance = Math.abs(b.trend?.percentage || 0) + (b.alerts?.length || 0) * 10;
        return bSignificance - aSignificance; // Most significant first
    });
    
    return filtered;
}

// ============================================
// EVENT HANDLERS
// ============================================
/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            AppState.filters.search = e.target.value;
            const clearBtn = document.getElementById('clearSearch');
            if (clearBtn) {
                clearBtn.style.display = e.target.value ? 'block' : 'none';
            }
            renderCommodities();
        });
    }
    
    // Clear search button
    const clearSearch = document.getElementById('clearSearch');
    if (clearSearch) {
        clearSearch.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
            }
            AppState.filters.search = '';
            clearSearch.style.display = 'none';
            renderCommodities();
        });
    }
    
    // Filter chips
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            AppState.filters.material = e.target.dataset.filter || 'all';
            AppState.filters.search = ''; // Clear search when changing filters
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = '';
            renderCommodities();
            // Always hide housing section on main pages - only show on detail pages
            const housingSection = document.getElementById('housingSection');
            if (housingSection) {
                housingSection.style.display = 'none';
            }
        });
    });
    
    // View toggle buttons (Grid/List only - data-view)
    document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.view-btn[data-view]').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            AppState.viewMode = e.target.dataset.view || 'grid';
            renderCommodities();
        });
    });
    
    // Notable/All toggle for overview
    const notableToggle = document.getElementById('notableToggle');
    if (notableToggle) {
        notableToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('.view-btn');
            if (!btn || !('notable' in btn.dataset)) return;
            notableToggle.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.filters.showNotableOnly = btn.dataset.notable === 'true';
            renderCommodities();
        });
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadCommoditiesData();
        });
    }
    
    // Modal close
    const modalClose = document.getElementById('modalClose');
    if (modalClose) {
        modalClose.addEventListener('click', () => {
            const modal = document.getElementById('detailModal');
            if (modal) {
                modal.classList.remove('active');
            }
        });
    }
    
    // Modal backdrop click
    const detailModal = document.getElementById('detailModal');
    if (detailModal) {
        detailModal.addEventListener('click', (e) => {
            if (e.target.id === 'detailModal') {
                detailModal.classList.remove('active');
            }
        });
    }
    
    // Alert close
    const alertClose = document.getElementById('alertClose');
    if (alertClose) {
        alertClose.addEventListener('click', () => {
            const alertBanner = document.getElementById('alertBanner');
            if (alertBanner) {
                alertBanner.style.display = 'none';
            }
        });
    }
    
    // Chart commodity selector
    const chartCommodity = document.getElementById('chartCommodity');
    if (chartCommodity) {
        chartCommodity.addEventListener('change', (e) => {
            AppState.chartState.primaryCommodity = e.target.value || null;
            // Clear compared commodities when primary changes
            AppState.chartState.comparedCommodities = [];
            updateCompareButtonState();
            renderTrendChart();
        });
    }
    
    // Compare button
    const compareBtn = document.getElementById('compareBtn');
    if (compareBtn) {
        compareBtn.addEventListener('click', () => {
            showCompareModal();
        });
    }
    
    // Chart period selector
    const chartPeriod = document.getElementById('chartPeriod');
    if (chartPeriod) {
        chartPeriod.addEventListener('change', () => {
            renderTrendChart();
        });
    }
    
    // Back button for detail page
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            const detailPage = document.getElementById('detailPage');
            const mainContent = document.querySelector('.main-content');
            if (detailPage) detailPage.style.display = 'none';
            if (mainContent) mainContent.style.display = 'block';
        });
    }
    
    // Housing region selector
    const housingRegionSelect = document.getElementById('housingRegionSelect');
    if (housingRegionSelect) {
        housingRegionSelect.addEventListener('change', () => {
            renderHousingIndicators(); // Re-render with region filter
        });
    }
}

/**
 * Show compare commodity selector
 * Creates a dropdown list to select commodities to compare
 */
function showCompareModal() {
    const availableCommodities = AppState.commodities.filter(c => 
        c.historicalRecords && 
        c.historicalRecords.length > 0 &&
        c.hasValue
    );
    
    const primaryProduct = AppState.chartState.primaryCommodity;
    if (!primaryProduct) {
        showToast('Please select a primary commodity first', 'warning');
        return;
    }
    
    // Filter out already selected commodities
    const availableToCompare = availableCommodities.filter(c => 
        c.product !== primaryProduct && 
        !AppState.chartState.comparedCommodities.includes(c.product)
    );
    
    if (availableToCompare.length === 0) {
        showToast('No additional commodities available to compare', 'info');
        return;
    }
    
    // Create a simple select element for comparison
    const select = document.createElement('select');
    select.className = 'chart-commodity';
    select.style.marginTop = '8px';
    select.innerHTML = '<option value="">Select to compare...</option>' +
        availableToCompare.map(c => `<option value="${escapeHtml(c.product)}">${escapeHtml(c.product)}</option>`).join('');
    
    // Create a modal-like overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 24px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); max-width: 400px; width: 90%;';
    modal.innerHTML = `
        <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600;">Compare Commodity</h3>
        <p style="margin: 0 0 12px 0; color: #666; font-size: 14px;">Select a commodity to compare with ${escapeHtml(primaryProduct)}:</p>
    `;
    modal.appendChild(select);
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'compare-btn';
    cancelBtn.style.background = '#efeff1';
    cancelBtn.style.color = '#333';
    cancelBtn.onclick = () => document.body.removeChild(overlay);
    
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.className = 'compare-btn';
    addBtn.onclick = () => {
        const selected = select.value;
        if (selected) {
            if (!AppState.chartState.comparedCommodities.includes(selected)) {
                AppState.chartState.comparedCommodities.push(selected);
                renderTrendChart();
                updateCompareButtonState();
                showToast(`Added ${selected} to comparison`, 'success');
            }
        }
        document.body.removeChild(overlay);
    };
    
    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(addBtn);
    modal.appendChild(buttonContainer);
    overlay.appendChild(modal);
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    };
    
    document.body.appendChild(overlay);
    select.focus();
}

// ============================================
// UI HELPERS
// ============================================
/**
 * Show commodity detail modal
 * 
 * @param {Object} commodity - Commodity object
 */
/**
 * Show comprehensive commodity detail page
 * Full-page view with analytics, moving averages, predictions, and export
 * 
 * @param {Object} commodity - Commodity object
 */
function showCommodityDetail(commodity) {
    // Hide main dashboard
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.style.display = 'none';
    
    // Show detail page
    const detailPage = document.getElementById('detailPage');
    const detailPageContent = document.getElementById('detailPageContent');
    const detailPageTitle = document.getElementById('detailPageTitle');
    const detailPageSubtitle = document.getElementById('detailPageSubtitle');
    
    if (!detailPage || !detailPageContent) {
        // Fallback to modal if detail page doesn't exist
        showCommodityDetailModal(commodity);
        return;
    }
    
    detailPage.style.display = 'block';
    const region = extractRegionFromProduct(commodity.product);
    const regionLabel = region ? ` (${region})` : (commodity.material === 'housing' && commodity.subcategory === 'Prices' && !region ? ' (Whole US)' : '');
    detailPageTitle.textContent = commodity.product + regionLabel;
    detailPageSubtitle.innerHTML = `
        <span class="detail-badge">${escapeHtml(commodity.material || 'N/A')}</span>
        <span class="detail-badge">${escapeHtml(commodity.subcategory || 'N/A')}</span>
        <span class="detail-badge">${escapeHtml(commodity.source || 'Unknown')}</span>
        ${region ? `<span class="detail-badge">Region: ${escapeHtml(region)}</span>` : ''}
    `;
    
    // Calculate analytics for this commodity
    const analytics = calculateCommodityAnalytics(commodity);
    const predictions = analytics.hasData ? generatePredictions(commodity, analytics) : { hasPrediction: false };
    
    // Render detail page content
    detailPageContent.innerHTML = renderCommodityDetailPage(commodity, analytics, predictions);
    
    // Initialize charts - always try to render, even if analytics says no data
    setTimeout(() => {
        renderCommodityDetailCharts(commodity, analytics);
        setupDetailPageControls(commodity, analytics);
    }, 100);
    
    // Setup export button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.onclick = () => exportCommodityData(commodity);
    }
}

/**
 * Show simple commodity detail modal (fallback)
 */
function showCommodityDetailModal(commodity) {
    const modal = document.getElementById('detailModal');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    
    if (!modal || !modalBody || !modalTitle) return;
    
    modalTitle.textContent = commodity.product;
    
    modalBody.innerHTML = `
        <div class="detail-section">
            <div class="detail-row">
                <span class="detail-label">Material:</span>
                <span class="detail-value">${escapeHtml(commodity.material || 'N/A')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Subcategory:</span>
                <span class="detail-value">${escapeHtml(commodity.subcategory || 'N/A')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Price:</span>
                <span class="detail-value large">${commodity.displayValue}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Unit:</span>
                <span class="detail-value">${escapeHtml(commodity.unit || 'N/A')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Source:</span>
                <span class="detail-value">${escapeHtml(commodity.source || 'Unknown')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Date:</span>
                <span class="detail-value">${formatDate(commodity.date)}</span>
            </div>
            ${commodity.trend && commodity.trend.direction !== 'neutral' ? `
                <div class="detail-row">
                    <span class="detail-label">Trend:</span>
                    <span class="detail-value ${commodity.trend.direction}">
                        ${getTrendIcon(commodity.trend.direction)} ${commodity.trend.percentage}% (${commodity.trend.timeframe || '7 days'})
                    </span>
                </div>
            ` : ''}
            ${commodity.alerts.length > 0 ? `
                <div class="detail-alerts">
                    <h4>Alerts</h4>
                    ${commodity.alerts.map(a => `
                        <div class="alert-item ${a.type}">
                            <span>${a.icon}</span>
                            <span>${a.message}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
    
    modal.classList.add('active');
}

/**
 * Calculate comprehensive analytics for a commodity
 */
function calculateCommodityAnalytics(commodity) {
    const records = commodity.historicalRecords || [];
    const validRecords = records.filter(r => r.hasValue && r.value !== null && r.value !== undefined);
    
    if (validRecords.length === 0) {
        return {
            hasData: false,
            message: 'Insufficient historical data for analysis'
        };
    }
    
    // Sort by date
    validRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const values = validRecords.map(r => r.value);
    const dates = validRecords.map(r => r.date);
    const dataFreq = getDataFrequency(validRecords);
    
    // For monthly data, use 3/6/12-point MAs; for daily, use 7/30/90
    const maPeriods = dataFreq === 'monthly' ? [3, 6, 12] : [7, 30, 90];
    const ma7 = calculateMovingAverage(values, maPeriods[0]);
    const ma30 = calculateMovingAverage(values, maPeriods[1]);
    const ma90 = calculateMovingAverage(values, maPeriods[2]);
    
    // Basic statistics
    const currentValue = values[values.length - 1];
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const avgValue = values.reduce((a, b) => a + b, 0) / values.length;
    
    // Volatility (standard deviation)
    const variance = values.reduce((acc, val) => acc + Math.pow(val - avgValue, 2), 0) / values.length;
    const volatility = Math.sqrt(variance);
    const volatilityPercent = (volatility / avgValue) * 100;
    
    // Price changes (frequency-aware: monthly uses 1/3/12 month lookbacks)
    const idx1 = dataFreq === 'monthly' ? Math.max(0, values.length - 2) : Math.max(0, values.length - 31);
    const idx3 = dataFreq === 'monthly' ? Math.max(0, values.length - 4) : Math.max(0, values.length - 91);
    const change7d = values.length >= 2 ? ((currentValue - values[Math.max(0, values.length - 8)]) / values[Math.max(0, values.length - 8)]) * 100 : 0;
    const change30d = values.length >= 2 ? ((currentValue - values[idx1]) / values[idx1]) * 100 : 0;
    const change90d = values.length >= 2 ? ((currentValue - values[idx3]) / values[idx3]) * 100 : 0;
    
    // Trend analysis
    const recentTrend = calculateTrendDirection(values.slice(-7));
    const mediumTrend = calculateTrendDirection(values.slice(-30));
    const longTrend = calculateTrendDirection(values);
    
    return {
        hasData: true,
        currentValue,
        minValue,
        maxValue,
        avgValue,
        volatility,
        volatilityPercent: volatilityPercent.toFixed(2),
        movingAverages: {
            ma7: ma7[ma7.length - 1],
            ma30: ma30[ma30.length - 1],
            ma90: ma90[ma90.length - 1],
            ma7Data: ma7,
            ma30Data: ma30,
            ma90Data: ma90
        },
        priceChanges: {
            change7d: change7d.toFixed(2),
            change30d: change30d.toFixed(2),
            change90d: change90d.toFixed(2)
        },
        trends: {
            recent: recentTrend,
            medium: mediumTrend,
            long: longTrend
        },
        dataPoints: validRecords.length,
        dateRange: {
            start: dates[0],
            end: dates[dates.length - 1],
            minDate: dates[values.indexOf(minValue)],
            maxDate: dates[values.indexOf(maxValue)]
        },
        values,
        dates
    };
}

/**
 * Calculate moving average
 */
function calculateMovingAverage(values, period) {
    const result = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else {
            const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            result.push(sum / period);
        }
    }
    return result;
}

/**
 * Calculate trend direction
 */
function calculateTrendDirection(values) {
    if (values.length < 2) return 'neutral';
    const first = values[0];
    const last = values[values.length - 1];
    const change = ((last - first) / first) * 100;
    
    if (Math.abs(change) < 1) return 'neutral';
    return change > 0 ? 'up' : 'down';
}

/**
 * Generate predictions based on moving averages and trends
 */
function generatePredictions(commodity, analytics) {
    if (!analytics.hasData) {
        return {
            hasPrediction: false,
            message: 'Insufficient data for predictions'
        };
    }
    
    const { currentValue, movingAverages, trends, volatilityPercent } = analytics;
    const { ma7, ma30, ma90 } = movingAverages;
    
    // Simple prediction based on moving averages
    let predictedValue = currentValue;
    let confidence = 'low';
    let direction = 'neutral';
    
    // If we have enough moving averages, use weighted average
    if (ma7 && ma30 && ma90) {
        // Weight recent data more heavily
        predictedValue = (ma7 * 0.5) + (ma30 * 0.3) + (ma90 * 0.2);
        confidence = volatilityPercent < 5 ? 'high' : volatilityPercent < 15 ? 'medium' : 'low';
    } else if (ma7 && ma30) {
        predictedValue = (ma7 * 0.6) + (ma30 * 0.4);
        confidence = 'medium';
    } else if (ma7) {
        predictedValue = ma7;
        confidence = 'low';
    }
    
    // Determine direction
    if (predictedValue > currentValue * 1.02) {
        direction = 'up';
    } else if (predictedValue < currentValue * 0.98) {
        direction = 'down';
    } else {
        direction = 'neutral';
    }
    
    const changePercent = ((predictedValue - currentValue) / currentValue) * 100;
    
    // Generate insights
    const insights = [];
    
    if (trends.recent === 'up' && trends.medium === 'up') {
        insights.push('Strong upward momentum across short and medium term');
    } else if (trends.recent === 'down' && trends.medium === 'down') {
        insights.push('Declining trend in both short and medium term');
    } else if (trends.recent !== trends.medium) {
        insights.push('Mixed signals: recent trend differs from medium-term trend');
    }
    
    if (volatilityPercent > 20) {
        insights.push('High volatility detected - expect significant price swings');
    } else if (volatilityPercent < 5) {
        insights.push('Low volatility - relatively stable pricing');
    }
    
    if (ma7 > ma30 && ma30 > ma90) {
        insights.push('All moving averages trending upward - bullish pattern');
    } else if (ma7 < ma30 && ma30 < ma90) {
        insights.push('All moving averages trending downward - bearish pattern');
    }
    
    return {
        hasPrediction: true,
        predictedValue: predictedValue.toFixed(2),
        currentValue: currentValue.toFixed(2),
        changePercent: changePercent.toFixed(2),
        direction,
        confidence,
        insights,
        timeframe: '30 days'
    };
}

/**
 * Render comprehensive commodity detail page HTML
 */
function renderCommodityDetailPage(commodity, analytics, predictions) {
    // Ensure analytics object exists even if no data
    if (!analytics) {
        analytics = { hasData: false };
    }
    if (!predictions) {
        predictions = { hasPrediction: false };
    }
    
    const typeConfig = getCommodityTypeConfig(commodity);
    const records = commodity.historicalRecords || [];
    const validRecords = records.filter(r => r.hasValue && r.value !== null);
    const dataFreq = getDataFrequency(validRecords);
    const isMonthly = dataFreq === 'monthly';
    
    // Period button config: monthly data uses 3m/6m/1y, daily uses 7d/30d/90d
    const periodButtons = isMonthly 
        ? [
            { period: 'all', label: 'All Time' },
            { period: '1y', label: '1 Year' },
            { period: '6m', label: '6 Months' },
            { period: '3m', label: '3 Months' }
        ]
        : [
            { period: 'all', label: 'All Time' },
            { period: '90d', label: '90 Days' },
            { period: '30d', label: '30 Days' },
            { period: '7d', label: '7 Days' }
        ];
    
    return `
        <div class="detail-page-wrapper" data-frequency="${dataFreq}">
            <!-- Understanding this metric -->
            <section class="detail-understanding-section">
                <h3>Understanding this metric</h3>
                <div class="understanding-grid">
                    <div class="understanding-card">
                        <strong>How it's measured:</strong>
                        <p>${escapeHtml(typeConfig.howMeasured)}</p>
                    </div>
                    <div class="understanding-card">
                        <strong>What to gauge it by:</strong>
                        <p>${escapeHtml(typeConfig.whatToGauge)}</p>
                    </div>
                    ${typeConfig.unitExplanation ? `
                    <div class="understanding-card full-width">
                        <strong>Unit:</strong> ${escapeHtml(typeConfig.unitExplanation)} — ${escapeHtml(commodity.unit || 'N/A')}
                    </div>
                    ` : ''}
                </div>
            </section>
            
            <!-- Key Metrics Section -->
            <section class="detail-metrics-section">
                <div class="metric-card primary">
                    <div class="metric-label">${typeConfig.valueLabel}</div>
                    <div class="metric-value">${typeConfig.valueTransform && commodity.value != null ? formatValue(typeConfig.valueTransform(commodity.value), 'Percent', 'housing') : (commodity.displayValue || 'N/A')}</div>
                    <div class="metric-unit">${typeConfig.valueTransform && commodity.value > 20 ? 'APR' : escapeHtml(commodity.unit || '')}</div>
                </div>
                ${analytics && analytics.hasData ? `
                    <div class="metric-card">
                        <div class="metric-label">${isMonthly ? '1-Month' : '30-Day'} ${typeConfig.changeLabel}</div>
                        <div class="metric-value ${analytics.priceChanges.change30d >= 0 ? 'positive' : 'negative'}">
                            ${analytics.priceChanges.change30d >= 0 ? '+' : ''}${analytics.priceChanges.change30d}%
                        </div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Volatility</div>
                        <div class="metric-value">${analytics.volatilityPercent}%</div>
                        <div class="metric-subtext">Variation around average</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Data Points</div>
                        <div class="metric-value">${analytics.dataPoints}</div>
                        <div class="metric-subtext">${dataFreq === 'monthly' ? 'Monthly observations' : 'Data points in history'}</div>
                    </div>
                ` : ''}
            </section>
            
            <!-- Price History Chart -->
            <section class="detail-chart-section">
                <div class="section-header">
                    <h2>${typeConfig.chartLabel} History & Moving Averages</h2>
                    <div class="chart-controls">
                        ${periodButtons.map((pb, i) => `
                            <button class="chart-btn ${i === 0 ? 'active' : ''}" data-period="${pb.period}">${pb.label}</button>
                        `).join('')}
                        <button class="export-chart-btn" id="exportDetailChartBtn" title="Export chart data">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                            </svg>
                            Export
                        </button>
                    </div>
                </div>
                <div class="chart-container-large">
                    <canvas id="detailPriceChart"></canvas>
                </div>
            </section>
            
            ${analytics.hasData ? `
                <!-- Analytics Section -->
                <section class="detail-analytics-section">
                    <h2>Analytics & Insights</h2>
                    ${(() => {
                        const insights = typeConfig.insights(analytics);
                        if (insights && insights.length > 0) {
                            return `
                            <div class="insights-summary">
                                <h3>Key takeaways</h3>
                                <ul>
                                    ${insights.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
                                </ul>
                            </div>
                            `;
                        }
                        return '';
                    })()}
                    <div class="analytics-grid">
                        <div class="analytics-card">
                            <h3>${typeConfig.primaryLabel} Statistics</h3>
                            <div class="stat-row">
                                <span class="stat-label">Current:</span>
                                <span class="stat-value">${formatValue(analytics.currentValue, commodity.unit, commodity.material)}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Average:</span>
                                <span class="stat-value">${formatValue(analytics.avgValue, commodity.unit, commodity.material)}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Minimum:</span>
                                <span class="stat-value">${formatValue(analytics.minValue, commodity.unit, commodity.material)}</span>
                                ${analytics.dateRange && analytics.dateRange.minDate ? `<span class="stat-timeframe">(${formatDate(analytics.dateRange.minDate)})</span>` : ''}
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Maximum:</span>
                                <span class="stat-value">${formatValue(analytics.maxValue, commodity.unit, commodity.material)}</span>
                                ${analytics.dateRange && analytics.dateRange.maxDate ? `<span class="stat-timeframe">(${formatDate(analytics.dateRange.maxDate)})</span>` : ''}
                            </div>
                            ${analytics.dateRange ? `
                                <div class="stat-row stat-timeframe-info">
                                    <span class="stat-label">Timeframe:</span>
                                    <span class="stat-value">${formatDate(analytics.dateRange.start)} - ${formatDate(analytics.dateRange.end)}</span>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="analytics-card">
                            <h3>Moving Averages</h3>
                            <div class="stat-row">
                                <span class="stat-label">${typeConfig.maShortLabel}:</span>
                                <span class="stat-value">${formatValue(analytics.movingAverages.ma7, commodity.unit, commodity.material)}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">${typeConfig.maMediumLabel}:</span>
                                <span class="stat-value">${formatValue(analytics.movingAverages.ma30, commodity.unit, commodity.material)}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">${typeConfig.maLongLabel}:</span>
                                <span class="stat-value">${formatValue(analytics.movingAverages.ma90, commodity.unit, commodity.material)}</span>
                            </div>
                        </div>
                        
                        <div class="analytics-card">
                            <h3>Trend Analysis</h3>
                            <div class="stat-row">
                                <span class="stat-label">Recent (7d):</span>
                                <span class="stat-value ${analytics.trends.recent}">
                                    ${getTrendIcon(analytics.trends.recent)} ${analytics.trends.recent}
                                </span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Medium (30d):</span>
                                <span class="stat-value ${analytics.trends.medium}">
                                    ${getTrendIcon(analytics.trends.medium)} ${analytics.trends.medium}
                                </span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Long-term:</span>
                                <span class="stat-value ${analytics.trends.long}">
                                    ${getTrendIcon(analytics.trends.long)} ${analytics.trends.long}
                                </span>
                            </div>
                        </div>
                    </div>
                </section>
                
                <!-- Predictions Section -->
                ${predictions.hasPrediction ? `
                    <section class="detail-predictions-section">
                        <h2>${commodity.material === 'housing' ? 'Value Forecast' : 'Price Forecast'} <span class="beta-badge">BETA</span></h2>
                        <div class="prediction-card ${predictions.direction}">
                            <div class="prediction-header">
                                <span class="prediction-label">30-Day Forecast</span>
                                <span class="prediction-confidence ${predictions.confidence}">${predictions.confidence} confidence</span>
                            </div>
                            <div class="prediction-value">
                                <span class="current">${formatValue(predictions.currentValue, commodity.unit, commodity.material)}</span>
                                <span class="arrow">→</span>
                                <span class="predicted">${formatValue(predictions.predictedValue, commodity.unit, commodity.material)}</span>
                            </div>
                            <div class="prediction-change ${predictions.direction}">
                                ${predictions.changePercent >= 0 ? '+' : ''}${predictions.changePercent}% ${predictions.direction === 'up' ? '↑' : predictions.direction === 'down' ? '↓' : '→'}
                            </div>
                            ${predictions.insights.length > 0 ? `
                                <div class="prediction-insights">
                                    <h4>Key Insights:</h4>
                                    <ul>
                                        ${predictions.insights.map(insight => `<li>${escapeHtml(insight)}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>
                    </section>
                ` : ''}
            ` : `
                <section class="detail-no-data">
                    <div class="no-data-content">
                        <h3>Limited Data Available</h3>
                        <p>This commodity has limited historical data. The chart below shows available data points.</p>
                        ${commodity.date ? `
                            <div class="data-info">
                                <p><strong>Latest Data:</strong> ${formatDate(commodity.date)}</p>
                                <p><strong>Value:</strong> ${commodity.displayValue || 'N/A'} ${escapeHtml(commodity.unit || '')}</p>
                            </div>
                        ` : ''}
                    </div>
                </section>
            `}
        </div>
    `;
}

/**
 * Render charts for commodity detail page
 * @param {string} period - Optional: 'all', '90d', '30d', '7d' (daily) or '3m', '6m', '1y' (monthly)
 */
function renderCommodityDetailCharts(commodity, analytics, period) {
    const canvas = document.getElementById('detailPriceChart');
    if (!canvas || typeof Chart === 'undefined') return;
    
    const records = commodity.historicalRecords || [];
    let validRecords = records.filter(r => r.hasValue && r.value !== null).sort((a, b) => new Date(a.date) - new Date(b.date));
    const dataFreq = getDataFrequency(validRecords);
    const isMonthly = dataFreq === 'monthly';
    
    // Filter by period if specified
    if (period && period !== 'all' && validRecords.length > 0) {
        const latest = new Date(validRecords[validRecords.length - 1].date);
        let cutoff = new Date(latest);
        if (isMonthly) {
            if (period === '3m') cutoff.setMonth(cutoff.getMonth() - 3);
            else if (period === '6m') cutoff.setMonth(cutoff.getMonth() - 6);
            else if (period === '1y') cutoff.setFullYear(cutoff.getFullYear() - 1);
        } else {
            if (period === '7d') cutoff.setDate(cutoff.getDate() - 7);
            else if (period === '30d') cutoff.setDate(cutoff.getDate() - 30);
            else if (period === '90d') cutoff.setDate(cutoff.getDate() - 90);
        }
        validRecords = validRecords.filter(r => new Date(r.date) >= cutoff);
    }
    
    if (validRecords.length === 0) {
        // Show message if no data
        const chartContainer = canvas.parentElement;
        if (chartContainer) {
            chartContainer.innerHTML = '<div class="no-data-message">No historical data available for this commodity.</div>';
        }
        return;
    }
    
    const labels = validRecords.map(r => formatDate(r.date));
    const prices = validRecords.map(r => r.value);
    
    // Align MA arrays with filtered data (slice to same length when period filter applied)
    let ma7Data = analytics?.movingAverages?.ma7Data;
    let ma30Data = analytics?.movingAverages?.ma30Data;
    let ma90Data = analytics?.movingAverages?.ma90Data;
    if (analytics && ma7Data && validRecords.length < (analytics.dataPoints || 0)) {
        const start = analytics.dataPoints - validRecords.length;
        ma7Data = ma7Data.slice(start);
        ma30Data = ma30Data ? ma30Data.slice(start) : null;
        ma90Data = ma90Data ? ma90Data.slice(start) : null;
    }
    
    const typeConfig = getCommodityTypeConfig(commodity);
    const ctx = canvas.getContext('2d');
    const detailPointRadius = labels.length <= 5 ? 5 : 0;
    
    // Destroy existing chart if present
    if (AppState.detailChart) {
        AppState.detailChart.destroy();
    }
    
    AppState.detailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: typeConfig.chartLabel,
                    data: prices,
                    borderColor: STOAColors.green || '#7e8a6b',
                    backgroundColor: STOAColors.green + '20',
                    borderWidth: 4,
                    fill: true,
                    tension: 0.3,
                    spanGaps: true,
                    pointRadius: detailPointRadius,
                    pointHoverRadius: 10,
                    pointHitRadius: 15
                },
                ma7Data && ma7Data.length > 0 ? {
                    label: typeConfig.maShortLabel,
                    data: ma7Data,
                    borderColor: STOAColors.blue || '#bdc2ce',
                    borderWidth: 3,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.3,
                    spanGaps: true,
                    pointRadius: detailPointRadius,
                    pointHoverRadius: 8,
                    pointHitRadius: 12
                } : null,
                ma30Data && ma30Data.length > 0 ? {
                    label: typeConfig.maMediumLabel,
                    data: ma30Data,
                    borderColor: STOAColors.green2 || '#a6ad8a',
                    borderWidth: 3,
                    borderDash: [10, 5],
                    fill: false,
                    tension: 0.3,
                    spanGaps: true,
                    pointRadius: detailPointRadius,
                    pointHoverRadius: 8,
                    pointHitRadius: 12
                } : null,
                ma90Data && ma90Data.length > 0 ? {
                    label: typeConfig.maLongLabel,
                    data: ma90Data,
                    borderColor: STOAColors.grey || '#757270',
                    borderWidth: 3,
                    borderDash: [15, 5],
                    fill: false,
                    tension: 0.3,
                    spanGaps: true,
                    pointRadius: detailPointRadius,
                    pointHoverRadius: 8,
                    pointHitRadius: 12
                } : null
            ].filter(Boolean)
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
                axis: 'x'
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${formatValue(context.parsed.y, commodity.unit, commodity.material)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        callback: function(value) {
                            return formatValue(value, commodity.unit, commodity.material);
                        }
                    },
                    // For mortgage rates and treasury bills, set normalized scale (less drastic movements)
                    ...(commodity.subcategory === 'Mortgage Rates' || commodity.subcategory === 'Treasury Bills' ? {
                        min: function(context) {
                            const values = context.chart.data.datasets[0].data.filter(v => v !== null && v !== undefined);
                            if (values.length === 0) return 0;
                            const min = Math.min(...values);
                            const max = Math.max(...values);
                            const range = max - min;
                            const padding = Math.max(0.1, range * 0.05); // 5% padding for normalized view
                            return Math.max(0, min - padding);
                        },
                        max: function(context) {
                            const values = context.chart.data.datasets[0].data.filter(v => v !== null && v !== undefined);
                            if (values.length === 0) return 10;
                            const min = Math.min(...values);
                            const max = Math.max(...values);
                            const range = max - min;
                            const padding = Math.max(0.1, range * 0.05); // 5% padding for normalized view
                            return max + padding;
                        },
                        ticks: {
                            stepSize: 0.25
                        }
                    } : {})
                }
            }
        }
    });
}

/**
 * Wire up detail page chart controls (period buttons, export)
 */
function setupDetailPageControls(commodity, analytics) {
    const wrapper = document.querySelector('.detail-page-wrapper');
    if (!wrapper) return;
    
    // Chart period buttons
    wrapper.querySelectorAll('.chart-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            wrapper.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const period = this.dataset.period;
            renderCommodityDetailCharts(commodity, analytics, period);
        });
    });
    
    // Export chart button
    const exportBtn = document.getElementById('exportDetailChartBtn');
    if (exportBtn) {
        exportBtn.onclick = () => exportCommodityData(commodity);
    }
}

/**
 * Analyze datasets to determine if dual Y-axes are needed
 * Returns object with scale groups and axis assignments
 */
function analyzeScaleGroups(datasets) {
    if (datasets.length <= 1) {
        return { needsDualAxis: false, groups: [] };
    }
    
    // Calculate min/max for each dataset
    const ranges = datasets.map((dataset, index) => {
        const values = dataset.data.filter(v => v !== null && v !== undefined && !isNaN(v));
        if (values.length === 0) return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = (min + max) / 2;
        return { index, min, max, avg, range: max - min };
    }).filter(r => r !== null);
    
    if (ranges.length <= 1) {
        return { needsDualAxis: false, groups: [] };
    }
    
    // Check if there's a significant scale difference
    // Lower threshold (1.5x) to catch cases like construction where values differ meaningfully
    const avgValues = ranges.map(r => r.avg);
    const minAvg = Math.min(...avgValues);
    const maxAvg = Math.max(...avgValues);
    
    // If the ratio between largest and smallest average exceeds 1.5x, use dual axis
    const needsDualAxis = maxAvg > 0 && minAvg > 0 && (maxAvg / minAvg) > 1.5;
    
    if (!needsDualAxis) {
        return { needsDualAxis: false, groups: [] };
    }
    
    // Group datasets by scale (high vs low)
    const scaleThreshold = Math.sqrt(minAvg * maxAvg); // Geometric mean as threshold
    const highScaleGroup = ranges.filter(r => r.avg >= scaleThreshold).map(r => r.index);
    const lowScaleGroup = ranges.filter(r => r.avg < scaleThreshold).map(r => r.index);
    
    return {
        needsDualAxis: true,
        groups: [
            { indices: highScaleGroup, axis: 'y', position: 'left' },
            { indices: lowScaleGroup, axis: 'y1', position: 'right' }
        ]
    };
}

/**
 * Render material-specific comparison chart
 */
function renderMaterialComparisonChart(material, commodities) {
    const section = document.getElementById('materialComparisonSection');
    const canvas = document.getElementById('materialComparisonChart');
    const title = document.getElementById('materialComparisonTitle');
    
    if (!section || !canvas || typeof Chart === 'undefined') return;
    
    // Filter commodities with valid historical data
    const validCommodities = commodities.filter(c => 
        c.historicalRecords && 
        c.historicalRecords.length > 0 && 
        c.hasValue &&
        c.material === material
    );
    
    if (validCommodities.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    const materialName = material.charAt(0).toUpperCase() + material.slice(1);
    
    // Get all unique dates across all commodities
    const allDates = new Set();
    validCommodities.forEach(c => {
        c.historicalRecords.forEach(r => {
            if (r.hasValue && r.date) allDates.add(r.date);
        });
    });
    const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));
    
    // Use 365 days to capture monthly FRED/PPI data (~12 points); fallback to all if sparse
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365);
    let recentDates = sortedDates.filter(d => new Date(d) >= cutoffDate);
    if (recentDates.length < 2) recentDates = sortedDates;
    if (recentDates.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    const useBarChart = recentDates.length === 1;
    if (title) {
        title.textContent = useBarChart
            ? `${materialName} Price Comparison (as of ${formatDate(recentDates[0])})`
            : `${materialName} Price Trends Comparison`;
    }
    
    const colors = [
        STOAColors.green || '#7e8a6b',
        STOAColors.blue || '#bdc2ce',
        STOAColors.green2 || '#a6ad8a',
        STOAColors.grey || '#757270',
        '#4caf50',
        '#f44336',
        '#ff9800',
        '#2196f3',
        '#9c27b0',
        '#00bcd4'
    ];
    
    // Create datasets for each commodity
    const datasets = validCommodities.slice(0, 10).map((commodity, index) => {
        const data = recentDates.map(date => {
            const record = commodity.historicalRecords.find(r => r.date === date && r.hasValue);
            return record ? record.value : null;
        });
        
        const color = colors[index % colors.length];
        const pointRadius = recentDates.length <= 5 ? 5 : 0;
        const base = {
            label: commodity.product,
            data: data,
            backgroundColor: color + (useBarChart ? 'cc' : '20'),
            borderColor: color,
            borderWidth: useBarChart ? 1 : 2,
            pointHoverRadius: 10,
            pointHitRadius: 15
        };
        if (useBarChart) {
            return base;
        }
        return {
            ...base,
            fill: false,
            tension: 0.3,
            spanGaps: true,
            pointRadius
        };
    });
    
    // Analyze if dual Y-axes are needed
    const scaleAnalysis = analyzeScaleGroups(datasets);
    
    // Assign datasets to appropriate Y-axis
    if (scaleAnalysis.needsDualAxis) {
        scaleAnalysis.groups.forEach(group => {
            group.indices.forEach(idx => {
                datasets[idx].yAxisID = group.axis;
            });
        });
    }
    
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart
    if (AppState.materialComparisonChart) {
        AppState.materialComparisonChart.destroy();
    }
    
    // Build scales configuration
    const scalesConfig = {
        x: {
            grid: {
                color: 'rgba(224, 224, 224, 0.3)'
            },
            ticks: {
                maxTicksLimit: 10,
                font: {
                    size: 11
                }
            }
        },
        y: {
            type: 'linear',
            position: 'left',
            beginAtZero: false,
            grid: {
                color: 'rgba(224, 224, 224, 0.5)',
                drawOnChartArea: !scaleAnalysis.needsDualAxis
            },
            ticks: {
                callback: function(value) {
                    return formatValue(value, '', material);
                },
                font: {
                    size: 11
                }
            }
        }
    };
    
    // Add right Y-axis if needed
    if (scaleAnalysis.needsDualAxis) {
        const rightAxisGroup = scaleAnalysis.groups.find(g => g.position === 'right');
        const leftAxisGroup = scaleAnalysis.groups.find(g => g.position === 'left');
        
        // Update left axis to not draw grid on chart area
        scalesConfig.y.grid.drawOnChartArea = false;
        
        // Add right axis
        scalesConfig.y1 = {
            type: 'linear',
            position: 'right',
            beginAtZero: false,
            grid: {
                color: 'rgba(224, 224, 224, 0.3)',
                drawOnChartArea: false
            },
            ticks: {
                callback: function(value) {
                    return formatValue(value, '', material);
                },
                font: {
                    size: 11
                }
            }
        };
    }
    
    AppState.materialComparisonChart = new Chart(ctx, {
        type: useBarChart ? 'bar' : 'line',
        data: {
            labels: recentDates.map(d => formatDate(d)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
                axis: 'x'
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: {
                            size: 11
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            const commodity = validCommodities[context.datasetIndex];
                            return `${context.dataset.label}: ${formatValue(context.parsed.y, commodity?.unit || '', material)}`;
                        }
                    }
                }
            },
            scales: scalesConfig
        }
    });
}

/**
 * Render housing starts comparison chart across regions
 */
function renderHousingStartsComparisonChart() {
    const section = document.getElementById('materialComparisonSection');
    const canvas = document.getElementById('materialComparisonChart');
    const title = document.getElementById('materialComparisonTitle');
    
    if (!section || !canvas || typeof Chart === 'undefined') return;
    
    const housingStarts = AppState.commodities.filter(c => 
        c.material === 'housing' && 
        c.subcategory === 'Housing Starts' &&
        c.historicalRecords && 
        c.historicalRecords.length > 0 && 
        c.hasValue
    );
    
    if (housingStarts.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    if (title) title.textContent = 'Housing Starts Comparison by Region';
    
    // Get all unique dates
    const allDates = new Set();
    housingStarts.forEach(c => {
        c.historicalRecords.forEach(r => {
            if (r.hasValue && r.date) allDates.add(r.date);
        });
    });
    const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));
    
    // Use 365 days for monthly housing data; fallback to all if sparse
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365);
    let recentDates = sortedDates.filter(d => new Date(d) >= cutoffDate);
    if (recentDates.length < 2) recentDates = sortedDates;
    
    // Group by region
    const regions = ['Northeast', 'Midwest', 'South', 'West'];
    const housingPointRadius = recentDates.length <= 5 ? 5 : 0;
    const datasets = regions.map((region, index) => {
        const commodity = housingStarts.find(c => extractRegionFromProduct(c.product) === region);
        if (!commodity) return null;
        
        const data = recentDates.map(date => {
            const record = commodity.historicalRecords.find(r => r.date === date && r.hasValue);
            return record ? record.value : null;
        });
        
        const colors = [
            STOAColors.green || '#7e8a6b',
            STOAColors.blue || '#bdc2ce',
            STOAColors.green2 || '#a6ad8a',
            STOAColors.grey || '#757270'
        ];
        
        return {
            label: `${region} Housing Starts`,
            data: data,
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '20',
            borderWidth: 3,
            fill: false,
            tension: 0.3,
            spanGaps: true,
            pointRadius: housingPointRadius,
            pointHoverRadius: 10,
            pointHitRadius: 15
        };
    }).filter(Boolean);
    
    // Analyze if dual Y-axes are needed
    const scaleAnalysis = analyzeScaleGroups(datasets);
    
    // Assign datasets to appropriate Y-axis
    if (scaleAnalysis.needsDualAxis) {
        scaleAnalysis.groups.forEach(group => {
            group.indices.forEach(idx => {
                datasets[idx].yAxisID = group.axis;
            });
        });
    }
    
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart
    if (AppState.materialComparisonChart) {
        AppState.materialComparisonChart.destroy();
    }
    
    // Build scales configuration
    const scalesConfig = {
        x: {
            grid: {
                color: 'rgba(224, 224, 224, 0.3)'
            },
            ticks: {
                maxTicksLimit: 10
            }
        },
        y: {
            type: 'linear',
            position: 'left',
            beginAtZero: false,
            grid: {
                color: 'rgba(224, 224, 224, 0.5)',
                drawOnChartArea: !scaleAnalysis.needsDualAxis
            },
            ticks: {
                callback: function(value) {
                    return formatValue(value, 'Thousands of Units (SAAR)', 'housing');
                }
            }
        }
    };
    
    // Add right Y-axis if needed
    if (scaleAnalysis.needsDualAxis) {
        scalesConfig.y.grid.drawOnChartArea = false;
        
        scalesConfig.y1 = {
            type: 'linear',
            position: 'right',
            beginAtZero: false,
            grid: {
                color: 'rgba(224, 224, 224, 0.3)',
                drawOnChartArea: false
            },
            ticks: {
                callback: function(value) {
                    return formatValue(value, 'Thousands of Units (SAAR)', 'housing');
                }
            }
        };
    }
    
    AppState.materialComparisonChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: recentDates.map(d => formatDate(d)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
                axis: 'x'
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${formatValue(context.parsed.y, 'Thousands of Units (SAAR)', 'housing')}`;
                        }
                    }
                }
            },
            scales: scalesConfig
        }
    });
}

/**
 * Export commodity data to CSV/JSON
 */
function exportCommodityData(commodity) {
    const records = commodity.historicalRecords || [];
    const validRecords = records.filter(r => r.hasValue).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (validRecords.length === 0) {
        showToast('No data available to export', 'warning');
        return;
    }
    
    // Create CSV
    const headers = ['Date', 'Product', 'Value', 'Unit', 'Source', 'Material', 'Subcategory'];
    const csvRows = [headers.join(',')];
    
    validRecords.forEach(record => {
        const row = [
            record.date || '',
            `"${(record.product || commodity.product || '').replace(/"/g, '""')}"`,
            record.value || '',
            `"${(record.unit || commodity.unit || '').replace(/"/g, '""')}"`,
            `"${(record.source || commodity.source || '').replace(/"/g, '""')}"`,
            `"${(record.material || commodity.material || '').replace(/"/g, '""')}"`,
            `"${(record.subcategory || commodity.subcategory || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${commodity.product.replace(/[^a-z0-9]/gi, '_')}_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('Data exported successfully', 'success');
}

/**
 * Show alert banner
 * 
 * @param {string} message - Alert message
 * @param {string} type - Alert type (error, warning, success, info)
 */
function showAlert(message, type = 'info') {
    const banner = document.getElementById('alertBanner');
    const messageEl = document.getElementById('alertMessage');
    const iconEl = document.getElementById('alertIcon');
    
    if (!banner || !messageEl || !iconEl) return;
    
    const icons = {
        error: '❌',
        warning: '⚠️',
        success: '✅',
        info: 'ℹ️'
    };
    
    iconEl.textContent = icons[type] || icons.info;
    messageEl.textContent = message;
    banner.className = `alert-banner ${type}`;
    banner.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        banner.style.display = 'none';
    }, 5000);
}

/**
 * Show toast notification
 * 
 * @param {string} message - Toast message
 * @param {string} type - Toast type
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Show loading state
 */
function showLoadingState() {
    const loadingState = document.getElementById('loadingState');
    if (loadingState) {
        loadingState.style.display = 'flex';
    }
}

/**
 * Hide loading state
 */
function hideLoadingState() {
    const loadingState = document.getElementById('loadingState');
    if (loadingState) {
        loadingState.style.display = 'none';
    }
}

/**
 * Render empty state
 */
function renderEmptyState() {
    const container = document.getElementById('commoditiesContainer');
    if (!container) return;
    
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">📊</div>
            <h3>No Data Available</h3>
            <p>Commodities data will appear here once available</p>
        </div>
    `;
}

/**
 * Render error state
 */
function renderErrorState() {
    const container = document.getElementById('commoditiesContainer');
    if (!container) return;
    
    container.innerHTML = `
        <div class="empty-state error">
            <div class="empty-icon">⚠️</div>
            <h3>Error Loading Data</h3>
            <p>Please try refreshing or contact support if the issue persists</p>
            <button class="retry-btn" onclick="loadCommoditiesData()">Retry</button>
        </div>
    `;
}

/**
 * Update last update time display
 */
function updateLastUpdateTime() {
    const lastUpdateEl = document.getElementById('lastUpdate');
    if (lastUpdateEl) {
        if (AppState.dataMaxDate) {
            lastUpdateEl.textContent = `Data through ${formatDate(AppState.dataMaxDate)}`;
        } else if (AppState.lastUpdate) {
            lastUpdateEl.textContent = `Updated ${formatRelativeTime(AppState.lastUpdate)}`;
        } else {
            lastUpdateEl.textContent = 'Loading...';
        }
    }
}

// ============================================
// CHART INITIALIZATION
// ============================================
/**
 * Initialize charts
 * Placeholder for Chart.js integration
 */
function initializeCharts() {
    const canvas = document.getElementById('trendChart');
    if (canvas) {
        console.log('[STOA Commodities] Chart canvas ready');
        // Chart.js initialization would go here
        // Example: AppState.chart = new Chart(ctx, { ... });
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
/**
 * Format value with unit
 * 
 * @param {number} value - Numeric value
 * @param {string} unit - Unit string
 * @param {string} material - Optional material type (e.g., 'housing')
 * @returns {string} Formatted value string
 */
function formatValue(value, unit, material = null) {
    const num = typeof value === 'number' && !isNaN(value) ? value : parseFloat(value);
    if (num == null || isNaN(num)) return 'N/A';
    
    // Check if this is housing data or non-currency unit
    const isHousing = material === 'housing';
    const isNonCurrency = unit && (
        unit.includes('Index') ||
        unit.includes('Units') ||
        unit.includes('Percent') ||
        unit.includes('Months') ||
        unit.includes('SAAR') ||
        unit.toLowerCase().includes('percent')
    );
    
    // For housing data or non-currency units, don't use dollar signs
    if (isHousing || isNonCurrency) {
        if (unit && unit.includes('Index')) {
            return num.toFixed(2);
        }
        
        if (unit && (unit.includes('Percent') || unit.toLowerCase().includes('percent'))) {
            return num.toFixed(2) + '%';
        }
        
        // For large numbers, use K/M notation without dollar sign
        if (num >= 1000000) {
            return `${(num / 1000000).toFixed(2)}M`;
        } else if (num >= 1000) {
            return `${(num / 1000).toFixed(2)}K`;
        }
        
        // Format with commas but no dollar sign
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    
    // For currency values (commodities)
    if (num >= 1000000) {
        return `$${(num / 1000000).toFixed(2)}M`;
    } else if (num >= 1000) {
        return `$${(num / 1000).toFixed(2)}K`;
    }
    
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format currency value
 * 
 * @param {number} value - Numeric value
 * @returns {string} Formatted currency string
 */
function formatCurrency(value) {
    if (!value || value === 0) return '$0';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

/**
 * Extract region from housing product name
 * 
 * @param {string} product - Product name
 * @returns {string|null} Region name or null if not found
 */
function extractRegionFromProduct(product) {
    if (!product) return null;
    const regions = ['Northeast', 'Midwest', 'South', 'West'];
    for (const region of regions) {
        if (product.includes(region)) {
            return region;
        }
    }
    return null;
}

/**
 * Get housing data frequency and timeframe description
 * 
 * @param {string} subcategory - Housing subcategory
 * @param {string} unit - Unit string
 * @returns {Object} Object with frequency and description
 */
function getHousingDataFrequency(subcategory, unit) {
    // Determine frequency based on subcategory and unit
    if (subcategory === 'Prices') {
        return {
            frequency: 'Quarterly',
            description: 'Quarterly data',
            timeframe: 'Quarterly'
        };
    }
    
    if (subcategory === 'Mortgage Rates' || subcategory === 'Treasury Bills') {
        return {
            frequency: 'Monthly',
            description: 'Monthly average',
            timeframe: 'Monthly'
        };
    }
    
    if (unit && unit.includes('SAAR')) {
        return {
            frequency: 'Monthly',
            description: 'Monthly (SAAR - Seasonally Adjusted Annual Rate)',
            timeframe: 'Monthly'
        };
    }
    
    if (subcategory === 'Inventory') {
        return {
            frequency: 'Monthly',
            description: 'Monthly data',
            timeframe: 'Monthly'
        };
    }
    
    // Default to monthly for most housing data
    return {
        frequency: 'Monthly',
        description: 'Monthly data',
        timeframe: 'Monthly'
    };
}

/**
 * Format date string
 * 
 * @param {string} dateString - Date string
 * @returns {string} Formatted date
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            year: 'numeric',
            month: 'short', 
            day: 'numeric' 
        });
    } catch (e) {
        return dateString;
    }
}

/**
 * Format time
 * 
 * @param {Date} date - Date object
 * @returns {string} Formatted time
 */
function formatTime(date) {
    if (!date) return 'N/A';
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

/**
 * Format relative time
 * 
 * @param {Date} date - Date object
 * @returns {string} Relative time string
 */
function formatRelativeTime(date) {
    if (!date) return 'N/A';
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

/**
 * Get trend icon
 * 
 * @param {string} direction - Trend direction (up, down, neutral)
 * @returns {string} Icon/emoji
 */
function getTrendIcon(direction) {
    const icons = {
        up: '↗️',
        down: '↘️',
        neutral: '→'
    };
    return icons[direction] || icons.neutral;
}

/**
 * Escape HTML to prevent XSS
 * 
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Capitalize first letter
 * 
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}
