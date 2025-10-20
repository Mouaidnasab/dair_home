# Home Energy Monitor

A production-ready React TypeScript web application for monitoring home energy systems with dual inverters sharing a single battery. The application provides real-time visualization of solar generation, battery status, load consumption, and grid interaction through an intuitive, responsive dashboard.

## Features

**Real-time Energy Monitoring**
- Live display of solar PV power generation from two independent inverters
- Battery state of charge (SOC) with radial gauge visualization
- Load consumption tracking and grid power flow monitoring
- Estimated runtime calculation based on current battery SOC and load

**Dual Inverter Support**
- Separate panels for Ground Floor and First Floor inverters
- Individual PV generation, daily energy, and income tracking per inverter
- Status indicators (Normal/Warning/Fault) with color-coded badges
- Device model and serial number display

**Advanced Data Visualization**
- 24-hour trends chart with multiple data series (PV, Load, Battery, Grid, Generator)
- Dual-axis chart with power (W) on left axis and battery SOC (%) on right axis
- Tabbed interface for viewing Home combined data or individual inverter trends
- Interactive tooltips with formatted values and units

**User Experience**
- Dark mode support with system preference detection and manual toggle
- Fully responsive design (mobile, tablet, desktop)
- Auto-refresh every 30 seconds with loading states and error handling
- Smooth animations and intuitive navigation
- Accessibility-first design with proper ARIA labels and keyboard navigation

**Development Features**
- Mock data layer for development and testing without API dependency
- Easy switch from mock to real API via environment variables
- TypeScript for type safety and better developer experience
- ESLint and Prettier configured for code quality
- Modular component architecture for maintainability

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Frontend Framework** | React 19 + TypeScript |
| **Build Tool** | Vite |
| **Styling** | Tailwind CSS 4 |
| **UI Components** | shadcn/ui |
| **Icons** | lucide-react |
| **Charts** | Recharts |
| **Data Fetching** | Native Fetch API |
| **Routing** | Wouter (single-page app) |
| **Linting** | ESLint + Prettier |

## Project Structure

```
home-energy-monitor/
├── client/
│   ├── public/              # Static assets
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   │   ├── Header.tsx
│   │   │   ├── BatteryCard.tsx
│   │   │   ├── InverterPanel.tsx
│   │   │   ├── TrendsCard.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── ErrorBanner.tsx
│   │   │   └── SkeletonCard.tsx
│   │   ├── contexts/        # React contexts
│   │   │   └── ThemeContext.tsx
│   │   ├── lib/
│   │   │   ├── api.ts       # API service layer
│   │   │   ├── mockData.ts  # Mock data generators
│   │   │   └── utils.ts     # Utility functions
│   │   ├── types/
│   │   │   └── energy.ts    # TypeScript type definitions
│   │   ├── pages/           # Page components
│   │   │   └── Home.tsx
│   │   ├── App.tsx          # Root component
│   │   ├── main.tsx         # Entry point
│   │   └── index.css        # Global styles
│   └── package.json
├── README.md
└── .env.example
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm/pnpm
- Git (for version control)

### Installation

1. **Clone or navigate to the project directory**

```bash
cd home-energy-monitor
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Start the development server**

```bash
pnpm dev
```

The application will be available at `http://localhost:3000`.

### Configuration

The application uses environment variables for configuration. Create a `.env.local` file in the project root:

```bash
# API Configuration (optional - uses mock data by default)
VITE_API_BASE_URL=https://your-api.example.com

# Force mock data even if API URL is set
VITE_USE_MOCK_DATA=true
```

**Environment Variables**

| Variable | Description | Default |
|----------|-----------|---------|
| `VITE_API_BASE_URL` | Base URL for the energy export API endpoint | Empty (uses mock data) |
| `VITE_USE_MOCK_DATA` | Force mock data usage | `true` |
| `VITE_APP_TITLE` | Application title | `Home Energy Monitor` |
| `VITE_APP_ID` | Application identifier | `home-energy-monitor` |

## API Integration

### Switching from Mock to Real API

The application ships with realistic mock data for development. To connect to your real API:

1. **Set the API base URL** in `.env.local`:

```bash
VITE_API_BASE_URL=https://your-api-server.com
VITE_USE_MOCK_DATA=false
```

2. **Ensure your API provides the `/export` endpoint** with the following query parameters:

| Parameter | Description | Example |
|-----------|-----------|---------|
| `plantId` | Inverter/plant identifier | `11160008309715425` |
| `label` | Inverter label | `Ground_Floor` or `First_Floor` |
| `limit` | Number of records to return | `1` or `1000` |
| `fmt` | Response format | `json` |
| `dedupe` | Remove duplicate records | `true` |
| `hours` | Time range in hours | `24` |

### API Response Format

The API should return an array of energy records with the following structure:

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

### Data Mapping Reference

The application maps API fields to display values as follows:

**PV/Solar Data**
- `pd_pvTotalPower` → PV Now (W)
- `pd_ratedPower` → Array Size (kWp)
- `pd_todayPv` → Today (kWh)
- `pd_pvTodayIncome` → Income Today (currency)

