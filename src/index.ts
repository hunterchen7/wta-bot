import { Hono } from 'hono';
import type { Env } from './env';
import { handleInteraction } from './discord/interactions';
import { forms } from './routes/forms';
import { exportRoutes } from './routes/export';
import { tick } from './cron';

export const app = new Hono<{ Bindings: Env }>();

app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT count(*) AS n FROM participants')
    .first<{ n: number }>()
    .catch(() => null);
  return c.json({ ok: true, participants: row?.n ?? null });
});

app.post('/discord', handleInteraction);
app.route('/', forms);
app.route('/', exportRoutes);

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(tick(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
