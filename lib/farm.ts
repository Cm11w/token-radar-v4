// Farm plans and risk narratives for radar-4.
//
// Every plan is derived from the protocol's own record (category, chains, TVL,
// age) and its risk score: riskier rows get smaller suggested positions and an
// explicit band check before sizing. Every step states what it costs and how
// long it takes. Nothing here names a protocol from a hand-kept list.

import type { Proto, RiskParts } from './model.ts';

/** Dollars, compact: $1.2M, $850K, $42. */
export function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/** A step as one string: action, cost, time, inside the gate's 20..600 chars. */
function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  return s;
}

/** Suggested position size: the riskier the row, the smaller the stake. */
function stakeFor(riskScore: number): number {
  if (riskScore < 30) return 250;
  if (riskScore <= 55) return 150;
  return 75;
}

/** How long to keep the position open, from the protocol's age. */
function holdFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: Proto, stake: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Lend $${stake} of USDC on ${n} (${chain}) and leave the supply position open so it counts in every snapshot`;
  if (c.includes('dex') || c.includes('swap')) return `Add $${stake} of liquidity to ${n}'s deepest pool on ${chain} and keep the LP position open`;
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator')) return `Deposit $${stake} into ${n}'s main yield vault on ${chain} and hold the vault shares`;
  if (c.includes('bridge')) return `Bridge $${stake} of USDC through ${n} to ${chain}, then use the bridged funds inside the app it connects to`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${stake} through ${n} on ${chain} and keep the staking receipt in the same wallet`;
  if (c.includes('perpetual') || c.includes('deriv') || c.includes('options')) return `Deposit $${stake} of USDC as margin on ${n} and open one small hedged position`;
  if (c.includes('rwa') || c.includes('real world')) return `Mint $${stake} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Allocate $${stake} to a ${n} vault on ${chain} and keep the shares untouched`;
  if (c.includes('stable')) return `Mint or deposit $${stake} of the stable asset through ${n} on ${chain} and hold it`;
  if (c.includes('prediction')) return `Fund the wallet with $${stake} and take one position in an active ${n} market`;
  if (c.includes('insurance')) return `Buy $${stake} of cover from ${n} on ${chain} and keep the policy active`;
  if (c.includes('basis')) return `Deposit $${stake} into ${n}'s basis strategy on ${chain} and keep the position open`;
  return `Deposit $${stake} of USDC into ${n} on ${chain} and keep the position open`;
}

/**
 * Six farm steps for one row. The fifth step is the risk check: it quotes the
 * row's own uncertainty band so the reader sizes the position against the low
 * end, not the headline number.
 */
export function farmPlan(p: Proto, age: number | null, riskScore: number, low: number, high: number): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const stake = stakeFor(riskScore);
  const hold = holdFor(age);
  const gas = stake >= 250 ? 9 : stake >= 150 ? 6 : 4;
  const band = riskScore < 30 ? 'narrow' : riskScore <= 55 ? 'wide' : 'very wide';
  return [
    step(
      `Open a fresh wallet that holds only this farm's funds, write its seed phrase on paper, and fund it from an exchange withdrawal, never from a wallet that holds your main assets`,
      `under $3 of gas for the first transfer`,
      `10 minutes`,
    ),
    step(
      coreAction(p, stake, chain),
      `$${stake} of capital plus about $${gas} of gas`,
      `20 minutes to set up`,
    ),
    step(
      `Return once a week and make one real on-chain action: a deposit, a borrow, a swap, a vote, or a claim, so the wallet shows repeated use rather than one deposit`,
      `about $2 of gas a week`,
      `10 minutes a week`,
    ),
    step(
      `Keep the position open for at least ${hold} days, through more than one monthly snapshot, and do not move the funds between wallets mid-farm`,
      `the $${stake} stays locked in the position`,
      `${hold} days`,
    ),
    step(
      `Before adding more, re-check this row's ${band} value band of ${money(low)} to ${money(high)}: size the position so the low end still justifies the capital, and cut the stake in half if the band widens or TVL falls sharply`,
      `nothing to check`,
      `10 minutes a month`,
    ),
    step(
      `When a claim opens, use only the link the protocol itself publishes, verify the contract address on the chain explorer, and log every transaction date and amount so you can unwind the position cleanly`,
      `gas only, and never pay anyone to claim`,
      `15 minutes at claim time`,
    ),
  ];
}

/** One risk driver's plain-language sentence, from its measured part. */
function driverSentence(
  key: keyof RiskParts,
  p: Proto,
  age: number | null,
  parts: RiskParts,
  multipleSource: 'category' | 'global',
): string {
  const chains = p.chains.length;
  switch (key) {
    case 'concentration':
      return chains <= 1
        ? `all of its TVL sits on one chain (${p.chains[0] ?? 'a single chain'}), so a chain-level event moves the whole protocol`
        : `its TVL spans ${chains} chains, which spreads chain-level risk`;
    case 'volatility':
      return p.change_7d === null
        ? `its seven-day TVL change is unreported, so recent stability cannot be checked`
        : `its TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% in seven days, ${Math.abs(p.change_7d) > 20 ? 'a fast move that may not hold' : 'a calm week for its size'}`;
    case 'youth':
      return age === null
        ? `no listing date is recorded, so the length of its record is unknown`
        : age < 90
          ? `it has been tracked only ${age} days, a short record to price from`
          : `it has been tracked ${age} days, a long enough record to trust more`;
    case 'smallness':
      return p.tvl_usd < 50_000_000
        ? `at ${money(p.tvl_usd)} of TVL it sits below the $50M watchlist floor, and small protocols reprice faster`
        : `at ${money(p.tvl_usd)} of TVL it clears the $50M watchlist floor, which steadies the estimate`;
    case 'dispersion':
      if (multipleSource === 'global' || p.category === null) {
        return `with too few traded tokens in its category to measure from, its band inherits the whole market's wide disagreement on value`;
      }
      return `traded ${p.category} tokens ${parts.dispersion > 0.6 ? 'disagree widely on value, so the band stays wide' : 'price fairly tightly, which narrows the band'}`;
  }
}

/**
 * The risk narrative: the two drivers that move this row's score most, the
 * scenario that would change its rank, and what to watch. Written from the
 * measured parts, never from the protocol's name.
 */
export function riskNarrative(input: {
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
}): string {
  const { p, age, parts, score, low, high, rankAtLow, rankAtHigh, multipleSource } = input;
  const weights: Record<keyof RiskParts, number> = { concentration: 0.2, volatility: 0.25, youth: 0.2, smallness: 0.15, dispersion: 0.2 };
  const drivers = (Object.keys(parts) as (keyof RiskParts)[]).sort((a, b) => parts[b] * weights[b] - parts[a] * weights[a]).slice(0, 2);
  const level = score < 30 ? 'low' : score <= 55 ? 'moderate' : 'high';
  const swing =
    rankAtHigh === rankAtLow
      ? `its band is tight enough that it holds rank #${rankAtHigh} at either end`
      : `at the low end of its band it would rank #${rankAtLow}, and at the high end #${rankAtHigh}`;
  return (
    `Risk is ${level} (score ${score}/100). What drives it most: ${driverSentence(drivers[0]!, p, age, parts, multipleSource)}, and ${driverSentence(drivers[1]!, p, age, parts, multipleSource)}. ` +
    `The value band runs ${money(low)} to ${money(high)}, and ${swing}. ` +
    `What would change the ranking: a sharp TVL move, expansion to more chains, or a longer clean record would each narrow the band and lift confidence; a TVL slide or a stalled record would widen it.`
  );
}
