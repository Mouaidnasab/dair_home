# API Integration Guide

This guide explains how to connect the Home Energy Monitor to your real energy management API.

## Overview

The application is designed to work with a REST API that provides energy data in JSON format. By default, it uses realistic mock data for development and testing. To connect to your real API, you only need to set an environment variable.

## Quick Start

1. **Set your API base URL** in `.env.local`:

```bash
VITE_API_BASE_URL=https://your-api-server.com
VITE_USE_MOCK_DATA=false
```

2. **Restart the development server**:

```bash
pnpm dev
```

The application will now fetch data from your API instead of using mock data.

## API Endpoint Specification

### Endpoint: `/export`

The application makes GET requests to the `/export` endpoint with the following query parameters:

```
GET /export?plantId=<id>&label=<label>&limit=<count>&fmt=json&dedupe=true&hours=<hours>
```

### Query Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-----------|---------|
| `plantId` | string | Yes | Unique identifier for the inverter/plant | `11160008309715425` |
| `label` | string | No | Inverter label for filtering | `Ground_Floor`, `First_Floor` |
| `limit` | integer | No | Maximum number of records to return | `1`, `1000` |
| `fmt` | string | Yes | Response format | `json` |
| `dedupe` | boolean | No | Remove duplicate records | `true` |
| `hours` | integer | No | Time range in hours (for time-series) | `24` |

### Request Examples

**Get latest data point for Ground Floor inverter:**
```
GET /export?plantId=11160008309715425&label=Ground_Floor&limit=1&fmt=json&dedupe=true
```

**Get 24-hour time series data:**
```
GET /export?fmt=json&limit=288&dedupe=true&hours=24
```

**Get all data for First Floor:**
```
GET /export?plantId=11160008309715426&label=First_Floor&fmt=json&dedupe=true
```

## Response Format

The endpoint should return a JSON array of energy records:

```json
[
  {
    "timestamp": "2025-10-20T17:14:00.569839",
    "plantId": "11160008309715425",
    "plantLabel": "Ground_Floor",
    "pd_pvTotalPower": 122,
    "pd_ratedPower": 8,
    "pd_todayPv": 1.71,
    "pd_monthPv": 8.59,
    "pd_yearPv": 8.59,
    "pd_accPv": 8.59,
    "pd_pvTodayIncome": 4275,
    "pd_monthPvIncome": 21492.5,
    "pd_yearPvIncome": 21495,
    "pd_currency": "SYP",
    "pd_countryName": "Syria",
    "pd_cityName": "Deir Attiyeh",
    "pd_status": "N",
    "ef_emsSoc": 58,
    "ef_totalOutPutPower": 0,
    "ef_bmsPower": 100,
    "ef_genPower": 100,
    "ef_acTtlInPower": 80,
    "ef_meterPower": 100,
    "ef_microInvTotalPower": 100,
    "ef_ctThreePhaseTotalPower": 100,
    "pd_electricityPrice": 2500,
    "ef_deviceSn": "020308004825320226",
    "ef_deviceModel": "IVEM8048",
    "pd_installDateStr": "2025-10-16",
    "pd_timeZone": "UTC+02:00"
  }
]
```

## Data Field Reference

### PV/Solar Fields

| Field | Type | Unit | Description |
|-------|------|------|-----------|
| `pd_pvTotalPower` | number | W | Instantaneous PV power output |
| `pd_ratedPower` | number | kWp | Rated power capacity of the array |
| `pd_todayPv` | number | kWh | Energy generated today |
| `pd_monthPv` | number | kWh | Energy generated this month |
| `pd_yearPv` | number | kWh | Energy generated this year |
| `pd_accPv` | number | kWh | Accumulated energy generated (lifetime) |
| `pd_pvTodayIncome` | number | currency | Revenue from today's generation |
| `pd_monthPvIncome` | number | currency | Revenue this month |
| `pd_yearPvIncome` | number | currency | Revenue this year |

### Battery/EMS Fields (Shared)

| Field | Type | Unit | Description |
|-------|------|------|-----------|
| `ef_emsSoc` | number | % | Battery state of charge (0-100) |
| `ef_bmsPower` | number | W | Battery power (+ charging, - discharging) |
| `ef_totalOutPutPower` | number | W | Total load power |

### Grid/Generator Fields

| Field | Type | Unit | Description |
|-------|------|------|-----------|
| `ef_genPower` | number | W | Generator input power |
| `ef_acTtlInPower` | number | W | Grid input power |
| `ef_meterPower` | number | W | Meter power (+ import, - export) |
| `ef_microInvTotalPower` | number | W | Micro-inverter power |
| `ef_ctThreePhaseTotalPower` | number | W | Three-phase load measurement |

### Device/Location Fields

