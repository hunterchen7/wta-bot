/**
 * Shared participant-profile copy used by enrollment and dashboard settings.
 * Keep product wording here so both forms stay consistent when copy changes.
 */
export const profileFormContent = {
  sections: {
    profile: {
      title: "Profile",
      description:
        "Used for your dashboard, program messages, matching, and organizer records.",
    },
    goals: {
      title: "Goals",
      description:
        "Choose everything that applies; these answers help shape matching and workshops.",
    },
    context: {
      title: "Context",
      description:
        "Give organizers enough signal to understand your goals and design useful sessions.",
    },
    notifications: {
      title: "Email reminders",
      description: "Discord remains the primary channel.",
    },
  },
  fields: {
    name: { label: "Full name" },
    preferredEmail: {
      label: "Preferred email",
      help: "Used for dashboard login and optional reminders.",
    },
    westernEmail: { label: "Western email" },
    year: { label: "Incoming year" },
    program: { label: "Program" },
    experience: { label: "Technical interviews completed" },
    opportunities: { label: "What opportunities are you targeting?" },
    topics: { label: "Which topics would help most?" },
    priorWta: { label: "I participated in WTA before" },
    blurb: {
      label:
        "Imagine your ideal role after graduation. Where would you work, what would you build, and why?",
      guidance:
        "Describe the company, team, or kind of organization; the problems or products you want to work on; the skills you hope to use or develop; and why that work matters to you. Specific answers are much more useful than a company name alone.",
      placeholder:
        "For example: the kind of team you would join, what you would be responsible for, which problems excite you, and what you want to learn…",
    },
    interests: { label: "Anything else you want to learn?" },
    priorFeedback: { label: "Feedback from prior WTA sessions" },
  },
  selectPlaceholder: "Choose…",
  emailOptIn: {
    label: "Email me program reminders",
    description:
      "Pairings, opt-in reminders, and overdue-report alerts. Saving an opt-in sends a confirmation email.",
  },
} as const;

export function profileBlurbHelp(wordCount: number, minimumWords: number) {
  return `${profileFormContent.fields.blurb.guidance} ${wordCount} / ${minimumWords} minimum words.`;
}
