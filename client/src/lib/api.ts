import {
  EnergyRecord,
  DashboardData,
  TrendsSeries,
  GridStats,
  GridStatsParams,
  CycleSummaryResponse,
} from "@/types/energy";
import { apiQueue } from "./queue";

// Export concurrency control
export function setApiConcurrencyMode(mode: "SERIES" | "PARALLEL") {
  apiQueue.setMode(mode);
}

// Plant IDs for the two inverters
const GROUND_FLOOR_ID = "11160008309715425";
const FIRST_FLOOR_ID = "11160032281678305";

/** Format a Date as YYYY-MM-DD (expected by the backend's `day` query). */
function formatDayYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Infer label from plantId if plantLabel is missing. */
function inferLabel(plantId?: string, plantLabel?: string): string {
  if (plantLabel && plantLabel.length > 0) return plantLabel;
  if (!plantId) return "";
  if (plantId === GROUND_FLOOR_ID) return "Ground_Floor";
  if (plantId === FIRST_FLOOR_ID) return "First_Floor";
  return "";
}

/** Safe number parsing helpers. */
const toInt = (v: any): number => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
const toFloat = (v: any): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Round an ISO timestamp down to the **minute** and return ISO string (UTC). */
function minuteISO(ts: string): string {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  return d.toISOString();
}

/**
 * Transform API response row to EnergyRecord format
 */
function transformApiRecord(row: any): EnergyRecord {
  const label = inferLabel(row.plantId, row.plantLabel);
  const record: EnergyRecord = {
    timestamp: row.timestamp || new Date().toISOString(),
    plantId: row.plantId || "",
    plantLabel: label,
    pd_pvTotalPower: toInt(row.pd_pvTotalPower),
    pd_ratedPower: toInt(row.pd_ratedPower),
    pd_todayPv: toFloat(row.pd_todayPv),
    pd_monthPv: toFloat(row.pd_monthPv),
    pd_yearPv: toFloat(row.pd_yearPv),
    pd_accPv: toFloat(row.pd_accPv),
    pd_pvTodayIncome: toFloat(row.pd_pvTodayIncome),
    pd_monthPvIncome: toFloat(row.pd_monthPvIncome),
    pd_yearPvIncome: toFloat(row.pd_yearPvIncome),
    pd_currency: row.pd_currency || "SYP",
    pd_countryName: row.pd_countryName || "",
    pd_cityName: row.pd_cityName || "",
    pd_status: row.pd_status || "N",

    pd_totalReduceDeforestation: toFloat(row.pd_totalReduceDeforestation),
    pd_totalCo2Less: toFloat(row.pd_totalCo2Less),
    pd_totalSpareCoal: toFloat(row.pd_totalSpareCoal),

    ef_emsSoc:
      row.ef_emsSoc !== null && row.ef_emsSoc !== undefined
        ? toFloat(row.ef_emsSoc)
        : 0,
    ef_acTotalOutActPower: toFloat(row.ef_acTotalOutActPower),
    ef_emsPower: toFloat(row.ef_emsPower),
    ef_genPower: toFloat(row.ef_genPower),
    ef_acTtlInPower: toFloat(row.ef_acTtlInPower),
    ef_meterPower: toFloat(row.ef_meterPower),
    ef_microInvTotalPower: toFloat(row.ef_microInvTotalPower),
    ef_ctThreePhaseTotalPower:
      toFloat(row.ef_ctThreePhaseTotalPower) ||
      toFloat(row.ef_acTotalOutActPower) ||
      0,

    ef_deviceSn: row.plantId || "",
    ef_deviceModel: row.ef_deviceModel || "",
    pd_installDateStr: row.pd_installDateStr || "",
    pd_timeZone: row.pd_timeZone || "UTC+02:00",
    pd_electricityPrice: toFloat(row.pd_electricityPrice),
    ef_acRInVolt: toFloat(row.ef_acRInVolt),
  };

  // Legacy Merge: Use direct battery data if available (higher accuracy)
  if (row.battSoc !== undefined && row.battSoc !== null) {
    record.ef_emsSoc = toFloat(row.battSoc);
  }
  if (row.battPower !== undefined && row.battPower !== null) {
    record.ef_emsPower = toFloat(row.battPower);
  }

  return record;
}

/**
 * Fetch latest data point for a specific inverter label
 */
