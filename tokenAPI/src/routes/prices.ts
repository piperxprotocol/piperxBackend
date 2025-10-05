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

router.get("/prices", async (c) => {
  try {
    const listStr = await c.env.PIPERX_PRO.get("tokens:records")
    const activeStr = await c.env.PIPERX_PRO.get("tokens:active")

    let records: any[] = []
    let idsFromList: string[] = []
    if (listStr) {
      try {
        const parsed = JSON.parse(listStr)
        records = parsed
        idsFromList = parsed.map((t: any) => t.id)
      } catch (e) {
        console.error("Failed to parse tokens:records:", e)
      }
    }

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
    if (!tokenIds.length) return c.json({ error: "no tokens" }, 404)

    console.log("tokenIds >>>", tokenIds)

    const nowHour = Math.floor(Date.now() / 3600_000)
    console.log("nowHour >>>", nowHour)
    const rows = await c.env.DB.prepare(
      `SELECT token_id, price_usd, hour_bucket
       FROM prices
       WHERE hour_bucket <= ?1 AND hour_bucket > ?1 - 48
       ORDER BY hour_bucket ASC`
    ).bind(nowHour).all<any>()

    const allRows = rows.results || []

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

    const metaMap: Record<string, { symbol: string; created_at: string | null }> = {}
    for (const rec of records) {
      metaMap[rec.id.toLowerCase()] = {
        symbol: rec.symbol || "-",
        created_at: rec.created_at || null,
      }
    }
    for (const t of activeTokens) {
      const id = (t.id || t.token_id || "").toLowerCase()
      if (!id) continue
      if (!metaMap[id]) {
        metaMap[id] = {
          symbol: t.symbol || "-",
          created_at: t.created_at || null,
        }
      }
    }

    const result: Record<string, any> = {}
    for (const id of tokenIds) {
      const meta = metaMap[id.toLowerCase()] || { symbol: "-", created_at: null }
      result[id] = {
        id,
        symbol: meta.symbol,
        created_at: meta.created_at,
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
