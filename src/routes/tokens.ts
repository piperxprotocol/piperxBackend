import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

export type TokenInfo = {
  id: string
  name: string
  symbol: string
  decimals?: number
  source?: "kv" | "db"
}

async function getNewTokens(env: Env): Promise<TokenInfo[]> {
  const listStr = await env.PIPERX_KV.get("tokens:list")
  if (!listStr) return []

  const ids: string[] = JSON.parse(listStr)
  const tokens: TokenInfo[] = []
  for (const id of ids) {
    const tStr = await env.PIPERX_KV.get(`token:${id}`)
    if (tStr) {
      const t = JSON.parse(tStr)
      tokens.push({ ...t, source: "kv" })
    }
  }
  return tokens
}

async function getActiveTokensFromDB(env: Env): Promise<TokenInfo[]> {
  const since = Math.floor(Date.now() / 1000) - 48 * 3600

  const result = await env.DB.prepare(`
    SELECT pair, SUM(CAST(amount_usd AS REAL)) AS total_usd
    FROM swaps
    WHERE timestamp > ?1
    GROUP BY pair
    HAVING total_usd > ?2
  `).bind(since, 500).all<any>()

  const activeTokens: TokenInfo[] = []

  for (const row of result.results) {
    const pairInfo = await env.DB.prepare(
      `SELECT token0, token1 FROM pairs WHERE id = ?1`
    ).bind(row.pair).first<any>()

    if (pairInfo) {
      for (const tokenId of [pairInfo.token0, pairInfo.token1]) {
        const tokenRow = await env.DB.prepare(
          `SELECT id, name, symbol, decimals FROM tokens WHERE id = ?1`
        ).bind(tokenId).first<any>()

        if (tokenRow) {
          activeTokens.push({ ...tokenRow, source: "db" })
        } else {
          activeTokens.push({ id: tokenId, name: tokenId, symbol: "UNKNOWN", source: "db" })
        }
      }
    }
  }

  return activeTokens
}

router.get("/tokens", async (c) => {
  try {
    const newTokens = await getNewTokens(c.env)
    const activeTokens = await getActiveTokensFromDB(c.env)

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
