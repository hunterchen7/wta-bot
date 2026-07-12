import type { Env } from './env';

export type Participant = {
  id: number;
  discord_id: string;
  discord_username: string | null;
  discord_nickname: string | null;
  name: string | null;
  preferred_email: string | null;
  western_email: string | null;
  year: string | null;
  program: string | null;
  opportunities: string | null; // JSON array
  prior_wta: number;
  experience_band: string | null;
  topics: string | null; // JSON array
  blurb: string | null;
  interests: string | null;
  prior_feedback: string | null;
  email_ok: number;
  pairing_excluded: number;
  status: string;
};

export async function getParticipant(env: Env, discordId: string): Promise<Participant | null> {
  return env.DB.prepare('SELECT * FROM participants WHERE discord_id = ?1')
    .bind(discordId)
    .first<Participant>();
}

/** Upserts the given fields for a discord user, creating the row if needed. */
export async function upsertParticipant(
  env: Env,
  discordId: string,
  fields: Partial<Omit<Participant, 'id' | 'discord_id'>>,
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => k);
  const insertCols = ['discord_id', ...cols].join(', ');
  const insertVals = ['?1', ...cols.map((_, i) => `?${i + 2}`)].join(', ');
  const updates = [...cols.map((k, i) => `${k} = ?${i + 2}`), "updated_at = datetime('now')"].join(
    ', ',
  );
  await env.DB.prepare(
    `INSERT INTO participants (${insertCols}) VALUES (${insertVals})
     ON CONFLICT(discord_id) DO UPDATE SET ${updates}`,
  )
    .bind(discordId, ...entries.map(([, v]) => v))
    .run();
}

export async function listParticipants(env: Env): Promise<Participant[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM participants ORDER BY created_at, id',
  ).all<Participant>();
  return results;
}

const CSV_COLUMNS = [
  'discord_id',
  'discord_username',
  'discord_nickname',
  'name',
  'preferred_email',
  'western_email',
  'year',
  'program',
  'opportunities',
  'prior_wta',
  'experience_band',
  'topics',
  'email_ok',
  'pairing_excluded',
  'status',
] as const;

export function participantsToCsv(rows: Participant[]): string {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => escape(row[c])).join(','));
  }
  return lines.join('\n') + '\n';
}
