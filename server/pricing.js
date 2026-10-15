// Estimated API cost from transcript usage. Anthropic first-party API list
// prices, USD per million tokens — NOT what a Pro/Max subscription, Bedrock
// or Vertex bills. There is no pricing API, so this table is maintained by
// hand; users can override or extend it with <data dir>/pricing.json (same
// shape as PRICES, merged per model). Unknown models are never guessed.
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const PRICES_AS_OF = '2026-10-06'

// in/out/cacheRead: $/MTok. Cache writes derive from `in` (1.25x for the
// 5-minute TTL, 2x for 1-hour). fast: multiplier for fast-mode requests
// (only where published). long: rates for requests whose prompt exceeds
// 100K tokens, where the model prices those differently.
export const PRICES = {
  'claude-fable-5-1':  { in: 10, out: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-fable-5':    { in: 10, out: 50, cacheRead: 1 },
  'claude-opus-5-5':   { in: 4, out: 20, cacheRead: 0.20, fast: 2 },
  'claude-opus-5':     { in: 5, out: 25, cacheRead: 0.50, fast: 2 },
  'claude-opus-4-8':   { in: 5, out: 25, cacheRead: 0.50 },
  'claude-opus-4-7':   { in: 5, out: 25, cacheRead: 0.50 },
  'claude-opus-4-6':   { in: 5, out: 25, cacheRead: 0.50 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.20 },
  'claude-sonnet-5':   { in: 2, out: 10, cacheRead: 0.20 },
  'claude-sonnet-4-6': { in: 3, out: 15, cacheRead: 0.30 },
  'claude-haiku-5-5':  { in: 0.10, out: 0.50, cacheRead: 0.01, long: { in: 0.50, out: 2.50, cacheRead: 0.05 } },
  'claude-haiku-4-5':  { in: 1, out: 5, cacheRead: 0.10 },
}

let overrides = null, overridesAt = 0
async function priceTable(dataDir) {
  if (!dataDir) return PRICES
  if (Date.now() - overridesAt > 60_000) {   // re-read at most once a minute
    overridesAt = Date.now()
    try {
      const v = JSON.parse(await fs.readFile(path.join(dataDir, 'pricing.json'), 'utf8'))
      overrides = v && typeof v === 'object' && !Array.isArray(v) ? v : null
    } catch { overrides = null }
  }
  if (!overrides) return PRICES
  const merged = { ...PRICES }
  for (const [m, p] of Object.entries(overrides)) merged[m] = { ...(PRICES[m] ?? {}), ...p }
  return merged
}

// Strip a date suffix ("claude-haiku-4-5-20251001") so pinned ids price too.
const baseModel = m => m.replace(/-\d{8}$/, '')

// usage: readTranscriptUsage buckets (any number of agents, concatenated).
// -> { usd, unpriced: [model…] } — usd covers priced buckets only; callers
// should show the estimate as partial when unpriced is non-empty.
export async function estimateCost(usage, { dataDir = null } = {}) {
  const table = await priceTable(dataDir)
  let usd = 0
  const unpriced = new Set()
  for (const b of usage ?? []) {
    const p = table[b.model] ?? table[baseModel(b.model)]
    if (!p || (b.tier === 'fast' && !p.fast)) { unpriced.add(b.model + (b.tier === 'fast' ? ' (fast)' : '')); continue }
    const r = b.tier === 'long' && p.long ? { ...p, ...p.long } : p
    const mult = b.tier === 'fast' ? p.fast : 1
    usd += mult * (b.input * r.in + b.cacheWrite5m * r.in * 1.25 + b.cacheWrite1h * r.in * 2 + b.cacheRead * r.cacheRead + b.output * r.out) / 1e6
  }
  return { usd, unpriced: [...unpriced] }
}
