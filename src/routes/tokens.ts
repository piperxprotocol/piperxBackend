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


async function updateCache(env: { PIPERX_KV: KVNamespace }, tokens: TokenInfo[]) {
  if (!tokens.length) return []

  const listKey = "tokens:list"
  const lastCreatedKey = "tokens:lastCreatedAt"

  const listStr = await env.PIPERX_KV.get(listKey)
  let idList: string[] = listStr ? JSON.parse(listStr) : []
  let maxCreatedAt = Number(await env.PIPERX_KV.get(lastCreatedKey)) || 0

  for (const t of tokens) {
    await env.PIPERX_KV.put(`token:${t.id}`, JSON.stringify(t))
    if (t.createdAt && t.createdAt > maxCreatedAt) {
      maxCreatedAt = t.createdAt
    }
  }

  const newIds = tokens.map(t => t.id)
  idList = newIds.concat(idList)

  await env.PIPERX_KV.put(listKey, JSON.stringify(idList))
  await env.PIPERX_KV.put(lastCreatedKey, String(maxCreatedAt))

  return tokens
}


router.get("/refreshtokens", async (c) => {
  try {
    const lastCreatedAtStr = await c.env.PIPERX_KV.get("tokens:lastCreatedAt")
    const lastCreatedAt = lastCreatedAtStr ? Number(lastCreatedAtStr) : 0

    const data = await querySubgraph<{ tokens: TokenInfo[] }>(
      TOKENS_QUERY,
      { since: lastCreatedAt },
      SUBGRAPH_URL_LAUNCHPAD
    )

    const newTokens = await updateCache(c.env, data.tokens)
    return c.json({ added: newTokens.length, tokens: newTokens })
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

  // try {
  //   const cached = await c.env.PIPERX_KV.get("markets");
  //   const data = await querySubgraph<{ tokens: TokenInfo[] }>(
  //     TOKENS_QUERY,
  //     {},
  //     SUBGRAPH_URL_LAUNCHPAD
  //   )
  //   return c.json({ tokens: data.tokens })
  // } catch (err: any) {
  //   return c.json({ error: err.message }, 500)
  // }
})

export default router
