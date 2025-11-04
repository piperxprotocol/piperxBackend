import { Hono } from 'hono';
import { cors } from 'hono/cors';
import tokensRouter, { refreshActiveTokens } from './routes/tokens';
import tokeninfoRouter from './routes/tokeninfo';
import webhookRouter from './routes/webhook';

const app = new Hono();

// Add CORS middleware
app.use('*', cors({
  origin: ['http://localhost:3000', 'https://piperxprotocol.com', 'https://www.piperxprotocol.com', 'https://piperxmain-zhoulu.pages.dev'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.route('/api/launchpad', tokensRouter)
app.route('/api/launchpad', tokeninfoRouter)
app.route('/api/launchpad', webhookRouter);


app.get("/debug/refresh", async (c) => {
    await refreshActiveTokens(c.env)
    return c.json({ ok: true })
})

export default {
    fetch: app.fetch,
    scheduled: async (event, env, ctx) => {
        ctx.waitUntil(refreshActiveTokens(env));
    },
};
