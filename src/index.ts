/**
 * dsh-cost-monitor host half: register the `sessionCost` session projection
 * that accumulates the estimated API cost of the current session, priced per
 * actual request model with DeepSeek peak/off-peak hour awareness.
 *
 * The client half (src/client) reads the projection through the framework's
 * `useProjection` seat and renders the estimate in the composer dock; this
 * file owns no UI. Registration is an optional child: a composition without
 * the generic projection registry keeps the plugin mounted but publishes no
 * projection (the client renders nothing).
 *
 * @module dsh-cost-monitor
 */

import { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-session-projection'
import { DEFAULT_PEAK_HOURS, DEFAULT_PRICING } from './pricing.ts'
import { createCostProjection, type CostConfig } from './projection.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-cost-monitor'

/** No hard service requirements: the projection registry is an optional child. */
export const inject: readonly string[] = []

/** Schemastery schema for the plugin configuration (Loader validates input). */
export const Config = z.object({
  /** CNY-per-1M-token price table, keyed by `provider/model` or bare `model`. */
  pricing: z.dict(z.object({
    miss: z.number().min(0),
    hit: z.number().min(0),
    out: z.number().min(0),
    peak: z.object({
      miss: z.number().min(0),
      hit: z.number().min(0),
      out: z.number().min(0),
    }),
  })).default(DEFAULT_PRICING as never),
  /** Beijing-time peak hours as half-open [start, end) pairs. */
  peakHours: z.array(z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)])).default(DEFAULT_PEAK_HOURS as never),
}) as unknown as z<Partial<CostConfig>>

/**
 * Apply direct-call defaults after Loader schema validation has normally run.
 * The Loader's standard-schema validation coerces an absent config to
 * `{ pricing: {}, peakHours: [] }` rather than `undefined`, so empty values
 * count as absent here too.
 * @param config - deployment-provided (possibly partial) plugin config.
 * @returns complete config consumed by the fold.
 */
export function resolveCostConfig(config: Partial<CostConfig> | undefined): CostConfig {
  const pricing = config?.pricing
  const peakHours = config?.peakHours
  return {
    pricing: pricing !== undefined && Object.keys(pricing).length > 0 ? pricing : DEFAULT_PRICING,
    peakHours: peakHours !== undefined && peakHours.length > 0 ? peakHours : DEFAULT_PEAK_HOURS,
  }
}

/**
 * Plugin body: register the `sessionCost` projection against the optional
 * generic projection registry.
 * @param ctx - plugin context.
 * @param config - validated plugin configuration (Loader fills defaults).
 */
export function apply(ctx: Context, config: Partial<CostConfig> | undefined): void {
  const resolved = resolveCostConfig(config)
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(createCostProjection(resolved))
  })
}

export type { CostConfig } from './projection.ts'
export type { PricingTable, ModelPrice } from './pricing.ts'
export type { SessionCostProjection } from './types.ts'
