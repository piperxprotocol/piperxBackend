import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

const VOLUME_THRESHOLD = 500000000;
const subgraph_storyhunt =
  "https://api.goldsky.com/api/public/project_clzxbl27v2ce101zr2s7sfo05/subgraphs/story-dex-swaps-mainnet/1.0.23/gn"

const subgraph_piperx =
  "https://api.goldsky.com/api/public/project_clzxbl27v2ce101zr2s7sfo05/subgraphs/story-dex-swaps-mainnet/1.0.22/gn"


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

function buildTokenPairsQuery(ids: string[]) {
  return `
    {
      tokenPairs(where: { id_in: [${ids.map((id) => `"${id}"`).join(",")}] }) {
        id
        token0 { id }
        token1 { id }
      }
    }
  `;
}

async function fetchSubgraph(url: string, query: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return res.json() as Promise<{
    data?: { tokenPairs?: { token0: { id: string }; token1: { id: string } }[] };
    errors?: any;
  }>;
}

export async function refreshActiveTokens(env: Env) {
  const sql = `
    SELECT 
      token_id,
      pool,
      source,
      SUM(CAST(volume_usd AS REAL)) AS total_volume
    FROM volume
    WHERE hour_bucket > (CAST(strftime('%s', 'now') AS INTEGER) / 3600) - 48
    GROUP BY token_id, pool, source
    ORDER BY total_volume DESC;
  `;

  const { results } = await env.DB.prepare(sql).all<any>();
  if (!results?.length) {
    console.log("No volume records found in past 48 hours");
    return;
  }

  console.log(`✅ Loaded ${results.length} token-pool volume records`);

  const tokenStats: Record<
    string,
    {
      total_volume: number;
      top_pool: string;
      top_source: string;
      top_volume: number;
    }
  > = {};

  for (const row of results) {
    const id = row.token_id.toLowerCase();
    const vol = Number(row.total_volume || 0);

    if (!tokenStats[id]) {
      tokenStats[id] = {
        total_volume: 0,
        top_pool: row.pool.toLowerCase(),
        top_source: row.source,
        top_volume: vol,
      };
    }

    tokenStats[id].total_volume += vol;

    if (vol > tokenStats[id].top_volume) {
      tokenStats[id].top_volume = vol;
      tokenStats[id].top_pool = row.pool.toLowerCase();
      tokenStats[id].top_source = row.source;
    }
  }

  let activeTokens = Object.entries(tokenStats)
    .filter(([_, stat]) => stat.total_volume > 5e8)
    .map(([token_id, stat]) => ({
      token_id,
      total_volume: stat.total_volume,
      active_pool: stat.top_pool,
      source: stat.top_source,
    }));

  console.log(`Active tokens above 5e8 volume: ${activeTokens.length}`);

  if (!activeTokens.length) {
    console.log("No tokens above threshold.");
    return;
  }

  const tokenIds = activeTokens.map((t) => t.token_id);
  const metaMap: Record<string, any> = {};

  const BATCH_SIZE = 80;
  for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
    const batch = tokenIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const metaSql = `
      SELECT id, name, symbol, decimals, created_at, holder_count
      FROM tokens
      WHERE id IN (${placeholders})
    `;
    const metaRows = await env.DB.prepare(metaSql).bind(...batch).all<any>();
    for (const m of metaRows.results || []) {
      metaMap[m.id.toLowerCase()] = {
        name: m.name,
        symbol: m.symbol,
        decimals: m.decimals,
        created_at: m.created_at,
        holder_count: m.holder_count, 
      };
    }
  }

  activeTokens = activeTokens.map((t) => ({
    ...t,
    name: metaMap[t.token_id]?.name ?? null,
    symbol: metaMap[t.token_id]?.symbol ?? null,
    decimals: metaMap[t.token_id]?.decimals ?? null,
    created_at: metaMap[t.token_id]?.created_at ?? null,
    holder_count: metaMap[t.token_id]?.holder_count ?? 0, 
  }));

  await env.PIPERX_PRO.put(
    "tokens:active",
    JSON.stringify({
      updatedAt: Date.now(),
      tokens: activeTokens,
    }),
    { expirationTtl: 3600 }
  );

  console.log(`✅ Refreshed active tokens: ${activeTokens.length}`);
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
