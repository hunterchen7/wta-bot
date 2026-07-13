import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ADMINISTRATOR, MANAGE_GUILD } from '../src/discord/types';
import { isCurrentOrganizer } from '../src/organizers';

const OWNER_ID = 99401;
const ADMIN_ID = 99402;
const MANAGER_ID = 99403;
const ROLE_ID = 99404;
const MEMBER_ID = 99405;
const GUILD_ID = 'organizer-test-guild';

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (id, discord_id, name, preferred_email, status)
     VALUES (?1, 'discord-owner', 'Guild Owner', 'owner-role-test@example.com', 'active'),
            (?2, 'discord-admin', 'Guild Admin', 'admin-role-test@example.com', 'active'),
            (?3, 'discord-manager', 'Guild Manager', 'manager-role-test@example.com', 'active'),
            (?4, 'discord-role', 'Configured Role', 'configured-role-test@example.com', 'active'),
            (?5, 'discord-member', 'Regular Member', 'member-role-test@example.com', 'active')`,
  ).bind(OWNER_ID, ADMIN_ID, MANAGER_ID, ROLE_ID, MEMBER_ID).run();
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('organizer_role_id', 'configured-organizer-role')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run();
});

afterEach(() => vi.unstubAllGlobals());

describe('current organizer revalidation', () => {
  it.each([
    [OWNER_ID, 'discord-owner', [], true],
    [ADMIN_ID, 'discord-admin', ['administrator-role'], true],
    [MANAGER_ID, 'discord-manager', ['manager-role'], true],
    [ROLE_ID, 'discord-role', ['configured-organizer-role'], true],
    [MEMBER_ID, 'discord-member', [], false],
  ])('matches Discord organizer semantics for participant %s', async (participantId, discordId, memberRoles, expected) => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/members/${discordId}`)) return json({ roles: memberRoles, user: { id: discordId, username: discordId } });
      if (url.endsWith(`/guilds/${GUILD_ID}`)) return json({ id: GUILD_ID, owner_id: 'discord-owner' });
      if (url.endsWith(`/guilds/${GUILD_ID}/roles`)) return json([
        { id: GUILD_ID, permissions: '0' },
        { id: 'administrator-role', permissions: String(ADMINISTRATOR) },
        { id: 'manager-role', permissions: String(MANAGE_GUILD) },
        { id: 'configured-organizer-role', permissions: '0' },
      ]);
      return new Response('not found', { status: 404 });
    });

    expect(await isCurrentOrganizer({
      ...env,
      DASHBOARD_ADMINS: '',
      ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_TOKEN: 'test-token',
    }, participantId)).toBe(expected);
  });
});

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}
