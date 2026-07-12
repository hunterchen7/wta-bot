import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sendEmail } from '../src/email';
import { app } from '../src/index';

describe('email sending', () => {
  it('sends the structured Email Service payload with the configured from', async () => {
    const sent: any[] = [];
    const fake = { ...env, EMAIL: { send: async (m: any) => void sent.push(m) }, EMAIL_FROM: 'hello@wta.hunterchen.ca' };
    await sendEmail(fake as any, 'student@example.com', 'Test subject', 'Body text');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      to: 'student@example.com',
      from: 'hello@wta.hunterchen.ca',
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

describe('/help and previews', () => {
  it('renders the preview index and both report previews', async () => {
    const index = await app.request('/preview', {}, env);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('Interviewer packet');

    for (const kind of ['interviewee_report', 'interviewer_report']) {
      const res = await app.request(`/preview/form/${kind}`, {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('PREVIEW');
      expect(html).toContain('disabled');
    }
    expect((await app.request('/preview/form/nope', {}, env)).status).toBe(404);
    expect((await app.request('/preview/packet', {}, env)).status).toBe(200);
  });
});
