// OPTIONAL dev tool: instant slash-command registration to a dev guild.
// Production needs none of this — the deployed Worker self-syncs global
// commands via syncCommands() in src/cron.ts (within one 15-min cron tick
// of a definition change). Use this only for instant iteration in a dev
// guild. Run: npm run register  (reads .dev.vars via --env-file)

import { COMMANDS } from '../src/discord/commands.ts';

const { DISCORD_APP_ID, DISCORD_TOKEN, DEV_GUILD_ID } = process.env;
if (!DISCORD_APP_ID || !DISCORD_TOKEN) {
  console.error('Missing DISCORD_APP_ID / DISCORD_TOKEN — copy .dev.vars.example to .dev.vars and fill it in.');
  process.exit(1);
}

const url = DEV_GUILD_ID
  ? `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DEV_GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(COMMANDS),
});

console.log(`${res.status} ${res.statusText} — ${DEV_GUILD_ID ? `guild ${DEV_GUILD_ID}` : 'global'}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}
const registered = (await res.json()) as Array<{ name: string }>;
console.log(registered.map((c) => `/${c.name}`).join(' '));

export {}; // top-level await requires module context
