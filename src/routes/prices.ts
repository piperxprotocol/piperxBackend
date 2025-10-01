import { Hono } from "hono"
import type { Env } from "../utils/env";

const router = new Hono<{ Bindings: Env }>();

export type TokenPrice = {
  id: string
  symbol: string
  price: number
}

type RawTokenPrice = {
  id: string;
  symbol: string;
  latestPriceUSD: string
}

async function querySubgraph<T>(
  query: string,
  variables: Record<string, any>,
  url: string
): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })

  if (!resp.ok) {
    throw new Error(`Subgraph error: ${resp.status}`)
  }

  const data = (await resp.json()) as any
  if (data.errors) {
    throw new Error(JSON.stringify(data.errors))
  }
  return data.data as T
}


const PRICE_QUERY = `
query GetCurrentTokenPrices($tokenAddresses: [String!]!) {
  tokens(where: { id_in: $tokenAddresses }) {
    id
    symbol
    latestPriceUSD
  }
}`

const SUBGRAPH_URL_PRICES =
  "https://api.goldsky.com/api/public/project_clzxbl27v2ce101zr2s7sfo05/subgraphs/story-dex-swaps-mainnet/1.0.23/gn"

export async function updatePrices(env: { PIPERX_KV: KVNamespace }) {
  const listKey = "tokens:list"
  const listStr = await env.PIPERX_KV.get(listKey)
  if (!listStr) return { added: 0, prices: [] }

  const ids: string[] = JSON.parse(listStr)
  if (!ids.length) return { added: 0, prices: [] }

  const data = await querySubgraph<{ tokens: RawTokenPrice[] }>(
    PRICE_QUERY,
    { tokenAddresses: ids },
    SUBGRAPH_URL_PRICES
  )

  const now = Date.now()

  const prices = data.tokens.map(t => ({
    id: t.id,
    symbol: t.symbol,
    price: Number(t.latestPriceUSD ?? 0)
  }))

  await env.PIPERX_KV.put("tokens:prices:now", JSON.stringify({ timestamp: now, prices }))

  await maybeUpdateSnapshot(env, "tokens:prices:1h", now, prices, 3600_000)
  await maybeUpdateSnapshot(env, "tokens:prices:6h", now, prices, 6 * 3600_000)
  await maybeUpdateSnapshot(env, "tokens:prices:12h", now, prices, 12 * 3600_000)

  return { updated: prices.length }
}

async function maybeUpdateSnapshot(
  env: { PIPERX_KV: KVNamespace },
  key: string,
  now: number,
  prices: TokenPrice[],
  interval: number
) {
  const existing = await env.PIPERX_KV.get(key, "json") as { timestamp: number } | null
  if (!existing || now - existing.timestamp >= interval) {
    await env.PIPERX_KV.put(key, JSON.stringify({ timestamp: now, prices }), {
      expirationTtl: 48 * 3600,
    })
  }
}

router.get("/prices", async (c) => {
  try {
    const nowStr = await c.env.PIPERX_KV.get("tokens:prices:now")
    if (!nowStr) return c.json({ error: "no current prices" }, 404)

    const oneH = await c.env.PIPERX_KV.get("tokens:prices:1h")
    const sixH = await c.env.PIPERX_KV.get("tokens:prices:6h")
    const twelveH = await c.env.PIPERX_KV.get("tokens:prices:12h")

    return c.json({
      now: JSON.parse(nowStr),
      "1h": oneH ? JSON.parse(oneH) : null,
      "6h": sixH ? JSON.parse(sixH) : null,
      "12h": twelveH ? JSON.parse(twelveH) : null,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

export default router