export async function fetchLatestByLabel(
  label: "Ground_Floor" | "First_Floor",
): Promise<EnergyRecord> {
  const plantId = label === "Ground_Floor" ? GROUND_FLOOR_ID : FIRST_FLOOR_ID;

  try {
    const params = new URLSearchParams({ plantId, label });
    const response = await apiQueue.add(
      () => fetch(`/api/energy/latest?${params}`),
      5, // HIGHEST Priority (Live Dashboard)
    );
    if (!response.ok) throw new Error("Failed to fetch latest data");

    const result = await response.json();
    if (!result.rows || result.rows.length === 0) {
      throw new Error(`No data returned for ${label}`);
    }
    return transformApiRecord(result.rows[0]);
  } catch (error) {
    console.error("Failed to fetch latest data:", error);
    debugger;
    throw error;
  }
}

/**
 * Fetch time-series data ONCE (no label), optionally for a given date.
 * Returns ALL inverter rows for post-processing.
 */
export async function fetchTimeSeriesAll(
  hours: number = 24,
  day?: Date,
): Promise<EnergyRecord[]> {
  try {
    const params = new URLSearchParams({ hours: String(hours) });
    if (day) params.append("day", formatDayYYYYMMDD(day));

    // IMPORTANT: no 'label' here — single fetch for both inverters
    const response = await apiQueue.add(
      () => fetch(`/api/energy/timeseries?${params}`),
      3, // MEDIUM-HIGH Priority (Trends)
    );
    if (!response.ok) throw new Error("Failed to fetch time-series data");

    const result = await response.json();
    if (!result.rows) return [];
    return result.rows.map(transformApiRecord);
  } catch (error) {
    console.error("Failed to fetch time-series data:", error);
    debugger;
    throw error;
  }
}

import { BatterySummary, BatteryDetail } from "@/types/energy";

/**
 * Fetch Battery Summary
 */
export async function fetchBatterySummary(params?: {
  deviceSn?: string;
  label?: string;
  minutes?: number;
  hours?: number;
  start?: string; // ISO
  end?: string; // ISO
  limit?: number;
}): Promise<BatterySummary[]> {
  try {
    const query = new URLSearchParams();
    if (params) {
      if (params.deviceSn) query.append("deviceSn", params.deviceSn);
      if (params.label) query.append("label", params.label);
      if (params.minutes) query.append("minutes", String(params.minutes));
      if (params.hours) query.append("hours", String(params.hours));
      if (params.start) query.append("start", params.start);
      if (params.end) query.append("end", params.end);
      if (params.limit) query.append("limit", String(params.limit));
    }

    const response = await fetch(`/api/battery/summary?${query.toString()}`);
    if (!response.ok) throw new Error("Failed to fetch battery summary");

    const result = await response.json();
    return (result.rows || []) as BatterySummary[];
  } catch (error) {
    console.error("Failed to fetch battery summary:", error);
    throw error;
  }
}

/**
 * Fetch Battery Details
 */
export async function fetchBatteryDetails(params?: {
  deviceSn?: string;
  label?: string;
  minutes?: number; // default often 60 if omitted
  limit?: number;
}): Promise<BatteryDetail[]> {
  try {
    const query = new URLSearchParams();
    if (params) {
      if (params.deviceSn) query.append("deviceSn", params.deviceSn);
      if (params.label) query.append("label", params.label);
      if (params.minutes) query.append("minutes", String(params.minutes));
      if (params.limit) query.append("limit", String(params.limit));
    }

    const response = await fetch(`/api/battery/details?${query.toString()}`);
    if (!response.ok) throw new Error("Failed to fetch battery details");

    // The backend returns cellVoltList/cellTempList as strings, we might need to parse them
    // but the interface defines them as string[] for flexibility.
    // If the API returns them as JSON strings "['3.31', ...]", we should parse.
    const result = await response.json();

    // Auto-parse list fields if they come as strings
    const rows = (result.rows || []).map((r: any) => {
      let cellVoltList = r.cellVoltList;
      let cellTempList = r.cellTempList;

      if (typeof cellVoltList === "string") {
        try {
          cellVoltList = JSON.parse(cellVoltList.replace(/'/g, '"')); // handle single quotes if present
        } catch (e) {
          /* ignore */
        }
      }
      if (typeof cellTempList === "string") {
        try {
          cellTempList = JSON.parse(cellTempList.replace(/'/g, '"'));
        } catch (e) {
          /* ignore */
        }
      }

      return {
        ...r,
        cellVoltList: Array.isArray(cellVoltList) ? cellVoltList : [],
        cellTempList: Array.isArray(cellTempList) ? cellTempList : [],
      };
    });

    return rows as BatteryDetail[];
  } catch (error) {
    console.error("Failed to fetch battery details:", error);
    throw error;
  }
}

/** Fields we sum when combining Ground + First by minute for 'home'. */
type NumericKeysToSum =
  | "pd_pvTotalPower"
  | "ef_ctThreePhaseTotalPower"
  | "ef_acTotalOutActPower"
  | "ef_acTtlInPower"
  | "ef_genPower"
  | "ef_meterPower"
  | "ef_microInvTotalPower";

const SUM_KEYS: NumericKeysToSum[] = [
  "pd_pvTotalPower",
  "ef_ctThreePhaseTotalPower",
  "ef_acTotalOutActPower",
  "ef_acTtlInPower",
  "ef_genPower",
  "ef_meterPower",
  "ef_microInvTotalPower",
];

/**
 * Keep the **latest** record per minute (last-write-wins) for a single inverter series.
 *
 * NOW UPDATE: If duplicate timestamps exist, we might also want to prefer the one with valid battery data?
 * For now, simple overwrite (last wins) is standard.
 */
function bucketByMinuteLatest(
  records: EnergyRecord[],
): Map<string, EnergyRecord> {
  const map = new Map<string, EnergyRecord>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const key = minuteISO(r.timestamp);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r, timestamp: key });
      continue;
    }
    // choose the later sample within the same minute
    if (new Date(r.timestamp).getTime() > new Date(prev.timestamp).getTime()) {
      map.set(key, { ...r, timestamp: key });
    }
  }
  return map;
}

