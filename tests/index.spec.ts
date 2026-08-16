/**
 * Plugin-config regression tests: the harness Loader validates plugin config
 * through schemastery's standard-schema interface, which coerces an absent
 * config to `{ pricing: {}, peakHours: [] }` instead of `undefined`. These
 * tests prove the defaults survive that coercion end to end: the schema fills
 * the default table, `resolveCostConfig` still treats empty values as absent,
 * and a real flash request is priced rather than counted unpriced.
 */

import { describe, expect, it } from 'vitest'
import { Config, resolveCostConfig } from '../src/index.ts'
import { DEFAULT_PEAK_HOURS, DEFAULT_PRICING } from '../src/pricing.ts'
import { createCostProjection } from '../src/projection.ts'

/** Beijing 10:00 on a fixed date (peak for default hours). */
const PEAK = Date.UTC(2026, 7, 16, 2, 0, 0)

/** Mirror the Loader: validate the raw row config through the plugin schema. */
function loaderConfig(raw: unknown): unknown {
  // The schema's declared standard-schema validate may return a Promise, but
  // schemastery validates synchronously, so narrow to the sync result here.
  const result = Config['~standard'].validate(raw) as { value?: unknown; issues?: unknown[] }
  if (result.issues !== undefined) throw new Error(`schema issues: ${result.issues.length}`)
  return result.value
}

describe('dsh-cost-monitor plugin config', () => {
  it('fills the default price table when the row carries no config', () => {
    const config = loaderConfig(undefined)
    expect(config).toEqual({ pricing: DEFAULT_PRICING, peakHours: DEFAULT_PEAK_HOURS })
  })

  it('fills the default price table for an empty config object', () => {
    expect(loaderConfig({})).toEqual({ pricing: DEFAULT_PRICING, peakHours: DEFAULT_PEAK_HOURS })
  })

  it('keeps explicitly provided pricing entries', () => {
    const explicit = { pricing: { 'acme/x': { miss: 2, hit: 0.1, out: 4 } } }
    const config = loaderConfig(explicit) as { pricing: Record<string, unknown> }
    expect(config.pricing['acme/x']).toEqual({ miss: 2, hit: 0.1, out: 4, peak: {} })
  })

  it('resolveCostConfig treats Loader-coerced empty values as absent', () => {
    const resolved = resolveCostConfig({ pricing: {}, peakHours: [] })
    expect(resolved).toEqual({ pricing: DEFAULT_PRICING, peakHours: DEFAULT_PEAK_HOURS })
  })

  it('resolveCostConfig passes through a non-empty pricing table', () => {
    const pricing = { 'acme/x': { miss: 2, hit: 0.1, out: 4 } }
    const resolved = resolveCostConfig({ pricing, peakHours: [[10, 12]] })
    expect(resolved.pricing).toBe(pricing)
    expect(resolved.peakHours).toEqual([[10, 12]])
  })

  it('prices a flash request after the full Loader path (no unpriced samples)', () => {
    const config = resolveCostConfig(loaderConfig(undefined) as never)
    const unit = createCostProjection(config)
    let state = unit.init()
    state = unit.apply(state, {
      type: 'request/header',
      seq: 0,
      time: PEAK,
      data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: 'change' },
    } as never)
    state = unit.apply(state, {
      type: 'assistant/message',
      seq: 1,
      time: PEAK,
      data: {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [] },
        usage: { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    } as never)
    const view = unit.view(state)
    // Peak flash: miss 3.0/M, out 9.0/M.
    expect(view).toEqual({ total: 3.0 + 4.5, hit: 0, miss: 3.0, out: 4.5, unpriced: 0 })
  })
})
