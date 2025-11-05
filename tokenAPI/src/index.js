import { Hono } from 'hono';
import { cors } from 'hono/cors';
import tokensRouter, { refreshActiveTokens } from './routes/tokens';
import tokeninfoRouter from './routes/tokeninfo';
import webhookRouter from './routes/webhook';

const app = new Hono();

// Add CORS middleware
app.use('/api/*', async (c, next) => {
    // Handle paths that need open CORS
    if (c.req.path.startsWith('/api/price') ||
        c.req.path === '/api/graphdata' ||
        c.req.path.includes('/api/graphdata/') ||
        c.req.path.includes('/api/davinci')) {
        // Handle OPTIONS preflight request
        if (c.req.method === 'OPTIONS') {
            c.header('Access-Control-Allow-Origin', '*');
            c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            c.header('Access-Control-Allow-Headers', 'Content-Type');
            return new Response(null, { status: 204 });
        }

        c.header('Access-Control-Allow-Origin', '*');
        c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type');
        return await next();
    }

    return cors({
        origin: [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:6173',
            'https://davinci.piperx.xyz',
            'https://banged.ai',
            'http://v1.app.piperx.xyz',
            'https://piperx-widget.pages.dev',
            'https://widget.piperx.xyz',
            'https://app.piperx.xyz',
            'https://dev.piperx.xyz',
            'https://og.piperx.xyz',
            'https://og-piperx.pages.dev',
            'https://piperxog-dev.pages.dev',
            'https://piperxbadge-dev.pages.dev',
            'https://badge.piperx.xyz',
            'https://piperxmain.pages.dev',
            'https://piperxmain-gary.pages.dev',
            'https://piperxmain-jingjing.pages.dev',
            'https://piperxmain-zhoulu.pages.dev',
            'https://piperx.xyz',
            'https://piperx-dev.pages.dev',
            'https://www.piperx.xyz',
            'https://loudr.xyz',
            'https://story.d3x.exchange',
            'https://api-auth-staging.playarts.ai',
            'https://api-auth-alpha.playarts.ai',
            'https://app-beta.playarts.ai'
        ],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        exposeHeaders: ['Content-Length'],
        maxAge: 600,
        credentials: true,
    })(c, next);
});

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
