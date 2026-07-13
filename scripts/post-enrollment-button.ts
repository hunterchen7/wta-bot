// Organizer utility for posting the persistent enrollment call-to-action.
// Usage: npm run post:enrollment-button -- CHANNEL_ID

import { enrollmentButtonMessage } from '../src/discord/enrollment.ts';
import { DiscordRest } from '../src/discord/rest.ts';

const channelId = process.argv[2]?.trim();
const token = process.env.DISCORD_TOKEN;

if (!channelId || !/^\d+$/.test(channelId)) {
  console.error('Usage: npm run post:enrollment-button -- CHANNEL_ID');
  process.exit(1);
}
if (!token) {
  console.error('Missing DISCORD_TOKEN in .dev.vars.');
  process.exit(1);
}

const message = await new DiscordRest(token).send(channelId, enrollmentButtonMessage());
console.log(`Posted the WTA enrollment button (message ${message.id}) to channel ${channelId}.`);

export {};
