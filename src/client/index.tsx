/**
 * dsh-cost-monitor client half: register a composer-dock entry (the stats
 * strip under the composer card) that reads the host-computed `sessionCost`
 * projection through the framework's `useProjection` seat and renders the
 * estimated session cost with a hit/miss/output breakdown, styled to match
 * the shipped StatsLine. Pure presentation: no local pricing logic, no
 * subscriptions beyond the projection hook.
 *
 * @module dsh-cost-monitor/client
 */

import { memo } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer.dock seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls this package's SessionProjectionMap merge (sessionCost).
import type {} from '../types.ts'

/** Locale namespace for this plugin's copy. */
const NS = 'cost'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cost monitor composer-dock copy. */
    cost: 'label' | 'hit' | 'miss' | 'out' | 'unpriced'
  }
}

/** Chinese dictionary: total label plus the three bucket details. */
const zh = {
  label: '费用 ≈¥{amount}',
  hit: '命中 ¥{amount}',
  miss: '未命中 ¥{amount}',
  out: '输出 ¥{amount}',
  unpriced: '未知价:{count}',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
const en = {
  label: 'Cost ≈¥{amount}',
  hit: 'hit ¥{amount}',
  miss: 'miss ¥{amount}',
  out: 'output ¥{amount}',
  unpriced: 'unpriced:{count}',
} as const

/** Services required before mounting: the slot registry and the locale service. */
export const inject = ['slots', 'locale']

/** Props: the projection read seat and the locale seat (framework-provided). */
export interface CostLineProps {
  useProjection: UseProjection
  t: TranslateNS<typeof NS>
}

/**
 * Composer-dock cost line: renders only once the session has any billed or
 * unpriced activity; absent projection (unit unmounted) renders nothing.
 */
export const CostLine = memo(function CostLine({ useProjection, t }: CostLineProps) {
  const cost = useProjection('sessionCost')
  if (cost === undefined || (cost.total <= 0 && cost.unpriced === 0)) return null
  const fmt = (n: number) => n.toFixed(2)
  const groups = [
    t('label', { amount: fmt(cost.total) }),
    t('hit', { amount: fmt(cost.hit) }),
    t('miss', { amount: fmt(cost.miss) }),
    t('out', { amount: fmt(cost.out) }),
  ]
  if (cost.unpriced > 0) groups.push(t('unpriced', { count: String(cost.unpriced) }))
  return (
    <div
      style={{
        textAlign: 'center',
        boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-tertiary)',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        fontSize: 12,
        lineHeight: '20px',
        padding: '2px calc(var(--dsh-composer-side-clearance) + 16px) 0',
      }}
    >
      {groups.map((group, i) => (
        <span key={group}>
          {i > 0 && <span style={{ color: 'var(--dsw-alias-separator-primary)', margin: '0 10px' }} aria-hidden>|</span>}
          {group}
        </span>
      ))}
    </div>
  )
})

/**
 * Client plugin body: register the dictionaries and the composer-dock entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-cost-monitor: dictionaries')
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'cost',
    order: 10,
    locale: NS,
  }, CostLine))
}
