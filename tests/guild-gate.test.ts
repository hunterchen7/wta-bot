import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { asUser, makeSigner, sendInteraction, type Signer } from './helpers';

const HOME = '100200300';
const FOREIGN = '999888777';

const joinFrom = (guildId?: string) => ({
  type: 2,
  id: '1',
  token: 't',
  data: { name: 'join' },
  ...(guildId ? { guild_id: guildId } : {}),
  ...asUser('555'),
});

let signer: Signer;
beforeAll(async () => {
  signer = await makeSigner();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guild allowlist gate', () => {
  it('allows the home guild', async () => {
    const res = await sendInteraction(signer, joinFrom(HOME), { ALLOWED_GUILD_IDS: `${HOME}, 42` });
    expect(((await res.json()) as any).type).toBe(4); // enrollment link is issued
  });

  it('allows DMs regardless of allowlist', async () => {
    const dm = { ...joinFrom(undefined), member: undefined, user: { id: '555', username: 'u' } };
    const res = await sendInteraction(signer, dm, { ALLOWED_GUILD_IDS: HOME });
    expect(((await res.json()) as any).type).toBe(4);
  });

  it('allows everything when unconfigured (pre-setup)', async () => {
    const res = await sendInteraction(signer, joinFrom(FOREIGN), { ALLOWED_GUILD_IDS: '' });
    expect(((await res.json()) as any).type).toBe(4);
  });

  it('refuses foreign guilds, writes nothing, and leaves', async () => {
    const calls: Array<{ method?: string; url: string }> = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://discord.com/')) {
        calls.push({ method: init?.method ?? (input as Request).method, url });
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return realFetch(input as any, init);
    });

    const res = await sendInteraction(signer, joinFrom(FOREIGN), {
      ALLOWED_GUILD_IDS: HOME,
      DISCORD_TOKEN: 'test-token',
    });
    const json = (await res.json()) as any;
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(json.data.content).toContain('private program');

    // no participant row was created
    const row = await env.DB.prepare('SELECT * FROM participants WHERE discord_id = ?1')
      .bind('555')
      .first();
    expect(row).toBeNull();

    // and the bot left the foreign guild
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: 'DELETE',
        url: `https://discord.com/api/v10/users/@me/guilds/${FOREIGN}`,
      });
    });
  });

  it('still pongs PINGs no matter what', async () => {
    const res = await sendInteraction(signer, { type: 1, guild_id: FOREIGN }, { ALLOWED_GUILD_IDS: HOME });
    expect(await res.json()).toEqual({ type: 1 });
  });
});
