import { Hono } from 'hono';
import tokensRouter, { refreshActiveTokens } from './routes/tokens';
import pricesRouter from './routes/prices';
import webhookRouter from './routes/webhook';

const app = new Hono();

app.route('/api/launchpad', tokensRouter)
app.route('/api/launchpad', pricesRouter)
app.route('/api/launchpad', webhookRouter);

export default {
  fetch: app.fetch,
  scheduled: async (event, env, ctx) => {
    ctx.waitUntil(refreshActiveTokens(env)); 
  },
};
