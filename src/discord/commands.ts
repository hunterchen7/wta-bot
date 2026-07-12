// Single source of truth for slash-command definitions.
// The deployed Worker self-syncs these to Discord (global commands) whenever
// they change — see syncCommands() in src/cron.ts. scripts/register-commands.ts
// uses the same list for instant dev-guild registration during development.

const SUB_COMMAND = 1;
const STRING = 3;
const USER = 6;
const CHANNEL = 7;
const ROLE = 8;

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
    name: 'roster',
    description: 'Organizers: enrollment summary at a glance',
    default_member_permissions: '32',
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
  {
    name: 'setup',
    description: 'Organizers: configure the bot for this server',
    default_member_permissions: '32',
    options: [
      {
        type: SUB_COMMAND,
        name: 'channels',
        description: 'Where the bot posts',
        options: [
          { type: CHANNEL, name: 'announce', description: 'Opt-ins + pairing announcements' },
          { type: CHANNEL, name: 'organizer', description: 'Digests, case files, enrollment feed' },
          { type: CHANNEL, name: 'threads', description: 'Parent channel for session threads' },
          { type: CHANNEL, name: 'start_here', description: 'Verification panel channel' },
          { type: CHANNEL, name: 'intros', description: 'Where verified intros get posted (optional)' },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'roles',
        description: 'Roles the bot grants/checks',
        options: [
          { type: ROLE, name: 'member', description: 'Granted by verification' },
          { type: ROLE, name: 'participant', description: 'Granted on enrollment' },
          { type: ROLE, name: 'organizer', description: 'Admin-command access' },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'cohort',
        description: 'Start a cohort — the cron runs the rest',
        options: [
          { type: STRING, name: 'start_monday', description: 'Week 1 Monday, YYYY-MM-DD', required: true },
          { type: STRING, name: 'name', description: 'Cohort name' },
        ],
      },
      { type: SUB_COMMAND, name: 'verify', description: 'Post the verification panel' },
    ],
  },
  {
    name: 'verify',
    description: 'Organizers: verification utilities',
    default_member_permissions: '32',
    options: [
      { type: SUB_COMMAND, name: 'backfill', description: 'Grant the member role to all existing members' },
    ],
  },
  {
    name: 'standing',
    description: "Organizers: a participant's progress, strikes, and incidents",
    default_member_permissions: '32',
    options: [{ type: USER, name: 'user', description: 'Who?', required: true }],
  },
  {
    name: 'excuse',
    description: "Organizers: excuse someone's latest incident (good-reason cases)",
    default_member_permissions: '32',
    options: [{ type: USER, name: 'user', description: 'Who?', required: true }],
  },
  {
    name: 'participant',
    description: 'Organizers: hold, release, or remove a participant',
    default_member_permissions: '32',
    options: [
      {
        type: SUB_COMMAND,
        name: 'hold',
        description: 'Hold out of matching',
        options: [{ type: USER, name: 'user', description: 'Who?', required: true }],
      },
      {
        type: SUB_COMMAND,
        name: 'release',
        description: 'Release a hold',
        options: [{ type: USER, name: 'user', description: 'Who?', required: true }],
      },
      {
        type: SUB_COMMAND,
        name: 'remove',
        description: 'Remove from the program',
        options: [{ type: USER, name: 'user', description: 'Who?', required: true }],
      },
    ],
  },
  {
    name: 'digest',
    description: 'Organizers: post the weekly digest now',
    default_member_permissions: '32',
  },
];
