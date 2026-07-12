import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { asUser, makeSigner, sendInteraction, type Signer } from './helpers';

const USER = '111222333444555666';
const GUILD = '777000111';
let signer: Signer;
let enrollmentToken = '';

const joinCommand = (id = USER, username = 'test.student') => ({
  type: 2, id: '1', token: 'interaction', guild_id: GUILD, data: { name: 'join' },
  ...asUser(id, { user: { id, username, global_name: username } }),
});

const validProfile = {
  name: 'Test Student', preferredEmail: 'test@example.com', westernEmail: 'test@uwo.ca',
  year: 'Third', program: 'Computer Science', experience: '1-2', opportunities: ['internships', 'new_grad'],
  topics: ['dsa', 'system_design'], priorWta: false, emailOk: true,
  blurb: 'I want to build dependable infrastructure and become much better at explaining technical decisions under pressure. '.repeat(12),
  interests: 'Distributed systems', priorFeedback: '',
};

beforeAll(async () => {
  signer = await makeSigner();
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('participant_role_id', 'participant-role'), ('organizer_channel_id', 'organizer-channel')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run();
});

describe('web enrollment cutover', () => {
  it('/join returns a Discord-bound React enrollment link instead of native modals', async () => {
    const response = await sendInteraction(signer, joinCommand(), { ALLOWED_GUILD_IDS: GUILD, PUBLIC_ORIGIN: 'https://wta.example' });
    const body = await response.json<any>();
    expect(body.type).toBe(4);
    expect(body.data.content).toContain('web app');
    expect(body.data.content).toContain('@test.student');
    expect(body.data.custom_id).toBeUndefined();
    const match = body.data.content.match(/https:\/\/wta\.example\/enroll\/(\S+)/);
    expect(match).not.toBeNull();
    enrollmentToken = match[1];
  });

  it('loads linked Discord identity and reports exact validation errors', async () => {
    const load = await app.request(`/api/enrollment/${enrollmentToken}`, {}, env);
    expect(load.status).toBe(200);
    expect(await load.json<any>()).toMatchObject({ discord: { id: USER, username: 'test.student' }, profile: null, minimumBlurbWords: 100 });

    const invalid = await app.request(`/api/enrollment/${enrollmentToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validProfile, name: '', opportunities: [], blurb: 'short' }),
    }, env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json<any>()).toMatchObject({ fieldErrors: { name: expect.any(String), opportunities: expect.any(String), blurb: expect.stringContaining('currently 1') } });
    expect(await env.DB.prepare('SELECT id FROM participants WHERE discord_id = ?1').bind(USER).first()).toBeNull();
  });

  it('saves the full profile, Discord mapping, role grant, nickname, and email confirmation together', async () => {
    const response = await app.request(`/api/enrollment/${enrollmentToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validProfile),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ ok: true, created: true });
    const participant = await env.DB.prepare('SELECT * FROM participants WHERE discord_id = ?1').bind(USER).first<any>();
    expect(participant).toMatchObject({ discord_username: 'test.student', discord_nickname: 'Test Student', name: 'Test Student', preferred_email: 'test@example.com', topics: '["dsa","system_design"]', email_ok: 1, status: 'active' });

    const { results } = await env.DB.prepare("SELECT kind, payload FROM outbox WHERE kind IN ('role_add','nickname','email') ORDER BY id").all<any>();
    expect(results.map((row) => row.kind)).toEqual(expect.arrayContaining(['role_add', 'nickname', 'email']));
    expect(results.map((row) => JSON.parse(row.payload))).toEqual(expect.arrayContaining([
      expect.objectContaining({ guildId: GUILD, userId: USER, roleId: 'participant-role' }),
      expect.objectContaining({ guildId: GUILD, userId: USER, nick: 'Test Student' }),
      expect.objectContaining({ to: 'test@example.com' }),
    ]));
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
