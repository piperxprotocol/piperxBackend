import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

export type TokenPrice = {
  id: string
  symbol: string
  price: number
}

type RawTokenPrice = {
  id: string
  symbol: string
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
  if (!resp.ok) throw new Error(`Subgraph error: ${resp.status}`)
  const data = (await resp.json()) as any
  if (data.errors) throw new Error(JSON.stringify(data.errors))
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

async function fetchNowPrices(tokenIds: string[]): Promise<TokenPrice[]> {
  if (!tokenIds.length) return []
  const data = await querySubgraph<{ tokens: RawTokenPrice[] }>(
    PRICE_QUERY,
    { tokenAddresses: tokenIds },
    SUBGRAPH_URL_PRICES
  )
  return data.tokens.map(t => ({
    id: t.id,
    symbol: t.symbol,
    price: Number(t.latestPriceUSD ?? 0),
  }))
}

// ----------- KV 里的快照 -----------
async function getSnapshot(env: Env, key: string): Promise<{ timestamp: number; prices: TokenPrice[] } | null> {
  const str = await env.PIPERX_KV.get(key)
  return str ? JSON.parse(str) : null
}

// ----------- 回补逻辑 -----------
function fillMissingSnapshots(
  tokenIds: string[],
  nowPrices: TokenPrice[],
  snapshot: { timestamp: number; prices: TokenPrice[] } | null
): { timestamp: number; prices: TokenPrice[] } {
  if (snapshot) {
    return snapshot
  } else {
    return { timestamp: Date.now(), prices: nowPrices }
  }
}

router.get("/prices", async (c) => {
  try {
    const listStr = await c.env.PIPERX_KV.get("tokens:list")
    if (!listStr) return c.json({ error: "no tokens" }, 404)

    const tokenIds: string[] = JSON.parse(listStr)

    const nowPrices = await fetchNowPrices(tokenIds)

    const oneH = fillMissingSnapshots(tokenIds, nowPrices, await getSnapshot(c.env, "tokens:prices:1h"))
    const sixH = fillMissingSnapshots(tokenIds, nowPrices, await getSnapshot(c.env, "tokens:prices:6h"))
    const twelveH = fillMissingSnapshots(tokenIds, nowPrices, await getSnapshot(c.env, "tokens:prices:12h"))

    return c.json({
      now: { timestamp: Date.now(), prices: nowPrices },
      "1h": oneH,
      "6h": sixH,
      "12h": twelveH,
    })
  } catch (err: any) {
    console.error("Error in /prices:", err)
    return c.json({ error: err.message }, 500)
  }
})

export default router
