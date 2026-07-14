import type { Env } from '../env';

export type EnrollmentEventType = 'link_generated' | 'form_opened' | 'enrollment_completed';
export type EnrollmentEventSource = 'join_button' | 'join_command' | 'web';
export type EnrollmentEventFlow = 'enrollment' | 'profile_edit';

type EnrollmentEventInput = {
  discordId: string;
  discordUsername?: string | null;
  guildId?: string | null;
  eventType: EnrollmentEventType;
  source: EnrollmentEventSource;
  flow?: EnrollmentEventFlow;
  externalId?: string | null;
};

export async function logEnrollmentEvent(env: Env, event: EnrollmentEventInput): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO enrollment_events
       (discord_id, discord_username, guild_id, event_type, source, flow, external_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(
    event.discordId,
    event.discordUsername ?? null,
    event.guildId ?? null,
    event.eventType,
    event.source,
    event.flow ?? 'enrollment',
    event.externalId ?? null,
  ).run();
}

export async function enrollmentFunnel(env: Env) {
  const [counts, people, recentLinks] = await Promise.all([
    env.DB.prepare(
      `SELECT
         count(DISTINCT CASE WHEN flow = 'enrollment' AND event_type = 'link_generated' THEN discord_id END) AS generated,
         sum(CASE WHEN flow = 'enrollment' AND event_type = 'link_generated' THEN 1 ELSE 0 END) AS links_issued,
         sum(CASE WHEN event_type = 'link_generated' THEN 1 ELSE 0 END) AS total_links_issued,
         count(DISTINCT CASE WHEN flow = 'enrollment' AND event_type = 'form_opened' THEN discord_id END) AS opened,
         count(DISTINCT CASE WHEN flow = 'enrollment' AND event_type = 'enrollment_completed' THEN discord_id END) AS completed
       FROM enrollment_events`,
    ).first<{ generated: number; links_issued: number; total_links_issued: number; opened: number; completed: number }>(),
    env.DB.prepare(
      `WITH activity AS (
         SELECT discord_id,
                max(discord_username) AS event_username,
                min(CASE WHEN event_type = 'link_generated' THEN created_at END) AS generated_at,
                max(CASE WHEN event_type = 'link_generated' THEN created_at END) AS last_generated_at,
                count(CASE WHEN event_type = 'link_generated' THEN 1 END) AS links_issued,
                min(CASE WHEN event_type = 'form_opened' THEN created_at END) AS opened_at,
                min(CASE WHEN event_type = 'enrollment_completed' THEN created_at END) AS completed_at,
                max(created_at) AS last_event_at
         FROM enrollment_events WHERE flow = 'enrollment' GROUP BY discord_id
       )
       SELECT a.discord_id, coalesce(p.name, p.discord_username, a.event_username, a.discord_id) AS display_name,
              coalesce(p.discord_username, a.event_username) AS discord_username,
              a.generated_at, a.last_generated_at, a.links_issued, a.opened_at, a.completed_at, a.last_event_at,
              CASE WHEN a.completed_at IS NOT NULL THEN 'completed'
                   WHEN a.opened_at IS NOT NULL THEN 'in_progress'
                   ELSE 'link_generated' END AS status
       FROM activity a LEFT JOIN participants p ON p.discord_id = a.discord_id
       ORDER BY a.last_event_at DESC LIMIT 100`,
    ).all<any>(),
    env.DB.prepare(
      `SELECT e.id, e.discord_id, coalesce(p.name, p.discord_username, e.discord_username, e.discord_id) AS display_name,
              coalesce(p.discord_username, e.discord_username) AS discord_username,
              e.source, e.flow, e.created_at
       FROM enrollment_events e LEFT JOIN participants p ON p.discord_id = e.discord_id
       WHERE e.event_type = 'link_generated'
       ORDER BY e.id DESC LIMIT 100`,
    ).all<any>(),
  ]);

  return {
    generated: Number(counts?.generated ?? 0),
    linksIssued: Number(counts?.links_issued ?? 0),
    totalLinksIssued: Number(counts?.total_links_issued ?? 0),
    opened: Number(counts?.opened ?? 0),
    completed: Number(counts?.completed ?? 0),
    people: people.results,
    recentLinks: recentLinks.results,
  };
}
