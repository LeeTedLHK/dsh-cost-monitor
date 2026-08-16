/**
 * Pure pricing tests: peak-hour decisions, price resolution, and cost math.
 */

import { describe, expect, it } from 'vitest'
import {
  costOf,
  DEFAULT_PEAK_HOURS,
  DEFAULT_PRICING,
  isPeakBeijing,
  resolvePrice,
  type CostBuckets,
} from '../src/pricing.ts'

/** Beijing 10:00 on a fixed date (peak for default hours). */
const PEAK_TIME = Date.UTC(2026, 7, 16, 2, 0, 0) // 10:00 Beijing = 02:00 UTC
/** Beijing 08:00 on the same date (off-peak). */
const OFF_PEAK_TIME = Date.UTC(2026, 7, 16, 0, 0, 0) // 08:00 Beijing = 00:00 UTC

describe('isPeakBeijing', () => {
  it('returns true inside default peak hours', () => {
    expect(isPeakBeijing(PEAK_TIME, DEFAULT_PEAK_HOURS)).toBe(true)
  })

  it('returns false outside default peak hours', () => {
    expect(isPeakBeijing(OFF_PEAK_TIME, DEFAULT_PEAK_HOURS)).toBe(false)
  })

  it('treats intervals as half-open', () => {
    // 09:00 Beijing exactly: inside [9, 12).
    expect(isPeakBeijing(Date.UTC(2026, 7, 16, 1, 0, 0), DEFAULT_PEAK_HOURS)).toBe(true)
    // 12:00 Beijing exactly: outside [9, 12).
    expect(isPeakBeijing(Date.UTC(2026, 7, 16, 4, 0, 0), DEFAULT_PEAK_HOURS)).toBe(false)
  })

  it('honors a custom peak-hours table', () => {
    const custom = [[22, 24]] as const
    expect(isPeakBeijing(Date.UTC(2026, 7, 16, 14, 30, 0), custom)).toBe(true)
    expect(isPeakBeijing(Date.UTC(2026, 7, 16, 2, 0, 0), custom)).toBe(false)
  })
})

describe('resolvePrice', () => {
  it('resolves by bare model id and applies peak tier during peak hours', () => {
    const price = resolvePrice(DEFAULT_PRICING, 'deepseek-official', 'deepseek-v4-flash', PEAK_TIME, DEFAULT_PEAK_HOURS)
    expect(price).toEqual({ miss: 3.0, hit: 0.10, out: 9.0 })
  })

  it('uses the flat tier during off-peak hours', () => {
    const price = resolvePrice(DEFAULT_PRICING, 'deepseek-official', 'deepseek-v4-flash', OFF_PEAK_TIME, DEFAULT_PEAK_HOURS)
    expect(price).toEqual({ miss: 1.5, hit: 0.05, out: 4.5 })
  })

  it('prefers a provider/model key over the bare model id', () => {
    const table = {
      ...DEFAULT_PRICING,
      'acme/deepseek-v4-flash': { miss: 9, hit: 1, out: 18 },
    }
    const price = resolvePrice(table, 'acme', 'deepseek-v4-flash', OFF_PEAK_TIME, DEFAULT_PEAK_HOURS)
    expect(price?.miss).toBe(9)
  })

  it('returns undefined for an unknown model', () => {
    expect(resolvePrice(DEFAULT_PRICING, 'deepseek-official', 'unknown-model', OFF_PEAK_TIME, DEFAULT_PEAK_HOURS))
      .toBeUndefined()
  })

  it('returns the flat tier for a peak-tier-less entry during peak hours', () => {
    const table = { 'flat-only': { miss: 2, hit: 0.1, out: 4 } }
    expect(resolvePrice(table, 'p', 'flat-only', PEAK_TIME, DEFAULT_PEAK_HOURS)).toEqual({ miss: 2, hit: 0.1, out: 4 })
  })

  it('treats a schema-coerced empty peak object as absent during peak hours', () => {
    // The Loader's schemastery validation fills a missing `peak` with `{}`.
    const table = { 'coerced': { miss: 2, hit: 0.1, out: 4, peak: {} } } as unknown as typeof DEFAULT_PRICING
    expect(resolvePrice(table, 'p', 'coerced', PEAK_TIME, DEFAULT_PEAK_HOURS)).toEqual({ miss: 2, hit: 0.1, out: 4 })
  })
})

describe('costOf', () => {
  const price = { miss: 1.5, hit: 0.05, out: 4.5 }

  it('bills the three buckets with cache writes at the miss price', () => {
    const usage: CostBuckets = {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 500_000,
      outputTokens: 200_000,
    }
    const cost = costOf(usage, price)
    expect(cost.hit).toBe(0.05)
    expect(cost.miss).toBe((1_000_000 + 500_000) / 1e6 * 1.5)
    expect(cost.out).toBe(200_000 / 1e6 * 4.5)
    expect(cost.total).toBeCloseTo(cost.hit + cost.miss + cost.out, 10)
  })

  it('returns zero for an all-zero usage', () => {
    const cost = costOf({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, price)
    expect(cost).toEqual({ total: 0, hit: 0, miss: 0, out: 0 })
  })
})
