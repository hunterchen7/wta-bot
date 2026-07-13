import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '../src/forms/token';
import { app } from '../src/index';

const ADMIN_ID = 9901;
const USER_ID = 9902;
let readToken = '';
let writeToken = '';
let readTokenId = 0;

const cookieFor = async (id: number, organizer = true) =>
  `wta_sess=${await signToken(env.FORM_SIGNING_SECRET!, `sess:${id}:${organizer ? 1 : 0}`, new Date(Date.now() + 3600_000))}`;

const bearer = (token: string, method = 'GET', body?: unknown) => ({
  method,
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (id, discord_id, name, preferred_email, topics, status)
     VALUES (?1, 'api-admin-9901', 'API Admin', 'api-admin@example.com', '["dsa"]', 'active'),
            (?2, 'api-user-9902', 'API User', 'api-user@example.com', '["dsa"]', 'active')`,
  ).bind(ADMIN_ID, USER_ID).run();

  const create = async (name: string, scopes: string[]) => {
    const response = await app.request('/api/admin/api-tokens', {
      method: 'POST',
      headers: { Cookie: await cookieFor(ADMIN_ID), Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes, expiresInDays: 30 }),
    }, { ...env, PUBLIC_ORIGIN: 'https://wta.example' });
    expect(response.status).toBe(201);
    return response.json<any>();
  };
  const read = await create('Read automation', ['admin:read']);
  const write = await create('Write automation', ['admin:read', 'participants:write', 'problems:write']);
  readToken = read.token;
  readTokenId = read.id;
  writeToken = write.token;
});

describe('security boundaries', () => {
  it('does not trust an organizer bit forged for a normal participant', async () => {
    const response = await app.request('/api/admin/overview', {
      headers: { Cookie: await cookieFor(USER_ID) },
    }, env);
    expect(response.status).toBe(403);
  });

  it('rejects cross-origin browser mutations carrying a session cookie', async () => {
    const response = await app.request('/api/admin/settings', {
      method: 'POST',
      headers: { Cookie: await cookieFor(ADMIN_ID), Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: {} }),
    }, { ...env, PUBLIC_ORIGIN: 'https://wta.example' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden_origin' });
  });

  it('does not disclose whether an unknown login email is enrolled', async () => {
    const response = await app.request('/api/auth/request-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'missing@example.com' }),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ ok: true, email: 'missing@example.com' });
  });
});

describe('versioned admin automation API', () => {
  it('creates, reveals, and immediately resets an organizer-owned MCP token', async () => {
    const organizerCookie = await cookieFor(ADMIN_ID);
    const request = (path: string, method = 'GET') => app.request(`/api/admin${path}`, {
      method,
      headers: { Cookie: organizerCookie, Origin: 'http://localhost' },
    }, { ...env, PUBLIC_ORIGIN: 'https://wta.example' });

    const empty = await request('/mcp-token');
    expect(empty.status).toBe(200);
    expect(await empty.json<any>()).toMatchObject({ mcpUrl: 'https://wta.example/mcp', token: null, credential: null });

    const created = await request('/mcp-token/reset', 'POST');
    expect(created.status).toBe(201);
    const first = await created.json<any>();
    expect(first.token).toMatch(/^wta_admin_[A-Za-z0-9_-]{40,}$/);

    const stored = await env.DB.prepare(
      "SELECT token_hash, token_ciphertext FROM admin_api_tokens WHERE actor_participant_id = ?1 AND purpose = 'personal_mcp' AND revoked_at IS NULL",
    ).bind(ADMIN_ID).first<{ token_hash: string; token_ciphertext: string }>();
    expect(stored?.token_hash).not.toContain(first.token);
    expect(stored?.token_ciphertext).not.toContain(first.token);

    const revealed = await request('/mcp-token');
    expect(await revealed.json<any>()).toMatchObject({ token: first.token, credential: { id: first.credential.id } });
    expect((await app.request('/api/admin/v1/overview', bearer(first.token), env)).status).toBe(200);

    const reset = await request('/mcp-token/reset', 'POST');
    const second = await reset.json<any>();
    expect(second.token).not.toBe(first.token);
    expect((await app.request('/api/admin/v1/overview', bearer(first.token), env)).status).toBe(401);
    expect((await app.request('/api/admin/v1/overview', bearer(second.token), env)).status).toBe(200);
  });

  it('requires bearer authentication and enforces token scopes', async () => {
    expect((await app.request('/api/admin/v1/overview', {}, env)).status).toBe(401);
    expect((await app.request(`/api/admin/v1/participants/${USER_ID}/status`, bearer(readToken, 'PATCH', { status: 'paused' }), env)).status).toBe(403);

    const updated = await app.request(
      `/api/admin/v1/participants/${USER_ID}/status`,
      bearer(writeToken, 'PATCH', { status: 'paused', note: 'API test' }),
      env,
    );
    expect(updated.status).toBe(200);
    expect(await env.DB.prepare('SELECT status FROM participants WHERE id = ?1').bind(USER_ID).first()).toEqual({ status: 'paused' });
  });

  it('supports roster search and problem creation without accepting SQL', async () => {
    const roster = await app.request('/api/admin/v1/participants?search=api%20user', bearer(readToken), env);
    expect(roster.status).toBe(200);
    expect((await roster.json<any>()).participants).toEqual([
      expect.objectContaining({ id: USER_ID, name: 'API User', status: 'paused' }),
    ]);

    const created = await app.request('/api/admin/v1/problems', bearer(writeToken, 'POST', {
      title: 'Automation Test Problem', difficulty: 'easy', availableWeeks: [1],
      content: '## Statement\n\nReturn the input.\n\n## Solution\n\nReturn it directly.',
    }), env);
    expect(created.status).toBe(201);
    expect(await created.json<any>()).toMatchObject({ ok: true, problem: { title: 'Automation Test Problem' } });
  });

  it('revokes a token immediately', async () => {
    const response = await app.request(`/api/admin/api-tokens/${readTokenId}`, {
      method: 'DELETE', headers: { Cookie: await cookieFor(ADMIN_ID), Origin: 'http://localhost' },
    }, { ...env, PUBLIC_ORIGIN: 'https://wta.example' });
    expect(response.status).toBe(200);
    expect((await app.request('/api/admin/v1/overview', bearer(readToken), env)).status).toBe(401);
  });
});

describe('MCP server', () => {
  const mcp = (body: unknown, token = writeToken) => app.request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify(body),
  }, { ...env, PUBLIC_ORIGIN: 'http://localhost' });

  it('requires a token and completes MCP initialization', async () => {
    expect((await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }, 'bad')).status).toBe(401);
    const response = await mcp({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'vitest', version: '1.0' } },
    });
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ result: { serverInfo: { name: 'wta-admin', version: '1.0.0' } } });
  });

  it('lists scoped tools and invokes a read tool', async () => {
    const listed = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(listed.status).toBe(200);
    expect((await listed.json<any>()).result.tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining([
      'get_overview', 'list_participants', 'get_participant', 'list_rounds', 'list_problems',
      'set_participant_status', 'create_problem',
    ]));
    const called = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_overview', arguments: {} } });
    expect(called.status).toBe(200);
    expect((await called.json<any>()).result.content[0].text).toContain('participants');
  });
});
