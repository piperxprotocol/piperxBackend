import { Hono } from 'hono';
import tokensRouter from './routes/tokens';
import pricesRouter from './routes/prices';

const app = new Hono();

app.route('/api/launchpad', tokensRouter)
app.route('/api/launchpad', pricesRouter)



export default app;