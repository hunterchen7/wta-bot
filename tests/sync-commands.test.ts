import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncCommands } from '../src/cron';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDiscord() {
  const calls: Array<{ method?: string; url: string; body?: string }> = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://discord.com/')) {
      calls.push({ method: init?.method, url, body: init?.body as string });
      return Promise.resolve(new Response('[]', { status: 200 }));
    }
    return realFetch(input as any, init);
  });
  return calls;
}

describe('syncCommands', () => {
  it('skips when credentials are absent', async () => {
    const calls = stubDiscord();
    expect(await syncCommands({ ...env, DISCORD_TOKEN: undefined })).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('pushes definitions once, then reports unchanged', async () => {
    const calls = stubDiscord();
    const testEnv = { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: '123' };

    expect(await syncCommands(testEnv)).toBe('synced');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: 'https://discord.com/api/v10/applications/123/commands',
    });
    expect(calls[0]!.body).toContain('"join"');

    // second run: definitions unchanged -> no API call
    expect(await syncCommands(testEnv)).toBe('unchanged');
    expect(calls).toHaveLength(1);
  });

  it('re-syncs when stored definitions drift', async () => {
    const calls = stubDiscord();
    const testEnv = { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: '123' };
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('commands_json', '[]') ON CONFLICT(key) DO UPDATE SET value = '[]'",
    ).run();

    expect(await syncCommands(testEnv)).toBe('synced');
    expect(calls).toHaveLength(1);
  });

  it('does not store the hash when Discord rejects the push', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://discord.com/')) {
        return Promise.resolve(new Response('bad', { status: 401 }));
      }
      return realFetch(input as any, init);
    });
    const testEnv = { ...env, DISCORD_TOKEN: 'bad', DISCORD_APP_ID: '123' };
    await env.DB.prepare("DELETE FROM settings WHERE key = 'commands_json'").run();
    await expect(syncCommands(testEnv)).rejects.toThrow('401');
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'commands_json'")
      .first();
    expect(row).toBeNull();
  });
});
