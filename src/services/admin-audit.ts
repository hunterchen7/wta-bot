import type { Env } from '../env';

export async function writeAdminAudit(
  env: Env,
  actorId: number,
  action: string,
  targetType?: string,
  targetId?: string | number,
  detail?: unknown,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (actor_participant_id, action, target_type, target_id, detail)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(
    actorId,
    action,
    targetType ?? null,
    targetId == null ? null : String(targetId),
    detail == null ? null : JSON.stringify(detail),
  ).run();
}
