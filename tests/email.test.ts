import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sendEmail } from '../src/email';

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
