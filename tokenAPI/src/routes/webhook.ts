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

            await c.env.DB.prepare(`
                INSERT INTO tokens (id, name, symbol, decimals, created_at, pool, source)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  symbol = excluded.symbol,
                  decimals = excluded.decimals,
                  created_at = excluded.created_at,
                  pool = excluded.pool,
                  source = excluded.source
              `).bind(
                t.id,
                t.name,
                t.symbol,
                t.decimals,
                t.created_at,
                t.pool,
                t.source
            ).run()

            const idx = records.findIndex((r) => r.id === t.id);
            const recordData = {
                id: t.id,
                name: t.name ?? "Unknown",
                symbol: t.symbol ?? "UNK",
                decimals: t.decimals ?? 18,
                created_at: t.created_at ?? Date.now(),
                pool: t.pool ?? null,
                source: t.source ?? null,
            };

            if (idx !== -1) {
                records[idx] = recordData;
                console.log(`Updated token in KV: ${t.symbol} (${t.id})`);
            } else {
                records.unshift(recordData);
                console.log(`Added new token to KV: ${t.symbol} (${t.id})`);
            }
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
            const ts = Math.floor(new Date(rec.timestamp).getTime() / 1000)
            const hourBucket = Math.floor(ts / 3600)

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

        for (const raw of records) {
            const rec = {
                ...raw,
                token0: raw.token_0,
                token1: raw.token_1,
            };

            try {
                const result = await c.env.DB.prepare(
                    `INSERT OR IGNORE INTO swaps
                     (id, vid, timestamp, pair, token_0_amount, token_1_amount, account,
                      amount_usd, amount_native, token0, token1, source)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                    .bind(
                        rec.id,
                        rec.vid,
                        rec.timestamp,
                        rec.pair,
                        rec.token_0_amount?.toString() ?? null,
                        rec.token_1_amount?.toString() ?? null,
                        rec.account,
                        rec.amount_usd?.toString() ?? null,
                        rec.amount_native?.toString() ?? null,
                        rec.token0 ?? null,
                        rec.token1 ?? null,
                        rec.source ?? null
                    )
                    .run()

                console.log("Insert successful:", result)

                const hour_bucket = Math.floor(new Date(rec.timestamp).getTime() / 1000 / 3600)

                const params = [
                    rec.pair,
                    rec.source ?? "null",
                    hour_bucket,
                    rec.amount_usd ?? 0,
                    rec.amount_native ?? 0,
                ]

                const query = `
                INSERT INTO volume (token_id, pool, source, hour_bucket, volume_usd, volume_native)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(token_id, pool, source, hour_bucket)
                DO UPDATE SET
                  volume_usd = volume_usd + excluded.volume_usd,
                  volume_native = volume_native + excluded.volume_native
              `;

                console.log("🟢 Volume insert params:", {
                    token0: rec.token0,
                    token1: rec.token1,
                    pool: rec.pair,
                    source: rec.source
                });


                const res0 = await c.env.DB.prepare(query)
                    .bind(rec.token0, ...params)
                    .run();

                console.log(`token0 Insert successful: ${rec.token0}`, res0);

                const res1 = await c.env.DB.prepare(query)
                    .bind(rec.token1, ...params)
                    .run();

                console.log(`token1 Insert successful: ${rec.token1}`, res1);

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

router.post("/webhook/holders", async (c) => {
    try {
        const body = await c.req.json<any>()
        console.log("Webhook /holders raw body:", body)

        const holders = Array.isArray(body) ? body : [body]

        for (const h of holders) {
            if (!h.id || typeof h.holderCount === "undefined") continue

            const id = h.id.toLowerCase()
            const count = Number(h.holderCount)

            const result = await c.env.DB.prepare(`
                UPDATE tokens
                SET holder_count = ?1
                WHERE id = ?2
            `).bind(count, id).run()

            console.log(`🔹 Updated ${id} → ${count}`, result)
        }

        return c.json({ ok: true, count: holders.length })
    } catch (err: any) {
        console.error("Webhook /holders error:", err)
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
