import { Hono } from "hono"
import type { Env } from "../utils/env";

const router = new Hono<{ Bindings: Env }>();

export type TokenInfo = {
  id: string
  name: string
  symbol: string
  creator?: string
  createdAt?: number
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

const TOKENS_QUERY = `
query Tokens($since: BigInt!) {
  tokens(
    orderBy: createdAt
    orderDirection: desc
    where: { createdAt_gt: $since }
  ) {
    id
    creator
    name
    symbol
    createdAt
  }
}`

const SUBGRAPH_URL_LAUNCHPAD =
  "https://api.goldsky.com/api/public/project_cmbrbzbw63ju201wzhfi0gtoa/subgraphs/story-launchpad/story-dex-v3/gn"

const SUBGRAPH_URL_SWAPS =
  "https://api.goldsky.com/api/public/project_clzxbl27v2ce101zr2s7sfo05/subgraphs/story-dex-swaps-mainnet/1.0.23/gn"


const TOKEN_PAIRS_QUERY = `
query TokenPairs($tokenId: String!) {
  tokenPairs(
    where: {
      OR: [
        {
          token0_in: ["0x1514000000000000000000000000000000000000"] 
          token1: $tokenId                                    
          fee_in: [500, 3000, 10000]
        }
        {
          token1_in: ["0x1514000000000000000000000000000000000000"] 
          token0: $tokenId                                    
          fee_in: [500, 3000, 10000]
        }
      ]
    }
  ) {
    id
    pool
    fee
    token0 { id }
    token1 { id }
  }
}`

const PAIR_VOLUME_QUERY = `
query GetPairsVolume($pairIds: [String!]!) {
  tokenPairVolumeAggregates(
    interval: day
    where: { 
      pair_: { id_in: $pairIds },
      timestamp_gt: $since
    }
    orderBy: timestamp
    orderDirection: desc
    first: 2
  ) {
    timestamp
    volumeUSD
    pair { id }
  }
}`


async function getTokenPairs(tokenId: string) {
  const res = await querySubgraph<{ tokenPairs: any[] }>(
    TOKEN_PAIRS_QUERY,
    { tokenId },
    SUBGRAPH_URL_SWAPS
  )
  return res.tokenPairs.map(p => p.id)
}

async function checkPairVolume(pairIds: string[]): Promise<boolean> {
  if (!pairIds.length) return false

  const res = await querySubgraph<{ tokenPairVolumeAggregates: any[] }>(
    PAIR_VOLUME_QUERY,
    { pairIds },
    SUBGRAPH_URL_SWAPS
  )

  let totalVol = 0
  for (const v of res.tokenPairVolumeAggregates) {
    totalVol += Number(v.volumeUSD)
  }

  return totalVol > 500
}

export async function updateCache(env: { PIPERX_KV: KVNamespace }) {
  const listKey = "tokens:list"
  const lastCreatedKey = "tokens:lastCreatedAt"

  const lastCreatedAtStr = await env.PIPERX_KV.get(lastCreatedKey)
  const lastCreatedAt = lastCreatedAtStr ? Number(lastCreatedAtStr) : 0

  const data = await querySubgraph<{ tokens: TokenInfo[] }>(
    TOKENS_QUERY,
    { since: lastCreatedAt },
    SUBGRAPH_URL_LAUNCHPAD
  )

  const tokens = data.tokens
  if (!tokens.length) return { added: 0, tokens: [] }

  let idList: string[] = []
  const added: TokenInfo[] = []
  const listStr = await env.PIPERX_KV.get(listKey)
  if (listStr) {
    idList = JSON.parse(listStr)
  }

  let maxCreatedAt = lastCreatedAt

  for (const t of tokens) {
    const pairIds = await getTokenPairs(t.id)
    if (!pairIds.length) continue

    const ok = await checkPairVolume(pairIds)
    if (!ok) continue

    await env.PIPERX_KV.put(`token:${t.id}`, JSON.stringify(t))
    added.push(t)
    if (t.createdAt && t.createdAt > maxCreatedAt) {
      maxCreatedAt = t.createdAt
    }
  }

  if (added.length) {
    const newIds = added.map((t) => t.id)
    idList = newIds.concat(idList)
    await env.PIPERX_KV.put(listKey, JSON.stringify(idList))
    await env.PIPERX_KV.put(lastCreatedKey, String(maxCreatedAt))
  }

  return { added: added.length, tokens: added }
}

router.get("/refreshtokens", async (c) => {
  try {
    const result = await updateCache(c.env)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

router.get("/tokens", async (c) => {
  try {
    const listStr = await c.env.PIPERX_KV.get("tokens:list")
    if (!listStr) return c.json({ tokens: [] })

    const ids: string[] = JSON.parse(listStr)
    const tokens: TokenInfo[] = []
    for (const id of ids) {
      const tStr = await c.env.PIPERX_KV.get(`token:${id}`)
      if (tStr) tokens.push(JSON.parse(tStr))
    }

    return c.json({ tokens })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

export default router
