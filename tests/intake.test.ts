import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { enrollmentButtonMessage } from '../src/discord/enrollment';
import { app } from '../src/index';
import { asUser, makeSigner, sendInteraction, type Signer } from './helpers';

const USER = '111222333444555666';
const GUILD = '777000111';
let signer: Signer;
let enrollmentToken = '';

const joinCommand = (id = USER, username = 'test.student') => ({
  type: 2, id: '2', token: 'interaction', guild_id: GUILD, data: { name: 'join' },
  ...asUser(id, { user: { id, username, global_name: username } }),
});

const joinButton = (id = USER, username = 'test.student') => ({
  type: 3, id: '1', token: 'interaction', guild_id: GUILD,
  data: { custom_id: 'enrollment:open', component_type: 2 },
  ...asUser(id, { user: { id, username, global_name: username } }),
});

const validProfile = {
  name: 'Test Student', preferredEmail: 'test@example.com', westernEmail: 'test@uwo.ca',
  year: 'Third', program: 'Computer Science', experience: '1-2', opportunities: ['internships', 'new_grad'],
  topics: ['dsa', 'system_design'], priorWta: false, emailOk: true,
  blurb: 'I want to build dependable infrastructure and become much better at explaining technical decisions under pressure. '.repeat(12),
  interests: 'Distributed systems', priorFeedback: '',
  linkedinUrl: 'https://www.linkedin.com/in/test-student', otherUrl: 'https://github.com/test-student',
};

beforeAll(async () => {
  signer = await makeSigner();
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('participant_role_id', 'participant-role'), ('organizer_channel_id', 'organizer-channel')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run();
});

