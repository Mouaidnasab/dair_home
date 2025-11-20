import { EnergyRecord, DashboardData, TrendsSeries } from "@/types/energy";

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
  return {
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
  };
}

/**
 * Fetch latest data point for a specific inverter label
 */
export async function fetchLatestByLabel(
  label: "Ground_Floor" | "First_Floor"
): Promise<EnergyRecord> {
  const plantId = label === "Ground_Floor" ? GROUND_FLOOR_ID : FIRST_FLOOR_ID;

  try {
    const params = new URLSearchParams({ plantId, label });
    const response = await fetch(`/api/energy/latest?${params}`);
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
  day?: Date
): Promise<EnergyRecord[]> {
  try {
    const params = new URLSearchParams({ hours: String(hours) });
    if (day) params.append("day", formatDayYYYYMMDD(day));

    // IMPORTANT: no 'label' here — single fetch for both inverters
    const response = await fetch(`/api/energy/timeseries?${params}`);
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

/** Fields we sum when combining Ground + First by minute for 'home'. */
type NumericKeysToSum =
  | "pd_pvTotalPower"
  | "ef_ctThreePhaseTotalPower"
  | "ef_acTotalOutActPower"
  | "ef_emsPower"
  | "ef_acTtlInPower"
  | "ef_genPower"
  | "ef_meterPower"
  | "ef_microInvTotalPower";

const SUM_KEYS: NumericKeysToSum[] = [
  "pd_pvTotalPower",
  "ef_ctThreePhaseTotalPower",
  "ef_acTotalOutActPower",
  "ef_emsPower",
  "ef_acTtlInPower",
  "ef_genPower",
  "ef_meterPower",
  "ef_microInvTotalPower",
];

/**
 * Keep the **latest** record per minute (last-write-wins) for a single inverter series.
 */
function bucketByMinuteLatest(
  records: EnergyRecord[]
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
  ffMap: Map<string, EnergyRecord>
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
      // SoC ONLY from First_Floor
      base.ef_emsSoc = ff.ef_emsSoc ?? 0;
      base.plantLabel = "Home";
      base.timestamp = key;
      out.push(base);
    } else if (gf) {
      const base: EnergyRecord = { ...gf, plantLabel: "Home", timestamp: key };
      // If we only have GF, we still want SoC only from FF → not available → 0
      base.ef_emsSoc = 0;
      out.push(base);
    } else if (ff) {
      const base: EnergyRecord = { ...ff, plantLabel: "Home", timestamp: key };
      // SoC from FF (as requested)
      base.ef_emsSoc = ff.ef_emsSoc ?? 0;
      out.push(base);
    }
  }

  // sort chronologically
  out.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
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
  }));
}

/**
 * Build dashboard data from inverter records
 */
function buildDashboardData(
  groundFloor: EnergyRecord,
  firstFloor: EnergyRecord
): DashboardData {
  const batteryPower = groundFloor.ef_emsPower + firstFloor.ef_emsPower;
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
    location: {
      country: groundFloor.pd_countryName,
      city: "Deyr Atiyah",
      timezone: groundFloor.pd_timeZone,
    },
    currency: groundFloor.pd_currency,
    lastUpdated: firstFloor.timestamp,
    grid: {
      isPowerOn:
        groundFloor.ef_acTtlInPower > 0 || firstFloor.ef_acTtlInPower > 0,
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
        .filter((r) => r.plantLabel === "Ground_Floor")
    );
    const firstFloorBucket = bucketByMinuteLatest(
      allRecords
        .map((r) => ({ ...r, plantLabel: inferLabel(r.plantId, r.plantLabel) }))
        .filter((r) => r.plantLabel === "First_Floor")
    );

    // Build arrays (sorted) for GF and FF
    const sortByTime = (a: EnergyRecord, b: EnergyRecord) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();

    const groundFloorSeries = Array.from(groundFloorBucket.values()).sort(
      sortByTime
    );
    const firstFloorSeries = Array.from(firstFloorBucket.values()).sort(
      sortByTime
    );

    // Combine minutes to produce exactly ONE row per minute for 'home'
    const homeCombined = combineMinuteMapsToHome(
      groundFloorBucket,
      firstFloorBucket
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
