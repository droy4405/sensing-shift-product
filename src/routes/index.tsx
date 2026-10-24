import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { classifyShock, runCrawlerAgent, getDsmFeed, runForecast } from "@/lib/pipeline.functions";
import { RETAILERS, type DsmFeed, type DsmSku } from "@/lib/dsm";
import type { Episode, ForecastResult, ShockFeatures } from "@/lib/agents.server";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shock Sense — Hedged retail buy plans" },
      { name: "description", content: "Crawl past shocks, pull SAP DSM sell-through, and get a hedged, scenario-weighted purchase forecast." },
      { property: "og:title", content: "Shock Sense — Hedged retail buy plans" },
      { property: "og:description", content: "Crawl past shocks, pull SAP DSM sell-through, and get a hedged, scenario-weighted purchase forecast." },
    ],
  }),
  component: Index,
});

type Preset = { description: string; categories: string; countries: string };
const PRESETS = {
  Tariff: { description: "US announces 25% tariff on Chinese consumer electronics and small appliances, effective in 60 days.", categories: "Consumer Electronics, Small Appliances", countries: "China" },
  Pandemic: { description: "Novel respiratory virus spreading across North America; early reports of lockdown talk and panic buying.", categories: "Household Essentials, Health & Personal Care, Grocery & Staples", countries: "United States, Mexico" },
  Sanctions: { description: "Broad trade sanctions announced on Vietnam textile & footwear exporters over labor violations.", categories: "Apparel & Footwear", countries: "Vietnam, Bangladesh" },
  "Port strike": { description: "West Coast dockworkers threaten a strike at LA/Long Beach ports starting next week.", categories: "Consumer Electronics, Apparel & Footwear, Small Appliances", countries: "China, Vietnam" },
  Heatwave: { description: "Record heat dome forecast across the US South and Midwest for the next three weeks.", categories: "Grocery & Staples, Small Appliances", countries: "United States" },
  "Viral trend": { description: "Air-fryer recipes going viral on TikTok; search interest up 300% in a week.", categories: "Small Appliances", countries: "United States, China" },
} satisfies Record<string, Preset>;
type ShockType = string;
const presetKeys = Object.keys(PRESETS) as (keyof typeof PRESETS)[];
type AgentRun = { id: string; name: string; reason: string; status: "crawling" | "done" | "error"; finding?: string; episodes?: Episode[] };

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const fmt = (n: number) => Math.round(n).toLocaleString();

