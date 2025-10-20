import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";

const BACKEND_API = "https://dair.drd-home.online";

/**
 * Fetch data from the external energy API
 */
async function fetchEnergyData(endpoint: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  const url = `${BACKEND_API}${endpoint}?${searchParams.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch from ${endpoint}: ${response.statusText}`);
  }

  return response.json();
}

export const energyRouter = router({
  /**
   * Get latest data for a specific inverter
   */
  getLatest: publicProcedure
    .input(
      z.object({
        plantId: z.string(),
        label: z.string(),
      })
    )
    .query(async ({ input }) => {
            const data = await fetchEnergyData("/export-compact", {
        plantId: input.plantId,
        label: input.label,
        limit: "1",
        fmt: "json",
        dedupe: "true",
      });

      if (!data.rows || data.rows.length === 0) {
        throw new Error(`No data returned for ${input.label}`);
      }

      return data.rows[0];
    }),

  /**
   * Get time-series data for trends
   */
  getTimeSeries: publicProcedure
    .input(
      z.object({
        plantId: z.string(),
        label: z.string().optional(),
        hours: z.number().default(24),
      })
    )
    .query(async ({ input }) => {
      const params: Record<string, string> = {
        plantId: input.plantId,
        fmt: "json",
        limit: String(Math.ceil((input.hours * 60) / 5)), // 5-min intervals
        dedupe: "true",
        hours: String(input.hours),
      };

      if (input.label) {
        params.label = input.label;
      }

            const data = await fetchEnergyData("/export-compact", params);

      if (!data.rows) {
        return [];
      }

      return data.rows;
    }),
});

