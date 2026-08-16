/**
 * Projection fold tests: model tracking, per-model pricing, same-step sample
 * replacement, and unpriced accounting. The fold is pure, so tests drive
 * `createCostProjection(config).apply` directly with hand-built events —
 * including explicit timestamps, which `Session.append` (Date.now) cannot
 * inject.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DEFAULT_PEAK_HOURS, DEFAULT_PRICING, type CostBuckets } from '../src/pricing.ts'
import { createCostProjection, type CostConfig } from '../src/projection.ts'
import type { SessionCostProjection } from '../src/types.ts'

/** DeepSeek-off-peak Beijing moment: 2026-08-16 08:00 Beijing = 00:00 UTC. */
const OFF_PEAK = Date.UTC(2026, 7, 16, 0, 0, 0)
/** DeepSeek peak Beijing moment: 2026-08-16 10:00 Beijing = 02:00 UTC. */
const PEAK = Date.UTC(2026, 7, 16, 2, 0, 0)

const config: CostConfig = {
  pricing: DEFAULT_PRICING,
  peakHours: DEFAULT_PEAK_HOURS,
}

function header(provider: string, model: string, time: number, seq: number): SessionEvent {
  return {
    type: 'request/header',
    seq,
    time,
    data: { header: { config: { provider, model } }, reason: 'change' },
  } as SessionEvent
}

function usage(
  turn: number,
  step: number,
  time: number,
  seq: number,
  buckets: Partial<CostBuckets> = {},
): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn,
      step,
      message: { role: 'assistant', content: [] },
      usage: {
        inputTokens: buckets.inputTokens ?? 0,
        outputTokens: buckets.outputTokens ?? 0,
        cacheReadTokens: buckets.cacheReadTokens ?? 0,
        cacheWriteTokens: buckets.cacheWriteTokens ?? 0,
      },
    },
  } as SessionEvent
}

/** Fold a list of events over the projection unit's init state. */
function fold(events: readonly SessionEvent[]): SessionCostProjection {
  const unit = createCostProjection(config)
  let state = unit.init()
  for (const event of events) state = unit.apply(state, event)
  return unit.view(state)
}

const ZERO: SessionCostProjection = { total: 0, hit: 0, miss: 0, out: 0, unpriced: 0 }

describe('sessionCost projection fold', () => {
  it('serves zero for an empty log', () => {
    expect(fold([])).toEqual(ZERO)
  })

  it('prices one flash request at off-peak rates from its header model', () => {
    const events = [
      header('deepseek-official', 'deepseek-v4-flash', OFF_PEAK, 0),
      usage(1, 1, OFF_PEAK, 1, { inputTokens: 1_000_000, outputTokens: 500_000 }),
    ]
    expect(fold(events)).toEqual({
      total: 1.5 + 2.25,
      hit: 0,
      miss: 1.5,
      out: 2.25,
      unpriced: 0,
    })
  })

  it('applies peak rates when the request lands in a peak hour', () => {
    const events = [
      header('deepseek-official', 'deepseek-v4-flash', PEAK, 0),
      usage(1, 1, PEAK, 1, { inputTokens: 1_000_000, outputTokens: 500_000 }),
    ]
    expect(fold(events)).toEqual({
      total: 3.0 + 4.5,
      hit: 0,
      miss: 3.0,
      out: 4.5,
      unpriced: 0,
    })
  })

  it('prices later requests at the newer model after a model switch', () => {
    const events = [
      header('deepseek-official', 'deepseek-v4-flash', OFF_PEAK, 0),
      usage(1, 1, OFF_PEAK, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
      header('deepseek-official', 'deepseek-v4-pro', OFF_PEAK, 2),
      usage(1, 2, OFF_PEAK, 3, { inputTokens: 1_000_000, outputTokens: 0 }),
    ]
    expect(fold(events)).toEqual({
      total: 1.5 + 4.5,
      hit: 0,
      miss: 6.0,
      out: 0,
      unpriced: 0,
    })
  })

  it('replaces an earlier usage sample of the same (turn, step) instead of double-counting', () => {
    const chunkUsage = usage(1, 1, OFF_PEAK, 1, { inputTokens: 900_000 })
    const finalUsage = usage(1, 1, OFF_PEAK, 2, { inputTokens: 1_000_000 })
    const events = [
      header('deepseek-official', 'deepseek-v4-flash', OFF_PEAK, 0),
      chunkUsage,
      finalUsage,
    ]
    // 900K would bill 1.35; the final 1M bills 1.5 and replaces it.
    expect(fold(events)).toEqual({ total: 1.5, hit: 0, miss: 1.5, out: 0, unpriced: 0 })
  })

  it('does not double-count an identical repeated sample of the same step', () => {
    const events = [
      header('deepseek-official', 'deepseek-v4-flash', OFF_PEAK, 0),
      usage(1, 1, OFF_PEAK, 1, { inputTokens: 1_000_000 }),
      usage(1, 1, OFF_PEAK, 2, { inputTokens: 1_000_000 }),
    ]
    expect(fold(events)).toEqual({ total: 1.5, hit: 0, miss: 1.5, out: 0, unpriced: 0 })
  })

  it('counts requests with no configured price as unpriced with zero cost', () => {
    const events = [
      header('deepseek-official', 'unknown-model', OFF_PEAK, 0),
      usage(1, 1, OFF_PEAK, 1, { inputTokens: 1_000_000 }),
    ]
    expect(fold(events)).toEqual({ total: 0, hit: 0, miss: 0, out: 0, unpriced: 1 })
  })

  it('ignores usage before the first request header', () => {
    expect(fold([usage(1, 1, OFF_PEAK, 0, { inputTokens: 1_000_000 })])).toEqual(ZERO)
  })

  it('ignores non-usage, non-header events', () => {
    const events = [
      header('deepseek-official', 'deepseek-v4-flash', OFF_PEAK, 0),
      { type: 'step/start', seq: 1, time: OFF_PEAK, data: { turn: 1, step: 1 } } as SessionEvent,
      { type: 'turn/end', seq: 2, time: OFF_PEAK, data: { turn: 1, reason: 'success' } } as SessionEvent,
    ]
    expect(fold(events)).toEqual(ZERO)
  })

  it('accumulates distinct steps with their own bucket costs', () => {
    const events = [
      header('deepseek-official', 'deepseek-v4-flash', OFF_PEAK, 0),
      usage(1, 1, OFF_PEAK, 1, {
        inputTokens: 1_000_000,
        cacheReadTokens: 500_000,
        cacheWriteTokens: 250_000,
        outputTokens: 100_000,
      }),
      usage(1, 2, OFF_PEAK, 2, { inputTokens: 100_000, outputTokens: 200_000 }),
    ]
    const first = { hit: 0.025, miss: 1.875, out: 0.45 }
    const second = { hit: 0, miss: 0.15, out: 0.9 }
    const expected = {
      total: first.hit + first.miss + first.out + second.miss + second.out,
      hit: first.hit,
      miss: first.miss + second.miss,
      out: first.out + second.out,
      unpriced: 0,
    }
    const actual = fold(events)
    expect(actual.hit).toBeCloseTo(expected.hit, 10)
    expect(actual.miss).toBeCloseTo(expected.miss, 10)
    expect(actual.out).toBeCloseTo(expected.out, 10)
    expect(actual.total).toBeCloseTo(expected.total, 10)
    expect(actual.unpriced).toBe(0)
  })
})
