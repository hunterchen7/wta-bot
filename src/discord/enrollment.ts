import type { MessagePayload } from './rest';

export const ENROLLMENT_BUTTON_ID = 'enrollment:open';

/** Persistent call-to-action that can be posted in any program channel. */
export function enrollmentButtonMessage(): MessagePayload {
  return {
    content:
      '👋 **Join WTA 2026**\n' +
      'Set up your profile to access the WTA dashboard and participate in mock-interview rounds. You can update it later.\n\n' +
      'Click below to get your personal enrollment link. Only you will be able to see it.',
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
