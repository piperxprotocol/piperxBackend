import { Hono } from 'hono';
import tokensRouter, { updateCache } from './routes/tokens';
import pricesRouter from './routes/prices';

const app = new Hono();

app.route('/api/launchpad', tokensRouter)
app.route('/api/launchpad', pricesRouter)

export default {
    fetch: app.fetch,
    scheduled: async (event, env, ctx) => {
        ctx.waitUntil(updateCache(env))
    }
}
