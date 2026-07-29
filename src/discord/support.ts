import type { MessagePayload } from './rest';

export const SUPPORT_BUTTON_ID = 'support:create';

export function supportPanelMessage(): MessagePayload {
  return {
    content:
      '## WTA support\n' +
      'Need help with the program, your dashboard, scheduling, or a pairing? Open a support thread and an organizer will respond.\n\n' +
      'Support threads are private and visible only to you and WTA organizers.',
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
