/**
 * Pure cost pricing: CNY-per-1M-token price table resolution and cost
 * computation, with DeepSeek peak/off-peak hour awareness.
 *
 * All functions are deterministic and dependency-free so the projection fold
 * and its tests can share one implementation.
 *
 * @module dsh-cost-monitor/pricing
 */

/** One model's prices, CNY per 1M tokens. */
export interface ModelPrice {
  /** Uncached input (and cache-write) price, CNY per 1M tokens. */
  miss: number
  /** Cache-hit input price, CNY per 1M tokens. */
  hit: number
  /** Output price, CNY per 1M tokens. */
  out: number
  /** Peak-hour prices; absent falls back to the flat fields. */
  peak?: { miss: number; hit: number; out: number }
}

/** Price table keyed by `provider/model` or bare `model`. */
export type PricingTable = Record<string, ModelPrice>

/** DeepSeek official prices effective 2026-08-17 (peak/off-peak tiering). */
export const DEFAULT_PRICING: PricingTable = {
  'deepseek-v4-flash': {
    miss: 1.5,
    hit: 0.05,
    out: 4.5,
    peak: { miss: 3.0, hit: 0.10, out: 9.0 },
  },
  'deepseek-v4-pro': {
    miss: 4.5,
    hit: 0.15,
    out: 13.5,
    peak: { miss: 9.0, hit: 0.30, out: 27.0 },
  },
}

/** Default peak hours: Beijing time 9-12 and 14-18, half-open intervals. */
export const DEFAULT_PEAK_HOURS: readonly (readonly [number, number])[] = [
  [9, 12],
  [14, 18],
]

/**
 * Whether a moment falls inside a peak hour under Beijing time (UTC+8).
 * @param time - epoch milliseconds.
 * @param peakHours - half-open [start, end) hour pairs in Beijing local time.
 * @returns true when any interval contains the Beijing-time hour.
 */
export function isPeakBeijing(
  time: number,
  peakHours: readonly (readonly [number, number])[],
): boolean {
  const bj = new Date(time + 8 * 3600e3)
  const hour = bj.getUTCHours() + bj.getUTCMinutes() / 60
  return peakHours.some(([start, end]) => hour >= start && hour < end)
}

/**
 * Resolve the effective price for one request: table lookup by `provider/model`
 * first, then bare `model`, applying peak prices when the moment is a peak
 * hour and the entry carries a peak tier. A peak tier whose three prices are
 * not all finite numbers counts as absent (the Loader's schema coercion fills
 * missing peak objects with `{}`), so the flat tier applies.
 * @param table - price table.
 * @param provider - provider route key.
 * @param model - model id.
 * @param time - request epoch milliseconds (peak-hour decision).
 * @param peakHours - peak hour intervals, see {@link isPeakBeijing}.
 * @returns the effective price, or undefined when the model has no entry.
 */
export function resolvePrice(
  table: PricingTable,
  provider: string,
  model: string,
  time: number,
  peakHours: readonly (readonly [number, number])[],
): ModelPrice | undefined {
  const entry = table[`${provider}/${model}`] ?? table[model]
  if (entry === undefined) return undefined
  const peak = entry.peak
  if (isPeakBeijing(time, peakHours) && peak !== undefined
    && Number.isFinite(peak.miss) && Number.isFinite(peak.hit) && Number.isFinite(peak.out)) {
    return peak
  }
  return { miss: entry.miss, hit: entry.hit, out: entry.out }
}

/**
 * Disjoint token buckets of one request. Field names mirror the provider
 * usage record (`TokenUsage`): `inputTokens` is uncached input only; cache
 * traffic is reported separately.
 */
export interface CostBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Cost split of one request, CNY. */
export interface CostBreakdown {
  total: number
  hit: number
  miss: number
  out: number
}

/**
 * Compute the CNY cost of one request from its token buckets and a resolved
 * price. Cache writes are billed at the uncached-input price (the official
 * `prompt_cache_miss_tokens` bucket); reasoning tokens are already inside
 * output tokens and are not added again.
 * @param usage - the request's disjoint token buckets.
 * @param price - resolved CNY-per-1M-token price.
 * @returns the cost breakdown, CNY.
 */
export function costOf(usage: CostBuckets, price: ModelPrice): CostBreakdown {
  const hit = usage.cacheReadTokens * price.hit / 1e6
  const miss = (usage.inputTokens + usage.cacheWriteTokens) * price.miss / 1e6
  const out = usage.outputTokens * price.out / 1e6
  return { total: hit + miss + out, hit, miss, out }
}
