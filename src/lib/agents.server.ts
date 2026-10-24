import { generateResponse } from "@lovable.dev/ai-gateway";
import type { DsmFeed } from "./dsm";

export type Shock = { type: string; description: string; categories: string[]; countries: string[] };

export type Episode = {
  name: string;
  period: string;
  shockType: string;
  categories: string[];
  countries: string[];
  similarity: number;
  buyerResponse: string;
  demandEffectPct: number;
  orderEffectPct: number;
  durationWeeks: number;
  sources: { title: string; url: string }[];
  agent?: string;
};

export type ShockFeatures = { severity: number; summary: string; noiseWarning: string };

export type SkuForecast = {
  gtin: string;
  baselineWeekly: number;
  scenarios: { episode: string; weight: number; weeklyDemand: number }[];
  range: { low: number; mid: number; high: number };
  horizonWeeks: number;
  netRequirement: number;
  coreOrder: number;
  flexibleReserve: number;
  rationale: string;
};

export type ForecastResult = {
  alert: string;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  skus: SkuForecast[];
  hedges: { primaryGtin: string; complement: string; complementCategory: string; complementOrigin: string; why: string; suggestedUnits: number }[];
  concentrationRisks: string[];
};

const MODEL = "openai/gpt-6-astra" as const;

function textOf(res: unknown): string {
  const r = res as { output_text?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] };
  if (r.output_text) return r.output_text;
  return (r.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
}

function parseJson<T>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

export const AGENT_LENSES = {
  trade: { name: "Trade Policy Agent", focus: "tariffs, quotas, export controls, trade wars, Federal Register notices, Trade Policy Uncertainty index" },
  health: { name: "Public Health Agent", focus: "pandemics, epidemics, product recalls, panic buying and stockpiling" },
  geopolitics: { name: "Geopolitics Agent", focus: "economic sanctions, wars, embargoes, political instability" },
  logistics: { name: "Logistics Agent", focus: "port strikes, canal blockages, shipping rates, NY Fed GSCPI supply-chain pressure" },
  climate: { name: "Climate & Weather Agent", focus: "hurricanes, heatwaves, floods, droughts, crop failures, seasonal anomalies" },
  macro: { name: "Macro & Consumer Agent", focus: "inflation, recessions, interest rates, stimulus, consumer confidence, Census retail sales and inventories" },
  social: { name: "Social & Trends Agent", focus: "viral products, social media trends, celebrity effects, search-trend spikes" },
  energy: { name: "Energy & Commodities Agent", focus: "oil and gas price spikes, raw material and component shortages (e.g. chips, resin, cotton)" },
} as const;
export type LensId = keyof typeof AGENT_LENSES;

export async function runClassifierAgent(shock: Shock): Promise<{ features: ShockFeatures; lenses: { id: LensId; reason: string }[] }> {
  const res = await generateResponse({
    model: MODEL,
    reasoning: { effort: "low" },
    instructions:
      "You are the orchestrator of a team of supply-chain crawler agents. Classify any kind of externality (not limited to a fixed list) and dispatch the most relevant specialist agents. Return ONLY JSON.",
    input: `Shock report: ${JSON.stringify(shock)}
Available agents: ${JSON.stringify(Object.fromEntries(Object.entries(AGENT_LENSES).map(([k, v]) => [k, v.focus])))}
Return {"features":{"severity":0-10,"summary":"one sentence classification e.g. 'tariff shock, consumer electronics, China'","noiseWarning":"what is uncertain about early reports (max 30 words)"},"lenses":[{"id":"<agent id>","reason":"max 12 words"}]}
Pick 3 or 4 agents, most relevant first.`,
  });
  const out = parseJson<{ features: ShockFeatures; lenses: { id: string; reason: string }[] }>(textOf(res));
  const lenses = out.lenses.filter((l): l is { id: LensId; reason: string } => l.id in AGENT_LENSES).slice(0, 4);
  return { features: out.features, lenses: lenses.length ? lenses : [{ id: "macro", reason: "General fallback" }] };
}

