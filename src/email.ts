import type { Env } from './env';

// Email channel (DESIGN §7): Cloudflare Email Service via the send_email
// Workers binding — env.EMAIL.send({ to, from: {email, name}, subject, text }).
// No API keys. When the binding is absent (Email Service not enabled yet),
// sends are logged and skipped so every other feature keeps working. This is
// the only file that knows how email is sent.

export const DEFAULT_EMAIL_FROM = 'hello@wta.hunterchen.ca';
export const DEFAULT_EMAIL_FROM_NAME = 'Western Tech Alumni';

export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  const binding = env.EMAIL;
  if (!binding?.send) {
    console.warn(`email skipped (send_email binding not configured): to=${to} subject=${subject}`);
    return;
  }
  await binding.send({
    to,
    from: {
      email: env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
      name: env.EMAIL_FROM_NAME || DEFAULT_EMAIL_FROM_NAME,
    },
    subject,
    text,
  });
}