function Index() {
  const classify = useServerFn(classifyShock);
  const crawlAgent = useServerFn(runCrawlerAgent);
  const dsmFn = useServerFn(getDsmFeed);
  const fcFn = useServerFn(runForecast);

  const [type, setType] = useState<ShockType>("Tariff");
  const [desc, setDesc] = useState<string>(PRESETS.Tariff.description);
  const [cats, setCats] = useState<string>(PRESETS.Tariff.categories);
  const [ctry, setCtry] = useState<string>(PRESETS.Tariff.countries);
  const [retailer, setRetailer] = useState<string>(RETAILERS[0]);

  const [crawlState, setCrawl] = useState<{ loading: boolean; features?: ShockFeatures; error?: string }>({ loading: false });
  const [agents, setAgents] = useState<AgentRun[]>([]);
  const [dsm, setDsm] = useState<{ loading: boolean; feed?: DsmFeed }>({ loading: false });
  const [fc, setFc] = useState<{ loading: boolean; result?: ForecastResult; error?: string }>({ loading: false });

  const shock = { type, description: desc, categories: split(cats), countries: split(ctry) };
  const episodes = agents.flatMap((a) => a.episodes ?? []).sort((a, b) => b.similarity - a.similarity);

  function pick(t: keyof typeof PRESETS) {
    setType(t); setDesc(PRESETS[t].description); setCats(PRESETS[t].categories); setCtry(PRESETS[t].countries);
  }

  async function runCrawl() {
    setCrawl({ loading: true }); setAgents([]); setFc({ loading: false });
    const c = await classify({ data: shock });
    if (!c.ok) return setCrawl({ loading: false, error: c.error });
    setCrawl({ loading: true, features: c.features });
    setAgents(c.lenses.map((l) => ({ ...l, status: "crawling" })));
    await Promise.all(
      c.lenses.map(async (l) => {
        const r = await crawlAgent({ data: { shock, lens: l.id } }).catch(() => ({ ok: false as const, error: "failed" }));
        setAgents((prev) => prev.map((a) => (a.id !== l.id ? a : r.ok ? { ...a, status: "done", finding: r.finding, episodes: r.episodes } : { ...a, status: "error", finding: r.error })));
      }),
    );
    setCrawl((s) => ({ ...s, loading: false }));
  }
  async function runDsm() {
    setDsm({ loading: true });
    setDsm({ loading: false, feed: await dsmFn({ data: { retailer } }) });
  }
  async function runFc() {
    if (!episodes.length || !crawlState.features) return;
    setFc({ loading: true });
    const r = await fcFn({ data: { shock, features: crawlState.features, episodes: episodes.slice(0, 8), retailer } });
    setFc(r.ok ? { loading: false, result: r.result } : { loading: false, error: r.error });
  }

  const ready = !crawlState.loading && episodes.length > 0 && !!dsm.feed && dsm.feed.retailer === retailer;

  return (
    <main className="min-h-screen">
      <div className="shell-bar flex h-12 items-center gap-4 px-6 text-sm">
        <span className="rounded bg-signal px-2 py-0.5 text-xs font-bold tracking-wide text-signal-foreground">SAP</span>
        <span className="font-semibold">Demand Signal Management</span>
        <span className="opacity-60">/ Shock Sense</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden rounded-full bg-shell-foreground/10 px-3 py-1 text-xs sm:inline">{retailer}</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-shell-foreground/15 text-xs font-bold">DR</span>
        </div>
      </div>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-6 py-6">
          <div>
            <p className="label-mono">Prototype · Sensing the Shift</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Shock-Aware Demand Forecast</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">Forecast from what shoppers bought, borrow from past shocks, and hedge the buy.</p>
          </div>
          <ol className="flex gap-2 text-xs font-semibold">
            {[["1", "Crawl", !!episodes.length], ["2", "SAP DSM", !!dsm.feed], ["3", "Forecast + Hedge", !!fc.result]].map(([n, s, done]) => (
              <li key={String(s)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${done ? "border-positive text-positive" : "border-border text-muted-foreground"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-positive text-signal-foreground" : "bg-muted"}`}>{done ? "✓" : String(n)}</span>{String(s)}
              </li>
            ))}
          </ol>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-6">

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 01 Crawler */}
        <section className="panel p-6">
          <StepHead n="01" title="Crawler agent team" sub="An orchestrator classifies any externality and dispatches specialist agents to crawl the web for past analogs." />
          <div className="mt-4 flex flex-wrap gap-2">
            {presetKeys.map((t) => (
              <button key={t} onClick={() => pick(t)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${t === type ? "border-signal bg-accent text-accent-foreground" : "border-border bg-card"}`}>{t}</button>
            ))}
          </div>
          <div className="mt-4"><Field label="Shock type (anything)" value={type} onChange={setType} /></div>
          <label className="label-mono mt-2 block">Early report (noisy)</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-input bg-card p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Categories" value={cats} onChange={setCats} />
            <Field label="Countries" value={ctry} onChange={setCtry} />
          </div>
          <ActionButton onClick={runCrawl} loading={crawlState.loading} label="Dispatch crawler agents" loadingLabel={crawlState.features ? "Agents crawling the web…" : "Orchestrator classifying…"} />
          {crawlState.error && <p className="mt-3 text-sm text-destructive">{crawlState.error}</p>}
          {crawlState.features && (
            <div className="mt-5 space-y-3">
              <div className="rounded-md border-l-4 border-signal bg-accent p-3 text-sm text-accent-foreground">
                <span className="font-mono text-xs">SEVERITY {crawlState.features.severity}/10 · </span>{crawlState.features.summary}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {agents.map((a) => (
                  <div key={a.id} className="rounded-lg border border-border bg-muted p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold">{a.name}</p>
                      <span className={`font-mono text-[0.6rem] uppercase ${a.status === "done" ? "text-positive" : a.status === "error" ? "text-destructive" : "animate-pulse text-signal"}`}>{a.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.finding ?? a.reason}</p>
                  </div>
                ))}
              </div>
              {episodes.map((e, i) => <EpisodeCard key={`${e.name}-${i}`} e={e} />)}
            </div>
          )}
        </section>

        {/* 02 DSM */}
        <section className="panel p-6">
          <StepHead n="02" title="SAP DSM connector" sub="Harmonized POS sell-through, shipments and on-hand stock by GTIN." />
          <div className="mt-4 flex gap-2">
            <select value={retailer} onChange={(e) => setRetailer(e.target.value)} className="flex-1 rounded-md border border-input bg-card p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              {RETAILERS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <ActionButton onClick={runDsm} loading={dsm.loading} label="Pull retailer feed" loadingLabel="Calling DSM…" />
          {dsm.feed && (
            <div className="mt-5">
              <p className="label-mono">{dsm.feed.source}</p>
              <div className="mt-2 flex gap-4 font-mono text-[0.65rem] text-muted-foreground">
                <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 bg-signal" /> sell-through (POS)</span>
                <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 bg-sellin" /> sell-in (orders)</span>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead><tr className="label-mono text-left"><th className="py-1">SKU</th><th>12 wk</th><th className="text-right">On hand</th></tr></thead>
                <tbody>
                  {dsm.feed.skus.map((s) => (
                    <tr key={s.gtin} className="border-t">
                      <td className="py-2"><div className="font-medium">{s.name}</div><div className="font-mono text-[0.65rem] text-muted-foreground">{s.category} · {s.originCountry}</div></td>
                      <td><Spark s={s} /></td>
                      <td className="text-right font-mono">{fmt(s.onHandStore + s.onHandDc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* 03 Forecast */}
      <section className="panel mt-6 p-6">
        <StepHead n="03" title="Reasoning forecast agent" sub="Weights each episode as a scenario, sets a core order now and a flexible reserve, then hedges across products." />
        <ActionButton onClick={runFc} loading={fc.loading} disabled={!ready} label={ready ? "Generate hedged buy plan" : "Run steps 01 and 02 first"} loadingLabel="Reasoning over scenarios…" />
        {fc.error && <p className="mt-3 text-sm text-destructive">{fc.error}</p>}
        {fc.result && dsm.feed && <ForecastView r={fc.result} feed={dsm.feed} />}
      </section>
      </div>
    </main>
  );
}

function StepHead({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="flex gap-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{n}</span>
      <div><h2 className="text-xl font-bold">{title}</h2><p className="text-sm text-muted-foreground">{sub}</p></div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div><label className="label-mono">{label}</label><input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-card p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
  );
}

function ActionButton({ onClick, loading, label, loadingLabel, disabled }: { onClick: () => void; loading: boolean; label: string; loadingLabel: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading || disabled} className="mt-4 w-full rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-signal-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground">
      {loading ? <span className="animate-pulse">{loadingLabel}</span> : label}
    </button>
  );
}

function EpisodeCard({ e }: { e: Episode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div><p className="font-medium">{e.name}</p><p className="font-mono text-[0.65rem] text-muted-foreground">{e.agent ? `${e.agent} · ` : ""}{e.period} · {e.shockType} · {e.countries.join(", ")}</p></div>
        <span className="shrink-0 rounded-full bg-accent text-accent-foreground px-2 py-0.5 font-mono text-xs ">{Math.round(e.similarity * 100)}% match</span>
      </div>
      <p className="mt-2 text-sm">{e.buyerResponse}</p>
      <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs">
        <span>Demand {pct(e.demandEffectPct)}</span><span>Orders {pct(e.orderEffectPct)}</span><span>{e.durationWeeks ?? "?"} wk</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {e.sources?.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="truncate text-xs text-signal underline">{s.title}</a>)}
      </div>
    </div>
  );
}

const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${n > 0 ? "+" : ""}${n}%`);

function Spark({ s }: { s: DsmSku }) {
  const max = Math.max(...s.sellThrough, ...s.sellIn);
  const pts = (arr: number[]) => arr.map((v, i) => `${(i / 11) * 100},${28 - (v / max) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-28">
      <polyline points={pts(s.sellIn)} fill="none" stroke="var(--color-sellin)" strokeWidth="1.2" strokeDasharray="2 2" />
      <polyline points={pts(s.sellThrough)} fill="none" stroke="var(--color-signal)" strokeWidth="1.8" />
    </svg>
  );
}

function ForecastView({ r, feed }: { r: ForecastResult; feed: DsmFeed }) {
  const byGtin = new Map(feed.skus.map((s) => [s.gtin, s]));
  const maxHigh = Math.max(...r.skus.map((s) => s.range.high), 1);
  const totalCore = r.skus.reduce((a, s) => a + s.coreOrder * (byGtin.get(s.gtin)?.unitCost ?? 0), 0);
  const totalFlex = r.skus.reduce((a, s) => a + s.flexibleReserve * (byGtin.get(s.gtin)?.unitCost ?? 0), 0);
  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-md border-l-4 border-signal bg-accent p-4 text-accent-foreground md:col-span-2">
          <p className="label-mono">Planner alert · confidence {r.confidence}</p>
          <p className="mt-1 font-medium">{r.alert}</p>
        </div>
        <Stat label="Core order now" value={`$${fmt(totalCore)}`} />
        <Stat label="Flexible reserve" value={`$${fmt(totalFlex)}`} />
      </div>
      <p className="text-sm text-muted-foreground">{r.reasoning}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="label-mono text-left"><th className="py-2">SKU</th><th>Weekly demand range (low · mid · high)</th><th className="text-right">Core now</th><th className="text-right">Flex reserve</th></tr></thead>
          <tbody>
            {r.skus.map((s) => {
              const sku = byGtin.get(s.gtin);
              return (
                <tr key={s.gtin} className="border-t align-top">
                  <td className="py-3 pr-4"><div className="font-medium">{sku?.name ?? s.gtin}</div><div className="max-w-xs text-xs text-muted-foreground">{s.rationale}</div></td>
                  <td className="py-3 pr-4">
                    <div className="relative h-3 w-full min-w-48 bg-muted">
                      <div className="absolute h-3 bg-signal/40" style={{ left: `${(s.range.low / maxHigh) * 100}%`, width: `${((s.range.high - s.range.low) / maxHigh) * 100}%` }} />
                      <div className="absolute h-3 w-0.5 bg-foreground" style={{ left: `${(s.range.mid / maxHigh) * 100}%` }} />
                      <div className="absolute top-0 h-3 w-0.5 bg-sellin" style={{ left: `${(s.baselineWeekly / maxHigh) * 100}%` }} />
                    </div>
                    <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{fmt(s.range.low)} · {fmt(s.range.mid)} · {fmt(s.range.high)} /wk · baseline {fmt(s.baselineWeekly)} · {s.horizonWeeks} wk horizon</div>
                  </td>
                  <td className="py-3 text-right font-mono font-medium">{fmt(s.coreOrder)}</td>
                  <td className="py-3 text-right font-mono text-muted-foreground">{fmt(s.flexibleReserve)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <h3 className="label-mono mb-2">Complementary hedges</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {r.hedges.map((h, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3">
                <p className="font-mono text-[0.65rem] text-muted-foreground">Offsets {byGtin.get(h.primaryGtin)?.name ?? h.primaryGtin}</p>
                <p className="mt-1 font-medium">{h.complement}</p>
                <p className="font-mono text-[0.65rem] text-positive">{h.complementCategory} · {h.complementOrigin} · {fmt(h.suggestedUnits)} units</p>
                <p className="mt-1 text-xs">{h.why}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="label-mono mb-2">Concentration risks</h3>
          <ul className="space-y-2 text-sm">{r.concentrationRisks.map((c, i) => <li key={i} className="border-l-2 border-destructive pl-2">{c}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4"><p className="label-mono">{label}</p><p className="mt-1 font-mono text-2xl font-medium">{value}</p></div>
  );
}
