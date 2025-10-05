import { Hono } from "hono"
import type { Env } from "../utils/env"

const router = new Hono<{ Bindings: Env }>()

router.post("/webhook/tokens", async (c) => {
    try {
        const body = await c.req.json<any>()
        console.log("Webhook /tokens raw body:", body)

        let tokens: any[] = []
        if (Array.isArray(body.tokens)) {
            tokens = body.tokens
        } else if (body.tokens && typeof body.tokens === "object") {
            tokens = [body.tokens]
        } else if (Array.isArray(body)) {
            tokens = body
        } else if (body.id) {
            tokens = [body]
        } else {
            return c.json({ error: "Invalid payload, expected token(s)" }, 400)
        }

        console.log("Received Token records:", tokens.length)

        let records: any[] = []
        try {
            const existingStr = await c.env.PIPERX_PRO.get("tokens:records")
            records = existingStr ? JSON.parse(existingStr) : []
        } catch (e) {
            console.error("Failed to parse KV tokens:records:", e)
        }

        for (const t of tokens) {
            if (!t.id || !t.symbol) {
                console.warn("Skip invalid token:", t)
                continue
            }

            const exists = records.some((r) => r.id === t.id);
            if (exists) {
                console.log(`Token already exists in KV, skip: ${t.symbol} (${t.id})`);
                continue;
            }

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

        try {
            await c.env.PIPERX_PRO.put("tokens:records", JSON.stringify(records), {
                expirationTtl: 172800
            })
        } catch (e) {
            console.error("KV put failed:", e)
        }

        return c.json({ status: "ok", count: tokens.length })
    } catch (err: any) {
        console.error("Webhook /tokens error:", err)
        return c.json({ error: err.message || "Internal Server Error" }, 500)
    }
})

router.post("/webhook/prices", async (c) => {
    try {
        const records = await c.req.json<any[]>()
        console.log("Received Price records:", records)

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
        console.log("Received Swap records:", records)

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

router.get("/debug/kv/tokensrecords", async (c) => {
    const str = await c.env.PIPERX_PRO.get("tokens:records")
    if (!str) {
        return c.json({ message: "KV empty" })
    }
    return c.json(JSON.parse(str))
})

router.get("/debug/kv/tokensactive", async (c) => {
    const str = await c.env.PIPERX_PRO.get("tokens:active")
    if (!str) {
        return c.json({ message: "KV empty" })
    }
    return c.json(JSON.parse(str))
})

export default router
