import { Hono } from 'hono';
import tokensRouter, { updateCache } from './routes/tokens';
import pricesRouter, { updatePrices } from './routes/prices';

const app = new Hono();

app.route('/api/launchpad', tokensRouter)
app.route('/api/launchpad', pricesRouter)

export default {
    fetch: app.fetch,
    scheduled: async (event, env, ctx) => {
        ctx.waitUntil(updateCache(env))

        for (let i = 0; i < 8; i++) {
            ctx.waitUntil((async () => {
                await new Promise(r => setTimeout(r, i * 7000)) 
                await updatePrices(env)
            })())
        }
    }

}
