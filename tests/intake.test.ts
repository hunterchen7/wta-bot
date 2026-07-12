import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { asAdmin, asUser, makeSigner, sendInteraction, type Signer } from './helpers';

const USER = '111222333444555666';

// Discord 2026 modal-submit shape: Labels carrying a single `component`.
const textField = (custom_id: string, value: string) => ({
  type: 18,
  component: { type: 4, custom_id, value },
});
const selectField = (custom_id: string, values: string[]) => ({
  type: 18,
  component: { type: 3, custom_id, values },
});

const command = (name: string, user = asUser(USER)) => ({
  type: 2,
  id: '1',
  token: 't',
  data: { name },
  ...user,
});
const button = (custom_id: string, userId = USER) => ({
  type: 3,
  id: '1',
  token: 't',
  data: { custom_id, component_type: 2 },
  ...asUser(userId),
});
const modalSubmit = (custom_id: string, components: unknown[], userId = USER) => ({
  type: 5,
  id: '1',
  token: 't',
  data: { custom_id, components },
  ...asUser(userId),
});

let signer: Signer;
beforeAll(async () => {
  signer = await makeSigner();
});

describe('/join intake flow', () => {
  it('walks the full three-modal flow and persists everything', async () => {
    // /join → modal 1, unprefilled
    const m1 = await sendInteraction(signer, command('join'));
    expect(m1.status).toBe(200);
    const m1json = (await m1.json()) as any;
    expect(m1json.type).toBe(9);
    expect(m1json.data.custom_id).toBe('join:m1');
    expect(m1json.data.components[0].component.value).toBeUndefined();

    // submit modal 1 → saved + continue button
    const s1 = await sendInteraction(
      signer,
      modalSubmit('join:m1', [
        textField('name', 'Test Student'),
        textField('preferred_email', 'test@example.com'),
        textField('western_email', 'tstudent@uwo.ca'),
        textField('blurb', 'I want to build databases at Turso.'),
      ]),
    );
    const s1json = (await s1.json()) as any;
    expect(s1json.data.content).toContain('Part 1 saved');
    expect(s1json.data.components[0].components[0].custom_id).toBe('join:continue2');

    // continue → modal 2
    const m2 = await sendInteraction(signer, button('join:continue2'));
    const m2json = (await m2.json()) as any;
    expect(m2json.type).toBe(9);
    expect(m2json.data.custom_id).toBe('join:m2');

    // submit modal 2 → saved + continue button
    const s2 = await sendInteraction(
      signer,
      modalSubmit('join:m2', [
        selectField('year', ['Third']),
        selectField('program', ['Computer Science']),
        selectField('opportunities', ['internships', 'new_grad']),
        selectField('prior_wta', ['no']),
        selectField('experience_band', ['1-2']),
      ]),
    );
    expect(((await s2.json()) as any).data.content).toContain('Part 2 saved');

    // continue → modal 3, then submit
    const m3 = await sendInteraction(signer, button('join:continue3'));
    expect(((await m3.json()) as any).data.custom_id).toBe('join:m3');
    const s3 = await sendInteraction(
      signer,
      modalSubmit('join:m3', [
        selectField('topics', ['dsa', 'system_design']),
        selectField('email_ok', ['yes']),
        textField('interests', ''),
        textField('prior_feedback', ''),
      ]),
    );
    expect(((await s3.json()) as any).data.content).toContain('enrolled');

    // everything persisted
    const row = await env.DB.prepare('SELECT * FROM participants WHERE discord_id = ?1')
      .bind(USER)
      .first<any>();
    expect(row).toMatchObject({
      name: 'Test Student',
      preferred_email: 'test@example.com',
      western_email: 'tstudent@uwo.ca',
      year: 'Third',
      program: 'Computer Science',
      prior_wta: 0,
      experience_band: '1-2',
      email_ok: 1,
      status: 'active',
    });
    expect(JSON.parse(row.opportunities)).toEqual(['internships', 'new_grad']);
    expect(JSON.parse(row.topics)).toEqual(['dsa', 'system_design']);
    expect(row.interests).toBeNull(); // empty optional → null

    // /join again → edit menu (not the chain); edit buttons open prefilled modals
    const again = await sendInteraction(signer, command('join'));
    const againJson = (await again.json()) as any;
    expect(againJson.type).toBe(4);
    expect(againJson.data.content).toContain('Your WTA profile');

    const m1e = await sendInteraction(signer, button('join:edit1'));
    const m1eJson = (await m1e.json()) as any;
    expect(m1eJson.type).toBe(9);
    expect(m1eJson.data.custom_id).toBe('join:m1e');
    expect(m1eJson.data.components[0].component.value).toBe('Test Student');

    const m2e = await sendInteraction(signer, button('join:edit2'));
    const yearOptions = ((await m2e.json()) as any).data.components[0].component.options;
    expect(yearOptions.find((o: any) => o.value === 'Third').default).toBe(true);

    // opt-in confirmation email queued exactly once (email_ok flipped 0 -> 1)
    const confirms = await env.DB.prepare(
      "SELECT count(*) AS n FROM outbox WHERE kind = 'email' AND payload LIKE '%subscribed%'",
    ).first<{ n: number }>();
    expect(confirms?.n).toBe(1);

    // standalone edit of part 3 keeping email on: saves + re-confirms by email
    const editSave = await sendInteraction(
      signer,
      modalSubmit('join:m3e', [
        selectField('topics', ['dsa']),
        selectField('email_ok', ['yes']),
        textField('interests', ''),
        textField('prior_feedback', ''),
      ]),
    );
    const editJson = (await editSave.json()) as any;
    expect(editJson.data.content).toContain('Saved');
    expect(editJson.data.components).toBeUndefined(); // no continue chain
    const confirms2 = await env.DB.prepare(
      "SELECT count(*) AS n FROM outbox WHERE kind = 'email' AND payload LIKE '%subscribed%'",
    ).first<{ n: number }>();
    expect(confirms2?.n).toBe(2); // every opted-in save re-confirms
  });

  it('warns on short dream-company blurbs but still saves', async () => {
    const res = await sendInteraction(
      signer,
      modalSubmit(
        'join:m1',
        [
          textField('name', 'Short Blurb'),
          textField('preferred_email', 'sb@example.com'),
          textField('western_email', 'sb@uwo.ca'),
          textField('blurb', 'I like computers.'),
        ],
        '606060',
      ),
    );
    const json = (await res.json()) as any;
    expect(json.data.content).toContain('Part 1 saved');
    expect(json.data.content).toContain('~200');
    const row = await env.DB.prepare("SELECT blurb FROM participants WHERE discord_id = '606060'").first<any>();
    expect(row.blurb).toBe('I like computers.');
  });

  it('/status reflects enrollment state', async () => {
    const FRESH = '777888999';
    const before = await sendInteraction(signer, command('status', asUser(FRESH)));
    expect(((await before.json()) as any).data.content).toContain('not enrolled');

    await sendInteraction(
      signer,
      modalSubmit(
        'join:m1',
        [
          textField('name', 'Partial Person'),
          textField('preferred_email', 'p@example.com'),
          textField('western_email', 'p@uwo.ca'),
          textField('blurb', 'x'),
        ],
        FRESH,
      ),
    );
    const partial = await sendInteraction(signer, command('status', asUser(FRESH)));
    expect(((await partial.json()) as any).data.content).toContain('incomplete');
  });
});

