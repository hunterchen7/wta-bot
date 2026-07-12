import type { Env } from './env';

// Server-specific configuration lives in the settings table, written by
// /setup and read everywhere. Keys are typed here so usage stays greppable.

export type SettingKey =
  | 'announce_channel_id' // weekly opt-in + pairing announcements
  | 'organizer_channel_id' // digests, case files, enrollment feed
  | 'threads_channel_id' // parent channel for session threads
  | 'start_here_channel_id' // verification panel lives here
  | 'intro_channel_id' // optional: verified intros get posted here
  | 'member_role_id' // granted by the verify gate
  | 'participant_role_id' // granted on completed enrollment
  | 'organizer_role_id' // dashboard organizer check + admin surfaces
  | 'commands_json' // syncCommands bookkeeping
  | 'verify_panel_message_id'
  | 'category_id' // current year's category (bootstrap renames it on archive)
  | 'packet_mode'; // 'on' enables private T-24h interviewer packets (future feature; default off = open question bank)

export async function getSetting(env: Env, key: SettingKey): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: SettingKey, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2',
  )
    .bind(key, value)
    .run();
}

export async function getSettings(
  env: Env,
  keys: SettingKey[],
): Promise<Partial<Record<SettingKey, string>>> {
  const placeholders = keys.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
  )
    .bind(...keys)
    .all<{ key: SettingKey; value: string }>();
  const out: Partial<Record<SettingKey, string>> = {};
  for (const r of results) out[r.key] = r.value;
  return out;
}
