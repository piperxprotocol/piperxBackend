import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

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
      if (map.has(bucket)) buffer[i - 1] = map.get(bucket)!
    }

    let carry: number | null = null
    for (let i = points - 1; i >= 0; i--) {
      if (buffer[i] !== null) carry = buffer[i]!
      else if (carry !== null) buffer[i] = carry
    }

    let lastKnown = buffer.find((v) => v !== null)
    if (lastKnown !== undefined) {
      for (let i = 0; i < points; i++) {
        if (buffer[i] === null) buffer[i] = lastKnown
        else lastKnown = buffer[i]!
      }
    } else {
      const fallback = nowMap[tokenId] ?? 0
      for (let i = 0; i < points; i++) buffer[i] = fallback
    }

    for (let i = 1; i <= points; i++) {
      historyMap[`${i}h`] = buffer[i - 1]!
    }

    result[tokenId] = historyMap
  }

  return result
}

function buildVolumeHistory(
  nowHour: number,
  rows: any[],
  tokenIds: string[],
  points = 48
) {
  const raw: Record<string, Map<number, number>> = {}
  for (const r of rows) {
    if (!raw[r.token_id]) raw[r.token_id] = new Map()
    raw[r.token_id].set(r.hour_bucket, r.volume_usd)
  }

  const result: Record<string, Record<string, number>> = {}
  for (const tokenId of tokenIds) {
    const map = raw[tokenId] || new Map()
    const historyMap: Record<string, number> = {}
    for (let i = 1; i <= points; i++) {
      const bucket = nowHour - i
      historyMap[`${i}h`] = map.get(bucket) ?? 0
    }
    result[tokenId] = historyMap
  }
  return result
}

