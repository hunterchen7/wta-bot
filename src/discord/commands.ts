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
  choices?: Array<{ name: string; value: string | number }>;
};

export type Command = {
  name: string;
  description: string;
  options?: CommandOption[];
  default_member_permissions?: string;
};

export const COMMANDS: Command[] = [
  { name: 'help', description: 'What can this bot do? All commands explained' },
  { name: 'join', description: 'Enroll in the WTA mock-interview program (or edit your info)' },
  { name: 'status', description: 'Your progress, sessions, owed forms, and standing' },
  { name: 'optout', description: 'Sit out the current round (no penalty — catch up later)' },
  { name: 'leave', description: 'Leave the program entirely — partners get re-paired' },
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
  { name: 'dashboard', description: 'Get a one-click sign-in link for the web dashboard' },
  {
    name: 'admin',
    description: 'Organizer toolkit — everything in one place',
    default_member_permissions: '32',
    options: [
      { type: SUB_COMMAND, name: 'roster', description: 'Enrollment summary at a glance' },
      { type: SUB_COMMAND, name: 'export', description: 'Download the roster as CSV' },
      { type: SUB_COMMAND, name: 'digest', description: 'Post the round digest now' },
      { type: SUB_COMMAND, name: 'eligible', description: 'List alumni-round eligible participants' },
      { type: SUB_COMMAND, name: 'backfill', description: 'Grant the member role to all existing members' },
      {
        type: SUB_COMMAND,
        name: 'standing',
        description: "A participant's progress, strikes, incidents",
        options: [{ type: USER, name: 'user', description: 'Who?', required: true }],
      },
      {
        type: SUB_COMMAND,
        name: 'excuse',
        description: "Excuse someone's latest incident",
        options: [{ type: USER, name: 'user', description: 'Who?', required: true }],
      },
      {
        type: SUB_COMMAND,
        name: 'pair',
        description: 'Manually pair two participants (catch-up session)',
        options: [
          { type: USER, name: 'interviewer', description: 'Who interviews', required: true },
          { type: USER, name: 'interviewee', description: 'Who gets interviewed', required: true },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'repair',
        description: 'Queue someone for an automatic repair pairing',
        options: [
          { type: USER, name: 'user', description: 'Who needs a session', required: true },
          {
            type: STRING,
            name: 'need',
            description: 'What they need',
            required: true,
            choices: [
              { name: 'an interviewer (they get interviewed)', value: 'interviewer' },
              { name: 'an interviewee (they interview)', value: 'interviewee' },
            ],
          },
        ],
      },
      {
        type: 2, // SUB_COMMAND_GROUP
        name: 'setup',
        description: 'Configure the bot for this server',
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
              { type: STRING, name: 'start_date', description: 'Round 1 start day, YYYY-MM-DD (2026: 2026-07-26)', required: true },
              { type: STRING, name: 'name', description: 'Cohort name' },
            ],
          },
          { type: SUB_COMMAND, name: 'verify', description: 'Post the verification panel' },
        ],
      },
      {
        type: 2,
        name: 'participant',
        description: 'Hold, release, or remove a participant',
        options: [
          { type: SUB_COMMAND, name: 'hold', description: 'Hold out of matching', options: [{ type: USER, name: 'user', description: 'Who?', required: true }] },
          { type: SUB_COMMAND, name: 'release', description: 'Release a hold / reinstate', options: [{ type: USER, name: 'user', description: 'Who?', required: true }] },
          { type: SUB_COMMAND, name: 'remove', description: 'Remove from the program', options: [{ type: USER, name: 'user', description: 'Who?', required: true }] },
        ],
      },
      {
        type: 2,
        name: 'problems',
        description: 'Manage the question bank',
        options: [
          {
            type: SUB_COMMAND,
            name: 'add',
            description: 'Add a problem to the master bank',
            options: [
              { type: STRING, name: 'title', description: 'Problem title', required: true },
              {
                type: STRING,
                name: 'difficulty',
                description: 'Difficulty',
                required: true,
                choices: [
                  { name: 'easy', value: 'easy' },
                  { name: 'medium', value: 'medium' },
                  { name: 'hard', value: 'hard' },
                ],
              },
              { type: 4, name: 'number', description: 'LeetCode number' },
              { type: STRING, name: 'url', description: 'Problem link' },
              { type: 10, name: 'rank', description: 'Fine rank 1.0-3.1 (2.7 = harder medium)' },
            ],
          },
          { type: SUB_COMMAND, name: 'list', description: 'Bank overview' },
          {
            type: SUB_COMMAND,
            name: 'setweek',
            description: "Pre-generate a round's set by difficulty rule",
            options: [
              { type: 4, name: 'week', description: 'Round number (1-3)', required: true },
              { type: 4, name: 'size', description: 'Set size (default 5)' },
            ],
          },
        ],
      },
    ],
  },
];
