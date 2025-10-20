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
  
  // Pricing
  pd_electricityPrice: number; // local price per kWh
}

export interface InverterData {
  label: string;
  pvNowW: number;
  todayKWh: number;
  ratedKwp: number;
  loadW: number;

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

export interface TimeSeriesPoint {
  timestamp: string;
  homePvPower: number; // W (sum of both inverters)
  loadPower: number; // W
  batteryPower: number; // W (positive = charging, negative = discharging)
  gridPower: number; // W
  genPower: number; // W
  batterySoc: number; // %
}

export interface DashboardData {
  inverters: {
    groundFloor: InverterData;
    firstFloor: InverterData;
  };
  battery: BatteryData;
  location: {
    country: string;
    city: string;
    timezone: string;
  };
  currency: string;
  lastUpdated: string;
}

export interface TrendsSeries {
  home: TimeSeriesPoint[];
  groundFloor: TimeSeriesPoint[];
  firstFloor: TimeSeriesPoint[];
}

