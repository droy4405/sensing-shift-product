import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchDsmFeed, type DsmFeed } from "./dsm";
import { AGENT_LENSES, runClassifierAgent, runSpecialistAgent, runForecastAgent, type Episode, type LensId, type Shock, type ShockFeatures } from "./agents.server";

const shockSchema = z.object({
  type: z.string().min(1).max(60),
  description: z.string().min(1).max(1000),
  categories: z.array(z.string().max(80)).max(10),
  countries: z.array(z.string().max(80)).max(10),
});

function friendly(e: unknown): string {
  console.error(e);
  const m = e instanceof Error ? e.message : String(e);
  if (/payment|credit/i.test(m)) return "AI credits are exhausted. Add credits to continue.";
  if (/rate/i.test(m)) return "Too many requests right now — try again in a minute.";
  return "The agent could not finish. Please try again.";
}

export const classifyShock = createServerFn({ method: "POST" })
  .inputValidator((d) => shockSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const r = await runClassifierAgent(data as Shock);
      return { ok: true as const, features: r.features, lenses: r.lenses.map((l) => ({ ...l, name: AGENT_LENSES[l.id].name as string })) };
    } catch (e) {
      return { ok: false as const, error: friendly(e) };
    }
  });

export const runCrawlerAgent = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ shock: shockSchema, lens: z.string() }).parse(d))
  .handler(async ({ data }) => {
    if (!(data.lens in AGENT_LENSES)) return { ok: false as const, error: "Unknown agent" };
    try {
      return { ok: true as const, ...(await runSpecialistAgent(data.shock as Shock, data.lens as LensId)) };
    } catch (e) {
      return { ok: false as const, error: friendly(e) };
    }
  });

export const getDsmFeed = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ retailer: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => fetchDsmFeed(data.retailer));

export const runForecast = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ shock: shockSchema, features: z.any(), episodes: z.array(z.any()).max(10), retailer: z.string().max(80) }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const dsm: DsmFeed = fetchDsmFeed(data.retailer);
      const result = await runForecastAgent(data.shock as Shock, data.features as ShockFeatures, data.episodes as Episode[], dsm);
      return { ok: true as const, result };
    } catch (e) {
      return { ok: false as const, error: friendly(e) };
    }
  });
