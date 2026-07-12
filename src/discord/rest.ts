// Minimal Discord REST client for outbound calls (DMs, threads, announcements,
// roles). Used by cron jobs and interaction side effects; interactions
// themselves are answered inline in the webhook response.

const API = 'https://discord.com/api/v10';

export type MessagePayload = {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  allowed_mentions?: { parse?: string[]; users?: string[]; roles?: string[] };
};

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
    if (res.status === 429) {
      // Basic rate-limit respect: wait and retry once.
      const retryAfter = Number((await res.clone().json().catch(() => ({})) as any).retry_after ?? 1);
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
      return this.request(method, path, body);
    }
    if (!res.ok) {
      throw new Error(`Discord ${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  /** DM a user. Throws on failure (e.g. user blocks server DMs) — callers
   *  catch and fall back to email/channel ping per DESIGN.md §7. */
  async dm(userId: string, message: MessagePayload) {
    const channel = await this.request<{ id: string }>('POST', '/users/@me/channels', {
      recipient_id: userId,
    });
    return this.request<{ id: string }>('POST', `/channels/${channel.id}/messages`, message);
  }

  async send(channelId: string, message: MessagePayload) {
    return this.request<{ id: string }>('POST', `/channels/${channelId}/messages`, message);
  }

  async editMessage(channelId: string, messageId: string, message: MessagePayload) {
    return this.request('PATCH', `/channels/${channelId}/messages/${messageId}`, message);
  }

  /** Create a thread (private where allowed; falls back to public). Mentioning
   *  users in the first message auto-adds them to a private thread. */
  async createThread(channelId: string, name: string, opts: { private?: boolean } = {}) {
    try {
      return await this.request<{ id: string }>('POST', `/channels/${channelId}/threads`, {
        name: name.slice(0, 100),
        type: opts.private === false ? 11 : 12, // 12 private, 11 public
        invitable: true,
        auto_archive_duration: 10080, // 7 days
      });
    } catch (err) {
      if (opts.private !== false) {
        // Private threads can be gated by server features — fall back to public.
        return this.request<{ id: string }>('POST', `/channels/${channelId}/threads`, {
          name: name.slice(0, 100),
          type: 11,
          auto_archive_duration: 10080,
        });
      }
      throw err;
    }
  }

  async addRole(guildId: string, userId: string, roleId: string) {
    return this.request('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  async getGuildMember(guildId: string, userId: string) {
    return this.request<{ roles: string[]; user: { id: string } }>(
      'GET',
      `/guilds/${guildId}/members/${userId}`,
    );
  }

  /** Paginated member list — requires the Server Members intent to be enabled
   *  on the application (instant toggle under 10k members). */
  async listAllMembers(guildId: string): Promise<Array<{ user: { id: string; bot?: boolean }; roles: string[] }>> {
    const all: Array<{ user: { id: string; bot?: boolean }; roles: string[] }> = [];
    let after = '0';
    for (let page = 0; page < 30; page++) {
      const batch = await this.request<Array<{ user: { id: string; bot?: boolean }; roles: string[] }>>(
        'GET',
        `/guilds/${guildId}/members?limit=1000&after=${after}`,
      );
      all.push(...batch);
      if (batch.length < 1000) break;
      after = batch[batch.length - 1]!.user.id;
    }
    return all;
  }

  /** Leave a guild the bot shouldn't be in (public app + private program). */
  async leaveGuild(guildId: string) {
    return this.request('DELETE', `/users/@me/guilds/${guildId}`);
  }

  /** Set a member's server nickname. Requires Manage Nicknames + role
   *  hierarchy; always fails for the guild owner (Discord restriction). */
  async setNickname(guildId: string, userId: string, nick: string) {
    return this.request('PATCH', `/guilds/${guildId}/members/${userId}`, { nick });
  }
}
