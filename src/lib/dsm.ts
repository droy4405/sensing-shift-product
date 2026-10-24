// Mock SAP Demand Signal Management (DSM) feed — harmonized POS sell-through,
// sell-in shipments and on-hand stock, matched by GTIN. Deterministic so the
// prototype is reproducible. Replace `fetchDsmFeed` with a real DSM OData call.

export type DsmSku = {
  gtin: string;
  name: string;
  category: string;
  originCountry: string;
  unitCost: number;
  sellThrough: number[]; // last 12 weeks, units sold to shoppers (POS)
  sellIn: number[]; // last 12 weeks, units shipped to retailer (orders)
  onHandStore: number;
  onHandDc: number;
  inTransit: number;
  leadTimeWeeks: number;
};

export type DsmFeed = {
  retailer: string;
  source: string;
  harmonizedAt: string;
  weeks: string[];
  skus: DsmSku[];
};

export const RETAILERS = ["Walmart US", "Target", "Costco Wholesale"] as const;

const CATALOG: Omit<DsmSku, "sellThrough" | "sellIn" | "onHandStore" | "onHandDc" | "inTransit">[] = [
  { gtin: "00885909950805", name: "55\" 4K Smart TV", category: "Consumer Electronics", originCountry: "China", unitCost: 289, leadTimeWeeks: 8 },
  { gtin: "00194252707043", name: "Wireless Earbuds", category: "Consumer Electronics", originCountry: "Vietnam", unitCost: 38, leadTimeWeeks: 6 },
  { gtin: "00840006609157", name: "Air Fryer 6qt", category: "Small Appliances", originCountry: "China", unitCost: 41, leadTimeWeeks: 7 },
  { gtin: "00012000161155", name: "Bottled Water 24pk", category: "Grocery & Staples", originCountry: "United States", unitCost: 3.9, leadTimeWeeks: 1 },
  { gtin: "00036000291452", name: "Paper Towels 12 roll", category: "Household Essentials", originCountry: "United States", unitCost: 14.5, leadTimeWeeks: 2 },
  { gtin: "00305210100117", name: "Hand Sanitizer 8oz", category: "Health & Personal Care", originCountry: "Mexico", unitCost: 1.8, leadTimeWeeks: 3 },
  { gtin: "00191567400125", name: "Kids Sneakers", category: "Apparel & Footwear", originCountry: "Vietnam", unitCost: 17, leadTimeWeeks: 10 },
  { gtin: "00887276654412", name: "Cotton T-Shirt 3pk", category: "Apparel & Footwear", originCountry: "Bangladesh", unitCost: 6.2, leadTimeWeeks: 9 },
];

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function fetchDsmFeed(retailer: string): DsmFeed {
  const base = retailer.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const weeks = Array.from({ length: 12 }, (_, i) => `W${i + 31}`);
  const skus = CATALOG.map((c, idx) => {
    const r = seeded(base + idx * 97);
    const level = Math.round(400 + r() * 2400) * (c.unitCost < 10 ? 4 : 1);
    const trend = (r() - 0.4) * 0.04;
    const sellThrough = weeks.map((_, w) => Math.round(level * (1 + trend * w) * (0.88 + r() * 0.24)));
    // sell-in amplified vs sell-through (bullwhip)
    const sellIn = sellThrough.map((v, w) => Math.round(v * (0.7 + r() * 0.65) * (w % 4 === 0 ? 1.3 : 1)));
    const avg = sellThrough.reduce((a, b) => a + b, 0) / 12;
    return {
      ...c,
      sellThrough,
      sellIn,
      onHandStore: Math.round(avg * (0.8 + r() * 1.2)),
      onHandDc: Math.round(avg * (1 + r() * 2.5)),
      inTransit: Math.round(avg * r() * 1.5),
    };
  });
  return { retailer, source: "SAP DSM · EDI 852 + ERP shipments (simulated)", harmonizedAt: new Date().toISOString(), weeks, skus };
}