router.get("/tokeninfo", async (c) => {
  try {
    // Fetch tokens created within last 48 hours from database
    const fortyEightHoursAgo = Math.floor(Date.now() / 1000) - (48 * 3600) // 48 hours ago in seconds

    const recentTokensResult = await c.env.DB.prepare(
      `SELECT id, name, symbol, decimals, created_at, pool, source, holder_count
       FROM tokens 
       WHERE created_at >= ?`
    ).bind(fortyEightHoursAgo).all<any>()

    const records: any[] = recentTokensResult.results || []
    const idsFromList: string[] = records.map((t: any) => t.id)

    // Still fetch active tokens from KV
    const activeStr = await c.env.PIPERX_PRO.get("tokens:active")
    let activeTokens: any[] = []
    let idsFromActive: string[] = []
    if (activeStr) {
      try {
        const parsed = JSON.parse(activeStr)
        activeTokens = parsed.tokens || []
        idsFromActive = (parsed.tokens || [])
          .map((t: any) => t.id || t.token_id)
          .filter((id: any) => !!id)
      } catch (e) {
        console.error("Failed to parse tokens:active:", e)
      }
    }

    const tokenIds: string[] = Array.from(new Set([...idsFromList, ...idsFromActive]))
    console.log("idsFromList:", idsFromList)
    console.log("idsFromActive:", idsFromActive)
    console.log("tokenIds >>>", tokenIds)
    console.log("tokenIds.length:", tokenIds.length)

    if (!tokenIds.length) return c.json({ error: "no tokens" }, 404)

    const nowHour = Math.floor(Date.now() / 3600_000)
    console.log("nowHour >>>", nowHour)
    const placeholders = tokenIds.map(() => '?').join(', ')
    const rows = await c.env.DB.prepare(
      `SELECT token_id, price_usd, hour_bucket
       FROM prices
       WHERE hour_bucket <= ?1 AND hour_bucket >= ?1 - 48
       AND token_id IN (${placeholders})
       ORDER BY hour_bucket ASC`
    ).bind(nowHour, ...tokenIds).all<any>()

    const allRows = rows.results || []

    const volumeQuery = `
    SELECT token_id, hour_bucket, SUM(volume_usd) AS volume_usd
    FROM volume
    WHERE hour_bucket <= ?1
      AND hour_bucket >= ?1 - 48
      AND token_id IN (${placeholders})
    GROUP BY token_id, hour_bucket
    ORDER BY hour_bucket ASC
  `
    const volumeRows = await c.env.DB.prepare(volumeQuery)
      .bind(nowHour, ...tokenIds)
      .all<any>()
    const allVolumeRows = volumeRows.results || []

    const nowMap: Record<string, number> = {}
    for (const row of allRows) {
      const id = row.token_id
      const bucket = row.hour_bucket
      const price = row.price_usd
      if (!nowMap[id] || bucket > (nowMap[id] as any).bucket) {
        nowMap[id] = { bucket, price } as any
      }
    }

    for (const key in nowMap) {
      nowMap[key] = (nowMap[key] as any).price
    }

    const history = buildHistory(nowHour, allRows, tokenIds, 48, nowMap)

    const volumeHistory = buildVolumeHistory(nowHour, allVolumeRows, tokenIds)

    console.log("history >>>", history)
    const metaMap: Record<string, { name: string; symbol: string; holder_count?: number; created_at: string | null; decimals?: number; pool?: string | null; source?: string | null; }> = {};
    for (const rec of records) {
      metaMap[rec.id.toLowerCase()] = {
        name: rec.name || "null",
        symbol: rec.symbol || "null",
        holder_count: rec.holder_count ?? 0,
        created_at: rec.created_at || null,
        decimals: rec.decimals ?? 18,
        pool: rec.pool,
        source: rec.source,
      }
    }
    for (const t of activeTokens) {
      const id = (t.id || t.token_id || "").toLowerCase()
      if (!id) continue
      if (!metaMap[id]) {
        metaMap[id] = {
          name: t.name || null,
          symbol: t.symbol || null,
          holder_count: t.holder_count ?? 0,
          created_at: t.created_at || null,
          decimals: t.decimals ?? 18,
        }
      }
    }
    console.log("metaMap >>>", metaMap)
    const result: Record<string, any> = {}

    for (const id of tokenIds) {
      const meta = metaMap[id.toLowerCase()] || { name: null, symbol: null, created_at: null, decimals: 18 };
      const decimals = meta.decimals ?? 18;

      const decimalAdjustment = 18 - (decimals - 6);
      const adjustPrice = (price: number | null | undefined) => {
        if (price === null || price === undefined) return 0;
        return Number(price) / (10 ** decimalAdjustment);
      };

      const adjustedNow = adjustPrice(nowMap[id] ?? 0);

      const adjustedHistory: Record<string, number> = {};
      const rawHist = history[id] || {};
      for (const [key, val] of Object.entries(rawHist)) {
        adjustedHistory[key] = adjustPrice(val as number);
      }

      const volHist = {}
      for (const [key, val] of Object.entries(volumeHistory[id] || {})) {
        volHist[key] = Number(val) / 1e6
      }

      const activeInfo = activeTokens.find(
        (t) => (t.token_id || t.id || "").toLowerCase() === id.toLowerCase()
      );
      const activePoolObj = activeInfo
        ? {
          pool: activeInfo.active_pool || null,
          source: activeInfo.source || null,
        }
        : {
          pool: meta.pool || null,
          source: meta.source || null,
        };

      result[id] = {
        id,
        name: meta.name,
        symbol: meta.symbol,
        holder_count: meta.holder_count,
        decimals: meta.decimals,
        created_at: meta.created_at,
        now: adjustedNow,
        history: adjustedHistory,
        volume: volHist,
        active_pool: activePoolObj,
      }
    }

    console.log("result >>>", result)
    return c.json({ tokenInfo: result })
  } catch (err: any) {
    console.error("Error in /prices:", err)
    return c.json({ error: err.message }, 500)
  }
})

export default router