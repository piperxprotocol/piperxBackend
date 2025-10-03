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
  const listStr = await env.PIPERX_PRO.get("tokens:list")
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
    WITH split_pairs AS (
      SELECT
        s.*,
        substr(s.pair, 1, instr(s.pair, '-') - 1) AS token0_id,
        substr(s.pair, instr(s.pair, '-') + 1) AS token1_id
      FROM swaps s
      WHERE s.timestamp > strftime('%s','now') - 48*3600
    ),
    union_tokens AS (
      SELECT token0_id AS token_id, CAST(amount_usd AS REAL) AS usd FROM split_pairs
      UNION ALL
      SELECT token1_id AS token_id, CAST(amount_usd AS REAL) AS usd FROM split_pairs
    )
    SELECT
      token_id,
      SUM(usd) AS total_usd
    FROM union_tokens
    GROUP BY token_id
    HAVING total_usd > 500
    ORDER BY total_usd DESC;
  `;

  const rows = await env.DB.prepare(sql).all<any>();
  let activeTokens = rows.results || [];

  console.log("Raw active tokens:", activeTokens);

  const exclude = [
    "0x1514000000000000000000000000000000000000".toLowerCase(),
    "0xF1815bd50389c46847f0Bda824eC8da914045D14".toLowerCase(),
  ];
  activeTokens = activeTokens.filter(t => !exclude.includes(t.token_id.toLowerCase()));

  console.log("Active Tokens (filtered):", JSON.stringify(activeTokens, null, 2));

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
