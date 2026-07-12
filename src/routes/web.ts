import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { getSetting, getSettings } from '../config';
import { DiscordRest } from '../discord/rest';
import { sendEmail } from '../email';
import { maybeMarkEligible } from '../engine/reports';
import { creditsOf, strikesOf } from '../engine/progress';
import { activeCohort, cohortWeeks } from '../engine/weeks';
import type { Env } from '../env';
import { esc, page } from '../forms/render';
import { signToken, verifyToken } from '../forms/token';
import { discordTime, formatToronto } from '../time';

// Authenticated dashboard (DESIGN task: email-code login). Students see their
// own progress; organizers additionally get roster / week board / reviews /
// problem editor. Auth: 6-digit email OTP -> signed HttpOnly cookie (7d).
// Organizer-ness is checked against the Discord organizer role at login time.

export const web = new Hono<{ Bindings: Env }>();

const COOKIE = 'wta_sess';
const CODE_TTL_MIN = 10;
const SESSION_DAYS = 7;

export async function hashLoginCode(participantId: number, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${participantId}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type SessionUser = { participantId: number; organizer: boolean };

async function sessionFrom(c: any): Promise<SessionUser | null> {
  const secret = c.env.FORM_SIGNING_SECRET;
  const raw = getCookie(c, COOKIE);
  if (!secret || !raw) return null;
  const verified = await verifyToken(secret, raw);
  const m = verified && /^sess:(\d+):([01])$/.exec(verified.subject);
  if (!m) return null;
  return { participantId: Number(m[1]), organizer: m[2] === '1' };
}

const nav = (user: SessionUser) =>
  `<nav class="top">
    <a href="/dashboard">My progress</a>
    ${user.organizer ? `<a href="/dashboard/roster">Roster</a><a href="/dashboard/week">Week board</a><a href="/dashboard/reviews">Reviews</a><a href="/dashboard/problems">Problems</a>` : ''}
    <form method="POST" action="/logout" style="margin-left:auto"><button class="btn ghost" style="padding:.2rem .8rem">Log out</button></form>
  </nav>`;

// ---------------------------------------------------------------------------
// Login

web.get('/login', (c) =>
  c.html(
    page(
      'Log in',
      `<h1>WTA dashboard</h1>
       <p class="sub">Enter the email you signed up with — we'll send a 6-digit code.</p>
       <form method="POST" action="/login" class="card">
         <label class="f" for="email">Email</label>
         <input type="email" id="email" name="email" required placeholder="you@example.com">
         <p style="margin-top:1rem"><button type="submit">Send code</button></p>
       </form>`,
    ),
  ),
);

web.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? '').trim().toLowerCase();
  const p = await c.env.DB.prepare(
    'SELECT id, preferred_email, name FROM participants WHERE lower(preferred_email) = ?1',
  )
    .bind(email)
    .first<{ id: number; preferred_email: string; name: string | null }>();

  // Uniform response regardless of membership (no account enumeration).
  const sent = page(
    'Check your email',
    `<h1>Check your email 📬</h1>
     <p class="sub">If <b>${esc(email)}</b> is on the roster, a 6-digit code is on its way (valid ${CODE_TTL_MIN} minutes).</p>
     <form method="POST" action="/login/code" class="card">
       <input type="hidden" name="email" value="${esc(email)}">
       <label class="f" for="code">Code</label>
       <input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" required placeholder="123456">
       <p style="margin-top:1rem"><button type="submit">Log in</button></p>
     </form>`,
  );
  if (!p) return c.html(sent);

  // Rate limit: max 3 live codes per participant per 15 minutes.
  const recent = await c.env.DB.prepare(
    `SELECT count(*) AS n FROM login_codes WHERE participant_id = ?1 AND created_at > ?2`,
  )
    .bind(p.id, new Date(Date.now() - 15 * 60_000).toISOString())
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 3) return c.html(sent);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await c.env.DB.prepare(
    `INSERT INTO login_codes (participant_id, code_hash, expires_at) VALUES (?1, ?2, ?3)`,
  )
    .bind(p.id, await hashLoginCode(p.id, code), new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString())
    .run();
  // Direct send (not the outbox) — logins can't wait for the next cron tick.
  await sendEmail(
    c.env,
    p.preferred_email,
    `${code} is your WTA dashboard code`,
    `Hi ${p.name ?? 'there'},\n\nYour WTA dashboard login code is: ${code}\nIt expires in ${CODE_TTL_MIN} minutes. If you didn't request this, ignore it.\n\n— Western Tech Alumni`,
  ).catch((err) => console.error('otp send failed:', err));

  return c.html(sent);
});

