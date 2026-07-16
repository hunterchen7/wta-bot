import { signToken } from '../src/forms/token.ts';

const origin = (process.argv[2] ?? 'https://wta.hunterchen.ca').replace(/\/$/, '');
const lifetimeHours = Number(process.argv[3] ?? 72);
const secret = process.env.FORM_SIGNING_SECRET;

if (!secret) throw new Error('FORM_SIGNING_SECRET is required');
if (!Number.isFinite(lifetimeHours) || lifetimeHours <= 0 || lifetimeHours > 24 * 14) {
  throw new Error('Lifetime must be between 0 and 336 hours');
}

const token = await signToken(
  secret,
  'demo:fizzbuzz',
  new Date(Date.now() + lifetimeHours * 60 * 60 * 1000),
);

process.stdout.write(`${origin}/p/${token}\n`);
