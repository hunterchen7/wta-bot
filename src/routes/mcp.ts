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
  removeAutomationParticipant,
  setReversibleAutomationParticipantStatus,
} from '../services/admin-control';
import { authenticateAdminBearer, hasAdminScope, type AdminPrincipal } from '../services/admin-tokens';

export const mcpRoutes = new Hono<{ Bindings: Env }>();

const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

function buildMcpServer(env: Env, principal: AdminPrincipal): McpServer {
  const server = new McpServer({ name: 'wta-admin', version: '1.1.0' });

  server.registerTool('get_overview', {
    title: 'Get program health overview',
    description: 'Return program-wide aggregate health across all cohorts: the enrollment funnel (link generated, form opened, and completed), participant statuses, session states, report completion, exhausted delivery items, and the most recent cron tick. Use list_rounds for current-round details.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => result(await automationOverview(env)));

  server.registerTool('list_participants', {
    title: 'List participants',
    description: 'Find participants by name, email, or Discord username. Returns internal WTA participant IDs, Discord identity, status, interview credits, and reports owed. Use the returned id with get_participant and participant-management tools.',
    inputSchema: {
      search: z.string().max(200).optional().describe('Optional partial name, email address, or Discord username. Matching is case-insensitive.'),
      status: z.enum(['active', 'paused', 'held', 'removed', 'completed']).optional().describe('Optional exact participant status filter.'),
      limit: z.number().int().min(1).max(200).default(100).describe('Maximum rows to return. Defaults to 100 and cannot exceed 200.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input) => result({ participants: await automationParticipants(env, input) }));

  server.registerTool('get_participant', {
    title: 'Get participant',
    description: 'Return the complete organizer view for one participant, including contact and profile information, sessions, assigned problems, report completion, and incidents.',
    inputSchema: {
      participantId: z.number().int().positive().describe('Internal WTA participant ID returned by list_participants. This is not a Discord user ID.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ participantId }) => {
    const value = await automationParticipant(env, participantId);
    return value ? result(value) : { ...result({ error: 'not_found' }), isError: true };
  });

  server.registerTool('list_rounds', {
    title: 'List rounds and assignments',
    description: 'Return the active cohort’s rounds and one selected round’s opt-ins, pairings, assigned problems, report counts, and re-pair queue. Omit roundNumber to select the current round.',
    inputSchema: {
      roundNumber: z.number().int().min(1).max(52).optional().describe('Human-facing round number, such as 1, 2, or 3. Omit this to use the current round.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ roundNumber }) => result(await automationRounds(env, undefined, roundNumber)));

  server.registerTool('list_problems', {
    title: 'List question bank',
    description: 'Return the complete organizer question bank, including participant-facing statements, interviewer-only hints and solutions, round availability, generated sets, usage, and practice problems. This response can be large.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => result(await automationProblems(env)));

  if (hasAdminScope(principal, 'participants:write')) {
    const statusInput = {
      participantId: z.number().int().positive().describe('Internal WTA participant ID returned by list_participants.'),
      note: z.string().max(500).optional().describe('Optional organizer context written to the audit log.'),
    };
    server.registerTool('pause_participant', {
      title: 'Pause participant',
      description: 'Pause a participant from future matching without deleting history or cancelling existing sessions. Use remove_participant when open sessions must be cancelled and partners re-paired.',
      inputSchema: statusInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ participantId, note }) => {
      const value = await setReversibleAutomationParticipantStatus(env, principal.actorParticipantId, participantId, 'paused', note);
      return value ? result({ ok: true, participant: value }) : { ...result({ error: 'not_found_or_not_changeable' }), isError: true };
    });

    server.registerTool('hold_participant', {
      title: 'Place participant on hold',
      description: 'Place a participant on organizer hold so they are excluded from future matching. This is reversible and does not cancel existing sessions.',
      inputSchema: statusInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ participantId, note }) => {
      const value = await setReversibleAutomationParticipantStatus(env, principal.actorParticipantId, participantId, 'held', note);
      return value ? result({ ok: true, participant: value }) : { ...result({ error: 'not_found_or_not_changeable' }), isError: true };
    });

    server.registerTool('restore_participant', {
      title: 'Restore participant',
      description: 'Return a paused or held participant to active status. This cannot restore removed or completed participants.',
      inputSchema: statusInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ participantId, note }) => {
      const value = await setReversibleAutomationParticipantStatus(env, principal.actorParticipantId, participantId, 'active', note);
      return value ? result({ ok: true, participant: value }) : { ...result({ error: 'not_found_or_not_changeable' }), isError: true };
    });

    server.registerTool('remove_participant', {
      title: 'Remove participant from the program',
      description: 'Remove one participant from the current program while retaining history. This cancels open sessions, deletes unsubmitted forms for those sessions, clears future opt-ins, expires their re-pair requests, queues affected partners for re-pairing, sends notifications, and writes an audit record. Confirm with the organizer before calling.',
      inputSchema: {
        participantId: z.number().int().positive().describe('Internal WTA participant ID returned by list_participants.'),
        reason: z.string().min(1).max(500).describe('Organizer-provided reason stored on the participant and in the audit log.'),
        confirm: z.literal(true).describe('Must be true after the organizer explicitly confirms removal.'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ participantId, reason }) => {
      const value = await removeAutomationParticipant(env, principal.actorParticipantId, participantId, reason);
      return value ? result({ ok: true, participant: value }) : { ...result({ error: 'not_found' }), isError: true };
    });
  }

  if (hasAdminScope(principal, 'problems:write')) {
    server.registerTool('create_problem', {
      title: 'Create question-bank problem',
      description: 'Create a question-bank entry from Markdown and mark it available for specified technical rounds. This writes immediately, but does not add the problem to an already generated round set.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Participant-facing problem title.'),
        difficulty: z.enum(['easy', 'medium', 'hard']).describe('Coarse interview difficulty.'),
        content: z.string().min(1).max(100_000).describe('Markdown containing a required ## Statement section and optional ## Hints and ## Solution sections.'),
        availableRounds: z.array(z.number().int().min(1).max(52)).min(1).describe('Technical round numbers in which the problem may be assigned, usually 1, 2, or 3.'),
        source: z.string().max(50).default('manual').describe('Source label such as leetcode or manual.'),
        number: z.number().int().positive().optional().describe('Optional source problem number, such as a LeetCode number.'),
        url: z.string().url().max(1000).optional().describe('Optional canonical source URL.'),
        difficultyRank: z.number().optional().describe('Optional finer-grained numeric difficulty used for balancing.'),
        active: z.boolean().default(true).describe('Whether the problem is eligible for future generated sets.'),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (input) => {
      const value = await createAutomationProblem(env, principal.actorParticipantId, {
        ...input,
        availableWeeks: input.availableRounds,
      });
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
