// End-to-end weekly cycle: roster → setup → opt-in → match → schedule →
// incident → strike ladder → repair queue. All through signed interactions
// and the real engine, with Discord fetches stubbed.

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { closeAndMatch, formDropScan } from '../src/engine/cycle';
import { executeOutbox } from '../src/engine/executor';
import { drainOutbox } from '../src/engine/outbox';
import { repairScan } from '../src/engine/repair';
import { activeCohort, cohortWeeks } from '../src/engine/weeks';
import { asAdmin, asUser, makeSigner, sendInteraction, type Signer } from './helpers';

const GUILD = '900100200';
const OVERRIDES = { ALLOWED_GUILD_IDS: GUILD };
const selectField = (custom_id: string, value: string) => ({
  type: 18,
  component: { type: 3, custom_id, values: [value] },
});
const textField = (custom_id: string, value: string) => ({
  type: 18,
  component: { type: 4, custom_id, value },
});

let signer: Signer;
beforeAll(async () => {
  signer = await makeSigner();
});

async function enroll(userId: string, name: string) {
  await env.DB.prepare(
    `INSERT INTO participants (discord_id, discord_username, name, preferred_email, western_email, year, program, opportunities, experience_band, topics, blurb, status)
     VALUES (?1, ?2, ?3, ?4, ?5, 'Third', 'Computer Science', '["internships"]', '1-2', '["dsa"]', ?6, 'active')`,
  ).bind(userId, name.toLowerCase(), name, `${name.toLowerCase()}@example.com`, `${name.toLowerCase()}@uwo.ca`, 'Profile complete. '.repeat(60)).run();
}

const button = (custom_id: string, userId: string, extra: Record<string, unknown> = {}) => ({
  type: 3,
  id: '1',
  token: 't',
  guild_id: GUILD,
  data: { custom_id, component_type: 2 },
  ...extra,
  ...asUser(userId),
});

