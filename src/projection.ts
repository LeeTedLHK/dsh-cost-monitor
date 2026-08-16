/**
 * Pure fold for the durable `sessionCost` projection: track the effective
 * model from `request/header` events and accumulate the estimated CNY cost of
 * every provider-reported usage sample priced at that request's model.
 *
 * Mirrors the token-meter usage fold's sample semantics: an `assistant/chunk`
 * usage sample may precede the `assistant/message` final sample of the same
 * (turn, step); the later sample REPLACES the earlier one instead of
 * double-counting it. Requests whose model has no price table entry contribute
 * zero cost and increment `unpriced`.
 *
 * @module dsh-cost-monitor/projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionCostProjection } from './types.ts'
import {
  costOf,
  resolvePrice,
  type CostBreakdown,
  type CostBuckets,
  type PricingTable,
} from './pricing.ts'

/** Fully resolved plugin config consumed by the fold. */
export interface CostConfig {
  pricing: PricingTable
  peakHours: readonly (readonly [number, number])[]
}

const ZERO_COST: CostBreakdown = { total: 0, hit: 0, miss: 0, out: 0 }

/** One priced usage sample; the single last slot mirrors token-meter's fold. */
interface CostSample {
  turn: number
  step: number
  cost: CostBreakdown
  unpriced: boolean
}

/** Fold state: running totals plus the effective model and last sample. */
interface CostState {
  total: CostBreakdown
  unpriced: number
  model: { provider: string; model: string } | undefined
  last: CostSample | null
}

const projectionSchema = z.object({
  total: z.number().nonnegative(),
  hit: z.number().nonnegative(),
  miss: z.number().nonnegative(),
  out: z.number().nonnegative(),
  unpriced: z.number().int().nonnegative(),
}).strict()

/** Provider-reported usage fields the fold reads (subset of `TokenUsage`). */
interface UsageFields {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Disjoint token buckets from a usage record (optional cache fields to zero). */
function bucketsFrom(usage: UsageFields): CostBuckets {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/** The usage a chunk or finalized message reports for its step, if any. */
function usageOf(event: SessionEvent): { turn: number; step: number; usage: UsageFields } | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/**
 * Build the `sessionCost` projection unit for one resolved config. The fold
 * re-prices from the config's price table, so a deployment that changes
 * prices re-boots with the new table applied to the same durable log.
 * @param config - resolved pricing and peak-hour config.
 * @returns the projection unit registered against `ctx.sessionProjections`.
 */
export function createCostProjection(config: CostConfig): ProjectionDefinition<'sessionCost', CostState> {
  return {
    key: 'sessionCost',
    schema: projectionSchema,
    init: () => ({ total: ZERO_COST, unpriced: 0, model: undefined, last: null }),
    apply: (state, event) => {
      // The effective model is the newest logged request header's route.
      if (event.type === 'request/header') {
        const callConfig = event.data.header.config
        const model = { provider: callConfig.provider, model: callConfig.model }
        if (state.model !== undefined
          && state.model.provider === model.provider && state.model.model === model.model) {
          return state
        }
        return { ...state, model }
      }

      const sample = usageOf(event)
      if (sample === undefined || state.model === undefined) return state
      const { turn, step, usage } = sample
      const price = resolvePrice(
        config.pricing,
        state.model.provider,
        state.model.model,
        event.time,
        config.peakHours,
      )
      const unpriced = price === undefined
      const cost = price === undefined ? ZERO_COST : costOf(bucketsFrom(usage), price)

      const previous = state.last !== null && state.last.turn === turn && state.last.step === step
        ? state.last
        : null
      if (previous !== null
        && previous.unpriced === unpriced
        && previous.cost.total === cost.total
        && previous.cost.hit === cost.hit
        && previous.cost.miss === cost.miss
        && previous.cost.out === cost.out) {
        return state
      }

      return {
        total: {
          total: state.total.total - (previous?.cost.total ?? 0) + cost.total,
          hit: state.total.hit - (previous?.cost.hit ?? 0) + cost.hit,
          miss: state.total.miss - (previous?.cost.miss ?? 0) + cost.miss,
          out: state.total.out - (previous?.cost.out ?? 0) + cost.out,
        },
        unpriced: state.unpriced - (previous?.unpriced === true ? 1 : 0) + (unpriced ? 1 : 0),
        model: state.model,
        last: { turn, step, cost, unpriced },
      }
    },
    view: ({ total, unpriced }): SessionCostProjection => ({ ...total, unpriced }),
    stateVersion: 1,
  }
}
