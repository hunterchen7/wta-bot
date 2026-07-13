import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import * as z from 'zod/v4';
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
import { authenticateAdminBearer, hasAdminScope, type AdminPrincipal } from '../services/admin-tokens';

export const mcpRoutes = new Hono<{ Bindings: Env }>();

const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

function buildMcpServer(env: Env, principal: AdminPrincipal): McpServer {
  const server = new McpServer({ name: 'wta-admin', version: '1.0.0' });

  server.registerTool('get_overview', {
    title: 'Get WTA overview',
    description: 'Read participant, session, report, delivery failure, and cron-health totals.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => result(await automationOverview(env)));

  server.registerTool('list_participants', {
    title: 'List participants',
    description: 'Search the WTA roster by name, email, or Discord username and optionally filter status.',
    inputSchema: {
      search: z.string().max(200).optional(),
      status: z.enum(['active', 'paused', 'held', 'removed', 'completed']).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    },
    annotations: { readOnlyHint: true },
  }, async (input) => result({ participants: await automationParticipants(env, input) }));

  server.registerTool('get_participant', {
    title: 'Get participant',
    description: 'Read one participant with their sessions, form completion metadata, and incidents.',
    inputSchema: { participantId: z.number().int().positive() },
    annotations: { readOnlyHint: true },
  }, async ({ participantId }) => {
    const value = await automationParticipant(env, participantId);
    return value ? result(value) : { ...result({ error: 'not_found' }), isError: true };
  });

  server.registerTool('list_rounds', {
    title: 'List rounds and assignments',
    description: 'Read the active cohort, round dates, opt-ins, pairings, assigned problems, report counts, and re-pair queue.',
    inputSchema: { weekId: z.number().int().positive().optional() },
    annotations: { readOnlyHint: true },
  }, async ({ weekId }) => result(await automationRounds(env, weekId)));

  server.registerTool('list_problems', {
    title: 'List question bank',
    description: 'Read question Markdown, availability tags, round sets, usage, and practice problems.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => result(await automationProblems(env)));

  if (hasAdminScope(principal, 'participants:write')) {
    server.registerTool('set_participant_status', {
      title: 'Set participant status',
      description: 'Activate, pause, hold, remove, or complete one participant. This does not hard-delete historical data.',
      inputSchema: {
        participantId: z.number().int().positive(),
        status: z.enum(['active', 'paused', 'held', 'removed', 'completed']),
        note: z.string().max(500).optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    }, async ({ participantId, status, note }) => {
      const value = await setAutomationParticipantStatus(env, principal.actorParticipantId, participantId, status, note);
      return value ? result({ ok: true, participant: value }) : { ...result({ error: 'not_found' }), isError: true };
    });
  }

  if (hasAdminScope(principal, 'problems:write')) {
    server.registerTool('create_problem', {
      title: 'Create question-bank problem',
      description: 'Add a Markdown-backed interview problem and tag the rounds where it is available.',
      inputSchema: {
        title: z.string().min(1).max(200),
        difficulty: z.enum(['easy', 'medium', 'hard']),
        content: z.string().min(1).max(100_000).describe('Markdown containing at least a ## Statement section.'),
        availableWeeks: z.array(z.number().int().min(1).max(8)).min(1),
        source: z.string().max(50).default('manual'),
        number: z.number().int().positive().optional(),
        url: z.string().url().max(1000).optional(),
        difficultyRank: z.number().optional(),
        active: z.boolean().default(true),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    }, async (input) => {
      const value = await createAutomationProblem(env, principal.actorParticipantId, input);
      return value ? result({ ok: true, problem: value }) : { ...result({ error: 'invalid_problem' }), isError: true };
    });
  }

  return server;
}

mcpRoutes.all('/mcp', async (c) => {
  if (c.req.method !== 'POST') {
    return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }, 405, { Allow: 'POST' });
  }
  const expectedHost = c.env.PUBLIC_ORIGIN ? new URL(c.env.PUBLIC_ORIGIN).host : new URL(c.req.url).host;
  if (new URL(c.req.url).host !== expectedHost) return c.json({ error: 'invalid_host' }, 421);
  const principal = await authenticateAdminBearer(c.env, c.req.header('authorization'));
  if (!principal || !hasAdminScope(principal, 'admin:read')) {
    return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer realm="WTA MCP"' });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildMcpServer(c.env, principal);
  try {
    await server.connect(transport);
    return await transport.handleRequest(c.req.raw, {
      authInfo: {
        token: principal.tokenName,
        clientId: `wta-admin-token-${principal.tokenId}`,
        scopes: principal.scopes,
      },
    });
  } catch (error) {
    console.error('MCP request failed', error);
    return c.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }, 500);
  }
});
