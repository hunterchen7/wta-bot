import { Hono } from 'hono';
import type { Env } from '../env';
import { verifyToken } from '../forms/token';
import { listParticipants, participantsToCsv } from '../participants';

// Signed one-time-style export links issued by /export (10-minute expiry).
export const exportRoutes = new Hono<{ Bindings: Env }>();

exportRoutes.get('/export/:token', async (c) => {
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.text('not configured', 503);

  const result = await verifyToken(secret, c.req.param('token'));
  if (result?.subject !== 'export:participants') return c.text('link invalid or expired', 404);

  const csv = participantsToCsv(await listParticipants(c.env));
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="wta-participants.csv"',
  });
});
