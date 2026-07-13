/**
 * Shared participant-profile copy used by enrollment and dashboard settings.
 * Keep product wording here so both forms stay consistent when copy changes.
 */
export const profileFormContent = {
  sections: {
    profile: {
      title: "Profile",
      description: "Keep your name and contact details up to date.",
    },
    goals: {
      title: "Goals",
      description:
        "Choose everything that applies so we can plan relevant interview practice and workshops.",
    },
    context: {
      title: "More about you",
      description:
        "Tell us what you want to learn and the kind of work you hope to do.",
    },
    materials: {
      title: "Application materials",
      description:
        "Optional links and a resume help organizers understand your experience and tailor feedback.",
    },
    notifications: {
      title: "Notifications",
      description: "Discord is the main place for program updates. Email reminders are optional.",
    },
  },
  fields: {
    name: { label: "Full name" },
    preferredEmail: {
      label: "Preferred email",
      help: "A personal email is recommended.",
    },
    westernEmail: { label: "Western email" },
    year: { label: "Incoming year" },
    program: { label: "Program" },
    experience: { label: "How many technical interviews have you done before?" },
    opportunities: { label: "What opportunities are you looking for?" },
    topics: { label: "Which topics would be most helpful for you?" },
    priorWta: { label: "I have participated in WTA before" },
    blurb: {
      label:
        "In an ideal world, which company would you like to work for and what would you like to do?",
      guidance:
        "Describe the company, team, or kind of organization; the problems or products you want to work on; the skills you hope to use or develop; and why that work matters to you. Specific answers are much more useful than a company name alone.",
      placeholder:
        "For example: the kind of team you would join, what you would be responsible for, which problems excite you, and what you want to learn…",
    },
    interests: { label: "Anything else you are interested in learning?" },
    priorFeedback: { label: "Any feedback from last year's sessions? (If attended)" },
    linkedinUrl: {
      label: "LinkedIn profile (optional)",
      placeholder: "https://www.linkedin.com/in/your-name",
    },
    otherUrl: {
      label: "Portfolio, GitHub, or personal website (optional)",
      placeholder: "https://github.com/your-name",
    },
  },
  selectPlaceholder: "Choose…",
  emailOptIn: {
    label: "Send me email reminders",
    description:
      "Get an email when pairings are ready, weekly participation opens, or a report is overdue. You'll receive a confirmation email when you turn this on.",
  },
} as const;

export function profileBlurbHelp(wordCount: number, minimumWords: number) {
  return `${profileFormContent.fields.blurb.guidance} ${wordCount} / ${minimumWords} minimum words.`;
}