web.post('/login/code', async (c) => {
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.text('not configured', 503);
  const body = await c.req.parseBody();
  const email = String(body.email ?? '').trim().toLowerCase();
  const code = String(body.code ?? '').trim();
  const p = await c.env.DB.prepare(
    'SELECT id, discord_id FROM participants WHERE lower(preferred_email) = ?1',
  )
    .bind(email)
    .first<{ id: number; discord_id: string }>();
  const fail = () =>
    c.html(
      page('Try again', `<h1>That code didn't work</h1><p class="sub">Codes expire after ${CODE_TTL_MIN} minutes and 5 attempts. <a href="/login">Request a fresh one</a>.</p>`),
      400,
    );
  if (!p || !/^\d{6}$/.test(code)) return fail();

  const row = await c.env.DB.prepare(
    `SELECT id, code_hash, attempts FROM login_codes
     WHERE participant_id = ?1 AND used_at IS NULL AND expires_at > ?2
     ORDER BY id DESC LIMIT 1`,
  )
    .bind(p.id, new Date().toISOString())
    .first<{ id: number; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= 5) return fail();

  if (row.code_hash !== (await hashLoginCode(p.id, code))) {
    await c.env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?1')
      .bind(row.id)
      .run();
    return fail();
  }
  await c.env.DB.prepare('UPDATE login_codes SET used_at = ?2 WHERE id = ?1')
    .bind(row.id, new Date().toISOString())
    .run();

  const organizer = isWhitelistedAdmin(c.env, email) || (await checkOrganizer(c.env, p.discord_id));
  const token = await signToken(
    secret,
    `sess:${p.id}:${organizer ? 1 : 0}`,
    new Date(Date.now() + SESSION_DAYS * 86400_000),
  );
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
  return c.redirect('/dashboard');
});

web.post('/logout', (c) => {
  setCookie(c, COOKIE, '', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 0 });
  return c.redirect('/login');
});

/** Primary organizer gate for the web: a simple email whitelist (var
 *  DASHBOARD_ADMINS). The Discord-role check below is the fallback. */