/**
 * Combine two per-minute maps (ground & first) into a home-per-minute series by summing numeric fields.
 * For SoC we take it **only from First_Floor** (no merging).
 */
function combineMinuteMapsToHome(
  gfMap: Map<string, EnergyRecord>,
  ffMap: Map<string, EnergyRecord>,
): EnergyRecord[] {
  // Avoid iterating MapIterator/Set directly (no downlevelIteration needed)
  const gfKeys = Array.from(gfMap.keys());
  const ffKeys = Array.from(ffMap.keys());
  const allKeysArr = Array.from(new Set<string>([...gfKeys, ...ffKeys]));

  const out: EnergyRecord[] = [];

  for (let i = 0; i < allKeysArr.length; i++) {
    const key = allKeysArr[i];
    const gf = gfMap.get(key);
    const ff = ffMap.get(key);

    if (gf && ff) {
      const base: EnergyRecord = { ...(gf || ff), timestamp: key };
      // sum numeric fields safely without index signature errors
      for (let j = 0; j < SUM_KEYS.length; j++) {
        const k = SUM_KEYS[j];
        const gfv = (gf as any)[k] ?? 0;
        const ffv = (ff as any)[k] ?? 0;
        (base as any)[k] = gfv + ffv;
      }
      // SoC & Battery Power ONLY from First_Floor (direct value from battery API merge)
      base.ef_emsSoc = ff.ef_emsSoc ?? 0;
      base.ef_emsPower = ff.ef_emsPower ?? 0;

      // GRID: Take the MAX of voltage/freq to detect if ANY inverter sees the grid
      base.ef_acRInVolt = Math.max(gf.ef_acRInVolt || 0, ff.ef_acRInVolt || 0);

      base.plantLabel = "Home";
      base.timestamp = key;
      out.push(base);
    } else if (gf) {
      const base: EnergyRecord = { ...gf, plantLabel: "Home", timestamp: key };
      // If we only have GF, we still want SoC only from FF → not available → 0
      // We also default battery power to 0 if FF is missing in this "direct" logic,
      // OR we could fallback to GF if it has data.
      // Assuming FF is the master for battery data:
      base.ef_emsSoc = 0;
      base.ef_emsPower = 0; // or gf.ef_emsPower? Safer to 0 if FF is master.
      out.push(base);
    } else if (ff) {
      const base: EnergyRecord = { ...ff, plantLabel: "Home", timestamp: key };
      // SoC from FF (as requested)
      base.ef_emsSoc = ff.ef_emsSoc ?? 0;
      // Power from FF (direct)
      base.ef_emsPower = ff.ef_emsPower ?? 0;
      out.push(base);
    }
  }

  // sort chronologically
  out.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  return out;
}

