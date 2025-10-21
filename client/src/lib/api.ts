import {
  EnergyRecord,
  DashboardData,
  TrendsSeries,
} from "@/types/energy";

// Plant IDs for the two inverters
const GROUND_FLOOR_ID = "11160008309715425";
const FIRST_FLOOR_ID = "11160032281678305";

/**
 * Fetch latest data point for a specific inverter label
 */
export async function fetchLatestByLabel(label: string): Promise<EnergyRecord> {
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
    console.error("Failed to fetch latest data:", error); debugger;
    throw error;
  }
}

/**
 * Fetch time-series data for trends
 */
export async function fetchTimeSeries(
  hours: number = 24,
  label?: string
): Promise<EnergyRecord[]> {
  const plantId = label === "Ground_Floor" ? GROUND_FLOOR_ID : FIRST_FLOOR_ID;

  try {
    const params = new URLSearchParams({ plantId, hours: String(hours) });
    if (label) {
      params.append("label", label);
    }

    const response = await fetch(`/api/energy/timeseries?${params}`);

    if (!response.ok) throw new Error("Failed to fetch time-series data");
    const result = await response.json();

    if (!result.rows) return [];
    return result.rows.map(transformApiRecord);
  } catch (error) {
    console.error("Failed to fetch time-series data:", error); debugger;
    throw error;
  }
}

/**
 * Transform API response row to EnergyRecord format
 */
function transformApiRecord(row: any): EnergyRecord {
  return {
    timestamp: row.timestamp || new Date().toISOString(),
    plantId: row.plantId || "",
    plantLabel: row.plantLabel || "",
    pd_pvTotalPower: parseInt(row.pd_pvTotalPower) || 0,
    pd_ratedPower: parseInt(row.pd_ratedPower) || 0,
    pd_todayPv: parseFloat(row.pd_todayPv) || 0,
    pd_monthPv: parseFloat(row.pd_monthPv) || 0,
    pd_yearPv: parseFloat(row.pd_yearPv) || 0,
    pd_accPv: parseFloat(row.pd_accPv) || 0,
    pd_pvTodayIncome: parseFloat(row.pd_pvTodayIncome) || 0,
    pd_monthPvIncome: parseFloat(row.pd_monthPvIncome) || 0,
    pd_yearPvIncome: parseFloat(row.pd_yearPvIncome) || 0,
    pd_currency: row.pd_currency || "SYP",
    pd_countryName: row.pd_countryName || "",
    pd_cityName: row.pd_cityName || "",
    pd_status: row.pd_status || "N",
    ef_emsSoc: row.ef_emsSoc !== null && row.ef_emsSoc !== undefined ? parseFloat(row.ef_emsSoc) : 0,
    ef_acTotalOutActPower: parseFloat(row.ef_acTotalOutActPower) || 0,
    ef_emsPower: parseFloat(row.ef_emsPower) || 0,
    ef_genPower: parseFloat(row.ef_genPower) || 0,
    ef_acTtlInPower: parseFloat(row.ef_acTtlInPower) || 0,
    ef_meterPower: parseFloat(row.ef_meterPower) || 0,
    ef_microInvTotalPower: parseFloat(row.ef_microInvTotalPower) || 0,
    ef_ctThreePhaseTotalPower: parseFloat(row.ef_ctThreePhaseTotalPower) || parseFloat(row.ef_acTotalOutActPower) || 0,
    ef_deviceSn: row.ef_deviceSn || "",
    ef_deviceModel: row.ef_deviceModel || "",
    pd_installDateStr: row.pd_installDateStr || "",
    pd_timeZone: row.pd_timeZone || "UTC+02:00",
    pd_electricityPrice: parseFloat(row.pd_electricityPrice) || 0,
  };
}

/**
 * Build dashboard data from inverter records
 */
function buildDashboardData(groundFloor: EnergyRecord, firstFloor: EnergyRecord): DashboardData {
  const batteryPower = groundFloor.ef_emsPower;
  const batteryState = batteryPower > 50 ? "charging" : batteryPower < -50 ? "discharging" : "idle";

  return {
    inverters: {
      groundFloor: {
        label: "Ground_Floor",
        pvNowW: groundFloor.pd_pvTotalPower,
        todayKWh: groundFloor.pd_todayPv,
        ratedKwp: groundFloor.pd_ratedPower,
        loadW: groundFloor.ef_acTotalOutActPower,

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
      soc: groundFloor.ef_emsSoc,
      powerW: batteryPower,
      state: batteryState,
      timestamp: groundFloor.timestamp,
    },
    location: {
      country: groundFloor.pd_countryName,
      city: groundFloor.pd_cityName,
      timezone: groundFloor.pd_timeZone,
    },
    currency: groundFloor.pd_currency,
    lastUpdated: groundFloor.timestamp,
    grid: {
      isPowerOn: groundFloor.ef_acTtlInPower > 0 || firstFloor.ef_acTtlInPower > 0,
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
    console.error("Failed to fetch dashboard data:", error); debugger;
    throw error;
  }
}

/**
 * Fetch trends data for all three tabs
 */
export async function fetchTrendsData(): Promise<TrendsSeries> {
  try {
    const [homeSeries, groundFloorSeries, firstFloorSeries] = await Promise.all([
      fetchTimeSeries(24),
      fetchTimeSeries(24, "Ground_Floor"),
      fetchTimeSeries(24, "First_Floor"),
    ]);

    const convertToTimeSeriesPoints = (records: EnergyRecord[]) =>
      records.map((r) => ({
        timestamp: r.timestamp,
        homePvPower: r.pd_pvTotalPower || 0,
        loadPower: (r.ef_ctThreePhaseTotalPower || r.ef_acTotalOutActPower) || 0,
        batteryPower: r.ef_emsPower || 0,
        gridPower: r.ef_acTtlInPower || 0,
        genPower: r.ef_genPower || 0,
        batterySoc: r.ef_emsSoc || 0,
      }));

    return {
      home: convertToTimeSeriesPoints(homeSeries),
      groundFloor: convertToTimeSeriesPoints(groundFloorSeries),
      firstFloor: convertToTimeSeriesPoints(firstFloorSeries),
    };
  } catch (error) {
    console.error("Failed to fetch trends data:", error); debugger;
    throw error;
  }
}