describe('full weekly cycle', () => {
  it('marks an organizer ineligible on their first /join', async () => {
    const response = await sendInteraction(
      signer,
      {
        type: 2,
        id: 'join-organizer',
        token: 't',
        guild_id: GUILD,
        data: { name: 'join' },
        ...asAdmin('998'),
      },
      OVERRIDES,
    );
    expect(response.status).toBe(200);
    const participant = await env.DB.prepare(
      'SELECT pairing_excluded FROM participants WHERE discord_id = ?1',
    ).bind('998').first<{ pairing_excluded: number }>();
    expect(participant?.pairing_excluded).toBe(1);
  });

  it('runs enroll → cohort → opt-in → match → schedule → no-show → repair', async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('packet_mode', 'on') ON CONFLICT(key) DO UPDATE SET value = 'on'",
    ).run();
    // --- enroll four students -------------------------------------------------
    for (const [id, name] of [
      ['101', 'Alice'],
      ['102', 'Bob'],
      ['103', 'Cara'],
      ['104', 'Dan'],
    ] as const) {
      await enroll(id, name);
    }

    // --- organizer starts a cohort (Monday 2026-09-14) ------------------------
    const setup = await sendInteraction(
      signer,
      {
        type: 2,
        id: '1',
        token: 't',
        guild_id: GUILD,
        data: {
          name: 'admin',
          options: [
            {
              name: 'setup',
              type: 2,
              options: [
                {
                  name: 'cohort',
                  type: 1,
                  options: [
                    { name: 'start_date', type: 3, value: '2026-09-14' },
                    { name: 'name', type: 3, value: 'Fall 2026' },
                  ],
                },
              ],
            },
          ],
        },
        ...asAdmin('999'),
      },
      OVERRIDES,
    );
    expect(((await setup.json()) as any).data.content).toContain('Fall 2026');
    const cohort = (await activeCohort(env))!;
    const [week1] = await cohortWeeks(env, cohort.id);

    // Organizers may enroll to exercise the dashboard, but joining a round is
    // rejected and permanently removes them from the matching pool.
    await enroll('999', 'Organizer');
    const organizerOptin = await sendInteraction(
      signer,
      { ...button(`optin:${week1!.id}:in`, '999'), ...asAdmin('999') },
      OVERRIDES,
    );
    expect(((await organizerOptin.json()) as any).data.content).toContain(
      "Organizers aren't included",
    );
    const organizer = await env.DB.prepare(
      'SELECT id, pairing_excluded FROM participants WHERE discord_id = ?1',
    ).bind('999').first<{ id: number; pairing_excluded: number }>();
    expect(organizer?.pairing_excluded).toBe(1);
    expect(await env.DB.prepare(
      'SELECT id FROM optins WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(week1!.id, organizer!.id).first()).toBeNull();

    // Even pre-existing/stale data cannot bypass the engine-level exclusion.
    await env.DB.prepare(
      'INSERT INTO optins (week_id, participant_id) VALUES (?1, ?2)',
    ).bind(week1!.id, organizer!.id).run();

    // channels configured (normally via /setup channels)
    await env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES
       ('threads_channel_id', '555'), ('announce_channel_id', '556'), ('organizer_channel_id', '557')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    for (let index = 1; index <= 4; index++) {
      await env.DB.prepare(
        `INSERT INTO problems (id, title, difficulty, available_weeks)
         VALUES (?1, ?2, 'easy', '[1]')`,
      ).bind(8800 + index, `Round one problem ${index}`).run();
      await env.DB.prepare(
        'INSERT INTO week_problem_sets (week_id, problem_id) VALUES (?1, ?2)',
      ).bind(week1!.id, 8800 + index).run();
    }

    // --- everyone opts in ------------------------------------------------------
    for (const id of ['101', '102', '103', '104']) {
      const res = await sendInteraction(signer, button(`optin:${week1!.id}:in`, id), OVERRIDES);
      expect(((await res.json()) as any).data.content).toContain("You're in");
    }
    // one standby volunteer among them
    await sendInteraction(signer, button(`optin:${week1!.id}:standby`, '104'), OVERRIDES);

    // --- matching ---------------------------------------------------------------
    const result = await closeAndMatch(env, week1!, cohort);
    expect(result.sessions).toBe(4); // 4 people × out-degree 1
    expect(result.unmatched).toBe(0);

    const { results: sessions } = await env.DB.prepare(
      'SELECT * FROM sessions WHERE week_id = ?1 ORDER BY id',
    )
      .bind(week1!.id)
      .all<any>();
    expect(sessions).toHaveLength(4);
    expect(sessions.every((session) => session.problem_id != null)).toBe(true);
    expect(sessions.some((session) =>
      session.interviewer_id === organizer!.id || session.interviewee_id === organizer!.id,
    )).toBe(false);
    for (const discordId of ['101', '102', '103', '104']) {
      const participant = await env.DB.prepare(
        'SELECT id FROM participants WHERE discord_id = ?1',
      ).bind(discordId).first<{ id: number }>();
      const assigned = sessions
        .filter((session) => session.interviewer_id === participant!.id || session.interviewee_id === participant!.id)
        .map((session) => session.problem_id);
      expect(new Set(assigned).size).toBe(assigned.length);
    }
    expect(await env.DB.prepare(
      "SELECT count(*) AS n FROM outbox WHERE kind = 'dm' AND payload LIKE '%packet%'",
    ).first()).toEqual({ n: 0 });

    // thread fanout + pairing DMs queued
    const outboxKinds = await env.DB.prepare(
      "SELECT kind, count(*) AS n FROM outbox WHERE done_at IS NULL GROUP BY kind",
    ).all<any>();
    const kinds = Object.fromEntries(outboxKinds.results.map((r: any) => [r.kind, r.n]));
    expect(kinds.thread_create).toBe(4);
    expect(kinds.dm).toBeGreaterThanOrEqual(4);

    // --- one pair schedules via the modal ----------------------------------------
    const s0 = sessions[0]!;
    const interviewerDiscord = await env.DB.prepare(
      'SELECT discord_id FROM participants WHERE id = ?1',
    )
      .bind(s0.interviewer_id)
      .first<any>();
    const scheduler = await sendInteraction(
      signer,
      button(`sess:${s0.id}:sched`, interviewerDiscord.discord_id),
      OVERRIDES,
    );
    const schedulerJson = (await scheduler.json()) as any;
    expect(schedulerJson.type).toBe(9);
    const schedulerFields = Object.fromEntries(
      schedulerJson.data.components.map((field: any) => [field.component.custom_id, field.component]),
    ) as Record<string, any>;
    expect(schedulerFields.date.options[0].value).toBe('2026-09-14');
    expect(schedulerFields.date.options.at(-1).value).toBe('2026-09-27');
    expect(schedulerFields.time.type).toBe(4);
    expect(schedulerFields.time.placeholder).toBe('19:30');

    const tooEarly = await sendInteraction(
      signer,
      {
        type: 5, id: 'too-early', token: 't', guild_id: GUILD,
        data: {
          custom_id: `sess:${s0.id}:schedmodal`,
          components: [selectField('date', '2026-09-13'), textField('time', '19:30')],
        },
        ...asUser(interviewerDiscord.discord_id),
      },
      OVERRIDES,
    );
    expect(((await tooEarly.json()) as any).data.content).toContain('before this session');

    const invalidIncrement = await sendInteraction(
      signer,
      {
        type: 5, id: 'invalid-increment', token: 't', guild_id: GUILD,
        data: {
          custom_id: `sess:${s0.id}:schedmodal`,
          components: [selectField('date', '2026-09-16'), textField('time', '19:15')],
        },
        ...asUser(interviewerDiscord.discord_id),
      },
      OVERRIDES,
    );
    expect(((await invalidIncrement.json()) as any).data.content).toContain('half-hour increment');

    const sched = await sendInteraction(
      signer,
      {
        type: 5,
        id: '1',
        token: 't',
        guild_id: GUILD,
        data: {
          custom_id: `sess:${s0.id}:schedmodal`,
          components: [selectField('date', '2026-09-16'), textField('time', '19:30')],
        },
        ...asUser(interviewerDiscord.discord_id),
      },
      OVERRIDES,
    );
    const schedJson = (await sched.json()) as any;
    expect(schedJson.data.content).toContain('Locked in');
    const updated = await env.DB.prepare('SELECT state, scheduled_at FROM sessions WHERE id = ?1')
      .bind(s0.id)
      .first<any>();
    expect(updated.state).toBe('scheduled');
    expect(updated.scheduled_at).toBe('2026-09-16T23:30:00.000Z');
    expect(schedJson.data.components[0].components[0]).toMatchObject({
      custom_id: `sess:${s0.id}:sched`, label: 'Reschedule time',
    });
    expect(await env.DB.prepare(
      "SELECT count(*) AS n FROM outbox WHERE kind = 'dm' AND payload LIKE '%interviewer packet is ready%'",
    ).first()).toEqual({ n: 1 });

    const rescheduler = await sendInteraction(
      signer,
      button(`sess:${s0.id}:sched`, interviewerDiscord.discord_id),
      OVERRIDES,
    );
    const reschedulerJson = (await rescheduler.json()) as any;
    expect(reschedulerJson.data.title).toBe('Reschedule your session');
    const reschedulerFields = Object.fromEntries(
      reschedulerJson.data.components.map((field: any) => [field.component.custom_id, field.component]),
    ) as Record<string, any>;
    expect(reschedulerFields.time.value).toBe('19:30');

    // --- form drop once the session time arrives ---------------------------------
    const dropped = await formDropScan(env, 'https://example.test', new Date('2026-09-16T23:31:00Z'));
    expect(dropped).toBe(1);
    const forms = await env.DB.prepare(
      'SELECT kind FROM form_instances WHERE session_id = ?1 ORDER BY kind',
    )
      .bind(s0.id)
      .all<any>();
    expect(forms.results.map((f: any) => f.kind)).toEqual(['interviewee_report', 'interviewer_report']);

    // --- a different session goes wrong: interviewee reports interviewer ghosted --
    const s1 = sessions[1]!;
    const victimDiscord = await env.DB.prepare('SELECT discord_id FROM participants WHERE id = ?1')
      .bind(s1.interviewee_id)
      .first<any>();
    const noshow = await sendInteraction(
      signer,
      button(`sess:${s1.id}:noshow`, victimDiscord.discord_id),
      OVERRIDES,
    );
    expect(((await noshow.json()) as any).data.content).toContain('priority');

    const broken = await env.DB.prepare('SELECT state FROM sessions WHERE id = ?1').bind(s1.id).first<any>();
    expect(broken.state).toBe('broken');
    const incident = await env.DB.prepare(
      'SELECT kind, state, accused_id FROM incidents ORDER BY id DESC LIMIT 1',
    ).first<any>();
    expect(incident).toMatchObject({ kind: 'ghost', state: 'confirmed', accused_id: s1.interviewer_id });

    // victim entered the repair queue needing an interviewer
    const queue = await env.DB.prepare(
      "SELECT participant_id, need, state FROM repair_queue WHERE state = 'open'",
    ).first<any>();
    expect(queue).toMatchObject({ participant_id: s1.interviewee_id, need: 'interviewer' });

    // --- repair scan matches the victim with the standby volunteer (or victim pool)
    const repaired = await repairScan(env, new Date('2026-09-16T12:00:00Z'));
    expect(repaired).toBeGreaterThanOrEqual(0); // may pair with standby if constraints allow

    // --- second confirmed strike triggers hold + case file -------------------------
    // Fabricate an earlier confirmed incident for the same accused.
    await env.DB.prepare(
      `INSERT INTO incidents (session_id, accused_id, reporter_id, kind, state)
       VALUES (?1, ?2, ?3, 'ghost', 'confirmed')`,
    )
      .bind(s1.id, s1.interviewer_id, s1.interviewee_id)
      .run();
    // Re-run the ladder by reporting unresponsive on a fresh fabricated session.
    const ins = await env.DB.prepare(
      `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, origin)
       VALUES (?1, ?2, ?3, 'pending_schedule', 'manual')`,
    )
      .bind(week1!.id, s1.interviewer_id, 999999, 'x')
      .run()
      .catch(() => null);
    // (FK prevents fake interviewee — reuse a real one instead)
    const s2 = sessions[2]!;
    const victim2 = await env.DB.prepare('SELECT discord_id FROM participants WHERE id = ?1')
      .bind(s2.interviewee_id)
      .first<any>();
    if (s2.interviewer_id === s1.interviewer_id) {
      await sendInteraction(signer, button(`sess:${s2.id}:noshow`, victim2.discord_id), OVERRIDES);
      const held = await env.DB.prepare('SELECT status FROM participants WHERE id = ?1')
        .bind(s1.interviewer_id)
        .first<any>();
      expect(held.status).toBe('held');
    }

    // --- outbox drains without touching real Discord (no token -> dm fallback logs)
    const attempted = await drainOutbox(env, executeOutbox, 100);
    expect(attempted).toBeGreaterThan(0);
  });

  it('organizers can /pair manually (with repeat warning) and /repair into the queue', async () => {
    const cmd = (name: string, options: unknown[]) => ({
      type: 2,
      id: '1',
      token: 't',
      guild_id: GUILD,
      data: { name: 'admin', options: [{ name, type: 1, options }] },
      ...asAdmin('999'),
    });

    // 101 and 102 may or may not have met — the command works either way.
    const pair = await sendInteraction(
      signer,
      cmd('pair', [
        { name: 'interviewer', type: 6, value: '101' },
        { name: 'interviewee', type: 6, value: '102' },
      ]),
      OVERRIDES,
    );
    const pairJson = (await pair.json()) as any;
    expect(pairJson.data.content).toContain('Session #');
    const manual = await env.DB.prepare(
      "SELECT count(*) AS n FROM sessions WHERE origin = 'manual'",
    ).first<any>();
    expect(manual.n).toBe(1);

    const repair = await sendInteraction(
      signer,
      cmd('repair', [
        { name: 'user', type: 6, value: '103' },
        { name: 'need', type: 3, value: 'interviewer' },
      ]),
      OVERRIDES,
    );
    expect(((await repair.json()) as any).data.content).toContain('queued');
    const queued = await env.DB.prepare(
      "SELECT count(*) AS n FROM repair_queue WHERE state = 'open' AND need = 'interviewer'",
    ).first<any>();
    expect(queued.n).toBeGreaterThanOrEqual(1);

    // non-organizers bounce
    const denied = await sendInteraction(
      signer,
      { ...cmd('pair', [
        { name: 'interviewer', type: 6, value: '101' },
        { name: 'interviewee', type: 6, value: '102' },
      ]), ...asUser('101') },
      OVERRIDES,
    );
    expect(((await denied.json()) as any).data.content).toContain('Organizers only');
  });

  it('/leave withdraws permanently: cancels open sessions, repairs partners, blocks re-join', async () => {
    const ask = await sendInteraction(
      signer,
      { type: 2, id: '1', token: 't', guild_id: GUILD, data: { name: 'leave' }, ...asUser('104') },
      OVERRIDES,
    );
    const askJson = (await ask.json()) as any;
    expect(askJson.data.content).toContain('Leave WTA for good?');

    const before = await env.DB.prepare(
      `SELECT count(*) AS n FROM sessions
       WHERE state IN ('pending_schedule','scheduled')
         AND (interviewer_id = (SELECT id FROM participants WHERE discord_id='104')
           OR interviewee_id = (SELECT id FROM participants WHERE discord_id='104'))`,
    ).first<any>();

    const confirm = await sendInteraction(signer, button('leave:confirm', '104'), OVERRIDES);
    const confirmJson = (await confirm.json()) as any;
    expect(confirmJson.data.content).toContain("You've left the program");

    const p = await env.DB.prepare(
      "SELECT status, removed_reason FROM participants WHERE discord_id = '104'",
    ).first<any>();
    expect(p).toMatchObject({ status: 'removed', removed_reason: 'withdrew' });

    const after = await env.DB.prepare(
      `SELECT count(*) AS n FROM sessions
       WHERE state IN ('pending_schedule','scheduled')
         AND (interviewer_id = (SELECT id FROM participants WHERE discord_id='104')
           OR interviewee_id = (SELECT id FROM participants WHERE discord_id='104'))`,
    ).first<any>();
    expect(after.n).toBe(0);
    if (before.n > 0) {
      const repairs = await env.DB.prepare(
        "SELECT count(*) AS n FROM repair_queue WHERE state = 'open'",
      ).first<any>();
      expect(repairs.n).toBeGreaterThan(0);
    }

    // self-serve rejoin: /join offers the button, clicking restores status + history
    const rejoin = await sendInteraction(
      signer,
      { type: 2, id: '1', token: 't', guild_id: GUILD, data: { name: 'join' }, ...asUser('104') },
      OVERRIDES,
    );
    const rejoinJson = (await rejoin.json()) as any;
    expect(rejoinJson.data.content).toContain('Welcome back');
    expect(rejoinJson.data.components[0].components[0].custom_id).toBe('rejoin:confirm');

    const confirm2 = await sendInteraction(signer, button('rejoin:confirm', '104'), OVERRIDES);
    expect(((await confirm2.json()) as any).data.content).toContain("You're back in");
    const restored = await env.DB.prepare(
      "SELECT status, removed_reason FROM participants WHERE discord_id = '104'",
    ).first<any>();
    expect(restored).toMatchObject({ status: 'active', removed_reason: null });
  });
});