describe('nickname sync', () => {
  it('enqueues a nickname update (truncated to 32) for guild submissions', async () => {
    const longName = 'A'.repeat(40);
    await sendInteraction(
      signer,
      {
        ...modalSubmit(
          'join:m1',
          [
            textField('name', longName),
            textField('preferred_email', 'n@example.com'),
            textField('western_email', 'n@uwo.ca'),
            textField('blurb', 'x'),
          ],
          '424242',
        ),
        guild_id: '777000111',
      },
      { ALLOWED_GUILD_IDS: '777000111' },
    );
    const row = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'nickname' ORDER BY id DESC LIMIT 1",
    ).first<{ payload: string }>();
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.payload)).toEqual({
      guildId: '777000111',
      userId: '424242',
      nick: 'A'.repeat(32),
    });
  });

  it('skips nickname sync in DMs', async () => {
    await sendInteraction(
      signer,
      modalSubmit(
        'join:m1',
        [
          textField('name', 'DM Person'),
          textField('preferred_email', 'd@example.com'),
          textField('western_email', 'd@uwo.ca'),
          textField('blurb', 'x'),
        ],
        '535353',
      ),
    );
    const row = await env.DB.prepare(
      "SELECT count(*) AS n FROM outbox WHERE kind = 'nickname' AND payload LIKE '%535353%'",
    ).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('/export', () => {
  it('denies non-organizers', async () => {
    const res = await sendInteraction(signer, { type: 2, id: '1', token: 't', data: { name: 'admin', options: [{ name: 'export', type: 1 }] }, ...asUser(USER) });
    expect(((await res.json()) as any).data.content).toContain('Organizers only');
  });

  it('gives organizers a working signed CSV link', async () => {
    await sendInteraction(
      signer,
      modalSubmit(
        'join:m1',
        [
          textField('name', 'CSV, "Person"'), // exercises CSV escaping
          textField('preferred_email', 'csv@example.com'),
          textField('western_email', 'csv@uwo.ca'),
          textField('blurb', 'hello'),
        ],
        '888777666',
      ),
    );

    const res = await sendInteraction(signer, { type: 2, id: '1', token: 't', data: { name: 'admin', options: [{ name: 'export', type: 1 }] }, ...asAdmin('999') });
    const content = ((await res.json()) as any).data.content as string;
    const url = content.match(/https?:\/\/\S+/)?.[0];
    expect(url).toBeTruthy();

    const csv = await app.request(new URL(url!).pathname, {}, env);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\n')[0]).toContain('discord_id');
    expect(text).toContain('888777666');
    expect(text).toContain('"CSV, ""Person"""');
  });

  it('rejects expired/garbage export tokens', async () => {
    const res = await app.request('/export/not-a-token', {}, env);
    expect(res.status).toBe(404);
  });
});

describe('/roster', () => {
  it('denies non-organizers and summarizes for organizers', async () => {
    const denied = await sendInteraction(signer, { type: 2, id: '1', token: 't', data: { name: 'admin', options: [{ name: 'roster', type: 1 }] }, ...asUser('1') });
    expect(((await denied.json()) as any).data.content).toContain('Organizers only');

    await sendInteraction(
      signer,
      modalSubmit(
        'join:m1',
        [
          textField('name', 'Roster Person'),
          textField('preferred_email', 'r@example.com'),
          textField('western_email', 'r@uwo.ca'),
          textField('blurb', 'x'),
        ],
        '313131',
      ),
    );

    const res = await sendInteraction(signer, { type: 2, id: '1', token: 't', data: { name: 'admin', options: [{ name: 'roster', type: 1 }] }, ...asAdmin('999') });
    const content = ((await res.json()) as any).data.content as string;
    expect(content).toContain('Enrollment');
    expect(content).toMatch(/\d+ signed up/);
    expect(content).toContain('Roster Person');
    expect(content).toContain('partial');
  });
});
