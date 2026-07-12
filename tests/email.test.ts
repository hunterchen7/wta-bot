import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sendEmail } from '../src/email';
import { app } from '../src/index';

describe('email sending', () => {
  it('sends the structured Email Service payload with a named sender', async () => {
    const sent: any[] = [];
    const fake = {
      ...env,
      EMAIL: { send: async (m: any) => void sent.push(m) },
      EMAIL_FROM: 'hello@wta.hunterchen.ca',
      EMAIL_FROM_NAME: 'Western Tech Alumni',
    };
    await sendEmail(fake as any, 'student@example.com', 'Test subject', 'Body text');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      to: 'student@example.com',
      from: { email: 'hello@wta.hunterchen.ca', name: 'Western Tech Alumni' },
      subject: 'Test subject',
      text: 'Body text',
    });
  });

  it('skips quietly when the binding is absent', async () => {
    await expect(
      sendEmail({ ...env, EMAIL: undefined } as any, 'x@y.z', 's', 't'),
    ).resolves.toBeUndefined();
  });
});

describe('report preview API', () => {
  it('returns both report schemas without creating form instances', async () => {
    for (const kind of ['interviewee_report', 'interviewer_report']) {
      const res = await app.request(`/api/public/previews/${kind}`, {}, env);
      expect(res.status).toBe(200);
      const preview = await res.json<any>();
      expect(preview).toMatchObject({ preview: true, kind, fields: expect.any(Array) });
      expect(preview.fields.length).toBeGreaterThan(5);
    }
    expect((await app.request('/api/public/previews/nope', {}, env)).status).toBe(404);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM form_instances').first()).toEqual({ n: 0 });
  });
});
