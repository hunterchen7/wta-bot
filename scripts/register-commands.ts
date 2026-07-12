// Registers slash commands. Run: npm run register  (reads .dev.vars via --env-file)
// With DEV_GUILD_ID set, commands register to that guild only (instant — good
// for dev). Without it, they register globally (propagation up to an hour).
// Runs directly under Node >=23 type-stripping; keep syntax erasable (no enums).

const SUB_COMMAND = 1;
const STRING = 3;

type CommandOption = {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  options?: CommandOption[];
};

type Command = { name: string; description: string; options?: CommandOption[] };

const commands: Command[] = [
  { name: 'join', description: 'Enroll in the WTA mock-interview program (or edit your info)' },
  { name: 'status', description: 'Your progress, sessions, owed forms, and standing' },
  { name: 'optout', description: 'Sit out this week (no penalty — catch up later)' },
  { name: 'cancel', description: 'Cancel one of your sessions so your partner is freed ASAP' },
  {
    name: 'report',
    description: 'Report a session problem to the organizers',
    options: [
      { type: SUB_COMMAND, name: 'no-show', description: 'Your partner missed a scheduled session' },
      { type: SUB_COMMAND, name: 'unresponsive', description: 'Your partner is not responding to scheduling' },
      {
        type: SUB_COMMAND,
        name: 'issue',
        description: 'Anything else — goes privately to the organizers',
        options: [{ type: STRING, name: 'details', description: 'What happened?', required: true }],
      },
    ],
  },
];

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
  body: JSON.stringify(commands),
});

console.log(`${res.status} ${res.statusText} — ${DEV_GUILD_ID ? `guild ${DEV_GUILD_ID}` : 'global'}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}
const registered = (await res.json()) as Array<{ name: string }>;
console.log(registered.map((c) => `/${c.name}`).join(' '));

export {}; // top-level await requires module context
