// Single source of truth for slash-command definitions.
// The deployed Worker self-syncs these to Discord (global commands) whenever
// they change — see syncCommands() in src/cron.ts. scripts/register-commands.ts
// uses the same list for instant dev-guild registration during development.

const SUB_COMMAND = 1;
const STRING = 3;

export type CommandOption = {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  options?: CommandOption[];
};

export type Command = {
  name: string;
  description: string;
  options?: CommandOption[];
  default_member_permissions?: string;
};

export const COMMANDS: Command[] = [
  { name: 'join', description: 'Enroll in the WTA mock-interview program (or edit your info)' },
  { name: 'status', description: 'Your progress, sessions, owed forms, and standing' },
  { name: 'optout', description: 'Sit out this week (no penalty — catch up later)' },
  { name: 'cancel', description: 'Cancel one of your sessions so your partner is freed ASAP' },
  {
    name: 'export',
    description: 'Organizers: download the roster as CSV',
    default_member_permissions: '32', // MANAGE_GUILD — hidden from regular members
  },
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
