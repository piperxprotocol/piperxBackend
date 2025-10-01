import { Hono } from "hono"
import type { Env } from "../utils/env";

const router = new Hono<{ Bindings: Env }>();

export type TokenPrice = {
  id: string
  symbol: string
  latestPriceUSD: number
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

  const data = await querySubgraph<{ tokens: TokenPrice[] }>(
    PRICE_QUERY,
    { tokenAddresses: ids },
    SUBGRAPH_URL_PRICES
  )

  for (const t of data.tokens) {
    await env.PIPERX_KV.put(`price:${t.id}`, String(t.latestPriceUSD ?? 0))
  }
  
  await env.PIPERX_KV.put(
    "tokens:prices",
    JSON.stringify({
      timestamp: Date.now(),
      prices: data.tokens,
    })
  )

  return { updated: data.tokens.length }
}

router.get("/prices", async (c) => {
  try {
    const listKey = "tokens:list"
    const listStr = await c.env.PIPERX_KV.get(listKey)
    if (!listStr) {
      return c.json({ error: "no token list in cache" }, 404)
    }

    const ids: string[] = JSON.parse(listStr)
    if (ids.length === 0) {
      return c.json({ error: "empty token list" }, 404)
    }

    const data = await querySubgraph<{ tokens: TokenPrice[] }>(
      PRICE_QUERY,
      { tokenAddresses: ids },
      SUBGRAPH_URL_PRICES
    )

    return c.json({
      timestamp: Date.now(),
      count: data.tokens.length,
      prices: data.tokens.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        latestPriceUSD: Number(t.latestPriceUSD ?? 0),
      })),
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})



export default router