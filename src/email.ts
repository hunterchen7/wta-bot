import type { Env } from './env';

// Email channel (DESIGN §7): Cloudflare Email Service via the send_email
// binding when configured; a clearly-logged no-op otherwise so every other
// feature works before the domain is enabled for sending. Swap-friendly if
// the beta shifts — this is the only file that knows how email is sent.

export const EMAIL_FROM = 'wta@hunterchen.ca';
export const EMAIL_FROM_NAME = 'Western Tech Alumni';

export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  const binding = (env as any).EMAIL;
  if (!binding) {
    console.warn(`email skipped (Email Service binding not configured): to=${to} subject=${subject}`);
    return;
  }

  // Cloudflare Email Service Workers binding (public beta). EmailMessage is
  // constructed from raw MIME via the runtime's email API.
  const { EmailMessage } = (await import('cloudflare:email')) as any;
  const raw = [
    `From: ${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@hunterchen.ca>`,
    '',
    text,
  ].join('\r\n');
  await binding.send(new EmailMessage(EMAIL_FROM, to, raw));
}