export function isWhitelistedAdmin(env: Env, email: string): boolean {
  return (env.DASHBOARD_ADMINS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

async function checkOrganizer(env: Env, discordId: string): Promise<boolean> {
  const roleId = await getSetting(env, 'organizer_role_id');
  const guildId = env.ALLOWED_GUILD_IDS?.split(',')[0]?.trim();
  const token = env.DISCORD_TOKEN;
  if (!roleId || !guildId || !token) return false;
  try {
    const member = await new DiscordRest(token).getGuildMember(guildId, discordId);
    return member.roles.includes(roleId);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Views

web.get('/dashboard', async (c) => {
  const user = await sessionFrom(c);
  if (!user) return c.redirect('/login');
  const p = await c.env.DB.prepare('SELECT * FROM participants WHERE id = ?1')
    .bind(user.participantId)
    .first<any>();
  if (!p) return c.redirect('/login');

  const credits = await creditsOf(c.env, p.id);
  const strikes = await strikesOf(c.env, p.id);
  const bar = (n: number) => '▰'.repeat(Math.min(n, 3)) + '▱'.repeat(Math.max(0, 3 - n));

  const { results: sessions } = await c.env.DB.prepare(
    `SELECT s.*, w.idx, pi.name AS interviewer_name, pe.name AS interviewee_name
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE (s.interviewer_id = ?1 OR s.interviewee_id = ?1)
     ORDER BY w.idx, s.id`,
  )
    .bind(p.id)
    .all<any>();

  const secret = c.env.FORM_SIGNING_SECRET!;
  const { results: owed } = await c.env.DB.prepare(
    `SELECT id, kind, deadline_at FROM form_instances WHERE assignee_id = ?1 AND submitted_at IS NULL`,
  )
    .bind(p.id)
    .all<any>();
  const owedLinks = await Promise.all(
    owed.map(async (f: any) => {
      const t = await signToken(secret, `f:${f.id}`, new Date(new Date(f.deadline_at).getTime() + 7 * 86400_000));
      return `<li><a href="/f/${t}">${esc(f.kind.replace('_', ' '))}</a> — due ${esc(formatToronto(f.deadline_at))}</li>`;
    }),
  );

  const body = `
    ${nav(user)}
    <h1>Hey ${esc(p.name ?? 'there')} 👋</h1>
    <p class="sub">Status: <span class="tag">${esc(p.status)}</span>${strikes ? ` · ⚠️ ${strikes} strike(s)` : ''}${p.status === 'completed' ? ' · 🏆 alumni-round eligible!' : ''}</p>
    <div class="card">
      <b>Interviewer</b> ${bar(credits.interviewer)} ${credits.interviewer}/3<br>
      <b>Interviewee</b> ${bar(credits.interviewee)} ${credits.interviewee}/3
    </div>
    ${owed.length ? `<div class="err"><b>Reports you owe:</b><ul>${owedLinks.join('')}</ul></div>` : '<div class="ok">No reports owed ✅</div>'}
    <h2>Your sessions</h2>
    <div class="card"><table>
      <tr><th>Week</th><th>Session</th><th>When</th><th>State</th></tr>
      ${sessions
        .map(
          (s: any) => `<tr>
        <td>W${s.idx}</td>
        <td>${s.interviewer_id === p.id ? `you → ${esc(s.interviewee_name ?? '?')}` : `${esc(s.interviewer_name ?? '?')} → you`}</td>
        <td>${s.scheduled_at ? esc(formatToronto(s.scheduled_at)) : '—'}</td>
        <td><span class="tag">${esc(s.state)}</span></td></tr>`,
        )
        .join('')}
    </table></div>`;
  return c.html(page('My progress', body));
});

const requireOrganizer = async (c: any): Promise<SessionUser | Response> => {
  const user = await sessionFrom(c);
  if (!user) return c.redirect('/login');
  if (!user.organizer) return c.html(page('Organizers only', `${nav(user)}<h1>Organizers only</h1>`), 403);
  return user;
};

web.get('/dashboard/roster', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const { results } = await c.env.DB.prepare('SELECT * FROM participants ORDER BY id').all<any>();
  const rows = await Promise.all(
    results.map(async (p: any) => {
      const cr = await creditsOf(c.env, p.id);
      const st = await strikesOf(c.env, p.id);
      return `<tr><td>${esc(p.name ?? '')}</td><td><code>${esc(p.discord_id)}</code></td>
        <td>${esc(p.preferred_email ?? '')}</td><td>${esc(p.year ?? '')} ${esc(p.program ?? '')}</td>
        <td>${cr.interviewer}/3 · ${cr.interviewee}/3</td><td>${st || ''}</td>
        <td><span class="tag">${esc(p.status)}</span>${p.email_ok ? ' 📧' : ''}</td></tr>`;
    }),
  );
  const body = `${nav(gate)}<h1>Roster (${results.length})</h1>
    <div class="card"><table>
    <tr><th>Name</th><th>Discord</th><th>Email</th><th>Program</th><th>Credits</th><th>Strikes</th><th>Status</th></tr>
    ${rows.join('')}</table></div>`;
  return c.html(page('Roster', body, { wide: true }));
});

web.get('/dashboard/week', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const cohort = await activeCohort(c.env);
  if (!cohort) return c.html(page('Week board', `${nav(gate)}<h1>No active cohort</h1>`));
  const weeks = await cohortWeeks(c.env, cohort.id);
  const now = Date.now();
  const current = [...weeks].reverse().find((w) => now >= new Date(w.optin_opens_at).getTime()) ?? weeks[0]!;
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, pi.name AS a, pe.name AS b,
       (SELECT count(*) FROM form_instances f WHERE f.session_id = s.id AND f.submitted_at IS NOT NULL) AS reports_in
     FROM sessions s
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.week_id = ?1 ORDER BY s.id`,
  )
    .bind(current.id)
    .all<any>();
  const optins = await c.env.DB.prepare('SELECT count(*) AS n FROM optins WHERE week_id = ?1')
    .bind(current.id)
    .first<any>();
  const body = `${nav(gate)}<h1>Week ${current.idx} board</h1>
    <p class="sub">${optins?.n ?? 0} opted in · ${results.length} sessions · matched ${esc(formatToronto(current.match_at))}</p>
    <div class="card"><table>
    <tr><th>#</th><th>Interviewer → Interviewee</th><th>When</th><th>State</th><th>Reports</th><th>Review</th></tr>
    ${results
      .map(
        (s: any) => `<tr><td>${s.id}</td><td>${esc(s.a ?? '?')} → ${esc(s.b ?? '?')}${s.origin === 'repair' ? ' 🛠️' : ''}</td>
        <td>${s.scheduled_at ? esc(formatToronto(s.scheduled_at)) : '—'}</td>
        <td><span class="tag">${esc(s.state)}</span></td><td>${s.reports_in}/2</td>
        <td>${s.review_state !== 'none' ? `<span class="tag">${esc(s.review_state)}</span>` : ''}</td></tr>`,
      )
      .join('')}
    </table></div>`;
  return c.html(page('Week board', body, { wide: true }));
});

web.get('/dashboard/reviews', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.review_state, w.idx, pi.name AS interviewer_name, pe.name AS interviewee_name,
       (SELECT payload FROM form_instances f WHERE f.session_id = s.id AND f.kind = 'interviewee_report' AND f.submitted_at IS NOT NULL) AS interviewee_payload,
       (SELECT payload FROM form_instances f WHERE f.session_id = s.id AND f.kind = 'interviewer_report' AND f.submitted_at IS NOT NULL) AS interviewer_payload
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.review_state != 'none' ORDER BY s.review_state = 'pending' DESC, s.id`,
  ).all<any>();
  const rows = results.map((s: any) => {
    const ie = s.interviewee_payload ? JSON.parse(s.interviewee_payload) : {};
    const ir = s.interviewer_payload ? JSON.parse(s.interviewer_payload) : {};
    const actions =
      s.review_state === 'verified'
        ? '✅'
        : `<form method="POST" action="/dashboard/reviews/${s.id}" style="display:inline">
             <button name="action" value="verify">Verify pass</button>
             <button name="action" value="flag" class="btn ghost">Flag 🚩</button>
           </form>`;
    return `<tr><td>#${s.id} W${s.idx}</td>
      <td>${esc(s.interviewer_name ?? '?')} → <b>${esc(s.interviewee_name ?? '?')}</b></td>
      <td>${ie.video_url ? `<a href="${esc(ie.video_url)}" rel="noreferrer">▶ recording</a>` : '<span class="tag">no video!</span>'}</td>
      <td>${esc(ir.verdict ?? '')}: ${esc((ir.verdict_reason ?? '').slice(0, 140))}</td>
      <td><span class="tag">${esc(s.review_state)}</span></td><td>${actions}</td></tr>`;
  });
  const body = `${nav(gate)}<h1>W3 recording reviews</h1>
    <p class="sub">Pass verdicts wait here until a human verifies the recording — verified + 6/6 = alumni-round eligible.</p>
    <div class="card"><table>
    <tr><th>Session</th><th>Pair</th><th>Recording</th><th>Verdict</th><th>State</th><th></th></tr>
    ${rows.join('')}</table></div>`;
  return c.html(page('Reviews', body, { wide: true }));
});

web.post('/dashboard/reviews/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const sessionId = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  const action = String(body.action ?? '');
  if (action !== 'verify' && action !== 'flag') return c.text('bad action', 400);
  await c.env.DB.prepare('UPDATE sessions SET review_state = ?2 WHERE id = ?1')
    .bind(sessionId, action === 'verify' ? 'verified' : 'flagged')
    .run();
  if (action === 'verify') {
    const s = await c.env.DB.prepare('SELECT interviewee_id FROM sessions WHERE id = ?1')
      .bind(sessionId)
      .first<{ interviewee_id: number }>();
    if (s) await maybeMarkEligible(c.env, s.interviewee_id);
  } else {
    const { organizer_channel_id } = await getSettings(c.env, ['organizer_channel_id']);
    if (organizer_channel_id) {
      const { enqueue } = await import('../engine/outbox');
      await enqueue(c.env, 'channel_msg', {
        channelId: organizer_channel_id,
        message: { content: `🚩 Session #${sessionId} recording was **flagged** during review — needs discussion.` },
      });
    }
  }
  return c.redirect('/dashboard/reviews');
});

