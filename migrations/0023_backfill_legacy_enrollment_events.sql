-- Enrollment funnel tracking was introduced after the first participants had
-- already completed intake. Reconstruct their three funnel stages at the
-- participant creation time so they appear in the activity history without
-- pretending that we know a more precise legacy timeline.

INSERT INTO enrollment_events
  (discord_id, discord_username, guild_id, event_type, source, flow, external_id, created_at)
SELECT p.discord_id, p.discord_username, NULL, 'link_generated', 'web', 'enrollment', NULL, p.created_at
FROM participants p
WHERE p.topics IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM enrollment_events e
    WHERE e.discord_id = p.discord_id
      AND e.event_type = 'link_generated'
      AND e.flow = 'enrollment'
  );

INSERT INTO enrollment_events
  (discord_id, discord_username, guild_id, event_type, source, flow, external_id, created_at)
SELECT p.discord_id, p.discord_username, NULL, 'form_opened', 'web', 'enrollment', NULL, p.created_at
FROM participants p
WHERE p.topics IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM enrollment_events e
    WHERE e.discord_id = p.discord_id
      AND e.event_type = 'form_opened'
      AND e.flow = 'enrollment'
  );

INSERT INTO enrollment_events
  (discord_id, discord_username, guild_id, event_type, source, flow, external_id, created_at)
SELECT p.discord_id, p.discord_username, NULL, 'enrollment_completed', 'web', 'enrollment', NULL, p.created_at
FROM participants p
WHERE p.topics IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM enrollment_events e
    WHERE e.discord_id = p.discord_id
      AND e.event_type = 'enrollment_completed'
  );
