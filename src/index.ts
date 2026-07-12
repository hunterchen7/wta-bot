import { Hono } from 'hono';
import type { Env } from './env';
import { handleInteraction } from './discord/interactions';
import { forms } from './routes/forms';
import { exportRoutes } from './routes/export';
import { web } from './routes/web';
import { api } from './routes/api';
import { adminApi } from './routes/admin-api';
import { tick } from './cron';
import { executeOutbox } from './engine/executor';
import { drainOutbox } from './engine/outbox';

export const app = new Hono<{ Bindings: Env }>();

// After any POST (interaction, form submit, login, API write), flush a few
// outbox rows in the background so user-triggered emails/DMs go out within
// seconds instead of waiting for the 15-min cron. The claim-safe drain means
// this never collides with the cron or another concurrent request. The cron
// remains the backstop for quiet periods and scheduled jobs.
const OPPORTUNISTIC_BUDGET = 10;
app.use('*', async (c, next) => {
  await next();
  if (c.req.method !== 'POST') return;
  try {
    c.executionCtx.waitUntil(
      drainOutbox(c.env, executeOutbox, OPPORTUNISTIC_BUDGET).catch((err) =>
        console.error('opportunistic drain failed:', err),
      ),
    );
  } catch {
    // No execution context (test harness) — skip; the cron still drains.
  }
});

app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT count(*) AS n FROM participants')
    .first<{ n: number }>()
    .catch(() => null);
  return c.json({ ok: true, participants: row?.n ?? null });
});

app.post('/discord', handleInteraction);
// Humans who open the endpoint in a browser send GET — reassure them.
app.get('/discord', (c) =>
  c.text(
    'This is the Discord interactions endpoint. Discord POSTs signed requests here — a 404/405 in your browser is normal. Health check: /health',
  ),
);
app.route('/', forms);
app.route('/', exportRoutes);
app.route('/', web);
app.route('/', api);
app.route('/', adminApi);
app.get('/', (c) => c.redirect('/dashboard'));

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(tick(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