web.get('/dashboard/problems', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const editId = Number(c.req.query('edit') ?? 0);
  const { results } = await c.env.DB.prepare(
    'SELECT id, number, title, difficulty, difficulty_rank, active, (statement_md IS NOT NULL) AS has_statement, (solution_md IS NOT NULL) AS has_solution FROM problems ORDER BY id DESC',
  ).all<any>();
  let editor = '';
  if (editId) {
    const p = await c.env.DB.prepare('SELECT * FROM problems WHERE id = ?1').bind(editId).first<any>();
    if (p) {
      editor = `<h2>Edit: ${esc(p.title)}</h2>
      <form method="POST" action="/dashboard/problems/${p.id}" class="card">
        <label class="f">Statement (shown on the packet)</label>
        <textarea name="statement_md" class="mono">${esc(p.statement_md ?? '')}</textarea>
        <label class="f">Hint ladder (packet only)</label>
        <textarea name="hints_md">${esc(p.hints_md ?? '')}</textarea>
        <label class="f">Solution notes (packet + released to interviewee after their report)</label>
        <textarea name="solution_md" class="mono">${esc(p.solution_md ?? '')}</textarea>
        <p style="margin-top:1rem"><button>Save</button></p>
      </form>`;
    }
  }
  const body = `${nav(gate)}<h1>Problem bank</h1>${editor}
    <div class="card"><table>
    <tr><th>#</th><th>Title</th><th>Difficulty</th><th>Content</th><th></th></tr>
    ${results
      .map(
        (p: any) => `<tr><td>${esc(p.number ?? '')}</td><td>${esc(p.title)}</td>
        <td>${esc(p.difficulty)}${p.difficulty_rank ? ` (${p.difficulty_rank})` : ''}</td>
        <td>${p.has_statement ? '📄' : ''}${p.has_solution ? '📖' : ''}</td>
        <td><a href="/dashboard/problems?edit=${p.id}">edit</a></td></tr>`,
      )
      .join('')}
    </table></div>`;
  return c.html(page('Problems', body, { wide: true }));
});

web.post('/dashboard/problems/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  await c.env.DB.prepare(
    'UPDATE problems SET statement_md = ?2, hints_md = ?3, solution_md = ?4 WHERE id = ?1',
  )
    .bind(
      id,
      String(body.statement_md ?? '').slice(0, 50000) || null,
      String(body.hints_md ?? '').slice(0, 20000) || null,
      String(body.solution_md ?? '').slice(0, 50000) || null,
    )
    .run();
  return c.redirect(`/dashboard/problems?edit=${id}`);
});
