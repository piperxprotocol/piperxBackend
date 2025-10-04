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

async function fetchNowPrices(tokenIds: string[]): Promise<Record<string, number>> {
  if (!tokenIds.length) return {}
  const data = await querySubgraph<{ tokens: RawTokenPrice[] }>(
    PRICE_QUERY,
    { tokenAddresses: tokenIds },
    SUBGRAPH_URL_PRICES
  )
  const map: Record<string, number> = {}
  for (const t of data.tokens) {
    map[t.id] = Number(t.latestPriceUSD ?? 0)
  }
  return map
}

function buildHistory(
  nowHour: number,
  rows: any[],
  tokenIds: string[],
  points = 48,
  nowMap: Record<string, number> = {}
) {
  const raw: Record<string, Map<number, number>> = {}
  for (const r of rows) {
    if (!raw[r.token_id]) raw[r.token_id] = new Map()
    raw[r.token_id].set(r.hour_bucket, r.price_usd)
  }

  const result: Record<string, Record<string, number>> = {}

  for (const tokenId of tokenIds) {
    const map = raw[tokenId] || new Map()
    const historyMap: Record<string, number> = {}
    const buffer: (number | null)[] = new Array(points).fill(null)

    for (let i = 1; i <= points; i++) {
      const bucket = nowHour - i
      if (map.has(bucket)) {
        buffer[i - 1] = map.get(bucket)!
      }
    }
    console.log("Step 1 :", buffer)

    let carry: number | null = null
    for (let i = points - 1; i >= 0; i--) {
      if (buffer[i] !== null) {
        carry = buffer[i]!
      } else if (carry !== null) {
        buffer[i] = carry
      }
    }
    console.log("Step 2 :", buffer)

    let lastKnown = buffer.find((v) => v !== null) 
    if (lastKnown !== undefined) {
      for (let i = 0; i < points; i++) {
        if (buffer[i] === null) {
          buffer[i] = lastKnown
        } else {
          lastKnown = buffer[i]! 
        }
      }
    } else {
      const fallback = nowMap[tokenId] ?? 0
      for (let i = 0; i < points; i++) {
        buffer[i] = fallback
      }
    }
    console.log("Step 3 :", buffer)
    
    for (let i = 1; i <= points; i++) {
      historyMap[`${i}h`] = buffer[i - 1]!
    }
    console.log("Step 4:", historyMap)

    result[tokenId] = historyMap
  }

  return result
}

router.get("/prices", async (c) => {
  try {
    const listStr = await c.env.PIPERX_PRO.get("tokens:records")
    console.log("tokens:records raw:", listStr)
    let idsFromList: string[] = []
    if (listStr) {
      try {
        const parsed = JSON.parse(listStr)
        idsFromList = parsed.map((t: any) => t.id)
      } catch (e) {
        console.error("Failed to parse tokens:records:", e)
      }
    }

    const activeStr = await c.env.PIPERX_PRO.get("tokens:active")
    console.log("tokens:active raw:", activeStr)
    let idsFromActive: string[] = []
    if (activeStr) {
      try {
        const parsed = JSON.parse(activeStr)
        idsFromActive = (parsed.tokens || [])
          .map((t: any) => t.id || t.token_id)
          .filter((id: any) => !!id)
      } catch (e) {
        console.error("Failed to parse tokens:active:", e)
      }
    }

    const tokenIds: string[] = Array.from(new Set([...idsFromList, ...idsFromActive]))
    if (!tokenIds.length) {
      return c.json({ error: "no tokens" }, 404)
    }

    console.log("tokenIds >>>", tokenIds)

    const nowMap = await fetchNowPrices(tokenIds)

    const nowHour = Math.floor(Date.now() / 3600_000)
    const rows = await c.env.DB.prepare(
      `SELECT token_id, price_usd, hour_bucket
       FROM prices
       WHERE hour_bucket <= ?1 AND hour_bucket > ?1 - 48
       ORDER BY hour_bucket ASC`
    ).bind(nowHour).all<any>()

    const history = buildHistory(nowHour, rows.results || [], tokenIds, 48, nowMap)


    const result: Record<string, any> = {}
    for (const id of tokenIds) {
      result[id] = {
        now: nowMap[id] ?? 0,
        history: history[id] || {},
      }
    }

    return c.json({ prices: result })
  } catch (err: any) {
    console.error("Error in /prices:", err)
    return c.json({ error: err.message }, 500)
  }
})

export default router
