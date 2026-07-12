import { Hono } from 'hono';
import type { Env } from '../env';
import { verifyFormToken } from '../forms/token';

// External form rail (DESIGN.md §5, §10): server-rendered HTML from this same
// Worker. M3 fills in the real templates per form kind; M0 verifies tokens and
// serves placeholders so the plumbing is provable end-to-end.

export const forms = new Hono<{ Bindings: Env }>();

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · WTA</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  .card { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 12px; padding: 1.5rem; }
</style>
</head>
<body><div class="card"><h1>${title}</h1>${body}</div></body>
</html>`;

forms.get('/f/:token', async (c) => {
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.html(page('Not configured', '<p>Form rail is not configured yet.</p>'), 503);

  const result = await verifyFormToken(secret, c.req.param('token'));
  if (!result) {
    return c.html(page('Link invalid or expired', '<p>Ask the bot for a fresh link via <code>/status</code> in Discord.</p>'), 404);
  }
  // M3: load form_instances row, render the real template for its kind, prefilled.
  return c.html(page('WTA form rail', `<p>Token OK — instance #${result.instanceId}. Real forms arrive in M3.</p>`));
});

forms.post('/f/:token', (c) => c.text('form submission not implemented yet (M3)', 501));

forms.get('/p/:token', (c) => c.text('interviewer packet pages not implemented yet (M5)', 501));
