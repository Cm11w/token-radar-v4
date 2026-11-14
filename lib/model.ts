// radar-4: a risk-adjusted token launch radar.
//
// The board ranks pre-token protocols by a RISK-ADJUSTED implied value, and every
// row carries an uncertainty band instead of pretending to a single exact number.
// Everything is measured from the sealed snapshot at run time: the market multiple
// comes from the traded tokens in the same snapshot, the band comes from the
// spread of those multiples, and the risk haircut comes from five signals the
// snapshot itself carries (chain concentration, seven-day TVL movement, age,
// size relative to the watchlist floor, and how widely traded tokens in the
// category disagree on value). No protocol name is ever special-cased.
//
//   multiple     = median mcap/TVL of traded tokens, per category when the
//                  category holds at least 4 traded tokens, else the whole
//                  market's median
//   growth       = 1 + clamp(change_7d, -50, 100) / 100 * 0.4
//   maturity     = 0.7 + min(age_days, 1095) / 1095 * 0.3   (unknown age: 365)
//   risk         = weighted mean of five 0..1 risk parts, as a 0..100 score
//   adjustment   = 1 - 0.5 * risk / 100                    (0.50 .. 1.00)
//   implied      = round(tvl * multiple * growth * maturity * adjustment)
//   band low     = round(tvl * p25 * growth * maturity * adjustment)
//   band high    = round(tvl * p75 * growth * maturity)
//
// The band's low end is haircut by risk and its high end is not: risk trims what
// a reader should count on, never what the upside could be. The board sorts by
// the risk-adjusted point value, so rank 1 is the best value AFTER risk, and
// each row also states where it would rank at either end of its band.

/** One protocol of the sealed snapshot: exactly its ten fields. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** Why the input is not a snapshot this radar can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The measured market: quartiles of mcap/TVL and the log-multiple spread. */
export interface Market {
  n: number;
  median: number;
  p25: number;
  p75: number;
  logSd: number;
}

/** The five risk parts, each 0..1 with 1 the riskiest, and their weights. */
export interface RiskParts {
  concentration: number;
  volatility: number;
  youth: number;
  smallness: number;
  dispersion: number;
}

export const RISK_WEIGHTS: RiskParts = {
  concentration: 0.2,
  volatility: 0.25,
  youth: 0.2,
  smallness: 0.15,
  dispersion: 0.2,
};

/** The model's constants, stated in the dashboard's method view. */
export const MODEL = {
  version: 'radar-4',
  minCategorySample: 4,
  growthWeight: 0.4,
  growthFloor: -50,
  growthCap: 100,
  maturityFloor: 0.7,
  maturityRange: 0.3,
  maturityDays: 1095,
  unknownAgeDays: 365,
  youthDays: 730,
  volatilityScale: 60,
  dispersionScale: 2.5,
  maxHaircut: 0.5,
  liveRows: 24,
} as const;

/** One ranked row of board.json. Extra keys are the gate's own allowance. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  band_spread: number;
  risk_score: number;
  confidence: number;
  confidence_band: 'High' | 'Medium' | 'Low';
  risk_parts: RiskParts;
  risk_adjustment: number;
  rank_at_low: number;
  rank_at_high: number;
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
    multiple_n: number;
    p25: number;
    p75: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  risk_narrative: string;
  farm_steps: string[];
}

/** A traded protocol, shown apart: the market's own value, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  market: Market;
  weights: RiskParts;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A quantile of ascending values by linear interpolation. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Standard deviation of an array (population form). */
function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length);
}

