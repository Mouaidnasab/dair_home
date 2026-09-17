// Response shapes of the backend /api/v1 endpoints (backend/app/api.py).

export type ZoneId = "ground" | "first" | "garden";
export type SystemId = "home" | "garden";
/** Scope for charts and bills: a whole system ("home" = ground + first) or a single zone. */
export type ZoneOrHome = ZoneId | SystemId;
export type DeviceKind = "inverter" | "battery";

export interface SampleFields {
  pv_w: number | null;
  load_w: number | null;
  grid_w: number | null;
  grid_v: number | null;
  grid_hz: number | null;
  out_v: number | null;
  bat_w: number | null;
  soc: number | null;
  bat_v: number | null;
  bat_a: number | null;
  soh: number | null;
  temp_c: number | null;
  inv_temp_c: number | null;
  cell_v_max: number | null;
  cell_v_min: number | null;
  e_pv_today: number | null;
  e_load_today: number | null;
  work_mode: number | null;
}

export interface LiveExtra {
  status?: string | null;
  work_mode?: string | null;
  priority?: string | null;
  e_pv_month?: number | null;
  e_pv_year?: number | null;
  e_pv_total?: number | null;
  cells_v?: number[];
  cell_temps_c?: number[];
  capacity_ah?: number | null;
  remaining_kwh?: number | null;
}

export interface DeviceLive extends SampleFields {
  sn: string;
  kind: DeviceKind;
  zones: ZoneId[];
  model: string;
  alias: string;
  ts: number | null;
  age_s: number | null;
  stale: boolean;
  extra: LiveExtra;
}

export interface PowerSummary {
  pv_w: number | null;
  load_w: number | null;
  grid_w: number | null;
  bat_w: number | null;
  grid_v: number | null;
  grid_available: boolean | null;
  updated_ts: number | null;
  soc: number | null;
}

export interface SystemLive extends PowerSummary {
  system: SystemId;
  zones: ZoneId[];
  battery_sns: string[];
}

export interface ZoneLive extends PowerSummary {
  zone: ZoneId;
  system: SystemId;
  label: string;
  plant_id: string;
  inverters: DeviceLive[];
  battery_sns: string[];
}

export interface LiveResponse {
  now: number;
  systems: SystemLive[];
  zones: ZoneLive[];
  batteries: DeviceLive[];
  collector: { enabled: boolean; buffered: number; last_flush_ts: number | null; errors: Record<string, string> };
}

export interface SeriesPoint {
  t: number;
  pv_w: number | null;
  load_w: number | null;
  grid_w: number | null;
  bat_w: number | null;
  grid_v: number | null;
  soc: number | null;
}

export interface SeriesResponse {
  day: string;
  zone: ZoneOrHome | null;
  sn: string | null;
  bucket: number;
  source: "samples" | "rollups" | "none";
  points: SeriesPoint[];
}

export type Period = "day" | "month" | "cycle" | "year";

export interface EnergyTotals {
  pv_kwh: number;
  load_kwh: number;
  grid_kwh: number;
  bat_charge_kwh: number;
  bat_discharge_kwh: number;
  grid_up_hours: number;
}

export interface Tier {
  limit_kwh: number | null;
  price: number | null;
  filled_kwh: number;
}

export interface CycleBill {
  start_day: string;
  label: string;
  grid_kwh: number;
  amount: number | null;
  tiers: Tier[];
}

export interface EnergyResponse {
  period: Period;
  zone: ZoneOrHome;
  date: string;
  start_day: string;
  end_day: string;
  currency: string;
  totals: EnergyTotals;
  bill: { grid_kwh: number; amount: number | null; cycle: CycleBill };
  breakdown: (EnergyTotals & { key: string; cost: number | null })[];
}

export interface CyclesResponse {
  zone: ZoneOrHome;
  currency: string;
  cycles: CycleBill[];
}