export async function runSpecialistAgent(shock: Shock, lens: LensId): Promise<{ finding: string; episodes: Episode[] }> {
  const L = AGENT_LENSES[lens];
  const res = await generateResponse({
    model: MODEL,
    tools: [{ type: "web_search" }],
    reasoning: { effort: "low" },
    instructions: `You are the ${L.name}, a web crawler specialising in ${L.focus}. Search the internet for PAST historical episodes, viewed through your lens, that are comparable to the current shock and show how shoppers and retail buyers reacted. Prefer authoritative sources (government data, central banks, academic papers, major outlets). Match by product category, not just shock type. Return ONLY JSON.`,
    input: `Current shock (early, noisy report): ${JSON.stringify(shock)}
Return {"finding":"one-sentence takeaway from your lens","episodes":[{"name":"","period":"e.g. 2018-2019","shockType":"","categories":[],"countries":[],"similarity":0-1,"buyerResponse":"what retailers/buyers did","demandEffectPct":number,"orderEffectPct":number,"durationWeeks":number,"sources":[{"title":"","url":""}]}]}
Give 2 episodes with 1-2 real source URLs each. Effect fields MUST be numbers (best estimate; say "est." in buyerResponse when estimated). Text fields max 30 words.`,
  });
  const out = parseJson<{ finding: string; episodes: Episode[] }>(textOf(res));
  return { finding: out.finding, episodes: out.episodes.map((e) => ({ ...e, agent: L.name })) };
}

export async function runForecastAgent(shock: Shock, features: ShockFeatures, episodes: Episode[], dsm: DsmFeed): Promise<ForecastResult> {
  const compact = dsm.skus.map((s) => ({
    gtin: s.gtin, name: s.name, category: s.category, origin: s.originCountry, unitCost: s.unitCost,
    sellThrough: s.sellThrough, sellIn: s.sellIn, onHand: s.onHandStore + s.onHandDc, inTransit: s.inTransit, leadTimeWeeks: s.leadTimeWeeks,
  }));
  const res = await generateResponse({
    model: MODEL,
    reasoning: { effort: "medium" },
    instructions:
      "You are a demand-planning reasoning agent for a retailer. Forecast from SELL-THROUGH (shopper POS), not sell-in. Treat each matched past episode as a scenario weighted by similarity (normalize weights to sum 1). Only apply episode effects to SKUs whose category/origin is exposed to the shock; unexposed SKUs keep baseline (scenario effects near 0). Combine scenarios into a low/mid/high weekly demand range. Horizon = leadTimeWeeks + 4. netRequirement = mid*horizon - onHand - inTransit (min 0). coreOrder = quantity every scenario supports = max(0, low*horizon - onHand - inTransit). flexibleReserve = max(0, high*horizon - onHand - inTransit - coreOrder) held as staged orders. Then hedge: for exposed SKUs propose complementary/substitute products from DIFFERENT countries of origin or categories so a loss on one is offset by another. Flag concentration risks (same category or origin). Return ONLY JSON.",
    input: `Shock: ${JSON.stringify(shock)}
Classification: ${JSON.stringify(features)}
Matched episodes: ${JSON.stringify(episodes.map(({ sources, ...e }) => e))}
SAP DSM harmonized feed for ${dsm.retailer}: ${JSON.stringify(compact)}

Return JSON:
{"alert":"planner-facing warning, 1-2 sentences","confidence":"low|medium|high","reasoning":"3-4 sentences on how scenarios were combined",
"skus":[{"gtin":"","baselineWeekly":int,"scenarios":[{"episode":"","weight":0-1,"weeklyDemand":int}],"range":{"low":int,"mid":int,"high":int},"horizonWeeks":int,"netRequirement":int,"coreOrder":int,"flexibleReserve":int,"rationale":"one sentence"}],
"hedges":[{"primaryGtin":"","complement":"product name","complementCategory":"","complementOrigin":"country","why":"","suggestedUnits":int}],
"concentrationRisks":["..."]}
Include every SKU.`,
  });
  return parseJson(textOf(res));
}
