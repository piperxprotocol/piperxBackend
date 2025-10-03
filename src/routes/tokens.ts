import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

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
