import type { MessagePayload } from './rest';

export const ENROLLMENT_BUTTON_ID = 'enrollment:open';

/** Public rules copy. Discord's native acceptance gate must still be configured
 * in Server Settings because its editing API is not public. */
export function serverRulesMessage(): MessagePayload {
  return {
    content:
      '## WTA community rules\n' +
      '1. **Be respectful.** Harassment, discrimination, hate speech, or personal attacks are not welcome.\n' +
      '2. **Protect people’s privacy.** Do not share interview recordings, feedback, personal information, or private conversations without permission.\n' +
      '3. **Keep the program fair.** Do not redistribute assigned interview problems or solutions before a round is complete.\n' +
      '4. **Use the right channels.** Avoid spam, unsolicited promotion, and repeatedly contacting people who have not responded.\n' +
      '5. **Follow Discord’s rules and organizer guidance.** If something feels unsafe or disruptive, contact an organizer.',
    allowed_mentions: { parse: [] },
  };
}

/** Persistent call-to-action that can be posted in any program channel. */
export function enrollmentButtonMessage(): MessagePayload {
  return {
    content:
      '## Welcome to Western Tech Alumni 👋\n' +
      'Join WTA 2026 to access the dashboard, mock-interview rounds, scheduling, workshops, and program updates. You can update your profile later.\n\n' +
      'Press **Join WTA**, and follow the link to complete the enrolment.',
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: ENROLLMENT_BUTTON_ID,
            label: 'Join WTA',
            style: 1,
            emoji: { name: '🎓' },
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