/** Helper: turn EnergyRecord[] into Trends points */
function toTrendPoints(records: EnergyRecord[]) {
  return records.map((r) => ({
    timestamp: r.timestamp, // minute-normalized ISO
    homePvPower: r.pd_pvTotalPower || 0,
    loadPower: r.ef_ctThreePhaseTotalPower || r.ef_acTotalOutActPower || 0,
    batteryPower: r.ef_emsPower || 0,
    gridPower: r.ef_acTtlInPower || 0,
    genPower: r.ef_genPower || 0,
    batterySoc: r.ef_emsSoc || 0,
    gridVoltage: r.ef_acRInVolt || 0,
  }));
}

/**
 * Build dashboard data from inverter records
 */
function buildDashboardData(
  groundFloor: EnergyRecord,
  firstFloor: EnergyRecord,
): DashboardData {
  // Legacy Merge: The existing /export-compact endpoint now includes direct battery data.
  // We should NOT sum them anymore, but interpret the value from the 'master' inverter (First Floor)
  // as the total battery power.

  const batteryPower = firstFloor.ef_emsPower;

  const batteryState =
    batteryPower > 50
      ? "charging"
      : batteryPower < -50
        ? "discharging"
        : "idle";

  return {
    inverters: {
      groundFloor: {
        label: "Ground_Floor",
        pvNowW: groundFloor.pd_pvTotalPower,
        todayKWh: groundFloor.pd_todayPv,
        ratedKwp: groundFloor.pd_ratedPower,
        loadW: groundFloor.ef_acTotalOutActPower,
        batteryW: groundFloor.ef_emsPower,
        gridW: groundFloor.ef_acTtlInPower,
        incomeToday: groundFloor.pd_pvTodayIncome,
        currency: groundFloor.pd_currency,
        status: groundFloor.pd_status === "N" ? "normal" : "warning",
        model: groundFloor.ef_deviceModel,
        serialNumber: groundFloor.ef_deviceSn,
        timestamp: groundFloor.timestamp,
      },
      firstFloor: {
        label: "First_Floor",
        pvNowW: firstFloor.pd_pvTotalPower,
        todayKWh: firstFloor.pd_todayPv,
        ratedKwp: firstFloor.pd_ratedPower,
        loadW: firstFloor.ef_acTotalOutActPower,
        batteryW: firstFloor.ef_emsPower,
        gridW: firstFloor.ef_acTtlInPower,
        incomeToday: firstFloor.pd_pvTodayIncome,
        currency: firstFloor.pd_currency,
        status: firstFloor.pd_status === "N" ? "normal" : "warning",
        model: firstFloor.ef_deviceModel,
        serialNumber: firstFloor.ef_deviceSn,
        timestamp: firstFloor.timestamp,
      },
    },
    battery: {
      // Keep SoC display aligned with your request: ONLY from First_Floor
      soc: firstFloor.ef_emsSoc,
      powerW: batteryPower,
      state: batteryState,
      timestamp: firstFloor.timestamp,
    },
    environment: {
      co2Reduced:
        (groundFloor.pd_totalCo2Less || 0) + (firstFloor.pd_totalCo2Less || 0),
      treesSaved:
        (groundFloor.pd_totalReduceDeforestation || 0) +
        (firstFloor.pd_totalReduceDeforestation || 0),
      coalSaved:
        (groundFloor.pd_totalSpareCoal || 0) +
        (firstFloor.pd_totalSpareCoal || 0),
    },
    pvStats: {
      today: (groundFloor.pd_todayPv || 0) + (firstFloor.pd_todayPv || 0),
      month: (groundFloor.pd_monthPv || 0) + (firstFloor.pd_monthPv || 0),
      year: (groundFloor.pd_yearPv || 0) + (firstFloor.pd_yearPv || 0),
      total: (groundFloor.pd_accPv || 0) + (firstFloor.pd_accPv || 0),
      todayIncome:
        (groundFloor.pd_pvTodayIncome || 0) +
        (firstFloor.pd_pvTodayIncome || 0),
      monthIncome:
        (groundFloor.pd_monthPvIncome || 0) +
        (firstFloor.pd_monthPvIncome || 0),
      yearIncome:
        (groundFloor.pd_yearPvIncome || 0) + (firstFloor.pd_yearPvIncome || 0),
      currency: groundFloor.pd_currency || "SYP",
    },
    location: {
      country: groundFloor.pd_countryName,
      city: "Deyr Atiyah",
      timezone: groundFloor.pd_timeZone,
    },
    currency: groundFloor.pd_currency,
    lastUpdated: firstFloor.timestamp,
    grid: {
      isPowerOn:
        (groundFloor.ef_acRInVolt || 0) > 100 ||
        (firstFloor.ef_acRInVolt || 0) > 100,
    },
  };
}

