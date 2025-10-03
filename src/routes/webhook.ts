import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

router.post("/webhook/tokens", async (c) => {
    console.log("1111")
    const body = await c.req.json<{ tokens: any[] }>()
    console.log("Received Token records:", body.tokens.length)

    const existingStr = await c.env.PIPERX_PRO.get("tokens:records")
    let records: any[] = existingStr ? JSON.parse(existingStr) : []

    for (const t of body.tokens) {
        await c.env.DB.prepare(
            `INSERT OR IGNORE INTO tokens (id, name, symbol, decimals)
         VALUES (?1, ?2, ?3, ?4)`
        ).bind(t.id, t.name, t.symbol, t.decimals).run()

        records = records.filter(r => r.id !== t.id)
        records.unshift({
            id: t.id,
            name: t.name,
            symbol: t.symbol,
            decimals: t.decimals
        })
    }

    await c.env.PIPERX_PRO.put("tokens:records", JSON.stringify(records), {
        expirationTtl: 172800
    })

    return c.json({ status: "ok", count: body.tokens.length })
})


router.post("/webhook/prices", async (c) => {
    try {
        const records = await c.req.json<any[]>()
        console.log("Received Price records:", records.length)

        for (const rec of records) {
            const tokenId = rec.token
            const ts = Math.floor(new Date(rec.timestamp).getTime() / 1000) // 秒级
            const hourBucket = Math.floor(ts / 3600) // 小时桶

            try {
                await c.env.DB.prepare(
                    `INSERT INTO prices (token_id, hour_bucket, ts, price_usd)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(token_id, hour_bucket)
             DO UPDATE SET ts = excluded.ts, price_usd = excluded.price_usd`
                ).bind(tokenId, hourBucket, ts, rec.price_usd).run()
            } catch (e) {
                console.error("DB insert error for price:", tokenId, e)
            }
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
