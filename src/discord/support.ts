import type { MessagePayload } from './rest';

export const SUPPORT_BUTTON_ID = 'support:create';

export function supportPanelMessage(): MessagePayload {
  return {
    content:
      '## WTA support\n' +
      'Need help with the program, your dashboard, scheduling, or a pairing? Open a support thread and an organizer will respond.\n\n' +
      'Your thread will be private to you and the WTA organizers whenever Discord permits it. If private threads are unavailable, the bot will clearly tell you before using a participant-only thread.',
    components: [{
      type: 1,
      components: [{
        type: 2,
        custom_id: SUPPORT_BUTTON_ID,
        label: 'Open support thread',
        style: 1,
        emoji: { name: '🛟' },
      }],
    }],
    allowed_mentions: { parse: [] },
  };
}
