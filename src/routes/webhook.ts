import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

router.post("/webhook/tokens", async (c) => {
    const body = await c.req.json<{ tokens: any[] }>()

    for (const t of body.tokens) {
        await c.env.DB.prepare(
            `INSERT OR IGNORE INTO tokens (id, name, symbol, decimals)
         VALUES (?1, ?2, ?3, ?4)`
        ).bind(t.id, t.name, t.symbol, t.decimals).run()

        await c.env.PIPERX_KV.put(
            `token:${t.id}`,
            JSON.stringify({
                id: t.id,
                name: t.name,
                symbol: t.symbol,
                decimals: t.decimals
            }),
            { expirationTtl: 172800 }
        )
    }

    return c.json({ status: "ok" })
})

router.post("/webhook/prices", async (c) => {
    try {
        const records = await c.req.json<any[]>()
        console.log("Received Price records:", records.length)

        for (const rec of records) {
            const tokenId = rec.token

            const ts = new Date(rec.timestamp).getTime()
            const hourBucket = Math.floor(ts / 3600_000)

            const pricePoint = {
                price_usd: rec.price_usd,
                ts,
                bucket: hourBucket,
            }

            const key = `prices:token:${tokenId}:buckets`
            const existingStr = await c.env.PIPERX_KV.get(key)
            let buckets: typeof pricePoint[] = existingStr ? JSON.parse(existingStr) : []

            const cutoff = hourBucket - 48
            buckets = buckets.filter(b => b.bucket > cutoff)

            const idx = buckets.findIndex(b => b.bucket === hourBucket)
            if (idx >= 0) {
                buckets[idx] = pricePoint
            } else {
                buckets.push(pricePoint)
            }

            await c.env.PIPERX_KV.put(key, JSON.stringify(buckets), {
                expirationTtl: 48 * 3600,
            })
        }

        return c.json({ ok: true, count: records.length })
    } catch (err: any) {
        console.error("Webhook /prices error:", err)
        return c.json({ error: err.message }, 500)
    }
})

router.post("/webhook/swaps", async (c) => {
    try {
        const records = await c.req.json<any[]>()
        console.log("Received Swap records:", records.length)

        for (const rec of records) {
            try {
                await c.env.DB.prepare(
                    `INSERT OR IGNORE INTO swaps
             (id, vid, timestamp, pair, token_0_amount, token_1_amount, account, amount_usd, amount_native)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    rec.id,
                    rec.vid,
                    rec.timestamp,
                    rec.pair,
                    rec.token_0_amount?.toString() ?? null,
                    rec.token_1_amount?.toString() ?? null,
                    rec.account,
                    rec.amount_usd?.toString() ?? null,
                    rec.amount_native?.toString() ?? null
                ).run()
            } catch (e) {
                console.error("DB insert error for swap:", rec.id, e)
            }
        }

        return c.json({ ok: true, count: records.length })
    } catch (err: any) {
        console.error("Webhook /swaps error:", err)
        return c.json({ error: err.message }, 500)
    }
})

export default router
