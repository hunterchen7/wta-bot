import { Hono } from 'hono';
import type { Env } from '../env';
import {
  automationOverview,
  automationParticipant,
  automationParticipants,
  automationProblems,
  automationRounds,
  createAutomationProblem,
  setAutomationParticipantStatus,
} from '../services/admin-control';
import {
  authenticateAdminBearer,
  hasAdminScope,
  type AdminPrincipal,
  type AdminScope,
} from '../services/admin-tokens';

export const automationApi = new Hono<{ Bindings: Env }>();

async function authorize(c: any, scope: AdminScope): Promise<AdminPrincipal | Response> {
  const principal = await authenticateAdminBearer(c.env, c.req.header('authorization'));
  if (!principal) {
    return c.json({ error: 'unauthorized', message: 'Use a valid WTA admin API bearer token.' }, 401, {
      'WWW-Authenticate': 'Bearer realm="WTA Admin API"',
    });
  }
  if (!hasAdminScope(principal, scope)) return c.json({ error: 'insufficient_scope', required: scope }, 403);
  return principal;
}

automationApi.get('/api/admin/v1', async (c) => {
  const principal = await authorize(c, 'admin:read');
  if (principal instanceof Response) return principal;
  return c.json({
    name: 'WTA Admin API',
    version: 'v1',
    actorParticipantId: principal.actorParticipantId,
    scopes: principal.scopes,
    mcp: '/mcp',
  });
});

automationApi.get('/api/admin/v1/overview', async (c) => {
  const principal = await authorize(c, 'admin:read');
  if (principal instanceof Response) return principal;
  return c.json(await automationOverview(c.env));
});

automationApi.get('/api/admin/v1/participants', async (c) => {
  const principal = await authorize(c, 'admin:read');
  if (principal instanceof Response) return principal;
  return c.json({ participants: await automationParticipants(c.env, {
    search: c.req.query('search'),
    status: c.req.query('status'),
    limit: Number(c.req.query('limit') || 100),
  }) });
});

automationApi.get('/api/admin/v1/participants/:id', async (c) => {
  const principal = await authorize(c, 'admin:read');
  if (principal instanceof Response) return principal;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid_id' }, 400);
  const result = await automationParticipant(c.env, id);
  return result ? c.json(result) : c.json({ error: 'not_found' }, 404);
});

automationApi.patch('/api/admin/v1/participants/:id/status', async (c) => {
  const principal = await authorize(c, 'participants:write');
  if (principal instanceof Response) return principal;
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ status?: string; note?: string }>().catch(() => null);
  if (!Number.isInteger(id) || !body?.status) return c.json({ error: 'invalid_request' }, 400);
  const result = await setAutomationParticipantStatus(c.env, principal.actorParticipantId, id, body.status, body.note);
  return result ? c.json({ ok: true, participant: result }) : c.json({ error: 'not_found_or_invalid_status' }, 404);
});

automationApi.get('/api/admin/v1/rounds', async (c) => {
  const principal = await authorize(c, 'admin:read');
  if (principal instanceof Response) return principal;
  const requested = c.req.query('weekId') ? Number(c.req.query('weekId')) : undefined;
  if (requested != null && !Number.isInteger(requested)) return c.json({ error: 'invalid_week_id' }, 400);
  return c.json(await automationRounds(c.env, requested));
});

automationApi.get('/api/admin/v1/problems', async (c) => {
  const principal = await authorize(c, 'admin:read');
  if (principal instanceof Response) return principal;
  return c.json(await automationProblems(c.env));
});

automationApi.post('/api/admin/v1/problems', async (c) => {
  const principal = await authorize(c, 'problems:write');
  if (principal instanceof Response) return principal;
  const body = await c.req.json().catch(() => null);
  const result = await createAutomationProblem(c.env, principal.actorParticipantId, body);
  return result
    ? c.json({ ok: true, problem: result }, 201)
    : c.json({ error: 'invalid_problem', message: 'Title, difficulty, statement Markdown, and available rounds are required. Automated problems also need starter code for each language and at least one test.' }, 400);
});