| Field | Type | Description |
|-------|------|-----------|
| `timestamp` | string (ISO 8601) | Record timestamp |
| `plantId` | string | Unique inverter/plant identifier |
| `plantLabel` | string | Human-readable inverter label |
| `ef_deviceSn` | string | Device serial number |
| `ef_deviceModel` | string | Device model name |
| `pd_status` | string | Device status ("N" = Normal) |
| `pd_countryName` | string | Installation country |
| `pd_cityName` | string | Installation city |
| `pd_installDateStr` | string (YYYY-MM-DD) | Installation date |
| `pd_timeZone` | string | Timezone (e.g., "UTC+02:00") |
| `pd_currency` | string | Currency code (e.g., "SYP") |
| `pd_electricityPrice` | number | Local electricity price per kWh |

## Implementation Checklist

- [ ] API endpoint returns data in the specified JSON format
- [ ] All required fields are present in the response
- [ ] Timestamps are in ISO 8601 format (e.g., "2025-10-20T17:14:00.569839")
- [ ] Plant IDs are consistent across requests
- [ ] Status field uses "N" for normal operation
- [ ] Battery SOC is a percentage (0-100)
- [ ] Power values are in watts (W)
- [ ] Energy values are in kilowatt-hours (kWh)
- [ ] Currency code is a valid ISO 4217 code
- [ ] Timezone string is in "UTC±HH:MM" format

## Testing Your API Integration

### 1. Verify Endpoint Accessibility

```bash
curl "https://your-api-server.com/export?plantId=11160008309715425&limit=1&fmt=json"
```

You should receive a JSON array with at least one record.

### 2. Check Response Format

Ensure the response contains all required fields. Missing fields may cause the UI to display incomplete information.

### 3. Test in Development

1. Set `VITE_API_BASE_URL` in `.env.local`
2. Set `VITE_USE_MOCK_DATA=false`
3. Start the dev server: `pnpm dev`
4. Check browser console for any errors
5. Verify data displays correctly in the UI

### 4. Monitor Network Requests

Open browser DevTools (F12) → Network tab to inspect API requests:

- Check request URLs and parameters
- Verify response status codes (200 OK)
- Inspect response payloads for completeness
- Monitor request/response times

## Error Handling

The application handles API errors gracefully:

- **Network Errors**: Displays error banner with retry button
- **Invalid Data**: Falls back to mock data if API response is malformed
- **Missing Fields**: Displays "N/A" or default values for missing data
- **Timeout**: Retries after 30 seconds (polling interval)

## Performance Considerations

### Polling Frequency

The application polls the API every 30 seconds by default. For high-frequency updates:

- Consider implementing WebSocket support for real-time updates
- Optimize database queries to handle frequent requests
- Implement caching strategies on the server side

### Data Volume

For time-series requests (24-hour trends):

- Default limit is ~288 records (5-minute intervals)
- Consider aggregating older data to reduce response size
- Implement pagination for very large datasets

### Rate Limiting

If your API has rate limits:

- The default polling interval (30 seconds) = 2,880 requests per day per client
- Consider implementing exponential backoff on errors
- Cache responses on the client side when possible

## Troubleshooting

### "Failed to fetch data" Error

1. Check that `VITE_API_BASE_URL` is set correctly
2. Verify the API endpoint is accessible from your network
3. Check CORS headers if the API is on a different domain
4. Review browser console for detailed error messages

### Data Not Updating

1. Verify the API is returning fresh data
2. Check that timestamps are being updated
3. Ensure polling interval is appropriate (30 seconds default)
4. Check for network errors in browser DevTools

### Incomplete Data Display

1. Verify all required fields are present in the API response
2. Check field names match exactly (case-sensitive)
3. Ensure numeric fields contain valid numbers (not strings)
4. Verify timestamps are in ISO 8601 format

### CORS Issues

If the API is on a different domain, ensure:

1. API returns `Access-Control-Allow-Origin` header
2. API allows GET requests from your domain
3. No authentication headers are required (or properly configured)

Example CORS headers the API should return:

```
Access-Control-Allow-Origin: https://your-frontend-domain.com
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Advanced Configuration

### Custom API Base URL per Environment

Create separate `.env` files for different environments:

```bash
# .env.local (development)
VITE_API_BASE_URL=http://localhost:8000

# .env.staging (staging)
VITE_API_BASE_URL=https://staging-api.example.com

# .env.production (production)
VITE_API_BASE_URL=https://api.example.com
```

### Fallback to Mock Data

To automatically fallback to mock data when the API is unavailable:

1. Keep `VITE_USE_MOCK_DATA=false`
2. The application will catch API errors and display a retry banner
3. User can click "Retry" to attempt reconnection

### Custom Data Transformation

To transform API responses before display, modify `lib/api.ts`:

```typescript
// In fetchDashboardData()
const dashboard = buildDashboardData(groundFloor, firstFloor);
// Add custom transformations here
return dashboard;
```

## Support

For API integration issues:

1. Review this guide and the main README.md
2. Check the browser console for detailed error messages
3. Verify API response format matches the specification
4. Test API endpoint independently using curl or Postman
5. Contact your API provider for support

---

**Last Updated**: October 20, 2025  
**API Version**: 1.0  
**Application Version**: 1.0.0