describe('web enrollment cutover', () => {
  it('builds a persistent enrollment message with the Join WTA button', () => {
    const message = enrollmentButtonMessage();
    expect(message.content).toContain('Join WTA 2026');
    expect((message.components as any[])[0].components[0]).toMatchObject({
      custom_id: 'enrollment:open',
      label: 'Join WTA',
      style: 1,
    });
  });

  it('the Join WTA button returns a private Discord-bound enrollment link', async () => {
    const response = await sendInteraction(signer, joinButton(), { ALLOWED_GUILD_IDS: GUILD, PUBLIC_ORIGIN: 'https://wta.example' });
    const body = await response.json<any>();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.content).toContain('web app');
    expect(body.data.content).toContain('@test.student');
    expect(body.data.custom_id).toBeUndefined();
    const match = body.data.content.match(/https:\/\/wta\.example\/enroll\/(\S+)/);
    expect(match).not.toBeNull();
    enrollmentToken = match[1];
    expect(await env.DB.prepare(
      "SELECT event_type, source, discord_username FROM enrollment_events WHERE discord_id = ?1 ORDER BY id",
    ).bind(USER).all()).toMatchObject({ results: [{ event_type: 'link_generated', source: 'join_button', discord_username: 'test.student' }] });
  });

  it('keeps /join as a fallback for the same enrollment flow', async () => {
    const response = await sendInteraction(signer, joinCommand(), { ALLOWED_GUILD_IDS: GUILD, PUBLIC_ORIGIN: 'https://wta.example' });
    const body = await response.json<any>();
    expect(body.data.flags).toBe(64);
    expect(body.data.content).toMatch(/https:\/\/wta\.example\/enroll\/\S+/);
    expect(await env.DB.prepare(
      "SELECT source FROM enrollment_events WHERE discord_id = ?1 AND event_type = 'link_generated' ORDER BY id",
    ).bind(USER).all()).toMatchObject({ results: [{ source: 'join_button' }, { source: 'join_command' }] });
  });

  it('loads linked Discord identity and reports exact validation errors', async () => {
    const load = await app.request(`/api/enrollment/${enrollmentToken}`, {}, env);
    expect(load.status).toBe(200);
    expect(await load.json<any>()).toMatchObject({ discord: { id: USER, username: 'test.student' }, profile: null, minimumBlurbWords: 50 });
    expect(await env.DB.prepare(
      "SELECT count(*) AS n FROM enrollment_events WHERE discord_id = ?1 AND event_type = 'form_opened'",
    ).bind(USER).first()).toEqual({ n: 1 });

    const invalid = await app.request(`/api/enrollment/${enrollmentToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validProfile, name: '', opportunities: [], blurb: 'short' }),
    }, env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json<any>()).toMatchObject({ fieldErrors: { name: expect.any(String), opportunities: expect.any(String), blurb: expect.stringContaining('currently 1') } });
    expect(await env.DB.prepare('SELECT id FROM participants WHERE discord_id = ?1').bind(USER).first()).toBeNull();
    expect(await env.DB.prepare(
      "SELECT count(*) AS n FROM enrollment_events WHERE discord_id = ?1 AND event_type = 'enrollment_completed'",
    ).bind(USER).first()).toEqual({ n: 0 });
  });

  it('saves the full profile, Discord mapping, role grant, nickname, and email confirmation together', async () => {
    const response = await app.request(`/api/enrollment/${enrollmentToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validProfile),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ ok: true, created: true });
    const participant = await env.DB.prepare('SELECT * FROM participants WHERE discord_id = ?1').bind(USER).first<any>();
    expect(participant).toMatchObject({ discord_username: 'test.student', discord_nickname: 'Test', name: 'Test Student', preferred_email: 'test@example.com', topics: '["dsa","system_design"]', linkedin_url: 'https://www.linkedin.com/in/test-student', other_url: 'https://github.com/test-student', email_ok: 1, status: 'active' });
    expect(await env.DB.prepare(
      "SELECT count(*) AS n FROM enrollment_events WHERE discord_id = ?1 AND event_type = 'enrollment_completed'",
    ).bind(USER).first()).toEqual({ n: 1 });

    const { results } = await env.DB.prepare("SELECT kind, payload FROM outbox WHERE kind IN ('role_add','nickname','email') ORDER BY id").all<any>();
    expect(results.map((row) => row.kind)).toEqual(expect.arrayContaining(['role_add', 'nickname', 'email']));
    expect(results.map((row) => JSON.parse(row.payload))).toEqual(expect.arrayContaining([
      expect.objectContaining({ guildId: GUILD, userId: USER, roleId: 'participant-role' }),
      expect.objectContaining({ guildId: GUILD, userId: USER, nick: 'Test' }),
      expect.objectContaining({ to: 'test@example.com' }),
    ]));
  });

  it('stores, serves, replaces, and removes a private resume through the enrollment link', async () => {
    const invalid = await app.request(`/api/enrollment/${enrollmentToken}/resume`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'X-WTA-Filename': encodeURIComponent('resume.exe') },
      body: new TextEncoder().encode('not a resume'),
    }, env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json<any>()).toMatchObject({ error: 'unsupported_resume_type' });

    const firstBytes = new TextEncoder().encode('%PDF-1.4\nfirst private resume');
    const uploaded = await app.request(`/api/enrollment/${enrollmentToken}/resume`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', 'X-WTA-Filename': encodeURIComponent('Test Student Resume.pdf') },
      body: firstBytes,
    }, env);
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json<any>()).toMatchObject({ resume: { filename: 'Test Student Resume.pdf', contentType: 'application/pdf', bytes: firstBytes.byteLength } });
    const first = await env.DB.prepare('SELECT resume_object_key, resume_filename FROM participants WHERE discord_id = ?1').bind(USER).first<any>();
    expect(first.resume_object_key).toMatch(/^resumes\/\d+\//);
    expect(await env.RECORDINGS!.get(first.resume_object_key)).not.toBeNull();

    const downloaded = await app.request(`/api/enrollment/${enrollmentToken}/resume`, {}, env);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('cache-control')).toBe('private, no-store');
    expect(downloaded.headers.get('content-disposition')).toContain('attachment;');
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(firstBytes);

    const replacementBytes = new TextEncoder().encode('{\\rtf1 replacement resume}');
    const replaced = await app.request(`/api/enrollment/${enrollmentToken}/resume`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/rtf', 'X-WTA-Filename': encodeURIComponent('resume.rtf') },
      body: replacementBytes,
    }, env);
    expect(replaced.status).toBe(200);
    expect(await env.RECORDINGS!.get(first.resume_object_key)).toBeNull();

    const removed = await app.request(`/api/enrollment/${enrollmentToken}/resume`, { method: 'DELETE' }, env);
    expect(removed.status).toBe(200);
    expect(await env.DB.prepare('SELECT resume_object_key, resume_filename FROM participants WHERE discord_id = ?1').bind(USER).first()).toEqual({ resume_object_key: null, resume_filename: null });
    expect((await app.request(`/api/enrollment/${enrollmentToken}/resume`, {}, env)).status).toBe(404);
  });

  it('prefills edits and refreshes the stored Discord username on later interactions', async () => {
    const response = await sendInteraction(signer, joinCommand(USER, 'renamed.student'), { ALLOWED_GUILD_IDS: GUILD, PUBLIC_ORIGIN: 'https://wta.example' });
    const content = (await response.json<any>()).data.content;
    const token = content.match(/\/enroll\/(\S+)/)![1];
    const load = await (await app.request(`/api/enrollment/${token}`, {}, env)).json<any>();
    expect(load.profile).toMatchObject({ name: 'Test Student', preferredEmail: 'test@example.com' });
    expect(load.discord.username).toBe('renamed.student');
    expect(await env.DB.prepare('SELECT discord_username FROM participants WHERE discord_id = ?1').bind(USER).first()).toEqual({ discord_username: 'renamed.student' });
  });

  it('rejects expired/garbage enrollment links as JSON', async () => {
    const response = await app.request('/api/enrollment/garbage', {}, env);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
