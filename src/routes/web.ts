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
import { BLURB_MIN_CHARS, EXPERIENCE, OPPORTUNITIES, PROGRAMS, TOPICS, YEARS } from '../intake';
import { updateParticipantSettings } from '../services/participant-settings';

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

export type SessionUser = { participantId: number; organizer: boolean };

export async function sessionFrom(c: any): Promise<SessionUser | null> {
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
    <a href="/app/"><b>New app</b></a>
    <a href="/dashboard">My progress</a>
    <a href="/dashboard/settings">Settings</a>
    ${user.organizer ? `<a href="/dashboard/roster">Roster</a><a href="/dashboard/week">Round board</a><a href="/dashboard/reviews">Reviews</a><a href="/dashboard/problems">Problems</a>` : ''}
    <form method="POST" action="/logout" style="margin-left:auto"><button class="btn ghost" style="padding:.2rem .8rem">Log out</button></form>
  </nav>`;

// ---------------------------------------------------------------------------
// Public question bank — the current round's set (open-bank model; private
// interviewer packets remain a future feature behind settings.packet_mode).

web.get('/bank', async (c) => {
  const cohort = await activeCohort(c.env);
  if (!cohort) return c.html(page('Question bank', '<h1>Question bank</h1><p class="sub">No active cohort yet.</p>'));
  const weeks = await cohortWeeks(c.env, cohort.id);
  const now = Date.now();
  const current =
    weeks.find(
      (w) => now >= new Date(w.optin_opens_at).getTime() && now <= new Date(w.grace_until ?? w.reports_due_at).getTime(),
    ) ??
    weeks.find((w) => now < new Date(w.optin_opens_at).getTime()) ??
    weeks[weeks.length - 1]!;
  const { results: bank } = await c.env.DB.prepare(
    `SELECT p.number, p.title, p.url, p.difficulty FROM week_problem_sets wps
     JOIN problems p ON p.id = wps.problem_id WHERE wps.week_id = ?1 ORDER BY p.id`,
  )
    .bind(current.id)
    .all<any>();
  const body = `
    <h1>📚 Round ${current.idx} question bank</h1>
    <p class="sub">${cohort.name} · interviewers pick <b>one</b> problem from this set per session and record it in their report. Everyone can study these — that's the point.</p>
    ${
      bank.length
        ? `<div class="card"><table><tr><th>#</th><th>Problem</th><th>Difficulty</th></tr>${bank
            .map(
              (p: any) =>
                `<tr><td>${esc(p.number ?? '')}</td><td>${p.url ? `<a href="${esc(p.url)}" rel="noreferrer">${esc(p.title)} ↗</a>` : esc(p.title)}</td><td><span class="tag">${esc(p.difficulty)}</span></td></tr>`,
            )
            .join('')}</table></div>`
        : '<div class="card">Not published yet — check back before the round starts.</div>'
    }`;
  return c.html(page('Question bank', body));
});

// ---------------------------------------------------------------------------
// Public form previews — organizers walk every flow without seeding data.
// Read-only: submissions are disabled and nothing here touches the DB.

web.get('/preview', (c) =>
  c.html(
    page(
      'Form previews',
      `<h1>Form previews</h1>
       <p class="sub">Read-only renders of every web-facing page, for walking the flows. Discord-side flows (join, verify, opt-in, session threads) are previewed in the server itself.</p>
       <div class="card">
         <p>📝 <a href="/preview/form/interviewee_report">Interviewee report</a> — filed by the person who was interviewed (recording link + code paste)</p>
         <p>🎙️ <a href="/preview/form/interviewer_report">Interviewer report</a> — filed by the interviewer (ratings + verdict)</p>
         <p>📚 <a href="/bank">Question bank</a> — the current round's open problem set (live page)</p>
         <p>🎯 <a href="/preview/packet">Interviewer packet</a> — <i>future feature, currently off</i>: private problem page interviewers would get 24h pre-session</p>
         <p>🔐 <a href="/login">Login</a> → dashboard (live, needs a roster email)</p>
       </div>`,
    ),
  ),
);

web.get('/preview/form/:kind', async (c) => {
  const { fieldsFor } = await import('../forms/schema');
  const { renderField } = await import('../forms/render');
  const kind = c.req.param('kind');
  const fields = fieldsFor(kind);
  if (!fields) return c.html(page('Unknown form', '<h1>Unknown form kind</h1>'), 404);
  const isInterviewer = kind === 'interviewer_report';
  const body = `
    <div class="err"><b>PREVIEW</b> — this is a render-only copy; submissions are disabled. Real forms arrive by DM with the session context filled in.</div>
    <h1>Round 2 — ${isInterviewer ? 'interviewer' : 'interviewee'} report</h1>
    <p class="sub">Hi Alex — ${isInterviewer ? 'you interviewed Jordan Example' : 'Jordan Example interviewed you'}, Wed, Aug 12, 7:30 p.m. (Toronto). Due Sat, Aug 22, 11:59 p.m.</p>
    <form onsubmit="return false">
      ${fields.map((f) => renderField(f)).join('\n')}
      <p style="margin-top:1.4rem"><button type="button" disabled style="opacity:.5">Submit (disabled in preview)</button></p>
    </form>`;
  return c.html(page(`Preview: ${kind}`, body));
});

web.get('/preview/packet', (c) =>
  c.html(
    page(
      'Preview: packet',
      `<div class="err"><b>PREVIEW</b> — interviewers get a personal signed link like this 24h before each session.</div>
       <h1>🎯 Interviewer packet — Round 2</h1>
       <p class="sub">Merge Intervals (#56) · medium · interviewing Jordan Example · <a href="https://leetcode.com/problems/merge-intervals/" rel="noreferrer">problem link ↗</a></p>
       <div class="err">🤫 For your eyes only — your interviewee must not see this before the session.</div>
       <h2>Statement</h2><div class="card" style="white-space:pre-wrap">Given an array of intervals, merge all overlapping intervals…</div>
       <h2>Hint ladder</h2><div class="card" style="white-space:pre-wrap">1. What happens if you sort first?\n2. When do two intervals overlap?\n3. Walk the sorted list keeping a current merged interval.</div>
       <h2>Solution</h2><div class="card" style="white-space:pre-wrap">Sort by start; sweep and extend the current interval while next.start <= current.end… O(n log n).</div>`,
    ),
  ),
);

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
       </form>
       <p class="sub">⚡ Faster: run <code>/dashboard</code> in the Discord server for a one-click sign-in link — no code needed.</p>`,
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

  // Unknown email -> say so immediately instead of a dead-end code page.
  // (Deliberate UX-over-enumeration-protection choice for a club roster.)
  if (!p) {
    return c.html(
      page(
        'Email not found',
        `<h1>WTA dashboard</h1>
         <div class="err"><b>${esc(email)}</b> isn't on the roster.</div>
         <p class="sub">Use the email you gave at sign-up — run <code>/join</code> in the Discord server to see or edit it. Not enrolled yet? <code>/join</code> is also how you start.</p>
         <form method="POST" action="/login" class="card">
           <label class="f" for="email">Email</label>
           <input type="email" id="email" name="email" required value="${esc(email)}">
           <p style="margin-top:1rem"><button type="submit">Send code</button></p>
         </form>`,
      ),
      404,
    );
  }

  const sent = page(
    'Check your email',
    `<h1>Check your email 📬</h1>
     <p class="sub">A 6-digit code is on its way to <b>${esc(email)}</b> (valid ${CODE_TTL_MIN} minutes).</p>
     <form method="POST" action="/login/code" class="card">
       <input type="hidden" name="email" value="${esc(email)}">
       <label class="f" for="code">Code</label>
       <input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" required placeholder="123456">
       <p style="margin-top:1rem"><button type="submit">Log in</button></p>
     </form>`,
  );

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

// One-click sign-in from Discord: /dashboard mints a short-lived signed link
// whose organizer flag was decided by the Discord role/permission check.
web.get('/auth/:token', async (c) => {
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.text('not configured', 503);
  const verified = await verifyToken(secret, c.req.param('token'));
  const m = verified && /^magic:(\d+):([01])$/.exec(verified.subject);
  if (!m) {
    return c.html(
      page('Link expired', '<h1>Sign-in link expired</h1><p class="sub">They last 10 minutes — run <code>/dashboard</code> in Discord for a fresh one.</p>'),
      401,
    );
  }
  const token = await signToken(secret, `sess:${m[1]}:${m[2]}`, new Date(Date.now() + SESSION_DAYS * 86400_000));
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

// ---------------------------------------------------------------------------
// Participant settings

web.get('/dashboard/settings', async (c) => {
  const user = await sessionFrom(c);
  if (!user) return c.redirect('/login');
  const p = await c.env.DB.prepare('SELECT * FROM participants WHERE id = ?1')
    .bind(user.participantId)
    .first<any>();
  if (!p) return c.redirect('/login');

  const enabled = p.email_ok === 1;
  const notice = c.req.query('saved') === '1' ? '<div class="ok">Settings saved.</div>' : '';
  const jsonList = (raw: string | null): string[] => {
    try {
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const opportunities = new Set(jsonList(p.opportunities));
  const topics = new Set(jsonList(p.topics));
  const options = (values: string[], selected: string | null) =>
    values.map((value) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');
  const body = `
    ${nav(user)}
    <h1>Settings</h1>
    <p class="sub">Manage your profile and notifications. Nothing changes until you save at the bottom.</p>
    ${notice}
    <form method="POST" action="/dashboard/settings/profile">
      <div class="card">
        <h2 style="margin-top:0">Email reminders</h2>
        <label><input type="checkbox" name="email_ok" value="1" ${enabled ? 'checked' : ''}> Email me reminders alongside Discord</label>
        <p class="help">Includes pairing announcements, opt-in reminders, and overdue-report alerts. Turning this on and saving sends a confirmation email. Important DMs may still fall back to email when Discord delivery fails.</p>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Your profile</h2>
        <p class="sub">These are the same answers used by <code>/join</code>. Your Discord account, participation status, credits, and strikes cannot be changed here.</p>
        <label class="f" for="name">Full name</label>
        <input type="text" id="name" name="name" required maxlength="100" value="${esc(p.name ?? '')}">
        <label class="f" for="preferred_email">Preferred email</label>
        <div class="help">Used to log into this dashboard and for email reminders.</div>
        <input type="email" id="preferred_email" name="preferred_email" required maxlength="200" value="${esc(p.preferred_email ?? '')}">
        <label class="f" for="western_email">Western email</label>
        <input type="email" id="western_email" name="western_email" required maxlength="200" value="${esc(p.western_email ?? '')}">
        <label class="f" for="year">Incoming year</label>
        <select id="year" name="year" required><option value="">— pick one —</option>${options(YEARS, p.year)}</select>
        <label class="f" for="program">Program</label>
        <select id="program" name="program" required><option value="">— pick one —</option>${options(PROGRAMS, p.program)}</select>
        <label class="f">What are you looking for?</label>
        <div class="opts">${OPPORTUNITIES.map((o) => `<label><input type="checkbox" name="opportunities" value="${esc(o.value)}" ${opportunities.has(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div>
        <label class="f" for="experience_band">Technical interviews done so far</label>
        <select id="experience_band" name="experience_band" required><option value="">— pick one —</option>${options(EXPERIENCE, p.experience_band)}</select>
        <label class="f"><input type="checkbox" name="prior_wta" value="1" ${p.prior_wta ? 'checked' : ''}> I participated in WTA before</label>
        <label class="f">Topics that would help you most</label>
        <div class="opts">${TOPICS.map((o) => `<label><input type="checkbox" name="topics" value="${esc(o.value)}" ${topics.has(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div>
        <label class="f" for="blurb">Dream company and role — what and why?</label>
        <div class="help">At least about 150–200 words.</div>
        <textarea id="blurb" name="blurb" required minlength="${BLURB_MIN_CHARS}" maxlength="2000">${esc(p.blurb ?? '')}</textarea>
        <label class="f" for="interests">Anything else you want to learn?</label>
        <textarea id="interests" name="interests" maxlength="1000">${esc(p.interests ?? '')}</textarea>
        <label class="f" for="prior_feedback">Feedback from last year</label>
        <textarea id="prior_feedback" name="prior_feedback" maxlength="1000">${esc(p.prior_feedback ?? '')}</textarea>
      </div>
      <p style="margin-top:1.2rem"><button type="submit">Save all changes</button></p>
    </form>`;
  return c.html(page('Settings', body));
});

web.post('/dashboard/settings/profile', async (c) => {
  const user = await sessionFrom(c);
  if (!user) return c.redirect('/login');
  const body = await c.req.parseBody({ all: true });
  const text = (key: string) => {
    const value = body[key];
    return String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim();
  };
  const list = (key: string) => {
    const value = body[key];
    return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);
  };

  const result = await updateParticipantSettings(c.env, user.participantId, {
    name: text('name'),
    preferredEmail: text('preferred_email'),
    westernEmail: text('western_email'),
    year: text('year'),
    program: text('program'),
    experience: text('experience_band'),
    opportunities: list('opportunities'),
    topics: list('topics'),
    priorWta: text('prior_wta') === '1',
    emailOk: text('email_ok') === '1',
    blurb: text('blurb'),
    interests: text('interests'),
    priorFeedback: text('prior_feedback'),
  });
  if (!result.ok) {
    return c.html(page('Settings not saved', `${nav(user)}<h1>Check your answers</h1><div class="err">${esc(result.message)}</div><p><a class="btn ghost" href="/dashboard/settings">Back to settings</a></p>`), result.status);
  }
  return c.redirect('/dashboard/settings?saved=1');
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
        <td>R${s.idx}</td>
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
  // Current-week opt-in chip
  const cohort = await activeCohort(c.env);
  let currentWeekId: number | null = null;
  if (cohort) {
    const weeks = await cohortWeeks(c.env, cohort.id);
    const now = Date.now();
    currentWeekId =
      [...weeks].reverse().find((w) => now >= new Date(w.optin_opens_at).getTime())?.id ?? null;
  }
  const optedIn = new Set<number>();
  if (currentWeekId) {
    const { results: opt } = await c.env.DB.prepare(
      'SELECT participant_id FROM optins WHERE week_id = ?1',
    )
      .bind(currentWeekId)
      .all<{ participant_id: number }>();
    for (const o of opt) optedIn.add(o.participant_id);
  }
  const rows = await Promise.all(
    results.map(async (p: any) => {
      const cr = await creditsOf(c.env, p.id);
      const st = await strikesOf(c.env, p.id);
      return `<tr><td><a href="/dashboard/p/${p.id}">${esc(p.name ?? '(unnamed)')}</a></td>
        <td>${esc(p.preferred_email ?? '')}</td><td>${esc(p.year ?? '')} ${esc(p.program ?? '')}</td>
        <td>${cr.interviewer}/3 · ${cr.interviewee}/3</td><td>${st || ''}</td>
        <td>${currentWeekId ? (optedIn.has(p.id) ? '✅ in' : '—') : ''}</td>
        <td><span class="tag">${esc(p.status)}</span>${p.email_ok ? ' 📧' : ''}</td></tr>`;
    }),
  );
  const body = `${nav(gate)}<h1>Roster (${results.length})</h1>
    <div class="card"><table>
    <tr><th>Name</th><th>Email</th><th>Program</th><th>Credits</th><th>Strikes</th><th>This week</th><th>Status</th></tr>
    ${rows.join('')}</table></div>`;
  return c.html(page('Roster', body, { wide: true }));
});

web.get('/dashboard/p/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const pid = Number(c.req.param('id'));
  const p = await c.env.DB.prepare('SELECT * FROM participants WHERE id = ?1').bind(pid).first<any>();
  if (!p) return c.html(page('Not found', `${nav(gate)}<h1>No such participant</h1>`), 404);

  const credits = await creditsOf(c.env, pid);
  const strikes = await strikesOf(c.env, pid);
  const json = (s: string | null) => {
    try {
      return s ? (JSON.parse(s) as string[]).join(', ') : '';
    } catch {
      return s ?? '';
    }
  };

  const { results: sessions } = await c.env.DB.prepare(
    `SELECT s.*, w.idx,
       pi.name AS interviewer_name, pi.id AS pi_id,
       pe.name AS interviewee_name, pe.id AS pe_id,
       pr.title AS problem_title,
       (SELECT payload FROM form_instances f WHERE f.session_id = s.id AND f.kind = 'interviewee_report' AND f.submitted_at IS NOT NULL) AS ie_payload,
       (SELECT payload FROM form_instances f WHERE f.session_id = s.id AND f.kind = 'interviewer_report' AND f.submitted_at IS NOT NULL) AS ir_payload
     FROM sessions s
     JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     LEFT JOIN problems pr ON pr.id = s.problem_id
     WHERE s.interviewer_id = ?1 OR s.interviewee_id = ?1
     ORDER BY w.idx, s.id`,
  )
    .bind(pid)
    .all<any>();

  const sessionRows = sessions
    .map((s: any) => {
      const asInterviewer = s.interviewer_id === pid;
      const partnerName = asInterviewer ? s.interviewee_name : s.interviewer_name;
      const partnerId = asInterviewer ? s.pe_id : s.pi_id;
      const ie = s.ie_payload ? JSON.parse(s.ie_payload) : null;
      const ir = s.ir_payload ? JSON.parse(s.ir_payload) : null;
      // Artifacts about THIS person: as interviewee -> their video/code + the
      // interviewer's verdict/ratings of them; as interviewer -> the ratings
      // the interviewee gave them.
      const bits: string[] = [];
      if (asInterviewer) {
        if (ie) bits.push(`rated by interviewee: exp ${ie.rating_experience ?? '?'} · comm ${ie.rating_communication ?? '?'} · prep ${ie.rating_preparedness ?? '?'}`);
        if (ir) bits.push('own report ✅');
      } else {
        if (ie?.video_url) bits.push(`<a href="${esc(ie.video_url)}" rel="noreferrer">▶ recording</a>`);
        if (ie?.code) bits.push(`<details style="display:inline"><summary>code</summary><pre class="code">${esc(ie.code.slice(0, 4000))}</pre></details>`);
        if (ir) bits.push(`verdict: <b>${esc(ir.verdict ?? '?')}</b> (${esc(ir.hints ?? '?')} hints, ps ${ir.rating_problem_solving ?? '?'}/5)`);
      }
      return `<tr>
        <td>R${s.idx}${s.origin === 'repair' ? ' 🛠️' : ''}</td>
        <td>${asInterviewer ? 'interviewer' : 'interviewee'} · <a href="/dashboard/p/${partnerId}">${esc(partnerName ?? '?')}</a></td>
        <td>${s.scheduled_at ? esc(formatToronto(s.scheduled_at)) : '—'}</td>
        <td>${esc(s.problem_title ?? '')}</td>
        <td><span class="tag">${esc(s.state)}</span>${s.review_state !== 'none' ? ` <span class="tag">${esc(s.review_state)}</span>` : ''}</td>
        <td>${bits.join(' · ')}</td></tr>`;
    })
    .join('');

  const { results: incidents } = await c.env.DB.prepare(
    `SELECT kind, state, created_at FROM incidents WHERE accused_id = ?1 ORDER BY id DESC`,
  )
    .bind(pid)
    .all<any>();

  const body = `${nav(gate)}
    <h1>${esc(p.name ?? '(unnamed)')} <span class="tag">${esc(p.status)}</span>${p.status === 'completed' ? ' 🏆' : ''}</h1>
    <p class="sub"><code>${esc(p.discord_id)}</code> · ${esc(p.preferred_email ?? '')} · ${esc(p.western_email ?? '')} · joined ${esc(String(p.created_at).slice(0, 10))}</p>
    <div class="card">
      <b>${esc(p.year ?? '?')}</b> year · ${esc(p.program ?? '?')} · looking for ${esc(json(p.opportunities) || '?')} ·
      ${esc(p.experience_band ?? '?')} prior interviews · prior WTA: ${p.prior_wta ? 'yes' : 'no'} ${p.email_ok ? '· 📧 emails on' : ''}<br>
      <b>Topics:</b> ${esc(json(p.topics))}<br>
      ${p.blurb ? `<b>Dream job:</b> ${esc(p.blurb)}<br>` : ''}
      ${p.interests ? `<b>Wants to learn:</b> ${esc(p.interests)}<br>` : ''}
      <b>Progress:</b> 🎙️ ${credits.interviewer}/3 · 🧑‍💻 ${credits.interviewee}/3 ${strikes ? `· ⚠️ ${strikes} strike(s)` : ''}
    </div>
    <h2>Sessions</h2>
    <div class="card"><table>
      <tr><th>Week</th><th>Role · Partner</th><th>When</th><th>Problem</th><th>State</th><th>Artifacts & signals</th></tr>
      ${sessionRows || '<tr><td colspan="6">None yet.</td></tr>'}
    </table></div>
    ${incidents.length ? `<h2>Incidents</h2><div class="card">${incidents.map((i: any) => `• ${esc(i.kind)} (${esc(i.state)}) — ${esc(String(i.created_at).slice(0, 10))}`).join('<br>')}</div>` : ''}`;
  return c.html(page(p.name ?? 'Profile', body, { wide: true }));
});

web.get('/dashboard/week', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const cohort = await activeCohort(c.env);
  if (!cohort) return c.html(page('Round board', `${nav(gate)}<h1>No active cohort</h1>`));
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
  const body = `${nav(gate)}<h1>Round ${current.idx} board</h1>
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
  return c.html(page('Round board', body, { wide: true }));
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
     WHERE s.review_state != 'none'
        OR (s.state = 'completed' AND EXISTS (
              SELECT 1 FROM form_instances f2
              WHERE f2.session_id = s.id AND f2.kind = 'interviewee_report'
                AND f2.submitted_at IS NOT NULL
                AND json_extract(f2.payload, '$.video_url') IS NOT NULL))
     ORDER BY s.review_state = 'pending' DESC, s.id`,
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
    return `<tr><td>#${s.id} R${s.idx}</td>
      <td>${esc(s.interviewer_name ?? '?')} → <b>${esc(s.interviewee_name ?? '?')}</b></td>
      <td>${ie.video_url ? `<a href="${esc(ie.video_url)}" rel="noreferrer">▶ recording</a>` : '<span class="tag">no video!</span>'}</td>
      <td>${esc(ir.verdict ?? '')}: ${esc((ir.verdict_reason ?? '').slice(0, 140))}</td>
      <td><span class="tag">${esc(s.review_state === 'none' ? 'unreviewed' : s.review_state)}</span></td><td>${actions}</td></tr>`;
  });
  const body = `${nav(gate)}<h1>Recording reviews</h1>
    <p class="sub">Final-round pass verdicts wait here — verify + 6/6 = alumni-round eligible. Earlier rounds appear too once recordings are in.</p>
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