/** The market's multiples measured from its traded tokens. */
export function measureMarket(multiples: number[]): Market {
  const sorted = [...multiples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    logSd: stddev(sorted.map((m) => Math.log(Math.max(m, 1e-9)))),
  };
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist rule's own exclusions, applied to every row, not just the list. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol is a genuine launch candidate: pre-token, and not a
 * wrapped, staked or bridged product of a token that already trades. The
 * starter's narrower check lets WBTC-style rows onto the board; this one does
 * not, because the rules name those products explicitly as not launches.
 */
export function isLaunchCandidate(p: Proto): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The five risk parts of one protocol, each 0..1. */
export function riskParts(p: Proto, age: number | null, floorUsd: number, dispersionSd: number): RiskParts {
  const concentration = 1 / Math.sqrt(Math.max(1, p.chains.length));
  const volatility = p.change_7d === null ? 0.6 : Math.min(1, Math.abs(p.change_7d) / MODEL.volatilityScale);
  const youth = age === null ? 0.7 : 1 - Math.min(age, MODEL.youthDays) / MODEL.youthDays;
  const smallness = Math.max(0, 1 - p.tvl_usd / floorUsd);
  const dispersion = Math.min(1, dispersionSd / MODEL.dispersionScale);
  return { concentration, volatility, youth, smallness, dispersion };
}

/** The 0..100 risk score: the weighted mean of the parts. */
export function riskScore(parts: RiskParts): number {
  const w = RISK_WEIGHTS;
  return Math.round(100 * (parts.concentration * w.concentration + parts.volatility * w.volatility + parts.youth * w.youth + parts.smallness * w.smallness + parts.dispersion * w.dispersion));
}

/** The confidence band a risk score falls in. */
export function confidenceBand(score: number): 'High' | 'Medium' | 'Low' {
  return score < 30 ? 'High' : score <= 55 ? 'Medium' : 'Low';
}

/** The growth multiplier from a seven-day TVL change, clamped and damped. */
export function growthMultiplier(change7d: number | null): { pct: number; mult: number } {
  const pct = Math.min(MODEL.growthCap, Math.max(MODEL.growthFloor, change7d ?? 0));
  return { pct, mult: 1 + (pct / 100) * MODEL.growthWeight };
}

/** The maturity multiplier from age: older records price closer to full value. */
export function maturityMultiplier(age: number | null): number {
  const days = age ?? MODEL.unknownAgeDays;
  return MODEL.maturityFloor + (Math.min(Math.max(days, 0), MODEL.maturityDays) / MODEL.maturityDays) * MODEL.maturityRange;
}

/** The snapshot out of a file's text, refused unless it is the shape scored. */
export function parseSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols: Proto[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      slug: p.slug,
      name: p.name,
      category: strOrNull(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: numOrNull(p.change_7d),
      mcap_usd: numOrNull(p.mcap_usd),
      listed_at: strOrNull(p.listed_at),
      gecko_id: strOrNull(p.gecko_id),
      symbol: strOrNull(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** A row's valuation before ranks are assigned. */
interface Scored {
  p: Proto;
  age: number | null;
  point: number;
  low: number;
  high: number;
  score: number;
  parts: RiskParts;
  adjustment: number;
  multiple: number;
  multipleSource: 'category' | 'global';
  multipleN: number;
  p25: number;
  p75: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
}

/**
 * Score every launch candidate: the watchlist whole, plus every other
 * candidate below the floor. Rows sort by the risk-adjusted point value, and
 * each row learns where it would rank at either end of its own band.
 */
export function scoreBoard(
  snapshot: Snap,
  plan: (p: Proto, age: number | null, score: number, low: number, high: number) => string[],
  narrate: (input: {
    p: Proto;
    age: number | null;
    parts: RiskParts;
    score: number;
    low: number;
    high: number;
    rankAtLow: number;
    rankAtHigh: number;
    multipleSource: 'category' | 'global';
    multipleN: number;
  }) => string,
): { board: BoardRow[]; market: Market } {
  const traded = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX');
  const market = measureMarket(traded.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategory = new Map<string, Market>();
  // Per-category markets only where the category holds enough traded tokens
  // to measure from; smaller categories fall back to the whole market.
  const members = new Map<string, number[]>();
  for (const p of traded) {
    if (p.category === null) continue;
    const arr = members.get(p.category) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    members.set(p.category, arr);
  }
  for (const [cat, arr] of members) if (arr.length >= MODEL.minCategorySample) byCategory.set(cat, measureMarket(arr));

  const onList = new Set(snapshot.watchlist);
  const chosen = new Map<string, Proto>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((x) => x.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }

  const scored: Scored[] = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const cat = p.category !== null ? byCategory.get(p.category) : undefined;
    const use = cat !== undefined ? cat : market;
    const source: 'category' | 'global' = cat !== undefined ? 'category' : 'global';
    const dispersionSd = cat !== undefined ? cat.logSd : market.logSd;
    const parts = riskParts(p, age, snapshot.floor_usd, dispersionSd);
    const score = riskScore(parts);
    const adjustment = 1 - MODEL.maxHaircut * (score / 100);
    const { pct, mult } = growthMultiplier(p.change_7d);
    const maturity = maturityMultiplier(age);
    const point = Math.max(1, Math.round(p.tvl_usd * use.median * mult * maturity * adjustment));
    const low = Math.max(1, Math.round(p.tvl_usd * use.p25 * mult * maturity * adjustment));
    const high = Math.max(point, Math.round(p.tvl_usd * use.p75 * mult * maturity));
    return {
      p,
      age,
      point,
      low: Math.min(low, point),
      high,
      score,
      parts,
      adjustment,
      multiple: use.median,
      multipleSource: source,
      multipleN: use.n,
      p25: use.p25,
      p75: use.p75,
      growthPct: pct,
      growthMult: mult,
      maturityMult: maturity,
    };
  });
  scored.sort((a, b) => b.point - a.point || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const points = scored.map((s) => s.point);
  const board: BoardRow[] = scored.map((s, i) => {
    const rankAtHigh = 1 + points.filter((v) => v > s.high).length;
    const rankAtLow = 1 + points.filter((v) => v > s.low).length;
    const narrative = narrate({
      p: s.p,
      age: s.age,
      parts: s.parts,
      score: s.score,
      low: s.low,
      high: s.high,
      rankAtLow,
      rankAtHigh,
      multipleSource: s.multipleSource,
      multipleN: s.multipleN,
    });
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      on_watchlist: onList.has(s.p.slug),
      age_days: s.age,
      implied_value_usd: s.point,
      band_low_usd: s.low,
      band_high_usd: s.high,
      band_spread: round4(s.high / s.low),
      risk_score: s.score,
      confidence: 100 - s.score,
      confidence_band: confidenceBand(s.score),
      risk_parts: {
        concentration: round4(s.parts.concentration),
        volatility: round4(s.parts.volatility),
        youth: round4(s.parts.youth),
        smallness: round4(s.parts.smallness),
        dispersion: round4(s.parts.dispersion),
      },
      risk_adjustment: round4(s.adjustment),
      rank_at_low: rankAtLow,
      rank_at_high: rankAtHigh,
      model: {
        multiple: round4(s.multiple),
        multiple_source: s.multipleSource,
        multiple_n: s.multipleN,
        p25: round4(s.p25),
        p75: round4(s.p75),
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      risk_narrative: narrative,
      farm_steps: plan(s.p, s.age, s.score, s.low, s.high),
    };
  });
  return { board, market };
}

/** The traded set, by market cap, kept apart from the ranked board. */
export function liveSet(snapshot: Snap): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd)
    .slice(0, MODEL.liveRows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from one scored snapshot. */
export function buildRadar(
  snapshot: Snap,
  plan: (p: Proto, age: number | null, score: number, low: number, high: number) => string[],
  narrate: (input: {
    p: Proto;
    age: number | null;
    parts: RiskParts;
    score: number;
    low: number;
    high: number;
    rankAtLow: number;
    rankAtHigh: number;
    multipleSource: 'category' | 'global';
    multipleN: number;
  }) => string,
): { board: BoardRow[]; radar: RadarData } {
  const { board, market } = scoreBoard(snapshot, plan, narrate);
  const live = liveSet(snapshot);
  const onList = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.version,
    market: { n: market.n, median: round4(market.median), p25: round4(market.p25), p75: round4(market.p75), logSd: round4(market.logSd) },
    weights: RISK_WEIGHTS,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !onList.has(r.slug)).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate takes, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snap): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.band_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.band_high_usd)) return `${r.slug} has a band that misses its point value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
