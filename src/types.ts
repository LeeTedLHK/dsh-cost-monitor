/**
 * Pure session-cost projection vocabulary shared by the host fold and the
 * client reader.
 *
 * @module dsh-cost-monitor/types
 */

/**
 * Accumulated estimated API cost for a complete session log, in CNY.
 *
 * `hit` is cache-hit input cost, `miss` is uncached input plus cache-write
 * cost (the official `prompt_cache_miss_tokens` billing bucket), and `out`
 * is output cost. `total` is their sum. `unpriced` counts requests whose
 * model had no configured price; those requests contribute zero to the four
 * monetary fields.
 */
export interface SessionCostProjection {
  /** Total estimated cost, CNY. */
  total: number
  /** Cache-hit input cost, CNY. */
  hit: number
  /** Uncached input + cache-write cost, CNY. */
  miss: number
  /** Output cost, CNY. */
  out: number
  /** Requests priced with no configured table entry (unknown model). */
  unpriced: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Accumulated estimated API cost of the complete durable log. */
    sessionCost: SessionCostProjection
  }
}
