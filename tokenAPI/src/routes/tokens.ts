import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

const VOLUME_THRESHOLD = 500000000;
const subgraph_storyhunt =
  "https://api.goldsky.com/api/public/project_clzxbl27v2ce101zr2s7sfo05/subgraphs/story-dex-swaps-mainnet/1.0.23/gn"

export type TokenInfo = {
  id: string
  name: string
  symbol: string
  decimals?: number
}

async function getNewTokens(env: Env): Promise<TokenInfo[]> {
  const listStr = await env.PIPERX_PRO.get("tokens:records")
  if (!listStr) return []

  const ids: string[] = JSON.parse(listStr)
  const tokens: TokenInfo[] = []
  for (const id of ids) {
    const tStr = await env.PIPERX_PRO.get(`token:${id}`)
    if (tStr) {
      tokens.push(JSON.parse(tStr))
    }
  }
  return tokens
}

async function getActiveTokensFromCache(env: Env): Promise<TokenInfo[]> {
  const cache = await env.PIPERX_PRO.get("tokens:active")
  if (!cache) return []
  const parsed = JSON.parse(cache)
  return parsed.tokens || []
}

export async function refreshActiveTokens(env: Env) {
  const sql = `
  SELECT pair
  FROM swaps
  WHERE strftime('%s', timestamp) > strftime('%s','now') - 48*3600
  GROUP BY pair
  HAVING SUM(CAST(amount_usd AS REAL)) > 5e8
  ORDER BY SUM(CAST(amount_usd AS REAL)) DESC;
  `;

  const { results } = await env.DB.prepare(sql).all<any>()
  const pairs = results.map((r) => r.pair.toLowerCase())
  console.log(`Found ${pairs.length} active pools`)

  if (pairs.length === 0) {
    console.log("No pools above 5e8 volume.")
    return
  }

  const tokenSet = new Set<string>()

  for (let i = 0; i < pairs.length; i += 1000) {
    const batch = pairs.slice(i, i + 1000)
    const query = `
      {
        tokenPairs(where: { id_in: [${batch.map((id) => `"${id}"`).join(",")}] }) {
          id
          token0 { id }
          token1 { id }
        }
      }
    `
    try {
      const res = await fetch(subgraph_storyhunt, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      })

      const json = (await res.json()) as {
        data?: { tokenPairs?: { token0: { id: string }; token1: { id: string } }[] }
        errors?: any
      }

      if (json.data && json.data.tokenPairs) {
        for (const pair of json.data.tokenPairs) {
          tokenSet.add(pair.token0.id.toLowerCase())
          tokenSet.add(pair.token1.id.toLowerCase())
        }
      } else if (json.errors) {
        console.error("GraphQL error:", json.errors)
      }
    } catch (err) {
      console.error("Fetch failed:", err)
    }
  }

  let activeTokens = Array.from(tokenSet).map((id) => ({ token_id: id }))

  console.log("Active Tokens:", JSON.stringify(activeTokens, null, 2));

  const tokenIds = activeTokens.map((t) => t.token_id.toLowerCase());
  console.log(`tokenIds count = ${tokenIds.length}`);
  const metaMap: Record<string, any> = {};
  if (tokenIds.length) {
    const BATCH_SIZE = 80;
    for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
      const batch = tokenIds.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(",");
      const metaSql = `
        SELECT id, symbol, created_at
        FROM tokens
        WHERE id IN (${placeholders})
      `;
      const metaRows = await env.DB.prepare(metaSql).bind(...batch).all<any>();

      for (const m of metaRows.results || []) {
        metaMap[m.id.toLowerCase()] = {
          symbol: m.symbol,
          created_at: m.created_at,
        };
      }
    }

    activeTokens = activeTokens.map((t) => ({
      ...t,
      symbol: metaMap[t.token_id.toLowerCase()]?.symbol ?? null,
      created_at: metaMap[t.token_id.toLowerCase()]?.created_at ?? null,
    }));
  }

  await env.PIPERX_PRO.put(
    "tokens:active",
    JSON.stringify({ updatedAt: Date.now(), tokens: activeTokens }),
    { expirationTtl: 3600 }
  );

  console.log(`refreshed active tokens: ${activeTokens.length}`);
}


router.get("/tokens", async (c) => {
  try {
    const newTokens = await getNewTokens(c.env)
    const activeTokens = await getActiveTokensFromCache(c.env)

    const merged: Record<string, TokenInfo> = {}
    for (const t of [...newTokens, ...activeTokens]) {
      merged[t.id] = t
    }

    return c.json({ tokens: Object.values(merged) })
  } catch (err: any) {
    console.error("Error fetching tokens:", err)
    return c.json({ error: err.message }, 500)
  }
})

export default router