/**
 * Fetch complete dashboard data (both inverters + battery)
 */
export async function fetchDashboardData(): Promise<DashboardData> {
  try {
    const [groundFloor, firstFloor] = await Promise.all([
      fetchLatestByLabel("Ground_Floor"),
      fetchLatestByLabel("First_Floor"),
    ]);
    return buildDashboardData(groundFloor, firstFloor);
  } catch (error) {
    console.error("Failed to fetch dashboard data:", error);
    debugger; // eslint-disable-line no-debugger
    throw error;
  }
}

/**
 * Fetch trends data for all three tabs (optionally for a specific date)
 * SINGLE FETCH, then:
 *  - split by label into Ground_Floor and First_Floor
 *  - **bucket to one row per minute**
 *  - combine per-minute to produce 'home' (one row per minute)
 */
export async function fetchTrendsData(date?: Date): Promise<TrendsSeries> {
  try {
    const targetDate = date ?? new Date();

    // One call only (no label)
    const allRecords = await fetchTimeSeriesAll(24, targetDate);

    // Normalize labels and bucket by minute (latest sample wins)
    const groundFloorBucket = bucketByMinuteLatest(
      allRecords
        .map((r) => ({ ...r, plantLabel: inferLabel(r.plantId, r.plantLabel) }))
        .filter((r) => r.plantLabel === "Ground_Floor"),
    );
    const firstFloorBucket = bucketByMinuteLatest(
      allRecords
        .map((r) => ({ ...r, plantLabel: inferLabel(r.plantId, r.plantLabel) }))
        .filter((r) => r.plantLabel === "First_Floor"),
    );

    // Build arrays (sorted) for GF and FF
    const sortByTime = (a: EnergyRecord, b: EnergyRecord) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();

    const groundFloorSeries = Array.from(groundFloorBucket.values()).sort(
      sortByTime,
    );
    const firstFloorSeries = Array.from(firstFloorBucket.values()).sort(
      sortByTime,
    );

    // Combine minutes to produce exactly ONE row per minute for 'home'
    const homeCombined = combineMinuteMapsToHome(
      groundFloorBucket,
      firstFloorBucket,
    );

    return {
      home: toTrendPoints(homeCombined),
      groundFloor: toTrendPoints(groundFloorSeries),
      firstFloor: toTrendPoints(firstFloorSeries),
    };
  } catch (error) {
    console.error("Failed to fetch trends data:", error);
    debugger; // eslint-disable-line no-debugger
    throw error;
  }
}

/**
 * Fetch Grid Consumption Stats
 */
export async function fetchGridStats(
  params?: GridStatsParams & { currency?: string },
): Promise<GridStats> {
  try {
    const query = new URLSearchParams();
    if (params) {
      if (params.period) query.append("period", params.period);
      if (params.date_str) query.append("date_str", params.date_str);
      if (params.currency && params.currency !== "SYP") {
        query.append("currency", params.currency);
      }
    }
    console.log(`[API] calling /stats/grid-consumption with params:`, params);
    const res = await apiQueue.add(
      () =>
        fetch(
          `/stats/grid-consumption?${query.toString().replace(/\+/g, "%20")}`,
        ),
      2, // MEDIUM Priority (Grid)
    );
    if (!res.ok) throw new Error("Failed to fetch grid stats");
    return await res.json();
  } catch (err) {
    console.error("fetchGridStats error:", err);
    throw err;
  }
}

/**
 * Fetch Cycles Summary
 */
export async function fetchCyclesSummary(
  limit: number = 5,
  currency?: string,
): Promise<CycleSummaryResponse> {
  try {
    const query = new URLSearchParams({ limit: String(limit) });
    if (currency && currency !== "SYP") {
      query.append("currency", currency);
    }

    const res = await apiQueue.add(
      () => fetch(`/stats/cycles?${query.toString().replace(/\+/g, "%20")}`),
      1, // LOW Priority
    );
    if (!res.ok) throw new Error("Failed to fetch cycles summary");
    return await res.json();
  } catch (err) {
    console.error("fetchCyclesSummary error:", err);
    throw err;
  }
}

/**
 * Request an immediate data pull from the backend.
 */
export async function pullNow(): Promise<void> {
  try {
    const response = await apiQueue.add(
      () => fetch("/pull-now", { method: "POST" }),
      4, // HIGH Priority
    );
    if (!response.ok) throw new Error("Failed to trigger data pull");
  } catch (error) {
    console.error("pullNow error:", error);
    throw error;
  }
}
