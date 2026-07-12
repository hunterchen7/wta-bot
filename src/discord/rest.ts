// Minimal Discord REST client for outbound calls (DMs, threads, announcements).
// Used by cron jobs and form-submit side effects; interactions themselves are
// answered inline in the webhook response.

const API = 'https://discord.com/api/v10';

export class DiscordRest {
  constructor(private token: string) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Discord ${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  /** DM a user. Throws on failure (e.g. user blocks server DMs) — callers
   *  catch and fall back to email/channel ping per DESIGN.md §7. */
  async dm(userId: string, message: { content?: string; embeds?: unknown[]; components?: unknown[] }) {
    const channel = await this.request<{ id: string }>('POST', '/users/@me/channels', {
      recipient_id: userId,
    });
    return this.request('POST', `/channels/${channel.id}/messages`, message);
  }

  /** Leave a guild the bot shouldn't be in (public app + private program). */
  async leaveGuild(guildId: string) {
    return this.request('DELETE', `/users/@me/guilds/${guildId}`);
  }
}