**Battery Data (Shared)**
- `ef_emsSoc` → Battery SOC (%)
- `ef_bmsPower` → Battery Power (W, positive = charging)

**Load & Grid**
- `ef_ctThreePhaseTotalPower` or `ef_totalOutPutPower` → Load (W)
- `ef_acTtlInPower` → Grid In (W)
- `ef_genPower` → Generator In (W)

**Device Info**
- `ef_deviceModel` → Device model
- `ef_deviceSn` → Serial number (last 8 digits displayed)

## Development

### Available Scripts

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Run linting
pnpm lint

# Format code
pnpm format
```

### Component Architecture

**Header Component**
- Displays application title and logo
- Shows last updated time (relative + absolute on hover)
- Dark mode toggle button

**BatteryCard Component**
- Radial gauge showing battery SOC percentage
- Battery power display (positive = charging, negative = discharging)
- Estimated runtime calculation based on current load
- Status badge (Idle/Charging/Discharging)
- Tooltips explaining calculations and assumptions

**InverterPanel Component**
- Key metrics: PV Now, Today kWh, Array Size, Load
- Secondary stats: Generator In, Grid In, Income
- Status indicator dot (green/yellow/red)
- Device model and serial number

**TrendsCard Component**
- Tabbed interface (Home, Ground Floor, First Floor)
- Composed area chart with multiple data series
- Dual Y-axes (Power in W, SOC in %)
- Interactive legend and tooltips
- Smooth animations

**Footer Component**
- Location and currency information
- Application version and data source

### Utility Functions

The `lib/utils.ts` file provides formatting and calculation utilities:

```typescript
// Time formatting
formatRelativeTime(date)        // "2m ago"
formatAbsoluteTime(date, tz)    // "Oct 20, 2025 5:14:00 PM (UTC+02:00)"

// Power and energy formatting
formatPower(watts)              // "122 W" or "1.2 kW"
formatEnergy(kwh)               // "1.71 kWh" or "8 kWh"
formatCurrency(amount, code)    // "4,275 SYP"

// Calculations
calculateEstimatedRuntime(soc, loadW, capacity)  // hours
formatRuntime(hours)            // "8h 17m"

// Status helpers
getStatusColor(status)          // CSS class
getBatteryStateColor(state)     // CSS class
getBatteryStateLabel(state)     // "Charging" | "Discharging" | "Idle"
```

### Mock Data Generation

The `lib/mockData.ts` module provides realistic mock data for development:

```typescript
generateMockLastPoints()        // Latest data for both inverters
generateMockTimeSeries(hours)   // 24-hour time series
buildDashboardData(gf, ff)      // Combine records into dashboard format
buildTrendsData()               // Generate all three trend series
```

Mock data includes:
- Realistic solar generation curve (peak at noon)
- Variable load patterns throughout the day
- Battery charging/discharging based on net power
- SOC variations based on battery power flow

## Accessibility

The application follows WCAG 2.1 AA standards:

- **Keyboard Navigation**: All interactive elements are keyboard accessible with visible focus rings
- **Color Contrast**: Text meets minimum contrast ratios (4.5:1 for normal text)
- **ARIA Labels**: Charts, gauges, and interactive elements have descriptive labels
- **Semantic HTML**: Proper heading hierarchy and semantic elements
- **Responsive Design**: Works on all screen sizes with touch-friendly targets

## Performance Optimization

- **Code Splitting**: Components are lazy-loaded where appropriate
- **Image Optimization**: SVG icons and optimized assets
- **Caching**: 30-second polling interval balances freshness and efficiency
- **Bundle Size**: ~250KB gzipped (including all dependencies)

## Troubleshooting

### Application shows "No data available"

1. Check that the API endpoint is accessible
2. Verify the `VITE_API_BASE_URL` environment variable is set correctly
3. Check browser console for network errors
4. Ensure the API returns data in the expected format

### Charts not displaying

1. Verify the trends data is being fetched correctly
2. Check that time-series data has at least 2 points
3. Look for console errors related to Recharts

### Dark mode not working

1. Ensure `ThemeProvider` has `switchable` prop enabled in `App.tsx`
2. Check that theme context is properly imported
3. Verify CSS variables are defined in `index.css`

### Build errors

1. Run `pnpm install` to ensure all dependencies are installed
2. Clear node_modules and reinstall: `rm -rf node_modules && pnpm install`
3. Check TypeScript errors: `pnpm tsc --noEmit`

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile browsers: iOS Safari 12+, Chrome Mobile

## Future Enhancements

- Real-time WebSocket updates instead of polling
- Historical data export (CSV/PDF)
- Customizable dashboard layouts
- Alerts and notifications for abnormal conditions
- Multi-site support for monitoring multiple homes
- Mobile app (React Native)
- Integration with smart home systems

## License

This project is provided as-is for educational and commercial use.

## Support

For issues, questions, or feature requests, please refer to the project documentation or contact your system administrator.

---

**Version**: 1.0.0  
**Last Updated**: October 20, 2025  
**Built with**: React 19, TypeScript, Tailwind CSS, Recharts

