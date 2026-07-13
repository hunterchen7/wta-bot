import { Hono } from 'hono';
import type { Env } from './env';
import { handleInteraction } from './discord/interactions';
import { forms } from './routes/forms';
import { exportRoutes } from './routes/export';
import { web } from './routes/web';
import { api } from './routes/api';
import { adminApi } from './routes/admin-api';
import { publicApi } from './routes/public-api';
import { automationApi } from './routes/automation-api';
import { mcpRoutes } from './routes/mcp';
import { tick } from './cron';
import { executeOutbox } from './engine/executor';
import { drainOutbox } from './engine/outbox';

export const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const method = c.req.method.toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const hasBrowserSession = (c.req.header('cookie') ?? '').includes('wta_sess=');
  const origin = c.req.header('origin');
  if (unsafe && hasBrowserSession && origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  await next();
  const pathname = new URL(c.req.url).pathname;
  const sameOriginPreview = pathname === '/preview' || pathname.startsWith('/preview/');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', sameOriginPreview ? 'SAMEORIGIN' : 'DENY');
  c.header('Content-Security-Policy', sameOriginPreview ? "frame-ancestors 'self'" : "frame-ancestors 'none'");
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

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
  const database = await c.env.DB.prepare('SELECT 1 AS ok').first().catch(() => null);
  return database ? c.json({ ok: true }) : c.json({ ok: false }, 503);
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
app.route('/', automationApi);
app.route('/', mcpRoutes);
app.route('/', publicApi);

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(tick(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
