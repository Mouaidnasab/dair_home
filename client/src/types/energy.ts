/**
 * Energy Monitor Data Types
 * Flattened structure from CSV→JSON export endpoint
 */

export interface EnergyRecord {
  timestamp: string;
  plantId: string;
  plantLabel: string;

  // PV/Solar Data
  pd_pvTotalPower: number; // W (instant PV power)
  pd_ratedPower: number; // kWp (array size)
  pd_todayPv: number; // kWh
  pd_monthPv: number; // kWh
  pd_yearPv: number; // kWh
  pd_accPv: number; // kWh
  pd_pvTodayIncome: number; // currency amount
  pd_monthPvIncome: number; // currency amount
  pd_yearPvIncome: number; // currency amount
  pd_currency: string; // e.g., "SYP"

  // Environment Data
  pd_totalReduceDeforestation: number; // Trees
  pd_totalCo2Less: number; // kg/ton?
  pd_totalSpareCoal: number; // kg/ton?

  // Location & Status
  pd_countryName: string;
  pd_cityName: string;
  pd_status: string; // "N" = Normal, others = Warning/Fault
  pd_installDateStr: string;
  pd_timeZone: string;

  // Battery/EMS Data (shared across inverters)
  ef_emsSoc: number; // % battery SOC
  ef_acTotalOutActPower: number; // W load instant
  ef_emsPower: number; // W battery charge(+)/discharge(-) power

  // Grid/Gen/Meter Data
  ef_genPower: number; // W generator input
  ef_acTtlInPower: number; // W grid input
  ef_meterPower: number; // W import/export at meter
  ef_microInvTotalPower: number; // W micro-inverters
  ef_ctThreePhaseTotalPower: number; // W measured load

  // Device Info
  ef_deviceSn: string;
  ef_deviceModel: string;

  pd_electricityPrice: number; // local price per kWh
  ef_acRInVolt: number; // Grid Voltage (V)
}

export interface InverterData {
  label: string;
  pvNowW: number;
  todayKWh: number;
  ratedKwp: number;
  loadW: number;
  batteryW: number;

  gridW: number;
  incomeToday: number;
  currency: string;
  status: "normal" | "warning" | "fault";
  model: string;
  serialNumber: string;
  timestamp: string;
}

export interface BatteryData {
  soc: number; // %
  powerW: number; // positive = charging, negative = discharging
  state: "idle" | "charging" | "discharging";
  timestamp: string;
}

export interface BatterySummary {
  deviceSn: string;
  deviceLabel: string;
  battSoc: number;
  battVolt: number;
  battCurr: number;
  battPower: number;
  battTemp: number;
  status: string;
  timestamp: string;
}

export interface BatteryDetail extends BatterySummary {
  cellVoltList: string[]; // parsed from string representation if needed, or kept as is
  cellTempList: string[];
  bmsState: string;
  bmsChargingState: number;
  cycles: number | null;
  soh: string;
  capacity: string;
}

export interface TimeSeriesPoint {
  timestamp: string;
  homePvPower: number; // W (sum of both inverters)
  loadPower: number; // W
  batteryPower: number; // W (positive = charging, negative = discharging)
  gridPower: number; // W
  genPower: number; // W
  batterySoc: number; // %
  gridVoltage: number; // V
}

export interface DashboardData {
  inverters: {
    groundFloor: InverterData;
    firstFloor: InverterData;
  };
  battery: BatteryData;
  environment: {
    co2Reduced: number;
    treesSaved: number;
    coalSaved: number;
  };
  pvStats: {
    today: number;
    month: number;
    year: number;
    total: number;
    todayIncome: number;
    monthIncome: number;
    yearIncome: number;
    currency: string;
  };
  location: {
    country: string;
    city: string;
    timezone: string;
  };
  currency: string;
  lastUpdated: string;
  grid: {
    isPowerOn: boolean;
  };
}

export interface TrendsSeries {
  home: TimeSeriesPoint[];
  groundFloor: TimeSeriesPoint[];
  firstFloor: TimeSeriesPoint[];
}

export interface GridStatsParams {
  period?: "overview" | "day" | "month" | "cycle" | "year";
  date_str?: string; // YYYY-MM-DD
}

export interface GridTier {
  limit: number | string;
  price: number;
  filled: number;
}

export interface GridCycleStats {
  name: string;
  kwh: number;
  bill_syp: number;
  tiers: GridTier[];
  projected_kwh?: number;
  projected_bill_syp?: number;
}

export interface GridInsights {
  daily_avg_kwh: number;
  avg_grid_hours: number;
  cycle_days_passed: number;
  cycle_total_days: number;
}

export interface GridStats {
  period: string;
  timestamp: string;
  today?: {
    kwh: number;
    cost_syp_marginal: number;
    bill_syp_standalone?: number;
  };
  month?: {
    kwh: number;
    bill_syp_standalone?: number;
  };
  cycle?: GridCycleStats;
  year?: {
    kwh: number;
    bill_syp_standalone?: number;
  };
  total?: {
    kwh: number;
    bill_syp_standalone?: number;
  };

  // Specific breakdown fields
  ref_date?: string;
  cycle_name?: string;
  total_kwh?: number;
  kwh?: number; // Single value for day/month/year requests
  date?: string; // Date for point responses
  bill_syp?: number;
  bill_syp_standalone?: {
    today: number;
    month: number;
    year: number;
    total: number;
  };
  tiers?: GridTier[];
  days?: Array<{ date: string; kwh: number; bill_syp?: number }>;
  months?: Array<{ date: string; kwh: number; bill_syp?: number }>;
  hours?: Array<{ date: string; kwh: number; bill_syp?: number }>;
  insights?: GridInsights;
}

export interface CycleSummaryItem {
  cycle_start: string;
  name: string;
  kwh: number;
  bill_syp: number;
  tiers: GridTier[];
}

export interface CycleSummaryResponse {
  count: number;
  requested_limit: number;
  cycles: CycleSummaryItem[];
}
