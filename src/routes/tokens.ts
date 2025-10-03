import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

const VOLUME_THRESHOLD = 500;

export type TokenInfo = {
  id: string
  name: string
  symbol: string
  decimals?: number
}

async function getNewTokens(env: Env): Promise<TokenInfo[]> {
  const listStr = await env.PIPERX_KV.get("tokens:list")
  if (!listStr) return []

  const ids: string[] = JSON.parse(listStr)
  const tokens: TokenInfo[] = []
  for (const id of ids) {
    const tStr = await env.PIPERX_KV.get(`token:${id}`)
    if (tStr) {
      tokens.push(JSON.parse(tStr))
    }
  }
  return tokens
}

async function getActiveTokensFromCache(env: Env): Promise<TokenInfo[]> {
  const cache = await env.PIPERX_KV.get("tokens:active")
  if (!cache) return []
  const parsed = JSON.parse(cache)
  return parsed.tokens || []
}

async function refreshActiveTokens(env: Env) {
  const since = Math.floor(Date.now() / 1000) - 48 * 3600;

  const rows = await env.DB.prepare(`
    SELECT t.id, t.name, t.symbol, t.decimals, SUM(CAST(s.amount_usd AS REAL)) AS total_usd
    FROM swaps s
    JOIN pairs p ON s.pair = p.id
    JOIN tokens t ON (t.id = p.token0 OR t.id = p.token1)
    WHERE s.timestamp > ?1
    GROUP BY t.id
    HAVING total_usd > ?2
    ORDER BY total_usd DESC
  `).bind(since, VOLUME_THRESHOLD).all<any>();

  const activeTokens = rows.results || [];

  await env.PIPERX_KV.put(
    'tokens:active',
    JSON.stringify({ updatedAt: Date.now(), tokens: activeTokens }),
    { expirationTtl: 3600 } // 缓存1小时
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
